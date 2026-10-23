import assert from 'node:assert/strict';
import test from 'node:test';
import {createOutboundProvider, SmtpImapProviderAdapter, stableSmtpMessageId} from '../src/outreach/providers.js';
import {Phase7Service} from '../src/phase7/service.js';

const config=(overrides={})=>({
  smtpEnabled:true, smtpInboundSyncEnabled:false, smtpControlledTestMode:true, smtpUseCaseApproved:false,
  smtpHost:'mail.oqumail.com',smtpPort:587,smtpSecure:false,smtpRequireTls:true,
  smtpUser:'dpvsale@example.test',smtpPassword:'test-only-secret',senderEmail:'dpvsale@example.test',replyToEmail:'dpvsale@example.test',
  imapHost:'mail.oqumail.com',imapPort:993,imapTls:true,imapUser:'dpvsale@example.test',imapPassword:'test-only-secret',
  controlledRecipientAllowlist:'controlled@example.test',timeoutMs:1000,...overrides
});

test('SMTP/IMAP defaults closed before any connection or send',async()=>{
  let called=0;const provider=new SmtpImapProviderAdapter(config({smtpEnabled:false,transporterFactory:()=>{called+=1;}}));
  assert.deepEqual(provider.validatePurpose({to:'controlled@example.test'}),{allowed:false,code:'SMTP_IMAP_DISABLED'});
  assert.equal((await provider.health()).network_calls,0);assert.equal(called,0);
});

test('contract accepts SMTP 587 STARTTLS or 465 implicit TLS, and IMAP 993 TLS',()=>{
  assert.equal(new SmtpImapProviderAdapter(config()).connectionContract().length,0);
  // 465 with implicit TLS (secure=true) passes the contract.
  assert.equal(new SmtpImapProviderAdapter(config({smtpPort:465,smtpSecure:true,smtpRequireTls:false})).connectionContract().length,0);
  // 465 derives secure=true from the port when the caller leaves encryption unset.
  const derived465=new SmtpImapProviderAdapter(config({smtpPort:465,smtpSecure:undefined,smtpRequireTls:undefined}));
  assert.equal(derived465.smtpSecure,true);assert.equal(derived465.connectionContract().length,0);
  assert.deepEqual(new SmtpImapProviderAdapter(config({smtpSecure:true})).connectionContract(),['SMTP_STARTTLS_587_REQUIRED']);
  // 465 without implicit TLS is rejected; port 25 is unsupported.
  assert.deepEqual(new SmtpImapProviderAdapter(config({smtpPort:465,smtpSecure:false,smtpRequireTls:true})).connectionContract(),['SMTP_TLS_465_REQUIRED']);
  assert.deepEqual(new SmtpImapProviderAdapter(config({smtpPort:25,smtpSecure:false,smtpRequireTls:true})).connectionContract(),['SMTP_PORT_UNSUPPORTED']);
  assert.deepEqual(new SmtpImapProviderAdapter(config({imapTls:false})).connectionContract(),['IMAP_TLS_993_REQUIRED']);
  assert.deepEqual(new SmtpImapProviderAdapter(config({senderEmail:'other@example.test'})).connectionContract(),['SMTP_SENDER_MISMATCH']);
  assert.deepEqual(new SmtpImapProviderAdapter(config({replyToEmail:'other@example.test'})).connectionContract(),['SMTP_REPLY_TO_MISMATCH']);
  assert.equal(new SmtpImapProviderAdapter(config({smtpPort:465,smtpSecure:true})).capabilities().transport,'SMTP_TLS');
});

test('465 mailbox opens an implicit-TLS transport (secure, no STARTTLS)',async()=>{
  const sent=[];const provider=new SmtpImapProviderAdapter(config({smtpPort:465,smtpSecure:true,smtpRequireTls:false,transporterFactory:options=>({
    verify:async()=>true,close:async()=>{},sendMail:async message=>{sent.push({options,message});return{messageId:message.messageId};}
  })}));
  const result=await provider.send({from:'dpvsale@example.test',to:'controlled@example.test',reply_to:'dpvsale@example.test',subject:'TLS test',body_text:'Plain'},'tls-key');
  assert.equal(result.status,'PROVIDER_ACCEPTED');
  assert.equal(sent[0].options.secure,true);assert.equal(sent[0].options.port,465);assert.notEqual(sent[0].options.requireTLS,true);
});

test('missing mailbox credentials fail closed before any network connection',async()=>{
  let calls=0;const provider=new SmtpImapProviderAdapter(config({smtpPassword:'',imapPassword:'',transporterFactory:()=>{calls+=1;}}));
  const health=await provider.healthCheck({verifyConnection:true});
  assert.equal(health.code,'PROVIDER_NOT_CONFIGURED');assert.equal(health.network_calls,0);assert.equal(calls,0);
});

test('SMTP controlled mode rejects non-allowlisted recipients before a network call',async()=>{
  let calls=0;const provider=new SmtpImapProviderAdapter(config({transporterFactory:()=>{calls+=1;}}));
  const result=await provider.send({to:'prospect@example.test'},'blocked');
  assert.equal(result.status,'BLOCKED');assert.equal(result.code,'SMTP_CONTROLLED_RECIPIENT_REQUIRED');assert.equal(calls,0);
});

