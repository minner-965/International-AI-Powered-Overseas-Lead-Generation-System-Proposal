// Batch 2 B1/B2 against throwaway PostgreSQL databases (every migration file, 070 included) and a
// copy of live_copy. Zero external calls: SMTP is an in-process double.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch2-manual-postgres.test.js
// Skipped when no admin URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {Phase7Repository} from '../src/phase7/repository.js';
import {ManualCompanyService} from '../src/companies/manualCompanyService.js';
import {ManualFirstTouchService} from '../src/outreach/manualFirstTouch.js';
import {FirstTouchTestSendService} from '../src/outreach/firstTouchTestSend.js';
import {SIM_FIRST_TOUCH_CANDIDATES_SQL,MERCHANT_FIRST_TOUCH_CANDIDATES_SQL} from '../src/outreach/firstTouchCandidates.js';
import {loadPhase13EmailEligibilityFacts} from '../src/outreach/Phase13EmailFactLoader.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const SECRET_KEY=crypto.randomBytes(32).toString('hex');
const ADMIN=Object.freeze({admin:true,merchantId:null,restrict:false});
const merchantScope=id=>Object.freeze({admin:false,merchantId:id,restrict:true});
const ALLOWLIST='owner-test@qq.example,second@test.example';

async function admin(sql){const client=new pg.Client({connectionString:adminUrl});await client.connect();try{return await client.query(sql);}finally{await client.end();}}
function dbUrl(name){const url=new URL(adminUrl);url.pathname=`/${name}`;return url.toString();}

async function withDatabase(run){
  const name=`batch2_manual_${crypto.randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const pool=new pg.Pool({connectionString:dbUrl(name),max:8});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool);
  }finally{await pool.end();await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}
}

function fakeProvider(senderEmail,{validate=null}={}){
  const sent=[];
  return{sent,senderEmail,replyToEmail:senderEmail,messageIdDomain:senderEmail.split('@')[1],
    validatePurpose:message=>validate?validate(message):{allowed:true,code:'PROVIDER_PURPOSE_ALLOWED'},
    async health(){return{ready:true};},
    async testConnections(){return{smtp:{ok:true},imap:{ok:true}};},
    async send(message,key){sent.push({message,key});return{status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_SMTP',provider_message_id:`<p-${hex(key).slice(0,12)}@${this.messageIdDomain}>`};}};
}

async function approveCategory(pool){
  const scopes=new CategoryScopeService({pool});const candidates=await scopes.listCandidates();
  const picked=candidates.find(c=>`${c.product_profile}:${c.normalized_category}`==='WOMENSWEAR:DRESSES')||candidates[0];
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:hex('d'),actor:'simon',
    scopes:[{client_key:'s0',product_profile:picked.product_profile,normalized_category:picked.normalized_category,source_fact_digest:picked.source_fact_digest}]});
  await scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:hex('a'),actor:'simon',actor_role:'MANAGEMENT'});
  // effective_from comes from the application clock, which may run slightly ahead of the database.
  for(let attempt=0;attempt<50;attempt++){
    const rows=(await pool.query(`SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' LIMIT 1`)).rows;
    if(rows.length)return rows[0].id;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('approved category not current');
}

async function setup(pool){
  const category=await approveCategory(pool);
  const simProvider=fakeProvider('simon@sim.example');
  const merchantProviders=new Map();
  const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET_KEY},providerFactory:config=>{
    const provider=fakeProvider(config.senderEmail);merchantProviders.set(config.senderEmail,provider);return provider;}});
  const make=async name=>(await merchants.createMerchant({company_name:name,contact_name:name,login_email:`${name.toLowerCase()}@${name.toLowerCase()}.example`,
    quotas:{monthly_searches:100,daily_emails:20}},'admin')).merchant.id;
  const alpha=await make('Alpha');const beta=await make('Beta');
  await merchants.saveMailbox(alpha,{preset_key:'gmail',username:'sales@alpha.example',password:'app-pass'},'admin');
  await merchants.testConnection(alpha);
  const env={TEST_RECIPIENT_ALLOWLIST:ALLOWLIST};
  const automation={paused:[],async getState(){return{sim_sender_paused:false};},async pauseEmail(code){this.paused.push(code);}};
  const queued=[];const queue={async enqueue(name,data){queued.push({name,data});return 'job';}};
  const companies=new ManualCompanyService({pool,env,queue});
  const firstTouch=new ManualFirstTouchService({pool,outboundProvider:simProvider,merchantSending:merchants,automationControl:automation,companies,env,queue});
  const testSends=new FirstTouchTestSendService({pool,outboundProvider:simProvider,merchantSending:merchants,env});
  return{category,simProvider,merchantProviders,merchants,alpha,beta,companies,firstTouch,testSends,automation,queued};
}
const company=(category,extra={})=>({company_name:'Gulf Fashion Trading LLC',website:'https://www.gulf-fashion.example/about',market_code:'AE',
  company_type:'IMPORTER',category_scope_id:category,notes:'Met at the Dubai fair',...extra});
