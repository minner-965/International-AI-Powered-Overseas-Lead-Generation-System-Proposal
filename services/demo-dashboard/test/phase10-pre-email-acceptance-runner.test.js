import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSafeRuntime,assertStage0,assertZeroSend,parseAcceptanceArgs,redact,safeRuntimeFlags,terminalOutcome}
  from '../scripts/phase10-pre-email-automation-acceptance.mjs';

const safe={AUTO_EVIDENCE_ENABLED:'true',OUTBOUND_EMAIL_PROVIDER:'NONE',GMAIL_API_ENABLED:'false',
  GMAIL_INBOUND_SYNC_ENABLED:'false',OUTREACH_ENABLED:'false',LIVE_PROSPECT_SEND_APPROVED:'false',RESEND_USE_CASE:'DISABLED'};

test('runner defaults live search closed and supports the acceptance CLI contract',()=>{
  const args=parseAcceptanceArgs(['--market=MX','--target-category','HOMEWARE','--category-scope-id','scope',
    '--product-profile','GENERAL_MERCHANDISE','--scope-limit','2','--timeout-minutes','9','--poll-seconds','3',
    '--run-label','run','--allow-live-search','true','--output-dir','proof','--resume-run-id','job']);
  assert.equal(args.allowLiveSearch,true);assert.equal(args.market,'MX');assert.equal(args.targetCategory,'HOMEWARE');
  assert.equal(args.categoryScopeId,'scope');assert.equal(args.productProfile,'GENERAL_MERCHANDISE');
  assert.equal(args.scopeLimit,2);assert.equal(args.timeoutMinutes,9);assert.equal(args.pollSeconds,3);
  assert.equal(args.runLabel,'run');assert.equal(args.outputDir,'proof');assert.equal(args.resumeRunId,'job');
});
test('product profile is optional and does not receive a hidden default',()=>{
  const args=parseAcceptanceArgs(['--target-category','DRESSES']);
  assert.equal(args.targetCategory,'DRESSES');assert.equal(args.productProfile,null);
});
test('stage zero requires resolved category, healthy research queue and available provider',()=>{
  const good={categoryContext:{targetCategory:'DRESSES',targetCategoryScopeKey:'CATEGORY:DRESSES'},
    health:{database:'ready',phase5_jobs:'ready'},provider:{status:'AVAILABLE',creation_allowed:true}};
  assert.equal(assertStage0(good),true);
  assert.throws(()=>assertStage0({...good,health:{database:'ready',phase5_jobs:'error'}}),/RESEARCH_WORKER_NOT_READY/);
  assert.throws(()=>assertStage0({...good,provider:{status:'CREDIT_EXHAUSTED',creation_allowed:false}}),/SEARCH_PROVIDER_NOT_AVAILABLE/);
});
test('safe runtime passes with research enabled and every send path closed',()=>assert.equal(assertSafeRuntime(safeRuntimeFlags(safe)),true));
for(const [name,value] of [['OUTBOUND_EMAIL_PROVIDER','GMAIL_API'],['GMAIL_API_ENABLED','true'],['OUTREACH_ENABLED','true'],['LIVE_PROSPECT_SEND_APPROVED','true']]){
  test(`${name} open fails closed`,()=>assert.throws(()=>assertSafeRuntime(safeRuntimeFlags({...safe,[name]:value})),error=>error.exitCode===2));
}
test('evidence exhausted and partial are valid honest automation terminals',()=>{
  assert.equal(terminalOutcome('EVIDENCE_EXHAUSTED'),'AUTOMATION_TERMINAL_OK');assert.equal(terminalOutcome('PARTIAL'),'AUTOMATION_TERMINAL_OK');
});
test('system failed is an automation failure and running is not terminal',()=>{
  assert.equal(terminalOutcome('FAILED'),'AUTOMATION_FAILED');assert.equal(terminalOutcome('RUNNING'),null);
});
test('zero send delta passes and any mail delta fails',()=>{
  assert.deepEqual(assertZeroSend({outbound:0,crm:0},{outbound:0,crm:0}),{outbound:0,crm:0});
  assert.throws(()=>assertZeroSend({outbound:0},{outbound:1}),error=>error.exitCode===1);
});
test('reports redact credential-shaped keys recursively',()=>{
  assert.deepEqual(redact({ok:1,nested:{api_key:'x',refreshToken:'y'}}),{ok:1,nested:{api_key:'[REDACTED]',refreshToken:'[REDACTED]'}});
});
