// 汇率 / Exchange rates entered by hand (plan item 7, migration 081). One set per owner (SIM = merchant_id NULL):
// 1 unit of `currency` = `rate` units of `base_currency`. No outside rate service is called; the report keeps
// each currency on its own line and only adds a converted total when every currency in it has a rate.
const fail=(code,message,status=400,extra={})=>Object.assign(new Error(message),{code,status,...extra});
export const DEFAULT_BASE_CURRENCY='USD';
export const MAX_EXCHANGE_RATES=30;

const code=(value,field)=>{
  const text=String(value??'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(text))throw fail('CRM_VALUE_INVALID','Currency must be a 3-letter code such as EUR',400,{field});
  return text;
};
const round2=value=>Math.round(value*100)/100;

/** Validates a PUT body; returns {base_currency, rates:[{currency,rate}]} (sorted by currency). */
export function exchangeRateInput(body={}){
  const base=code(body.base_currency||DEFAULT_BASE_CURRENCY,'base_currency');
  const list=Array.isArray(body.rates)?body.rates:[];
  if(list.length>MAX_EXCHANGE_RATES)throw fail('CRM_VALUE_INVALID',`At most ${MAX_EXCHANGE_RATES} rates`,400,{field:'rates'});
  const seen=new Set();
  const rates=list.map((row,index)=>{
    const currency=code(row?.currency,`rates.${index}.currency`);
    if(currency===base)throw fail('CRM_RATE_SAME_AS_BASE','A rate cannot be for the base currency',400,{field:`rates.${index}.currency`});
    if(seen.has(currency))throw fail('CRM_RATE_DUPLICATE','Each currency once',400,{field:`rates.${index}.currency`});
    seen.add(currency);
    const rate=Number(row?.rate);
    if(!Number.isFinite(rate)||rate<=0||rate>1e6)throw fail('CRM_VALUE_INVALID','Rate must be a positive number',400,{field:`rates.${index}.rate`});
    return{currency,rate:Math.round(rate*1e8)/1e8};
  }).sort((a,b)=>a.currency.localeCompare(b.currency));
  return{base_currency:base,rates};
}

/**
 * Converted totals for the report's per-currency rows ({currency,pipeline_amount,weighted_amount,won_amount}).
 * `rates` is the stored set {base_currency, rates:[{currency,rate}]}. total is null when any currency lacks a rate.
 */
export function convertTotals(currencies=[],rates={}){
  const base=rates.base_currency||DEFAULT_BASE_CURRENCY;
  const byCode=new Map((rates.rates||[]).map(row=>[row.currency,Number(row.rate)]));
  byCode.set(base,1);
  const present=currencies.filter(row=>row&&row.currency);
  const missing=[...new Set(present.map(row=>row.currency).filter(currency=>!byCode.has(currency)))];
  if(!present.length||missing.length)return{base,total:null,missing,currencies:present.map(row=>row.currency)};
  const sum=key=>round2(present.reduce((acc,row)=>acc+(Number(row[key])||0)*byCode.get(row.currency),0));
  return{base,total:{pipeline_amount:sum('pipeline_amount'),weighted_amount:sum('weighted_amount'),won_amount:sum('won_amount')},missing:[],
    currencies:present.map(row=>row.currency)};
}

export class ExchangeRateService{
  constructor({pool}){this.pool=pool;}
  owner(scope){return scope?.merchantId??null;}

  async get(scope=null){
    const rows=(await this.pool.query(`SELECT base_currency,currency,rate,updated_at FROM leadgen.crm_exchange_rates
      WHERE merchant_id IS NOT DISTINCT FROM $1::uuid ORDER BY currency`,[this.owner(scope)])).rows;
    const last=(await this.pool.query(`SELECT base_currency,changed_at,changed_by FROM leadgen.crm_exchange_rate_events
      WHERE merchant_id IS NOT DISTINCT FROM $1::uuid ORDER BY changed_at DESC LIMIT 1`,[this.owner(scope)])).rows[0];
    return{base_currency:(rows[0]?.base_currency||last?.base_currency||DEFAULT_BASE_CURRENCY).trim(),
      rates:rows.map(row=>({currency:row.currency.trim(),rate:Number(row.rate)})),updated_at:last?.changed_at||null,updated_by:last?.changed_by||null};
  }

  /** Replaces the owner's whole set and records the change. */
  async save(body,actor,scope=null){
    const input=exchangeRateInput(body);
    const owner=this.owner(scope);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`DELETE FROM leadgen.crm_exchange_rates WHERE merchant_id IS NOT DISTINCT FROM $1::uuid`,[owner]);
      for(const row of input.rates)await client.query(`INSERT INTO leadgen.crm_exchange_rates(merchant_id,base_currency,currency,rate,updated_by) VALUES($1,$2,$3,$4,$5)`,
        [owner,input.base_currency,row.currency,row.rate,actor]);
      await client.query(`INSERT INTO leadgen.crm_exchange_rate_events(merchant_id,base_currency,rates,changed_by) VALUES($1,$2,$3::jsonb,$4)`,
        [owner,input.base_currency,JSON.stringify(Object.fromEntries(input.rates.map(row=>[row.currency,row.rate]))),actor]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return this.get(scope);
  }
}
