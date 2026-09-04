import pg from 'pg';
import {AutoEvidenceRepository} from '../services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js';

const apply=process.argv.includes('--apply');
const pool=new pg.Pool({
  host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',
  password:process.env.POSTGRES_PASSWORD,max:4
});

async function snapshot(){
  const result=await pool.query(`WITH paused AS (
    SELECT t.*,
      CASE WHEN t.current_stage IN ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
        THEN t.category_research_job_id ELSE t.contact_research_job_id END original_job_id
    FROM leadgen.auto_evidence_tasks t WHERE t.task_status='BUDGET_PAUSED'
  ), classified AS (
    SELECT p.*,j.stop_reason_code,j.status original_job_status,
      (p.current_stage IS NOT NULL AND p.current_strategy_code IS NOT NULL AND p.original_job_id IS NOT NULL) checkpoint_present,
      (p.updated_at<date_trunc('day',now())) new_daily_window,
      (EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=p.company_id AND s.lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=p.company_id AND s.lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
          JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
          WHERE l.company_id=p.company_id AND l.link_status='CONFIRMED'
            AND h.customer_role='INTERNAL_EXISTING_CUSTOMER')) business_blocked,
      EXISTS(SELECT 1 FROM leadgen.auto_evidence_resume_outbox o WHERE o.task_id=p.id) already_resumed
    FROM paused p LEFT JOIN leadgen.research_jobs j ON j.id=p.original_job_id
  ) SELECT count(*)::int paused_jobs_found,
    count(*) FILTER(WHERE checkpoint_present AND new_daily_window AND NOT business_blocked)::int budget_window_eligible,
    count(*) FILTER(WHERE checkpoint_present)::int checkpoint_present,
    count(*) FILTER(WHERE checkpoint_present AND stop_reason_code IS NULL
      AND technical_blocker='PROVIDER_BUDGET_PAUSED' AND original_job_status='PARTIAL')::int legacy_checkpoint_without_job_stop_reason,
    count(*) FILTER(WHERE already_resumed)::int already_resumed_or_deduplicated,
    count(*) FILTER(WHERE business_blocked)::int blocked_by_current_business_gate,
    count(*) FILTER(WHERE checkpoint_present AND new_daily_window AND NOT business_blocked AND NOT already_resumed)::int would_create_continuation_count
    FROM classified`);
  const row=result.rows[0];
  return{...row,would_create_dispatch_outbox_count:row.would_create_continuation_count,
    would_alter_historical_stop_reason_count:0};
}

async function repairContinuationLinks(){
  const result=await pool.query(`WITH latest AS (
    SELECT DISTINCT ON (o.task_id) o.task_id,o.continuation_research_job_id,o.resume_stage,o.checkpoint_replay_count
    FROM leadgen.auto_evidence_resume_outbox o
    ORDER BY o.task_id,o.checkpoint_replay_count DESC,o.id DESC
  ) UPDATE leadgen.auto_evidence_tasks t SET
    category_research_job_id=CASE WHEN l.resume_stage IN
      ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
      THEN l.continuation_research_job_id ELSE t.category_research_job_id END,
    contact_research_job_id=CASE WHEN l.resume_stage NOT IN
      ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
      THEN l.continuation_research_job_id ELSE t.contact_research_job_id END,
    updated_at=now()
    FROM latest l WHERE t.id=l.task_id AND t.checkpoint_replay_count=l.checkpoint_replay_count
      AND (CASE WHEN l.resume_stage IN
        ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
        THEN t.category_research_job_id ELSE t.contact_research_job_id END) IS DISTINCT FROM l.continuation_research_job_id
    RETURNING t.id`);
  return result.rowCount;
}

try{
  const before=await snapshot();
  if(!apply){
    console.log(JSON.stringify({mode:'DRY_RUN',...before}));
  }else{
    const repository=new AutoEvidenceRepository({pool});
    const continuationLinksRepaired=await repairContinuationLinks();
    const candidates=await repository.selectDueBudgetResumes({limit:100});
    let resumed=0,deduplicated=0,stillBudgetPaused=0,blockedByBusinessGate=0,errors=0;
    const errorCodes={};
    for(const task of candidates){
      try{
        const result=await repository.autoResumeBudgetPaused(task.id,{
          scheduleKey:`repair-phase10-budget-resume:${task.id}:${new Date().toISOString().slice(0,10)}`
        });
        if(result.resumed)resumed+=1;
        else if(result.still_budget_paused)stillBudgetPaused+=1;
        else if(result.blocked_by_business_gate)blockedByBusinessGate+=1;
        else deduplicated+=1;
      }catch(error){
        errors+=1;
        const code=String(error?.code||'UNKNOWN').replace(/[^A-Z0-9_]/gi,'_').slice(0,80);
        errorCodes[code]=(errorCodes[code]||0)+1;
      }
    }
    console.log(JSON.stringify({mode:'APPLY',continuation_links_repaired:continuationLinksRepaired,
      scanned:candidates.length,resumed,deduplicated,
      still_budget_paused:stillBudgetPaused,blocked_by_business_gate:blockedByBusinessGate,errors,
      historical_stop_reasons_altered:0,error_codes:errorCodes,after:await snapshot()}));
    if(errors)process.exitCode=1;
  }
}finally{await pool.end();}