const count=async(pool,table)=>Number((await pool.query(`SELECT count(*)::int n FROM leadgen.${table}`)).rows[0].n);

test('B1: manual company is created with manual origin, isolated per merchant, and never an automatic first-touch candidate',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    // A merchant adds a company to its own account.
    const created=await s.companies.create(company(s.category,{contact:{email:'buying@gulf-fashion.example',contact_kind:'DEPARTMENT',department_name:'Buying'}}),'alpha@alpha.example',merchantScope(s.alpha));
    const id=created.company.id;
    const row=(await pool.query('SELECT data_origin,normalized_domain,country_code FROM leadgen.companies WHERE id=$1',[id])).rows[0];
    assert.deepEqual(row,{data_origin:'manual',normalized_domain:'gulf-fashion.example',country_code:'AE'});
    assert.equal(created.company.contacts.length,1);
    assert.equal((await pool.query(`SELECT evidence_origin FROM leadgen.decision_maker_contacts WHERE company_id=$1`,[id])).rows[0].evidence_origin,'MANUAL_ENTRY');
    assert.equal((await pool.query(`SELECT source FROM leadgen.merchant_companies WHERE company_id=$1 AND merchant_id=$2`,[id,s.alpha])).rows[0].source,'MANUAL');
    // Isolation: Beta does not see it, SIM does; the duplicate reveals nothing to a merchant.
    assert.equal((await s.companies.list({},merchantScope(s.beta))).items.length,0);
    assert.equal((await s.companies.list({},merchantScope(s.alpha))).items.length,1);
    assert.equal((await s.companies.list({},ADMIN)).items.length,1);
    await assert.rejects(s.companies.get(id,merchantScope(s.beta)),{status:404});
    await assert.rejects(s.companies.addActivity(id,{activity_type:'CALL',summary:'x'},'beta@beta.example',merchantScope(s.beta)),{status:404});
    await assert.rejects(s.companies.create(company(s.category,{website:'gulf-fashion.example'}),'beta@beta.example',merchantScope(s.beta)),
      error=>error.code==='COMPANY_ALREADY_LISTED'&&error.status===409&&!error.details);
    // Merchants cannot set test flags or assign.
    await assert.rejects(s.companies.create(company(s.category,{website:'other.example',is_test:true}),'beta@beta.example',merchantScope(s.beta)),{status:403});
    // CREATE_LEAD outbox row exists (merchant rows are held by the 066 trigger).
    assert.equal((await pool.query(`SELECT sync_status FROM leadgen.crm_sync_outbox WHERE company_id=$1 AND operation='CREATE_LEAD'`,[id])).rows[0].sync_status,'CANCELLED');

    // Even with a pool decision, automation enabled and the window open, a manual company cannot be
    // reserved by the automatic path; candidate SQL without a pool row never returns it.
    const simCompany=(await s.companies.create(company(s.category,{website:'sim-buyer.example',contact:{email:'info@sim-buyer.example'}}),'simon@sim.example',ADMIN)).company.id;
    assert.deepEqual((await pool.query(SIM_FIRST_TOUCH_CANDIDATES_SQL,[['PRECISION','RELEVANT','GENERAL_RELEVANT'],50])).rows,[]);
    assert.deepEqual((await pool.query(MERCHANT_FIRST_TOUCH_CANDIDATES_SQL,[['PRECISION','RELEVANT','GENERAL_RELEVANT'],s.alpha,50])).rows,[]);
    await pool.query(`UPDATE leadgen.phase13_first_touch_controls SET enabled=true WHERE policy_revision='MC07_DPV_FIRST_TOUCH_V1'`);
    await pool.query(`INSERT INTO leadgen.automation_controls(control_key,enabled,updated_by,change_reason) VALUES('PHASE13_AUTO_FIRST_TOUCH',true,'test','fixture')
      ON CONFLICT(control_key) DO UPDATE SET enabled=true`);
    await pool.query(`UPDATE leadgen.research_market_registry SET timezone='UTC',business_send_window='{"days":[1,2,3,4,5,6,7],"start":"00:00","end":"23:59"}'::jsonb WHERE market_code='AE'`);
    const body='Hello';
    await assert.rejects(pool.query(`SELECT * FROM leadgen.reserve_phase13_first_touch($1,'MC07_DPV_FIRST_TOUCH_V1',NULL,'info@sim-buyer.example','AE','DPV_FIRST_TOUCH_V1',
      'C_OFFICIAL_GENERIC_MAILBOX','simon@sim.example','simon@sim.example','Subject',$2,$3,'{}'::jsonb,'{}'::text[])`,[simCompany,body,hex(body)]),/MANUAL_COMPANY_REQUIRES_APPROVED_DRAFT/);
    // Append-only history.
    await assert.rejects(pool.query('DELETE FROM leadgen.manual_company_entries WHERE company_id=$1',[simCompany]),/append-only/);
  });
});

