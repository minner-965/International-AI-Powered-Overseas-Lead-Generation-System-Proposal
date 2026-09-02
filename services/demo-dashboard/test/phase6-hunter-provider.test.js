import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HUNTER_CREDIT_UNITS,
  HUNTER_MODES,
  HunterCreditBudget,
  HunterProvider,
  mapHunterVerification
} from '../src/enrichment/HunterProvider.js';

test('Hunter remains disabled without a key and does not call the network', async () => {
  let calls = 0;
  const provider = new HunterProvider({ fetchImpl:async()=>{ calls += 1; throw new Error('unexpected'); } });
  assert.equal(provider.mode, HUNTER_MODES.DISABLED);
  assert.equal(provider.capabilities.enabled, false);
  const result = await provider.domainSearch({ researchJobId:'synthetic-job',companyId:'synthetic-company',domain:'buyer.example' });
  assert.equal(result.status, 'SKIPPED');
  assert.equal(result.error_code, 'HUNTER_DISABLED');
  assert.equal(calls, 0);
});

test('the official test key selects TEST mode', () => {
  const provider = new HunterProvider({ apiKey:'test-api-key',fetchImpl:async()=>new Response('{}') });
  assert.equal(provider.mode, HUNTER_MODES.TEST);
});

test('Hunter status mapping is conservative', () => {
  assert.equal(mapHunterVerification('valid'), 'VALID');
  assert.equal(mapHunterVerification('accept_all'), 'ACCEPT_ALL');
  assert.equal(mapHunterVerification('invalid'), 'INVALID');
  assert.equal(mapHunterVerification('disposable'), 'INVALID');
  assert.equal(mapHunterVerification('unknown'), 'UNKNOWN');
  assert.equal(mapHunterVerification('blocked'), 'UNKNOWN');
  assert.equal(mapHunterVerification(''), 'NOT_VERIFIED');
});

