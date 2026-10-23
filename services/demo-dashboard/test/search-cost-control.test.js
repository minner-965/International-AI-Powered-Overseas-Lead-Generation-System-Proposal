import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchCostControl,loadSearchCostConfig,billingPeriod} from '../src/search/SearchCostControl.js';
import {ResearchBatchService} from '../src/researchBatch/ResearchBatchService.js';
import {SearchPlanService} from '../src/searchPlanning/SearchPlanService.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';

const category='10000000-0000-4000-8000-000000000001';
const buyers=['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'];
const catalog=()=>({markets:[
  {market_code:'AE',country_name:'United Arab Emirates',status:'ACTIVE',search_enabled:true,market_profile:'AE',languages:['en'],buyer_types:buyers},
  {market_code:'DE',country_name:'Germany',status:'ACTIVE',search_enabled:true,market_profile:'DE',languages:['de'],buyer_types:buyers}
],categories:[{id:category,scope_revision_id:'20000000-0000-4000-8000-000000000001',category_code:'TOPS',product_profile:'WOMENSWEAR',
  scope_status:'ACTIVE',approval_status:'APPROVED',approved_aliases:[],parent_category:null}]});
// A pool double answering only the two cost-control reads.
const spendPool=({cost=0,queries=0,reusable=0}={})=>({query:async sql=>/recorded_cost_usd/.test(sql)
  ?{rows:[{recorded_queries:queries,recorded_cost_usd:cost}]}:/reusable/.test(sql)?{rows:[{reusable}]}:{rows:[]}});

test('cost configuration defaults and environment overrides are explicit estimates',()=>{
  const defaults=loadSearchCostConfig({});
  assert.deepEqual(defaults.unitPrices,{SEARXNG:0,EXA:0.007,TAVILY:0.008});
  assert.equal(defaults.maxQueriesPerBatch,300);assert.equal(defaults.maxUsdPerMonth,30);assert.equal(defaults.reuseDays,30);
  const custom=loadSearchCostConfig({SEARCH_COST_USD_PER_QUERY_EXA:'0.01',SEARCH_COST_USD_PER_QUERY_BRAVE:'0.005',
    SEARCH_MAX_QUERIES_PER_BATCH:'50',SEARCH_MAX_USD_PER_MONTH:'5',SEARCH_REUSE_DAYS:'0',SEARCH_COST_USD_PER_QUERY_TAVILY:'bad'});
  assert.deepEqual(custom.unitPrices,{SEARXNG:0,EXA:0.01,TAVILY:0.008,BRAVE:0.005});
  assert.equal(custom.maxQueriesPerBatch,50);assert.equal(custom.maxUsdPerMonth,5);assert.equal(custom.reuseDays,0);
  assert.equal(billingPeriod(new Date('2026-10-31T23:59:59Z')),'2026-10');
});

test('estimate uses the most expensive provider in the execution order and subtracts reusable queries',async()=>{
  const control=new SearchCostControl({pool:spendPool({cost:1.5,queries:200,reusable:4}),providerOrder:async()=>['exa','tavily']});
  const estimate=await control.estimate({summary:{planned_query_count:14},queries:Array.from({length:14},(_,i)=>({normalized_query:`q${i}`,market_id:'AE',language:'en'}))});
  assert.equal(estimate.estimated_queries,14);assert.equal(estimate.estimated_reused_queries,4);
  assert.equal(estimate.estimated_unit_price_usd,0.008);assert.equal(estimate.estimated_cost_usd,0.08);
  assert.equal(estimate.month_to_date_cost_usd,1.5);assert.equal(estimate.remaining_month_usd,28.5);
  assert.equal(estimate.cost_basis,'CONFIGURED_ESTIMATE');
  const exaOnly=new SearchCostControl({pool:spendPool(),providerOrder:async()=>['exa']});
  assert.equal((await exaOnly.estimate({summary:{planned_query_count:100},queries:[]})).estimated_cost_usd,0.7);
});

test('creation guard refuses empty plans, the per-batch cap and the monthly budget with distinct codes',()=>{
  const control=new SearchCostControl({config:loadSearchCostConfig({SEARCH_MAX_QUERIES_PER_BATCH:'20',SEARCH_MAX_USD_PER_MONTH:'1'})});
  const base={estimated_queries:10,estimated_cost_usd:0.08,month_to_date_cost_usd:0};
  assert.equal(control.assertCreatable(base),base);
  assert.throws(()=>control.assertCreatable({...base,estimated_queries:0}),{code:'SEARCH_PLAN_EMPTY',status:422});
  assert.throws(()=>control.assertCreatable({...base,estimated_queries:21}),{code:'SEARCH_BATCH_QUERY_CAP_EXCEEDED',status:409});
  assert.throws(()=>control.assertCreatable({...base,month_to_date_cost_usd:0.95}),{code:'SEARCH_MONTHLY_BUDGET_EXCEEDED',status:409});
});

