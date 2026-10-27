import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import {applyPhase7Migrations,MERCHANT_ACCOUNTS_MIGRATION_KEY,LOGIN_HARDENING_MIGRATION_KEY,FOLLOWUP_SETTINGS_MIGRATION_KEY} from '../src/phase7/migrationRunner.js';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {createSessionMiddleware,createWorkspaceGate} from '../src/merchant/auth.js';
import {createMerchantRouter} from '../src/merchant/router.js';
import {companyScopeSql} from '../src/merchant/scope.js';
import {CrmService} from '../src/crm/service.js';
import {createCrmRouter} from '../src/crm/router.js';
import {createManagementAuth} from '../src/phase7/managementAuth.js';
import {Phase7Repository} from '../src/phase7/repository.js';
import {ResearchBatchService} from '../src/researchBatch/ResearchBatchService.js';
import {createResearchBatchRouter} from '../src/research/researchBatchRouter.js';
import {SearchPlanService} from '../src/searchPlanning/SearchPlanService.js';
import {SearchCostControl,loadSearchCostConfig} from '../src/search/SearchCostControl.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {renderFirstTouchTemplate} from '../src/outreach/firstTouchTemplates.js';
import {SmtpImapProviderAdapter} from '../src/outreach/smtpImapProvider.js';

// Merchant accounts against a throwaway PostgreSQL database built from the migration files.
// Zero external calls: SMTP/IMAP is an in-process double.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
// (GLOBAL_MARKETS_TEST_ADMIN_URL / CRM_PIPELINE_TEST_ADMIN_URL are accepted too.)
const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const DAY=86_400_000;
const SECRET_KEY=crypto.randomBytes(32).toString('hex');

