import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Phase7Service} from '../src/phase7/service.js';
import {createPhase7QueueHandlers} from '../src/phase7/queueHandlers.js';
import {PHASE5_QUEUES} from '../src/jobs/phase5Queue.js';
import {sha256} from '../src/phase7/repository.js';

const recipient='controlled@example.test';

test('scheduled IMAP sync uses isolated processing while controlled scope is active',async()=>{
  const service=new Phase7Service({pool:{query:async()=>{throw new Error('production persistence reached');}},env:{OUTREACH_SEND_SCOPE:'CONTROLLED_TEST'}});
  let calls=0;service.syncControlledApplicationInboundWork=async()=>{calls++;return{status:'COMPLETED',matched:1};};
  assert.deepEqual(await service.syncInboundEmailWork(),{status:'COMPLETED',matched:1});
  assert.equal(calls,1);
});
const env={OUTBOUND_EMAIL_PROVIDER:'SMTP',OUTREACH_SEND_SCOPE:'CONTROLLED_TEST',CONTROLLED_TEST_MODE:'true',
  CONTROLLED_TEST_MAX_MESSAGES:'2',CONTROLLED_TEST_RECIPIENT_ALLOWLIST:recipient,OUTREACH_ENABLED:'true',
  LIVE_PROSPECT_SEND_APPROVED:'false',SMTP_ENABLED:'true',SMTP_CONTROLLED_TEST_MODE:'true',SMTP_HOST:'mail.example.test',
  SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'true',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fixture',
  SMTP_FROM_EMAIL:'sender@example.test',SMTP_REPLY_TO:'sender@example.test',SMTP_UNSUBSCRIBE_EMAIL:'sender@example.test',
  IMAP_HOST:'mail.example.test',IMAP_PORT:'993',IMAP_TLS:'true',IMAP_USER:'sender@example.test',IMAP_PASSWORD:'fixture',
  OUTREACH_MAX_SENDS_PER_MINUTE:'1',OUTREACH_MAX_SENDS_PER_DAY:'10',OUTREACH_MAX_SENDS_PER_COMPANY_30D:'2'};

test('055 keeps controlled E2E persistence separate from Company, Opportunity and CRM',async()=>{
  const packaged=new URL('../database/migrations/055_phase11_controlled_application_context.sql',import.meta.url);
  const workspace=new URL('../../../database/migrations/055_phase11_controlled_application_context.sql',import.meta.url);
  const sql=await readFile(existsSync(fileURLToPath(packaged))?packaged:workspace,'utf8');
  for(const table of ['controlled_application_contexts','controlled_application_approvals','controlled_application_drafts','controlled_application_messages','controlled_application_attempts','controlled_application_inbound_messages','controlled_application_activities','controlled_application_suppressions','controlled_application_imap_checkpoints'])assert.match(sql,new RegExp(`leadgen\\.${table}`));
  assert.doesNotMatch(sql,/REFERENCES leadgen\.(companies|business_opportunity|opportunity_crm_states|crm_sync_outbox)/i);
  assert.match(sql,/recipient_hash text NOT NULL/);assert.doesNotMatch(sql,/recipient_(?:email|address) text/i);
});

test('controlled context creation persists only the recipient digest',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});let captured;
  service.repository={createControlledApplicationContext:async input=>(captured=input)};
  const row=await service.createControlledApplicationContext({recipient,context_label:'OQ10',provider_purpose:'COLD_OUTREACH',max_messages:2},{identity:'manager'});
  assert.equal(row.recipient_hash,sha256(recipient));assert.equal('recipient' in captured,false);assert.equal(JSON.stringify(captured).includes(recipient),false);assert.equal(captured.max_messages,2);
});

test('single local controlled recipient can create a context without entering the address in the UI',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});let captured;
  service.repository={createControlledApplicationContext:async input=>(captured=input)};
  const row=await service.createControlledApplicationContext({context_label:'OQ10',provider_purpose:'COLD_OUTREACH',max_messages:1},{identity:'manager'});
  assert.equal(row.recipient_hash,sha256(recipient));assert.equal(JSON.stringify(captured).includes(recipient),false);
  assert.equal(service.controlledApplicationRuntimeStatus().recipient_configured,true);
});

