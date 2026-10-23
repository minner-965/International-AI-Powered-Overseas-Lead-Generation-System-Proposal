// Search spend guard for frozen discovery plans.
// Unit prices are configurable estimates (USD per executed search query), not
// provider invoices. Recorded spend comes from leadgen.provider_usage_events:
// the provider-reported cost when present, otherwise the configured unit price.
// SEARXNG is the local instance: free, but still listed so its ledger rows are counted.
const DEFAULT_UNIT_PRICES=Object.freeze({SEARXNG:0,EXA:0.007,TAVILY:0.008});
const number=(value,fallback,{min=0}={})=>{
  if(value===undefined||value===null||String(value).trim()==='')return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=min?parsed:fallback;
};
const round=value=>Math.round(Number(value||0)*10000)/10000;
const codeError=(code,status,details={})=>Object.assign(new Error(code),{code,status,retryable:false,...details});

export function loadSearchCostConfig(env=process.env){
  const unitPrices={...DEFAULT_UNIT_PRICES};
  for(const [key,value] of Object.entries(env||{})){
    const match=/^SEARCH_COST_USD_PER_QUERY_([A-Z][A-Z0-9_]{1,39})$/.exec(key);
    if(match)unitPrices[match[1]]=number(value,unitPrices[match[1]]??0);
  }
  return Object.freeze({
    unitPrices:Object.freeze(unitPrices),
    maxQueriesPerBatch:Math.floor(number(env?.SEARCH_MAX_QUERIES_PER_BATCH,300,{min:1})),
    maxUsdPerMonth:number(env?.SEARCH_MAX_USD_PER_MONTH,30),
    reuseDays:Math.floor(number(env?.SEARCH_REUSE_DAYS,30))
  });
}

export const billingPeriod=(now=new Date())=>new Date(now).toISOString().slice(0,7);

