import test from 'node:test';
import assert from 'node:assert/strict';
import {TavilyProviderAccountState} from '../src/search/TavilyProviderAccountState.js';
import {TavilyUsageAudit} from '../src/search/TavilyUsageAudit.js';

function statePool(initial={status:'UNKNOWN'}){
  let state={provider_code:'TAVILY',remaining_credits:null,checked_at:null,retry_after_at:null,
    last_provider_error_code:null,updated_at:null,...initial};
  const events=[];
  const query=async(sql,params=[])=>{
    if(/SELECT .*provider_account_states/s.test(sql))return{rows:state?[{...state}]:[],rowCount:state?1:0};
    if(/INSERT INTO leadgen\.provider_account_states/.test(sql)){
      state={...state,provider_code:'TAVILY',credential_fingerprint:params[1],status:params[2],
        key_usage:params[3],key_limit:params[4],plan_usage:params[5],plan_limit:params[6],paygo_usage:params[7],
        paygo_limit:params[8],remaining_credits:params[9],checked_at:new Date(),retry_after_at:params[10],
        last_provider_error_code:params[11],updated_at:new Date()};return{rows:[{...state}],rowCount:1};
    }
    if(/INSERT INTO leadgen\.provider_account_state_events/.test(sql)){
      events.push({old_status:params[1],new_status:params[2],source:params[3],reason:params[4]});return{rows:[],rowCount:1};
    }
    return{rows:[],rowCount:0};
  };
  const client={query,release(){}};
  return{query,connect:async()=>client,events,get state(){return state;}};
}

test('429 becomes RATE_LIMITED with Retry-After while task creation remains allowed',async()=>{
  const pool=statePool();
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture',now:()=>new Date('2026-09-04T00:00:00Z')});
  await service.observeSearchError({code:'RATE_LIMITED',retryAfterSeconds:60});
  assert.equal(pool.state.status,'RATE_LIMITED');
  assert.equal((await service.assertCanCreate()).status,'RATE_LIMITED');
  await assert.rejects(()=>service.beforeSearch(),error=>error.code==='PROVIDER_RATE_LIMITED'
    &&error.retryAfterAt.toISOString()==='2026-09-04T00:01:00.000Z');
});

test('real 432 credit exhaustion blocks new provider-dependent tasks without another network call',async()=>{
  const pool=statePool();
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture'});
  await service.observeSearchError({code:'CREDIT_EXHAUSTED'});
  await assert.rejects(()=>service.assertCanCreate(),error=>error.code==='TAVILY_ACCOUNT_CREDITS_EXHAUSTED'
    &&error.created===false);
  const provider={name:'tavily',calls:0,async search(){this.calls+=1;return{credits:1,results:[]};}};
  const audit=new TavilyUsageAudit({provider,providerAccountState:service,internalLimitsEnabled:false});
  await assert.rejects(()=>audit.search({researchJobId:'job',purpose:'TEST',request:{query:'fixture'}}),
    error=>error.code==='PROVIDER_CREDIT_EXHAUSTED');
  assert.equal(provider.calls,0);
});

test('401/403 map to AUTH_ERROR while timeout is DEGRADED and neither is credit exhaustion',async()=>{
  const pool=statePool();const service=new TavilyProviderAccountState({pool,apiKey:'fixture'});
  await service.observeSearchError({code:'AUTH_ERROR'});assert.equal(pool.state.status,'AUTH_ERROR');
  await assert.rejects(()=>service.assertCanCreate(),error=>error.code==='SEARCH_PROVIDER_CONFIGURATION_BLOCKED');
  await service.observeSearchError({code:'TIMEOUT'});assert.equal(pool.state.status,'DEGRADED');
  assert.equal((await service.assertCanCreate()).status,'DEGRADED');
});

test('usage refresh respects API-key, plan and configured PAYGO capacity',async()=>{
  const exhaustedPayload={key:{usage:1000,limit:1000},account:{plan_usage:1000,plan_limit:1000,paygo_usage:100,paygo_limit:100}};
  const pool=statePool();
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(exhaustedPayload),{status:200})});
  await service.refreshUsage({force:true});assert.equal(pool.state.status,'CREDIT_EXHAUSTED');
  const availablePool=statePool();
  const available=new TavilyProviderAccountState({pool:availablePool,apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify({
    key:{usage:900,limit:1000},account:{plan_usage:1000,plan_limit:1000,paygo_usage:0,paygo_limit:100}}),{status:200})});
  await available.refreshUsage({force:true});assert.equal(availablePool.state.status,'AVAILABLE');
});

test('provider recovery re-enables creation and appends state changes only',async()=>{
  const pool=statePool({status:'CREDIT_EXHAUSTED'});const service=new TavilyProviderAccountState({pool,apiKey:'fixture'});
  await service.observeSearchSuccess('request-fixture');
  assert.equal(pool.state.status,'AVAILABLE');assert.equal((await service.assertCanCreate()).status,'AVAILABLE');
  assert.equal(pool.events.at(-1).new_status,'AVAILABLE');
});

test('a newly supplied credential bypasses a cached missing-key state',async()=>{
  const pool=statePool({status:'AUTH_ERROR',credential_fingerprint:null,checked_at:new Date()});let calls=0;
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture',fetchImpl:async()=>{
    calls+=1;return new Response(JSON.stringify({key:{usage:1,limit:1000},account:{plan_usage:1,plan_limit:1000}}),{status:200});
  }});
  await service.refreshUsage();
  assert.equal(calls,1);
  assert.equal(pool.state.status,'AVAILABLE');
});

test('stale UNKNOWN creation checks share one controlled usage refresh',async()=>{
  const pool=statePool({status:'UNKNOWN',credential_fingerprint:null,checked_at:null});let calls=0;
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture',fetchImpl:async()=>{
    calls+=1;return new Response(JSON.stringify({key:{usage:1,limit:1000},account:{plan_usage:1,plan_limit:1000}}),{status:200});
  }});
  const [first,second]=await Promise.all([service.ensureCanCreate(),service.ensureCanCreate()]);
  assert.equal(first.status,'AVAILABLE');assert.equal(second.status,'AVAILABLE');assert.equal(calls,1);
});
