import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {AutoEvidenceRepository} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';

const database=process.env.PHASE10_PROVIDER_CAPACITY_TEST_DATABASE||'';
const connectionString=database
  ?`postgresql://${encodeURIComponent(process.env.POSTGRES_USER||'leadgen_app')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD||'')}@${process.env.POSTGRES_HOST||'postgres'}:${process.env.POSTGRES_PORT||'5432'}/${database}`:'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

async function fixture(pool,{status='PROVIDER_CAPACITY_WAIT'}={}){
  const suffix=crypto.randomUUID();
  const company=(await pool.query(`INSERT INTO leadgen.companies
    (company_name,normalized_domain,country_code,verification_status,lifecycle_status)
    VALUES($1,$2,'AE','VERIFIED','ACTIVE') RETURNING id`,[`Capacity ${suffix}`,`capacity-${suffix}.invalid`])).rows[0];
  const job=(await pool.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,market_profile,product_category,product_profile,max_results,status,
     job_type,market_codes,product_profiles,requested_company_ids,idempotency_key,request_digest,
     created_by_identity,created_by_role,stop_reason_code,completed_at)
    VALUES('AE','AE','United Arab Emirates','AUTO_EVIDENCE','Opportunity evidence','WOMENSWEAR',1,
      'PARTIAL','DECISION_MAKER_ENRICHMENT',ARRAY['AE'],ARRAY['WOMENSWEAR'],ARRAY[$1]::uuid[],
      $2,$3,'phase10-provider-capacity-test','SYSTEM','TAVILY_CREDIT_EXHAUSTED',now()) RETURNING id`,[
    company.id,`capacity-job-${suffix}`,digest(`job-${suffix}`)])).rows[0];
  const task=(await pool.query(`INSERT INTO leadgen.auto_evidence_tasks
    (company_id,product_profile,contact_research_job_id,business_blocker,evidence_revision,execution_key,
     task_status,current_stage,technical_blocker,attempt_count,max_attempts,budget_state,input_digest,
     strategy_attempt_count,current_strategy_code,strategy_version,current_query_fingerprint,
     current_strategy_locale,current_source_class,strategy_state)
    VALUES($1,'WOMENSWEAR',$2,'NAMED_BUYER_EVIDENCE',1,$3,$4,'VERIFYING_EMAIL',
      'PROVIDER_CREDIT_EXHAUSTED',2,7,'NOT_REQUIRED',$5,2,'S04_OFFICIAL_LEADERSHIP','phase10-wp09-v1',$6,
      'en','OFFICIAL_SITE',$7) RETURNING *`,[company.id,job.id,`capacity-task-${suffix}`,status,
    digest(`task-${suffix}`),digest(`query-${suffix}`),status==='PROVIDER_CAPACITY_WAIT'?'PROVIDER_CAPACITY_WAIT':'STRATEGY_RUNNING'])).rows[0];
  return{company,job,task};
}

test('provider recovery preserves immutable job history and creates one continuation',{skip:!connectionString},async()=>{
  const pool=new pg.Pool({connectionString,max:4});
  try{
    await pool.query(`UPDATE leadgen.provider_account_states SET status='AVAILABLE',checked_at=now() WHERE provider_code='TAVILY'`);
    const {job,task}=await fixture(pool);const repository=new AutoEvidenceRepository({pool});
    const first=await repository.resumeProviderCapacityWait(task.id,{scheduleKey:`capacity:${task.id}`,scheduleSource:'RECONCILIATION'});
    assert.equal(first.resumed,true);
    const original=(await pool.query(`SELECT stop_reason_code FROM leadgen.research_jobs WHERE id=$1`,[job.id])).rows[0];
    assert.equal(original.stop_reason_code,'TAVILY_CREDIT_EXHAUSTED');
    const counts=(await pool.query(`SELECT
      (SELECT count(*)::int FROM leadgen.research_jobs WHERE resumed_from_research_job_id=$1) continuations,
      (SELECT count(*)::int FROM leadgen.auto_evidence_resume_outbox WHERE task_id=$2) outboxes`,[job.id,task.id])).rows[0];
    assert.deepEqual(counts,{continuations:1,outboxes:1});
    const replay=await repository.resumeProviderCapacityWait(task.id,{scheduleKey:`capacity:${task.id}:replay`,scheduleSource:'RECONCILIATION'});
    assert.equal(replay.resumed,false);
  }finally{await pool.end();}
});

test('confirmed provider exhaustion creates no continuation or dispatch outbox',{skip:!connectionString},async()=>{
  const pool=new pg.Pool({connectionString,max:4});
  try{
    await pool.query(`UPDATE leadgen.provider_account_states SET status='CREDIT_EXHAUSTED',checked_at=now() WHERE provider_code='TAVILY'`);
    const {job,task}=await fixture(pool);const result=await new AutoEvidenceRepository({pool})
      .resumeProviderCapacityWait(task.id,{scheduleKey:`blocked:${task.id}`,scheduleSource:'RECONCILIATION'});
    assert.equal(result.resumed,false);assert.equal(result.reason,'PROVIDER_CREDIT_EXHAUSTED');
    const count=await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs WHERE resumed_from_research_job_id=$1`,[job.id]);
    assert.equal(count.rows[0].count,0);
  }finally{await pool.end();}
});

test('capacity recovery does not create provider or email side effects',{skip:!connectionString},async()=>{
  const pool=new pg.Pool({connectionString,max:4});
  try{
    await pool.query(`UPDATE leadgen.provider_account_states SET status='AVAILABLE',checked_at=now() WHERE provider_code='TAVILY'`);
    const before=(await pool.query(`SELECT
      (SELECT count(*)::int FROM leadgen.provider_usage_events) provider,
      (SELECT count(*)::int FROM leadgen.outbound_messages) outbound,
      (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm`)).rows[0];
    const {task}=await fixture(pool);await new AutoEvidenceRepository({pool})
      .resumeProviderCapacityWait(task.id,{scheduleKey:`side-effects:${task.id}`,scheduleSource:'RECONCILIATION'});
    const after=(await pool.query(`SELECT
      (SELECT count(*)::int FROM leadgen.provider_usage_events) provider,
      (SELECT count(*)::int FROM leadgen.outbound_messages) outbound,
      (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm`)).rows[0];
    assert.deepEqual(after,before);
  }finally{await pool.end();}
});
