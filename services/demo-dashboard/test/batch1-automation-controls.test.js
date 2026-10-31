import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {AutomationControlService,AUTOMATION_CONTROLS} from '../src/automation/AutomationControlService.js';
import {Phase13AutomationFacade,AUTOMATION_SUBSYSTEMS} from '../src/automation/Phase13AutomationFacade.js';
import {createAutomationRouter} from '../src/automation/router.js';
import {ContactResearchReconciler} from '../src/automation/ContactResearchReconciler.js';
import {ResearchDirectDispatchService} from '../src/research/ResearchDirectDispatchService.js';
import {evaluatePhase13EmailEligibility} from '../src/outreach/phase13EmailEligibility.js';
import {CrmService,countColdOutreachToday} from '../src/crm/service.js';
import {normalizeAutomationControl} from '../public/ui/v3/automation-model.js';

// In-memory automation_controls / automation_control_events / phase13_first_touch_controls.
// No database, no provider: every external dependency in this file is an in-process double.
function controlStore({contact=true}={}){
  const rows=new Map();const events=[];const policy={policy_revision:'MC07_DPV_FIRST_TOUCH_V1',enabled:false};
  const seed=(key)=>rows.set(key,{control_key:key,enabled:false,revision:1,settings:{},updated_by:'migration',change_reason:'fail-closed initial state',updated_at:new Date('2026-10-01T00:00:00Z')});
  seed(AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION);seed(AUTOMATION_CONTROLS.PHASE13_AUTO_FIRST_TOUCH);
  if(contact)seed(AUTOMATION_CONTROLS.CONTACT_RESEARCH_EXECUTION);
  const query=async(sql,args=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:0};
    if(sql.includes('FROM leadgen.automation_control_events WHERE idempotency_key')){const found=events.filter(e=>e.idempotency_key===args[0]);return{rows:found,rowCount:found.length};}
    if(sql.includes('FROM leadgen.automation_controls WHERE control_key')){const row=rows.get(args[0]);return row?{rows:[{...row}],rowCount:1}:{rows:[],rowCount:0};}
    if(sql.includes('INSERT INTO leadgen.automation_control_events')){
      if(events.some(e=>e.idempotency_key===args[7]))throw Object.assign(new Error('duplicate key'),{code:'23505'});
      const event={control_key:args[0],revision:args[1],previous_enabled:args[2],enabled:args[3],settings_snapshot:JSON.parse(args[4]),actor:args[5],change_reason:args[6],idempotency_key:args[7]};
      events.push(event);return{rows:[event],rowCount:1};
    }
    if(sql.includes('UPDATE leadgen.automation_controls')){const row=rows.get(args[0]);Object.assign(row,{enabled:args[1],revision:args[2],settings:JSON.parse(args[3]),updated_by:args[4],change_reason:args[5],updated_at:new Date()});return{rows:[],rowCount:1};}
    if(sql.includes('SELECT * FROM leadgen.phase13_first_touch_controls'))return{rows:[{...policy}],rowCount:1};
    if(sql.includes('UPDATE leadgen.phase13_first_touch_controls')){policy.enabled=args[1];return{rows:[],rowCount:1};}
    if(sql.includes('research_market_registry'))return{rows:[{market_code:'AE'}],rowCount:1};
    if(sql.includes('dpv_product_category_scope_current'))return{rows:[],rowCount:0};
    throw new Error(`unexpected query: ${sql.slice(0,80)}`);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  return {pool,rows,events,policy};
}

function facadeFixture(options){
  const store=controlStore(options);
  const controls=new AutomationControlService({pool:store.pool});
  const automation=new Phase13AutomationFacade({pool:store.pool,controls,providerOrder:['searxng','exa','tavily'],providerOrderFromEnv:true,
    providerState:async()=>({status:'AVAILABLE'})});
  return {...store,controls,automation};
}

const actor={actor:'simon',reason:'test'};