test('B1: test companies accept only allowlisted recipients; real companies need the company domain or a source page',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    const testCompany=(await s.companies.create(company(s.category,{website:'test-buyer.example',is_test:true}),'simon@sim.example',ADMIN)).company;
    assert.equal(testCompany.is_test,true);
    await assert.rejects(s.companies.addContact(testCompany.id,{email:'info@test-buyer.example'},'simon',ADMIN),{code:'TEST_RECIPIENT_NOT_ALLOWED'});
    assert.ok((await s.companies.addContact(testCompany.id,{email:'Owner-Test@qq.example'},'simon',ADMIN)).contact.id);
    const real=(await s.companies.create(company(s.category,{website:'real-buyer.example'}),'simon',ADMIN)).company;
    await assert.rejects(s.companies.addContact(real.id,{email:'buyer@gmail.example'},'simon',ADMIN),{code:'RECIPIENT_DOMAIN_MISMATCH'});
    assert.ok((await s.companies.addContact(real.id,{email:'buyer@gmail.example',source_url:'https://real-buyer.example/contact'},'simon',ADMIN)).contact.id);
    assert.ok((await s.companies.addContact(real.id,{email:'sales@shop.real-buyer.example'},'simon',ADMIN)).contact.id);
    // Removing an address from the allowlist blocks a test draft on the server.
    const strict=new ManualFirstTouchService({pool,outboundProvider:s.simProvider,automationControl:s.automation,companies:s.companies,env:{TEST_RECIPIENT_ALLOWLIST:'second@test.example'}});
    const contactId=(await s.companies.get(testCompany.id,ADMIN)).company.contacts[0].id;
    await assert.rejects(strict.createDraft(testCompany.id,{contact_id:contactId},'simon',ADMIN),
      error=>error.status===409&&error.details.reason_codes.includes('TEST_RECIPIENT_NOT_ALLOWED'));
    // With the address allowed, the draft is made from the approved template.
    const draft=await s.firstTouch.createDraft(testCompany.id,{contact_id:contactId},'simon',ADMIN);
    assert.equal(draft.template_key,'C_OFFICIAL_GENERIC_MAILBOX');assert.match(draft.subject,/enquiry for Gulf Fashion Trading LLC/);
    assert.match(draft.body_text,/United Arab Emirates/);assert.equal(draft.is_test_company,true);
    // Flip the flag off: the allowlisted qq address no longer matches the company domain.
    await s.companies.setTestFlag(testCompany.id,{is_test:false},'simon',ADMIN);
    await assert.rejects(s.firstTouch.decide(draft.id,{decision:'APPROVE'},'simon',ADMIN),error=>error.details?.reason_codes?.includes('RECIPIENT_DOMAIN_MISMATCH'));
    assert.equal(s.simProvider.sent.length,0);
  });
});

