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

test('identical replay is skipped and does not make a second provider request', async () => {
  let calls = 0;
  const provider = new HunterProvider({
    apiKey:'synthetic-key',
    fetchImpl:async()=>{ calls += 1; return new Response(JSON.stringify({data:{email:'avery@buyer.example',verification:{status:'valid'}}}),{status:200}); }
  });
  const params = { researchJobId:'synthetic-replay-job',companyId:'synthetic-company',domain:'buyer.example',firstName:'Avery',lastName:'Buyer' };
  const first = await provider.findEmail(params);
  const replay = await provider.findEmail(params);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(replay.status, 'SKIPPED');
  assert.equal(replay.error_code, 'IDEMPOTENT_REPLAY');
  assert.equal(calls, 1);
});