test('controlled sender uses the same SMTP provider once and replays with zero calls',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});let calls=0,completed=false;
  const message={id:'11111111-1111-4111-8111-111111111111',context_id:'22222222-2222-4222-8222-222222222222',recipient_hash:sha256(recipient),send_status:'QUEUED',provider_purpose:'COLD_OUTREACH',sender_identity:'sender@example.test',reply_to:'sender@example.test',subject:'Controlled check',body_text:'Please reply to this controlled check.',idempotency_key:'a'.repeat(64),suppressed:false};
  service.repository={getControlledApplicationMessage:async()=>completed?{...message,send_status:'PROVIDER_ACCEPTED'}:message,reserveControlledApplicationAttempt:async()=>({id:'33333333-3333-4333-8333-333333333333'}),markControlledApplicationProviderCallStarted:async()=>({id:'33333333-3333-4333-8333-333333333333'}),completeControlledApplicationAttempt:async()=>{completed=true;}};
  service.outboundProvider={validatePurpose:()=>({allowed:true}),health:async()=>({ready:true}),send:async()=>{calls+=1;return{status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_SMTP',network_calls:1};}};
  assert.equal((await service.sendControlledApplicationWork({message_id:message.id})).status,'PROVIDER_ACCEPTED');
  const replay=await service.sendControlledApplicationWork({message_id:message.id});assert.equal(replay.code,'IDEMPOTENT_REPLAY');assert.equal(replay.network_calls,0);assert.equal(calls,1);
});

test('controlled SENDING replay becomes manual hold and never calls SMTP again',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});let calls=0;
  service.repository={getControlledApplicationMessage:async()=>({id:'11111111-1111-4111-8111-111111111111',recipient_hash:sha256(recipient),send_status:'SENDING',provider_purpose:'COLD_OUTREACH',suppressed:false}),reserveControlledApplicationAttempt:async()=>({ambiguous_hold:true})};
  service.outboundProvider={validatePurpose:()=>({allowed:true}),health:async()=>({ready:true}),send:async()=>{calls+=1;}};
  const result=await service.sendControlledApplicationWork({message_id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(result.code,'CONTROLLED_SEND_MANUAL_HOLD');assert.equal(result.network_calls,0);assert.equal(calls,0);
  const source=await readFile(new URL('../src/phase7/repository.js',import.meta.url),'utf8');assert.match(source,/existing\?\.provider_call_started_at[\s\S]{0,700}ambiguous_hold:true/);
});

test('controlled suppression race at reservation or provider-call-start performs zero SMTP calls',async()=>{
  for(const stage of ['reserve','start']){
    const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});let calls=0;
    service.repository={getControlledApplicationMessage:async()=>({id:'11111111-1111-4111-8111-111111111111',recipient_hash:sha256(recipient),send_status:'QUEUED',provider_purpose:'COLD_OUTREACH',suppressed:false}),reserveControlledApplicationAttempt:async()=>stage==='reserve'?{suppression_blocked:true}:{id:'33333333-3333-4333-8333-333333333333'},markControlledApplicationProviderCallStarted:async()=>({suppression_blocked:true})};
    service.outboundProvider={validatePurpose:()=>({allowed:true}),health:async()=>({ready:true}),send:async()=>{calls+=1;}};
    const result=await service.sendControlledApplicationWork({message_id:'11111111-1111-4111-8111-111111111111'});assert.equal(result.code,'CONTROLLED_RECIPIENT_SUPPRESSED');assert.equal(result.network_calls,0);assert.equal(calls,0);
  }
});

test('controlled IMAP ignores a header-correlated message from the wrong sender',async()=>{
  const active={...env,SMTP_IMAP_INBOUND_SYNC_ENABLED:'true'};const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env:active});let persisted=0,queued=0;
  service.repository={getControlledImapCheckpoint:async()=>null,findControlledMessageByHeaders:async()=>({id:'11111111-1111-4111-8111-111111111111',context_id:'22222222-2222-4222-8222-222222222222',recipient_hash:sha256(recipient)}),recordControlledInbound:async()=>{persisted+=1;},saveControlledImapCheckpoint:async()=>({})};
  service.queue={enqueue:async()=>{queued+=1;}};service.outboundProvider.readMailboxChanges=async()=>({status:'COMPLETED',messages:[{uid:1,uidvalidity:1,from:'attacker@example.test',in_reply_to:'<controlled@example.test>',references:'',message_key:'key',subject:'Re',body_text:'hello',date:new Date().toISOString()}],uidvalidity:1,last_processed_uid:1,network_calls:1});
  const result=await service.syncControlledApplicationInboundWork();assert.equal(result.matched,0);assert.equal(persisted,0);assert.equal(queued,0);
});