async function withDatabase(build,run){
  const name=`merchant_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:8});
  try{await build(pool);return await run(pool,name);}
  finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}
const migrationFiles=async(filter=()=>true)=>(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)&&filter(file)).sort();
async function applyFiles(pool,files){for(const file of files)await pool.query(await readFile(path.join(migrations,file),'utf8'));}
async function ledger(pool,files,by){
  for(const file of files.filter(file=>file>='025'))await pool.query(`INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by) VALUES($1,$2,$3)`,
    [file,hex(await readFile(path.join(migrations,file),'utf8')),by]);
}

test('migration 066: fresh install baselines once; an installation at 065 upgrades and keeps SIM rows',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>applyFiles(pool,await migrationFiles()),async(pool,name)=>{
    assert.equal((await migrationFiles()).at(-1),FOLLOWUP_SETTINGS_MIGRATION_KEY);
    const result=await applyPhase7Migrations({pool,expectedDatabase:name,baseline:true});
    assert.equal(result.merchantAccounts.status,'BASELINED');assert.equal(result.merchantAccounts.merchant_accounts,'OWNER_SCOPED');
    assert.equal(result.loginHardening.status,'BASELINED');assert.equal(result.loginHardening.login_hardening,'DURABLE_ATTEMPT_COUNTERS');
    assert.equal(result.splitAutomationControls.status,'BASELINED');assert.equal(result.merchantSendingSafety.status,'BASELINED');
    assert.equal(result.manualCompanies.status,'BASELINED');assert.equal(result.manualCompanies.manual_companies,'HUMAN_APPROVED_FIRST_TOUCH');
    assert.equal(result.providerCredentials.status,'BASELINED');assert.equal(result.providerCredentials.provider_credentials,true);
    assert.equal(result.followupSettings.status,'BASELINED');assert.equal(result.followupSettings.followup_settings,'WORKSPACE_CONTROLLED');
    assert.equal((await applyPhase7Migrations({pool,expectedDatabase:name})).merchantAccounts.status,'SKIPPED_ALREADY_APPLIED');
  });
  await withDatabase(async pool=>{const files=await migrationFiles(file=>file<'066');await applyFiles(pool,files);await pool.query(`CREATE TABLE IF NOT EXISTS leadgen.schema_migrations(
      migration_key text PRIMARY KEY,checksum_sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL DEFAULT current_user)`);await ledger(pool,files,'test-065');},
  async(pool,name)=>{
    const company=uuid(),snapshot=uuid();
    await pool.query('SET session_replication_role=replica');
    await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,'Legacy Buyer LLC','legacy-buyer.example','AE')`,[company]);
    await pool.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile,buyer_business_model_result_id,category_procurement_match_result_id,
      cooperation_feasibility_result_id,system_recommendation_status,relationship_status,rule_version,assessment_revision,input_digest)
      VALUES($1,$2,'WOMENSWEAR',$3,$4,$5,'RECOMMENDED','NEW_PROSPECT','test-v1',1,$6)`,[snapshot,company,uuid(),uuid(),uuid(),hex('legacy')]);
    await pool.query('RESET session_replication_role');
    await pool.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status) VALUES($1,$2,'CONTACTED')`,[snapshot,company]);
    const applied=await applyPhase7Migrations({pool,expectedDatabase:name});
    assert.equal(applied.merchantAccounts.status,'APPLIED');assert.equal(applied.globalMarketsCategoriesSearchCost.status,'SKIPPED_ALREADY_APPLIED');
    const state=(await pool.query('SELECT * FROM leadgen.opportunity_crm_states WHERE company_id=$1',[company])).rows[0];
    assert.equal(state.merchant_id,null);assert.equal(state.merchant_key,'00000000-0000-0000-0000-000000000000');assert.ok(state.id);
    assert.equal(state.pipeline_stage,'CONTACTED');
    // A merchant may hold its own state for the same opportunity; SIM's row is unchanged.
    const merchant=(await pool.query(`INSERT INTO leadgen.merchants(company_name,referral_code,created_by) VALUES('M','ABCDEFGH','t') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status,merchant_id) VALUES($1,$2,'NOT_CONTACTED',$3)`,[snapshot,company,merchant]);
    await assert.rejects(pool.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status) VALUES($1,$2,'CONTACTED')`,[snapshot,company]),/opportunity_crm_states_owner_key/);
    const history=(await pool.query('SELECT merchant_id FROM leadgen.opportunity_stage_history WHERE company_id=$1 ORDER BY changed_at',[company])).rows;
    assert.deepEqual(history.map(row=>row.merchant_id),[null,merchant]);
  });
});

// ---------- HTTP isolation ----------
function client(base){
  let cookie='';
  return async(method,url,body)=>{
    const response=await fetch(base+url,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    let json=null;try{json=await response.json();}catch{}
    return{status:response.status,body:json};
  };
}

async function seedCompany(pool,label,country='AE'){
  const company=uuid(),snapshot=uuid();
  await pool.query('SET session_replication_role=replica');
  await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,$2,$3,$4)`,[company,`${label} Trading LLC`,`${label.toLowerCase()}-${company.slice(0,8)}.example`,country]);
  await pool.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile,buyer_business_model_result_id,category_procurement_match_result_id,
    cooperation_feasibility_result_id,system_recommendation_status,relationship_status,rule_version,assessment_revision,input_digest)
    VALUES($1,$2,'WOMENSWEAR',$3,$4,$5,'RECOMMENDED','NEW_PROSPECT','test-v1',1,$6)`,[snapshot,company,uuid(),uuid(),uuid(),hex(label+company)]);
  await pool.query('RESET session_replication_role');
  return{company,snapshot};
}
// A first touch already sent by a merchant mailbox ten days ago (thread open, no reply).
async function seedSentFirstTouch(pool,{company,merchantId,recipient,sender}){
  const reservation=uuid(),thread=uuid(),message=uuid(),rfc=`<ft-${reservation}@merchant.example>`;
  await pool.query('SET session_replication_role=replica');
  await pool.query(`INSERT INTO leadgen.phase13_first_touch_reservations(id,company_id,policy_revision,normalized_recipient,market_code,template_set_key,template_key,
      sender_identity,reply_to,subject,body_text,content_hash,eligibility_snapshot,reservation_minute,reservation_day,status,completed_at,rfc_message_id,merchant_id)
    VALUES($1,$2,'MC07_DPV_FIRST_TOUCH_V1',$3,'AE','DPV_FIRST_TOUCH_V1','B_IMPORTER_WHOLESALER_DISTRIBUTOR',$4,$4,'Range','Hello',$5,'{"product_profile":"WOMENSWEAR"}',
      now()-interval '10 days',current_date-10,'PROVIDER_ACCEPTED',now()-interval '10 days',$6,$7)`,[reservation,company,recipient,sender,hex(reservation),rfc,merchantId]);
  await pool.query('RESET session_replication_role');
  await pool.query(`INSERT INTO leadgen.outbound_messages(id,company_id,first_touch_reservation_id,provider,provider_purpose,idempotency_key,send_execution_key,rfc_message_id,send_status,sent_at,queued_at)
    VALUES($1,$2,$3,'SMTP','COLD_OUTREACH',$4,$4,$5,'PROVIDER_ACCEPTED',now()-interval '10 days',now()-interval '10 days')`,[message,company,reservation,`phase13-first-touch:${reservation}`,rfc]);
  await pool.query(`INSERT INTO leadgen.outreach_threads(id,company_id,first_touch_reservation_id,thread_token,thread_status) VALUES($1,$2,$3,$4,'OPEN')`,
    [thread,company,reservation,`phase13-auto-first-touch:${reservation}`]);
  return{reservation,thread,message,rfc};
}
async function approveCategory(pool){
  const scopes=new CategoryScopeService({pool});const candidates=await scopes.listCandidates();
  const picked=candidates.find(c=>`${c.product_profile}:${c.normalized_category}`==='WOMENSWEAR:DRESSES')||candidates[0];
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:hex('d'),actor:'simon',
    scopes:[{client_key:'s0',product_profile:picked.product_profile,normalized_category:picked.normalized_category,source_fact_digest:picked.source_fact_digest}]});
  await scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:hex('a'),actor:'simon',actor_role:'MANAGEMENT'});
  // effective_from comes from the application clock, which may run slightly ahead of the database clock.
  for(let attempt=0;attempt<50;attempt++){
    const rows=(await pool.query(`SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' LIMIT 1`)).rows;
    if(rows.length)return rows[0].id;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('approved category not current');
}

