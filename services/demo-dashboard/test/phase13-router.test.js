import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchProviderRouter,resolveSearchRoute,createPurposeSearchProvider,SEARCH_PURPOSES} from '../src/search/SearchProviderRouter.js';
import {TavilyUsageAudit,TavilyUsageLedger} from '../src/search/TavilyUsageAudit.js';

const dual={dualSearchEnabled:true,provider:'tavily',braveApiKey:'fixture',tavilyApiKey:'fixture',storageRightsConfirmed:true};
test('explicit dual mode has six centralized purposes and no implicit shadow traffic',()=>{
 assert.equal(resolveSearchRoute(dual,'COMPANY_DISCOVERY').provider,'brave');
 for(const purpose of SEARCH_PURPOSES.slice(1,-1)){
  const route=resolveSearchRoute(dual,purpose);assert.equal(route.provider,'tavily');assert.equal(route.tavilySearchDepth,'advanced');
 }
 const shadow=resolveSearchRoute(dual,'SHADOW_BENCHMARK');assert.equal(shadow.automatic,false);assert.equal(shadow.routes.length,2);assert.equal(shadow.routes[1].tavilySearchDepth,'basic');
 assert.throws(()=>createPurposeSearchProvider(dual,'SHADOW_BENCHMARK'),{code:'SHADOW_NOT_ENABLED'});
 assert.throws(()=>resolveSearchRoute(dual,'TYPO'),{code:'INVALID_SEARCH_PURPOSE'});
});
test('rollout is explicit and legacy provider remains available until configuration confirmed',()=>{
 assert.equal(resolveSearchRoute({provider:'tavily'},'COMPANY_DISCOVERY').provider,'tavily');
 assert.equal(resolveSearchRoute({provider:'dataforseo'},'COMPANY_DISCOVERY').provider,'dataforseo');
});
test('Brave discovery is independent of Tavily account exhaustion, evidence is not',async()=>{
 let calls=0;const account={ensureCanCreate:async()=>{calls++;throw Object.assign(new Error('exhausted'),{code:'CREDIT_EXHAUSTED'});}};
 const router=new SearchProviderRouter({config:dual,tavilyAccountState:account});
 await router.ensureCanCreate('COMPANY_DISCOVERY');assert.equal(calls,0);
 await assert.rejects(router.ensureCanCreate('CATEGORY_EVIDENCE'),{code:'CREDIT_EXHAUSTED'});assert.equal(calls,1);
});
test('Brave missing key and unconfirmed storage fail closed without fallback',async()=>{
 await assert.rejects(new SearchProviderRouter({config:{...dual,braveApiKey:''}}).ensureCanCreate(),{code:'SEARCH_PROVIDER_CONFIGURATION_BLOCKED'});
 await assert.rejects(new SearchProviderRouter({config:{...dual,storageRightsConfirmed:false}}).ensureCanCreate(),{code:'STORAGE_RIGHTS_NOT_CONFIRMED'});
});
test('advanced evidence has distinct ledger identity while basic historical replay is preserved',async()=>{
 const ledger=new TavilyUsageLedger();let calls=0;
 const provider=depth=>({name:'tavily',searchDepth:depth,search:async()=>{calls++;return{results:[],credits:depth==='advanced'?2:1};}});
 const args={researchJobId:'fixture-job',purpose:'CATEGORY_EVIDENCE',request:{query:'fixture category',count:5,country:'AE'}};
 await new TavilyUsageAudit({provider:provider('basic'),ledger}).search(args);
 await new TavilyUsageAudit({provider:provider('basic'),ledger}).search(args);assert.equal(calls,1);
 await new TavilyUsageAudit({provider:provider('advanced'),ledger}).search(args);assert.equal(calls,2);
 await new TavilyUsageAudit({provider:provider('advanced'),ledger}).search(args);assert.equal(calls,2);
});