test('controlled DSN correlation requires the exact controlled recipient',async()=>{
  const active={...env,SMTP_IMAP_INBOUND_SYNC_ENABLED:'true'};const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env:active});let persisted=0;
  service.repository={getControlledImapCheckpoint:async()=>null,findControlledMessageByHeaders:async()=>({id:'11111111-1111-4111-8111-111111111111',context_id:'22222222-2222-4222-8222-222222222222',recipient_hash:sha256(recipient)}),recordControlledInbound:async input=>{persisted+=1;assert.equal(input.dsn_recipient_hash,sha256(recipient));return{row:{id:'44444444-4444-4444-8444-444444444444'},replay:false};},saveControlledImapCheckpoint:async()=>({})};
  service.queue={enqueue:async()=>{}};service.outboundProvider.readMailboxChanges=async()=>({status:'COMPLETED',messages:[
    {uid:1,uidvalidity:1,from:'mailer-daemon@example.test',message_key:'key',dsn:true,dsn_details:{recipient:'wrong@example.test',status:'5.1.1'},date:new Date().toISOString()},
    {uid:2,uidvalidity:1,from:'mailer-daemon@example.test',message_key:'key',dsn:true,dsn_details:{recipient,status:'5.1.1'},date:new Date().toISOString()}
  ],uidvalidity:1,last_processed_uid:2,network_calls:1});
  const result=await service.syncControlledApplicationInboundWork();assert.equal(result.matched,1);assert.equal(persisted,1);
});

test('controlled opt-out creates one evidence effect and enqueues scoped shared CRM without sending',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[{id:'44444444-4444-4444-8444-444444444444',subject_sanitized:'Re: controlled',body_text_sanitized:'Please unsubscribe me',classification_input:{}}]})},env});let applied=0;
  service.repository={applyControlledInbound:async()=>({activity:applied++?null:{id:'activity'},suppression:applied===1?{id:'suppression'}:null,replay:applied>1})};
  service.replayControlledCrm=async()=>({created:applied===1?1:0});
  const first=await service.processControlledApplicationInboundWork({inbound_message_id:'44444444-4444-4444-8444-444444444444'});const replay=await service.processControlledApplicationInboundWork({inbound_message_id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(first.reply_category,'OPT_OUT');assert.equal(first.suppression_created,true);assert.equal(first.crm_outbox_created,1);assert.equal(replay.crm_outbox_created,0);assert.equal(first.automatic_send_allowed,false);assert.equal(replay.status,'REPLAY_NO_DELTA');
});

test('controlled send and inbound queues are registered without production CRM dispatch',async()=>{
  const service={sendControlledApplicationWork:async()=>({status:'BLOCKED'}),syncControlledApplicationInboundWork:async()=>({status:'DISABLED'}),processControlledApplicationInboundWork:async()=>({status:'MISSING'})};
  const handlers=createPhase7QueueHandlers({service});
  for(const name of [PHASE5_QUEUES.SEND_CONTROLLED_APPLICATION_EMAIL,PHASE5_QUEUES.CONTROLLED_APPLICATION_INBOUND_SYNC,PHASE5_QUEUES.PROCESS_CONTROLLED_APPLICATION_INBOUND])assert.equal(typeof handlers[name],'function');
  assert.equal((await handlers[PHASE5_QUEUES.PROCESS_CONTROLLED_APPLICATION_INBOUND]({})).status,'MISSING');
});

test('controlled API surface requires the existing management role boundaries',async()=>{
  const router=await readFile(new URL('../src/phase7/router.js',import.meta.url),'utf8');
  assert.match(router,/controlled-tests', \.\.\.managementApprove/);assert.match(router,/management-approve', \.\.\.managementApprove/);
  assert.match(router,/drafts', \.\.\.draftWrite/);assert.match(router,/draftId\/approve', \.\.\.outreachApprove/);assert.match(router,/draftId\/enqueue', \.\.\.send/);
});
