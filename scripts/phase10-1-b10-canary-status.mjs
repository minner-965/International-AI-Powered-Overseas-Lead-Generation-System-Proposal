import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const workspacePackage=new URL('../services/demo-dashboard/package.json',import.meta.url);
const runtimePackage=new URL('../package.json',import.meta.url);
const require=createRequire(existsSync(fileURLToPath(workspacePackage))?workspacePackage:runtimePackage);
const {Pool}=require('pg');

const jobId=process.argv[2];
if(!jobId)throw new Error('research job id is required');

const pool=new Pool({
  host:process.env.POSTGRES_HOST||'postgres',
  port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB,
  user:process.env.POSTGRES_USER,
  password:process.env.POSTGRES_PASSWORD,
  max:2
});

try{
  const root=(await pool.query(`SELECT id,status,job_type,idempotency_key,created_at,started_at,completed_at,
    candidates_found,companies_attempted,companies_qualified,error_count
    FROM leadgen.research_jobs WHERE id=$1`,[jobId])).rows[0]||null;
  const companies=(await pool.query(`SELECT DISTINCT company_id FROM leadgen.research_candidate_verifications
    WHERE research_job_id=$1 AND company_id IS NOT NULL ORDER BY company_id`,[jobId])).rows.map(row=>row.company_id);
  const jobs=(await pool.query(`SELECT id,status,job_type,idempotency_key,created_at,started_at,completed_at,
    companies_attempted,category_matches_passed,category_matches_unknown,decision_makers_found,
    contact_routes_found,error_count
    FROM leadgen.research_jobs
    WHERE id=$1 OR idempotency_key=$2
      OR ($3::uuid[]<>'{}' AND requested_company_ids&&$3::uuid[] AND created_at>=$4)
    ORDER BY created_at,id`,[jobId,`post-discovery-category:${jobId}`,companies,root?.created_at||new Date(0)])).rows;
  const jobIds=jobs.map(row=>row.id);
  const result=(await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.research_candidate_verifications
      WHERE research_job_id=$1 AND verification_status='VERIFIED_BUSINESS'
        AND promotion_status IN('PROMOTED_NEW','ENRICHED_EXISTING')) promoted_companies,
    (SELECT count(*)::int FROM leadgen.category_procurement_match_results
      WHERE research_job_id=ANY($2::uuid[])) category_matches,
    (SELECT count(*)::int FROM leadgen.company_contact_route_current
      WHERE company_id=ANY($3::uuid[])) company_contact_routes,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current
      WHERE research_job_id=ANY($2::uuid[])) opportunities,
    (SELECT coalesce(sum(used_units),0)::int FROM leadgen.provider_usage_events
      WHERE research_job_id=ANY($2::uuid[])) provider_units,
    (SELECT count(*)::int FROM leadgen.research_job_dispatch_outbox
      WHERE research_job_id=ANY($2::uuid[]) AND dispatch_state='PENDING'
        AND created_at<now()-interval '10 minutes') stale_dispatch_pending`,[jobId,jobIds,companies])).rows[0];
  const matches=(await pool.query(`SELECT company_id,match_status,band,score,coverage_percent,
    observed_categories,matched_scope_ids,reason_codes,missing_evidence,match_basis,created_at
    FROM leadgen.category_procurement_match_results WHERE research_job_id=ANY($1::uuid[])
    ORDER BY created_at,id`,[jobIds])).rows;
  const tasks=(await pool.query(`SELECT id,company_id,task_status,current_stage,business_blocker,
    strategy_attempt_count,provider_retry_count,worker_retry_count,category_research_job_id,
    contact_research_job_id,updated_at
    FROM leadgen.auto_evidence_tasks WHERE company_id=ANY($1::uuid[]) AND created_at>=$2
    ORDER BY created_at,id`,[companies,root?.created_at||new Date(0)])).rows;
  process.stdout.write(`${JSON.stringify({root,companies,jobs,matches,tasks,...result})}\n`);
}finally{
  await pool.end();
}
