import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { csrfFor, createManagementAuth } from '../src/phase7/managementAuth.js';
import { Phase7Service, mapProviderEventType, mapReplyIntent, validateCrmPayload } from '../src/phase7/service.js';
import { Phase7Repository } from '../src/phase7/repository.js';
import { buildApprovalDigest } from '../src/outreach/approvalDigest.js';

const ROOT = new URL('../../../', import.meta.url);
const textFile = relative => readFile(new URL(relative, ROOT), 'utf8');
const U = Object.freeze({
  draft:'11111111-1111-4111-8111-111111111111',recipient:'22222222-2222-4222-8222-222222222222',
  company:'33333333-3333-4333-8333-333333333333',buyer:'44444444-4444-4444-8444-444444444444',
  category:'55555555-5555-4555-8555-555555555555',product:'66666666-6666-4666-8666-666666666666',
  cooperation:'77777777-7777-4777-8777-777777777777'
});

function mockResponse() {
  return { statusCode:200,payload:null,status(value){this.statusCode=value;return this;},json(value){this.payload=value;return this;} };
}

test('management bearer contract uses a token-bound actor, role and independent CSRF secret', () => {
  const env={DPV_MANAGEMENT_API_TOKEN:'management-token',DPV_MANAGEMENT_CSRF_SECRET:'csrf-secret',
    DPV_MANAGEMENT_API_ACTOR:'sales.owner',DPV_MANAGEMENT_API_ROLE:'MANAGEMENT'};
  const auth=createManagementAuth(env);const headers={authorization:'Bearer management-token','x-dpv-actor':'spoofed.actor','x-dpv-role':'SALES'};
  const req={get:name=>headers[String(name).toLowerCase()]||'',managementUser:null};const res=mockResponse();let authenticated=false;
  auth.authenticate(req,res,()=>{authenticated=true;});assert.equal(authenticated,true);assert.deepEqual(req.managementUser,{identity:'sales.owner',role:'MANAGEMENT'});
  headers['x-dpv-csrf']=csrfFor({secret:'csrf-secret',identity:'sales.owner',role:'MANAGEMENT'});let verified=false;
  auth.requireCsrf(req,res,()=>{verified=true;});assert.equal(verified,true);
  headers['x-dpv-csrf']=csrfFor({token:'management-token',identity:'sales.owner',role:'MANAGEMENT'});verified=false;
  auth.requireCsrf(req,res,()=>{verified=true;});assert.equal(verified,false);assert.equal(res.statusCode,403);
});

