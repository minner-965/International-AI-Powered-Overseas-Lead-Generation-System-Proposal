// Batch 4 (optimization plan section 4): D1 opt-out line, D2 SPF/DKIM/DMARC check, D3 bounce and
// complaint pause, D4 warm-up pacing. No database, no DNS, no SMTP: every dependency is a double.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SenderHealth,healthDecision,pacingDecision,senderHealthConfig,warmupCap,DELIVERABILITY_HOLD_REASONS} from '../src/outreach/senderHealth.js';
import {checkSendingDomain,sendingDomainOf} from '../src/outreach/sendingDomainCheck.js';
import {AutoFirstTouchService} from '../src/outreach/AutoFirstTouchService.js';
import {CrmService} from '../src/crm/service.js';
import {OPT_OUT_FOOTER,renderFollowupTemplate} from '../src/crm/followupTemplates.js';
import {renderFirstTouchTemplate} from '../src/outreach/firstTouchTemplates.js';
import {MERCHANT_ROUTES,merchantRouteAllowed} from '../src/merchant/auth.js';
import {MERCHANT_API,merchantApiAllowed} from '../public/ui/v4/session.js';
import {createMerchantRouter} from '../src/merchant/router.js';
import {Phase13AutomationFacade} from '../src/automation/Phase13AutomationFacade.js';

const DAY=86_400_000;
const config=senderHealthConfig({});
const MERCHANT='11111111-1111-4111-8111-111111111111';

test('defaults: 100-message window, 3% bounce rate, 10 a day for 7 days then +1, 15 minutes apart',()=>{
  assert.deepEqual(config,{window:100,pauseRate:0.03,minBounces:2,warmupEnabled:true,warmupStart:10,warmupDays:7,warmupIncrease:1,minIntervalMinutes:15});
  const custom=senderHealthConfig({SENDER_BOUNCE_PAUSE_RATE:'0.05',SENDER_WARMUP_ENABLED:'false',SENDER_MIN_INTERVAL_MINUTES:'0',SENDER_HEALTH_WINDOW:'abc'});
  assert.equal(custom.pauseRate,0.05);assert.equal(custom.warmupEnabled,false);assert.equal(custom.minIntervalMinutes,0);assert.equal(custom.window,100);
});

test('D3 decision: a complaint pauses; bounces pause only above 3% and from two bounces on',()=>{
  assert.equal(healthDecision({sent:100,hard_bounces:0,complaints:1},config).reason,'COMPLAINT_RECEIVED');
  assert.equal(healthDecision({sent:50,hard_bounces:2,complaints:0},config).reason,'BOUNCE_RATE_HIGH');
  assert.equal(healthDecision({sent:100,hard_bounces:3,complaints:0},config).healthy,true,'exactly 3% is not above 3%');
  assert.equal(healthDecision({sent:100,hard_bounces:4,complaints:0},config).reason,'BOUNCE_RATE_HIGH');
  assert.equal(healthDecision({sent:5,hard_bounces:1,complaints:0},config).healthy,true,'one bad address cannot pause a new mailbox');
  assert.equal(healthDecision({sent:0,hard_bounces:0,complaints:0},config).healthy,true);
});

test('D4 warm-up: 10 a day in the first 7 days, then one more each day',()=>{
  const now=new Date('2026-11-10T12:00:00Z');
  assert.equal(warmupCap(null,now,config),10);
  assert.equal(warmupCap(new Date(now-3*DAY),now,config),10);
  assert.equal(warmupCap(new Date(now-6.9*DAY),now,config),10);
  assert.equal(warmupCap(new Date(now-7*DAY),now,config),11);
  assert.equal(warmupCap(new Date(now-10*DAY),now,config),14);
});

test('D4 pacing: day cap and 15-minute spacing hold an automatic first touch',()=>{
  const now=new Date('2026-11-10T12:00:00Z');
  assert.equal(pacingDecision({first_sent_at:new Date(now-DAY),sent_today:10,last_sent_at:new Date(now-60*60_000)},now,config).code,'SENDER_WARMUP_DAY_LIMIT');
  const spaced=pacingDecision({first_sent_at:new Date(now-DAY),sent_today:3,last_sent_at:new Date(now-5*60_000)},now,config);
  assert.equal(spaced.code,'SENDER_MIN_INTERVAL');assert.equal(spaced.next_allowed_at,new Date(now.getTime()+10*60_000).toISOString());
  assert.equal(pacingDecision({first_sent_at:new Date(now-DAY),sent_today:3,last_sent_at:new Date(now-16*60_000)},now,config).ok,true);
  assert.equal(pacingDecision({first_sent_at:null,sent_today:0,last_sent_at:null},now,config).ok,true);
  assert.equal(pacingDecision({first_sent_at:new Date(now-DAY),sent_today:50,last_sent_at:null},now,{...config,warmupEnabled:false}).ok,true);
});

