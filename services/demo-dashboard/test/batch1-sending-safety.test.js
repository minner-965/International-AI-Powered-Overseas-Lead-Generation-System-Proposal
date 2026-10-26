// Batch 1 sending safety (optimization plan A3, A4, A5, A6-inbound). Pure unit tests:
// every database, SMTP/IMAP and queue dependency is an in-process double.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {simFirstTouchCandidates,merchantFirstTouchCandidates,SIM_FIRST_TOUCH_CANDIDATES_SQL,MERCHANT_FIRST_TOUCH_CANDIDATES_SQL} from '../src/outreach/firstTouchCandidates.js';
import {loadPhase13EmailEligibilityFacts,RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS} from '../src/outreach/Phase13EmailFactLoader.js';
import {evaluatePhase13EmailEligibility} from '../src/outreach/phase13EmailEligibility.js';
import {FIRST_TOUCH_TEMPLATE_SET} from '../src/outreach/firstTouchTemplates.js';
import {AutoFirstTouchService} from '../src/outreach/AutoFirstTouchService.js';
import {MerchantService,MAILBOX_TEST_FAILURE_LIMIT} from '../src/merchant/MerchantService.js';
import {merchantRouteAllowed} from '../src/merchant/auth.js';
import {createMerchantRouter} from '../src/merchant/router.js';
import {Phase7Service} from '../src/phase7/service.js';
import {testAndRefresh,autoSendModel} from '../public/ui/v4/mailbox.js';
import {autoSendState} from '../public/ui/v4/merchants-admin.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const MERCHANT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY='8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db';
const SECRET=crypto.randomBytes(32).toString('hex');
const DAY=86_400_000;

// ---------- A3: candidates ----------
test('A3: SIM first-touch candidates exclude companies assigned to any merchant',async()=>{
  const calls=[];const db={async query(sql,values){calls.push({sql,values});return{rows:[{company_id:COMPANY}]};}};
  const rows=await simFirstTouchCandidates(db,{allowedBands:['PRECISION'],limit:50});
  assert.deepEqual(rows,[{company_id:COMPANY}]);
  assert.match(calls[0].sql,/NOT EXISTS\(SELECT 1 FROM leadgen\.merchant_companies mc WHERE mc\.company_id=p\.company_id\)/);
  assert.match(calls[0].sql,/r\.merchant_id IS NULL/);
  assert.deepEqual(calls[0].values,[['PRECISION'],50]);
});

test('A3: merchant candidates are only that merchant\'s assigned companies',async()=>{
  const calls=[];const db={async query(sql,values){calls.push({sql,values});return{rows:[]};}};
  await merchantFirstTouchCandidates(db,MERCHANT,{allowedBands:['RELEVANT'],limit:20});
  assert.match(calls[0].sql,/mc\.merchant_id=\$2/);assert.match(calls[0].sql,/r\.merchant_id=\$2/);
  assert.deepEqual(calls[0].values,[['RELEVANT'],MERCHANT,20]);
  await assert.rejects(merchantFirstTouchCandidates(db,null,{}),{code:'MERCHANT_REQUIRED'});
  assert.doesNotMatch(MERCHANT_FIRST_TOUCH_CANDIDATES_SQL,/merchant_id IS NULL/);
});

test('A3: server reconcile uses the candidate module instead of inline SQL',()=>{
  const server=read('../src/server.js');
  assert.match(server,/simFirstTouchCandidates\(pool,\{allowedBands:state\.allowed_bands,limit:50\}\)/);
  assert.match(server,/merchantFirstTouchCandidates\(pool,merchant\.id,\{allowedBands:state\.allowed_bands,limit:20\}\)/);
  assert.equal(server.includes('SELECT p.company_id FROM leadgen.merchant_companies mc'),false);
  assert.ok(SIM_FIRST_TOUCH_CANDIDATES_SQL.includes('LIMIT $2'));
});

// ---------- A3: cross-sender recipient cooldown ----------
const eligiblePolicy={mode:'AUTO_FIRST_TOUCH',automated_acquisition:true,auto_first_touch_email:true,template_set_key:FIRST_TOUCH_TEMPLATE_SET,
  template_set_status:'APPROVED',policy_revision:'MC07_DPV_FIRST_TOUCH_V1',allowed_markets:['AE'],allowed_category_ids:['cat'],sender_ready:true};