test('Phase 7 event and reply adapters use the exact migration enums', async () => {
  const migration=await textFile('database/migrations/025_phase7_outreach_and_data_exchange.sql');
  assert.equal(mapProviderEventType('sent'),'PROVIDER_ACCEPTED');
  assert.equal(mapProviderEventType('delayed'),'DELIVERY_DELAYED');
  assert.equal(mapProviderEventType('soft_bounced'),'SOFT_BOUNCED');
  assert.equal(mapProviderEventType('hard_bounced'),'HARD_BOUNCED');
  for(const intent of ['CATALOGUE','SAMPLE','QUOTATION','MEETING','DEFER','DECLINE','OPT_OUT','AUTO_REPLY','IRRELEVANT','REVIEW'])assert.equal(mapReplyIntent(intent),intent);
  assert.match(migration,/event_type text NOT NULL CHECK \(event_type IN \('QUEUED','PROVIDER_ACCEPTED','DELIVERED','DELIVERY_DELAYED','SOFT_BOUNCED','HARD_BOUNCED'/);
  assert.match(migration,/intent text NOT NULL CHECK \(intent IN \('CATALOGUE','SAMPLE','QUOTATION','MEETING','DEFER','DECLINE','OPT_OUT','AUTO_REPLY','IRRELEVANT','REVIEW'\)\)/);
});

function approvalFixture(overrides={}) {
  const base={draft_id:U.draft,draft_version:1,version:1,language:'en',subject:'Private-label womenswear range',body_text:'May I send the approved catalogue?',followups:[],template_version:'phase7-v1',
    recipient_id:U.recipient,normalized_recipient:'buyer@example.com',normalized_email:'buyer@example.com',company_id:U.company,product_profile:'WOMENSWEAR',
    from_identity:'sales@example.com',reply_to:'sales@example.com',channel:'EMAIL',approved_claim_ids:[],
    evidence_snapshot_hash:'a'.repeat(64),content_hash:null};
  const digest=buildApprovalDigest(base);
  return {...base,content_hash:digest.snapshot.content_hash,approval_digest:digest.approval_digest,approval_decision:'APPROVED',draft_status:'APPROVED',
    consent_status:'EXPLICIT_OPT_IN',eligibility_status:'ELIGIBLE',eligibility_expires_at:new Date(Date.now()+86400000).toISOString(),
    recipient_lifecycle_status:'ACTIVE',recipient_verification_status:'VALID',verified_at:new Date().toISOString(),
    company_verification_status:'VERIFIED',company_lifecycle_status:'ACTIVE',display_opportunity_status:'MANAGEMENT_APPROVED',
    buyer_business_model_result_id:U.buyer,current_buyer_result_id:U.buyer,
    category_procurement_match_result_id:U.category,current_category_result_id:U.category,
    product_opportunity_result_id:U.product,current_product_result_id:U.product,
    cooperation_feasibility_result_id:U.cooperation,current_cooperation_result_id:U.cooperation,
    decision_maker_verification_status:'VERIFIED',decision_maker_lifecycle_status:'ACTIVE',company_suppressed:false,contact_suppressed:false,
    current_contact_queue_active:true,confirmed_existing_customer:false,
    draft_product_claim_sets:[],...overrides};
}

function gateService(rateFacts={sent_last_minute:0,sent_today:0,company_sent_30d:0}) {
  const pool={query:async()=>({rows:[rateFacts],rowCount:1})};
  return new Phase7Service({pool,env:{OUTBOUND_EMAIL_PROVIDER:'RESEND',RESEND_USE_CASE:'OPT_IN',OUTREACH_ENABLED:'true',
    LIVE_PROSPECT_SEND_APPROVED:'true',OUTREACH_MAX_SENDS_PER_MINUTE:'1',OUTREACH_MAX_SENDS_PER_DAY:'10',
    OUTREACH_MAX_SENDS_PER_COMPANY_30D:'2',OUTREACH_VERIFICATION_TTL_DAYS:'30'}});
}

test('send current gate rejects suppression-after-queue, stale management approval, changed digest and rate cap before provider', async () => {
  const service=gateService();assert.deepEqual((await service.currentOutboundGate(approvalFixture(),'OPT_IN')).reasons,[]);
  assert.ok((await service.currentOutboundGate(approvalFixture({contact_suppressed:true}),'OPT_IN')).reasons.includes('CONTACT_SUPPRESSED'));
  assert.ok((await service.currentOutboundGate(approvalFixture({display_opportunity_status:'RECOMMENDED'}),'OPT_IN')).reasons.includes('CURRENT_MANAGEMENT_APPROVAL_REQUIRED'));
  assert.ok((await service.currentOutboundGate(approvalFixture({approval_digest:'0'.repeat(64)}),'OPT_IN')).reasons.includes('APPROVAL_DIGEST_MISMATCH'));
  assert.ok((await service.currentOutboundGate(approvalFixture({confirmed_existing_customer:true}),'OPT_IN')).reasons.includes('EXISTING_CUSTOMER'));
  assert.ok((await service.currentOutboundGate(approvalFixture({current_contact_queue_active:false}),'OPT_IN')).reasons.includes('CURRENT_CONTACT_QUEUE_REQUIRED'));
  assert.ok((await gateService({sent_last_minute:0,sent_today:10,company_sent_30d:0}).currentOutboundGate(approvalFixture(),'OPT_IN')).reasons.includes('SEND_RATE_CAP_BLOCKED'));
});

test('backend wiring registers raw webhook before JSON, all management APIs and the strict internal orchestrator', async () => {
  const [server,router]=await Promise.all([textFile('services/demo-dashboard/src/server.js'),textFile('services/demo-dashboard/src/phase7/router.js')]);
  assert.ok(server.indexOf('registerPhase7RawWebhookRoutes')<server.indexOf("app.use(express.json"));
  for(const route of ['/api/management/session','/api/contact-queue','/api/outreach/marketing-context','/api/contacts/:id/hunter-verify',
    '/api/outreach/drafts','/api/outreach/messages/:id/enqueue','/api/outreach/inbox','/api/crm-sync-outbox',
    '/api/data-imports/dry-run','/api/data-exports','/api/internal/phase7/orchestrate'])assert.ok(router.includes(route),route);
  for(const action of ['OUTREACH_RECHECK','IMPORT_DISCOVER','EXPORT_PROCESS','CRM_SYNC'])assert.ok(router.includes(action));
  assert.match(router,/requiredUuid\(req\.body\?\.resource_id,'resource_id'\)/);
  assert.match(router,/action==='IMPORT_DISCOVER'\)return res\.status\(202\)\.json\(await service\.enqueueSharedImportDiscovery\(req\.body\)\)/);
});

test('CRM and shared-folder queue handlers delegate to persistent workers instead of placeholder completion',async()=>{
  const [handlers,service,repository]=await Promise.all([textFile('services/demo-dashboard/src/phase7/queueHandlers.js'),
    textFile('services/demo-dashboard/src/phase7/service.js'),textFile('services/demo-dashboard/src/phase7/repository.js')]);
  assert.match(handlers,/SYNC_OUTREACH_TO_CRM\]: async data =>/);assert.match(handlers,/CRM_SYNC_RETRYABLE/);
  assert.match(handlers,/DISCOVER_SHARED_IMPORT_FILES\]: data => service\.discoverSharedImportFilesWork\(data\)/);
  assert.match(service,/CRM_ADAPTER_NOT_CONFIGURED/);assert.match(service,/RETRYABLE_ERROR/);
  assert.match(repository,/async claimCrmOutbox/);assert.match(repository,/async completeCrmOutbox/);assert.match(repository,/async failCrmOutbox/);
  assert.match(service,/validateReadOnlyManifest/);assert.match(service,/readFile\(manifest\.stagedPath\)/);
  assert.doesNotMatch(service,/writeFile\(manifest\.source/);
});

