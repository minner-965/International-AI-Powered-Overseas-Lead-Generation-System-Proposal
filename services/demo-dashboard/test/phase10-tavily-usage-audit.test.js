import assert from 'node:assert/strict';
import test from 'node:test';
import { TavilyCreditBudget,TavilyUsageAudit } from '../src/search/TavilyUsageAudit.js';
import { CategoryEvidenceService } from '../src/categoryProcurement/CategoryEvidenceService.js';
import { EnrichmentService } from '../src/enrichment/EnrichmentService.js';
import { createAutoEvidenceExecutors } from '../src/autoEvidence/executors.js';

const jobA='11111111-1111-4111-8111-111111111111';
const jobB='22222222-2222-4222-8222-222222222222';
const companyId='33333333-3333-4333-8333-333333333333';
const request={query:'site:example.com women dresses buyer',count:5,country:'AE',countryName:'United Arab Emirates'};

function providerFixture({failure=null}={}) {
  const calls=[];
  return {
    name:'tavily',endpoint:'https://api.tavily.com/search?ignored=1',calls,
    async search(input) {
      calls.push(input);
      if(failure)throw Object.assign(new Error('provider error'),failure);
      return {provider:'tavily',requestId:'tavily-request-1',credits:1,
        results:[{title:'Public result',url:'https://example.com/dresses',snippet:'Public page',rank:1}]};
    }
  };
}

test('Tavily usage audit persists purpose, endpoint, exact credits, request id and only business-row references',async()=>{
  const provider=providerFixture();
  const audit=new TavilyUsageAudit({provider,runCapUnits:3,billingPeriodCapUnits:10});
  let persisted=[];
  const result=await audit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request,
    persistResults:async results=>{persisted=results;return{referenceIds:['44444444-4444-4444-8444-444444444444']};}});
  assert.equal(provider.calls.length,1);
  assert.equal(result.usage_event.status,'COMPLETED');
  assert.equal(result.usage_event.used_units,1);
  assert.equal(result.usage_event.provider_request_id,'tavily-request-1');
  assert.equal(result.usage_event.endpoint,'api.tavily.com/search');
  assert.equal(persisted.length,1);
  assert.deepEqual(result.usage_event.result_payload,{audit:{purpose:'CATEGORY_BUYER_EVIDENCE',result_count:1,
    reference_ids:['44444444-4444-4444-8444-444444444444']}});
  const serialized=JSON.stringify(result.usage_event);
  assert.doesNotMatch(serialized,/site:example\.com|Public result|example\.com\/dresses|tvly-|api.?key/i);
  assert.match(result.usage_event.request_fingerprint,/^[a-f0-9]{64}$/);
});

test('identical Tavily request is replayed without another provider call or charge',async()=>{
  const provider=providerFixture();
  const audit=new TavilyUsageAudit({provider,runCapUnits:3,billingPeriodCapUnits:10});
  let stored=[];const referenceId='44444444-4444-4444-8444-444444444444';
  const callbacks={persistResults:async results=>{stored=results;return{referenceIds:[referenceId]};},
    loadPersistedResults:async({referenceIds})=>referenceIds.includes(referenceId)?stored:[]};
  const first=await audit.search({researchJobId:jobA,companyId,purpose:'DECISION_MAKER_DISCOVERY',request,...callbacks});
  const replay=await audit.search({researchJobId:jobA,companyId,purpose:'DECISION_MAKER_DISCOVERY',request,...callbacks});
  assert.equal(provider.calls.length,1);
  assert.equal(first.usage_event.request_fingerprint,replay.usage_event.request_fingerprint);
  assert.equal(replay.replay,true);
  assert.equal(replay.credits,1);
  assert.equal(replay.result_count,1);
  assert.deepEqual(replay.results,[{title:'Public result',url:'https://example.com/dresses',snippet:'Public page',provider_score:null,rank:1}]);
});

