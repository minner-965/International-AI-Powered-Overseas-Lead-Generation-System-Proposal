import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveSearchProvider} from '../src/search/BraveSearchProvider.js';
import {SearchUsageAudit,searchRequestFingerprint} from '../src/search/SearchUsageAudit.js';
const ok=()=>new Response(JSON.stringify({query:{more_results_available:true},web:{results:[{url:'https://example.invalid',title:'Example',description:'Description'}]}}));
test('AE market retains geographical query while unsupported Brave country filter uses ALL',async()=>{
  let sent;const provider=new BraveSearchProvider({apiKey:'fixture',fetchImpl:async url=>{sent=url;return ok();}});
  const result=await provider.search({query:'women clothing Dubai United Arab Emirates',country:'AE'});
  assert.equal(sent.searchParams.get('country'),'ALL');assert.match(sent.searchParams.get('q'),/Dubai United Arab Emirates/);
  assert.equal(result.country,'AE');assert.equal(result.providerCountry,'ALL');
});
test('Brave official pagination/language and safe retries record every attempt without invented credits',async()=>{
  let calls=0;const sleeps=[],provider=new BraveSearchProvider({apiKey:'fixture',sleep:async ms=>sleeps.push(ms),fetchImpl:async url=>{
    assert.equal(url.searchParams.get('offset'),'2');assert.equal(url.searchParams.get('search_lang'),'es');
    return ++calls===1?new Response('{}',{status:429,headers:{'retry-after':'1'}}):ok();}});
  const audit=new SearchUsageAudit({provider}),input={researchJobId:'job',purpose:'COMPANY_DISCOVERY',request:{query:'dresses',country:'MX',searchLang:'es',offset:2,count:5}};
  const result=await audit.search(input);assert.equal(result.results[0].rank,11);assert.equal(result.attempts,2);assert.equal(result.credits,undefined);assert.deepEqual(sleeps,[1000]);
  assert.equal(result.usage_event.result_payload.audit.attempt_count,2);
  const replay=await audit.search(input);assert.equal(replay.results.length,1);assert.equal(calls,2);assert.equal(replay.replay,true);
});
test('auth and long rate limits never retry, invalid pagination never calls provider',async()=>{
  for(const status of [401,403,429]){let calls=0;const provider=new BraveSearchProvider({apiKey:'fixture',fetchImpl:async()=>{calls++;return new Response('{}',{status,headers:{'retry-after':'60'}});}});
    await assert.rejects(provider.search({query:'x'}),error=>status===429?error.code==='RATE_LIMITED':error.code==='AUTHENTICATION_FAILED');assert.equal(calls,1);}
  const provider=new BraveSearchProvider({apiKey:'fixture',fetchImpl:()=>{throw new Error('unexpected');}});
  await assert.rejects(provider.search({query:'x',offset:10}),{code:'INVALID_SEARCH_PARAMETERS'});
});
test('fingerprint distinguishes page, locale, count, depth, purpose and scope',()=>{
  const base={provider:'brave',researchJobId:'a',purpose:'DISCOVERY',request:{query:'x'}};const fingerprint=searchRequestFingerprint(base);
  for(const request of [{offset:1},{searchLang:'es'},{country:'MX'},{count:5},{searchDepth:'advanced'}])assert.notEqual(fingerprint,searchRequestFingerprint({...base,request:{query:'x',...request}}));
  assert.notEqual(fingerprint,searchRequestFingerprint({...base,researchJobId:'b'}));assert.notEqual(fingerprint,searchRequestFingerprint({...base,purpose:'EVIDENCE'}));
});
test('concurrent claim stays held without a second provider request',async()=>{
  let release,calls=0;const provider=new BraveSearchProvider({apiKey:'fixture',fetchImpl:async()=>{calls++;await new Promise(resolve=>release=resolve);return ok();}}),audit=new SearchUsageAudit({provider});
  const input={researchJobId:'job',purpose:'DISCOVERY',request:{query:'x'}};const pending=audit.search(input);await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(audit.search(input),{code:'SEARCH_REQUEST_IN_PROGRESS'});release();await pending;assert.equal(calls,1);
});
test('temporary failures exhaust bounded retries and malformed JSON is not silently empty',async()=>{
  let calls=0;const provider=new BraveSearchProvider({apiKey:'fixture',sleep:async()=>{},fetchImpl:async()=>{calls++;return new Response('{}',{status:503});}});
  await assert.rejects(provider.search({query:'x'}),error=>error.code==='TEMPORARY_ERROR'&&error.attempts===3);assert.equal(calls,3);
  const malformed=new BraveSearchProvider({apiKey:'fixture',fetchImpl:async()=>new Response('not json')});
  await assert.rejects(malformed.search({query:'x'}),{code:'INVALID_RESPONSE'});
});
test('result persistence failure remains reviewable and does not issue another billed request',async()=>{
  let calls=0;const audit=new SearchUsageAudit({provider:new BraveSearchProvider({apiKey:'fixture',fetchImpl:async()=>{calls++;return ok();}})});
  const input={researchJobId:'job',purpose:'DISCOVERY',request:{query:'x'},persistResults:async()=>{throw new Error('write failed');}};
  await assert.rejects(audit.search(input),error=>error.usage_event.error_code==='RESULT_PERSIST_FAILED');
  await assert.rejects(audit.search(input),{code:'SEARCH_PREVIOUS_REQUEST_FAILED'});assert.equal(calls,1);
});