test('CRM worker persists retryable configuration state when no adapter is configured',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{}});
  service.repository={
    claimCrmOutbox:async()=>({claimed:true,outbox:{id:U.draft,idempotency_key:'crm-key',attempt_count:1,operation:'CREATE_TASK',payload:{}}}),
    failCrmOutbox:async(id,input)=>({id,sync_status:'RETRYABLE_ERROR',attempt_count:1,next_attempt_at:'2026-08-31T10:00:00.000Z',input}),
  };
  const result=await service.processCrmSyncWork({outbox_id:U.draft});
  assert.equal(result.status,'RETRYABLE_ERROR');assert.equal(result.configuration_status,'ADAPTER_NOT_CONFIGURED');
  assert.equal(result.network_calls,0);assert.equal(result.attempt_count,1);
});

test('CRM outbox enforces operation allowlists and role-minimal read projections',async()=>{
  assert.deepEqual(validateCrmPayload('CREATE_TASK',{task_id:U.draft,task_type:'FOLLOW_UP',summary:'Call buyer'}),
    {task_id:U.draft,task_type:'FOLLOW_UP',summary:'Call buyer'});
  for(const payload of [{supplier_cost:12},{raw_payload:'secret'},{body_text:'full message'},
    {summary:'\\\\SERVER\\share\\private.xlsx'},{summary:'D:\\staging\\private.xlsx'},{summary:{nested:'value'}}]){
    assert.throws(()=>validateCrmPayload('CREATE_TASK',payload),error=>/^CRM_PAYLOAD_/.test(error.code));
  }
  const row={id:U.draft,company_id:U.company,task_id:U.recipient,operation:'CREATE_TASK',payload:{task_id:U.recipient,task_type:'FOLLOW_UP'},
    sync_status:'PENDING',attempt_count:0,next_attempt_at:null,last_error:'adapter detail',created_at:'2026-08-31',updated_at:'2026-08-31'};
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{}});service.repository={getCrmOutbox:async()=>row};
  const sales=await service.getCrmOutbox(U.draft,{role:'SALES'});assert.equal(Object.hasOwn(sales,'payload'),false);assert.equal(Object.hasOwn(sales,'company_id'),false);
  const admin=await service.getCrmOutbox(U.draft,{role:'DATA_ADMIN'});assert.deepEqual(admin.payload,row.payload);assert.equal(admin.company_id,U.company);
  row.payload={raw_payload:'private'};row.last_error='CRM_TRANSPORT_ERROR:D:\\staging\\private.xlsx';
  const redacted=await service.getCrmOutbox(U.draft,{role:'MANAGEMENT'});assert.equal(redacted.payload,null);
  assert.equal(redacted.payload_status,'REDACTED_UNSAFE');assert.equal(redacted.last_error_code,'CRM_TRANSPORT_ERROR');
});