test('an unconfirmed RESERVED call stays retryable and never replays empty evidence',async()=>{
  const provider=providerFixture();
  const budget=new TavilyCreditBudget({runCapUnits:3,dailyCapUnits:3,billingPeriodCapUnits:3});
  await budget.reserve({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',
    endpoint:'api.tavily.com/search',request});
  const audit=new TavilyUsageAudit({provider,budget});
  await assert.rejects(()=>audit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request}),
    error=>error.code==='TAVILY_REQUEST_IN_PROGRESS'&&error.retryable===true);
  assert.equal(provider.calls.length,0);
});

test('a RESERVED call with persisted references recovers as settled without another provider call',async()=>{
  const provider=providerFixture();
  const budget=new TavilyCreditBudget({runCapUnits:3,dailyCapUnits:3,billingPeriodCapUnits:3});
  let reservation=await budget.reserve({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',
    endpoint:'api.tavily.com/search',request});
  reservation=await budget.attachReferences(reservation,{providerRequestId:'confirmed-request',resultCount:1,
    referenceIds:['44444444-4444-4444-8444-444444444444']});
  const replay=await new TavilyUsageAudit({provider,budget}).search({researchJobId:jobA,companyId,
    purpose:'CATEGORY_BUYER_EVIDENCE',request,loadPersistedResults:async()=>[
      {title:'Recovered',url:'https://example.com/dresses',snippet:'',rank:1}]});
  assert.equal(provider.calls.length,0);assert.equal(replay.replay,true);assert.equal(replay.result_count,1);
  assert.equal(replay.results[0].title,'Recovered');
});

test('Tavily per-run and billing-period caps stop new calls before provider usage',async()=>{
  const runProvider=providerFixture();
  const runAudit=new TavilyUsageAudit({provider:runProvider,runCapUnits:1,billingPeriodCapUnits:10});
  await runAudit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request});
  await assert.rejects(()=>runAudit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request:{...request,query:'different query'}}),
    error=>error.code==='TAVILY_CREDIT_CAP');
  assert.equal(runProvider.calls.length,1);

  const billingProvider=providerFixture();
  const budget=new TavilyCreditBudget({runCapUnits:5,billingPeriodCapUnits:1});
  const billingAudit=new TavilyUsageAudit({provider:billingProvider,budget});
  await billingAudit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request});
  await assert.rejects(()=>billingAudit.search({researchJobId:jobB,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request}),
    error=>error.code==='TAVILY_CREDIT_CAP');
  assert.equal(billingProvider.calls.length,1);
});

test('provider-account-only mode bypasses every DPV Tavily cap while retaining usage audit and deduplication',async()=>{
  const provider=providerFixture();
  const audit=new TavilyUsageAudit({provider,internalLimitsEnabled:false,runCapUnits:1,dailyCapUnits:1,
    discoveryDailyCapUnits:0,evidenceDailyCapUnits:0,companyProfileCycleCapUnits:1,billingPeriodCapUnits:1});
  for(let index=0;index<3;index++){
    const result=await audit.search({researchJobId:jobA,companyId,productProfile:'WOMENSWEAR',
      purpose:'CATEGORY_BUYER_EVIDENCE',request:{...request,query:`unlimited query ${index}`}});
    assert.equal(result.usage_event.status,'COMPLETED');
    assert.equal(result.usage_event.credits_after_units,null);
  }
  assert.equal(provider.calls.length,3);
  const replay=await audit.search({researchJobId:jobA,companyId,productProfile:'WOMENSWEAR',
    purpose:'CATEGORY_BUYER_EVIDENCE',request:{...request,query:'unlimited query 2'}});
  assert.equal(replay.replay,true);
  assert.equal(provider.calls.length,3);
});