test('contact research has its own control, default off, and getState reads it',async()=>{
  const f=facadeFixture();
  let state=await f.automation.getState();
  assert.equal(state.contact_research_automation,false);
  assert.equal(state.provider_spend_mode,'FREE_ONLY');assert.equal(state.paid_fallback_on_empty,false);
  assert.deepEqual(Object.keys(AUTOMATION_SUBSYSTEMS),['search','email','contact_research']);
  await f.automation.setSubsystem({subsystem:'contact_research',enabled:true,...actor,idempotencyKey:'k1'});
  state=await f.automation.getState();
  assert.equal(state.contact_research_automation,true);assert.equal(state.search_automation,false);assert.equal(state.auto_first_touch_email,false);
  // Before migration 068 the row is missing: read as off, never as on.
  const missing=facadeFixture({contact:false});
  const before=await missing.automation.getState();
  assert.equal(before.contact_research_automation,false);assert.equal(before.subsystems.contact_research.control_missing,true);
  await assert.rejects(missing.automation.setSubsystem({subsystem:'contact_research',enabled:true,...actor}),{code:'AUTOMATION_CONTROL_NOT_FOUND'});
});

test('search on with email off lets research batches dispatch while auto first-touch stays disabled',async()=>{
  const f=facadeFixture();
  await f.automation.setSubsystem({subsystem:'search',enabled:true,...actor,idempotencyKey:'s1'});
  const state=await f.automation.getState();
  assert.equal(state.search_automation,true);assert.equal(state.auto_first_touch_email,false);assert.equal(f.policy.enabled,false);
  assert.equal(await f.automation.isSearchEnabled(),true);
  const enqueued=[];
  const dispatchPool={query:async sql=>sql.includes('FROM leadgen.research_job_dispatch_outbox o')
    ?{rows:[{research_job_id:'job-1',execution_key:'exec-1',dispatch_state:'PENDING',job_status:'QUEUED'}],rowCount:1}:{rows:[],rowCount:1}};
  const dispatcher=new ResearchDirectDispatchService({pool:dispatchPool,queue:{enqueue:async(...args)=>{enqueued.push(args);return 'q-1';}},isEnabled:()=>f.automation.isSearchEnabled()});
  assert.equal((await dispatcher.dispatch('job-1')).state,'DISPATCHED');assert.equal(enqueued.length,1);
  const eligibility=evaluatePhase13EmailEligibility({},state);
  assert.ok(eligibility.reason_codes.includes('AUTO_FIRST_TOUCH_PAUSED'));
  // And the reverse: search off pauses dispatch even when email is on.
  await f.automation.setSubsystem({subsystem:'search',enabled:false,...actor,idempotencyKey:'s2'});
  await f.automation.setSubsystem({subsystem:'email',enabled:true,...actor,idempotencyKey:'e1'});
  assert.equal((await dispatcher.dispatch('job-1')).state,'PAUSED_AUTOMATION_OFF');
  assert.equal((await f.automation.getState()).auto_first_touch_email,true);assert.equal(f.policy.enabled,true);
});

test('master on starts search and email but leaves contact research off; master off stops all three',async()=>{
  const f=facadeFixture();
  let result=await f.automation.setMaster({enabled:true,...actor,idempotencyKey:'m1'});
  assert.equal(result.state.search_automation,true);assert.equal(result.state.auto_first_touch_email,true);
  assert.equal(result.state.contact_research_automation,false);assert.equal(result.contact_research,null);
  await f.automation.setSubsystem({subsystem:'contact_research',enabled:true,...actor,idempotencyKey:'c1'});
  result=await f.automation.setMaster({enabled:false,...actor,idempotencyKey:'m2'});
  assert.equal(result.state.automated_acquisition,false);assert.equal(result.state.contact_research_automation,false);
  result=await f.automation.setMaster({enabled:true,contactResearch:true,...actor,idempotencyKey:'m3'});
  assert.equal(result.state.contact_research_automation,true);
  // Spend settings survive the master switch.
  await f.automation.setSubsystem({subsystem:'search',providerSpendMode:'ALLOW_PAID',...actor,idempotencyKey:'p1'});
  await f.automation.setMaster({enabled:false,...actor,idempotencyKey:'m4'});
  assert.equal((await f.automation.getState()).provider_spend_mode,'ALLOW_PAID');
});

function appFor(automation,reconcile={}){
  const app=express();app.use(express.json());
  const auth={authenticate:(req,_res,next)=>{req.managementUser={identity:'simon',role:'MANAGEMENT'};next();},requireRoles:()=>(_req,_res,next)=>next()};
  app.use(createAutomationRouter({automation,managementAuth:auth,reconcile}));
  app.use((error,_req,res,_next)=>res.status(Number(error.status)||500).json({code:error.code}));
  return app;
}
async function withServer(app,fn){
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await fn(async(method,path,body,headers={})=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};});}
  finally{server.close();}
}

