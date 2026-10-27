import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {ResearchBatchService} from '../src/researchBatch/ResearchBatchService.js';
import {countMerchantReuseChargesThisMonth} from '../src/researchBatch/merchantReuseCharge.js';
import {ResearchCancellationService} from '../src/research/ResearchCancellationService.js';
import {ResearchWorkbenchService} from '../src/research/ResearchWorkbenchService.js';
import {ResearchDirectDispatchService,ResearchJobDirectExecutor} from '../src/research/ResearchDirectDispatchService.js';
import {SearchPlanService} from '../src/searchPlanning/SearchPlanService.js';
import {SearchCostControl,loadSearchCostConfig} from '../src/search/SearchCostControl.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {closeCancelledResearchOutbox} from '../scripts/close-cancelled-research-outbox.mjs';

// Batch 2 research flow (B3 cancel, B4 merchant scope, B5 labels, B6 reuse isolation + quota)
// against a throwaway PostgreSQL database built from the migration files. No external calls.
//   BATCH2_RESEARCH_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
// (MERCHANT_TEST_ADMIN_URL is accepted too.)
const adminUrl=process.env.BATCH2_RESEARCH_TEST_ADMIN_URL||process.env.MERCHANT_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');

async function withDatabase(run){
  const name=`b2research_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:8});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool);
  }finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}
async function approveDresses(pool){
  const scopes=new CategoryScopeService({pool});const candidates=await scopes.listCandidates();
  const picked=candidates.find(c=>`${c.product_profile}:${c.normalized_category}`==='WOMENSWEAR:DRESSES')||candidates[0];
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:hex('d'),actor:'simon',
    scopes:[{client_key:'s0',product_profile:picked.product_profile,normalized_category:picked.normalized_category,source_fact_digest:picked.source_fact_digest}]});
  await scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:hex('a'),actor:'simon',actor_role:'MANAGEMENT'});
  // effective_from comes from the application clock; wait until the database clock has passed it.
  for(let attempt=0;attempt<40;attempt++){
    const row=(await pool.query(`SELECT id,normalized_category FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' LIMIT 1`)).rows[0];
    if(row)return row;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('approved category did not become current');
}
const merchantActor=(id,email)=>({identity:email,role:'MANAGEMENT',merchant_id:id});
const merchantScope=id=>({admin:false,merchantId:id,restrict:true});
const ADMIN={identity:'simon@sim.example',role:'MANAGEMENT',merchant_id:null};

