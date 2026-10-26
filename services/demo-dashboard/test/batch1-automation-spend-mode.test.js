import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SearxngSearchProvider,SearxngProviderAccountState} from '../src/search/SearxngSearchProvider.js';
import {CurrentCapacityRouter,selectCurrentCapacityProvider} from '../src/search/CurrentCapacityRouter.js';
import {SearchCostControl,loadSearchCostConfig} from '../src/search/SearchCostControl.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';
import {SearchUsageAudit} from '../src/search/SearchUsageAudit.js';
import {SearchProviderRouter} from '../src/search/SearchProviderRouter.js';
import {RoutedSearchClient} from '../src/search/RoutedSearchClient.js';
import {isPaidProvider,normalizeSpendMode,parseSpendModeInput,spendPolicyFromSettings} from '../src/search/ProviderSpendPolicy.js';
import {EnrichmentService} from '../src/enrichment/EnrichmentService.js';
import {CategoryEvidenceService} from '../src/categoryProcurement/CategoryEvidenceService.js';

// Zero live calls: SearXNG answers come from an in-process fetch double; paid providers are
// call-counting doubles that fail the test when the spend policy should have blocked them.
const json=(status,body)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>body});
const unitPrices=loadSearchCostConfig({}).unitPrices;
const config={searxngEnabled:true,searxngBaseUrl:'http://searxng.test:8080',exaEnabled:true,exaApiKey:'fixture',tavilyApiKey:'fixture',braveApiKey:'fixture',storageRightsConfirmed:true};
const order=['searxng','exa','tavily','brave'];

function world({searxng,policy}){
  const calls=[];
  const searxngState=new SearxngProviderAccountState();
  const providers={
    searxng:new SearxngSearchProvider({baseUrl:config.searxngBaseUrl,fetchImpl:async()=>{calls.push('searxng');return searxng();}}),
    exa:{name:'exa',endpoint:'https://exa.invalid/search',search:async()=>{calls.push('exa');return{results:[{url:'https://buyer.example',title:'B'}],credits:1};}},
    tavily:{name:'tavily',endpoint:'https://tavily.invalid/search',search:async()=>{calls.push('tavily');return{results:[{url:'https://buyer.example',title:'B'}],credits:1};}},
    brave:{name:'brave',endpoint:'https://brave.invalid/search',search:async()=>{calls.push('brave');return{results:[{url:'https://buyer.example',title:'B'}]};}}
  };
  const current={...policy};
  const router=new CurrentCapacityRouter({config,getOrder:async()=>order,unitPrices,getSpendPolicy:async()=>current,
    getStates:async()=>({searxng:await searxngState.getState(),exa:{status:'AVAILABLE'},tavily:{status:'AVAILABLE'},brave:{status:'AVAILABLE'}})});
  router.provider=selection=>providers[selection.provider];
  const costControl=new SearchCostControl({config:loadSearchCostConfig({}),providerOrder:async()=>order,spendPolicy:async()=>current});
  return {calls,router,costControl,searxngState,policy:current};
}

