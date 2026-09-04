import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../services/demo-dashboard/package.json',import.meta.url));
const pg=require('pg');
const {PgBoss}=require('pg-boss');

export const STALE_TASK_CLASSIFICATIONS=Object.freeze([
  'HEALTHY_ACTIVE','STALE_EMPTY_PURGE_ELIGIBLE','STALE_WITH_PROVIDER_USAGE_ARCHIVE',
  'STALE_WITH_BUSINESS_OUTPUT_FINALIZE','STALE_RECOVERABLE_CONTINUATION',
  'ALREADY_TERMINAL_PROJECTION_DRIFT','AMBIGUOUS_BLOCKED'
]);
const LIVE_QUEUE_STATES=['created','retry','active'];
const sha=value=>crypto.createHash('sha256').update(String(value??'')).digest('hex');

function parseArgs(argv){
  const result={apply:false,dryRun:true,staleMinutes:15,taskIds:[]};
  for(let index=0;index<argv.length;index+=1){
    const arg=argv[index];
    if(arg==='--apply'){result.apply=true;result.dryRun=false;continue;}
    if(arg==='--dry-run'){result.dryRun=true;continue;}
    if(arg==='--stale-minutes'){
      result.staleMinutes=Math.max(1,Math.min(1440,Number(argv[++index])||15));continue;
    }
    if(arg==='--task-id'){
      const id=String(argv[++index]||'').trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid --task-id');
      result.taskIds.push(id);continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

export function classifyStaleTaskSnapshot(snapshot){
  const number=name=>Number(snapshot[name]||0);
  const stale=snapshot.lease_expired===true;
  const provider=number('provider_usage_event_count')+number('provider_used_units')+number('provider_request_id_count');
  const outputs=number('business_output_count');
  const checkpoint=Boolean(snapshot.current_stage&&snapshot.current_strategy_code);
  const active=number('live_queue_count')+number('pending_outbox_count')+number('active_canonical_continuation_count');
  const ambiguous=number('cross_task_reference_count')>0||number('active_canonical_continuation_count')>1
    ||number('current_started_count')>1||number('current_settled_count')>1;
  if(ambiguous)return 'AMBIGUOUS_BLOCKED';
  if(active>0||!stale)return 'HEALTHY_ACTIVE';
  if(snapshot.canonical_terminal===true&&number('current_settled_count')>0)return 'ALREADY_TERMINAL_PROJECTION_DRIFT';
  if(checkpoint&&number('current_settled_count')===0&&number('active_canonical_continuation_count')===0)
    return 'STALE_RECOVERABLE_CONTINUATION';
  if(outputs>0)return 'STALE_WITH_BUSINESS_OUTPUT_FINALIZE';
  if(provider>0)return 'STALE_WITH_PROVIDER_USAGE_ARCHIVE';
  if(!checkpoint&&number('checkpoint_event_count')===0)return 'STALE_EMPTY_PURGE_ELIGIBLE';
  return 'AMBIGUOUS_BLOCKED';
}

function plannedMutation(classification){
  return ({
    HEALTHY_ACTIVE:'NONE_WAIT_FOR_ACTIVE_OWNER',
    STALE_EMPTY_PURGE_ELIGIBLE:'CONTROLLED_STRICT_EMPTY_PURGE',
    STALE_WITH_PROVIDER_USAGE_ARCHIVE:'ARCHIVE_EXECUTION_PRESERVE_PROVIDER_LINEAGE',
    STALE_WITH_BUSINESS_OUTPUT_FINALIZE:'FINALIZE_PROJECTION_PRESERVE_BUSINESS_OUTPUT',
    STALE_RECOVERABLE_CONTINUATION:'APPEND_MANUAL_RETRY_AND_ENQUEUE_UNIQUE_CHECKPOINT_CONTINUATION',
    ALREADY_TERMINAL_PROJECTION_DRIFT:'REBUILD_CURRENT_PROJECTION_FROM_TERMINAL_EVENT',
    AMBIGUOUS_BLOCKED:'NONE_BLOCK_BATCH_APPLY'
  })[classification];
}

export class StaleAutoEvidenceTaskClassifier{
  constructor({pool,staleMinutes=15}){this.pool=pool;this.staleMinutes=staleMinutes;}

  async listTasks(taskIds=[],client=this.pool){
    const params=[this.staleMinutes];
    let filter=`t.task_status='RUNNING' AND t.current_stage IS NOT NULL AND t.current_strategy_code IS NOT NULL
      AND t.updated_at<now()-($1::int*interval '1 minute')`;
    if(taskIds.length){params.push(taskIds);filter='t.id=ANY($2::uuid[])';}
    return (await client.query(`SELECT t.*,c.company_name,c.country_code FROM leadgen.auto_evidence_tasks t
      JOIN leadgen.companies c ON c.id=t.company_id WHERE ${filter} ORDER BY t.created_at,t.id`,params)).rows;
  }

  async snapshot(task,client=this.pool){
    const expectedKey=`auto-evidence:${task.execution_key}:category:strategy:${Math.max(1,Number(task.strategy_attempt_count||0))}`.slice(0,200);
    const row=(await client.query(`WITH linked_jobs AS (
      SELECT category_research_job_id id FROM leadgen.auto_evidence_tasks WHERE id=$1
      UNION SELECT contact_research_job_id FROM leadgen.auto_evidence_tasks WHERE id=$1
      UNION SELECT research_job_id FROM leadgen.auto_evidence_task_attempts WHERE task_id=$1
    ), valid_jobs AS (SELECT id FROM linked_jobs WHERE id IS NOT NULL), canonical AS (
      SELECT * FROM leadgen.research_jobs WHERE idempotency_key=$2
        OR resumed_from_research_job_id IN(SELECT id FROM valid_jobs)
    ) SELECT
      now()-t.updated_at>($3::int*interval '1 minute') lease_expired,
      (SELECT count(*)::int FROM leadgen.provider_usage_events WHERE research_job_id IN(SELECT id FROM valid_jobs)) provider_usage_event_count,
      (SELECT coalesce(sum(used_units),0)::int FROM leadgen.provider_usage_events WHERE research_job_id IN(SELECT id FROM valid_jobs)) provider_used_units,
      (SELECT count(*)::int FROM leadgen.provider_usage_events WHERE research_job_id IN(SELECT id FROM valid_jobs) AND provider_request_id IS NOT NULL) provider_request_id_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id) checkpoint_event_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id
        AND a.strategy_attempt_number=t.strategy_attempt_count AND a.stage=t.current_stage
        AND a.provider_retry_count=t.provider_retry_count AND a.worker_retry_count=t.worker_retry_count
        AND a.checkpoint_replay_count=t.checkpoint_replay_count AND a.event_type='STARTED') current_started_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id
        AND a.strategy_attempt_number=t.strategy_attempt_count AND a.stage=t.current_stage
        AND a.provider_retry_count=t.provider_retry_count AND a.worker_retry_count=t.worker_retry_count
        AND a.checkpoint_replay_count=t.checkpoint_replay_count AND a.event_type='SETTLED') current_settled_count,
      ((SELECT count(*) FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id AND
          (a.prospect_category_source_id IS NOT NULL OR a.prospect_category_observation_id IS NOT NULL
           OR a.buyer_business_model_result_id IS NOT NULL OR a.category_procurement_match_result_id IS NOT NULL
           OR a.product_opportunity_result_id IS NOT NULL OR a.cooperation_feasibility_result_id IS NOT NULL
           OR a.decision_maker_id IS NOT NULL OR a.decision_maker_contact_id IS NOT NULL
           OR a.contact_verification_event_id IS NOT NULL OR a.business_opportunity_decision_snapshot_id IS NOT NULL
           OR coalesce(a.new_url_count,0)>0 OR coalesce(a.usable_evidence_count,0)>0
           OR coalesce(a.named_buyer_candidate_count,0)>0 OR coalesce(a.valid_contact_count,0)>0))+
        (SELECT count(*) FROM leadgen.prospect_category_sources WHERE research_job_id IN(SELECT id FROM valid_jobs))+
        (SELECT count(*) FROM leadgen.prospect_category_observations WHERE research_job_id IN(SELECT id FROM valid_jobs))+
        (SELECT count(*) FROM leadgen.business_opportunity_decision_snapshots WHERE research_job_id IN(SELECT id FROM valid_jobs)))::int business_output_count,
      (SELECT count(*)::int FROM pgboss.job WHERE state::text=ANY($4::text[]) AND data->>'task_id'=t.id::text) live_queue_count,
      ((SELECT count(*) FROM leadgen.research_job_dispatch_outbox WHERE research_job_id IN(SELECT id FROM valid_jobs)
          AND dispatch_state IN('PENDING','PROCESSING','RETRY_PENDING'))+
        (SELECT count(*) FROM leadgen.auto_evidence_resume_outbox WHERE task_id=t.id
          AND dispatch_state IN('PENDING','PROCESSING','RETRY_PENDING')))::int pending_outbox_count,
      (SELECT count(*)::int FROM canonical WHERE status IN('QUEUED','RUNNING','DISCOVERING','CRAWLING','EXTRACTING','QUALIFYING','SCORING')) active_canonical_continuation_count,
      (SELECT count(*)::int FROM canonical) canonical_continuation_count,
      coalesce((SELECT bool_or(status IN('COMPLETED','FAILED','CANCELLED')) FROM canonical),false) canonical_terminal,
      (SELECT count(*)::int FROM leadgen.auto_evidence_tasks other WHERE other.id<>t.id AND
        (other.category_research_job_id IN(SELECT id FROM valid_jobs) OR other.contact_research_job_id IN(SELECT id FROM valid_jobs))) cross_task_reference_count,
      (SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'idempotency_key',idempotency_key) ORDER BY created_at,id) FROM canonical) canonical_continuations
      FROM leadgen.auto_evidence_tasks t WHERE t.id=$1`,[task.id,expectedKey,this.staleMinutes,LIVE_QUEUE_STATES])).rows[0];
    const canonicalContinuations=(row.canonical_continuations||[]).map(item=>({
      id:item.id,status:item.status,idempotency_key_hash:sha(item.idempotency_key)
    }));
    const snapshot={...task,...row,expected_canonical_key_hash:sha(expectedKey)};
    const classification=classifyStaleTaskSnapshot(snapshot);
    return {
      task_id:task.id,classification,
      provider_usage:{events:Number(row.provider_usage_event_count),used_units:Number(row.provider_used_units),request_ids:Number(row.provider_request_id_count)},
      business_outputs:{references:Number(row.business_output_count)},
      checkpoint:{stage:task.current_stage,strategy_code:task.current_strategy_code,strategy_attempt:Number(task.strategy_attempt_count),
        query_fingerprint:task.current_query_fingerprint,events:Number(row.checkpoint_event_count),current_started:Number(row.current_started_count),current_settled:Number(row.current_settled_count)},
      canonical_continuation:{count:Number(row.canonical_continuation_count),active:Number(row.active_canonical_continuation_count),items:canonicalContinuations},
      queue:{live:Number(row.live_queue_count),pending_outbox:Number(row.pending_outbox_count)},
      lease_expired:row.lease_expired===true,cross_task_references:Number(row.cross_task_reference_count),
      planned_mutation:plannedMutation(classification),_task:task
    };
  }

  async classify(taskIds=[]){
    const tasks=await this.listTasks(taskIds);const items=[];
    for(const task of tasks)items.push(await this.snapshot(task));
    const summary=Object.fromEntries(STALE_TASK_CLASSIFICATIONS.map(name=>[name,items.filter(item=>item.classification===name).length]));
    return{items:items.map(({_task,...item})=>item),summary};
  }

  async apply(taskIds=[]){
    const tasks=await this.listTasks(taskIds);
    const pre=[];for(const task of tasks)pre.push(await this.snapshot(task));
    if(pre.some(item=>item.classification==='AMBIGUOUS_BLOCKED')){
      const error=new Error('AMBIGUOUS_BLOCKED tasks prevent batch apply');error.code='AMBIGUOUS_BLOCKED';throw error;
    }
    const recoverable=pre.filter(item=>item.classification==='STALE_RECOVERABLE_CONTINUATION');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      for(const item of recoverable){
        const locked=(await client.query('SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE',[item.task_id])).rows[0];
        const current=await this.snapshot(locked,client);
        if(current.classification!=='STALE_RECOVERABLE_CONTINUATION')throw Object.assign(new Error(`Classification changed for ${item.task_id}`),{code:'CLASSIFICATION_RACE'});
        const scheduleKey=`phase10:a04r2:checkpoint-recovery:${locked.id}:s${locked.strategy_attempt_count}:r${locked.checkpoint_replay_count}`;
        await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
          (schedule_source,schedule_key,task_id,company_id,target_category_scope_key,target_category_code,product_profile,
           business_blocker,evidence_revision,outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
          VALUES('MANUAL_RETRY',$1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED',$9,'phase10-a04r2-classifier','DATA_ADMIN','WP-A04R2',now())
          ON CONFLICT(schedule_key) DO NOTHING`,[scheduleKey,locked.id,locked.company_id,locked.target_category_scope_key,
          locked.target_category_code,locked.product_profile,locked.business_blocker,locked.evidence_revision,locked.input_digest]);
        await client.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='RETRY_SCHEDULED',retry_at=now(),
          technical_blocker=NULL,updated_at=now() WHERE id=$1`,[locked.id]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    const boss=new PgBoss(process.env.DATABASE_URL||{host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
      database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,
      application_name:'dpv-phase10-a04r2-recovery'});
    const dispatches=[];
    try{
      await boss.start();
      for(const item of recoverable){
        const task=item._task;
        const singletonKey=`a04r2:${task.execution_key}:${task.strategy_attempt_count}:${task.current_strategy_code}:${task.current_stage}:r${task.checkpoint_replay_count}`;
        const queueJobId=await boss.send('discover-opportunity-evidence',{
          task_id:task.id,execution_key:task.execution_key,attempt_number:Number(task.strategy_attempt_count),
          strategy_attempt_number:Number(task.strategy_attempt_count),strategy_code:task.current_strategy_code,
          provider_retry_number:Number(task.provider_retry_count||0),worker_retry_number:Number(task.worker_retry_count||0),
          checkpoint_replay_number:Number(task.checkpoint_replay_count||0),stage:task.current_stage
        },{singletonKey});
        dispatches.push({task_id:task.id,queue_job_id:queueJobId,queue:'discover-opportunity-evidence'});
      }
    }finally{await boss.stop({graceful:true,timeout:30000}).catch(()=>{});}
    return{preflight:pre.map(({_task,...item})=>item),dispatches};
  }
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:4});
  try{
    const classifier=new StaleAutoEvidenceTaskClassifier({pool,staleMinutes:args.staleMinutes});
    const result=args.apply?await classifier.apply(args.taskIds):await classifier.classify(args.taskIds);
    console.log(JSON.stringify({mode:args.apply?'APPLY':'DRY_RUN',...result},null,2));
  }finally{await pool.end();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