test('batch 2 research: merchant scope, reuse isolation and quota, cancellation and outbox closing',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:crypto.randomBytes(32).toString('hex')}});
    const category=await approveDresses(pool);
    const otherCategory=uuid();
    const a=(await merchants.createMerchant({company_name:'Alpha',contact_name:'Anna',login_email:'anna@alpha.example',quotas:{monthly_searches:1000}},'simon')).merchant.id;
    const b=(await merchants.createMerchant({company_name:'Beta',contact_name:'Ben',login_email:'ben@beta.example',quotas:{monthly_searches:1000}},'simon')).merchant.id;
    const c=(await merchants.createMerchant({company_name:'Gamma',contact_name:'Gus',login_email:'gus@gamma.example'},'simon')).merchant.id;
    for(const id of [a,b])await merchants.saveScope(id,{category_scope_ids:[category.id],market_codes:['AE']},'simon');
    // Quota = provider usage + reuse charges (the coordinator wires the second term into MerchantService).
    const merchantQuota=async(id,planned,q)=>merchants.assertSearchQuota(id,Number(planned)+await countMerchantReuseChargesThisMonth(q||pool,id),q);
    const costControl=new SearchCostControl({pool,config:loadSearchCostConfig({}),providerOrder:async()=>['searxng','exa']});
    const batches=new ResearchBatchService({pool,planning:new SearchPlanService({pool}),costControl,merchantQuota});
    const cancellation=new ResearchCancellationService({pool});
    const workbench=new ResearchWorkbenchService({pool});

    // ---- B4: merchant scope on options / preview / create ----
    const options=await batches.options(undefined,merchantActor(b,'ben@beta.example'));
    assert.deepEqual(options.markets.map(m=>m.market_code),['AE']);assert.deepEqual(options.categories.map(x=>x.id),[category.id]);
    assert.equal(options.categories[0].label_zh,'连衣裙');
    assert.deepEqual((await batches.options(undefined,merchantActor(c,'gus@gamma.example'))).categories,[]);
    await assert.rejects(()=>batches.preview({market_codes:['AE'],category_scope_ids:[category.id]},merchantActor(c,'gus@gamma.example')),{code:'MERCHANT_SCOPE_CATEGORY',status:422});
    await assert.rejects(()=>batches.preview({select_all_markets:true,select_all_categories:true},merchantActor(c,'gus@gamma.example')),{code:'MERCHANT_SCOPE_CATEGORY'});
    await assert.rejects(()=>batches.preview({market_codes:['MX'],category_scope_ids:[category.id]},merchantActor(a,'anna@alpha.example')),{code:'MERCHANT_SCOPE_MARKET',status:422});
    await assert.rejects(()=>batches.create({market_codes:['AE'],category_scope_ids:[otherCategory],idempotency_key:'out'},merchantActor(a,'anna@alpha.example')),{code:'MERCHANT_SCOPE_CATEGORY'});
    const allMine=await batches.preview({select_all_markets:true,select_all_categories:true},merchantActor(a,'anna@alpha.example'));
    assert.equal(allMine.total_scopes,1);

    // ---- A creates; B reuses A's job ----
    const batchA=await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'a-1'},merchantActor(a,'anna@alpha.example'));
    const job=batchA.children[0].research_job_id;
    assert.equal((await pool.query('SELECT dispatch_state FROM leadgen.research_job_dispatch_outbox WHERE research_job_id=$1',[job])).rows[0].dispatch_state,'PENDING');
    const shared=uuid(),aOnly=uuid();
    await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code,research_job_id) VALUES($1,'Shared Buyer','shared.example','AE',$2)`,[shared,job]);
    await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,'Alpha Only','alpha-only.example','AE')`,[aOnly]);
    await pool.query(`INSERT INTO leadgen.enrichment_job_companies(research_job_id,company_id,market_code) VALUES($1,$2,'AE')`,[job,aOnly]);
    await merchants.assignCompanies(a,[aOnly],'simon');
    assert.equal(await countMerchantReuseChargesThisMonth(pool,b),0);
    const batchB=await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'b-1'},merchantActor(b,'ben@beta.example'));
    assert.equal(batchB.children[0].research_job_id,job);assert.equal(batchB.children[0].reused,true);
    const charged=await countMerchantReuseChargesThisMonth(pool,b);
    assert.ok(charged>0,'B is charged for the reused scope');
    assert.equal(await countMerchantReuseChargesThisMonth(pool,a),0);
    assert.equal(batchB.children[0].scope_snapshot.merchant_reuse_charge.queries,charged);
    // A second B batch over the same reused job is not charged again.
    await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'b-2',max_results:21},merchantActor(b,'ben@beta.example'));
    assert.equal(await countMerchantReuseChargesThisMonth(pool,b),charged);
    // The charge counts against B's monthly quota.
    await merchants.updateMerchant(b,{quotas:{monthly_searches:charged}},'simon');
    const blocked=await batches.preview({market_codes:['AE'],category_scope_ids:[category.id]},merchantActor(b,'ben@beta.example'));
    assert.equal(blocked.creation_blocked_code,'MERCHANT_SEARCH_QUOTA_EXCEEDED');
    await merchants.updateMerchant(b,{quotas:{monthly_searches:1000}},'simon');

    // ---- B6: B sees only its own companies of the shared job ----
    const asB=(await workbench.getJobResults(job,merchantScope(b))).items.map(row=>row.company_id);
    assert.deepEqual(asB,[shared]);
    const asA=(await workbench.getJobResults(job,merchantScope(a))).items.map(row=>row.company_id).sort();
    assert.deepEqual(asA,[aOnly,shared].sort());
    assert.equal((await workbench.getJobResults(job)).items.length,2);
    const searchB=await workbench.listJobs({search:'Alpha Only'},merchantScope(b));assert.equal(searchB.total,0);
    assert.equal((await workbench.listJobs({search:'Alpha Only'},merchantScope(a))).total,1);

    // ---- B5: category label ----
    const listed=(await workbench.listJobs({},merchantScope(a))).items.find(item=>item.job_id===job);
    assert.equal(listed.category_label_zh,'连衣裙');assert.equal(listed.category_label_en,'Dresses');
    assert.equal(listed.can_cancel,true);
    assert.equal((await workbench.getJob(job,merchantScope(b))).can_cancel,false);

    // ---- B3: cancellation rules ----
    await assert.rejects(()=>cancellation.cancelJob(job,merchantActor(b,'ben@beta.example'),merchantScope(b)),{code:'RESEARCH_JOB_CANCEL_FORBIDDEN',status:403});
    await assert.rejects(()=>cancellation.cancelJob(job,merchantActor(c,'gus@gamma.example'),merchantScope(c)),{code:'RESEARCH_JOB_NOT_FOUND',status:404});
    await assert.rejects(()=>cancellation.cancelJob(job,merchantActor(a,'anna@alpha.example'),merchantScope(a)),{code:'RESEARCH_JOB_SHARED',status:409});
    await assert.rejects(()=>cancellation.cancelBatch(batchA.batch_id,merchantActor(b,'ben@beta.example'),merchantScope(b)),{code:'RESEARCH_BATCH_NOT_FOUND',status:404});
    // B cancelling its batches keeps A's job running.
    const bBatches=(await batches.list({},merchantScope(b))).items.map(row=>row.id);
    for(const id of bBatches){
      const result=await cancellation.cancelBatch(id,merchantActor(b,'ben@beta.example'),merchantScope(b));
      assert.deepEqual(result.cancelled_job_ids,[]);assert.deepEqual(result.kept_shared_job_ids,[job]);
    }
    assert.equal((await pool.query('SELECT status FROM leadgen.research_jobs WHERE id=$1',[job])).rows[0].status,'QUEUED');
    assert.deepEqual((await pool.query('SELECT DISTINCT status FROM leadgen.research_batches WHERE merchant_id=$1',[b])).rows.map(r=>r.status),['CANCELLED']);
    // A cancels its batch: the job and its outbox are closed; nothing is deleted.
    const cancelled=await cancellation.cancelBatch(batchA.batch_id,merchantActor(a,'anna@alpha.example'),merchantScope(a));
    assert.deepEqual(cancelled.cancelled_job_ids,[job]);assert.deepEqual(cancelled.closed_outbox_job_ids,[job]);
    const row=(await pool.query(`SELECT j.status,j.stop_reason_code,o.dispatch_state,o.last_error_code,o.next_attempt_at,b.status batch_status
      FROM leadgen.research_jobs j JOIN leadgen.research_job_dispatch_outbox o ON o.research_job_id=j.id
      JOIN leadgen.research_batches b ON b.id=$2 WHERE j.id=$1`,[job,batchA.batch_id])).rows[0];
    assert.deepEqual(row,{status:'FAILED',stop_reason_code:'OPERATOR_CANCELLED',dispatch_state:'FAILED',last_error_code:'OPERATOR_CANCELLED',next_attempt_at:null,batch_status:'CANCELLED'});
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.research_batch_cost_estimates')).rows[0].n,3);
    assert.equal((await cancellation.cancelBatch(batchA.batch_id,merchantActor(a,'anna@alpha.example'),merchantScope(a))).already_cancelled,true);
    assert.equal((await workbench.getJob(job)).status,'CANCELLED');assert.equal((await workbench.getJob(job)).blocker,null);
    assert.equal((await workbench.listJobs({status:'CANCELLED'})).total,1);

    // Workers skip the cancelled job.
    const queue={calls:[],async enqueue(...args){this.calls.push(args);return 'q';}};
    const dispatch=new ResearchDirectDispatchService({pool,queue});
    assert.equal((await dispatch.dispatch(job)).state,'CANCELLED');
    assert.equal((await dispatch.reconcile()).selected,0);assert.equal(queue.calls.length,0);
    const stageCalls=[];
    const executor=new ResearchJobDirectExecutor({pool,stages:{generateQueries:async()=>stageCalls.push('generate'),discover:async()=>stageCalls.push('discover')}});
    const execution=await executor.execute({research_job_id:job,execution_key:`research-job:${job}`});
    assert.equal(execution.status,'CANCELLED');assert.deepEqual(stageCalls,[]);

    // ---- a job cancelled by hand earlier with its outbox still open (RETRY_PENDING / PAUSED_AUTOMATION_OFF) ----
    const legacy=await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'simon-1',max_results:30},ADMIN);
    const legacyJob=legacy.children[0].research_job_id;
    await pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='RETRY_PENDING',last_error_code='PAUSED_AUTOMATION_OFF',next_attempt_at=now()-interval '1 minute' WHERE research_job_id=$1`,[legacyJob]);
    await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',stop_reason_code='OPERATOR_CANCELLED',dispatch_state='WORKFLOW_INACTIVE',blocked_reason='PAUSED_AUTOMATION_OFF' WHERE id=$1`,[legacyJob]);
    // Even before repair, the reconciler and executor never run it.
    assert.equal((await dispatch.reconcile()).selected,0);
    const dry=await closeCancelledResearchOutbox(pool);
    assert.equal(dry.mode,'DRY_RUN');assert.deepEqual(dry.open_outbox_rows.map(r=>r.research_job_id),[legacyJob]);
    assert.deepEqual(dry.batches_to_mark_cancelled,[legacy.batch_id]);
    assert.equal((await pool.query('SELECT dispatch_state FROM leadgen.research_job_dispatch_outbox WHERE research_job_id=$1',[legacyJob])).rows[0].dispatch_state,'RETRY_PENDING');
    const applied=await closeCancelledResearchOutbox(pool,{apply:true});
    assert.equal(applied.closed_outbox_rows,1);assert.deepEqual(applied.batches_marked_cancelled,[legacy.batch_id]);
    assert.equal((await closeCancelledResearchOutbox(pool,{apply:true})).closed_outbox_rows,0);
    assert.deepEqual((await pool.query('SELECT o.dispatch_state,o.last_error_code,b.status FROM leadgen.research_job_dispatch_outbox o, leadgen.research_batches b WHERE o.research_job_id=$1 AND b.id=$2',[legacyJob,legacy.batch_id])).rows[0],
      {dispatch_state:'FAILED',last_error_code:'OPERATOR_CANCELLED',status:'CANCELLED'});
    // The cancel API also closes such an outbox (idempotent path).
    const legacy2=await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'simon-2',max_results:31},ADMIN);
    const legacyJob2=legacy2.children[0].research_job_id;
    await pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='RETRY_PENDING',last_error_code='PAUSED_AUTOMATION_OFF' WHERE research_job_id=$1`,[legacyJob2]);
    await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',stop_reason_code='OPERATOR_CANCELLED' WHERE id=$1`,[legacyJob2]);
    const repaired=await cancellation.cancelJob(legacyJob2,ADMIN,null);
    assert.equal(repaired.already_cancelled,true);assert.deepEqual(repaired.closed_outbox_job_ids,[legacyJob2]);
    // Running jobs stop at their next checkpoint after a cancel.
    const running=await batches.create({market_codes:['AE'],category_scope_ids:[category.id],idempotency_key:'simon-3',max_results:32},ADMIN);
    const runningJob=running.children[0].research_job_id;
    const seen=[];
    const midRun=new ResearchJobDirectExecutor({pool,stages:{
      generateQueries:async()=>{seen.push('generate');await cancellation.cancelJob(runningJob,ADMIN,null);},
      discover:async()=>seen.push('discover')}});
    const stopped=await midRun.execute({research_job_id:runningJob,execution_key:`research-job:${runningJob}`});
    assert.equal(stopped.status,'CANCELLED');assert.deepEqual(seen,['generate']);
    assert.deepEqual((await pool.query('SELECT j.status,j.stop_reason_code,o.dispatch_state FROM leadgen.research_jobs j JOIN leadgen.research_job_dispatch_outbox o ON o.research_job_id=j.id WHERE j.id=$1',[runningJob])).rows[0],
      {status:'FAILED',stop_reason_code:'OPERATOR_CANCELLED',dispatch_state:'FAILED'});
    await assert.rejects(()=>cancellation.cancelBatch(running.batch_id,ADMIN,null).then(()=>cancellation.cancelJob(runningJob,{identity:'x'},merchantScope(a))),{code:'RESEARCH_JOB_NOT_FOUND'});
  });
});
