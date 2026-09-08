import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCurrentCapacityProvider} from '../src/search/CurrentCapacityRouter.js';
import {SearchUsageAudit} from '../src/search/SearchUsageAudit.js';
test('explicit current capacity order skips unconfigured Brave without activating it',()=>{
 const result=selectCurrentCapacityProvider({order:['BRAVE','TAVILY'],config:{tavilyApiKey:'fixture'},states:{tavily:{status:'AVAILABLE',remaining_credits:null}}});
 assert.equal(result.provider,'tavily');assert.equal(result.reason,'EXPLICIT_ORDER_NEXT_AVAILABLE');
});
test('credentials alone do not activate an unlisted or unsupported paid provider',()=>{
 assert.equal(selectCurrentCapacityProvider({order:[],config:{tavilyApiKey:'fixture'},states:{tavily:{status:'AVAILABLE'}}}).provider,null);
 assert.equal(selectCurrentCapacityProvider({order:['DATAFORSEO'],config:{dataForSeoLogin:'fixture',dataForSeoPassword:'fixture'},states:{dataforseo:{status:'AVAILABLE'}}}).provider,null);
});
test('exhaustion preserves pause instead of choosing an unlisted provider',()=>{
 const result=selectCurrentCapacityProvider({order:['TAVILY'],config:{tavilyApiKey:'fixture',braveApiKey:'fixture',storageRightsConfirmed:true},states:{tavily:{status:'CREDIT_EXHAUSTED'},brave:{status:'AVAILABLE'}}});
 assert.equal(result.provider,null);assert.equal(result.reason,'PAUSED_PROVIDER_CAPACITY');
});
test('unknown and rate limited capacity do not initiate a request',()=>{
 for(const status of ['UNKNOWN','RATE_LIMITED','AUTH_ERROR','DEGRADED'])assert.equal(selectCurrentCapacityProvider({order:['tavily'],config:{tavilyApiKey:'fixture'},states:{tavily:{status}}}).provider,null);
});
test('explicit safe capacity rejection can resume while ambiguous failure cannot',async()=>{
 let calls=0;
 const provider={name:'tavily',endpoint:'https://fixture.invalid/search',search:async()=>{calls++;if(calls===1)throw Object.assign(new Error('exhausted'),{code:'CREDIT_EXHAUSTED'});return{results:[]};}};
 const audit=new SearchUsageAudit({provider,retrySafeFailures:true});
 const args={researchJobId:'fixture',purpose:'NEW_COMPANY_DISCOVERY',request:{query:'fixture'}};
 await assert.rejects(audit.search(args));await audit.search(args);assert.equal(calls,2);await audit.search(args);assert.equal(calls,2);
});
