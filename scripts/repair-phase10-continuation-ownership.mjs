import pg from 'pg';

if(!process.argv.includes('--apply'))throw new Error('Use diagnose-phase10-continuation-ownership.mjs for dry-run; --apply is required here');
const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  const candidates=(await client.query(`WITH latest AS (
    SELECT DISTINCT ON (o.task_id) o.* FROM leadgen.auto_evidence_resume_outbox o
    ORDER BY o.task_id,o.checkpoint_replay_count DESC,o.id DESC
  ) SELECT t.id task_id,t.current_stage,t.strategy_attempt_count,t.checkpoint_replay_count,
    l.original_research_job_id,l.continuation_research_job_id,l.resume_stage,l.execution_key,
    CASE WHEN l.resume_stage IN ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
      THEN t.category_research_job_id ELSE t.contact_research_job_id END old_research_job_id
  FROM leadgen.auto_evidence_tasks t JOIN latest l ON l.task_id=t.id
  JOIN leadgen.research_jobs continuation ON continuation.id=l.continuation_research_job_id
    AND continuation.resumed_from_research_job_id=l.original_research_job_id
    AND continuation.resume_execution_key=l.execution_key
  WHERE t.checkpoint_replay_count=l.checkpoint_replay_count AND
    (CASE WHEN l.resume_stage IN ('DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE')
      THEN t.category_research_job_id ELSE t.contact_research_job_id END) IS DISTINCT FROM l.continuation_research_job_id
  ORDER BY t.id FOR UPDATE OF t`)).rows;
  for(const row of candidates){
    const category=['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE'].includes(row.resume_stage);
    await client.query(`UPDATE leadgen.auto_evidence_tasks SET ${category?'category_research_job_id':'contact_research_job_id'}=$2,
      updated_at=now() WHERE id=$1`,[row.task_id,row.continuation_research_job_id]);
    await client.query(`INSERT INTO leadgen.auto_evidence_ownership_repair_events
      (task_id,old_research_job_id,continuation_research_job_id,resume_execution_key,checkpoint_replay_count,repaired_by)
      VALUES($1,$2,$3,$4,$5,'phase10-wp-a04-2') ON CONFLICT DO NOTHING`,[
      row.task_id,row.old_research_job_id,row.continuation_research_job_id,row.execution_key,row.checkpoint_replay_count]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({mode:'APPLY',incorrect_links_found:candidates.length,links_repaired:candidates.length,
    old_stop_reasons_mutated:0,strategy_attempt_delta:0,provider_call_delta:0,email_side_effect_delta:0}));
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await pool.end();}
