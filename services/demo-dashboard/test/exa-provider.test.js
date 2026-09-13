import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ExaSearchProvider} from '../src/search/ExaSearchProvider.js';
import {ExaProviderAccountState} from '../src/search/ExaProviderAccountState.js';
import {SearchUsageAudit,providerCostUsd} from '../src/search/SearchUsageAudit.js';
const success=cost=>new Response(JSON.stringify({requestId:'fixture-request',results:[{title:'Supplier',url:'https://fixture.invalid',highlights:['Women clothing','Wholesale']}],...(cost===undefined?{}:{costDollars:{total:cost}})}));
test('Exa uses official POST, bounded excerpts and integer result count',async()=>{
 let sent;const p=new ExaSearchProvider({apiKey:'fixture',fetchImpl:async(url,options)=>{sent={url,...options};return success(.005);}});
 const result=await p.search({query:' dresses ',count:3.9,country:'AE'});
 assert.equal(sent.url,'https://api.exa.ai/search');assert.equal(sent.method,'POST');assert.equal(sent.headers['x-api-key'],'fixture');
 assert.deepEqual(JSON.parse(sent.body),{query:'dresses',type:'auto',numResults:3,contents:{highlights:{maxCharacters:2000}},userLocation:'AE'});
 assert.equal(result.results[0].snippet,'Women clothing\nWholesale');assert.equal(result.costDollars.total,.005);
});
test('Exa ignores generated summary as page evidence and omits ALL location',async()=>{
 const p=new ExaSearchProvider({apiKey:'fixture',fetchImpl:async(_u,o)=>{assert.equal(JSON.parse(o.body).userLocation,undefined);return new Response(JSON.stringify({results:[{url:'https://fixture.invalid',summary:'generated claim'}]}));}});
 assert.equal((await p.search({query:'x'})).results[0].snippet,'');
});
test('Exa ambiguity is one attempt and never leaks remote payload or cause',async()=>{
 for(const kind of ['timeout','network',500,503,401,402]){
  let calls=0;const attempts=[];const p=new ExaSearchProvider({apiKey:'fixture-secret',sleep:async()=>assert.fail('retry'),fetchImpl:async()=>{calls++;if(typeof kind==='string')throw Object.assign(new Error('fixture-secret'),{name:kind==='timeout'?'TimeoutError':'Error'});return new Response(JSON.stringify({error:'fixture-secret'}),{status:kind});}});
  await assert.rejects(p.search({query:'x',onAttempt:a=>attempts.push(a)}),e=>{assert.doesNotMatch(String(e)+String(e.cause),/fixture-secret/);assert.equal(e.attempts,1);return true;});
  assert.equal(calls,1);assert.deepEqual(attempts.map(a=>a.phase),['STARTED','FINISHED']);
 }
});
test('Exa rate-limit retry records both attempts and respects long retry-after',async()=>{
 let calls=0;const sleeps=[];const p=new ExaSearchProvider({apiKey:'fixture',sleep:async n=>sleeps.push(n),fetchImpl:async()=>++calls===1?new Response('{}',{status:429,headers:{'retry-after':'1'}}):success()});
 const audit=new SearchUsageAudit({provider:p});const r=await audit.search({researchJobId:'fixture',purpose:'DISCOVERY',request:{query:'x'}});
 assert.equal(r.usage_event.result_payload.audit.attempt_count,2);assert.deepEqual(sleeps,[1000]);
 const long=new ExaSearchProvider({apiKey:'fixture',fetchImpl:async()=>new Response('{}',{status:429,headers:{'retry-after':'60'}}),sleep:async()=>assert.fail('long wait')});
 await assert.rejects(long.search({query:'x'}),e=>e.code==='RATE_LIMITED'&&e.attempts===1);
});
test('Exa invalid configuration and invalid JSON never become empty success',async()=>{
 await assert.rejects(new ExaSearchProvider().search({query:'x'}),{code:'MISSING_API_KEY'});
 await assert.rejects(new ExaSearchProvider({apiKey:'fixture'}).search({query:' '}),{code:'INVALID_SEARCH_PARAMETERS'});
 await assert.rejects(new ExaSearchProvider({apiKey:'fixture',fetchImpl:async()=>new Response('bad')}).search({query:'x'}),{code:'INVALID_RESPONSE'});
});
test('Exa usage replay preserves known cost and never calls again',async()=>{
 let calls=0;const audit=new SearchUsageAudit({provider:new ExaSearchProvider({apiKey:'fixture',fetchImpl:async()=>{calls++;return success(.005);}})});
 const input={researchJobId:'fixture',purpose:'DISCOVERY',request:{query:'x'}};
 const first=await audit.search(input),replay=await audit.search(input);
 assert.equal(first.usage_event.result_payload.audit.provider_cost_usd,.005);assert.equal(replay.costDollars.total,.005);assert.equal(replay.replay,true);assert.equal(calls,1);
});
test('Exa unknown monetary usage stays null rather than free',async()=>{
 for(const value of [undefined,null,{}, {total:'0.1'},{total:-1}])assert.equal(providerCostUsd(value),null);
 assert.equal(providerCostUsd({total:0}),0);
 const audit=new SearchUsageAudit({provider:new ExaSearchProvider({apiKey:'fixture',fetchImpl:async()=>success()})});
 assert.equal((await audit.search({researchJobId:'fixture',purpose:'DISCOVERY',request:{query:'x'}})).usage_event.result_payload.audit.provider_cost_usd,null);
});
test('Exa configuration does not claim verified credential or balance',async()=>{
 const state=await new ExaProviderAccountState({apiKey:'fixture'}).getState();
 assert.equal(state.status,'AVAILABLE');assert.equal(state.capacity_verified,false);assert.equal(state.credential_verified,false);assert.equal(state.remaining_credits,null);assert.equal(state.state_source,'LOCAL_CONFIGURATION_ONLY');
});
test('Exa persisted capacity and credential errors survive adapter recreation',async()=>{
 const now=()=>new Date('2026-09-13T00:00:10Z');
 for(const [error_code,status] of [['CREDIT_EXHAUSTED','CREDIT_EXHAUSTED'],['AUTH_ERROR','AUTH_ERROR'],['RATE_LIMITED','RATE_LIMITED']]){
  const state=new ExaProviderAccountState({apiKey:'fixture',now,pool:{query:async()=>({rows:[{error_code,completed_at:'2026-09-13T00:00:00Z'}]})}});
  assert.equal((await state.getState()).status,status);await assert.rejects(state.ensureCanCreate());
 }
 const successState=await new ExaProviderAccountState({apiKey:'fixture',now,pool:{query:async()=>({rows:[{status:'COMPLETED',completed_at:'2026-09-13T00:00:00Z'}]})}}).getState();
 assert.equal(successState.credential_verified,true);assert.equal(successState.capacity_verified,false);
});
test('Exa account history database failure fails closed',async()=>{
 await assert.rejects(new ExaProviderAccountState({apiKey:'fixture',pool:{query:async()=>{throw new Error('database failure');}}}).ensureCanCreate(),/database failure/);
});
test('Frozen query recovery restores actual cost from durable response snapshot',()=>{
 const source=readFileSync(new URL('../src/search/PgFrozenSearchStore.js',import.meta.url),'utf8');
 assert.match(source,/provider_cost_usd:providerCostUsd\(saved\.response_snapshot\?\.costDollars\?\?response\.costDollars\)/);
});
