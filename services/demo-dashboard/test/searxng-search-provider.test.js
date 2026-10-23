import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SearxngSearchProvider,SearxngProviderAccountState} from '../src/search/SearxngSearchProvider.js';
import {selectCurrentCapacityProvider,parseSearchProviderOrder,CurrentCapacityRouter} from '../src/search/CurrentCapacityRouter.js';
import {createConfiguredSearchProvider} from '../src/search/SearchProviderRouter.js';
import {SearchCostControl,loadSearchCostConfig} from '../src/search/SearchCostControl.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';
import {SearchUsageAudit} from '../src/search/SearchUsageAudit.js';

// Zero live calls: every fetch below is an in-process double.
const json=(status,body)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>body});
const fixtureFetch=(response)=>{const calls=[];const fn=async(url,init)=>{calls.push({url,init});if(response instanceof Error)throw response;return typeof response==='function'?response(url):response;};fn.calls=calls;return fn;};

test('SearXNG provider calls the JSON API and normalizes results',async()=>{
  const fetchImpl=fixtureFetch(json(200,{query:'x',results:[
    {url:'https://buyer-one.example/about',title:'Buyer One',content:'Wholesale womenswear importer',engines:['google','bing'],score:2.5},
    {url:'javascript:alert(1)',title:'bad'},
    {url:'https://buyer-two.example',title:'Buyer Two',content:'Distributor'}],unresponsive_engines:[]}));
  const provider=new SearxngSearchProvider({baseUrl:'http://searxng.test:8080/',fetchImpl});
  const out=await provider.search({query:' Damenmode Großhändler ',count:5,country:'DE',searchLang:'de'});
  const url=new URL(fetchImpl.calls[0].url);
  assert.equal(url.origin+url.pathname,'http://searxng.test:8080/search');
  assert.equal(url.searchParams.get('format'),'json');assert.equal(url.searchParams.get('q'),'Damenmode Großhändler');
  assert.equal(url.searchParams.get('language'),'de-DE');assert.equal(fetchImpl.calls[0].init.method,'GET');
  assert.equal(out.provider,'searxng');assert.equal(out.credits,0);assert.deepEqual(out.costDollars,{total:0});
  assert.equal(out.results.length,2);
  assert.deepEqual(out.results[0],{title:'Buyer One',url:'https://buyer-one.example/about',snippet:'Wholesale womenswear importer',provider_score:2.5,rank:1,engines:['google','bing']});
  assert.equal(out.results[1].rank,2);
});

test('SearXNG errors, 429 and CAPTCHA-blocked engines are fallback errors; plain empty pages are answers',async()=>{
  const cases=[[json(429,{}),'RATE_LIMITED'],[json(403,{}),'SEARXNG_FORBIDDEN'],[json(502,{}),'TEMPORARY_ERROR'],
    [json(200,{results:[],unresponsive_engines:[['google','CAPTCHA'],['bing','timeout']]}),'RATE_LIMITED_CAPTCHA'],
    [json(200,{nope:true}),'INVALID_RESPONSE'],[new TypeError('fetch failed'),'NETWORK_ERROR']];
  for(const [response,code] of cases){
    const provider=new SearxngSearchProvider({fetchImpl:fixtureFetch(response)});
    await assert.rejects(provider.search({query:'q'}),error=>error.code===code&&error.fallback===true);
  }
  const empty=await new SearxngSearchProvider({fetchImpl:fixtureFetch(json(200,{results:[],unresponsive_engines:[]}))}).search({query:'q'});
  assert.deepEqual(empty.results,[]);assert.equal(empty.fallbackOnEmpty,true);
});