test('B1: approved manual first touch is a normal outbound/thread; a reply correlates and calls reach the CRM outbox',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    const created=(await s.companies.create(company(s.category,{website:'test-buyer.example',is_test:true,contact:{email:'owner-test@qq.example',contact_kind:'PERSON',person_name:'Sara Ahmed'}}),'simon@sim.example',ADMIN)).company;
    const contactId=created.contacts[0].id;
    // Market window closed: a human-approved send does not wait for it.
    await pool.query(`UPDATE leadgen.research_market_registry SET business_send_window='{"days":[1],"start":"00:00","end":"00:01"}'::jsonb WHERE market_code='AE'`);
    const draft=await s.firstTouch.createDraft(created.id,{contact_id:contactId},'simon@sim.example',ADMIN);
    assert.equal(draft.template_key,'A_NAMED_BUYER');assert.match(draft.body_text,/^Hi Sara,/);
    await assert.rejects(s.firstTouch.createDraft(created.id,{contact_id:contactId},'simon',ADMIN),{code:'DRAFT_ALREADY_OPEN'});
    const sent=await s.firstTouch.decide(draft.id,{decision:'APPROVE'},'simon@sim.example',ADMIN);
    assert.equal(sent.status,'SENT');assert.equal(s.simProvider.sent.length,1);
    assert.equal(s.simProvider.sent[0].message.to,'owner-test@qq.example');
    const out=(await pool.query('SELECT * FROM leadgen.outbound_messages WHERE id=$1',[sent.outbound_message_id])).rows[0];
    assert.equal(out.send_status,'PROVIDER_ACCEPTED');assert.equal(out.business_contact_status,'SENT_NO_REPLY');assert.equal(out.merchant_id,null);
    const reservation=(await pool.query('SELECT * FROM leadgen.phase13_first_touch_reservations WHERE id=$1',[sent.reservation_id])).rows[0];
    assert.equal(reservation.status,'PROVIDER_ACCEPTED');assert.equal(reservation.eligibility_snapshot.source,'MANUAL');
    assert.equal(reservation.rfc_message_id,out.rfc_message_id);
    // Replay of the decision is refused.
    await assert.rejects(s.firstTouch.decide(draft.id,{decision:'APPROVE'},'simon',ADMIN),{code:'DRAFT_ALREADY_DECIDED'});
    // An inbound reply quoting the Message-ID correlates to the thread (same lookup the IMAP sync uses).
    const repo=new Phase7Repository({pool});
    const match=await repo.findInboundThread({inReplyTo:out.rfc_message_id,references:[],normalizedSender:'Owner-Test@qq.example'});
    assert.equal(match.id,sent.thread_id);assert.equal(match.outbound_message_id,out.id);assert.equal(match.correlation_method,'IN_REPLY_TO');
    // Counted as contacted: stage moves to CONTACTED, CONTACTED activity + Feishu rows queued.
    assert.equal((await s.companies.get(created.id,ADMIN)).company.stage,'CONTACTED');
    const outbox=(await pool.query(`SELECT operation,sync_status,merchant_id FROM leadgen.crm_sync_outbox WHERE company_id=$1 ORDER BY created_at,operation`,[created.id])).rows;
    assert.deepEqual(outbox.map(r=>r.operation).sort(),['CREATE_LEAD','UPDATE_ACTIVITY','UPDATE_OPPORTUNITY']);
    assert.ok(outbox.every(r=>r.sync_status==='PENDING'&&r.merchant_id===null));
    // A phone call logged on the manual company is a CRM activity with a pending Feishu row.
    const before=await count(pool,'crm_sync_outbox');
    const call=await s.companies.addActivity(created.id,{activity_type:'CALL',summary:'Called Sara, catalogue requested',result:'Interested'},'simon@sim.example',ADMIN);
    assert.equal(await count(pool,'crm_sync_outbox'),before+1);
    const row=(await pool.query('SELECT operation,sync_status,payload FROM leadgen.crm_sync_outbox WHERE id=$1',[call.crm_outbox_id])).rows[0];
    assert.equal(row.operation,'UPDATE_ACTIVITY');assert.equal(row.sync_status,'PENDING');assert.equal(row.payload.activity_type,'CALL');
    assert.ok(s.queued.some(job=>job.name==='sync-outreach-to-crm'&&job.data.outbox_id===call.crm_outbox_id));
    const stage=await s.companies.setStage(created.id,{stage:'QUOTED',note:'Price list sent'},'simon',ADMIN);assert.equal(stage.stage,'QUOTED');
    await assert.rejects(s.companies.setStage(created.id,{stage:'LOST'},'simon',ADMIN),{code:'LOST_REASON_REQUIRED'});
    // A second first touch for the company is refused (already contacted).
    await assert.rejects(s.firstTouch.createDraft(created.id,{contact_id:contactId},'simon',ADMIN),error=>error.details.reason_codes.includes('ALREADY_FIRST_CONTACTED'));
  });
});