const eligibleFacts=(extra={})=>({company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},company_types:['IMPORTER'],
  recipient:{normalized_recipient:'info@buyer.example',recipient_type:'OFFICIAL_COMPANY_EMAIL',official_source_verified:true,domain_verified:true,
    lifecycle_status:'ACTIVE',verification_status:'VALID',verified_at:'2026-10-20T12:00:00Z',generic_mailbox:true},
  market:{market_code:'AE',status:'ACTIVE',search_enabled:true,timezone:'UTC',business_send_window:{days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}},
  category_id:'cat',opportunity_pool_band:'PRECISION',is_active_business_opportunity:true,...extra});

test('A3: a recipient first-touched by any sender in 30 days is blocked with RECIPIENT_RECENTLY_CONTACTED',()=>{
  const noon=new Date('2026-10-21T12:00:00Z');
  const base=evaluatePhase13EmailEligibility(eligibleFacts(),eligiblePolicy,noon);
  assert.deepEqual(base.reason_codes,[]);assert.equal(base.eligible,true);
  const blocked=evaluatePhase13EmailEligibility(eligibleFacts({recipient_recently_contacted:true}),eligiblePolicy,noon);
  assert.equal(blocked.eligible,false);assert.deepEqual(blocked.reason_codes,['RECIPIENT_RECENTLY_CONTACTED']);
  const assigned=evaluatePhase13EmailEligibility(eligibleFacts({company_assigned_to_merchant:true}),eligiblePolicy,noon);
  assert.deepEqual(assigned.reason_codes,['COMPANY_ASSIGNED_TO_MERCHANT']);
});

