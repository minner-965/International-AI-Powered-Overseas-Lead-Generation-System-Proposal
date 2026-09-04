import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(new URL('../services/demo-dashboard/package.json',import.meta.url));
const pg=require('pg');

const repositoryModuleUrl=existsSync(new URL('../services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js',import.meta.url))
  ?new URL('../services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js',import.meta.url)
  :new URL('../src/autoEvidence/AutoEvidenceOrchestrator.js',import.meta.url);
const {findCanonicalCheckpointContinuation}=await import(repositoryModuleUrl);

const apply=process.argv.includes('--apply');
const dryRun=process.argv.includes('--dry-run')||!apply;
if(apply&&process.argv.includes('--dry-run'))throw new Error('Choose exactly one mode: --dry-run or --apply');

const pool=new pg.Pool({
  host:process.env.POSTGRES_HOST||'postgres',
  port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB||'leadgen',
  user:process.env.POSTGRES_USER||'leadgen',
  password:process.env.POSTGRES_PASSWORD,
  max:4
});

const categoryStages=new Set(['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE']);
const bindingColumn=stage=>categoryStages.has(String(stage||''))?'category_research_job_id':'contact_research_job_id';

async function emailSideEffectCount(client){
  const result=await client.query(`SELECT
    (SELECT count(*) FROM leadgen.outreach_drafts)+
    (SELECT count(*) FROM leadgen.outreach_approvals)+
    (SELECT count(*) FROM leadgen.outbound_messages)+
    (SELECT count(*) FROM leadgen.outbound_message_attempts)+
    (SELECT count(*) FROM leadgen.email_webhook_inbox)+
    (SELECT count(*) FROM leadgen.inbound_messages)+
    (SELECT count(*) FROM leadgen.crm_sync_outbox)+
    (SELECT count(*) FROM leadgen.gmail_ambiguous_send_events) count`);
  return Number(result.rows[0].count);
}

async function inspect(client,{lock=false}={}){
  const tasks=(await client.query(`SELECT t.* FROM leadgen.auto_evidence_tasks t
    WHERE t.checkpoint_replay_count>0 AND t.current_stage IS NOT NULL
      AND EXISTS(SELECT 1 FROM leadgen.auto_evidence_resume_outbox o
        WHERE o.task_id=t.id AND o.checkpoint_replay_count=t.checkpoint_replay_count
          AND o.resume_stage=t.current_stage)
    ORDER BY t.id ${lock?'FOR UPDATE OF t':''}`)).rows;
  const emailCount=await emailSideEffectCount(client);
  const items=[];
  let alreadyCorrect=0;
  for(const task of tasks){
    const canonical=await findCanonicalCheckpointContinuation(client,task);
    if(!canonical)continue;
    const column=bindingColumn(task.current_stage);
    const currentResearchJobId=task[column]||null;
    if(currentResearchJobId===canonical.id){alreadyCorrect+=1;continue;}
    const providerCount=(await client.query(`SELECT count(*)::int count FROM leadgen.provider_usage_events
      WHERE research_job_id=ANY($1::uuid[])`,[[currentResearchJobId,canonical.resumed_from_research_job_id,canonical.id].filter(Boolean)])).rows[0].count;
    items.push({
      task_id:task.id,
      current_research_job_id:currentResearchJobId,
      original_research_job_id:canonical.resumed_from_research_job_id,
      canonical_continuation_id:canonical.id,
      reason_for_change:'CURRENT_CHECKPOINT_CANONICAL_CONTINUATION_MISMATCH',
      strategy_attempt_before:Number(task.strategy_attempt_count||0),
      provider_event_count_before:Number(providerCount),
      email_side_effect_count_before:emailCount,
      checkpoint_replay_count:Number(task.checkpoint_replay_count),
      resume_stage:task.current_stage,
      binding_column:column,
      resume_execution_key:canonical.resume_execution_key
    });
  }
  return{items,alreadyCorrect,eligibleCurrentCheckpoint:tasks.length,emailCount};
}

try{
  if(dryRun){
    const inspected=await inspect(pool);
    const historical=(await pool.query(`SELECT count(DISTINCT task_id)::int count
      FROM leadgen.auto_evidence_resume_outbox`)).rows[0].count;
    console.log(JSON.stringify({
      mode:'DRY_RUN',
      historical_tasks_with_continuation:Number(historical),
      eligible_current_checkpoint:Number(inspected.eligibleCurrentCheckpoint),
      link_changes_planned:inspected.items.length,
      already_correct:inspected.alreadyCorrect,
      historical_stop_reason_changes:0,
      strategy_attempt_changes:0,
      provider_calls:0,
      email_calls:0,
      items:inspected.items
    },null,2));
  }else{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const inspected=await inspect(client,{lock:true});
      if(inspected.items.length!==4){
        const error=new Error(`WP-U03 apply requires exactly 4 planned link changes; observed ${inspected.items.length}`);
        error.code='WP_U03_EXPECTED_FOUR_LINKS';
        throw error;
      }
      for(const item of inspected.items){
        const current=await client.query(`SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE`,[item.task_id]);
        const task=current.rows[0];
        const canonical=await findCanonicalCheckpointContinuation(client,task);
        const column=bindingColumn(task.current_stage);
        if(!canonical||canonical.id!==item.canonical_continuation_id||task[column]!==item.current_research_job_id){
          const error=new Error('Continuation ownership changed after dry-run');
          error.code='WP_U03_CONCURRENT_CHANGE';
          throw error;
        }
        await client.query(`UPDATE leadgen.auto_evidence_tasks SET ${column}=$2,updated_at=now() WHERE id=$1`,[
          task.id,canonical.id
        ]);
        await client.query(`INSERT INTO leadgen.auto_evidence_ownership_repair_events
          (task_id,old_research_job_id,continuation_research_job_id,resume_execution_key,checkpoint_replay_count,repaired_by)
          VALUES($1,$2,$3,$4,$5,'phase10-wp-u03') ON CONFLICT DO NOTHING`,[
          task.id,item.current_research_job_id,canonical.id,canonical.resume_execution_key,task.checkpoint_replay_count
        ]);
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({mode:'APPLY',links_repaired:inspected.items.length,
        historical_stop_reason_changes:0,strategy_attempt_changes:0,provider_calls:0,email_calls:0}));
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
}finally{
  await pool.end();
}