// A SenderHealth whose database answers are fixed numbers.
function healthFixture({metrics={sent:0,hard_bounces:0,complaints:0},pacing={first_sent_at:null,sent_today:0,last_sent_at:null},last=null}={}){
  const calls={inserts:[],holds:[],pauses:[],updates:[]};
  const pool={async query(sql,values){
    if(sql.includes('FROM leadgen.sender_health_events')&&sql.includes('LIMIT 1'))return{rows:last?[last]:[]};
    if(sql.startsWith('WITH since'))return{rows:[{...metrics,since:null}]};
    if(sql.includes('first_sent_at'))return{rows:[pacing]};
    if(sql.startsWith('INSERT INTO leadgen.sender_health_events'))calls.inserts.push(values);
    if(sql.startsWith('UPDATE leadgen.merchant_mailboxes'))calls.updates.push(values);
    return{rows:[]};
  }};
  const health=new SenderHealth({pool,env:{},now:()=>new Date('2026-11-10T12:00:00Z'),
    merchants:{async holdMailbox(id,reason){calls.holds.push([id,reason]);}},
    automationControl:{async pauseEmail(reason){calls.pauses.push(reason);}}});
  return{health,calls};
}

test('D3: a merchant over the bounce rate is held (only that mailbox) and the pause is recorded once',async()=>{
  const f=healthFixture({metrics:{sent:40,hard_bounces:3,complaints:0}});
  const gate=await f.health.healthGate(MERCHANT);
  assert.equal(gate.ok,false);assert.equal(gate.code,'SENDER_BOUNCE_RATE_HIGH');
  assert.deepEqual(f.calls.holds,[[MERCHANT,'BOUNCE_RATE_HIGH']]);assert.deepEqual(f.calls.pauses,[],'SIM sending is untouched');
  assert.equal(f.calls.inserts.length,1);assert.equal(f.calls.inserts[0][0],MERCHANT);assert.equal(f.calls.inserts[0][2],'BOUNCE_RATE_HIGH');
  const paused=healthFixture({metrics:{sent:40,hard_bounces:3,complaints:0},last:{event_type:'PAUSED',reason:'BOUNCE_RATE_HIGH'}});
  await paused.health.healthGate(MERCHANT);assert.equal(paused.calls.inserts.length,0,'no duplicate pause rows');
});

test('D3: SIM pauses through the email switch with a SENDER_ reason',async()=>{
  const f=healthFixture({metrics:{sent:100,hard_bounces:0,complaints:1}});
  const gate=await f.health.healthGate(null);
  assert.equal(gate.code,'SENDER_COMPLAINT_RECEIVED');assert.deepEqual(f.calls.pauses,['SENDER_COMPLAINT_RECEIVED']);
  assert.deepEqual(f.calls.holds,[]);assert.equal(f.calls.inserts[0][0],'SIM');assert.equal(f.calls.inserts[0][1],null);
});

test('D3/D4: first-touch gate checks health first, then pacing',async()=>{
  assert.equal((await healthFixture({pacing:{first_sent_at:null,sent_today:10,last_sent_at:null}}).health.firstTouchGate(MERCHANT)).code,'SENDER_WARMUP_DAY_LIMIT');
  assert.equal((await healthFixture({metrics:{sent:10,hard_bounces:5,complaints:0},pacing:{first_sent_at:null,sent_today:10,last_sent_at:null}}).health.firstTouchGate(MERCHANT)).code,'SENDER_BOUNCE_RATE_HIGH');
  assert.equal((await healthFixture().health.firstTouchGate(MERCHANT)).ok,true);
});

test('D3 resume: lifts only a deliverability hold and records who resumed',async()=>{
  const f=healthFixture();
  await f.health.resume(MERCHANT,{actor:'anna@alpha.example',note:'Removed bad addresses'});
  assert.deepEqual(f.calls.updates[0],[MERCHANT,[...DELIVERABILITY_HOLD_REASONS]]);
  const row=f.calls.inserts[0];assert.equal(row[0],MERCHANT);assert.equal(row[2],'Removed bad addresses');assert.equal(row[4],'anna@alpha.example');
});