test('A3: the fact loader checks the recipient across every sender and maps the flags',async()=>{
  const calls=[];const row={id:COMPANY,company_name:'Buyer',normalized_recipient:'info@buyer.example',recipient_id:'fc5ff893-9faa-47ff-90ad-fe2b87529fd1',
    recipient_recently_contacted:true,company_assigned_to_merchant:false};
  const db={async query(sql,values){calls.push({sql,values});return{rowCount:1,rows:[row]};}};
  const facts=await loadPhase13EmailEligibilityFacts(db,COMPANY,{merchantId:MERCHANT});
  assert.equal(facts.recipient_recently_contacted,true);assert.equal(facts.company_assigned_to_merchant,false);
  const sql=calls[0].sql;
  const cooldown=sql.slice(sql.indexOf('lower(btrim(reservation.normalized_recipient))'),sql.indexOf('recipient_recently_contacted'));
  assert.ok(cooldown.length>0);
  assert.doesNotMatch(cooldown,/merchant_id/,'the recipient cooldown is not scoped to one sender');
  assert.match(cooldown,new RegExp(`make_interval\\(days=>${RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS}\\)`));
  assert.match(cooldown,/reservation\.id<>\$2/);
  assert.match(sql,/\(\$3::uuid IS NULL AND EXISTS\(SELECT 1 FROM leadgen\.merchant_companies assignment/);
  assert.equal(RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS,30);
});

test('A3/A4/A5: migration 069 replaces the reservation function and enforces the cross-sender rules',()=>{
  const sql=read('../../../database/migrations/069_merchant_sending_safety.sql');
  assert.match(sql,/^BEGIN;/);assert.match(sql.trim(),/COMMIT;$/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION leadgen\.reserve_phase13_first_touch\(/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS auto_first_touch_enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS sending_hold_reason text/);assert.match(sql,/ADD COLUMN IF NOT EXISTS consecutive_test_failures integer NOT NULL DEFAULT 0/);
  assert.match(sql,/CREATE OR REPLACE VIEW leadgen\.merchants_current/);
  const cooldown=sql.slice(sql.indexOf('-- A3: cross-sender recipient cooldown'),sql.indexOf("'RECIPIENT_RECENTLY_CONTACTED'"));
  assert.match(cooldown,/lower\(btrim\(r\.normalized_recipient\)\)=recipient_key/);assert.doesNotMatch(cooldown,/merchant_id/);
  assert.match(sql,/recipient_cooldown_days constant integer := 30/);
  assert.match(sql,/'MERCHANT_AUTO_FIRST_TOUCH_OFF'/);assert.match(sql,/'MERCHANT_MAILBOX_HELD'/);assert.match(sql,/'COMPANY_ASSIGNED_TO_MERCHANT'/);
  assert.match(sql,/phase13:first-touch:recipient:/);
  // Never rewrites the applied migration 066.
  assert.doesNotMatch(read('../../../database/migrations/066_merchant_accounts.sql'),/RECIPIENT_RECENTLY_CONTACTED|auto_first_touch_enabled/);
});

// ---------- A4: merchant opt-in ----------
function merchantSending({merchant={},mailbox={}}={}){
  const held=[];
  return{held,async providerFor(){return{provider:{senderEmail:'anna@alpha.example',replyToEmail:'anna@alpha.example',messageIdDomain:'alpha.example',async health(){return{ready:true};},async send(){throw new Error('must not send');}},
    merchant:{id:MERCHANT,auto_first_touch_enabled:false,...merchant},mailbox:{merchant_id:MERCHANT,verified_at:new Date(),sending_hold_at:null,...mailbox},
    sender:{sender_name:'Anna',company_name:'Alpha'},fromName:'Anna'};},
    async emailAllowance(){return{allowed:true,code:'ALLOWED',merchant:{id:MERCHANT,daily_email_quota:30,auto_first_touch_enabled:false,...merchant}};},
    async holdMailbox(id,reason){held.push([id,reason]);return{held:true,reason};}};
}

test('A4: a merchant without auto_first_touch_enabled gets no reservation',async()=>{
  let transactions=0,evaluated=0;
  const service=new AutoFirstTouchService({queue:{async enqueue(){throw new Error('no publish');}},merchantSending:merchantSending()});
  service.transaction=async()=>{transactions++;};service.evaluate=async()=>{evaluated++;return{eligibility:{eligible:true}};};
  await assert.rejects(service.reserve(COMPANY,{merchantId:MERCHANT}),{code:'MERCHANT_AUTO_FIRST_TOUCH_OFF'});
  assert.equal(transactions,0);assert.equal(evaluated,0);
  // Held mailbox: same, even with the opt-in.
  const held=new AutoFirstTouchService({merchantSending:merchantSending({merchant:{auto_first_touch_enabled:true},mailbox:{sending_hold_at:new Date()}})});
  held.transaction=async()=>{transactions++;};
  await assert.rejects(held.reserve(COMPANY,{merchantId:MERCHANT}),{code:'MERCHANT_MAILBOX_HELD'});assert.equal(transactions,0);
});

test('A4: the reservation transaction re-reads the opt-in before calling the database function',async()=>{
  const sql=[];const sending=merchantSending({merchant:{auto_first_touch_enabled:true}});
  // Switched off between the early check and the transaction.
  sending.emailAllowance=async()=>({allowed:true,code:'ALLOWED',merchant:{id:MERCHANT,daily_email_quota:30,auto_first_touch_enabled:false}});
  const service=new AutoFirstTouchService({merchantSending:sending});
  const variables={reply_to:'anna@alpha.example',company:'Buyer',category:'Tops',target_category:'Tops',matched_category:'Tops',market:'UAE'};
  service.evaluate=async()=>({facts:{recipient:{id:'r'},market:{market_code:'AE'},template_variables:variables,verified_template_fields:Object.keys(variables)},
    eligibility:{eligible:true,policy_revision:'v1',normalized_recipient:'info@buyer.example',template_key:'C_OFFICIAL_GENERIC_MAILBOX'}});
  service.transaction=async fn=>fn({async query(statement){sql.push(statement);return{rows:[]};}});
  await assert.rejects(service.reserve(COMPANY,{merchantId:MERCHANT}),{code:'MERCHANT_AUTO_FIRST_TOUCH_OFF'});
  assert.equal(sql.some(statement=>statement.includes('reserve_phase13_first_touch')),false);
});

test('A4: a queued merchant reservation is not sent while the merchant has switched off',async()=>{
  const service=new AutoFirstTouchService({merchantSending:merchantSending()});
  service.get=async()=>({id:'r1',status:'RESERVED',merchant_id:MERCHANT,company_id:COMPANY});
  service.evaluate=async()=>{throw new Error('must not evaluate');};
  const result=await service.sendReservation('r1');
  assert.equal(result.held,true);assert.deepEqual(result.reason_codes,['MERCHANT_AUTO_FIRST_TOUCH_OFF']);assert.equal(result.reservation.status,'RESERVED');
});

function fakePool(handler){
  const calls=[];
  const run=async(sql,values=[])=>{calls.push({sql,values});return (await handler(sql,values))||{rows:[],rowCount:0};};
  return{calls,query:run,async connect(){return{query:run,release(){}};}};
}
const merchantRow=(extra={})=>({id:MERCHANT,company_name:'Alpha',sender_name:'Anna',status:'TRIAL',trial_ends_at:new Date(Date.now()+5*DAY).toISOString(),paid_until:null,
  features:{research:true,email:true},auto_first_touch_enabled:false,monthly_search_quota:300,daily_email_quota:30,...extra});

test('A4: sendingMerchants requires the opt-in and an unheld mailbox; inboundMerchants includes expired accounts',async()=>{
  const pool=fakePool(()=>({rows:[]}));const service=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET}});
  await service.sendingMerchants();await service.inboundMerchants();
  const [sending,inbound]=pool.calls.map(call=>call.sql);
  assert.match(sending,/effective_status IN\('TRIAL','ACTIVE'\)/);assert.match(sending,/m\.auto_first_touch_enabled/);assert.match(sending,/b\.sending_hold_at IS NULL/);
  assert.doesNotMatch(sending,/EXPIRED/);
  assert.match(inbound,/effective_status IN\('TRIAL','ACTIVE','EXPIRED'\)/);assert.match(inbound,/b\.verified_at IS NOT NULL/);
  assert.doesNotMatch(inbound,/auto_first_touch_enabled|sending_hold_at|DISABLED/);
});