test('execution guard allows a paid call only while month-to-date spend stays within the cap',async()=>{
  const control=new SearchCostControl({pool:spendPool({cost:29.995}),config:loadSearchCostConfig({})});
  assert.equal((await control.canSpend('exa')).allowed,false);
  const fresh=new SearchCostControl({pool:spendPool({cost:29.99}),config:loadSearchCostConfig({})});
  assert.equal((await fresh.canSpend('exa')).allowed,true);
});

test('batch preview returns estimated queries/cost, plans German markets and flags a refused creation',async()=>{
  const service=new ResearchBatchService({pool:spendPool({cost:29.99}),planning:new SearchPlanService({pool:null}),
    costControl:new SearchCostControl({pool:null,config:loadSearchCostConfig({})})});
  service.options=async()=>catalog();
  const preview=await service.preview({market_codes:['AE','DE'],category_scope_ids:[category]});
  assert.ok(preview.estimated_queries>0);
  assert.equal(preview.estimated_queries,preview.search_plan.summary.planned_query_count);
  assert.equal(typeof preview.estimated_cost_usd,'number');
  assert.ok(preview.search_plan.summary.languages.includes('de'));
  assert.equal(preview.creation_allowed,false);assert.equal(preview.creation_blocked_code,'SEARCH_MONTHLY_BUDGET_EXCEEDED');
  const ok=new ResearchBatchService({pool:spendPool(),planning:new SearchPlanService({pool:null}),
    costControl:new SearchCostControl({pool:null,config:loadSearchCostConfig({})})});
  ok.options=async()=>catalog();
  const allowed=await ok.preview({market_codes:['AE'],category_scope_ids:[category]});
  assert.equal(allowed.creation_allowed,true);assert.equal(allowed.estimated_cost_usd,Number((allowed.estimated_queries*0.008).toFixed(4)));
});

test('batch preview reports SEARCH_PLAN_EMPTY when no buyer type matches any strategy',async()=>{
  const service=new ResearchBatchService({pool:spendPool(),planning:new SearchPlanService({pool:null}),
    costControl:new SearchCostControl({pool:null,config:loadSearchCostConfig({})})});
  const empty=catalog();empty.markets[0].buyer_types=['Supermarket'];
  // Supermarket matches retail strategies; remove all strategies from the planner config instead.
  service.planning.config.strategies.strategies=[];
  service.options=async()=>empty;
  const preview=await service.preview({market_codes:['AE'],category_scope_ids:[category]});
  assert.equal(preview.estimated_queries,0);assert.equal(preview.creation_blocked_code,'SEARCH_PLAN_EMPTY');
});

function executorFixture({reusable=null,allowed=true,queries=[{fingerprint:'q'}]}={}){
  const calls={provider:0,reuse:0,claim:0};
  const store={load:async()=>({id:'plan',plan:{queries}}),lookup:async()=>null,
    findReusable:async()=>reusable,reuse:async()=>{calls.reuse++;return{execution_id:'e'};},
    claim:async()=>{calls.claim++;return{id:'x',request_snapshot:{query:'fixture'}};},recordResponse:async()=>{},
    persist:async()=>[],results:async()=>[],attachUsage:async()=>{},fail:async()=>{}};
  const router={select:async()=>({provider:'exa'}),provider:()=>({name:'exa',endpoint:'https://fixture.invalid/search',
    search:async()=>{calls.provider++;return{results:[{url:'https://fixture.invalid'}]};}})};
  const costControl={config:{reuseDays:30},canSpend:async()=>({allowed})};
  return {executor:new FrozenSearchPlanExecutor({store,router,costControl}),calls};
}

test('executor reuses a recent identical query instead of calling the provider',async()=>{
  const f=executorFixture({reusable:{id:'source'}});
  const result=await f.executor.executeJob('job');
  assert.equal(result.status,'COMPLETED');assert.equal(result.reused_queries,1);
  assert.deepEqual(f.calls,{provider:0,reuse:1,claim:0});
});

test('executor pauses queued work at the monthly cap before any paid call',async()=>{
  const f=executorFixture({allowed:false});
  const result=await f.executor.executeJob('job');
  assert.equal(result.paused,true);assert.equal(result.status,'PAUSED_SEARCH_MONTHLY_BUDGET');
  assert.deepEqual(f.calls,{provider:0,reuse:0,claim:0});
});

test('executor fails visibly on a frozen plan with zero queries',async()=>{
  const f=executorFixture({queries:[]});
  await assert.rejects(f.executor.executeJob('job'),{code:'SEARCH_PLAN_EMPTY',retryable:false});
});

test('freezing an empty plan is refused',async()=>{
  const planning=new SearchPlanService({pool:null});planning.config.strategies.strategies=[];
  const client={query:async()=>({rowCount:0,rows:[]})};
  const scope={market_code:'AE',country_name:'United Arab Emirates',category_scope_id:category,category_code:'TOPS',languages:['en'],buyer_types:buyers};
  await assert.rejects(planning.store(client,{jobId:'job',snapshot:{version:1,scopes:[scope]}}),{code:'SEARCH_PLAN_EMPTY'});
});
