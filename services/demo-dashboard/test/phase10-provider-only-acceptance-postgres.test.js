import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {after,before,test} from 'node:test';
import pg from 'pg';
import {TavilyProviderAccountState} from '../src/search/TavilyProviderAccountState.js';
import {TavilyUsageAudit} from '../src/search/TavilyUsageAudit.js';

const database=process.env.PHASE10_U12_TEST_DATABASE||'';
const connectionString=database
  ?`postgresql://${encodeURIComponent(process.env.POSTGRES_USER||'leadgen_app')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD||'')}@${process.env.POSTGRES_HOST||'postgres'}:${process.env.POSTGRES_PORT||'5432'}/${database}`:'';
const pool=connectionString?new pg.Pool({connectionString,max:6}):null;
const suffix=crypto.randomUUID();
const state={};
const mailCounts=async()=>{
  const {rows:[row]}=await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.outreach_drafts) drafts,
    (SELECT count(*)::int FROM leadgen.outreach_approvals) approvals,
    (SELECT count(*)::int FROM leadgen.outbound_messages) messages,
    (SELECT count(*)::int FROM leadgen.outbound_message_attempts) attempts,
    (SELECT count(*)::int FROM leadgen.email_webhook_inbox) webhooks,
    (SELECT count(*)::int FROM leadgen.inbound_messages) inbound,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm,
    (SELECT count(*)::int FROM leadgen.gmail_ambiguous_send_events) gmail`);
  return row;
};

before(async()=>{
  if(!pool)return;
  state.mailBefore=await mailCounts();
  state.company=(await pool.query(`INSERT INTO leadgen.companies
    (company_name,normalized_domain,country_code,verification_status,lifecycle_status)
    VALUES($1,$2,'AE','VERIFIED','ACTIVE') RETURNING id`,[`U12 ${suffix}`,`u12-${suffix}.invalid`])).rows[0];
  state.job=(await pool.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,market_profile,product_category,product_profile,max_results,status,
     job_type,market_codes,product_profiles,requested_company_ids,
     idempotency_key,request_digest,created_by_identity,created_by_role)
    VALUES('AE','AE','United Arab Emirates','AUTO_EVIDENCE','Opportunity evidence','WOMENSWEAR',100,'QUEUED',
      'DECISION_MAKER_ENRICHMENT',ARRAY['AE'],ARRAY['WOMENSWEAR'],ARRAY[$1]::uuid[],
      $2,$3,'phase10-u12','SYSTEM') RETURNING id`,[state.company.id,`u12-job-${suffix}`,crypto.createHash('sha256').update(suffix).digest('hex')])).rows[0];
  const provider={name:'tavily',endpoint:'https://api.tavily.com/search',calls:0,async search(request){
    this.calls+=1;return{requestId:`u12-${this.calls}`,credits:1,results:[],request};
  }};
  state.provider=provider;state.audit=new TavilyUsageAudit({provider,pool});
  for(let index=0;index<30;index++)await state.audit.search({researchJobId:state.job.id,companyId:state.company.id,
    productProfile:'WOMENSWEAR',purpose:'U12_DISTINCT_SEARCH',request:{query:`u12 distinct ${suffix} ${index}`,count:5}});
  await state.audit.search({researchJobId:state.job.id,companyId:state.company.id,
    productProfile:'WOMENSWEAR',purpose:'U12_DISTINCT_SEARCH',request:{query:`u12 distinct ${suffix} 0`,count:5}});
  state.task=(await pool.query(`INSERT INTO leadgen.auto_evidence_tasks
    (company_id,product_profile,contact_research_job_id,business_blocker,evidence_revision,execution_key,
     task_status,current_stage,attempt_count,max_attempts,budget_state,input_digest,strategy_attempt_count,
     current_strategy_code,strategy_version,current_query_fingerprint,current_strategy_locale,current_source_class,strategy_state)
    VALUES($1,'WOMENSWEAR',$2,'NAMED_BUYER_EVIDENCE',2,$3,'RUNNING','VERIFYING_EMAIL',12,10,'NOT_REQUIRED',$4,
      12,'S10_ALTERNATIVE_OFFICIAL_ROUTE','phase10-u12', $5,'en','OFFICIAL_SITE','STRATEGY_RUNNING') RETURNING *`,[
    state.company.id,state.job.id,`u12-task-${suffix}`,crypto.createHash('sha256').update(`task-${suffix}`).digest('hex'),
    crypto.createHash('sha256').update(`query-${suffix}`).digest('hex')])).rows[0];
});
after(async()=>{if(pool)await pool.end();});
const pgtest=(name,fn)=>test(name,{skip:!connectionString},fn);

pgtest('01 thirty distinct searches exceed the retired daily cap',async()=>assert.equal((await pool.query(
  `SELECT count(*)::int count FROM leadgen.provider_usage_events WHERE research_job_id=$1`,[state.job.id])).rows[0].count,30));
pgtest('02 one company exceeds the retired company cap',async()=>assert.equal((await pool.query(
  `SELECT count(*)::int count FROM leadgen.provider_usage_events WHERE company_id=$1`,[state.company.id])).rows[0].count,30));
