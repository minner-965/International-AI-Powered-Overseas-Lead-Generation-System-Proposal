import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {AutoEvidenceRepository} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';

const database=process.env.PHASE10_BUDGET_RESUME_TEST_DATABASE||'';
const connectionString=database
  ?`postgresql://${encodeURIComponent(process.env.POSTGRES_USER||'leadgen_app')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD||'')}@${process.env.POSTGRES_HOST||'postgres'}:${process.env.POSTGRES_PORT||'5432'}/${database}`
  :'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

async function fixture(pool,{suffix=crypto.randomUUID(),stage='VERIFYING_EMAIL'}={}){
  const company=(await pool.query(`INSERT INTO leadgen.companies
    (company_name,normalized_domain,country_code,verification_status,lifecycle_status)
    VALUES($1,$2,'AE','VERIFIED','ACTIVE') RETURNING id`,[
    `WP A04.1 Fixture ${suffix}`,`wp-a041-${suffix}.invalid`
  ])).rows[0];
  const job=(await pool.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,market_profile,product_category,product_profile,max_results,status,
     job_type,market_codes,product_profiles,requested_company_ids,idempotency_key,request_digest,
     created_by_identity,created_by_role,run_budget_cap_units,stop_reason_code,completed_at)
    VALUES('AE','AE','United Arab Emirates','AUTO_EVIDENCE','Opportunity evidence','WOMENSWEAR',1,
      'PARTIAL','DECISION_MAKER_ENRICHMENT',ARRAY['AE'],ARRAY['WOMENSWEAR'],ARRAY[$1]::uuid[],
      $2,$3,'phase10-budget-resume-test','SYSTEM',1,'TAVILY_CREDIT_CAP',now()) RETURNING id`,[
    company.id,`wp-a041-job-${suffix}`,digest(`job-${suffix}`)
  ])).rows[0];
  const task=(await pool.query(`INSERT INTO leadgen.auto_evidence_tasks
    (company_id,product_profile,contact_research_job_id,business_blocker,evidence_revision,execution_key,
     task_status,current_stage,technical_blocker,attempt_count,max_attempts,budget_state,input_digest,
     strategy_attempt_count,current_strategy_code,strategy_version,current_query_fingerprint,
     current_strategy_locale,current_source_class,strategy_state,updated_at)
    VALUES($1,'WOMENSWEAR',$2,'NEEDS_BUYER_CONTACT',1,$3,'BUDGET_PAUSED',$4,
      'PROVIDER_BUDGET_PAUSED',2,10,'PAUSED',$5,2,'S02_OFFICIAL_CONTACT','v1',$6,'en','OFFICIAL',
      'BUDGET_PAUSED',date_trunc('day',now())-interval '1 minute') RETURNING *`,[
    company.id,job.id,`wp-a041-task-${suffix}`,stage,digest(`task-${suffix}`),digest(`query-${suffix}`)
  ])).rows[0];
  return{company,job,task};
}

async function sideEffects(pool){
  return(await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.provider_usage_events) provider_usage,
    (SELECT count(*)::int FROM leadgen.outreach_drafts) outreach_drafts,
    (SELECT count(*)::int FROM leadgen.outbound_messages) outbound_messages,
    (SELECT count(*)::int FROM leadgen.outbound_message_attempts) outbound_attempts,
    (SELECT count(*)::int FROM leadgen.inbound_messages) inbound_messages,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm_outbox`)).rows[0];
}

test('PostgreSQL budget resume preserves the immutable original stop reason and creates one continuation',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:4});
    try{
      const {job,task}=await fixture(pool);
      const repository=new AutoEvidenceRepository({pool});
      const before=await sideEffects(pool);
      let first;
      try{
        first=await repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:window`});
      }catch(error){
        console.error(JSON.stringify({sqlstate:error.code,message:error.message,research_job_id:job.id,
          task_id:task.id,status:'PARTIAL',stop_reason_code:'TAVILY_CREDIT_CAP',
          checkpoint_version:0,budget_window_id:'UTC_DAILY_NEXT_WINDOW'}));
        throw error;
      }
      assert.equal(first.resumed,true);
      const original=(await pool.query(`SELECT status,stop_reason_code FROM leadgen.research_jobs WHERE id=$1`,[job.id])).rows[0];
      assert.equal(original.stop_reason_code,'TAVILY_CREDIT_CAP');
      assert.equal(original.status,'PARTIAL');
      assert.notEqual(first.task.contact_research_job_id,job.id);
      assert.equal(first.task.strategy_attempt_count,2);
      assert.equal(first.task.provider_retry_count,0);
      assert.equal(first.task.worker_retry_count,0);
      assert.equal(first.task.checkpoint_replay_count,1);
      const continuation=(await pool.query(`SELECT resumed_from_research_job_id,resume_execution_key,status,
        stop_reason_code,resume_checkpoint_replay_count,resume_stage FROM leadgen.research_jobs WHERE id=$1`,[
        first.task.contact_research_job_id
      ])).rows[0];
      assert.equal(continuation.resumed_from_research_job_id,job.id);
      assert.equal(continuation.status,'QUEUED');
      assert.equal(continuation.stop_reason_code,null);
      assert.equal(continuation.resume_checkpoint_replay_count,1);
      assert.equal(continuation.resume_stage,'VERIFYING_EMAIL');
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.auto_evidence_resume_outbox
        WHERE task_id=$1 AND continuation_research_job_id=$2`,[task.id,first.task.contact_research_job_id])).rows[0].count,1);
      const workerJob=await repository.ensureResearchJob(first.task,'CONTACT',{runBudgetCapUnits:1});
      assert.equal(workerJob.id,first.task.contact_research_job_id);
      assert.equal(workerJob.checkpoint_continuation,true);
      const repeated=await Promise.all([
        repository.ensureResearchJob(first.task,'CONTACT',{runBudgetCapUnits:1}),
        repository.ensureResearchJob(first.task,'CONTACT',{runBudgetCapUnits:1}),
        repository.ensureResearchJob(first.task,'CONTACT',{runBudgetCapUnits:1})
      ]);
      assert.deepEqual([...new Set(repeated.map(item=>item.id))],[first.task.contact_research_job_id]);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,1);
      assert.deepEqual(await sideEffects(pool),before);
    }finally{
      await pool.end();
    }
  });

