import {createHash,randomUUID} from 'node:crypto';
import {isMarketVisible} from '../../public/market-visibility.js';
import {normalizeTargetCategoryCode} from '../categoryProcurement/targetCategoryContext.js';

export const ACTIVE_RESEARCH_STATES=Object.freeze(['QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING','RESOLVING','VERIFYING','PERSISTING']);
const clean=value=>String(value??'').trim();
const unique=values=>[...new Set(values)].sort();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normal=value=>clean(value).toLowerCase().replace(/\s+/g,' ');
const error=(code,status=422)=>Object.assign(new Error(code),{code,status});
const BUYERS=new Set(['Department Store','Large Retail Group','Regional Retail Chain','Supermarket','Importer','Wholesaler','Distributor']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalResearchScope(payload={}) {
  return JSON.stringify([clean(payload.country_code||payload.market_code).toUpperCase(),
    normalizeTargetCategoryCode(payload.product_category||payload.category_code),normal(payload.city),normal(payload.region)]);
}
export async function lockResearchCreation(client) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['leadgen:research:canonical-create']);
}
// Called inside either the existing direct-outbox transaction or the batch transaction.
// Scope deduplication intentionally ignores requested result limits and buyer overrides:
// an active market/category scope is reused without changing its actual execution input.
export async function createOrReuseResearchJob(client,{payload,idempotencyKey,requestDigest,identity,role,runBudgetCapUnits=20000,beforeInsert=async()=>{}}) {
  await lockResearchCreation(client);
  if(idempotencyKey){
    const alias=await client.query(`SELECT j.*,a.request_digest alias_digest,a.requested_by alias_actor
      FROM leadgen.research_job_scope_requests a JOIN leadgen.research_jobs j ON j.id=a.research_job_id
      WHERE a.idempotency_key=$1`,[idempotencyKey]);
    if(alias.rowCount){
      if(alias.rows[0].alias_digest!==requestDigest||alias.rows[0].alias_actor!==identity)throw error('RESEARCH_IDEMPOTENCY_CONFLICT',409);
      return {...alias.rows[0],inserted:false,idempotent_replay:true};
    }
    const prior=await client.query('SELECT * FROM leadgen.research_jobs WHERE idempotency_key=$1',[idempotencyKey]);
    if(prior.rowCount){
      if(prior.rows[0].request_digest!==requestDigest
        ||(prior.rows[0].created_by_identity&&prior.rows[0].created_by_identity!==identity))throw error('RESEARCH_IDEMPOTENCY_CONFLICT',409);
      return {...prior.rows[0],inserted:false,idempotent_replay:true};
    }
  }
  const recordAlias=async job=>{
    if(idempotencyKey)await client.query(`INSERT INTO leadgen.research_job_scope_requests
      (idempotency_key,request_digest,research_job_id,requested_by) VALUES($1,$2,$3,$4)`,[idempotencyKey,requestDigest,job.id,identity]);
    return job;
  };
  const active=await client.query(`SELECT * FROM leadgen.research_jobs
    WHERE job_type='COMPANY_DISCOVERY' AND status=ANY($1::text[]) AND upper(country_code)=$2
    ORDER BY created_at,id`,[ACTIVE_RESEARCH_STATES,clean(payload.country_code).toUpperCase()]);
  const existing=active.rows.find(row=>canonicalResearchScope(row)===canonicalResearchScope(payload));
  if(existing)return recordAlias({...existing,inserted:false,active_scope_reused:true});
  await beforeInsert();
  const result=await client.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,city,region,preferred_language,market_profile,
     product_category,product_profile,buyer_types,max_results,status,idempotency_key,request_digest,
     created_by_identity,created_by_role,run_budget_cap_units)
    VALUES($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$12,$13,$14,$15) RETURNING *`,[
    payload.country_name,payload.country_code,payload.city||null,payload.region||null,payload.preferred_language,
    payload.market_profile||payload.country_code,payload.product_category,payload.product_profile,
    payload.buyer_types,payload.max_results,idempotencyKey||randomUUID(),requestDigest,identity,role,runBudgetCapUnits]);
  return recordAlias({...result.rows[0],inserted:true});
}

export function normalizeBatchInput(input={}) {
  for(const field of ['market_codes','category_scope_ids','buyer_types']){
    if(input[field]!==undefined&&!Array.isArray(input[field]))throw error('RESEARCH_SELECTION_INVALID');
  }
  const markets=unique((Array.isArray(input.market_codes)?input.market_codes:[]).map(value=>clean(value).toUpperCase()));
  const categories=unique((Array.isArray(input.category_scope_ids)?input.category_scope_ids:[]).map(value=>clean(value).toLowerCase()));
  if(markets.some(value=>!/^([A-Z]{2})$/.test(value)))throw error('RESEARCH_MARKET_INVALID');
  if(categories.some(value=>!uuid.test(value)))throw error('RESEARCH_CATEGORY_INVALID');
  const buyers=input.buyer_types===undefined?null:unique((Array.isArray(input.buyer_types)?input.buyer_types:[]).map(clean));
  if(buyers&&(!buyers.length||buyers.some(value=>!BUYERS.has(value))))throw error('RESEARCH_BUYER_TYPES_INVALID');
  const maxResults=Number(input.max_results??20);
  if(!Number.isInteger(maxResults)||maxResults<1||maxResults>100)throw error('RESEARCH_MAX_RESULTS_INVALID');
  return {market_codes:markets,category_scope_ids:categories,select_all_markets:input.select_all_markets===true,
    select_all_categories:input.select_all_categories===true,buyer_types:buyers,max_results:maxResults,
    city:clean(input.city)||null,region:clean(input.region)||null};
}

export function buildScopeSnapshot(input,options,now=new Date()) {
  const validMarkets=options.markets.filter(m=>m.status==='ACTIVE'&&m.search_enabled===true&&isMarketVisible(m.market_code));
  const validCategories=options.categories.filter(c=>c.scope_status==='ACTIVE'&&c.approval_status==='APPROVED');
  const markets=input.select_all_markets?validMarkets:input.market_codes.map(code=>validMarkets.find(m=>m.market_code===code));
  const categories=input.select_all_categories?validCategories:input.category_scope_ids.map(id=>validCategories.find(c=>c.id===id));
  if(!markets.length||markets.some(value=>!value))throw error('RESEARCH_ACTIVE_MARKET_REQUIRED');
  if(!categories.length||categories.some(value=>!value))throw error('RESEARCH_APPROVED_CATEGORY_REQUIRED');
  if(markets.length>1&&(input.city||input.region))throw error('RESEARCH_MULTI_MARKET_LOCATION_INVALID');
  const sortedMarkets=[...markets].sort((a,b)=>a.market_code.localeCompare(b.market_code));
  const sortedCategories=[...categories].sort((a,b)=>a.category_code.localeCompare(b.category_code)||a.id.localeCompare(b.id));
  const scopes=sortedMarkets.flatMap(m=>sortedCategories.map(c=>({
    market_code:m.market_code,country_code:m.market_code,country_name:m.country_name,market_profile:m.market_profile,
    category_scope_id:c.id,scope_revision_id:c.scope_revision_id,category_code:c.category_code,
    product_category:c.category_code,product_profile:c.product_profile,
    ...(c.approved_aliases ? {approved_aliases:structuredClone(c.approved_aliases),parent_category:c.parent_category||null} : {}),
    ...(m.country_terms&&Object.keys(m.country_terms).length?{country_terms:structuredClone(m.country_terms)}:{}),
    languages:[...m.languages],preferred_language:m.languages[0],buyer_types:input.buyer_types||[...m.buyer_types],
    max_results:input.max_results,city:input.city,region:input.region
  })));
  if(new Set(scopes.map(canonicalResearchScope)).size!==scopes.length)throw error('RESEARCH_CATEGORY_SCOPE_AMBIGUOUS',409);
  return {version:1,captured_at:now.toISOString(),markets:structuredClone(sortedMarkets),categories:structuredClone(sortedCategories),
    selection:{select_all_markets:input.select_all_markets,select_all_categories:input.select_all_categories},scopes};
}

function previewResponse(snapshot) {
  return {research_scope_snapshot:snapshot,selected_market_count:snapshot.markets.length,
    selected_category_count:snapshot.categories.length,total_scopes:snapshot.scopes.length,
    buyer_types:unique(snapshot.scopes.flatMap(s=>s.buyer_types)),languages:unique(snapshot.scopes.flatMap(s=>s.languages))};
}
function effectiveJobScope(job) {
  return {country_code:job.country_code,country_name:job.country_name,city:job.city||null,region:job.region||null,
    product_category:job.product_category,product_profile:job.product_profile,
    preferred_language:job.preferred_language,buyer_types:job.buyer_types,max_results:Number(job.max_results)};
}
function configurationDiffers(scope,job) {
  return normal(scope.preferred_language)!==normal(job.preferred_language)
    ||JSON.stringify(unique(scope.buyer_types.map(normal)))!==JSON.stringify(unique((job.buyer_types||[]).map(normal)))
    ||Number(scope.max_results)!==Number(job.max_results);
}

export class ResearchBatchService {
  constructor({pool,directDispatch=null,ensureCanCreate=async()=>{},runBudgetCapUnits=20000,planning=null,costControl=null}={}) {
    if(!pool)throw new Error('ResearchBatchService requires a PostgreSQL pool');
    this.pool=pool;this.directDispatch=directDispatch;this.ensureCanCreate=ensureCanCreate;this.runBudgetCapUnits=runBudgetCapUnits;
    this.planning=planning;this.costControl=costControl;
  }
  // Estimated search volume/cost of a frozen scope snapshot. Without cost control the
  // query count is still reported so an empty plan is visible.
  async searchCost(snapshot,queryable=this.pool) {
    const plan=this.planning.plan(snapshot);
    const estimate=this.costControl?await this.costControl.estimate(plan,queryable)
      :{estimated_queries:Number(plan.summary.planned_query_count),estimated_cost_usd:null,cost_basis:'NOT_CONFIGURED'};
    return {plan,estimate};
  }
  assertSearchCost(estimate) {
    if(this.costControl)return this.costControl.assertCreatable(estimate);
    if(!(estimate.estimated_queries>0))throw Object.assign(new Error('SEARCH_PLAN_EMPTY'),{code:'SEARCH_PLAN_EMPTY',status:422,estimate});
    return estimate;
  }
  async options(queryable=this.pool) {
    const markets=await queryable.query(`SELECT *,market_code country_code FROM leadgen.research_market_registry
      WHERE status='ACTIVE' AND search_enabled=true ORDER BY market_code`);
    const categories=await queryable.query(`SELECT id,id category_scope_id,scope_revision_id,normalized_category,
      normalized_category category_code,normalized_category label,product_profile,scope_status,approval_status,revision
      FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED'
      ORDER BY product_profile,normalized_category,id`);
    if(this.planning&&categories.rows.length){
      const context=await queryable.query(`SELECT c.id,p.normalized_category parent_category,
        coalesce((SELECT jsonb_agg(jsonb_build_object('normalized_alias',a.normalized_alias,'language',a.language,
          'market_code',a.market_code,'alias_type',a.alias_type) ORDER BY a.language,a.normalized_alias,a.alias_type,a.market_code)
          FROM leadgen.dpv_product_category_scope_aliases a WHERE a.scope_id=c.id
          AND a.scope_revision_id=c.scope_revision_id AND a.status='ACTIVE'),'[]'::jsonb) approved_aliases
        FROM leadgen.dpv_product_category_scopes c LEFT JOIN leadgen.dpv_product_category_scopes p
        ON p.id=c.parent_scope_id AND p.scope_revision_id=c.scope_revision_id AND p.scope_status='ACTIVE'
        WHERE c.id=ANY($1::uuid[])`,[categories.rows.map(c=>c.id)]);
      const byId=new Map(context.rows.map(c=>[c.id,c]));
      for(const category of categories.rows)Object.assign(category,byId.get(category.id)||{approved_aliases:[],parent_category:null});
    }
    return {markets:markets.rows.filter(m=>isMarketVisible(m.market_code)),categories:categories.rows,buyer_types:[...BUYERS]};
  }
  async preview(input={}) {
    const result=previewResponse(buildScopeSnapshot(normalizeBatchInput(input),await this.options()));
    if(!this.planning)return result;
    const {plan,estimate}=await this.searchCost(result.research_scope_snapshot);
    let blocked=null;
    try{this.assertSearchCost(estimate);}catch(error){if(!error.estimate)throw error;blocked=error.code;}
    return {...result,search_plan:this.planning.present(plan),estimated_queries:estimate.estimated_queries,
      estimated_cost_usd:estimate.estimated_cost_usd,search_cost:estimate,creation_allowed:!blocked,creation_blocked_code:blocked};
  }
  async create(input={},actor={}) {
    const identity=clean(actor.identity||actor.requested_by);
    const role=clean(actor.role).toUpperCase();
    if(!identity||!['MANAGEMENT','DATA_ADMIN'].includes(role))throw error('RESEARCH_BATCH_ROLE_FORBIDDEN',403);
    const normalized=normalizeBatchInput(input);
    const key=clean(input.idempotency_key);
    if(!key||key.length>200)throw error('RESEARCH_BATCH_IDEMPOTENCY_KEY_REQUIRED',400);
    const requestDigest=digest(normalized);
    const client=await this.pool.connect();let batchId;let replay=false;const createdIds=[];
    try {
      await client.query('BEGIN');
      await lockResearchCreation(client);
      const prior=await client.query('SELECT * FROM leadgen.research_batch_requests WHERE idempotency_key=$1',[key]);
      if(prior.rowCount){
        if(prior.rows[0].request_digest!==requestDigest||prior.rows[0].requested_by!==identity)throw error('RESEARCH_BATCH_IDEMPOTENCY_CONFLICT',409);
        batchId=prior.rows[0].batch_id;replay=true;
      }else{
        // Lock registry sources while resolving the accepted, effective category revision.
        // SHARE prevents concurrent edits; immutable approved revisions remain unchanged.
        await client.query('LOCK TABLE leadgen.research_market_registry IN SHARE MODE');
        await client.query('LOCK TABLE leadgen.dpv_product_category_scope_revisions,leadgen.dpv_product_category_scopes IN SHARE MODE');
        if(this.planning)await client.query('LOCK TABLE leadgen.dpv_product_category_scope_aliases IN SHARE MODE');
        const snapshot=buildScopeSnapshot(normalized,await this.options(client));
        const scopeDigest=digest(snapshot.scopes);
        // Spend guard before any child job or outbox row exists; the creation lock serializes the monthly check.
        const searchCost=this.planning?this.assertSearchCost((await this.searchCost(snapshot,client)).estimate):null;
        const same=await client.query(`SELECT b.* FROM leadgen.research_batches b
          WHERE requested_by=$1 AND scope_digest=$2 AND status IN('QUEUED','RUNNING')
          ORDER BY created_at DESC LIMIT 1`,[identity,scopeDigest]);
        if(same.rowCount){batchId=same.rows[0].id;replay=true;}
        else{
          let providerChecked=false;
          const children=[];
          batchId=randomUUID();
          for(const scope of snapshot.scopes){
            const child=await createOrReuseResearchJob(client,{payload:scope,
              idempotencyKey:`batch:${batchId}:${digest(canonicalResearchScope(scope))}`,
              requestDigest:digest(scope),identity,role,runBudgetCapUnits:this.runBudgetCapUnits,
              beforeInsert:async()=>{if(!providerChecked){await this.ensureCanCreate('COMPANY_DISCOVERY');providerChecked=true;}}});
            if(child.inserted){
              await client.query(`INSERT INTO leadgen.research_job_dispatch_outbox(research_job_id,execution_key)
                VALUES($1,$2) ON CONFLICT(research_job_id) DO NOTHING`,[child.id,child.dispatch_execution_key]);
              createdIds.push(child.id);
            }
            children.push({scope,child});
          }
          await client.query(`INSERT INTO leadgen.research_batches
            (id,requested_by,requested_role,idempotency_key,request_digest,scope_digest,research_scope_snapshot,total_scopes,created_child_count,reused_child_count)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,[batchId,identity,role,key,requestDigest,scopeDigest,
            JSON.stringify(snapshot),snapshot.scopes.length,createdIds.length,snapshot.scopes.length-createdIds.length]);
          if(searchCost)await client.query(`INSERT INTO leadgen.research_batch_cost_estimates
            (batch_id,estimated_queries,estimated_cost_usd,estimate) VALUES($1,$2,$3,$4::jsonb)`,
            [batchId,searchCost.estimated_queries,searchCost.estimated_cost_usd,JSON.stringify(searchCost)]);
          for(const {scope,child} of children)await client.query(`INSERT INTO leadgen.research_batch_children
            (batch_id,scope_key,research_job_id,market_code,category_scope_id,scope_snapshot,reused)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[batchId,canonicalResearchScope(scope),child.id,scope.market_code,scope.category_scope_id,
            JSON.stringify({requested_scope:scope,effective_job_scope:effectiveJobScope(child),configuration_reused:!child.inserted&&configurationDiffers(scope,child)}),!child.inserted]);
          await client.query('SELECT leadgen.refresh_research_batch_status($1)',[batchId]);
          if(this.planning)await this.planning.freezeBatch(client,batchId,snapshot,children);
        }
        await client.query(`INSERT INTO leadgen.research_batch_requests(idempotency_key,request_digest,requested_by,batch_id)
          VALUES($1,$2,$3,$4)`,[key,requestDigest,identity,batchId]);
      }
      await client.query('COMMIT');
    }catch(err){try{await client.query('ROLLBACK');}catch{}throw err;}finally{client.release();}
    // The durable outbox has already committed. The existing reconciler recovers a
    // process stop or queue outage here; reused children are never redispatched.
    if(this.directDispatch)for(const id of createdIds){try{await this.directDispatch.dispatch(id);}catch{/* durable outbox retries */}}
    return {...await this.get(batchId),idempotent_replay:replay};
  }
  async get(id) {
    if(!uuid.test(clean(id)))throw error('RESEARCH_BATCH_ID_INVALID',400);
    const result=await this.pool.query('SELECT * FROM leadgen.research_batches WHERE id=$1',[id]);
    if(!result.rowCount)throw error('RESEARCH_BATCH_NOT_FOUND',404);
    const children=await this.pool.query(`SELECT c.*,c.research_job_id job_id,j.status,j.dispatch_state,
      j.created_at job_created_at,j.completed_at FROM leadgen.research_batch_children c
      JOIN leadgen.research_jobs j ON j.id=c.research_job_id WHERE c.batch_id=$1
      ORDER BY c.market_code,c.scope_key`,[id]);
    const row=result.rows[0];
    const cost=await this.pool.query(`SELECT estimated_queries,estimated_cost_usd,estimate FROM leadgen.research_batch_cost_estimates
      WHERE batch_id=$1`,[id]).catch(()=>({rows:[]}));
    const detail={...row,batch_id:row.id,...previewResponse(row.research_scope_snapshot),children:children.rows,
      ...(cost.rows[0]?{estimated_queries:cost.rows[0].estimated_queries,estimated_cost_usd:cost.rows[0].estimated_cost_usd===null?null:Number(cost.rows[0].estimated_cost_usd),
        search_cost:cost.rows[0].estimate}:{})};
    return this.planning?{...detail,search_plan:await this.planning.forBatch(detail)}:detail;
  }
  async list({limit=50}={}) {
    const result=await this.pool.query(`SELECT * FROM leadgen.research_batches ORDER BY created_at DESC,id DESC LIMIT $1`,
      [Math.max(1,Math.min(100,Number(limit)||50))]);
    return {items:result.rows.map(row=>({...row,batch_id:row.id,...previewResponse(row.research_scope_snapshot)}))};
  }
}