test('SMTP provider sends exactly once with a stable RFC Message-ID',async()=>{
  const sent=[];const provider=createOutboundProvider({provider:'SMTP',...config({transporterFactory:options=>({
    verify:async()=>true,close:async()=>{},sendMail:async message=>{sent.push({options,message});return{messageId:message.messageId};}
  })})});
  const message={from:'dpvsale@example.test',to:'controlled@example.test',reply_to:'dpvsale@example.test',subject:'Controlled test',body_text:'Plain text'};
  const first=await provider.send(message,'stable-key');const replay=await provider.send(message,'stable-key');
  assert.equal(first.status,'PROVIDER_ACCEPTED');assert.equal(first.code,'ACCEPTED_BY_SMTP');assert.equal(replay.idempotent_replay,true);assert.equal(sent.length,1);
  assert.equal(sent[0].options.secure,false);assert.equal(sent[0].options.requireTLS,true);assert.equal(sent[0].options.port,587);
  assert.equal(sent[0].message.messageId,stableSmtpMessageId('stable-key','example.test'));
  assert.equal(first.rfc_message_id,sent[0].message.messageId);
});

test('SMTP timeout remains ambiguous for Sent-folder reconciliation',async()=>{
  const provider=new SmtpImapProviderAdapter(config({transporterFactory:()=>({close:async()=>{},sendMail:async()=>{const error=new Error('timeout');error.code='ETIMEDOUT';throw error;}})}));
  const result=await provider.send({to:'controlled@example.test'},'timeout-key');
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.code,'SMTP_SEND_AMBIGUOUS');assert.notEqual(result.status,'DELIVERED');
});

test('SMTP factory uses the explicit policy adapter',()=>{
  const provider=createOutboundProvider({provider:'SMTP',...config()});assert.equal(provider.name,'SMTP');
});

test('SMTP is the single selected runtime provider even when historical Gmail settings exist',()=>{
  const env={OUTBOUND_EMAIL_PROVIDER:'SMTP',GMAIL_API_ENABLED:'true',GMAIL_OAUTH_CLIENT_ID:'historical-client',GMAIL_OAUTH_CLIENT_SECRET:'historical-secret',...config()};
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env});
  assert.equal(service.outboundProvider.name,'SMTP');
});

function controlledGateService({recipient='controlled@example.test',reserved=0,scope='CONTROLLED_TEST',live='false',maximum='2'}={}){
  const pool={query:async sql=>String(sql).includes('controlled_reserved_count')
    ?{rows:[{controlled_reserved_count:reserved}],rowCount:1}
    :{rows:[{sent_last_minute:0,sent_today:0,company_sent_30d:0}],rowCount:1}};
  const env={OUTBOUND_EMAIL_PROVIDER:'SMTP',OUTREACH_ENABLED:'true',LIVE_PROSPECT_SEND_APPROVED:live,
    OUTREACH_SEND_SCOPE:scope,CONTROLLED_TEST_MODE:'true',CONTROLLED_TEST_MAX_MESSAGES:maximum,
    CONTROLLED_TEST_RECIPIENT_ALLOWLIST:'controlled@example.test',OUTREACH_MAX_SENDS_PER_MINUTE:'1',
    OUTREACH_MAX_SENDS_PER_DAY:'10',OUTREACH_MAX_SENDS_PER_COMPANY_30D:'2',...config()};
  return{service:new Phase7Service({pool,env}),approval:{normalized_recipient:recipient}};
}

test('CONTROLLED_TEST scope stays usable while live prospect sending remains false',async()=>{
  const {service,approval}=controlledGateService();const gate=await service.currentOutboundGate(approval,'COLD_OUTREACH');
  assert.equal(gate.send_scope,'CONTROLLED_TEST');
  assert.ok(!gate.reasons.includes('LIVE_PROSPECT_SEND_NOT_APPROVED'));
  assert.ok(!gate.reasons.includes('CONTROLLED_TEST_MODE_DISABLED'));
  assert.ok(!gate.reasons.includes('CONTROLLED_TEST_RECIPIENT_REQUIRED'));
  assert.ok(!gate.reasons.includes('CONTROLLED_TEST_CAP_REACHED'));
});

test('CONTROLLED_TEST scope rejects addresses outside the ignored exact allowlist',async()=>{
  const {service,approval}=controlledGateService({recipient:'other@example.test'});
  const gate=await service.currentOutboundGate(approval,'COLD_OUTREACH');
  assert.ok(gate.reasons.includes('CONTROLLED_TEST_RECIPIENT_REQUIRED'));
});

test('CONTROLLED_TEST scope blocks before provider use when its persistent message cap is reached',async()=>{
  const {service,approval}=controlledGateService({reserved:2});
  const gate=await service.currentOutboundGate(approval,'COLD_OUTREACH');
  assert.ok(gate.reasons.includes('CONTROLLED_TEST_CAP_REACHED'));
});

test('PROSPECT_PILOT keeps the separate live prospect approval gate',async()=>{
  const {service,approval}=controlledGateService({scope:'PROSPECT_PILOT',live:'false'});
  const gate=await service.currentOutboundGate(approval,'COLD_OUTREACH');
  assert.ok(gate.reasons.includes('LIVE_PROSPECT_SEND_NOT_APPROVED'));
});
