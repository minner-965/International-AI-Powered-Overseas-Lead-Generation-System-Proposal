import test from 'node:test';
import assert from 'node:assert/strict';
import {FrozenSearchPlanExecutor,searchPause} from '../src/search/FrozenSearchPlanExecutor.js';
function fixture({prior=null,enabled=true,error=null}={}){
 let calls=0,persists=0;let row=prior;
 const store={load:async()=>({plan:{queries:[{fingerprint:'q'}]}}),lookup:async()=>row,claim:async()=>({id:'x',request_snapshot:{query:'fixture'}}),recordResponse:async(_e,r)=>{row={response_snapshot:r};},persist:async()=>{persists++;row={status:'PERSISTED'};return[];},results:async()=>[],attachUsage:async()=>{},fail:async()=>{}};
 const router={select:async()=>({provider:'tavily'}),provider:()=>({name:'tavily',endpoint:'https://fixture.invalid/search',search:async()=>{calls++;if(error)throw error;return{results:[{url:'https://fixture.invalid'}]};}})};
 return {executor:new FrozenSearchPlanExecutor({store,router,isEnabled:async()=>enabled}),counts:()=>({calls,persists})};
}
test('persisted query replay produces zero provider calls',async()=>{const f=fixture({prior:{status:'PERSISTED'}});assert.equal((await f.executor.executeJob('job')).completed,true);assert.equal(f.counts().calls,0);});
test('provider response recovery persists without searching again',async()=>{const f=fixture({prior:{status:'REVIEW_REQUIRED',response_snapshot:{results:[]}}});await f.executor.executeJob('job');assert.deepEqual(f.counts(),{calls:0,persists:1});});
test('automation OFF retains pending query',async()=>{const f=fixture({enabled:false});assert.equal((await f.executor.executeJob('job')).status,'PAUSED_AUTOMATION_OFF');assert.equal(f.counts().calls,0);});
test('successful execution reuses existing audit and second run is free',async()=>{const f=fixture();assert.equal((await f.executor.executeJob('job')).completed,true);await f.executor.executeJob('job');assert.deepEqual(f.counts(),{calls:1,persists:1});});
test('ambiguous prior claim is held for review',async()=>{const f=fixture({prior:{status:'CLAIMED'}});assert.equal((await f.executor.executeJob('job')).status,'PAUSED_SEARCH_REVIEW');assert.equal(f.counts().calls,0);});
test('capacity error pauses instead of reporting completion',async()=>{const f=fixture({error:Object.assign(new Error('fixture'),{code:'CREDIT_EXHAUSTED'})});assert.equal((await f.executor.executeJob('job')).status,'PAUSED_PROVIDER_CAPACITY');assert.equal(searchPause({code:'RATE_LIMITED'}),'PAUSED_PROVIDER_RATE_LIMIT');});