test('PUT /api/automation/control/:subsystem validates input and writes append-only control events',async()=>{
  const f=facadeFixture();const calls=[];
  const reconcile={search:async()=>calls.push('search'),contactResearch:async()=>calls.push('contact'),email:async()=>calls.push('email')};
  await withServer(appFor(f.automation,reconcile),async call=>{
    assert.equal((await call('PUT','/api/automation/control/phone',{enabled:true})).status,404);
    assert.equal((await call('PUT','/api/automation/control/search',{enabled:'yes'})).body.code,'AUTOMATION_ENABLED_REQUIRED');
    assert.equal((await call('PUT','/api/automation/control/search',{})).body.code,'AUTOMATION_ENABLED_REQUIRED');
    assert.equal((await call('PUT','/api/automation/control/search',{provider_spend_mode:'SPEND_EVERYTHING'})).body.code,'PROVIDER_SPEND_MODE_INVALID');
    assert.equal((await call('PUT','/api/automation/control/search',{paid_fallback_on_empty:'true'})).body.code,'PAID_FALLBACK_ON_EMPTY_INVALID');
    const unsupported=await call('PUT','/api/automation/control/email',{enabled:true,provider_spend_mode:'ALLOW_PAID'});
    assert.equal(unsupported.status,400);assert.equal(unsupported.body.code,'AUTOMATION_SETTING_NOT_SUPPORTED');
    assert.equal(f.events.length,0,'rejected requests write nothing');

    const on=await call('PUT','/api/automation/control/contact_research',{enabled:true,reason:'Pilot with five companies'},{'idempotency-key':'ui-1'});
    assert.equal(on.status,200);assert.equal(on.body.contact_research_automation,true);assert.equal(on.body.auto_first_touch_email,false);
    assert.deepEqual(calls,['contact']);
    const event=f.events.at(-1);
    assert.equal(event.control_key,'CONTACT_RESEARCH_EXECUTION');assert.equal(event.actor,'simon');
    assert.equal(event.change_reason,'Pilot with five companies');assert.equal(event.idempotency_key,'ui-1:contact_research');
    assert.equal(event.previous_enabled,false);assert.equal(event.enabled,true);assert.equal(event.revision,2);
    // Same idempotency key: replay, no second event.
    await call('PUT','/api/automation/control/contact_research',{enabled:true,reason:'Pilot with five companies'},{'idempotency-key':'ui-1'});
    assert.equal(f.events.filter(row=>row.idempotency_key==='ui-1:contact_research').length,1);

    const spend=await call('PUT','/api/automation/control/search',{provider_spend_mode:'NO_NEW_PAID_SPEND'},{'idempotency-key':'ui-2'});
    assert.equal(spend.body.provider_spend_mode,'FREE_ONLY');assert.equal(spend.body.search_automation,false);
    const paid=await call('PUT','/api/automation/control/search',{enabled:true,provider_spend_mode:'ALLOW_PAID',paid_fallback_on_empty:true},{'idempotency-key':'ui-3'});
    assert.equal(paid.body.provider_spend_mode,'ALLOW_PAID');assert.equal(paid.body.paid_fallback_on_empty,true);assert.equal(paid.body.search_automation,true);
    assert.deepEqual(f.events.at(-1).settings_snapshot.provider_spend_mode,'ALLOW_PAID');
    assert.equal(f.events.at(-1).change_reason,'Management enabled research search');

    // All-on keeps contact research as it is and only reconciles what is on.
    calls.length=0;
    await call('PUT','/api/automation/control/contact_research',{enabled:false},{'idempotency-key':'ui-4'});
    const master=await call('PUT','/api/automation/control',{enabled:true},{'idempotency-key':'ui-5'});
    assert.equal(master.body.contact_research_automation,false);assert.deepEqual(calls,['search','email']);
    assert.equal((await call('PUT','/api/automation/control',{enabled:'on'})).status,400);
  });
});