test('Domain Search uses a header key, bounded filters and normalized provider output', async () => {
  let captured;
  const provider = new HunterProvider({
    apiKey:'synthetic-hunter-key',mode:'FREE_FIRST',
    fetchImpl:async(url,options)=>{
      captured={url:new URL(url),options};
      return new Response(JSON.stringify({ data:{ emails:[{
        first_name:'Avery',last_name:'Buyer',position:'Senior Womenswear Buyer',value:'Avery.Buyer@buyer.example',
        confidence:91,verification:{status:'accept_all'},sources:[{ uri:'https://buyer.example/team' }]
      }] },meta:{request_id:'synthetic-request'} }),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  const result = await provider.domainSearch({
    researchJobId:'synthetic-job-1',companyId:'synthetic-company-1',domain:'buyer.example',
    departments:['purchasing','procurement','sourcing','sales','ignored'],seniorities:['senior','executive'],limit:99
  });
  assert.equal(captured.url.origin+captured.url.pathname, 'https://api.hunter.io/v2/domain-search');
  assert.equal(captured.url.searchParams.has('api_key'), false);
  assert.equal(captured.options.headers['X-API-KEY'], 'synthetic-hunter-key');
  assert.deepEqual(captured.url.searchParams.getAll('department'), ['purchasing','procurement','sourcing','sales']);
  assert.equal(captured.url.searchParams.get('limit'), '10');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.results[0].email, 'avery.buyer@buyer.example');
  assert.equal(result.results[0].verification_status, 'ACCEPT_ALL');
  assert.equal(result.credits.used, HUNTER_CREDIT_UNITS.DOMAIN_SEARCH);
  const usage=JSON.stringify(result.usage_event.result_payload);
  assert.doesNotMatch(usage,/Avery|Buyer@|Senior Womenswear|buyer\.example\/team|sources/i);
  assert.deepEqual(result.usage_event.result_payload.verification_status_counts,{ACCEPT_ALL:1});
  assert.equal(result.usage_event.result_payload.result_count,1);
});

test('Email Finder requires an identified person and charges only when found', async () => {
  let calls = 0;
  const provider = new HunterProvider({
    apiKey:'synthetic-key',
    fetchImpl:async()=>{ calls += 1; return new Response(JSON.stringify({data:{email:null}}),{status:200}); }
  });
  const skipped = await provider.findEmail({ researchJobId:'synthetic-job-2',companyId:'synthetic-company-2',domain:'buyer.example' });
  assert.equal(skipped.error_code, 'VERIFIED_PERSON_REQUIRED');
  assert.equal(calls, 0);
  const missing = await provider.findEmail({
    researchJobId:'synthetic-job-2',companyId:'synthetic-company-2',domain:'buyer.example',firstName:'Avery',lastName:'Buyer'
  });
  assert.equal(missing.status, 'NOT_FOUND');
  assert.equal(missing.credits.used, 0);
  assert.equal(calls, 1);
});

test('Email Verifier performs local syntax validation and keeps ACCEPT_ALL distinct', async () => {
  let calls = 0;
  const provider = new HunterProvider({
    apiKey:'synthetic-key',
    fetchImpl:async()=>{ calls += 1; return new Response(JSON.stringify({data:{status:'accept_all',score:88}}),{status:200}); }
  });
  const invalid = await provider.verifyEmail({ researchJobId:'synthetic-job-3',companyId:'synthetic-company-3',email:'not-an-email' });
  assert.equal(invalid.error_code, 'INVALID_EMAIL_SYNTAX');
  assert.equal(calls, 0);
  const checked = await provider.verifyEmail({ researchJobId:'synthetic-job-3',companyId:'synthetic-company-3',email:'buyer@buyer.example' });
  assert.equal(checked.results[0].verification_status, 'ACCEPT_ALL');
  assert.equal(checked.credits.used, HUNTER_CREDIT_UNITS.EMAIL_VERIFIER);
  assert.equal(calls, 1);
});

test('UNKNOWN verification releases its reserved credit', async () => {
  const provider = new HunterProvider({
    apiKey:'synthetic-key',
    fetchImpl:async()=>new Response(JSON.stringify({data:{status:'unknown',score:null}}),{status:200})
  });
  const result = await provider.verifyEmail({ researchJobId:'synthetic-job-4',companyId:'synthetic-company-4',email:'buyer@buyer.example' });
  assert.equal(result.results[0].verification_status, 'UNKNOWN');
  assert.equal(result.credits.used, 0);
  assert.equal(result.usage_event.reserved_units, 0);
});

test('429 and server errors become temporary failures without spending credits', async () => {
  for (const status of [429,500,503]) {
    const provider = new HunterProvider({
      apiKey:`synthetic-key-${status}`,
      fetchImpl:async()=>new Response(JSON.stringify({errors:[{details:'temporary'}]}),{status})
    });
    const result = await provider.domainSearch({ researchJobId:`synthetic-job-${status}`,companyId:null,domain:'buyer.example' });
    assert.equal(result.status, 'TEMPORARY_ERROR');
    assert.equal(result.credits.used, 0);
  }
});

test('budget enforces per-run and billing-period caps with atomic-style reservations', async () => {
  const budget = new HunterCreditBudget({ runCapUnits:1500,billingPeriodCapUnits:2000 });
  const first = await budget.reserve({ researchJobId:'synthetic-run-a',endpoint:'domain-search',payload:{domain:'a.example'},units:1000 });
  await budget.settle(first,{ usedUnits:1000 });
  await assert.rejects(
    budget.reserve({ researchJobId:'synthetic-run-a',endpoint:'email-finder',payload:{domain:'b.example'},units:1000 }),
    error=>error.code === 'HUNTER_CREDIT_CAP'
  );
  await assert.rejects(
    budget.reserve({ researchJobId:'synthetic-run-b',endpoint:'domain-search',payload:{domain:'c.example'},units:1500 }),
    error=>error.code === 'HUNTER_CREDIT_CAP'
  );
});

test('persistent Hunter ledger immediately applies a lower environment limit and never raises a stored limit',async()=>{
  const fixture=({limit,used=0})=>{const calls=[];const state={provider:'HUNTER',billing_period:'2026-09',credit_limit_units:limit,reserved_units:0,used_units:used};
    const client={async query(sql,params){calls.push({sql,params});
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:0};
      if(/INSERT INTO leadgen\.provider_credit_ledger/.test(sql))return{rows:[],rowCount:0};
      if(/provider_credit_ledger[\s\S]*FOR UPDATE/.test(sql))return{rows:[{...state}],rowCount:1};
      if(/SET credit_limit_units=\$2/.test(sql)){state.credit_limit_units=params[1];return{rows:[],rowCount:1};}
      if(/WITH stale_events/.test(sql))return{rows:[],rowCount:0};
      if(/logical_request_fingerprint/.test(sql)&&/FOR UPDATE/.test(sql))return{rows:[],rowCount:0};
      if(/research_job_id=\$1 AND provider='HUNTER'/.test(sql))return{rows:[{total:0}],rowCount:1};
      if(/date_trunc\('day'/.test(sql))return{rows:[{total:0}],rowCount:1};
      if(/reserved_units=reserved_units\+\$2/.test(sql)){state.reserved_units+=params[1];return{rows:[],rowCount:1};}
      if(/INSERT INTO leadgen\.provider_usage_events/.test(sql))return{rows:[{id:'hunter-tight',status:'RESERVED',reserved_units:1000,result_payload:{logical_request_fingerprint:'x',retry_number:0}}],rowCount:1};
      throw new Error(`Unexpected SQL: ${sql}`);},release(){}};return{pool:{async connect(){return client;}},calls,state};};
  const lowered=fixture({limit:5000});
  await new HunterCreditBudget({pool:lowered.pool,runCapUnits:5000,dailyCapUnits:5000,billingPeriodCapUnits:2000})
    .reserve({researchJobId:'lower-job',endpoint:'domain-search',payload:{domain:'buyer.example'},units:1000});
  assert.equal(lowered.state.credit_limit_units,2000);
  assert.ok(lowered.calls.some(item=>/SET credit_limit_units/.test(item.sql)&&item.params[1]===2000));

  const cannotRaise=fixture({limit:1000,used:1000});
  await assert.rejects(()=>new HunterCreditBudget({pool:cannotRaise.pool,runCapUnits:10000,dailyCapUnits:10000,billingPeriodCapUnits:10000})
    .reserve({researchJobId:'raise-job',endpoint:'domain-search',payload:{domain:'buyer.example'},units:1000}),
  error=>error.code==='HUNTER_CREDIT_CAP');
  assert.equal(cannotRaise.state.credit_limit_units,1000);
});

test('identical replay is skipped and does not make a second provider request', async () => {
  let calls = 0;
  const businessRows=new Map();
  const referenceId='11111111-1111-4111-8111-111111111171';
  const provider = new HunterProvider({
    apiKey:'synthetic-key',
    fetchImpl:async()=>{ calls += 1; return new Response(JSON.stringify({data:{email:'avery@buyer.example',verification:{status:'valid'}}}),{status:200}); }
  });
  const params = { researchJobId:'synthetic-replay-job',companyId:'synthetic-company',domain:'buyer.example',firstName:'Avery',lastName:'Buyer',
    persistResults:async results=>{businessRows.set(referenceId,results[0]);return{referenceIds:[referenceId]};},
    loadPersistedResults:async({referenceIds})=>referenceIds.map(id=>businessRows.get(id)).filter(Boolean) };
  const first = await provider.findEmail(params);
  const replay = await provider.findEmail(params);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(replay.status, 'SKIPPED');
  assert.equal(replay.error_code, 'IDEMPOTENT_REPLAY');
  assert.equal(replay.credits.used,0);
  assert.equal(calls, 1);
});

test('RESERVED Hunter work returns a retryable in-progress error instead of an empty replay',async()=>{
  const budget=new HunterCreditBudget({runCapUnits:2000,dailyCapUnits:2000,billingPeriodCapUnits:2000});
  await budget.reserve({researchJobId:'reserved-job',companyId:'reserved-company',endpoint:'email-verifier',
    payload:{email:'buyer@buyer.example'},units:500});
  let calls=0;const provider=new HunterProvider({apiKey:'synthetic-key',budget,
    fetchImpl:async()=>{calls+=1;return new Response('{}');}});
  await assert.rejects(()=>provider.verifyEmail({researchJobId:'reserved-job',companyId:'reserved-company',
    email:'buyer@buyer.example'}),error=>error.code==='HUNTER_REQUEST_IN_PROGRESS'&&error.retryable===true);
  assert.equal(calls,0);
});

test('settled Hunter result survives provider restart through a PII-free business-row reference',async()=>{
  const budget=new HunterCreditBudget({runCapUnits:2000,dailyCapUnits:2000,billingPeriodCapUnits:2000});
  const businessRows=new Map();let calls=0;
  const referenceId='11111111-1111-4111-8111-111111111172';
  const first=new HunterProvider({apiKey:'synthetic-key',budget,fetchImpl:async()=>new Response(JSON.stringify({
    data:{status:'valid',score:98},meta:{request_id:'hunter-request-1'}}),{status:200})});
  const input={researchJobId:'lookup-job',companyId:'lookup-company',email:'buyer@buyer.example'};
  const completed=await first.verifyEmail({...input,persistResults:async results=>{
    businessRows.set(referenceId,results[0]);return{referenceIds:[referenceId]};
  }});
  assert.equal(completed.status,'COMPLETED');
  const payloadText=JSON.stringify(completed.usage_event.result_payload);
  assert.deepEqual(completed.usage_event.result_payload.business_reference_ids,[referenceId]);
  assert.equal(payloadText.includes('buyer@buyer.example'),false);
  assert.equal(payloadText.includes('person_name'),false);
  assert.equal(payloadText.includes('raw_title'),false);
  assert.equal(payloadText.includes('sources'),false);
  const afterRestart=new HunterProvider({apiKey:'synthetic-key',budget,fetchImpl:async()=>{calls+=1;throw new Error('no call');}});
  const replay=await afterRestart.verifyEmail({...input,loadPersistedResults:async({referenceIds})=>
    referenceIds.map(id=>businessRows.get(id)).filter(Boolean)});
  assert.equal(replay.status,'SKIPPED');
  assert.equal(replay.error_code,'IDEMPOTENT_REPLAY');
  assert.equal(replay.results[0].email,'buyer@buyer.example');
  assert.equal(replay.results[0].verification_status,'VALID');
  assert.equal(replay.credits.used,0);
  assert.equal(calls,0);
});

test('TEMPORARY_ERROR Hunter attempts retry and then raise an explicit exhaustion state',async()=>{
  let calls=0;const provider=new HunterProvider({apiKey:'synthetic-key',
    budget:new HunterCreditBudget({runCapUnits:5000,dailyCapUnits:5000,billingPeriodCapUnits:5000,maxTemporaryRetries:0}),
    fetchImpl:async()=>{calls+=1;return new Response('{}',{status:503});}});
  const input={researchJobId:'temp-job',companyId:'temp-company',email:'buyer@buyer.example'};
  assert.equal((await provider.verifyEmail(input)).status,'TEMPORARY_ERROR');
  await assert.rejects(()=>provider.verifyEmail(input),error=>error.code==='HUNTER_TEMPORARY_RETRIES_EXHAUSTED');
  assert.equal(calls,1);
});