test('shared IMPORT_DISCOVER validates and queues the complete read-only manifest without returning paths',async()=>{
  let queued=null;const queue={enqueue:async(name,data,options)=>{queued={name,data,options};return'job-1';}};
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},queue,env:{
    DPV_SHARED_FOLDER_PATH:'\\\\SERVER\\share',DATA_EXCHANGE_STAGING_DIR:'D:\\staging\\phase7'}});
  const manifest={sourcePath:'\\\\SERVER\\share\\orders\\orders.xlsx',stagedPath:'D:\\staging\\phase7\\orders.xlsx',
    sourceSha256Before:'a'.repeat(64),localSha256:'a'.repeat(64),sourceSha256After:'a'.repeat(64),
    sourceMutations:{modified:0,deleted:0,renamed:0,moved:0,created:0},autoCommit:false};
  const result=await service.enqueueSharedImportDiscovery({import_type:'CUSTOMER_DEALS',manifest});
  assert.equal(queued.name,'discover-shared-import-files');assert.deepEqual(queued.data.manifest,manifest);
  assert.equal(queued.data.import_type,'CUSTOMER_DEALS');assert.equal(result.parse_local_copy_only,true);assert.equal(result.auto_commit,false);
  assert.doesNotMatch(JSON.stringify(result),/SERVER|staging|orders\.xlsx/i);
});