export class SearchCostControl {
  constructor({pool=null,config=loadSearchCostConfig(),providerOrder=async()=>['searxng','exa','tavily'],now=()=>new Date()}={}){
    this.pool=pool;this.config=config;this.providerOrder=providerOrder;this.now=now;
  }
  priced(){return Object.keys(this.config.unitPrices);}
  unitPrice(provider){return Number(this.config.unitPrices[String(provider||'').toUpperCase()]??0);}
  // The estimate is conservative: the most expensive provider in the current execution order.
  async estimateUnitPrice(){
    const order=(await this.providerOrder()||[]).map(value=>String(value).toUpperCase());
    // A free first provider (SearXNG) may fall back to a paid one, so the estimate stays at
    // the most expensive provider in the order; an all-free order estimates zero.
    // An unpriced provider is estimated at the highest configured price.
    const highest=Math.max(0,...Object.values(this.config.unitPrices));
    if(order.length)return Math.max(0,...order.map(provider=>Object.hasOwn(this.config.unitPrices,provider)?this.unitPrice(provider):highest));
    return highest;
  }
  async monthSpend(queryable=this.pool){
    if(!queryable)return {billing_period:billingPeriod(this.now()),recorded_queries:0,recorded_cost_usd:0};
    const period=billingPeriod(this.now());
    const providers=this.priced();
    const prices=providers.map(provider=>this.unitPrice(provider));
    // Reuse events are SKIPPED and cost nothing. Failed attempts without used units are not billed.
    const result=await queryable.query(`SELECT count(*)::int recorded_queries,
        coalesce(sum(coalesce(
          CASE WHEN jsonb_typeof(e.result_payload->'audit'->'provider_cost_usd')='number'
            THEN (e.result_payload->'audit'->>'provider_cost_usd')::numeric END,
          p.price*greatest(e.used_units,1))),0)::float8 recorded_cost_usd
      FROM leadgen.provider_usage_events e
      JOIN unnest($2::text[],$3::numeric[]) p(provider,price) ON p.provider=e.provider
      WHERE e.billing_period=$1 AND e.status<>'SKIPPED'
        AND (e.status IN('COMPLETED','NOT_FOUND','RESERVED') OR e.used_units>0)`,[period,providers,prices]);
    const row=result.rows[0]||{};
    return {billing_period:period,recorded_queries:Number(row.recorded_queries||0),recorded_cost_usd:round(row.recorded_cost_usd)};
  }
  async estimate(plan,queryable=this.pool){
    const planned=Number(plan?.summary?.planned_query_count??plan?.queries?.length??0);
    const reusable=queryable&&Array.isArray(plan?.queries)?await this.countReusable(plan.queries,queryable):0;
    const unit=await this.estimateUnitPrice();
    const billable=Math.max(0,planned-reusable);
    const month=await this.monthSpend(queryable);
    return {estimated_queries:planned,estimated_reused_queries:reusable,estimated_billable_queries:billable,
      estimated_cost_usd:round(billable*unit),estimated_unit_price_usd:unit,unit_prices_usd:{...this.config.unitPrices},
      cost_basis:'CONFIGURED_ESTIMATE',max_queries_per_batch:this.config.maxQueriesPerBatch,
      max_usd_per_month:this.config.maxUsdPerMonth,reuse_days:this.config.reuseDays,
      month_to_date_cost_usd:month.recorded_cost_usd,month_to_date_queries:month.recorded_queries,billing_period:month.billing_period,
      remaining_month_usd:round(Math.max(0,this.config.maxUsdPerMonth-month.recorded_cost_usd))};
  }
  async countReusable(queries,queryable=this.pool){
    if(!queryable||!queries.length||this.config.reuseDays<=0)return 0;
    const keys=[...new Set(queries.map(q=>JSON.stringify([String(q.normalized_query||'').toLowerCase(),String(q.market_id||'').toUpperCase(),String(q.language||'en')])))].map(JSON.parse);
    const result=await queryable.query(`SELECT count(*)::int reusable FROM unnest($1::text[],$2::text[],$3::text[]) k(query,country,lang)
      WHERE EXISTS(SELECT 1 FROM leadgen.research_query_executions e
        WHERE e.status IN('PERSISTED','NOT_FOUND') AND e.response_snapshot IS NOT NULL
          AND lower(e.request_snapshot->>'query')=k.query
          AND upper(coalesce(e.request_snapshot->>'country','ALL'))=k.country
          AND coalesce(e.request_snapshot->>'searchLang','en')=k.lang
          AND e.provider_completed_at>=now()-make_interval(days=>$4::int))`,
      [keys.map(k=>k[0]),keys.map(k=>k[1]),keys.map(k=>k[2]),this.config.reuseDays]);
    return Math.min(queries.length,Number(result.rows[0]?.reusable||0));
  }
  // Creation guard: the frozen plan must contain queries, stay under the per-batch cap,
  // and its billable estimate must fit the remaining monthly budget.
  assertCreatable(estimate){
    if(!estimate||estimate.estimated_queries<=0)throw codeError('SEARCH_PLAN_EMPTY',422,{estimate});
    if(estimate.estimated_queries>this.config.maxQueriesPerBatch)
      throw codeError('SEARCH_BATCH_QUERY_CAP_EXCEEDED',409,{estimate});
    if(estimate.month_to_date_cost_usd+estimate.estimated_cost_usd>this.config.maxUsdPerMonth)
      throw codeError('SEARCH_MONTHLY_BUDGET_EXCEEDED',409,{estimate});
    return estimate;
  }
  // Execution guard: queued work stops before a paid call that would exceed the monthly cap.
  async canSpend(provider,queryable=this.pool){
    const month=await this.monthSpend(queryable);
    const next=this.unitPrice(provider);
    return {allowed:month.recorded_cost_usd+next<=this.config.maxUsdPerMonth,...month,next_query_usd:next,
      max_usd_per_month:this.config.maxUsdPerMonth};
  }
}
