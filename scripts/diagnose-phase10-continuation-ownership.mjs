import pg from 'pg';

const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD});

const sql=`WITH latest AS (
  SELECT DISTINCT ON (o.task_id) o.* FROM leadgen.auto_evidence_resume_outbox o
  ORDER BY o.task_id,o.checkpoint_replay_count DESC,o.id DESC
) SELECT t.id task_id,t.current_stage,t.current_strategy_code,t.strategy_attempt_count,t.checkpoint_replay_count,
  CASE WHEN l.resume_stage IN ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
    THEN t.category_research_job_id ELSE t.contact_research_job_id END old_research_job_id,
  old.status old_job_status,old.stop_reason_code old_stop_reason,l.continuation_research_job_id continuation_job_id,
  continuation.status continuation_status,l.execution_key resume_execution_key,l.dispatch_state,
  CASE WHEN t.checkpoint_replay_count=l.checkpoint_replay_count AND
    (CASE WHEN l.resume_stage IN ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
      THEN t.category_research_job_id ELSE t.contact_research_job_id END) IS DISTINCT FROM l.continuation_research_job_id
    THEN 'RELINK_TO_CONTINUATION' ELSE 'NONE' END proposed_action
FROM leadgen.auto_evidence_tasks t JOIN latest l ON l.task_id=t.id
LEFT JOIN leadgen.research_jobs old ON old.id=(CASE WHEN l.resume_stage IN
  ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
  THEN t.category_research_job_id ELSE t.contact_research_job_id END)
JOIN leadgen.research_jobs continuation ON continuation.id=l.continuation_research_job_id
ORDER BY t.id`;

try{
  const rows=(await pool.query(sql)).rows;
  const incorrect=rows.filter(row=>row.proposed_action!=='NONE');
  console.log(JSON.stringify({mode:'DRY_RUN',task_links_examined:rows.length,incorrect_task_links:incorrect.length,
    links_safe_to_repair:incorrect.length,old_stop_reasons_to_mutate:0,strategy_attempts_to_increment:0,
    provider_calls_to_execute:0,email_side_effects:0,items:incorrect},null,2));
}finally{await pool.end();}