test('Tavily UTC-day cap is independent from per-run and billing-period headroom',async()=>{
  const provider=providerFixture();
  const budget=new TavilyCreditBudget({runCapUnits:5,dailyCapUnits:1,billingPeriodCapUnits:10,
    now:()=>new Date('2026-09-01T12:00:00Z')});
  const audit=new TavilyUsageAudit({provider,budget});
  await audit.search({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request});
  await assert.rejects(()=>audit.search({researchJobId:jobB,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',request}),
    error=>error.code==='TAVILY_CREDIT_CAP');
  assert.equal(provider.calls.length,1);
});

test('persistent Tavily reservation releases stale RESERVED units before applying caps',async()=>{
  const calls=[];const ledger={provider:'TAVILY',billing_period:'2026-09',credit_limit_units:1,reserved_units:1,used_units:0};
  const client={async query(sql,params){calls.push({sql,params});
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[],rowCount:0};
    if(/INSERT INTO leadgen\.provider_credit_ledger/.test(sql))return{rows:[],rowCount:0};
    if(/SELECT \* FROM leadgen\.provider_credit_ledger[\s\S]*FOR UPDATE/.test(sql))return{rows:[{...ledger}],rowCount:1};
    if(/WITH stale_events/.test(sql))return{rows:[{reserved_units:1}],rowCount:1};
    if(/SET reserved_units=greatest\(0,reserved_units-\$3\)/.test(sql)){ledger.reserved_units=0;return{rows:[],rowCount:1};}
    if(/request_fingerprint=\$2 FOR UPDATE/.test(sql))return{rows:[],rowCount:0};
    if(/research_job_id=\$1 AND provider=\$2/.test(sql))return{rows:[{total:0}],rowCount:1};
    if(/date_trunc\('day'/.test(sql))return{rows:[{total:0}],rowCount:1};
    if(/SELECT \* FROM leadgen\.provider_credit_ledger/.test(sql))return{rows:[{...ledger}],rowCount:1};
    if(/SET reserved_units=reserved_units\+\$3/.test(sql)){ledger.reserved_units=1;return{rows:[],rowCount:1};}
    if(/INSERT INTO leadgen\.provider_usage_events/.test(sql))return{rows:[{id:'usage-1',research_job_id:jobA,company_id:companyId,provider:'TAVILY',billing_period:'2026-09',endpoint:'api.tavily.com/search',request_fingerprint:'a'.repeat(64),status:'RESERVED',reserved_units:1,used_units:0,result_payload:{audit:{purpose:'CATEGORY_BUYER_EVIDENCE'}}}],rowCount:1};
    throw new Error(`Unexpected SQL: ${sql}`);
  },release(){}};
  const pool={async connect(){return client;}};
  const budget=new TavilyCreditBudget({pool,runCapUnits:1,dailyCapUnits:1,billingPeriodCapUnits:1,
    now:()=>new Date('2026-09-01T12:00:00Z')});
  const reserved=await budget.reserve({researchJobId:jobA,companyId,purpose:'CATEGORY_BUYER_EVIDENCE',endpoint:'api.tavily.com/search',request});
  assert.equal(reserved.status,'RESERVED');
  assert.ok(calls.some(item=>/STALE_RESERVATION_RELEASED/.test(item.sql)));
  assert.ok(calls.some(item=>/reserved_units=greatest/.test(item.sql)));
});

test('persistent Tavily ledger uses the stricter stored or environment billing limit',async()=>{
  const fixture=({limit,used=0})=>{const calls=[];const state={provider:'TAVILY',billing_period:'2026-09',credit_limit_units:limit,reserved_units:0,used_units:used};
    const client={async query(sql,params){calls.push({sql,params});
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:0};
      if(/INSERT INTO leadgen\.provider_credit_ledger/.test(sql))return{rows:[],rowCount:0};
      if(/FOR UPDATE/.test(sql)&&/provider_credit_ledger/.test(sql))return{rows:[{...state}],rowCount:1};
      if(/SET credit_limit_units=\$3/.test(sql)){state.credit_limit_units=params[2];return{rows:[],rowCount:1};}
      if(/WITH stale_events/.test(sql))return{rows:[],rowCount:0};
      if(/request_fingerprint=\$2 FOR UPDATE/.test(sql))return{rows:[],rowCount:0};
      if(/research_job_id=\$1 AND provider=\$2/.test(sql))return{rows:[{total:0}],rowCount:1};
      if(/date_trunc\('day'/.test(sql))return{rows:[{total:0}],rowCount:1};
      if(/reserved_units=reserved_units\+\$3/.test(sql)){state.reserved_units+=params[2];return{rows:[],rowCount:1};}
      if(/INSERT INTO leadgen\.provider_usage_events/.test(sql))return{rows:[{id:'usage-tight',status:'RESERVED',reserved_units:1,result_payload:{audit:{purpose:'TEST'}}}],rowCount:1};
      throw new Error(`Unexpected SQL: ${sql}`);},release(){}};return{pool:{async connect(){return client;}},calls,state};};
  const lowered=fixture({limit:100});
  await new TavilyCreditBudget({pool:lowered.pool,runCapUnits:20,dailyCapUnits:20,billingPeriodCapUnits:10})
    .reserve({researchJobId:jobA,companyId,purpose:'TEST',endpoint:'api.tavily.com/search',request});
  assert.equal(lowered.state.credit_limit_units,10);
  assert.ok(lowered.calls.some(item=>/SET credit_limit_units/.test(item.sql)&&item.params[2]===10));

  const cannotRaise=fixture({limit:10,used:10});
  await assert.rejects(()=>new TavilyCreditBudget({pool:cannotRaise.pool,runCapUnits:200,dailyCapUnits:200,billingPeriodCapUnits:100})
    .reserve({researchJobId:jobB,companyId,purpose:'TEST',endpoint:'api.tavily.com/search',request}),
  error=>error.code==='TAVILY_CREDIT_CAP');
  assert.equal(cannotRaise.state.credit_limit_units,10);
});

test('Tavily provider errors are settled with zero credits and a sanitized status',async()=>{
  const provider=providerFixture({failure:{code:'TIMEOUT'}});
  const audit=new TavilyUsageAudit({provider,runCapUnits:2,billingPeriodCapUnits:2});
  let caught;
  try{await audit.search({researchJobId:jobA,companyId,purpose:'DECISION_MAKER_DISCOVERY',request});}catch(error){caught=error;}
  assert.equal(caught.code,'TIMEOUT');
  assert.equal(caught.usage_event.status,'TEMPORARY_ERROR');
  assert.equal(caught.usage_event.used_units,0);
  assert.equal(caught.usage_event.error_code,'TIMEOUT');
  assert.deepEqual(caught.usage_event.result_payload,{audit:{purpose:'DECISION_MAKER_DISCOVERY',result_count:0,reference_ids:[]}});
});

test('Tavily TEMPORARY_ERROR retries the provider instead of replaying empty results',async()=>{
  let calls=0;const provider={name:'tavily',endpoint:'https://api.tavily.com/search',async search(){calls+=1;
    if(calls===1)throw Object.assign(new Error('timeout'),{code:'TIMEOUT'});
    return{provider:'tavily',requestId:'retry-ok',credits:1,results:[]};}};
  const audit=new TavilyUsageAudit({provider,runCapUnits:2,dailyCapUnits:2,billingPeriodCapUnits:2});
  await assert.rejects(()=>audit.search({researchJobId:jobA,companyId,purpose:'DECISION_MAKER_DISCOVERY',request}),
    error=>error.code==='TIMEOUT');
  const retried=await audit.search({researchJobId:jobA,companyId,purpose:'DECISION_MAKER_DISCOVERY',request});
  assert.equal(calls,2);assert.equal(retried.replay,undefined);assert.equal(retried.usage_event.status,'NOT_FOUND');
});

test('non-Tavily providers remain behavior-compatible and do not enter Tavily accounting',async()=>{
  let calls=0;
  const provider={name:'fixture',async search(){calls+=1;return{provider:'fixture',results:[]};}};
  const budget={async reserve(){throw new Error('unexpected reservation');}};
  const result=await new TavilyUsageAudit({provider,budget}).search({researchJobId:jobA,companyId,purpose:'TEST',request});
  assert.equal(calls,1);assert.equal(result.provider,'fixture');
});

test('automatic Tavily-off category collection skips search and still completes existing official-site path',async()=>{
  const provider=providerFixture();
  const pool={
    async query(sql){
      if(/SELECT id,company_name/.test(sql))return{rowCount:1,rows:[{id:companyId,company_name:'Example',country_code:'AE',country_name:'United Arab Emirates',website_url:null,official_root_domain:null,normalized_domain:null}]};
      if(/company_verification_evidence/.test(sql))return{rowCount:0,rows:[]};
      if(/SELECT \(SELECT count\(\*\)::int FROM leadgen\.prospect_category_sources/.test(sql))return{rowCount:1,rows:[{sources:0,observations:0}]};
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const service=new CategoryEvidenceService({pool,provider,checker:{}});
  const result=await service.collect({researchJobId:jobA,companyId,productProfile:'WOMENSWEAR',tavilyEnabled:false});
  assert.equal(result.search_skipped,true);assert.equal(result.queries,0);assert.equal(provider.calls.length,0);
});

test('automatic category collection reuses fresh verified source observations within TTL',async()=>{
  const provider=providerFixture();let queries=0;
  const pool={async query(sql){queries+=1;
    if(/SELECT id,company_name/.test(sql))return{rowCount:1,rows:[{id:companyId,company_name:'Example',country_code:'AE',country_name:'United Arab Emirates',website_url:'https://example.com',official_root_domain:'example.com',normalized_domain:'example.com'}]};
    if(/WITH eligible AS/.test(sql))return{rowCount:1,rows:[{research_job_id:jobB,source_id:'44444444-4444-4444-8444-444444444444',observation_id:'55555555-5555-4555-8555-555555555555',sources:2,observations:3}]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const service=new CategoryEvidenceService({pool,provider,checker:{robotsAllows(){throw new Error('crawler must not run');}}});
  const result=await service.collect({researchJobId:jobA,companyId,productProfile:'WOMENSWEAR',
    reuseFreshEvidence:true,sourceTtlDays:30});
  assert.equal(result.reused_fresh_evidence,true);assert.equal(result.reused_research_job_id,jobB);
  assert.equal(result.sources,2);assert.equal(result.observations,3);assert.equal(provider.calls.length,0);assert.equal(queries,2);
});

test('automatic enrichment policies skip Tavily and Hunter while manual defaults stay enabled',async()=>{
  const provider=providerFixture();
  const service=new EnrichmentService({pool:{},provider,checker:{},hunter:{capabilities:{enabled:true}},linkedIn:{}});
  const skipped=await service.runSearchQueries({id:jobA},{id:companyId},{tavilyEnabled:false});
  assert.deepEqual(skipped,{queries:0,results:[],failures:0,search_skipped:true});
  const hunter=await service.applyHunter({}, {}, {decision_makers:[]},{hunterEnabled:false});
  assert.deepEqual(hunter,{calls:0,used_units:0,mode:'AUTO_EVIDENCE_POLICY_DISABLED'});
});

test('auto-evidence executors pass Tavily and Hunter policy flags only to automatic service calls',async()=>{
  const seen={};
  const pool={async query(sql){
    if(/prospect_category_sources/.test(sql))return{rows:[{}],rowCount:1};
    if(/category_procurement_match_results/.test(sql))return{rows:[{id:'match',match_status:'CATEGORY_PROCUREMENT_MATCH'}],rowCount:1};
    return{rows:[],rowCount:1};
  }};
  const executors=createAutoEvidenceExecutors({pool,tavilyEnabled:false,hunterEnabled:false,sourceTtlDays:45,
    categoryEvidenceService:{async collect(input){seen.category=input;return{search_failures:0,sources:1};}},
    categoryProcurementService:{},
    enrichmentService:{async runJob(_id,policy){seen.enrichment=policy;return{status:'COMPLETE'};}},
    phase7Repository:{}});
  const task={company_id:companyId,product_profile:'WOMENSWEAR'};
  await executors.discover_opportunity_evidence({task,research_job_id:jobA});
  await executors.find_profile_buyer({task,research_job_id:jobB});
  assert.equal(seen.category.tavilyEnabled,false);
  assert.equal(seen.category.reuseFreshEvidence,true);
  assert.equal(seen.category.sourceTtlDays,45);
  assert.deepEqual(seen.enrichment,{tavilyEnabled:false,hunterEnabled:false});
});

test('automatic category evidence converts Tavily cap exhaustion into BUDGET_PAUSED',async()=>{
  const updates=[];
  const pool={async query(sql,params){updates.push({sql,params});return{rows:[{}],rowCount:1};}};
  const executors=createAutoEvidenceExecutors({pool,
    categoryEvidenceService:{async collect(){throw Object.assign(new Error('cap'),{code:'TAVILY_CREDIT_CAP'});}},
    categoryProcurementService:{},enrichmentService:{},phase7Repository:{}});
  const result=await executors.discover_opportunity_evidence({task:{company_id:companyId,product_profile:'WOMENSWEAR'},research_job_id:jobA});
  assert.equal(result.outcome_status,'BUDGET_PAUSED');
  assert.equal(result.technical_blocker,'TAVILY_CREDIT_CAP');
  assert.ok(updates.some(item=>item.params?.includes('PARTIAL')));
});

test('category and enrichment services propagate in-progress provider work instead of exhausting evidence',async()=>{
  const inProgress=()=>{throw Object.assign(new Error('in progress'),{code:'TAVILY_REQUEST_IN_PROGRESS',retryable:true});};
  const categoryPool={async query(sql){
    if(/SELECT id,company_name/.test(sql))return{rowCount:1,rows:[{id:companyId,company_name:'Example',country_code:'AE',country_name:'United Arab Emirates',website_url:null,official_root_domain:null,normalized_domain:null}]};
    if(/company_verification_evidence/.test(sql))return{rowCount:0,rows:[]};
    if(/INSERT INTO leadgen\.research_search_queries/.test(sql))return{rowCount:1,rows:[{id:'query-1'}]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const category=new CategoryEvidenceService({pool:categoryPool,provider:{name:'tavily'},searchAudit:{search:inProgress},checker:{},maxQueriesPerProfile:1,maxQueriesPerCompany:1});
  await assert.rejects(()=>category.collect({researchJobId:jobA,companyId,productProfile:'WOMENSWEAR'}),
    error=>error.code==='TAVILY_REQUEST_IN_PROGRESS');

  const enrichmentPool={async query(sql){
    if(/INSERT INTO leadgen\.research_search_queries/.test(sql))return{rowCount:1,rows:[{id:'query-2',query_text:'buyer query',query_type:'decision_maker_role'}]};
    if(/SET status='RUNNING'/.test(sql))return{rowCount:1,rows:[]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const enrichment=new EnrichmentService({pool:enrichmentPool,provider:{name:'tavily'},searchAudit:{search:inProgress},
    checker:{},hunter:{capabilities:{enabled:false}},linkedIn:{},maxQueriesPerCompany:1});
  await assert.rejects(()=>enrichment.runSearchQueries({id:jobA},{id:companyId,company_name:'Example',country_code:'AE',country_name:'United Arab Emirates',active_product_profiles:['WOMENSWEAR']}),
    error=>error.code==='TAVILY_REQUEST_IN_PROGRESS');
});