test('A4: switching on needs a verified mailbox and an account that can send; switching off is always allowed',async()=>{
  let merchant=merchantRow();let mailbox=null;const updates=[];
  const pool=fakePool((sql,values)=>{
    if(sql.startsWith('SELECT * FROM leadgen.merchants WHERE id=$1'))return{rows:[merchant]};
    if(sql.startsWith('SELECT * FROM leadgen.merchant_mailboxes'))return{rows:mailbox?[mailbox]:[]};
    if(sql.includes('UPDATE leadgen.merchants SET auto_first_touch_enabled')){updates.push(values);return{rows:[],rowCount:1};}
  });
  const service=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET}});
  await assert.rejects(service.setAutoFirstTouch(MERCHANT,true,'anna@alpha.example'),{code:'MERCHANT_MAILBOX_NOT_VERIFIED',status:409});
  await assert.rejects(service.setAutoFirstTouch(MERCHANT,'yes','anna@alpha.example'),{code:'MERCHANT_AUTO_FIRST_TOUCH_INVALID'});
  mailbox={merchant_id:MERCHANT,verified_at:new Date().toISOString(),last_test:{},from_email:'anna@alpha.example'};
  merchant=merchantRow({status:'TRIAL',trial_ends_at:new Date(Date.now()-DAY).toISOString()});
  await assert.rejects(service.setAutoFirstTouch(MERCHANT,true,'anna@alpha.example'),{code:'MERCHANT_READ_ONLY',status:403});
  merchant=merchantRow({features:{email:false}});
  await assert.rejects(service.setAutoFirstTouch(MERCHANT,true,'anna@alpha.example'),{code:'MERCHANT_FEATURE_DISABLED'});
  assert.equal(updates.length,0);
  merchant=merchantRow();
  const on=await service.setAutoFirstTouch(MERCHANT,true,'anna@alpha.example');
  assert.equal(on.auto_first_touch.enabled,true);assert.equal(on.auto_first_touch.active,true);assert.deepEqual(updates.at(-1),[MERCHANT,true,'anna@alpha.example']);
  mailbox=null;merchant=merchantRow({auto_first_touch_enabled:true});
  const off=await service.setAutoFirstTouch(MERCHANT,false,'anna@alpha.example');
  assert.equal(off.auto_first_touch.enabled,false);assert.deepEqual(updates.at(-1),[MERCHANT,false,'anna@alpha.example']);
});

