import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoFirstTouchService,AUTO_FIRST_TOUCH_QUEUE} from '../src/outreach/AutoFirstTouchService.js';
import {renderFirstTouchTemplate} from '../src/outreach/firstTouchTemplates.js';

test('dedicated auto queue never aliases manual send',()=>assert.equal(AUTO_FIRST_TOUCH_QUEUE,'send-auto-first-touch'));
test('missing evidence loader fails before provider transport',async()=>{
 let sends=0;const service=new AutoFirstTouchService({outboundProvider:{send(){sends++;}}});
 await assert.rejects(service.evaluate('company'),{code:'FIRST_TOUCH_FACT_LOADER_REQUIRED'});assert.equal(sends,0);
});
test('terminal and provider-started reservations are never retried',async()=>{
 let sends=0,reads=0;const service=new AutoFirstTouchService({outboundProvider:{send(){sends++;}},loadEligibilityFacts(){reads++;}});
 for(const status of ['SENDING','AMBIGUOUS','PROVIDER_ACCEPTED','FAILED','BLOCKED','CANCELLED']){
  service.get=async()=>({id:'reservation',status});
  assert.equal((await service.sendReservation('reservation')).idempotent_replay,true);
 }
 assert.equal(sends,0);assert.equal(reads,0);
});
test('blocked current eligibility does not publish a send',async()=>{
 let queued=0;const service=new AutoFirstTouchService({queue:{enqueue(){queued++;}}});
 service.evaluate=async()=>({eligibility:{eligible:false,reason_codes:['SUPPRESSED']}});
 assert.deepEqual((await service.reserve('company')).eligibility.reason_codes,['SUPPRESSED']);assert.equal(queued,0);
});
test('transaction failures rollback and release',async()=>{
 const calls=[];const client={async query(sql){calls.push(sql);},release(){calls.push('release');}};
 const service=new AutoFirstTouchService({pool:{async connect(){return client;}}});
 await assert.rejects(service.transaction(async()=>{throw new Error('fixture');}),/fixture/);
 assert.deepEqual(calls,['BEGIN','ROLLBACK','release']);
});
test('pending durable reservations replay only into dedicated singleton queue',async()=>{
 const published=[];const service=new AutoFirstTouchService({pool:{async query(){return{rows:[{id:'r1'},{id:'r2'}]};}},queue:{async enqueue(...args){published.push(args);}}});
 assert.equal((await service.dispatchPending()).dispatched,2);
 assert.deepEqual(published[0],[AUTO_FIRST_TOUCH_QUEUE,{reservation_id:'r1'},{singletonKey:'r1'}]);
});
test('reservation links the verified recipient and creates the existing CRM thread bridge',async()=>{
 const variables={category:'Tops',target_category:'Tops',company:'Fixture Apparel',matched_category:'Tops',market:'United Arab Emirates',reply_to:'sender@example.test'};
 const sql=[];const queued=[];const recipient={id:'22222222-2222-4222-8222-222222222222',outreach_recipient_id:null,decision_maker_contact_id:'33333333-3333-4333-8333-333333333333'};
 const service=new AutoFirstTouchService({outboundProvider:{senderEmail:variables.reply_to,replyToEmail:variables.reply_to,messageIdDomain:'example.test'},queue:{async enqueue(...args){queued.push(args);}}});
 service.evaluate=async()=>({facts:{recipient,market:{market_code:'AE'},category_id:'44444444-4444-4444-8444-444444444444',product_profile:'WOMENSWEAR',template_variables:variables,verified_template_fields:Object.keys(variables)},eligibility:{eligible:true,policy_revision:'v1',normalized_recipient:'info@example.test',template_key:'C_OFFICIAL_GENERIC_MAILBOX'}});
 service.transaction=async fn=>fn({async query(statement,values){sql.push({statement,values});if(statement.startsWith('SELECT * FROM leadgen.reserve_phase13_first_touch'))return{rows:[{id:'11111111-1111-4111-8111-111111111111',status:'RESERVED'}]};return{rows:[]};}});
 await service.reserve('55555555-5555-4555-8555-555555555555');
 const outbound=sql.find(item=>item.statement.includes('INSERT INTO leadgen.outbound_messages'));
 assert.equal(outbound.values[2],null);assert.ok(sql.some(item=>item.statement.includes('first_touch_reservation_id,thread_token')));
 assert.equal(queued.length,1);
});

function sendingFixture(transport){
 const variables={category:'Womenswear',target_category:'womenswear',company:'Fixture Apparel',matched_category:'womenswear',market:'UAE',reply_to:'sender@example.test'};
 const draft=renderFirstTouchTemplate({template_key:'C_OFFICIAL_GENERIC_MAILBOX',variables,verified_fields:Object.keys(variables)});
 const reservation={id:'r1',company_id:'c1',status:'RESERVED',policy_revision:'v1',normalized_recipient:'info@example.test',sender_identity:'sender@example.test',reply_to:variables.reply_to,...draft};
 const queries=[],sent=[],paused=[];
 const client={release(){},async query(sql,values){queries.push({sql,values});if(sql.startsWith('SELECT * FROM leadgen.phase13_first_touch'))return{rows:[reservation]};if(sql.startsWith('SELECT * FROM leadgen.outbound_messages'))return{rows:[{id:'m1',send_status:'QUEUED',idempotency_key:'stable-r1'}]};if(sql.startsWith('INSERT INTO leadgen.outbound_message_attempts'))return{rows:[{id:'a1'}]};return{rows:[]};}};
 const service=new AutoFirstTouchService({pool:{async connect(){return client;}},automationControl:{async pauseEmail(reason){paused.push(reason);}},outboundProvider:{senderEmail:reservation.sender_identity,replyToEmail:reservation.reply_to,async send(message,key){sent.push({message,key});return transport();}}});
 service.get=async()=>reservation;
 service.evaluate=async()=>({eligibility:{eligible:true,policy_revision:'v1',normalized_recipient:reservation.normalized_recipient,template_key:reservation.template_key},facts:{template_variables:variables,verified_template_fields:Object.keys(variables)}});
 return{service,queries,sent,paused,reservation};
}
test('accepted send uses exact Simon identity, stable key and persisted pre-call marker',async()=>{
 const f=sendingFixture(()=>({status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_SMTP',provider_message_id:'fixture-rfc'}));
 const result=await f.service.sendReservation('r1');assert.equal(result.transport_status,'SMTP_ACCEPTED');assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].message.from,'Simon <sender@example.test>');assert.equal(f.sent[0].key,'stable-r1');assert.equal(f.sent[0].message.body_text,f.reservation.body_text);
 assert.ok(f.queries.some(q=>q.sql.includes('provider_call_started_at=now()')));assert.equal(f.paused.length,0);
 assert.ok(f.queries.some(q=>q.values?.includes('SENT_NO_REPLY')));
});
test('transport exception becomes ambiguity and pauses email only',async()=>{
 const f=sendingFixture(()=>{throw new Error('connection ended after DATA');});
 const result=await f.service.sendReservation('r1');assert.equal(result.transport_status,'SEND_AMBIGUOUS');assert.equal(f.sent.length,1);assert.deepEqual(f.paused,['SMTP_SEND_AMBIGUOUS']);
});
test('frozen content mismatch prevents provider call',async()=>{
 const f=sendingFixture(()=>({status:'PROVIDER_ACCEPTED'}));f.reservation.content_hash='0'.repeat(64);
 await assert.rejects(f.service.sendReservation('r1'),{code:'FIRST_TOUCH_CONTENT_CHANGED'});assert.equal(f.sent.length,0);
});