test('router: searxng first in the default order, configured only with a base URL, skipped when excluded or cooling down',async()=>{
  assert.deepEqual(parseSearchProviderOrder(undefined),['searxng','exa','tavily']);
  assert.deepEqual(parseSearchProviderOrder('Exa, searxng ,exa'),['exa','searxng']);
  const config={searxngEnabled:true,searxngBaseUrl:'http://searxng:8080',exaEnabled:true,exaApiKey:'fixture',tavilyApiKey:'fixture'};
  const states={searxng:{status:'AVAILABLE'},exa:{status:'AVAILABLE'},tavily:{status:'AVAILABLE'}};
  const order=parseSearchProviderOrder('');
  assert.equal(selectCurrentCapacityProvider({order,config,states}).provider,'searxng');
  assert.equal(selectCurrentCapacityProvider({order,config,states,exclude:['searxng']}).provider,'exa');
  assert.equal(selectCurrentCapacityProvider({order,config:{...config,searxngEnabled:false},states}).provider,'exa');
  const cooling=new SearxngProviderAccountState({now:()=>new Date('2026-10-23T00:00:00Z')});
  await cooling.observeSearchError({code:'RATE_LIMITED_CAPTCHA',retryAfterSeconds:600});
  assert.equal((await cooling.getState()).status,'RATE_LIMITED');
  assert.equal(selectCurrentCapacityProvider({order,config,states:{...states,searxng:await cooling.getState()}}).provider,'exa');
  const provider=createConfiguredSearchProvider({...config,provider:'searxng'},{fetchImpl:fixtureFetch(json(200,{results:[]}))});
  assert.ok(provider instanceof SearxngSearchProvider);assert.equal(provider.endpoint,'http://searxng:8080/search');
});

test('cost control prices SearXNG at zero and keeps the paid fallback in the estimate',async()=>{
  const config=loadSearchCostConfig({});
  assert.equal(config.unitPrices.SEARXNG,0);
  assert.equal(loadSearchCostConfig({SEARCH_COST_USD_PER_QUERY_SEARXNG:'0'}).unitPrices.SEARXNG,0);
  const free=new SearchCostControl({config,providerOrder:async()=>['searxng']});
  assert.equal((await free.estimate({summary:{planned_query_count:50},queries:[]})).estimated_cost_usd,0);
  const mixed=new SearchCostControl({config,providerOrder:async()=>['searxng','exa']});
  assert.equal(await mixed.estimateUnitPrice(),0.007);
  assert.equal((await free.canSpend('searxng')).next_query_usd,0);
});

// Executor double: the real router selection, an in-memory store and the real usage audit (no pool).
function executorFixture({searxng,exa,exaConfigured=true}){
  const calls=[];const fails=[];const persisted=[];
  const config={searxngEnabled:true,searxngBaseUrl:'http://searxng.test:8080',exaEnabled:exaConfigured,exaApiKey:exaConfigured?'fixture':''};
  const searxngState=new SearxngProviderAccountState();
  const states={searxng:searxngState,exa:{getState:async()=>({status:'AVAILABLE'})}};
  const providers={searxng:new SearxngSearchProvider({baseUrl:config.searxngBaseUrl,fetchImpl:async url=>{calls.push(['searxng',url]);return searxng();}}),
    exa:{name:'exa',endpoint:'https://exa.invalid/search',search:async()=>{calls.push(['exa']);return exa();}}};
  const router=new CurrentCapacityRouter({config,getOrder:async()=>['searxng','exa','tavily'],
    getStates:async()=>({searxng:await states.searxng.getState(),exa:await states.exa.getState()})});
  router.provider=selection=>providers[selection.provider];
  const store={load:async()=>({research_job_id:'job',plan:{queries:[{fingerprint:'q1'}]}}),lookup:async()=>null,
    claim:async(_plan,_q,selection,reason)=>({id:`${selection.provider}-exec`,provider:selection.provider,reason,request_snapshot:{query:'womenswear importer',country:'DE',searchLang:'de',count:10}}),
    recordResponse:async()=>{},persist:async(_p,_q,execution,response)=>{persisted.push([execution.provider,(response.results||[]).length]);return[];},
    results:async()=>[],attachUsage:async()=>{},fail:async(execution,error)=>{fails.push([execution.provider,error.code]);}};
  const executor=new FrozenSearchPlanExecutor({store,router,accountStates:states,auditFactory:provider=>new SearchUsageAudit({provider,retrySafeFailures:true})});
  return {executor,calls,fails,persisted,searxngState};
}

