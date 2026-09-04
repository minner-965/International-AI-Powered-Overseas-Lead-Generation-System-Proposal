import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildGmailMime,createOutboundProvider,GmailApiProviderAdapter,stableGmailMessageId } from '../src/outreach/providers.js';
import { PHASE5_QUEUES } from '../src/jobs/phase5Queue.js';
import { createPhase7QueueHandlers } from '../src/phase7/queueHandlers.js';
import { Phase7Service } from '../src/phase7/service.js';

const jsonResponse=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});
const projectRoot=path.resolve(process.env.DPV_PROJECT_ROOT||fileURLToPath(new URL('../../..',import.meta.url)));
const config=(fetchImpl,overrides={})=>({enabled:true,inboundEnabled:true,controlledTestMode:true,
  clientId:'client-id',clientSecret:'client-secret',refreshToken:'refresh-token',senderEmail:'info@dpvinternational.com',
  replyToEmail:'info@dpvinternational.com',controlledRecipientAllowlist:'controlled@example.test',fetchImpl,...overrides});

test('Gmail provider defaults closed and never calls OAuth while disabled',async()=>{
  let calls=0;const provider=new GmailApiProviderAdapter(config(async()=>{calls+=1;return jsonResponse(500,{})},{enabled:false}));
  assert.deepEqual(provider.validatePurpose({to:'controlled@example.test'}),{allowed:false,code:'GMAIL_API_DISABLED'});
  assert.equal((await provider.health()).code,'GMAIL_API_DISABLED');
  assert.equal((await provider.send({to:'controlled@example.test'},'key')).network_calls,0);assert.equal(calls,0);
});

test('Gmail controlled send builds stable RFC identity and replays without duplicate API send',async()=>{
  const calls=[];const fetchImpl=async(url,options={})=>{calls.push({url:String(url),options});
    if(String(url).includes('oauth2'))return jsonResponse(200,{access_token:'access-token',expires_in:3600});
    if(String(url).endsWith('/messages/send'))return jsonResponse(200,{id:'gmail-message-1',threadId:'gmail-thread-1'});
    return jsonResponse(404,{});
  };
  const provider=createOutboundProvider({provider:'GMAIL_API',...config(fetchImpl)});
  const message={from:'info@dpvinternational.com',to:'controlled@example.test',reply_to:'info@dpvinternational.com',
    subject:'Controlled DPV test',body_text:'Reply unsubscribe to stop.',purpose:'COLD_OUTREACH'};
  const first=await provider.sendApprovedMessage(message,'stable-execution-key');const replay=await provider.send(message,'stable-execution-key');
  assert.equal(first.status,'PROVIDER_ACCEPTED');assert.equal(first.code,'ACCEPTED_BY_GMAIL');
  assert.equal(first.provider_message_id,'gmail-message-1');assert.equal(first.provider_thread_id,'gmail-thread-1');
  assert.equal(replay.idempotent_replay,true);assert.equal(replay.network_calls,0);
  assert.equal(calls.filter(call=>call.url.endsWith('/messages/send')).length,1);
  const raw=JSON.parse(calls.find(call=>call.url.endsWith('/messages/send')).options.body).raw;
  const mime=Buffer.from(raw,'base64url').toString('utf8');
  assert.match(mime,/Message-ID: <dpv-[a-f0-9]{40}@dpvinternational\.com>/);
  assert.match(mime,/X-DPV-Message-Key:/);assert.match(mime,/List-Unsubscribe:/);assert.match(mime,/To: controlled@example\.test/);
  assert.equal(stableGmailMessageId('stable-execution-key'),first.rfc_message_id);
});

test('controlled mode rejects every non-allowlisted recipient before network access',async()=>{
  let calls=0;const provider=new GmailApiProviderAdapter(config(async()=>{calls+=1;return jsonResponse(200,{})}));
  const result=await provider.send({from:'info@dpvinternational.com',to:'prospect@example.test'},'blocked-key');
  assert.equal(result.status,'BLOCKED');assert.equal(result.code,'GMAIL_CONTROLLED_RECIPIENT_REQUIRED');assert.equal(calls,0);
});

test('ambiguous Gmail timeout is not reported as delivered or automatically resent',async()=>{
  let sendCalls=0;const provider=new GmailApiProviderAdapter(config(async(url)=>{
    if(String(url).includes('oauth2'))return jsonResponse(200,{access_token:'access-token',expires_in:3600});
    sendCalls+=1;throw Object.assign(new Error('timeout'),{name:'AbortError'});
  }));
  const result=await provider.send({from:'info@dpvinternational.com',to:'controlled@example.test',subject:'Test',body_text:'Body'},'ambiguous-key');
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.code,'GMAIL_SEND_AMBIGUOUS');assert.equal(sendCalls,1);
  assert.notEqual(result.status,'DELIVERED');
});

test('a redelivered ambiguous send job queues reconciliation without calling Gmail send again',async()=>{
  let sends=0;let queued=null;const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},
    queue:{enqueue:async(name,data,options)=>{queued={name,data,options};return'reconcile-job';}},env:{GMAIL_AMBIGUOUS_WAIT_SECONDS:'120'}});
  service.repository={getOutboundMessage:async()=>({id:'11111111-1111-4111-8111-111111111111',send_status:'AMBIGUOUS'})};
  service.outboundProvider={send:async()=>{sends+=1;return{status:'PROVIDER_ACCEPTED'};}};
  const result=await service.sendMessageWork({message_id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.network_calls,0);assert.equal(sends,0);
  assert.equal(queued.name,PHASE5_QUEUES.RECONCILE_GMAIL_AMBIGUOUS_SEND);assert.equal(queued.options.startAfter,120);
});