test('T01 PostgreSQL still rejects clearing an immutable stop reason',{skip:!connectionString},async()=>{
  const pool=new pg.Pool({connectionString,max:2});
  try{
    const {job}=await fixture(pool);
    await assert.rejects(pool.query(`UPDATE leadgen.research_jobs SET stop_reason_code=NULL WHERE id=$1`,[job.id]),
      error=>error.code==='P0001'&&/immutable once recorded/.test(error.message));
  }finally{await pool.end();}
});

test('T02 confirmed provider credit exhaustion remains paused with no continuation or outbox',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:2});
    try{
      await pool.query(`INSERT INTO leadgen.provider_account_states(provider_code,status,checked_at)
        VALUES('TAVILY','CREDIT_EXHAUSTED',now()) ON CONFLICT(provider_code) DO UPDATE SET status='CREDIT_EXHAUSTED',checked_at=now()`);
      const {job,task}=await fixture(pool);
      const result=await new AutoEvidenceRepository({pool}).autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:no-budget`});
      assert.equal(result.resumed,false);assert.equal(result.still_budget_paused,true);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,0);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.auto_evidence_resume_outbox
        WHERE task_id=$1`,[task.id])).rows[0].count,0);
    }finally{
      await pool.query(`UPDATE leadgen.provider_account_states SET status='AVAILABLE'
        WHERE provider_code='TAVILY'`).catch(()=>{});
      await pool.end();
    }
  });

test('T04 repeated resume sweep creates one continuation and one outbox without new strategy or provider usage',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:3});
    try{
      const {job,task}=await fixture(pool);const repository=new AutoEvidenceRepository({pool});
      const before=await sideEffects(pool);
      const first=await repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:repeat`});
      const second=await repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:repeat`});
      assert.equal(first.resumed,true);assert.equal(second.resumed,false);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,1);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.auto_evidence_resume_outbox
        WHERE task_id=$1`,[task.id])).rows[0].count,1);
      assert.equal(second.task.strategy_attempt_count,2);
      assert.deepEqual(await sideEffects(pool),before);
    }finally{await pool.end();}
  });

test('T04b a paused task reuses its queued continuation with a fresh replay checkpoint',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:3});
    try{
      const {job,task}=await fixture(pool);const repository=new AutoEvidenceRepository({pool});
      const first=await repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a042:${task.id}:first`});
      await pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='BUDGET_PAUSED',budget_state='PAUSED',
        technical_blocker='PROVIDER_BUDGET_PAUSED',updated_at=date_trunc('day',now())-interval '1 minute' WHERE id=$1`,[task.id]);
      const replay=await repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a042:${task.id}:replay`});
      assert.equal(replay.resumed,true);assert.equal(replay.reused_continuation,true);
      assert.equal(replay.continuation_research_job_id,first.continuation_research_job_id);
      assert.equal(replay.task.checkpoint_replay_count,2);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,1);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.auto_evidence_resume_outbox
        WHERE task_id=$1`,[task.id])).rows[0].count,1);
    }finally{await pool.end();}
  });

test('T05 concurrent schedulers serialize one budget continuation without leaking a unique error',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:4});
    try{
      const {job,task}=await fixture(pool);const repository=new AutoEvidenceRepository({pool});
      const outcomes=await Promise.all([
        repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:concurrent-a`}),
        repository.autoResumeBudgetPaused(task.id,{scheduleKey:`wp-a041:${task.id}:concurrent-b`})
      ]);
      assert.equal(outcomes.filter(item=>item.resumed).length,1);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,1);
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.auto_evidence_resume_outbox
        WHERE task_id=$1`,[task.id])).rows[0].count,1);
    }finally{await pool.end();}
  });

test('T09 a suppression arriving during pause blocks continuation and all provider work',
  {skip:!connectionString},async()=>{
    const pool=new pg.Pool({connectionString,max:2});
    try{
      const {job,task,company}=await fixture(pool);const before=await sideEffects(pool);
      await pool.query(`INSERT INTO leadgen.company_suppressions(company_id,suppression_type,reason)
        VALUES($1,'DO_NOT_CONTACT','WP_A04_1_TEST')`,[company.id]);
      const result=await new AutoEvidenceRepository({pool}).autoResumeBudgetPaused(task.id,{
        scheduleKey:`wp-a041:${task.id}:suppressed`
      });
      assert.equal(result.resumed,false);assert.equal(result.blocked_by_business_gate,true);
      assert.equal(result.reason,'SUPPRESSED');
      assert.equal((await pool.query(`SELECT count(*)::int count FROM leadgen.research_jobs
        WHERE resumed_from_research_job_id=$1`,[job.id])).rows[0].count,0);
      assert.deepEqual(await sideEffects(pool),before);
    }finally{await pool.end();}
  });