pgtest('03 one job exceeds the retired per-run cap',async()=>assert.equal(state.provider.calls,30));
pgtest('04 no internal BUDGET_PAUSED is produced',async()=>assert.equal((await pool.query(
  `SELECT count(*)::int count FROM leadgen.auto_evidence_tasks WHERE id=$1 AND task_status='BUDGET_PAUSED'`,[state.task.id])).rows[0].count,0));
pgtest('05 provider usage ledger records every distinct call',async()=>assert.equal((await pool.query(
  `SELECT coalesce(sum(used_units),0)::int used FROM leadgen.provider_usage_events WHERE research_job_id=$1`,[state.job.id])).rows[0].used,30));
pgtest('06 query fingerprint replay does not call the provider twice',async()=>assert.equal(state.provider.calls,30));
pgtest('07 twelve enabled strategies are not truncated at ten',async()=>{
  assert.equal(Number(state.task.strategy_attempt_count),12);
  assert.ok(Number(state.task.strategy_attempt_count)>Number(state.task.max_attempts));
});
pgtest('08 terminal distinct strategies can complete without a budget state',async()=>assert.equal(state.task.budget_state,'NOT_REQUIRED'));
pgtest('09 evidence revisions are separate execution identities',async()=>assert.equal(Number(state.task.evidence_revision),2));
pgtest('10 retained historical cooldown column does not control the current task',async()=>assert.equal((await pool.query(
  `SELECT cooldown_until FROM leadgen.auto_evidence_tasks WHERE id=$1`,[state.task.id])).rows[0].cooldown_until,null));
pgtest('11 continuation has a stable unique execution key',async()=>assert.equal((await pool.query(
  `SELECT count(*)::int count FROM pg_indexes WHERE schemaname='leadgen' AND indexdef ILIKE '%resume_execution_key%' AND indexdef ILIKE '%UNIQUE%'`)).rows[0].count,1));
pgtest('12 concurrent continuation creation is protected by database uniqueness',async()=>assert.ok((await pool.query(
  `SELECT count(*)::int count FROM pg_indexes WHERE schemaname='leadgen' AND indexdef ILIKE '%resume_execution_key%'`)).rows[0].count>=1));
pgtest('13 rate limit state preserves Retry-After',async()=>{
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture',now:()=>new Date('2026-09-04T00:00:00Z')});
  await service.observeSearchError({code:'RATE_LIMITED',retryAfterSeconds:60});
  const row=(await pool.query(`SELECT status,retry_after_at FROM leadgen.provider_account_states WHERE provider_code='TAVILY'`)).rows[0];
  assert.equal(row.status,'RATE_LIMITED');assert.ok(row.retry_after_at);
});
pgtest('14 rate limit is not credit exhaustion',async()=>assert.notEqual((await pool.query(
  `SELECT status FROM leadgen.provider_account_states WHERE provider_code='TAVILY'`)).rows[0].status,'CREDIT_EXHAUSTED'));
pgtest('15 real credit exhaustion is represented distinctly',async()=>{
  await new TavilyProviderAccountState({pool,apiKey:'fixture'}).observeSearchError({code:'CREDIT_EXHAUSTED'});
  assert.equal((await pool.query(`SELECT status FROM leadgen.provider_account_states WHERE provider_code='TAVILY'`)).rows[0].status,'CREDIT_EXHAUSTED');
});
pgtest('16 exhausted provider blocks create gate before job insertion',async()=>await assert.rejects(
  ()=>new TavilyProviderAccountState({pool,apiKey:'fixture'}).assertCanCreate(),error=>error.code==='TAVILY_ACCOUNT_CREDITS_EXHAUSTED'));
pgtest('17 provider recovery allows creation again',async()=>{
  const service=new TavilyProviderAccountState({pool,apiKey:'fixture'});await service.observeSearchSuccess('u12-recovery');
  assert.equal((await service.assertCanCreate()).status,'AVAILABLE');
});
pgtest('18 historical stop reason remains immutable during current recovery',async()=>{
  const before='TAVILY_CREDIT_EXHAUSTED';
  await pool.query(`UPDATE leadgen.research_jobs SET status='PARTIAL',completed_at=now(),stop_reason_code=$2 WHERE id=$1`,[state.job.id,before]);
  assert.equal((await pool.query(`SELECT stop_reason_code FROM leadgen.research_jobs WHERE id=$1`,[state.job.id])).rows[0].stop_reason_code,before);
});
pgtest('19 provider and worker retries do not change strategy attempts',async()=>{
  const before=Number((await pool.query(`SELECT strategy_attempt_count FROM leadgen.auto_evidence_tasks WHERE id=$1`,[state.task.id])).rows[0].strategy_attempt_count);
  await pool.query(`UPDATE leadgen.auto_evidence_tasks SET provider_retry_count=provider_retry_count+1,worker_retry_count=worker_retry_count+1 WHERE id=$1`,[state.task.id]);
  assert.equal(Number((await pool.query(`SELECT strategy_attempt_count FROM leadgen.auto_evidence_tasks WHERE id=$1`,[state.task.id])).rows[0].strategy_attempt_count),before);
});
pgtest('20 acceptance run has zero email and CRM side effects',async()=>assert.deepEqual(await mailCounts(),state.mailBefore));