function executorFor(w){
  const persisted=[];
  const store={load:async()=>({research_job_id:'job',plan:{queries:[{fingerprint:'q1'}]}}),lookup:async()=>null,
    claim:async(_p,_q,selection)=>({id:`${selection.provider}-exec`,provider:selection.provider,request_snapshot:{query:'womenswear importer',country:'AE',searchLang:'en',count:10}}),
    recordResponse:async()=>{},persist:async(_p,_q,execution,response)=>{persisted.push([execution.provider,(response.results||[]).length]);return[];},
    results:async()=>[],attachUsage:async()=>{},fail:async()=>{}};
  const executor=new FrozenSearchPlanExecutor({store,router:w.router,costControl:w.costControl,accountStates:{searxng:w.searxngState},
    auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  return {executor,persisted};
}
const blocked=()=>json(200,{results:[],unresponsive_engines:[['google','CAPTCHA'],['bing','Suspended: access denied']]});
const empty=()=>json(200,{results:[],unresponsive_engines:[]});
const found=()=>json(200,{results:[{url:'https://buyer.example',title:'Buyer',content:'importer'}]});

test('spend policy values: FREE_ONLY aliases NO_NEW_PAID_SPEND, unknown stored values fail closed, paid = price above zero',()=>{
  assert.equal(normalizeSpendMode('NO_NEW_PAID_SPEND'),'FREE_ONLY');assert.equal(normalizeSpendMode(undefined),'FREE_ONLY');
  assert.equal(normalizeSpendMode('whatever'),'FREE_ONLY');assert.equal(normalizeSpendMode('allow_paid'),'ALLOW_PAID');
  assert.equal(parseSpendModeInput('NO_NEW_PAID_SPEND'),'FREE_ONLY');assert.throws(()=>parseSpendModeInput('MAYBE'),{code:'PROVIDER_SPEND_MODE_INVALID'});
  assert.deepEqual(spendPolicyFromSettings({}),{provider_spend_mode:'FREE_ONLY',paid_fallback_on_empty:false});
  for(const provider of ['exa','tavily','brave','dataforseo'])assert.equal(isPaidProvider(provider,unitPrices),true,provider);
  assert.equal(isPaidProvider('searxng',unitPrices),false);assert.equal(isPaidProvider('searxng',{}),false);
});

test('router: FREE_ONLY treats every priced provider as not permitted',()=>{
  const states={searxng:{status:'RATE_LIMITED'},exa:{status:'AVAILABLE'},tavily:{status:'AVAILABLE'},brave:{status:'AVAILABLE'}};
  const paused=selectCurrentCapacityProvider({order,config,states,paidBlocked:'FREE_ONLY',unitPrices});
  assert.equal(paused.provider,null);assert.equal(paused.reason,'PAUSED_FREE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(paused.skipped.filter(row=>row.reason==='NOT_PERMITTED_FREE_ONLY').map(row=>row.provider),['exa','tavily','brave']);
  assert.equal(selectCurrentCapacityProvider({order,config,states:{...states,searxng:{status:'AVAILABLE'}},paidBlocked:'FREE_ONLY',unitPrices}).provider,'searxng');
  // Without a policy the legacy order (paid fallback) is unchanged.
  assert.equal(selectCurrentCapacityProvider({order,config,states,unitPrices}).provider,'exa');
});

test('FREE_ONLY: a CAPTCHA-blocked SearXNG pauses the job (resumable) and never calls a paid provider',async()=>{
  const w=world({searxng:blocked,policy:{provider_spend_mode:'FREE_ONLY'}});
  const {executor}=executorFor(w);
  const result=await executor.executeJob('job');
  assert.equal(result.paused,true);assert.equal(result.status,'PAUSED_FREE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(w.calls,['searxng']);
  // While SearXNG cools down the next attempt pauses again without calling anyone.
  assert.equal((await executor.executeJob('job')).status,'PAUSED_FREE_PROVIDER_UNAVAILABLE');assert.deepEqual(w.calls,['searxng']);
  // Resume: once SearXNG answers again the same job completes on the free provider.
  const resumed=world({searxng:found,policy:{provider_spend_mode:'FREE_ONLY'}});
  const second=executorFor(resumed);
  assert.equal((await second.executor.executeJob('job')).status,'COMPLETED');
  assert.deepEqual(resumed.calls,['searxng']);assert.deepEqual(second.persisted,[['searxng',1]]);
});

test('FREE_ONLY: an empty SearXNG page is recorded as no result, never retried on a paid provider',async()=>{
  const w=world({searxng:empty,policy:{provider_spend_mode:'FREE_ONLY',paid_fallback_on_empty:true}});
  const {executor,persisted}=executorFor(w);
  assert.equal((await executor.executeJob('job')).status,'COMPLETED');
  assert.deepEqual(w.calls,['searxng']);assert.deepEqual(persisted,[['searxng',0]]);
});

test('ALLOW_PAID: failures fall back to paid; an empty free page reaches paid only with paid_fallback_on_empty',async()=>{
  const down=world({searxng:blocked,policy:{provider_spend_mode:'ALLOW_PAID'}});
  assert.equal((await executorFor(down).executor.executeJob('job')).status,'COMPLETED');assert.deepEqual(down.calls,['searxng','exa']);
  const keep=world({searxng:empty,policy:{provider_spend_mode:'ALLOW_PAID',paid_fallback_on_empty:false}});
  assert.equal((await executorFor(keep).executor.executeJob('job')).status,'COMPLETED');assert.deepEqual(keep.calls,['searxng']);
  const fallback=world({searxng:empty,policy:{provider_spend_mode:'ALLOW_PAID',paid_fallback_on_empty:true}});
  assert.equal((await executorFor(fallback).executor.executeJob('job')).status,'COMPLETED');assert.deepEqual(fallback.calls,['searxng','exa']);
});

test('cost guard: FREE_ONLY refuses paid queries and estimates zero cost',async()=>{
  const w=world({searxng:found,policy:{provider_spend_mode:'FREE_ONLY'}});
  const paid=await w.costControl.canSpend('tavily');
  assert.equal(paid.allowed,false);assert.equal(paid.reason,'FREE_ONLY');
  assert.equal((await w.costControl.canSpend('searxng')).allowed,true);
  assert.equal(await w.costControl.estimateUnitPrice(),0);
  // A paid provider that slips past the router still cannot run in FREE_ONLY.
  const leaky={select:async()=>({provider:'tavily',reason:'EXPLICIT_ORDER_FIRST_AVAILABLE'}),provider:()=>({name:'tavily',endpoint:'https://t.invalid/s',search:async()=>{throw new Error('must not call');}})};
  const executor=new FrozenSearchPlanExecutor({store:{load:async()=>({plan:{queries:[{}]}}),lookup:async()=>null},router:leaky,costControl:w.costControl});
  assert.equal((await executor.executeJob('job')).status,'PAUSED_FREE_PROVIDER_UNAVAILABLE');
  w.policy.provider_spend_mode='ALLOW_PAID';
  assert.equal((await w.costControl.canSpend('tavily')).allowed,true);
  assert.ok(await w.costControl.estimateUnitPrice()>0);
});

test('batch creation check follows the provider order and spend policy, not the single SEARCH_PROVIDER account',async()=>{
  const ok=world({searxng:found,policy:{provider_spend_mode:'FREE_ONLY'}});
  const router=new SearchProviderRouter({config:{...config,provider:'tavily'},tavilyAccountState:{ensureCanCreate:async()=>{throw Object.assign(new Error('x'),{code:'TAVILY_ACCOUNT_CREDITS_EXHAUSTED'});}},capacityRouter:ok.router});
  assert.equal((await router.ensureCanCreate('COMPANY_DISCOVERY')).provider_code,'SEARXNG');
  const down=world({searxng:blocked,policy:{provider_spend_mode:'FREE_ONLY'}});
  await down.searxngState.observeSearchError({code:'RATE_LIMITED_CAPTCHA',retryAfterSeconds:600});
  const blockedRouter=new SearchProviderRouter({config,capacityRouter:down.router});
  await assert.rejects(blockedRouter.ensureCanCreate('COMPANY_DISCOVERY'),{code:'FREE_SEARCH_PROVIDER_UNAVAILABLE',status:503});
});

test('routed client (contact research, category evidence): FREE_ONLY pauses instead of calling Tavily',async()=>{
  const w=world({searxng:blocked,policy:{provider_spend_mode:'FREE_ONLY'}});
  const client=new RoutedSearchClient({router:w.router,costControl:w.costControl,accountStates:{searxng:w.searxngState},
    auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  const request={researchJobId:'job',companyId:'c1',purpose:'DECISION_MAKER_DISCOVERY',request:{query:'"Buyer LLC" buyer',count:5,country:'AE'}};
  await assert.rejects(client.search(request),error=>error.searchPause===true&&error.code==='PAUSED_FREE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(w.calls,['searxng']);
  const ok=world({searxng:found,policy:{provider_spend_mode:'FREE_ONLY'}});
  const okClient=new RoutedSearchClient({router:ok.router,costControl:ok.costControl,auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  const response=await okClient.search(request);
  assert.equal(response.provider,'searxng');assert.equal(response.results.length,1);
  // ALLOW_PAID with Tavily disabled by the caller: Tavily is skipped, Exa answers.
  const paid=world({searxng:blocked,policy:{provider_spend_mode:'ALLOW_PAID'}});
  const paidClient=new RoutedSearchClient({router:paid.router,costControl:paid.costControl,auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  assert.equal((await paidClient.search({...request,excludeProviders:['exa']})).provider,'tavily');
  assert.equal((await paidClient.search({...request,companyId:'c2',excludeProviders:['tavily']})).provider,'exa');
});

test('contact research enrichment stops the company on a search pause: no page crawl and no Hunter call',async()=>{
  const w=world({searxng:blocked,policy:{provider_spend_mode:'FREE_ONLY'}});
  const client=new RoutedSearchClient({router:w.router,costControl:w.costControl,auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  const statements=[];
  const pool={query:async(sql,args)=>{statements.push([sql,args]);return{rows:[{id:'query-1',query_text:args?.[2]||'q',query_type:'auto_evidence_strategy'}],rowCount:1};}};
  const hunter={calls:0,verify:async()=>{hunter.calls++;throw new Error('Hunter must not be called');}};
  const checker={fetchPage:async()=>{throw new Error('no crawl');},robotsAllows:async()=>{throw new Error('no crawl');}};
  const service=new EnrichmentService({pool,searchClient:client,hunter,checker});
  assert.equal(service.provider.name,'search_router');assert.equal(service.searchAudit,client);
  const company={id:'c1',company_name:'Buyer LLC',country_code:'AE',country_name:'United Arab Emirates',active_product_profiles:['WOMENSWEAR']};
  const result=await service.enrichCompany({id:'job'},company,{strategy:{query_text:'"Buyer LLC" buyer'}});
  assert.equal(result.status,'PARTIAL');assert.equal(result.stop_reason,'PAUSED_FREE_PROVIDER_UNAVAILABLE');
  assert.equal(hunter.calls,0);assert.deepEqual(w.calls,['searxng']);
  assert.ok(statements.some(([sql,args])=>/SET status='PENDING'/.test(sql)&&args[1]==='PAUSED_FREE_PROVIDER_UNAVAILABLE'));
  assert.ok(statements.some(([sql,args])=>/attempt_status='PARTIAL'/.test(sql)&&args.includes('PAUSED_FREE_PROVIDER_UNAVAILABLE')));
  // Category evidence takes the same routed client.
  const evidence=new CategoryEvidenceService({pool,searchClient:client,checker,aliasRefresher:{refresh:async()=>{}}});
  assert.equal(evidence.searchAudit,client);assert.equal(evidence.provider.name,'search_router');
});

test('server wires the routed client, spend policy and lower Hunter defaults',()=>{
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(server,/MAX_HUNTER_CREDITS_PER_RUN_UNITS \|\| 5\)/);
  assert.match(server,/MAX_HUNTER_CREDITS_PER_DAY_UNITS \|\| 50\)/);
  assert.match(server,/MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS \|\| 100\)/);
  assert.doesNotMatch(server,/MAX_HUNTER_CREDITS_PER_[A-Z_]+\s*\|\|\s*20000/);
  assert.match(server,/searchClient: routedSearchClient/);assert.match(server,/searchClient:routedSearchClient/);
  assert.match(server,/getSpendPolicy:\(\)=>phase13Automation\.spendPolicy\(\)/);
  assert.match(server,/spendPolicy:\(\)=>phase13Automation\.spendPolicy\(\)/);
});
