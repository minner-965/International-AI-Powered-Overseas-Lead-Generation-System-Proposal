import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Service} from '../src/phase7/service.js';
import {readFile} from 'node:fs/promises';

const id='8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db';
function setup(manualOnly=true){
  const calls={queue:0,executions:0};
  const service=new Phase7Service({pool:{query:async()=>{throw Error('Unexpected database access');}},env:{OUTREACH_MANUAL_SEND_ONLY:String(manualOnly)}});
  service.queue={enqueue:async()=>{calls.queue++;return 'queued-job';}};
  service.repository.getApprovalForEnqueue=async()=>({id,content_hash:'hash',normalized_recipient:'recipient@example.invalid',from_identity:'sender@example.invalid'});
  service.currentOutboundGate=async()=>({provider:'SMTP',send_scope:'PROSPECT_PILOT',reasons:[]});
  service.repository.createOutboundMessage=async input=>({...input,id});
  service.sendMessageWork=async(data,options)=>{calls.executions++;assert.equal(data.message_id,id);assert.deepEqual(options,{manual:true});return{status:'PROVIDER_ACCEPTED',network_calls:1};};
  return{service,calls};
}
test('manual-only authenticated entry executes one message without a send queue job',async()=>{
  const {service,calls}=setup();
  const result=await service.enqueueMessage(id,{});
  assert.deepEqual(calls,{queue:0,executions:1});
  assert.equal(result.queue_job_id,null);assert.equal(result.execution.status,'PROVIDER_ACCEPTED');
});
test('manual-only entry retains the existing gate and makes zero calls for blocked contacts',async()=>{
  const {service,calls}=setup();service.currentOutboundGate=async()=>({provider:'SMTP',send_scope:'PROSPECT_PILOT',reasons:['CONTACT_SUPPRESSED']});
  const result=await service.enqueueMessage(id,{manual:true});
  assert.deepEqual(calls,{queue:0,executions:0});assert.equal(result.message.send_status,'BLOCKED');
});
test('manual mode cannot be selected by request body when deployment uses queue mode',async()=>{
  const {service,calls}=setup(false);await service.enqueueMessage(id,{manual:true,OUTREACH_MANUAL_SEND_ONLY:true});
  assert.deepEqual(calls,{queue:1,executions:0});
});
test('worker replay and spoofed payload stop before database/provider calls in manual-only mode',async()=>{
  const service=new Phase7Service({pool:{query:async()=>{throw Error('Database accessed');}},env:{OUTREACH_MANUAL_SEND_ONLY:'true'}});
  service.repository.getOutboundMessage=async()=>{throw Error('Message accessed');};
  const result=await service.sendMessageWork({message_id:id,manual:true});
  assert.equal(result.code,'MANUAL_SEND_REQUIRED');assert.equal(result.network_calls,0);assert.equal(result.outbound_attempt_delta,0);
});
test('manual transport failure never schedules an automatic send or retry',async()=>{
  const {service,calls}=setup();service.sendMessageWork=async()=>{calls.executions++;throw Error('Response lost after timeout');};
  await assert.rejects(service.enqueueMessage(id,{}),/Response lost/);
  assert.deepEqual(calls,{queue:0,executions:1});
});
test('explicit pre-provider retry in manual mode executes only that message without queueing',async()=>{
  const {service,calls}=setup();
  service.repository.getOutboundMessage=async()=>({id,approval_id:id});
  service.repository.retryBlockedOutboundBeforeProvider=async()=>({id});
  await service.retryBlockedMessage(id);assert.deepEqual(calls,{queue:0,executions:1});
});

function sender(result){
  const service=new Phase7Service({pool:{query:async()=>{throw Error('Unexpected SQL');}},env:{OUTREACH_MANUAL_SEND_ONLY:'true'}});
  const observed={};
  service.repository.getOutboundMessage=async()=>({id,provider:'SMTP',send_status:'QUEUED',from_identity:'sender@example.invalid',idempotency_key:'key'});
  service.currentOutboundGate=async()=>({reasons:[],send_scope:'PROSPECT_PILOT'});
  service.outboundProvider={health:async()=>({ready:true}),send:async()=>{if(result instanceof Error)throw result;return result;}};
  service.repository.beginOutboundAttempt=async()=>({id:'attempt',attempt_number:1});
  service.repository.completeOutboundAttempt=async value=>{observed.completed=value;};
  service.repository.recordOutboundAmbiguousEvent=async()=>{observed.ambiguous=true;};
  service.queue={enqueue:async()=>{throw Error('Manual send scheduled an automatic retry');}};
  return{service,observed};
}
test('manual retryable provider response persists FAILED, not an unconsumed QUEUED message',async()=>{
  const {service,observed}=sender({status:'FAILED',code:'PROVIDER_UNAVAILABLE',http_status:503,network_calls:1});
  const result=await service.sendMessageWork({message_id:id},{manual:true});
  assert.equal(observed.completed.sendStatus,'FAILED');assert.ok(observed.completed.reasonCodes.includes('MANUAL_REVIEW_REQUIRED'));
  assert.equal(result.manual_review_required,true);
});
test('manual unexpected transport throw persists AMBIGUOUS and requires Sent-folder review',async()=>{
  const {service,observed}=sender(Error('Response timed out'));
  const result=await service.sendMessageWork({message_id:id},{manual:true});
  assert.equal(observed.completed.sendStatus,'AMBIGUOUS');assert.equal(observed.ambiguous,true);
  assert.equal(result.code,'SMTP_MANUAL_HOLD_REQUIRED');
});
test('manual SMTP ambiguity remains on hold without replay or scheduling',async()=>{
  const {service,observed}=sender({status:'AMBIGUOUS',code:'SMTP_TIMEOUT',network_calls:1});
  await service.sendMessageWork({message_id:id},{manual:true});
  assert.equal(observed.completed.sendStatus,'AMBIGUOUS');
});
test('both manual dispatch call sites remain behind authenticated sender-role routes',async()=>{
  const router=await readFile(new URL('../src/phase7/router.js',import.meta.url),'utf8');
  assert.match(router,/const SENDER_ROLES = Object.freeze\(\['MANAGEMENT','SENDER_OPERATOR'\]\)/);
  assert.match(router,/const send = \[auth.authenticate,auth.requireRoles\(\.\.\.SENDER_ROLES\)\]/);
  assert.match(router,/router.post\('\/api\/outreach\/messages\/:id\/enqueue', \.\.\.send,/);
  assert.match(router,/router.post\('\/api\/outreach\/messages\/:id\/retry-before-provider', \.\.\.send,/);
  const queue=await readFile(new URL('../src/phase7/queueHandlers.js',import.meta.url),'utf8');
  assert.match(queue,/SEND_OUTREACH_EMAIL\]: data => service.sendMessageWork\(data\)/);
});