test('contact research is PAUSED while its switch is off: no job, no queue, no search or Hunter call',async()=>{
  const f=facadeFixture();
  const queries=[];const enqueued=[];let selectCalls=0;
  const pool={query:async(sql,args)=>{queries.push(sql);return{rows:[{created_by_identity:'phase13-automation'}],rowCount:1};}};
  // Paid provider and Hunter doubles: any call fails the test.
  const tavily={search:async()=>{throw new Error('Tavily must not be called');}};
  const hunter={verify:async()=>{throw new Error('Hunter must not be called');}};
  const reconciler=new ContactResearchReconciler({pool,queue:{enqueue:async(...args)=>enqueued.push(args)},queueName:'enrich-decision-makers',
    automation:f.automation,selectProvider:async()=>{selectCalls++;return{provider:'tavily'};}});
  await f.automation.setMaster({enabled:true,...actor,idempotencyKey:'m1'});
  assert.deepEqual(await reconciler.reconcile({limit:5}),{status:'PAUSED',reason:'PAUSED_AUTOMATION_OFF',created:0});
  assert.equal(queries.length,0);assert.equal(enqueued.length,0);assert.equal(selectCalls,0);
  // An automation job already queued waits instead of running.
  assert.deepEqual(await reconciler.jobAllowed('job-1'),{allowed:false,status:'PAUSED',reason:'PAUSED_AUTOMATION_OFF'});
  assert.ok(tavily&&hunter);
  // Manually created jobs are not affected by the automation switch.
  const manual=new ContactResearchReconciler({pool:{query:async()=>({rows:[{created_by_identity:'simon'}],rowCount:1})},queue:{enqueue:async()=>{}},queueName:'q',automation:f.automation});
  assert.deepEqual(await manual.jobAllowed('job-2'),{allowed:true});
  // Switch on but FREE_ONLY without an available free provider: still paused, nothing created.
  await f.automation.setSubsystem({subsystem:'contact_research',enabled:true,...actor,idempotencyKey:'c1'});
  const freeOnly=new ContactResearchReconciler({pool,queue:{enqueue:async(...args)=>enqueued.push(args)},queueName:'q',automation:f.automation,
    selectProvider:async()=>({provider:null,reason:'PAUSED_FREE_PROVIDER_UNAVAILABLE'})});
  assert.deepEqual(await freeOnly.reconcile(),{status:'PAUSED',reason:'PAUSED_FREE_PROVIDER_UNAVAILABLE',created:0});
  assert.equal(queries.length,1,'only the jobAllowed lookup ran');assert.equal(enqueued.length,0);
  assert.deepEqual(await reconciler.jobAllowed('job-1'),{allowed:true});
  // The worker checks the gate before running enrichment.
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const handler=server.slice(server.indexOf('[PHASE5_QUEUES.ENRICH_DECISION_MAKERS]: async'));
  assert.ok(handler.indexOf('contactResearchReconciler.jobAllowed')<handler.indexOf('enrichmentService.runJob'));
  assert.doesNotMatch(server,/contact_research_automation:true/);
});

test('approved follow-ups do not depend on the auto first-touch switch, only on SIM sender health',async()=>{
  const f=facadeFixture();
  const draft='44444444-4444-4444-8444-444444444444';
  const pool={query:async()=>({rows:[{merchant_id:null}],rowCount:1})};
  const crm=new CrmService({pool,repository:{},env:{},automationControl:f.automation,outboundProvider:{}});
  assert.equal((await f.automation.getState()).auto_first_touch_email,false);
  // Auto first-touch off: the draft goes on to the sender check (no sender configured in this double).
  assert.deepEqual(await crm.sendApprovedFollowup({draft_id:draft}),{status:'WAITING',code:'SENDER_NOT_CONFIGURED',draft_id:draft});
  // A provider-path failure pauses SIM's sender: the draft waits.
  await f.automation.pauseEmail('SMTP_SEND_AMBIGUOUS');
  const state=await f.automation.getState();
  assert.equal(state.sim_sender_paused,true);assert.equal(state.sim_sender_paused_reason,'SMTP_SEND_AMBIGUOUS');
  assert.deepEqual(await crm.sendApprovedFollowup({draft_id:draft}),{status:'WAITING',code:'EMAIL_PAUSED',draft_id:draft});
  assert.equal(f.events.at(-1).actor,'phase13-auto-first-touch');
  // Pausing again is a no-op; re-enabling email clears the pause.
  const count=f.events.length;await f.automation.pauseEmail('SMTP_SEND_AMBIGUOUS');assert.equal(f.events.length,count);
  await f.automation.setSubsystem({subsystem:'email',enabled:true,...actor,idempotencyKey:'e1'});
  assert.equal((await f.automation.getState()).sim_sender_paused,false);
  // A merchant draft is never held by SIM's sender pause.
  await f.automation.pauseEmail('SMTP_SEND_AMBIGUOUS');
  const merchantCrm=new CrmService({pool:{query:async()=>({rows:[{merchant_id:'m-1'}],rowCount:1})},repository:{},env:{},automationControl:f.automation,
    merchantSending:{providerFor:async()=>{throw Object.assign(new Error('x'),{code:'MERCHANT_MAILBOX_NOT_VERIFIED'});}}});
  assert.equal((await merchantCrm.sendApprovedFollowup({draft_id:draft})).code,'MERCHANT_MAILBOX_NOT_VERIFIED');
});