test('A4: the merchant may call the switch route; SIM administrators see it read-only',async()=>{
  assert.equal(merchantRouteAllowed('PUT','/api/merchant/auto-first-touch'),true);
  assert.equal(merchantRouteAllowed('POST','/api/merchant/auto-first-touch'),false);
  const calls=[];
  const merchants={pool:{query:async()=>({rows:[],rowCount:0})},async setAutoFirstTouch(...args){calls.push(args);return{auto_first_touch:{enabled:args[1]}};}};
  const router=createMerchantRouter({merchants,env:{AUTH_REQUIRED:'true'}});
  const layer=router.stack.find(item=>item.route?.path==='/api/merchant/auto-first-touch'&&item.route.methods.put);
  assert.ok(layer,'route registered');
  const invoke=user=>new Promise((resolve,reject)=>{
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){resolve({status:this.statusCode,body});}};
    const handler=layer.route.stack.at(-1).handle;
    handler({workspaceUser:user,body:{enabled:true},query:{}},res,error=>error?resolve({error}):reject(new Error('no response')));
  });
  const admin=await invoke({role:'ADMIN',email:'simon@sim.example'});
  assert.equal(admin.error?.code,'MERCHANT_SELF_SERVICE_ONLY');assert.equal(admin.error?.status,403);assert.equal(calls.length,0);
  const merchant=await invoke({role:'MERCHANT',merchant_id:MERCHANT,email:'anna@alpha.example'});
  assert.equal(merchant.body.auto_first_touch.enabled,true);assert.deepEqual(calls[0],[MERCHANT,true,'anna@alpha.example']);
});

// ---------- A5: failure isolation ----------
function stalledService(rows){
  const paused=[];const held=[];
  const service=new AutoFirstTouchService({automationControl:{async pauseEmail(reason){paused.push(reason);}},
    merchantSending:{async holdMailbox(id,reason){held.push([id,reason]);return{held:true};}}});
  service.transaction=async fn=>fn({async query(sql){return sql.includes('RETURNING id,merchant_id')?{rows}:{rows:[]};}});
  return{service,paused,held};
}

test('A5: a stalled merchant reservation holds only that merchant and leaves the global email control on',async()=>{
  const {service,paused,held}=stalledService([{id:'r1',merchant_id:MERCHANT},{id:'r2',merchant_id:MERCHANT}]);
  const result=await service.recoverStalledReservations();
  assert.deepEqual(paused,[]);assert.deepEqual(held,[[MERCHANT,'SMTP_SEND_INTERRUPTED']]);
  assert.deepEqual(result,{ambiguous_reservations:['r1','r2'],email_paused:false,held_merchants:[MERCHANT]});
});

test('A5: a stalled SIM reservation still pauses SIM automatic first touch',async()=>{
  const {service,paused,held}=stalledService([{id:'r3',merchant_id:null}]);
  const result=await service.recoverStalledReservations();
  assert.deepEqual(paused,['SMTP_SEND_INTERRUPTED']);assert.deepEqual(held,[]);assert.equal(result.email_paused,true);
  const none=stalledService([]);await none.service.recoverStalledReservations();assert.deepEqual(none.paused,[]);
});

test('A5: holdMailbox records a hold on the merchant mailbox only',async()=>{
  const pool=fakePool(()=>({rows:[{merchant_id:MERCHANT}],rowCount:1}));
  const service=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET}});
  assert.deepEqual(await service.holdMailbox(MERCHANT,'SMTP_SEND_INTERRUPTED'),{held:true,reason:'SMTP_SEND_INTERRUPTED'});
  assert.match(pool.calls[0].sql,/UPDATE leadgen\.merchant_mailboxes SET sending_hold_reason=\$2,sending_hold_at=coalesce\(sending_hold_at,now\(\)\)/);
  assert.deepEqual(pool.calls[0].values,[MERCHANT,'SMTP_SEND_INTERRUPTED']);
});

function mailboxHarness(results){
  const service=new MerchantService({pool:{query(){}},env:{MERCHANT_SECRET_KEY:SECRET},providerFactory:()=>({async testConnections(){return results.shift();}})});
  const box={merchant_id:MERCHANT,smtp_host:'smtp.alpha.example',smtp_port:587,imap_host:'imap.alpha.example',imap_port:993,username:'anna@alpha.example',
    from_email:'anna@alpha.example',reply_to:'anna@alpha.example',password_ciphertext:service.secretBox.encrypt('pw',`merchant-mailbox:${MERCHANT}`),
    verified_at:'2026-10-20T08:00:00.000Z',last_test:{},consecutive_test_failures:0,sending_hold_reason:null,sending_hold_at:null};
  service.pool=fakePool((sql,values)=>{
    if(sql.startsWith('SELECT * FROM leadgen.merchant_mailboxes'))return{rows:[{...box}]};
    if(sql.startsWith('SELECT * FROM leadgen.merchants'))return{rows:[merchantRow()]};
    if(sql.startsWith('UPDATE leadgen.merchant_mailboxes SET last_test')){
      const [,lastTest,ok,failures,clear]=values;
      box.last_test=JSON.parse(lastTest);box.consecutive_test_failures=failures;
      box.verified_at=ok?new Date().toISOString():clear?null:box.verified_at;
      if(ok){box.sending_hold_reason=null;box.sending_hold_at=null;}
      return{rows:[{verified_at:box.verified_at}],rowCount:1};
    }
  });
  return{service,box};
}
const failed={smtp:{ok:false,code:'SMTP_TIMEOUT'},imap:{ok:true}};const passed={smtp:{ok:true},imap:{ok:true}};