test('merchant accounts: sign-in, admin, isolation, read-only expiry, quotas and merchant mailbox sending',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{await applyFiles(pool,await migrationFiles());},async(pool)=>{
    const providers=[];const sent=[];
    const providerFactory=config=>{const provider={config,senderEmail:config.senderEmail,replyToEmail:config.replyToEmail,messageIdDomain:config.messageIdDomain,
      health:async()=>({ready:true}),testConnections:async()=>({smtp:{ok:true,code:'SMTP_READY',message:'ok'},imap:{ok:true,code:'IMAP_READY',message:'ok'}}),
      send:async(message,key)=>{sent.push({message,key,smtpUser:config.smtpUser,password:config.smtpPassword,controlled:config.controlledTestMode});return{status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_SMTP',provider_message_id:`<${key}@x>`};}};
      providers.push(provider);return provider;};
    const env={AUTH_REQUIRED:'true',SESSION_SECRET:'test-session-secret',MERCHANT_SECRET_KEY:SECRET_KEY,CRM_FOLLOWUP_DRAFTS_ENABLED:'true',DPV_WORKSPACE_ACTOR:'dev'};
    const merchants=new MerchantService({pool,env,providerFactory});
    const simProvider={senderEmail:'simon@sim.example',replyToEmail:'simon@sim.example',messageIdDomain:'sim.example',send:async()=>{throw new Error('SIM mailbox must not be used');}};
    const automation={getState:async()=>({auto_first_touch_email:true}),pauseEmail:async()=>{throw new Error('merchant failures must not pause SIM email');}};
    const crm=new CrmService({pool,outboundProvider:simProvider,automationControl:automation,queue:{enqueue:async()=>{}},env,merchantSending:merchants});
    const category=await approveCategory(pool);
    const costControl=new SearchCostControl({pool,config:loadSearchCostConfig({}),providerOrder:async()=>['searxng','exa']});
    const batches=new ResearchBatchService({pool,planning:new SearchPlanService({pool}),costControl,
      merchantQuota:(merchantId,planned,queryable)=>merchants.assertSearchQuota(merchantId,planned,queryable)});
    const managementAuth=createManagementAuth(env);
    const app=express();app.use(express.json());
    app.use('/api',createSessionMiddleware({pool,env}));
    app.use(createWorkspaceGate({merchants,env,pool}));
    app.use(createMerchantRouter({merchants,env}));
    app.use('/api/crm',createCrmRouter({service:crm,env,managementAuth}));
    app.use('/api/research/batches',createResearchBatchRouter({service:batches,managementAuth}));
    app.get('/api/leads/:id',(req,res)=>res.json({id:req.params.id}));
    app.get('/api/category-scopes/revisions',(_req,res)=>res.json({items:[]}));
    app.use((error,_req,res,_next)=>res.status(Number(error.status)||500).json({code:error.code,error:error.message}));
    const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
      // ---- sign-in and admin ----
      const anonymous=client(base);
      assert.deepEqual((await anonymous('GET','/api/crm/pipeline')).body.code,'AUTH_REQUIRED');
      assert.equal((await anonymous('GET','/api/auth/me')).status,401);
      await merchants.createAdmin({email:'simon@sim.example',password:'AdminPass2026',display_name:'Simon'});
      const simon=client(base);
      assert.equal((await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'wrong-password1'})).body.code,'AUTH_INVALID_CREDENTIALS');
      const adminLogin=await simon('POST','/api/auth/login',{email:'SIMON@sim.example',password:'AdminPass2026'});
      assert.equal(adminLogin.status,200);assert.equal(adminLogin.body.user.role,'ADMIN');assert.equal(adminLogin.body.user.merchant,null);
      const createdA=await simon('POST','/api/admin/merchants',{company_name:'Alpha Textiles',contact_name:'Anna Li',login_email:'anna@alpha.example',quotas:{monthly_searches:1,daily_emails:5}});
      assert.equal(createdA.status,201);assert.equal(createdA.body.merchant.status,'TRIAL');assert.ok(createdA.body.temporary_password.length>=12);
      const merchantA=createdA.body.merchant.id;
      const createdB=await simon('POST','/api/admin/merchants',{company_name:'Beta Home',contact_name:'Ben Wu',login_email:'ben@beta.example',referred_by_merchant_id:merchantA,trial_days:3});
      const merchantB=createdB.body.merchant.id;
      assert.equal((await simon('POST','/api/admin/merchants',{company_name:'Dup',login_email:'anna@alpha.example'})).body.code,'USER_EMAIL_TAKEN');
      const list=(await simon('GET','/api/admin/merchants')).body.items;
      assert.equal(list.length,2);assert.equal(list.find(row=>row.id===merchantB).referred_by.company_name,'Alpha Textiles');
      assert.equal(list.find(row=>row.id===merchantA).login_email,'anna@alpha.example');
      assert.match(list.find(row=>row.id===merchantA).referral_code,/^[A-Z0-9]{8}$/);

      // ---- first login: temporary password must be changed ----
      const anna=client(base);
      assert.equal((await anna('POST','/api/auth/login',{email:'anna@alpha.example',password:createdA.body.temporary_password})).body.user.must_change_password,true);
      assert.equal((await anna('GET','/api/crm/pipeline')).body.code,'PASSWORD_CHANGE_REQUIRED');
      assert.equal((await anna('POST','/api/auth/password',{current_password:createdA.body.temporary_password,new_password:'short'})).body.code,'PASSWORD_TOO_WEAK');
      assert.equal((await anna('POST','/api/auth/password',{current_password:createdA.body.temporary_password,new_password:'AlphaPass2026'})).status,200);
      const me=(await anna('GET','/api/auth/me')).body.user;
      assert.equal(me.role,'MERCHANT');assert.equal(me.merchant.company_name,'Alpha Textiles');assert.equal(me.merchant.read_only,false);
      assert.deepEqual(me.merchant.quotas,{monthly_searches:1,daily_emails:5});assert.deepEqual(me.merchant.usage,{searches_this_month:0,emails_today:0});
      assert.deepEqual(me.merchant.features,{research:true,email:true,crm_sync:false});
      const ben=client(base);
      await ben('POST','/api/auth/login',{email:'ben@beta.example',password:createdB.body.temporary_password});
      await ben('POST','/api/auth/password',{current_password:createdB.body.temporary_password,new_password:'BetaPass2026x'});
      // SIM-only functions.
      assert.equal((await anna('GET','/api/admin/merchants')).body.code,'ADMIN_REQUIRED');
      assert.equal((await anna('GET','/api/category-scopes/revisions')).body.code,'ADMIN_REQUIRED');
      assert.equal((await anna('PATCH',`/api/admin/merchants/${merchantB}`,{status:'DISABLED'})).status,403);

      // ---- data: A owns cA, B owns cB, SIM-only cS; cShared assigned to both ----
      const cA=await seedCompany(pool,'Aleph');const cB=await seedCompany(pool,'Bet');const cS=await seedCompany(pool,'Sim');const cShared=await seedCompany(pool,'Shared');
      await simon('POST',`/api/admin/merchants/${merchantA}/companies`,{company_ids:[cA.company,cShared.company]});
      await simon('POST',`/api/admin/merchants/${merchantB}/companies`,{company_ids:[cB.company,cShared.company]});
      const pipelineA=(await anna('GET','/api/crm/pipeline')).body.items.map(row=>row.company_id).sort();
      assert.deepEqual(pipelineA,[cA.company,cShared.company].sort());
      const pipelineB=(await ben('GET','/api/crm/pipeline')).body.items.map(row=>row.company_id).sort();
      assert.deepEqual(pipelineB,[cB.company,cShared.company].sort());
      assert.ok((await simon('GET','/api/crm/pipeline')).body.items.length>=4);
      assert.deepEqual((await simon('GET',`/api/crm/pipeline?merchant_id=${merchantB}`)).body.items.map(row=>row.company_id).sort(),pipelineB);
      // Company detail of another merchant's company is not found.
      assert.equal((await anna('GET',`/api/leads/${cB.company}`)).status,404);
      assert.equal((await anna('GET',`/api/leads/${cA.company}`)).status,200);
      // Per-merchant CRM stage on the shared company.
      assert.equal((await anna('POST',`/api/crm/opportunities/${cB.snapshot}/stage`,{stage:'QUOTED'})).status,404);
      assert.equal((await anna('POST',`/api/crm/opportunities/${cShared.snapshot}/stage`,{stage:'QUOTED',note:'Alpha quote'})).body.pipeline_stage,'QUOTED');
      assert.equal((await ben('GET','/api/crm/pipeline')).body.items.find(row=>row.company_id===cShared.company).pipeline_stage,'NEW');
      assert.equal((await simon('GET','/api/crm/pipeline')).body.items.find(row=>row.company_id===cShared.company).pipeline_stage,'NEW');
      await anna('POST',`/api/crm/opportunities/${cShared.snapshot}/activities`,{activity_type:'CALL',summary:'Alpha called the buyer'});
      // Timeline: B does not see A's stage change or call.
      const timelineB=(await ben('GET',`/api/crm/companies/${cShared.company}/timeline`)).body.items;
      assert.ok(!timelineB.some(row=>row.summary==='Alpha called the buyer'||row.to_stage==='QUOTED'));
      const timelineA=(await anna('GET',`/api/crm/companies/${cShared.company}/timeline`)).body.items;
      assert.ok(timelineA.some(row=>row.summary==='Alpha called the buyer'));assert.ok(timelineA.some(row=>row.to_stage==='QUOTED'));
      assert.equal((await anna('GET',`/api/crm/companies/${cS.company}/timeline`)).status,404);
      // Tasks.
      const taskA=(await anna('POST','/api/crm/tasks',{company_id:cA.company,task_type:'FOLLOW_UP',title:'Alpha task'})).body;
      assert.equal(taskA.merchant_id,merchantA);
      assert.equal((await anna('POST','/api/crm/tasks',{company_id:cS.company,task_type:'FOLLOW_UP',title:'x'})).status,404);
      assert.equal((await ben('GET','/api/crm/tasks')).body.items.length,0);
      assert.equal((await ben('PATCH',`/api/crm/tasks/${taskA.id}`,{note:'peek'})).status,404);
      assert.equal((await anna('GET','/api/crm/tasks')).body.items.length,1);
      // Merchant CRM outbox rows never reach SIM's CRM.
      const outbox=(await pool.query('SELECT sync_status,last_error FROM leadgen.crm_sync_outbox WHERE merchant_id=$1',[merchantA])).rows;
      assert.ok(outbox.length>=2&&outbox.every(row=>row.sync_status==='CANCELLED'&&row.last_error==='MERCHANT_CRM_SYNC_NOT_CONFIGURED'));

      // ---- mailbox: presets, encryption, test connection ----
      const presets=(await anna('GET','/api/merchant/mailbox/presets')).body.items;
      assert.ok(['gmail','microsoft365','zoho','aliyun_qiye','tencent_exmail','netease_qiye','other'].every(key=>presets.some(p=>p.key===key)));
      assert.ok(presets.every(p=>(p.smtp_port===587||p.smtp_port===465)&&p.imap_port===993));
      assert.ok(['aliyun_qiye','tencent_exmail','netease_qiye'].every(key=>presets.find(p=>p.key===key)?.smtp_port===465));
      assert.ok(['gmail','microsoft365','zoho'].every(key=>presets.find(p=>p.key===key)?.smtp_port===587));
      // Port 25 (and anything outside 587/465) is refused before any save.
      assert.equal((await anna('PUT','/api/merchant/mailbox',{preset_key:'zoho',smtp_host:'smtp.zoho.com',smtp_port:25,imap_host:'imap.zoho.com',imap_port:993,username:'anna@alpha.example',password:'app-pass'})).body.code,'SMTP_PORT_UNSUPPORTED');
      assert.equal((await anna('PUT','/api/merchant/mailbox',{preset_key:'zoho',username:'anna@alpha.example',from_email:'ceo@alpha.example',password:'app-pass'})).body.code,'MAILBOX_ADDRESS_MISMATCH');
      const saved=(await anna('PUT','/api/merchant/mailbox',{preset_key:'zoho',username:'anna@alpha.example',password:'app-pass-123',from_name:'Anna Li'})).body;
      assert.equal(saved.configured,true);assert.equal(saved.verified_at,null);assert.equal('password' in saved,false);assert.equal(saved.smtp_host,'smtp.zoho.com');
      const stored=(await pool.query('SELECT password_ciphertext FROM leadgen.merchant_mailboxes WHERE merchant_id=$1',[merchantA])).rows[0].password_ciphertext;
      assert.match(stored,/^v1:/);assert.ok(!stored.includes('app-pass-123'));
      const tested=(await anna('POST','/api/merchant/mailbox/test-connection')).body;
      assert.deepEqual([tested.smtp.ok,tested.imap.ok],[true,true]);
      assert.ok((await anna('GET','/api/merchant/mailbox')).body.verified_at);
      assert.equal(providers.at(-1).config.smtpPassword,'app-pass-123');assert.equal(providers.at(-1).config.smtpPort,587);
      const testMail=(await anna('POST','/api/merchant/mailbox/test-email')).body;
      assert.deepEqual(testMail,{ok:true,code:'ACCEPTED_BY_SMTP'});
      assert.equal(sent.at(-1).message.to,'anna@alpha.example');assert.equal(sent.at(-1).controlled,true);
      assert.equal((await anna('PATCH','/api/merchant/profile',{sender_name:'Anna'})).body.sender_name,'Anna');

      // ---- follow-up from A's mailbox, signed by A, attributed to A ----
      const first=await seedSentFirstTouch(pool,{company:cA.company,merchantId:merchantA,recipient:'buyer@aleph.example',sender:'anna@alpha.example'});
      assert.equal((await pool.query('SELECT merchant_id FROM leadgen.outbound_messages WHERE id=$1',[first.message])).rows[0].merchant_id,merchantA);
      assert.equal((await pool.query('SELECT merchant_id FROM leadgen.outreach_threads WHERE id=$1',[first.thread])).rows[0].merchant_id,merchantA);
      assert.equal((await crm.scanFollowups()).created,1);
      const draftsB=(await ben('GET','/api/crm/followup-drafts')).body;assert.equal(draftsB.items.length,0);
      const draftsA=(await anna('GET','/api/crm/followup-drafts')).body;
      assert.equal(draftsA.items.length,1);assert.deepEqual(draftsA.quota,{sent_today:0,daily_limit:5,remaining:5});
      const draft=draftsA.items[0];assert.equal(draft.merchant_id,merchantA);
      assert.match(draft.body_text,/Best regards,\nAnna\nAlpha Textiles\nanna@alpha\.example/);assert.doesNotMatch(draft.body_text,/Simon|SIM International/);
      assert.equal((await ben('POST',`/api/crm/followup-drafts/${draft.id}/decision`,{decision:'APPROVE'})).status,404);
      assert.equal((await anna('POST',`/api/crm/followup-drafts/${draft.id}/decision`,{decision:'APPROVE'})).body.draft_status,'APPROVED');
      const before=sent.length;
      const delivery=await crm.sendApprovedFollowup({draft_id:draft.id});
      assert.equal(delivery.status,'PROVIDER_ACCEPTED');assert.equal(sent.length,before+1);
      assert.equal(sent.at(-1).smtpUser,'anna@alpha.example');assert.equal(sent.at(-1).message.from,'Anna Li <anna@alpha.example>');
      assert.equal(sent.at(-1).message.in_reply_to,first.rfc);assert.equal(sent.at(-1).controlled,false);
      const followupMessage=(await pool.query('SELECT merchant_id FROM leadgen.outbound_messages WHERE followup_draft_id=$1',[draft.id])).rows[0];
      assert.equal(followupMessage.merchant_id,merchantA);
      assert.equal((await anna('GET','/api/crm/followup-drafts?status=ALL')).body.quota.sent_today,1);
      // Inbound reply to A's thread belongs to A; B's inbox stays empty.
      const inbound=uuid();
      await pool.query(`INSERT INTO leadgen.inbound_messages(id,provider,provider_message_id,thread_id,correlation_status,from_address_hash,received_at,subject_sanitized,body_text_sanitized)
        VALUES($1,'SMTP','<reply-a@aleph.example>',$2,'MATCHED',$3,now(),'Re: range','Send catalogue')`,[inbound,first.thread,hex('buyer@aleph.example')]);
      assert.equal((await pool.query('SELECT merchant_id FROM leadgen.inbound_messages WHERE id=$1',[inbound])).rows[0].merchant_id,merchantA);
      const repository=new Phase7Repository({pool});
      assert.equal((await repository.listInbox({merchantId:merchantB})).length,0);
      assert.equal((await repository.listInbox({merchantId:merchantA})).length,1);
      assert.equal(await repository.getThread(first.thread,merchantB),null);
      const classification=uuid();
      await pool.query(`INSERT INTO leadgen.reply_classifications(id,inbound_message_id,intent,classifier_version,reply_category) VALUES($1,$2,'CATALOGUE','rules-v1','HUMAN_POSITIVE')`,[classification,inbound]);
      assert.equal((await ben('POST',`/api/crm/replies/${classification}/review`,{decision:'CONFIRM'})).status,404);
      assert.equal((await anna('POST',`/api/crm/replies/${classification}/review`,{decision:'CONFIRM'})).status,200);
      // Merchant overview counts.
      assert.equal((await repository.getFirstTouchWeekly({merchantId:merchantB})).this_week,0);
      assert.equal((await repository.getMerchantOperationsSummary(merchantA)).prospect.replies,1);
      // Daily email quota: a second follow-up waits once the quota is used.
      await simon('PATCH',`/api/admin/merchants/${merchantA}`,{quotas:{daily_emails:1}});
      // (cShared is QUOTED in A's pipeline, so it no longer receives follow-ups; use another A company.)
      const cA2=await seedCompany(pool,'Aleph2');
      await simon('POST',`/api/admin/merchants/${merchantA}/companies`,{company_ids:[cA2.company]});
      const second=await seedSentFirstTouch(pool,{company:cA2.company,merchantId:merchantA,recipient:'buyer@aleph2.example',sender:'anna@alpha.example'});
      await crm.scanFollowups();
      const pending=(await anna('GET','/api/crm/followup-drafts')).body.items.find(row=>row.thread_id===second.thread);
      await anna('POST',`/api/crm/followup-drafts/${pending.id}/decision`,{decision:'APPROVE'});
      assert.deepEqual(await crm.sendApprovedFollowup({draft_id:pending.id}),{status:'WAITING',code:'MERCHANT_EMAIL_QUOTA_EXCEEDED',draft_id:pending.id});

      await anna('PUT','/api/merchant/scope',{category_scope_ids:[category],market_codes:['AE']});
      // ---- research batches: merchant quota on top of SIM's global budget ----
      assert.equal((await anna('POST','/api/research/batches',{market_codes:['AE'],category_scope_ids:[category],idempotency_key:'alpha-1'})).body.code,'MERCHANT_SEARCH_QUOTA_EXCEEDED');
      const preview=(await anna('POST','/api/research/batches/preview',{market_codes:['AE'],category_scope_ids:[category]})).body;
      assert.equal(preview.creation_allowed,false);assert.equal(preview.creation_blocked_code,'MERCHANT_SEARCH_QUOTA_EXCEEDED');
      await simon('PATCH',`/api/admin/merchants/${merchantA}`,{quotas:{monthly_searches:1000}});
      const batch=await anna('POST','/api/research/batches',{market_codes:['AE'],category_scope_ids:[category],idempotency_key:'alpha-2'});
      assert.equal(batch.status,202);assert.equal(batch.body.merchant_id,merchantA);
      const job=batch.body.children[0].research_job_id;
      assert.equal((await pool.query('SELECT merchant_id FROM leadgen.research_jobs WHERE id=$1',[job])).rows[0].merchant_id,merchantA);
      assert.equal((await ben('GET','/api/research/batches')).body.items.length,0);
      assert.equal((await ben('GET',`/api/research/batches/${batch.body.batch_id}`)).status,404);
      assert.equal((await anna('GET','/api/research/batches')).body.items.length,1);
      assert.equal((await simon('GET','/api/research/batches')).body.items.length,1);
      // A company found by A's job is assigned to A automatically.
      const found=uuid();
      await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code,research_job_id) VALUES($1,'Found Buyer','found-buyer.example','AE',$2)`,[found,job]);
      assert.equal((await pool.query('SELECT source FROM leadgen.merchant_companies WHERE merchant_id=$1 AND company_id=$2',[merchantA,found])).rows[0].source,'RESEARCH');
      assert.equal((await merchants.searchAllowedForJob(job)).allowed,true);
      await simon('PATCH',`/api/admin/merchants/${merchantA}`,{quotas:{monthly_searches:0}});
      assert.deepEqual(await merchants.searchAllowedForJob(job),{allowed:false,code:'MERCHANT_SEARCH_QUOTA_EXCEEDED'});
      // Export/list scope helper.
      const params=[];const clause=companyScopeSql({restrict:true,merchantId:merchantB},'c',params);
      const exported=(await pool.query(`SELECT c.id FROM leadgen.companies c WHERE ${clause}`,params)).rows.map(row=>row.id).sort();
      assert.deepEqual(exported,[cB.company,cShared.company].sort());

      // ---- scope, onboarding, feedback ----
      assert.equal((await anna('PUT','/api/merchant/scope',{category_scope_ids:[category],market_codes:['ZZ']})).body.code,'MERCHANT_MARKET_NOT_ACTIVE');
      const savedScope=(await anna('PUT','/api/merchant/scope',{category_scope_ids:[category],market_codes:['AE']})).body;
      assert.deepEqual(savedScope.market_codes,['AE']);
      const ae=savedScope.available_markets.find(m=>m.code==='AE');
      assert.deepEqual(ae,{code:'AE',name_zh:'阿拉伯联合酋长国',name_en:'United Arab Emirates'});
      const approved=savedScope.available_categories.find(c=>c.id===category);
      assert.ok(approved.name_en&&approved.name_zh,'approved category has English and Chinese names');
      assert.deepEqual((await anna('GET','/api/merchant/onboarding')).body.steps.map(step=>step.done),[true,true,true,true]);
      assert.deepEqual((await ben('GET','/api/merchant/onboarding')).body.steps.map(step=>step.done),[false,false,false,false]);
      assert.equal((await anna('POST','/api/feedback',{page:'#pipeline',message:'Please add WhatsApp'})).status,201);
      const feedback=(await simon('GET','/api/admin/feedback?status=OPEN')).body.items;
      assert.equal(feedback[0].merchant.company_name,'Alpha Textiles');assert.equal(feedback[0].page,'#pipeline');
      assert.equal((await simon('PATCH',`/api/admin/feedback/${feedback[0].id}`,{status:'DONE'})).body.status,'DONE');
      assert.equal((await simon('GET','/api/admin/feedback?status=OPEN')).body.items.length,0);
      assert.equal((await anna('GET','/api/admin/feedback')).status,403);

      // ---- trial expiry: read-only, then extended ----
      await simon('PATCH',`/api/admin/merchants/${merchantB}`,{trial_ends_at:new Date(Date.now()-DAY).toISOString()});
      assert.equal((await ben('GET','/api/auth/me')).body.user.merchant.status,'EXPIRED');
      assert.equal((await ben('GET','/api/crm/pipeline')).status,200);
      assert.equal((await ben('POST','/api/crm/tasks',{company_id:cB.company,task_type:'FOLLOW_UP',title:'x'})).body.code,'MERCHANT_READ_ONLY');
      assert.equal((await ben('POST','/api/feedback',{page:'#x',message:'Please extend'})).status,201);
      const extended=(await simon('PATCH',`/api/admin/merchants/${merchantB}`,{extend_trial_days:7})).body.merchant;
      assert.equal(extended.status,'TRIAL');assert.ok(new Date(extended.trial_ends_at)>new Date(Date.now()+6*DAY));
      assert.equal((await ben('POST','/api/crm/tasks',{company_id:cB.company,task_type:'FOLLOW_UP',title:'Beta task'})).status,201);
      // Paid conversion and feature switch.
      const paid=(await simon('PATCH',`/api/admin/merchants/${merchantB}`,{status:'ACTIVE',paid_until:new Date(Date.now()+30*DAY).toISOString(),features:{research:false}})).body.merchant;
      assert.equal(paid.status,'ACTIVE');assert.equal(paid.features.research,false);
      assert.equal((await ben('POST','/api/research/batches',{market_codes:['AE'],category_scope_ids:[category],idempotency_key:'beta-1'})).body.code,'MERCHANT_FEATURE_DISABLED');
      // Disabled: existing session ends, sign-in refused.
      await simon('PATCH',`/api/admin/merchants/${merchantB}`,{status:'DISABLED'});
      assert.equal((await ben('GET','/api/crm/pipeline')).body.code,'AUTH_REQUIRED');
      assert.equal((await client(base)('POST','/api/auth/login',{email:'ben@beta.example',password:'BetaPass2026x'})).body.code,'MERCHANT_DISABLED');
      // Password reset issues a new temporary password.
      const reset=(await simon('POST',`/api/admin/merchants/${merchantA}/reset-password`)).body;
      assert.ok(reset.temporary_password);
      const again=client(base);
      assert.equal((await again('POST','/api/auth/login',{email:'anna@alpha.example',password:reset.temporary_password})).body.user.must_change_password,true);
      // Logout.
      assert.equal((await simon('POST','/api/auth/logout')).status,200);
      assert.equal((await simon('GET','/api/admin/merchants')).body.code,'AUTH_REQUIRED');
    }finally{server.close();}
  });
});

test('merchant mailbox: a 465 preset saves and resolves to an implicit-TLS provider config',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{await applyFiles(pool,await migrationFiles());},async(pool)=>{
    const env={MERCHANT_SECRET_KEY:SECRET_KEY,DPV_WORKSPACE_ACTOR:'dev'};
    // No socket is opened: the provider factory records the config it is handed.
    const built=[];const merchants=new MerchantService({pool,env,providerFactory:config=>{built.push(config);return{config,testConnections:async()=>({smtp:{ok:true},imap:{ok:true}})};}});
    const created=await merchants.createMerchant({company_name:'Qiye Co',contact_name:'Li',login_email:'li@qiye.example'},'admin');
    const merchantId=created.merchant.id;
    const saved=await merchants.saveMailbox(merchantId,{preset_key:'aliyun_qiye',username:'li@qiye.example',password:'app-pass-465',from_name:'Li'},'admin');
    assert.equal(saved.smtp_port,465);assert.equal(saved.imap_port,993);assert.equal(saved.smtp_host,'smtp.qiye.aliyun.com');
    const row=await merchants.mailboxRow(merchantId);
    const cfg=merchants.providerConfig(row,await merchants.getMerchant(merchantId));
    assert.equal(cfg.smtpPort,465);assert.equal(cfg.smtpSecure,true);assert.equal(cfg.smtpRequireTls,false);
    assert.equal(cfg.smtpPassword,'app-pass-465');
    // The adapter accepts the derived config: no connection-contract SMTP error.
    const provider=new SmtpImapProviderAdapter(cfg);
    assert.ok(!provider.connectionContract().some(code=>code.startsWith('SMTP_')));
    assert.equal(provider.capabilities().transport,'SMTP_TLS');
  });
});

test('first-touch template signs a merchant email with its sender and company; SIM text unchanged',()=>{
  const variables={category:'Dresses',target_category:'Dresses',company:'Buyer LLC',matched_category:'Dresses',market:'United Arab Emirates',reply_to:'anna@alpha.example'};
  const verified=Object.keys(variables);
  const sim=renderFirstTouchTemplate({template_key:'C_OFFICIAL_GENERIC_MAILBOX',variables,verified_fields:verified});
  assert.match(sim.body_text,/I’m Simon from SIM International\./);
  const merchant=renderFirstTouchTemplate({template_key:'C_OFFICIAL_GENERIC_MAILBOX',variables,verified_fields:verified,sender:{sender_name:'Anna',company_name:'Alpha Textiles'}});
  assert.match(merchant.body_text,/I’m Anna from Alpha Textiles\./);assert.match(merchant.body_text,/Best regards,\nAnna\nAlpha Textiles\nanna@alpha\.example$/);
  assert.doesNotMatch(merchant.body_text,/Simon|SIM International/);assert.notEqual(merchant.content_hash,sim.content_hash);
});