test("SIM's daily cold-outreach count ignores merchant sends",async()=>{
  const today=new Date();
  const messages=[
    {merchant_id:null,provider_purpose:'COLD_OUTREACH',send_status:'PROVIDER_ACCEPTED',sent_at:today},
    {merchant_id:null,provider_purpose:'COLD_OUTREACH',send_status:'SENDING',sent_at:today},
    {merchant_id:'m-1',provider_purpose:'COLD_OUTREACH',send_status:'PROVIDER_ACCEPTED',sent_at:today},
    {merchant_id:'m-2',provider_purpose:'COLD_OUTREACH',send_status:'AMBIGUOUS',sent_at:today}
  ];
  let seen='';
  const pool={query:async sql=>{seen=sql;const simOnly=/merchant_id IS NULL/.test(sql);
    return{rows:[{count:messages.filter(m=>(!simOnly||m.merchant_id===null)&&m.provider_purpose==='COLD_OUTREACH').length}]};}};
  assert.equal(await countColdOutreachToday(pool),2);
  assert.match(seen,/provider_purpose='COLD_OUTREACH' AND merchant_id IS NULL/);
});

test('migration 068 adds the contact research control fail-closed, append-only and idempotent',()=>{
  const sql=readFileSync(new URL('../../../database/migrations/068_split_automation_controls.sql',import.meta.url),'utf8');
  assert.match(sql,/^[\s\S]*?\bBEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/INSERT INTO leadgen\.automation_controls[\s\S]*'CONTACT_RESEARCH_EXECUTION',false,1/);
  assert.match(sql,/INSERT INTO leadgen\.automation_control_events[\s\S]*'migration:068:'\|\|control_key/);
  assert.equal((sql.match(/ON CONFLICT DO NOTHING/g)||[]).length,2);
  assert.doesNotMatch(sql,/\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
});

test('settings UI shows three independent switches and the spend-mode choice',()=>{
  const model=normalizeAutomationControl({automated_acquisition:true,search_automation:true,contact_research_automation:false,auto_first_touch_email:false,
    provider_spend_mode:'NO_NEW_PAID_SPEND',paid_fallback_on_empty:false,sim_sender_paused:true});
  assert.equal(model.features.search,true);assert.equal(model.features.contactResearch,false);assert.equal(model.features.firstTouch,false);
  assert.equal(model.spendMode,'FREE_ONLY');assert.equal(model.senderPaused,true);
  assert.equal(normalizeAutomationControl({provider_spend_mode:'ALLOW_PAID',paid_fallback_on_empty:true}).paidFallbackOnEmpty,true);
  const source=readFileSync(new URL('../public/ui/v3/automation-control.js',import.meta.url),'utf8');
  for(const label of ['客户搜索','Lead search','自动首封','Auto first-touch','联系人研究','Contact research','只用免费搜索','Free search only','允许付费兜底','Allow paid fallback'])
    assert.ok(source.includes(label),label);
  assert.match(source,/\/api\/automation\/control\/\$\{encodeURIComponent\(subsystem\)\}/);
  for(const hook of ['data-automation-subsystem','data-automation-spend','data-automation-empty-fallback','data-automation-toggle','data-automation-refresh'])assert.ok(source.includes(hook),hook);
  assert.match(source,/class="v4-switch"/);assert.match(source,/role="switch"/);assert.match(source,/role="radiogroup"/);
});