test('automatic first touch stops at the sender gate before any eligibility read',async()=>{
  let evaluated=0;const seen=[];
  const service=new AutoFirstTouchService({senderHealth:{async firstTouchGate(id){seen.push(id);return{ok:false,code:'SENDER_MIN_INTERVAL'};}}});
  service.evaluate=async()=>{evaluated++;return{eligibility:{eligible:false}};};
  await assert.rejects(service.reserve('company'),{code:'SENDER_MIN_INTERVAL'});
  assert.deepEqual(seen,[null]);assert.equal(evaluated,0);
});

test('a paused mailbox holds an approved follow-up (SIM and merchant)',async()=>{
  const pool={async query(sql){if(sql.startsWith('SELECT merchant_id FROM leadgen.crm_followup_drafts'))return{rows:[{merchant_id:null}]};return{rows:[]};}};
  const sim=new CrmService({pool,outboundProvider:{senderEmail:'simon@sim.example'},automationControl:{async getState(){return{sim_sender_paused:false};}},
    senderHealth:{async healthGate(owner){assert.equal(owner,null);return{ok:false,code:'SENDER_BOUNCE_RATE_HIGH'};}}});
  assert.deepEqual(await sim.sendApprovedFollowup({draft_id:'22222222-2222-4222-8222-222222222222'}),{status:'WAITING',code:'SENDER_BOUNCE_RATE_HIGH',draft_id:'22222222-2222-4222-8222-222222222222'});
  const merchantPool={async query(sql){if(sql.startsWith('SELECT merchant_id FROM leadgen.crm_followup_drafts'))return{rows:[{merchant_id:MERCHANT}]};return{rows:[]};}};
  const held=new CrmService({pool:merchantPool,merchantSending:{async providerFor(){return{provider:{senderEmail:'anna@alpha.example'},mailbox:{sending_hold_reason:'COMPLAINT_RECEIVED'}};}}});
  assert.equal((await held.sendApprovedFollowup({draft_id:'22222222-2222-4222-8222-222222222222'})).code,'MERCHANT_MAILBOX_PAUSED');
});

test('turning SIM email back on after a sender pause records the resume; other pauses do not',async()=>{
  const inserts=[];
  const facade=Object.create(Phase13AutomationFacade.prototype);
  facade.pool={async query(sql,values){if(sql.startsWith('INSERT INTO leadgen.sender_health_events'))inserts.push(values);return{rows:[]};}};
  await facade.recordSenderResume({enabled:false,settings:{paused_reason:'SENDER_BOUNCE_RATE_HIGH'}},'simon');
  await facade.recordSenderResume({enabled:false,settings:{paused_reason:'SMTP_SEND_INTERRUPTED'}},'simon');
  await facade.recordSenderResume({enabled:true,settings:{}},'simon');
  assert.equal(inserts.length,1);assert.deepEqual(inserts[0],['EMAIL_ON_AFTER_SENDER_BOUNCE_RATE_HIGH','simon']);
});

// ---- D2 ----
function resolverOf(records){
  return{async resolveTxt(name){if(name in records){const value=records[name];if(value instanceof Error)throw value;return value;}
    throw Object.assign(new Error('not found'),{code:'ENOTFOUND'});}};
}
test('D2: SPF, DKIM (common selector) and DMARC found',async()=>{
  const result=await checkSendingDomain('anna@Alpha.example',{resolver:resolverOf({
    'alpha.example':[['v=spf1 include:_spf.example.net ~all'],['google-site-verification=x']],
    '_dmarc.alpha.example':[['v=DMARC1; p=quarantine; rua=mailto:d@alpha.example']],
    'selector1._domainkey.alpha.example':[['v=DKIM1; k=rsa; p=MIGf','MA0GCSqG']]})});
  assert.equal(result.domain,'alpha.example');assert.equal(result.status,'OK');
  assert.equal(result.spf.status,'FOUND');assert.equal(result.dmarc.policy,'quarantine');assert.deepEqual(result.dkim,{status:'FOUND',selector:'selector1'});
});
test('D2: missing records, two SPF records and a failed lookup are reported, not thrown',async()=>{
  const result=await checkSendingDomain('beta.example',{resolver:resolverOf({
    'beta.example':[['v=spf1 -all'],['v=spf1 include:x ~all']],
    '_dmarc.beta.example':Object.assign(new Error('timeout'),{code:'ETIMEOUT'})})});
  assert.equal(result.status,'NEEDS_ATTENTION');assert.equal(result.spf.status,'MULTIPLE');
  assert.deepEqual(result.dmarc,{status:'LOOKUP_FAILED',code:'ETIMEOUT'});assert.equal(result.dkim.status,'NOT_FOUND_COMMON_SELECTORS');
  assert.equal((await checkSendingDomain('not a domain')).status,'INVALID_DOMAIN');
  assert.equal(sendingDomainOf('x@-bad.example'),null);assert.equal(sendingDomainOf('Sales@Gamma.Example'),'gamma.example');
});