test('executor falls back from a failing or rate-limited SearXNG to Exa for the same query',async()=>{
  const f=executorFixture({searxng:()=>json(429,{}),exa:()=>({results:[{url:'https://buyer.example',title:'Buyer'}],credits:1})});
  const result=await f.executor.executeJob('job');
  assert.equal(result.status,'COMPLETED');assert.equal(result.completed_queries,1);
  assert.deepEqual(f.calls.map(c=>c[0]),['searxng','exa']);
  assert.deepEqual(f.fails,[['searxng','RATE_LIMITED']]);assert.deepEqual(f.persisted,[['exa',1]]);
  assert.equal((await f.searxngState.getState()).status,'RATE_LIMITED');
});

test('executor uses SearXNG results without calling Exa, and asks Exa after an empty SearXNG page',async()=>{
  const ok=executorFixture({searxng:()=>json(200,{results:[{url:'https://buyer.example',title:'B',content:'importer'}]}),exa:()=>{throw new Error('must not call');}});
  assert.equal((await ok.executor.executeJob('job')).status,'COMPLETED');
  assert.deepEqual(ok.calls.map(c=>c[0]),['searxng']);assert.deepEqual(ok.persisted,[['searxng',1]]);
  const empty=executorFixture({searxng:()=>json(200,{results:[]}),exa:()=>({results:[{url:'https://buyer.example',title:'B'}],credits:1})});
  assert.equal((await empty.executor.executeJob('job')).status,'COMPLETED');
  assert.deepEqual(empty.calls.map(c=>c[0]),['searxng','exa']);assert.deepEqual(empty.persisted,[['searxng',0],['exa',1]]);
  // No paid fallback configured: the empty SearXNG answer completes the query.
  const alone=executorFixture({searxng:()=>json(200,{results:[]}),exa:()=>{throw new Error('must not call');},exaConfigured:false});
  assert.equal((await alone.executor.executeJob('job')).status,'COMPLETED');assert.deepEqual(alone.calls.map(c=>c[0]),['searxng']);
  // SearXNG down and no fallback: the job pauses instead of completing.
  const down=executorFixture({searxng:()=>{throw new TypeError('fetch failed');},exa:()=>({results:[]}),exaConfigured:false});
  assert.equal((await down.executor.executeJob('job')).status,'PAUSED_PROVIDER_UNAVAILABLE');
});

test('compose runs the pinned SearXNG image on the internal network with JSON enabled',()=>{
  const compose=readFileSync(new URL('../../../compose.yaml',import.meta.url),'utf8');
  const services=compose.slice(compose.indexOf('\nservices:'),compose.indexOf('\nvolumes:'));
  const block=services.split(/\n(?=  [a-z0-9-]+:\n)/).find(part=>part.startsWith('  searxng:'));
  assert.ok(block,'searxng service');
  assert.match(block,/image: searxng\/searxng:\d{4}\.\d{1,2}\.\d{1,2}-[0-9a-f]{7,}/);
  assert.doesNotMatch(block,/\n    ports:/);
  assert.match(block,/SEARXNG_SECRET/);
  const settings=readFileSync(new URL('../../../config/searxng/settings.yml',import.meta.url),'utf8');
  assert.match(settings,/formats:\s*\n\s*- html\s*\n\s*- json/);
  for(const engine of ['google','bing','duckduckgo','brave','startpage','qwant'])assert.match(settings,new RegExp(`- ${engine}\\b`));
  assert.doesNotMatch(settings,/secret_key:\s*"[^"]+[a-z0-9]{16,}/i);
});
