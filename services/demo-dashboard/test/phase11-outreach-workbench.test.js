import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Service} from '../src/phase7/service.js';
const ID='8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db';
function setup(row={}){
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE',SMTP_FROM_EMAIL:'sender@example.com',SMTP_REPLY_TO:'sender@example.com',SMTP_PASSWORD:'secret-canary'}});
  service.repository.listOutreachWorkbench=async()=>[{company_id:ID,product_profile:'WOMENSWEAR',opportunity_status:'MANAGEMENT_APPROVED',eligibility_status:'ELIGIBLE',recipient_id:'recipient',eligibility_snapshot_id:'eligibility',input_digest:'digest',...row}];
  service.repository.getMarketingContext=async()=>({id:'context',version:'v1',approval_decision:'APPROVED',content:{private:'do-not-return'}});
  return service;
}
test('workbench exposes no provider credentials and offers category capability without target general merchandise claim',async()=>{
  const result=await setup().getOutreachWorkbench();
  assert.equal(result.sender_configured,true);
  assert.deepEqual(Object.keys(result.marketing_context).sort(),['id','status','version']);
  assert.doesNotMatch(JSON.stringify(result),/secret-canary|do-not-return/);
  assert.match(result.template.body_text,/We supply womenswear and Yiwu general merchandise/);
  assert.match(result.template.body_text,/reply unsubscribe/);
  assert.equal(result.sending_enabled,false);
  assert.ok(result.sending_blocked_reasons.includes('OUTREACH_DISABLED'));
});

test('approved draft send affordance reflects current gate and blocks previously created messages',async()=>{
  const service=setup({draft_status:'APPROVED',approval_id:'approved',message_id:'existing-message'});
  Object.assign(service.env,{OUTBOUND_EMAIL_PROVIDER:'SMTP',SMTP_ENABLED:'true',OUTREACH_ENABLED:'true',OUTREACH_SEND_SCOPE:'PROSPECT_PILOT',LIVE_PROSPECT_SEND_APPROVED:'true'});
  service.repository.getApprovalForEnqueue=async()=>({provider_purpose:'COLD_OUTREACH'});
  service.currentOutboundGate=async()=>({reasons:['CONTACT_SUPPRESSED']});
  const result=await service.getOutreachWorkbench();
  assert.equal(result.sending_enabled,true);
  assert.equal(result.items[0].send_allowed,false);
  assert.deepEqual(result.items[0].send_blocked_reasons,['CONTACT_SUPPRESSED','MESSAGE_ALREADY_CREATED']);
});
test('prepare derives recipient and eligibility server-side and never queues mail',async()=>{
  const service=setup();let recorded;
  service.createDraft=async input=>{recorded=input;return{draft:{id:'draft'}};};
  service.enqueueMessage=async()=>{throw new Error('must not send');};
  await service.prepareWorkbenchDraft(ID,{recipient_id:'attacker-input',eligibility_snapshot_id:'wrong'},{identity:'dpv-workspace'});
  assert.equal(recorded.recipient_id,'recipient');assert.equal(recorded.eligibility_snapshot_id,'eligibility');
  assert.deepEqual(recorded.products,[]);assert.deepEqual(recorded.followups,[]);
});
test('prepare requires current approval and revises existing draft instead of duplicating version one',async()=>{
  await assert.rejects(setup({opportunity_status:'RECOMMENDED'}).prepareWorkbenchDraft(ID,{},{}),error=>error.code==='DRAFT_CURRENT_GATE_BLOCKED');
  const service=setup({draft_id:'existing'});let revision;
  service.reviseDraft=async(id,body)=>{revision={id,body};return{id:'v2'};};
  const result=await service.prepareWorkbenchDraft(ID,{body_text:'Editable category introduction'},{});
  assert.equal(result.id,'v2');assert.equal(revision.id,'existing');assert.equal(revision.body.body_text,'Editable category introduction');
});