test('A5: one failed connection test keeps verified_at; three in a row clear it; a success resets the count',async()=>{
  assert.equal(MAILBOX_TEST_FAILURE_LIMIT,3);
  const {service,box}=mailboxHarness([failed,failed,passed,failed,failed,failed]);
  const first=await service.testConnection(MERCHANT);
  assert.equal(first.ok,false);assert.equal(first.verified,true);assert.equal(first.consecutive_failures,1);assert.equal(first.failures_until_unverified,2);
  assert.ok(box.verified_at);assert.equal(box.last_test.smtp.code,'SMTP_TIMEOUT');
  await service.testConnection(MERCHANT);assert.ok(box.verified_at);assert.equal(box.consecutive_test_failures,2);
  const ok=await service.testConnection(MERCHANT);assert.equal(ok.ok,true);assert.equal(box.consecutive_test_failures,0);assert.ok(box.verified_at);
  await service.testConnection(MERCHANT);await service.testConnection(MERCHANT);assert.ok(box.verified_at);
  const third=await service.testConnection(MERCHANT);
  assert.equal(third.verified,false);assert.equal(third.consecutive_failures,3);assert.equal(box.verified_at,null);
});

test('A5: a successful test lifts a sending hold; changed credentials reset the failure count',async()=>{
  const {service,box}=mailboxHarness([passed]);
  Object.assign(box,{sending_hold_reason:'SMTP_SEND_INTERRUPTED',sending_hold_at:new Date().toISOString(),consecutive_test_failures:2});
  await service.testConnection(MERCHANT);
  assert.equal(box.sending_hold_at,null);assert.equal(box.consecutive_test_failures,0);
  const source=read('../src/merchant/MerchantService.js');
  assert.match(source,/consecutive_test_failures=CASE WHEN \$13 THEN 0 ELSE leadgen\.merchant_mailboxes\.consecutive_test_failures END/);
  assert.match(source,/verified_at=CASE WHEN \$13 THEN NULL ELSE leadgen\.merchant_mailboxes\.verified_at END/);
});

test('A5: mailbox view exposes the hold, failure count and the automatic first email state',()=>{
  const service=new MerchantService({pool:{query(){}},env:{MERCHANT_SECRET_KEY:SECRET}});
  const view=service.mailboxView({merchant_id:MERCHANT,from_email:'a@b.example',verified_at:'2026-10-20T08:00:00Z',last_test:{},consecutive_test_failures:1,
    sending_hold_reason:'SMTP_SEND_INTERRUPTED',sending_hold_at:'2026-10-21T08:00:00Z',password_ciphertext:'v1:x'});
  assert.equal(view.consecutive_test_failures,1);assert.deepEqual(view.sending_hold,{reason:'SMTP_SEND_INTERRUPTED',at:'2026-10-21T08:00:00Z'});
  assert.equal(service.mailboxView(null).sending_hold,null);
  const auto=service.autoFirstTouchView(merchantRow({auto_first_touch_enabled:true}),{verified_at:new Date(),sending_hold_at:new Date()});
  assert.deepEqual(auto,{enabled:true,can_enable:true,blocked_reason:null,active:false});
});

// ---------- A6: inbound for expired merchants ----------
test('A6: reply sync reads mailboxes of the inbound list (expired merchants included), never the sending list',async()=>{
  const synced=[];const providers=[];
  const merchantSending={
    async sendingMerchants(){throw new Error('sending list must not drive inbound sync');},
    async inboundMerchants(){return[{id:MERCHANT,effective_status:'EXPIRED'}];},
    async providerFor(id){providers.push(id);return{provider:{},mailbox:{username:'Anna@Alpha.example'}};}
  };
  const fakeThis={async syncImapMailbox(args){synced.push(args);return{status:'COMPLETED',messages:0};}};
  const result=await Phase7Service.prototype.syncMerchantInboundWork.call(fakeThis,merchantSending);
  assert.equal(result.mailboxes,1);assert.deepEqual(providers,[MERCHANT]);
  assert.equal(synced[0].merchantId,MERCHANT);assert.equal(synced[0].mailbox,'anna@alpha.example');
});