test('B1: a merchant sends its manual first touch from its own mailbox within its quota; opt-out blocks',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    const created=(await s.companies.create(company(s.category,{website:'gulf-fashion.example',contact:{email:'info@gulf-fashion.example'}}),'alpha@alpha.example',merchantScope(s.alpha))).company;
    const draft=await s.firstTouch.createDraft(created.id,{contact_id:created.contacts[0].id},'alpha@alpha.example',merchantScope(s.alpha));
    assert.equal(draft.sender_identity,'sales@alpha.example');assert.match(draft.body_text,/Alpha/);
    // SIM viewing the merchant cannot approve for it; SIM cannot send to a merchant's company.
    await assert.rejects(s.firstTouch.decide(draft.id,{decision:'APPROVE'},'simon',{admin:true,merchantId:s.alpha,restrict:true}),{status:403});
    await assert.rejects(s.firstTouch.createDraft(created.id,{contact_id:created.contacts[0].id},'simon',ADMIN),error=>error.details.reason_codes.includes('COMPANY_ASSIGNED_TO_MERCHANT'));
    const sent=await s.firstTouch.decide(draft.id,{decision:'APPROVE'},'alpha@alpha.example',merchantScope(s.alpha));
    assert.equal(sent.status,'SENT');assert.equal(s.merchantProviders.get('sales@alpha.example').sent.length,1);
    assert.equal((await pool.query('SELECT merchant_id FROM leadgen.outbound_messages WHERE id=$1',[sent.outbound_message_id])).rows[0].merchant_id,s.alpha);
    assert.equal((await s.merchants.emailAllowance(s.alpha)).sent_today,1);
    const other=(await s.companies.create(company(s.category,{website:'second-buyer.example'}),'simon',ADMIN)).company;
    // Opt-out on an address blocks a new draft.
    const third=(await s.companies.create(company(s.category,{website:'third.example',contact:{email:'info@third.example'}}),'simon',ADMIN)).company;
    // An opt-out recorded under another company still blocks the same address.
    await pool.query(`INSERT INTO leadgen.outreach_recipient_suppressions(company_id,normalized_recipient_hash,suppression_type,recorded_by)
      VALUES($1,$2,'OPT_OUT','test')`,[other.id,hex('info@third.example')]);
    await assert.rejects(s.firstTouch.createDraft(third.id,{contact_id:third.contacts[0].id},'simon',ADMIN),error=>error.details.reason_codes.includes('SUPPRESSED'));
    // The merchant's manual first touch counts as "already contacted" for that merchant's automatic path.
    const facts=await loadPhase13EmailEligibilityFacts(pool,created.id,{merchantId:s.alpha});
    assert.equal(facts.has_prior_first_touch,true);assert.equal(facts.contact_progress_status,'SENT_NO_REPLY');
  });
});