test('release RBAC keeps legacy writes and exports behind server-bound management authorization', async () => {
  const [server,router,ui]=await Promise.all([
    textFile('services/demo-dashboard/src/server.js'),textFile('services/demo-dashboard/src/phase7/router.js'),
    textFile('services/demo-dashboard/public/phase7-ui.js')
  ]);
  for(const route of ['/api/live/collect','/api/research/jobs','/api/enrichment/jobs','/api/category-procurement/jobs']) {
    const start=server.indexOf(`app.post('${route}'`);assert.notEqual(start,-1,route);
    const declaration=server.slice(start,start+260);assert.match(declaration,/managementAuth\.authenticate/);assert.match(declaration,/managementAuth\.requireCsrf/);
  }
  assert.match(server,/app\.get\('\/api\/export\/leads', managementAuth\.authenticate/);
  assert.match(server,/app\.get\('\/api\/leads\/:id', managementAuth\.tryAuthenticate/);
  assert.match(server,/contact_access='RESTRICTED'/);
  const enqueue=router.slice(router.indexOf("router.post('/api/outreach/messages/:id/enqueue'"),router.indexOf("router.get('/api/outreach/messages/:id'"));
  assert.match(enqueue,/\.\.\.send/);assert.match(router,/SENDER_OPERATOR/);
  assert.doesNotMatch(ui,/name="role"|value="MANAGEMENT"/);
  assert.match(ui,/session\.identity/);assert.match(ui,/session\.role/);
});

test('draft submit and exact approval rerun the database-authoritative deterministic contract', async () => {
  const [service,repository]=await Promise.all([
    textFile('services/demo-dashboard/src/phase7/service.js'),textFile('services/demo-dashboard/src/phase7/repository.js')
  ]);
  assert.match(service,/async #validateStoredDraft\(id\)/);
  assert.match(service,/getDraftValidationContract\(id\)/);
  assert.match(service,/\['INVALID_DRAFT','NEEDS_CHANGES'\]\.includes\(draft\.draft_status\)/);
  const approve=service.slice(service.indexOf('async approveDraft'),service.indexOf('async rejectDraftApproval'));
  assert.match(approve,/#validateStoredDraft\(id\)/);
  assert.match(repository,/authoritative_evidence_ids/);
  assert.match(repository,/authoritative_product_ids/);
  assert.match(repository,/o\.company_id=d\.company_id/);
  assert.match(repository,/pm\.product_profile=s\.product_profile/);
  assert.match(repository,/DRAFT_EVIDENCE_ALLOWLIST_MISMATCH/);
  assert.match(repository,/DRAFT_PRODUCT_ALLOWLIST_MISMATCH/);
  assert.match(repository,/async assertCurrentDraftGate/);
  const gate=repository.slice(repository.indexOf('async assertCurrentDraftGate'),repository.indexOf('async getDraftValidationContract'));
  for(const boundary of ["o.display_opportunity_status='MANAGEMENT_APPROVED'","q.queue_status='ACTIVE'",
    "s.eligibility_status='ELIGIBLE'","s.relationship_status='NEW_PROSPECT'","r.verification_status='VALID'",
    'outreach_eligibility_snapshots newer','company_suppressions','contact_suppressions'])assert.ok(gate.includes(boundary),boundary);
  assert.match(repository,/async submitDraft[\s\S]*assertCurrentDraftGate/);
  assert.match(repository,/input\.decision==='APPROVED'[\s\S]*assertCurrentDraftGate/);
});

test('migration runner applies additive Phase 8 contact-ready gate after immutable 025 through 027',async()=>{
  const runner=await textFile('services/demo-dashboard/src/phase7/migrationRunner.js');
  assert.match(runner,/027_phase7_management_role_hardening\.sql/);
  assert.match(runner,/verifyPhase7RoleHardeningMigration/);
  assert.match(runner,/028_phase8_contact_ready_recommendation\.sql/);
  assert.match(runner,/verifyPhase8ContactReadyMigration/);
  assert.ok(runner.indexOf('roleHardening=await applyPhase7Migration')>runner.indexOf('hardening=await applyPhase7Migration'));
  assert.ok(runner.indexOf('contactReady=await applyPhase7Migration')>runner.indexOf('roleHardening=await applyPhase7Migration'));
});

test('opportunity list projects the current Phase 7 five-state decision without replacing Phase 6 facts', async () => {
  const source = await textFile('services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js');
  assert.match(source,/LEFT JOIN leadgen\.business_opportunity_current bod ON bod\.company_id=c\.id AND bod\.product_profile=cpm\.product_profile/);
  for (const field of ['display_opportunity_status','system_recommendation_status','contact_readiness','policy_contact_status']) {
    assert.match(source,new RegExp(`bod\\.${field}`));
  }
  assert.match(source,/bod\.display_opportunity_status=\$\$\{index\}/);
  const server=await textFile('services/demo-dashboard/src/server.js');
  assert.match(server,/status:req\.query\.status === undefined \? 'RECOMMENDED'/);
});

test('Compose assigns the Phase 7 queues and prepares writable private exchange directories', async () => {
  const compose = await textFile('compose.yaml');
  assert.match(compose,/phase7-runtime-init:/);
  assert.match(compose,/mkdir -p \/app\/runtime\/phase7\/staging \/app\/runtime\/phase7\/exports/);
  assert.match(compose,/recalculate-business-opportunities,refresh-opportunity-exception-queue/);
  assert.match(compose,/DATA_EXCHANGE_STAGING_DIR: \/app\/runtime\/phase7\/staging/);
  assert.match(compose,/DATA_EXCHANGE_EXPORT_DIR: \/app\/runtime\/phase7\/exports/);
});

test('repository keeps immutable conflicts insert-only, filters inbox by company and refreshes decisions without recipients', async () => {
  const repository=await textFile('services/demo-dashboard/src/phase7/repository.js');
  assert.doesNotMatch(repository,/business_opportunity_management_events[\s\S]{0,800}ON CONFLICT\(idempotency_key\) DO UPDATE/);
  assert.doesNotMatch(repository,/email_message_events[\s\S]{0,500}ON CONFLICT\(event_digest\) DO UPDATE/);
  assert.match(repository,/WHERE \(\$2::uuid IS NULL OR t\.company_id=\$2\)/);
  assert.match(repository,/refreshOpportunityDecisions/);
  assert.match(repository,/INSERT INTO leadgen\.business_opportunity_decision_snapshots/);
  assert.match(repository,/INSERT INTO leadgen\.outreach_eligibility_snapshots/);
  const refreshBody=repository.slice(repository.indexOf('async refreshOpportunityDecisions'),repository.indexOf('async findContact'));
  assert.doesNotMatch(refreshBody,/INSERT INTO leadgen\.outreach_recipients/);
  for(const method of ['async getApprovalForEnqueue','async getOutboundMessage']){
    const start=repository.indexOf(method);const body=repository.slice(start,repository.indexOf('\n  async ',start+10));
    assert.match(body,/contact_work_queue/);assert.match(body,/queue_status='ACTIVE'/);
    assert.match(body,/historical_customer_company_links/);assert.match(body,/INTERNAL_EXISTING_CUSTOMER/);
    assert.match(body,/company_suppressions/);assert.match(body,/contact_suppressions/);
  }
  const inboundSuppress=repository.slice(repository.indexOf('async suppressRecipientForInbound'),repository.indexOf('async createImport'));
  assert.match(inboundSuppress,/if\(companyWide\)/);assert.match(inboundSuppress,/company_suppressions/);
  assert.match(inboundSuppress,/Explicit company-wide opt-out/);
});

test('management approval creates recipients only through the verified current-eligibility hard gate', async () => {
  let managementInput=null;
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE'}});
  service.repository.resolveOpportunity=async()=>({id:U.draft,company_id:U.company,product_profile:'WOMENSWEAR',
    assessment_revision:2,business_fit_status:'FIT',system_recommendation_status:'RECOMMENDED',contact_readiness:'READY'});
  service.repository.recordOpportunityManagement=async(_reference,input)=>{managementInput=input;return{current:{company_id:U.company,
    product_profile:'WOMENSWEAR'},management_event:{id:U.draft},queue:{id:U.recipient},recipients_created:1};};
  service.repository.createEligibleRecipients=async()=>{throw new Error('approval must not create recipients outside the approval transaction');};
  const result=await service.manageOpportunity(U.draft,'MANAGEMENT_APPROVED',{}, {identity:'owner',role:'MANAGEMENT'});
  assert.equal(result.recipients_created,1);assert.equal(result.provider_calls,0);assert.equal(result.messages_approved,0);
  assert.equal(managementInput.expected_decision_snapshot_id,U.draft);
  assert.equal(managementInput.expected_assessment_revision,2);

  let sql='';const repository=new Phase7Repository({pool:{query:async(query)=>{sql=query;return{rows:[],rowCount:0};}}});
  await repository.createEligibleRecipients({companyId:U.company,verificationTtlDays:30});
  for(const gate of ["display_opportunity_status='MANAGEMENT_APPROVED'","q.queue_status='ACTIVE'","s.eligibility_status='ELIGIBLE'",
    "s.relationship_status='NEW_PROSPECT'","c.verification_status='VERIFIED'","dm.verification_status='VERIFIED'",
    "dc.verification_status='VALID'",'s.buyer_business_model_result_id=o.buyer_business_model_result_id',
    's.category_procurement_match_result_id=o.category_procurement_match_result_id',
    's.product_opportunity_result_id IS NOT DISTINCT FROM o.product_opportunity_result_id',
    's.cooperation_feasibility_result_id=o.cooperation_feasibility_result_id','company_suppressions','contact_suppressions'])assert.ok(sql.includes(gate),gate);

  const repositorySource=await textFile('services/demo-dashboard/src/phase7/repository.js');
  const approvalBody=repositorySource.slice(repositorySource.indexOf('async recordOpportunityManagement'),repositorySource.indexOf('async listContactQueue'));
  for(const boundary of ["display_opportunity_status!=='RECOMMENDED'","system_recommendation_status!=='RECOMMENDED'",
    "business_fit_status!=='FIT'","contact_readiness!=='READY'","eligibility_status!=='ELIGIBLE'",
    'ELIGIBILITY_VERSION_STALE','DECISION_REVISION_CHANGED',"dc.verification_status='VALID'",
    "leadgen.outreach_recipients.lifecycle_status='ACTIVE'",'company_suppressions','contact_suppressions',
    "error.code = 'OPPORTUNITY_APPROVAL_GATE_BLOCKED'"])assert.ok(approvalBody.includes(boundary)||repositorySource.includes(boundary),boundary);
  assert.ok(approvalBody.indexOf('INSERT INTO leadgen.outreach_recipients')<approvalBody.indexOf('INSERT INTO leadgen.business_opportunity_management_events'));
  assert.ok(approvalBody.indexOf('INSERT INTO leadgen.business_opportunity_management_events')<approvalBody.indexOf('INSERT INTO leadgen.contact_work_queue'));
  const serviceSource=await textFile('services/demo-dashboard/src/phase7/service.js');
  const manageBody=serviceSource.slice(serviceSource.indexOf('async manageOpportunity'),serviceSource.indexOf('async enqueueContactVerification'));
  assert.doesNotMatch(manageBody,/createEligibleRecipients/);
});

test('blocked or stale management approval returns 409 without event, queue, recipient or provider side effects', async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE'}});
  service.repository.resolveOpportunity=async()=>({id:U.draft,company_id:U.company,product_profile:'WOMENSWEAR',assessment_revision:2});
  let createRecipients=0;
  service.repository.createEligibleRecipients=async()=>{createRecipients+=1;return[];};
  service.repository.recordOpportunityManagement=async()=>{
    const error=new Error('gate blocked');error.code='OPPORTUNITY_APPROVAL_GATE_BLOCKED';error.status=409;throw error;
  };
  await assert.rejects(()=>service.manageOpportunity(U.draft,'MANAGEMENT_APPROVED',{},
    {identity:'owner',role:'MANAGEMENT'}),error=>error.code==='OPPORTUNITY_APPROVAL_GATE_BLOCKED'&&error.status===409);
  assert.equal(createRecipients,0);
  assert.equal(service.outboundProvider.calls,undefined);
});

test('send worker persists retryable 429/5xx outcomes and asks pg-boss to retry', async () => {
  for(const status of [429,503]){
    const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{OUTBOUND_EMAIL_PROVIDER:'RESEND',OUTREACH_PROVIDER_MAX_ATTEMPTS:'3'}});
    service.currentOutboundGate=async()=>({reasons:[]});
    service.outboundProvider={health:async()=>({ready:true}),send:async()=>({status:'FAILED',code:`PROVIDER_HTTP_${status}`,http_status:status,network_calls:1})};
    service.repository.getOutboundMessage=async()=>({id:U.draft,send_status:'QUEUED',provider_purpose:'OPT_IN',idempotency_key:'fixture',from_identity:'a@fixture.invalid',normalized_recipient:'b@fixture.invalid'});
    service.repository.beginOutboundAttempt=async()=>({id:U.recipient,attempt_number:1});
    let completed=null;service.repository.completeOutboundAttempt=async input=>{completed=input;};
    await assert.rejects(service.sendMessageWork({message_id:U.draft}),error=>error.code===`PROVIDER_HTTP_${status}`);
    assert.equal(completed.attemptStatus,'RETRYABLE_ERROR');assert.equal(completed.sendStatus,'QUEUED');
  }
});

test('provider event replay derives state from all events and explicit opt-out scope controls company suppression', async () => {
  const service=new Phase7Service({pool:{query:async()=>({rows:[{id:U.draft,subject_sanitized:'',body_text_sanitized:'Please remove me from this list.',company_wide_opt_out:true}],rowCount:1})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE'}});
  service.repository.getWebhook=async()=>({id:U.draft,provider:'RESEND',provider_event_id:'old-accepted',received_at:'2026-08-31T01:00:00Z',sanitized_payload:{provider_message_id:'provider-1',event_type:'PROVIDER_ACCEPTED',occurred_at:'2026-08-31T01:00:00Z'}});
  service.repository.findOutboundByProvider=async()=>({id:U.recipient,send_status:'DELIVERED'});
  service.repository.recordProviderEvent=async()=>({id:U.product});
  service.repository.getOutboundEvents=async()=>[
    {event_type:'DELIVERED',occurred_at:'2026-08-31T02:00:00Z'},
    {event_type:'PROVIDER_ACCEPTED',occurred_at:'2026-08-31T01:00:00Z'}];
  let state=null;service.repository.updateOutboundState=async(_id,value)=>{state=value;};
  let providerSuppression=null;service.repository.suppressRecipientForMessage=async(...args)=>{providerSuppression=args;};
  service.repository.markWebhookProcessed=async()=>{};
  await service.processProviderEventWork({webhook_id:U.draft});assert.equal(state,'DELIVERED');

  service.repository.createReplyClassification=async input=>({id:U.product,intent:input.intent});
  let inboundScope=null;service.repository.suppressRecipientForInbound=async(_id,scope)=>{inboundScope=scope;};
  await service.classifyInboundWork({inbound_message_id:U.draft});assert.deepEqual(inboundScope,{companyWide:true});
  service.pool.query=async()=>({rows:[{id:U.draft,subject_sanitized:'',body_text_sanitized:'Please remove me.',company_wide_opt_out:false}],rowCount:1});
  await service.classifyInboundWork({inbound_message_id:U.draft});assert.deepEqual(inboundScope,{companyWide:false});

  service.repository.getWebhook=async()=>({id:U.draft,provider:'RESEND',provider_event_id:'company-optout',received_at:'2026-08-31T03:00:00Z',
    sanitized_payload:{provider_message_id:'provider-1',event_type:'OPTED_OUT',occurred_at:'2026-08-31T03:00:00Z',company_wide:true}});
  await service.processProviderEventWork({webhook_id:U.draft});assert.deepEqual(providerSuppression[3],{companyWide:true});
});

test('isolated outreach worker example includes rate caps, verification TTL and Hunter defaults', async () => {
  const worker=await textFile('.env.phase7-outreach.example');
  for(const setting of ['OUTREACH_MAX_SENDS_PER_MINUTE=1','OUTREACH_MAX_SENDS_PER_DAY=10',
    'OUTREACH_MAX_SENDS_PER_COMPANY_30D=2','OUTREACH_VERIFICATION_TTL_DAYS=30',
    'CONTACT_VERIFICATION_TTL_DAYS=30','OUTREACH_PROVIDER_MAX_ATTEMPTS=3','HUNTER_MODE=DISABLED','HUNTER_API_KEY=',
    'HUNTER_API_ENDPOINT=https://api.hunter.io/v2','HUNTER_REQUEST_TIMEOUT_MS=12000',
    'MAX_HUNTER_CREDITS_PER_RUN_UNITS=20000','MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS=20000'])assert.match(worker,new RegExp(setting));
  assert.match(worker,/OUTREACH_ENABLED=false/);assert.match(worker,/LIVE_PROSPECT_SEND_APPROVED=false/);
  assert.match(worker,/OUTBOUND_EMAIL_PROVIDER=NONE/);
});

test('import error report is a real XLSX artifact and exposes no source path', async () => {
  const pool={query:async()=>({rows:[],rowCount:0})};const service=new Phase7Service({pool,env:{OUTBOUND_EMAIL_PROVIDER:'NONE'}});
  service.getImport=async()=>({id:U.draft,import_type:'PROSPECT_LEADS',api_status:'DRY_RUN_FAILED',content_sha256:'b'.repeat(64)});
  service.repository.getImportRows=async()=>[{row_number:2,row_status:'REJECTED',error_codes:['REQUIRED_COMPANY_NAME']}];
  const report=await service.importErrorReport(U.draft);assert.equal(report.row_count,1);assert.equal(report.buffer.subarray(0,2).toString(),'PK');
  assert.doesNotMatch(report.filename,/\\|\/|staging|unc/i);
});