// ---------- UI: mailbox page and admin page ----------
test('mailbox page: Test connection always re-reads the stored mailbox (success, failure, error)',async()=>{
  const stored={configured:true,verified_at:'2026-10-20T08:00:00Z',consecutive_test_failures:1};
  for(const outcome of ['success','failure','error']){
    const order=[];
    const request=async url=>{order.push(url);if(outcome==='error')throw Object.assign(new Error('x'),{status:502});return outcome==='success'?passed:failed;};
    const fetchMailbox=async()=>{order.push('GET /api/merchant/mailbox');return stored;};
    const {result,error,mailbox}=await testAndRefresh(request,fetchMailbox);
    assert.deepEqual(order,['/api/merchant/mailbox/test-connection','GET /api/merchant/mailbox'],outcome);
    assert.equal(mailbox,stored);
    if(outcome==='error'){assert.equal(error.status,502);assert.equal(result,null);}else assert.equal(error,null);
  }
  const unreadable=await testAndRefresh(async()=>passed,async()=>{throw new Error('offline');});
  assert.equal(unreadable.mailbox,null);assert.equal(unreadable.result,passed);
});

test('mailbox page: the automatic first email switch is only usable after verification',()=>{
  const off=autoSendModel({verified_at:null,auto_first_touch:{enabled:false,can_enable:false,blocked_reason:'MERCHANT_MAILBOX_NOT_VERIFIED'}});
  assert.equal(off.disabled,true);assert.match(off.note[0],/验证通过后才能开启/);
  const ready=autoSendModel({verified_at:'2026-10-20T08:00:00Z',auto_first_touch:{enabled:false,can_enable:true,blocked_reason:null}});
  assert.equal(ready.disabled,false);assert.equal(ready.enabled,false);
  const on=autoSendModel({verified_at:'2026-10-20T08:00:00Z',auto_first_touch:{enabled:true,can_enable:true,blocked_reason:null}});
  assert.equal(on.active,true);assert.equal(on.disabled,false);
  const held=autoSendModel({verified_at:'2026-10-20T08:00:00Z',sending_hold:{reason:'SMTP_SEND_INTERRUPTED'},auto_first_touch:{enabled:true,can_enable:true}});
  assert.equal(held.active,false);assert.match(held.note[0],/测试连接/);
  // An enabled switch whose mailbox lost verification can still be turned off.
  const lapsed=autoSendModel({verified_at:null,auto_first_touch:{enabled:true,can_enable:false,blocked_reason:'MERCHANT_MAILBOX_NOT_VERIFIED'}});
  assert.equal(lapsed.disabled,false);
  assert.equal(autoSendModel({verified_at:'x',auto_first_touch:{enabled:true}},{readOnly:true}).disabled,true);
  const source=read('../public/ui/v4/mailbox.js');
  assert.match(source,/class="v4-switch"\$\{tip\(/);assert.match(source,/data-auto-first-touch/);assert.match(source,/'\/api\/merchant\/auto-first-touch'/);
  assert.match(source,/bi\('自动发送开发信', 'Automatic first emails'\)/);
  assert.doesNotMatch(source,/verified_at: state\.mailbox\?\.verified_at \|\| new Date\(\)\.toISOString\(\)/,'no local patching of verification');
});

test('admin merchants page shows the automatic first email state read-only',()=>{
  assert.deepEqual(autoSendState({mailbox:{configured:false}}).zh,'未绑定发信邮箱');
  assert.equal(autoSendState({mailbox:{configured:true,verified_at:null}}).tone,'warn');
  assert.match(autoSendState({mailbox:{configured:true,verified_at:'x',sending_hold:{reason:'SMTP_SEND_INTERRUPTED'}}}).zh,/暂停/);
  assert.equal(autoSendState({auto_first_touch_enabled:true,mailbox:{configured:true,verified_at:'x'}}).tone,'ok');
  assert.match(autoSendState({auto_first_touch_enabled:false,mailbox:{configured:true,verified_at:'x'}}).zh,/未开启/);
  const source=read('../public/ui/v4/merchants-admin.js');
  assert.doesNotMatch(source,/auto-first-touch/,'admin page never switches the merchant setting');
});