test('ambiguous reconciliation searches Sent by stable RFC Message-ID',async()=>{
  const urls=[];const provider=new GmailApiProviderAdapter(config(async(url)=>{urls.push(String(url));
    if(String(url).includes('oauth2'))return jsonResponse(200,{access_token:'access-token',expires_in:3600});
    return jsonResponse(200,{messages:[{id:'found-message',threadId:'found-thread'}]});
  }));
  const result=await provider.reconcileAmbiguousSend({rfcMessageId:'<dpv-test@dpvinternational.com>'});
  assert.equal(result.status,'PROVIDER_ACCEPTED');assert.equal(result.provider_message_id,'found-message');
  assert.ok(urls.some(url=>url.includes('rfc822msgid%3A%3Cdpv-test%40dpvinternational.com%3E%20in%3Asent')));
});

test('Gmail history polling fetches inbound metadata and recognizes structured DSN only',async()=>{
  const provider=new GmailApiProviderAdapter(config(async(url)=>{
    const value=String(url);if(value.includes('oauth2'))return jsonResponse(200,{access_token:'access-token',expires_in:3600});
    if(value.includes('/history?'))return jsonResponse(200,{historyId:'101',history:[{messagesAdded:[{message:{id:'inbound-1'}}]}]});
    return jsonResponse(200,{id:'inbound-1',threadId:'thread-1',historyId:'101',internalDate:'1788432000000',payload:{mimeType:'multipart/report; report-type=delivery-status',headers:[
      {name:'From',value:'mailer-daemon@example.test'},{name:'To',value:'info@dpvinternational.com'},
      {name:'Subject',value:'Delivery status'},{name:'In-Reply-To',value:'<dpv-original@dpvinternational.com>'}],parts:[
        {mimeType:'text/plain',body:{data:Buffer.from('Delivery failed').toString('base64url')}},
        {mimeType:'message/delivery-status',body:{data:Buffer.from('Final-Recipient: rfc822; controlled@example.test\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 mailbox missing').toString('base64url')}}]}});
  }));
  const result=await provider.readMailboxChanges({historyId:'100'});
  assert.equal(result.status,'COMPLETED');assert.equal(result.history_id,'101');assert.equal(result.messages.length,1);
  assert.equal(result.messages[0].dsn,true);assert.equal(result.messages[0].dsn_details.bounce_class,'HARD');
  assert.equal(result.messages[0].dsn_details.recipient,'controlled@example.test');assert.equal(result.messages[0].body_text,'Delivery failed');
});

test('a delivery-looking message without recipient and status is not treated as a DSN',async()=>{
  const provider=new GmailApiProviderAdapter(config(async(url)=>{
    const value=String(url);if(value.includes('oauth2'))return jsonResponse(200,{access_token:'access-token',expires_in:3600});
    return jsonResponse(200,{id:'not-dsn',payload:{mimeType:'multipart/report; report-type=delivery-status',headers:[],parts:[
      {mimeType:'message/delivery-status',body:{data:Buffer.from('Delivery failed').toString('base64url')}}]}});
  }));
  const message=await provider.fetchMessage('not-dsn');assert.equal(message.dsn,false);assert.equal(message.dsn_details,null);
});

test('Gmail queues reuse Phase 7 send, inbound and CRM pipeline without a bypass sender',async()=>{
  const handlers=createPhase7QueueHandlers({service:{
    reconcileGmailAmbiguousSendWork:async()=>({status:'NOT_FOUND'}),syncGmailInboundWork:async()=>({status:'COMPLETED'}),
    sendMessageWork:async()=>({}),repository:{},queue:null
  }});
  assert.equal(typeof handlers[PHASE5_QUEUES.GMAIL_INBOUND_SYNC],'function');
  assert.equal(typeof handlers[PHASE5_QUEUES.RECONCILE_GMAIL_AMBIGUOUS_SEND],'function');
  const source=await readFile(new URL('../src/phase7/service.js',import.meta.url),'utf8');
  assert.match(source,/currentOutboundGate\(message,message\.provider_purpose\)/);
  assert.match(source,/process-inbound-message/);assert.match(source,/sync-outreach-to-crm/);
  assert.doesNotMatch(source,/gmail\.users\.messages\.send/);
});

test('Gmail migration and environment contract are additive and secret-free',async()=>{
  const [sql,env]=await Promise.all([
    readFile(path.join(projectRoot,'database/migrations/042_phase10_gmail_api_provider.sql'),'utf8'),
    readFile(path.join(projectRoot,'.env.example'),'utf8')]);
  assert.match(sql,/provider IN\('NONE','SMTP','RESEND','GMAIL_API'\)/);
  assert.match(sql,/send_execution_key/);assert.match(sql,/rfc_message_id/);assert.match(sql,/gmail_mailbox_checkpoints/);
  assert.match(sql,/gmail_ambiguous_send_events/);assert.match(sql,/AMBIGUOUS/);
  for(const key of ['GMAIL_API_ENABLED=false','GMAIL_INBOUND_SYNC_ENABLED=false','GMAIL_CONTROLLED_TEST_MODE=true',
    'GMAIL_OAUTH_CLIENT_ID=','GMAIL_OAUTH_CLIENT_SECRET=','GMAIL_OAUTH_REFRESH_TOKEN='])assert.match(env,new RegExp(key));
  assert.doesNotMatch(env,/GMAIL_OAUTH_CLIENT_SECRET=.+|GMAIL_OAUTH_REFRESH_TOKEN=.+/);
  const mime=Buffer.from(buildGmailMime({from:'a@example.test',to:'b@example.test',subject:'x',body_text:'y'},'k').raw,'base64url').toString('utf8');
  assert.doesNotMatch(mime,/client-secret|refresh-token|access-token/);
});