// ---- D1 ----
test('D1: introductory and follow-up emails end with the visible opt-out line',()=>{
  const variables={category:'Tops',target_category:'tops',company:'Acme',matched_category:'tops',market:'UAE',reply_to:'simon@sim.example'};
  const first=renderFirstTouchTemplate({template_key:'C_OFFICIAL_GENERIC_MAILBOX',variables,verified_fields:Object.keys(variables)});
  assert.ok(first.body_text.endsWith(`simon@sim.example\n\n${OPT_OUT_FOOTER}`));
  const followup=renderFollowupTemplate({sequence_no:2,company_name:'Acme',product_profile:'WOMENSWEAR',reply_to:'simon@sim.example'});
  assert.ok(followup.body_text.endsWith(`\n\n${OPT_OUT_FOOTER}`));assert.match(OPT_OUT_FOOTER,/reply "unsubscribe"/);
});

// ---- routes ----
test('merchant routes: deliverability and resume are allowed; the browser copy matches the server list',()=>{
  assert.equal(merchantRouteAllowed('GET','/api/merchant/mailbox/deliverability'),true);
  assert.equal(merchantRouteAllowed('POST','/api/merchant/mailbox/resume-sending'),true);
  assert.equal(merchantRouteAllowed('GET','/api/admin/sender-health'),false);
  assert.equal(merchantApiAllowed('PUT','/api/merchant/auto-first-touch'),true,'merchant opt-in switch reaches the server');
  const server=MERCHANT_ROUTES.map(([m,re])=>`${m} ${re.source}`).sort();
  const browser=MERCHANT_API.map(([m,re])=>`${m} ${new RegExp(re,'i').source}`).sort();
  assert.deepEqual(browser,server);
});

async function callRoute(router,method,path,{user={role:'MERCHANT',merchant_id:MERCHANT,email:'anna@alpha.example'},body={}}={}){
  const layer=router.stack.find(item=>item.route?.path===path&&item.route.methods[method]);
  assert.ok(layer,`${method} ${path}`);
  let out=null;const res={status(code){this.code=code;return this;},json(payload){out={status:this.code||200,body:payload};}};
  await new Promise((resolve,reject)=>{const next=error=>error?reject(error):resolve();
    Promise.resolve(layer.route.stack.at(-1).handle({workspaceUser:user,query:{},body,params:{}},Object.assign(res,{json(p){out={status:this.code||200,body:p};resolve();}}),next)).catch(reject);});
  return out;
}
test('resume is refused unless the mailbox is paused for bounces or a complaint',async()=>{
  const resumed=[];
  const merchants={pool:{query:async()=>({rows:[]})},async mailbox(){return{configured:true,from_email:'anna@alpha.example',sending_hold:{reason:'SMTP_SEND_INTERRUPTED'}};}};
  const router=createMerchantRouter({merchants,senderHealth:{async resume(id,opts){resumed.push([id,opts]);return{healthy:true};}}});
  await assert.rejects(callRoute(router,'post','/api/merchant/mailbox/resume-sending'),{code:'SENDER_NOT_PAUSED'});
  merchants.mailbox=async()=>({configured:true,from_email:'anna@alpha.example',sending_hold:{reason:'BOUNCE_RATE_HIGH'}});
  const out=await callRoute(router,'post','/api/merchant/mailbox/resume-sending',{body:{note:'Cleaned the list'}});
  assert.equal(out.status,200);assert.deepEqual(resumed,[[MERCHANT,{actor:'anna@alpha.example',note:'Cleaned the list'}]]);
});
test('deliverability report combines health, hold and the DNS check of the mailbox domain',async()=>{
  const checked=[];
  const merchants={pool:{query:async()=>({rows:[]})},async mailbox(){return{configured:true,from_email:'anna@alpha.example',sending_hold:null};}};
  const router=createMerchantRouter({merchants,senderHealth:{async status(id){return{sender:'MERCHANT',id};}},checkDomain:async email=>{checked.push(email);return{status:'OK'};}});
  const out=await callRoute(router,'get','/api/merchant/mailbox/deliverability');
  assert.deepEqual(out.body,{health:{sender:'MERCHANT',id:MERCHANT},dns:{status:'OK'},hold:null});assert.deepEqual(checked,['anna@alpha.example']);
});