test('B2: test send writes only first_touch_test_sends, ignores the send window, enforces recipients and 10 per day',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    await pool.query(`UPDATE leadgen.research_market_registry SET business_send_window='{"days":[1],"start":"00:00","end":"00:01"}'::jsonb WHERE market_code='AE'`);
    const created=(await s.companies.create(company(s.category,{website:'gulf-fashion.example',contact:{email:'buying@gulf-fashion.example',contact_kind:'DEPARTMENT'}}),'simon',ADMIN)).company;
    const preview=await s.testSends.preview({company_id:created.id},ADMIN);
    assert.equal(preview.template_key,'B_IMPORTER_WHOLESALER_DISTRIBUTOR');assert.match(preview.subject,/^\[TEST\] Competitive Dresses range for Gulf Fashion Trading LLC$/);
    assert.equal(preview.variables_source,'COMPANY');assert.deepEqual(preview.allowed_recipients.sort(),['owner-test@qq.example','second@test.example','simon@sim.example']);
    const sample=await s.testSends.preview({template_key:'A_NAMED_BUYER'},ADMIN);
    assert.match(sample.body_text,/^Hi Alex,/);assert.equal(sample.variables_source,'SAMPLE');
    const before={reservations:await count(pool,'phase13_first_touch_reservations'),outbound:await count(pool,'outbound_messages'),outbox:await count(pool,'crm_sync_outbox')};
    await assert.rejects(s.testSends.send({recipient:'buyer@gulf-fashion.example'},'simon',ADMIN),{code:'TEST_RECIPIENT_NOT_ALLOWED'});
    const first=await s.testSends.send({recipient:'owner-test@qq.example',company_id:created.id,content_hash:preview.content_hash},'simon',ADMIN);
    assert.equal(first.ok,true);assert.equal(first.test_send.send_status,'PROVIDER_ACCEPTED');
    assert.match(s.simProvider.sent[0].message.subject,/^\[TEST\] /);
    assert.deepEqual({reservations:await count(pool,'phase13_first_touch_reservations'),outbound:await count(pool,'outbound_messages'),outbox:await count(pool,'crm_sync_outbox')},before);
    for(let i=1;i<10;i++)await s.testSends.send({recipient:'simon@sim.example'},'simon',ADMIN);
    await assert.rejects(s.testSends.send({recipient:'simon@sim.example'},'simon',ADMIN),{code:'TEST_SEND_DAILY_LIMIT',status:429});
    assert.equal(await count(pool,'first_touch_test_sends'),10);
    // A merchant: own mailbox only (not SIM's list), its own 10 per day, no quota use.
    const merchant=merchantScope(s.alpha);
    const status=await s.testSends.status(merchant);assert.deepEqual(status.allowed_recipients,['sales@alpha.example']);assert.equal(status.remaining_today,10);
    await assert.rejects(s.testSends.send({recipient:'owner-test@qq.example'},'alpha',merchant),{code:'TEST_RECIPIENT_NOT_ALLOWED'});
    assert.equal((await s.testSends.send({recipient:'sales@alpha.example'},'alpha',merchant)).ok,true);
    assert.equal((await s.merchants.emailAllowance(s.alpha)).sent_today,0);
    await assert.rejects(s.testSends.preview({company_id:created.id},merchant),{status:404});
    await assert.rejects(pool.query(`UPDATE leadgen.first_touch_test_sends SET recipient='x@y.example'`),/append-only/);
  });
});

test('070 applies on a copy of live_copy and keeps existing rows valid',{skip:!adminUrl},async()=>{
  const live=(await admin(`SELECT 1 FROM pg_database WHERE datname='live_copy'`)).rowCount;
  if(!live)return;
  const name=`batch2_live_${crypto.randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name} TEMPLATE live_copy`);
  const pool=new pg.Pool({connectionString:dbUrl(name),max:2});
  try{
    const before=(await pool.query('SELECT count(*)::int n FROM leadgen.decision_maker_contacts')).rows[0].n;
    await pool.query(await readFile(path.join(migrations,'070_manual_companies_test_sends.sql'),'utf8'));
    await pool.query(await readFile(path.join(migrations,'070_manual_companies_test_sends.sql'),'utf8'));// re-runnable
    for(const table of ['manual_company_entries','company_test_flags','manual_company_stage_events','manual_first_touch_drafts','first_touch_test_sends'])
      assert.equal((await pool.query(`SELECT to_regclass('leadgen.${table}') t`)).rows[0].t,`leadgen.${table}`);
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.decision_maker_contacts')).rows[0].n,before);
    const invalid=(await pool.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname IN('decision_maker_contacts_evidence_origin_check','merchant_companies_source_check') AND NOT convalidated`)).rows[0].n;
    assert.equal(invalid,0);
  }finally{await pool.end();await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}
});
