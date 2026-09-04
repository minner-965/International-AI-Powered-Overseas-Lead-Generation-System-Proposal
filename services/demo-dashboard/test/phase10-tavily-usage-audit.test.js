import test from 'node:test';
import assert from 'node:assert/strict';
import {TavilyUsageAudit,TavilyUsageLedger} from '../src/search/TavilyUsageAudit.js';

const request={query:'site:example.invalid buyer',count:5};

test('successful Tavily use records actual provider credits and result references',async()=>{
  const provider={name:'tavily',endpoint:'https://api.tavily.com/search',async search(){return{
    requestId:'provider-r1',credits:3,results:[{title:'Buyer',url:'https://example.invalid/buyer',snippet:'Public route'}]};}};
  const audit=new TavilyUsageAudit({provider});
  const result=await audit.search({researchJobId:'job-1',companyId:'company-1',purpose:'DECISION_MAKER_DISCOVERY',request,
    persistResults:async()=>({referenceIds:['ref-1']})});
  assert.equal(result.usage_event.status,'COMPLETED');
  assert.equal(result.usage_event.used_units,3);
  assert.deepEqual(result.usage_event.result_payload.audit.reference_ids,['ref-1']);
});

test('same request fingerprint replays persisted evidence without another provider call',async()=>{
  const provider={name:'tavily',calls:0,async search(){this.calls+=1;return{requestId:'r',credits:1,
    results:[{title:'Route',url:'https://example.invalid/contact',snippet:'Contact'}]};}};
  const ledger=new TavilyUsageLedger();const audit=new TavilyUsageAudit({provider,ledger});
  await audit.search({researchJobId:'job-1',companyId:'company-1',purpose:'CONTACT_DISCOVERY',request,
    persistResults:async()=>({referenceIds:['ref-1']})});
  const replay=await audit.search({researchJobId:'job-1',companyId:'company-1',purpose:'CONTACT_DISCOVERY',request,
    loadPersistedResults:async()=>[{title:'Route',url:'https://example.invalid/contact',snippet:'Contact'}]});
  assert.equal(replay.replay,true);assert.equal(provider.calls,1);assert.equal(replay.results.length,1);
});

test('an in-flight identical request is rejected as retryable, not charged twice',async()=>{
  const ledger=new TavilyUsageLedger();
  await ledger.claim({researchJobId:'job-1',purpose:'TEST',endpoint:'api.tavily.com/search',request});
  await assert.rejects(()=>ledger.claim({researchJobId:'job-1',purpose:'TEST',endpoint:'api.tavily.com/search',request}),
    error=>error.code==='TAVILY_REQUEST_IN_PROGRESS'&&error.retryable===true);
});

test('429 and provider credit exhaustion remain distinct audited failures',async()=>{
  for(const fixture of [{code:'RATE_LIMITED',expected:'TEMPORARY_ERROR'},{code:'CREDIT_EXHAUSTED',expected:'FAILED'}]){
    const provider={name:'tavily',async search(){throw Object.assign(new Error(fixture.code),{code:fixture.code});}};
    const audit=new TavilyUsageAudit({provider});
    await assert.rejects(()=>audit.search({researchJobId:`job-${fixture.code}`,purpose:'TEST',request}),error=>{
      assert.equal(error.code,fixture.code);assert.equal(error.usage_event.status,fixture.expected);return true;
    });
  }
});

test('non-Tavily providers bypass the Tavily audit adapter',async()=>{
  const provider={name:'fixture',calls:0,async search(){this.calls+=1;return{results:[]};}};
  await new TavilyUsageAudit({provider}).search({researchJobId:'job',purpose:'TEST',request});
  assert.equal(provider.calls,1);
});
