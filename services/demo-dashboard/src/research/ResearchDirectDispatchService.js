import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';

const trueValue=value=>/^(1|true|yes|on)$/i.test(String(value||''));
const safeCode=error=>String(error?.code||'QUEUE_UNAVAILABLE').toUpperCase().replace(/[^A-Z0-9_]+/g,'_').slice(0,80);

export class ResearchDirectDispatchService {
  constructor({pool,queue,executor=null,enabled=false,audit=()=>{}}={}) {
    if(!pool)throw new Error('ResearchDirectDispatchService requires a PostgreSQL pool');
    if(!queue)throw new Error('ResearchDirectDispatchService requires a queue');
    this.pool=pool;this.queue=queue;this.executor=executor;this.enabled=enabled===true;this.audit=audit;
  }

  async createAtomic(createJob) {
    const client=await this.pool.connect();let job;
    try{
      await client.query('BEGIN');
      job=await createJob(client);
      if(job?.inserted&&this.enabled){
        await client.query(`INSERT INTO leadgen.research_job_dispatch_outbox(research_job_id,execution_key)
          VALUES($1,$2) ON CONFLICT(research_job_id) DO NOTHING`,[job.id,job.dispatch_execution_key]);
      }
      await client.query('COMMIT');
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
    if(job?.inserted&&this.enabled)return {job,dispatch:await this.dispatch(job.id)};
    return {job,dispatch:null};
  }

  async dispatch(researchJobId) {
    const result=await this.pool.query(`SELECT o.*,j.status job_status FROM leadgen.research_job_dispatch_outbox o
      JOIN leadgen.research_jobs j ON j.id=o.research_job_id WHERE o.research_job_id=$1`,[researchJobId]);
    if(!result.rowCount)return {state:'MISSING'};
    const row=result.rows[0];
    if(row.dispatch_state==='COMPLETED'||['COMPLETED','COMPLETE'].includes(row.job_status))return {state:'COMPLETED',queue_job_id:row.queue_job_id};
    try{
      const queueJobId=await this.queue.enqueue(PHASE5_QUEUES.EXECUTE_RESEARCH_JOB,{
        research_job_id:row.research_job_id,execution_key:row.execution_key
      },{singletonKey:row.execution_key});
      await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='DISPATCHED',queue_job_id=$2,
        dispatched_at=coalesce(dispatched_at,now()),next_attempt_at=NULL,last_error_code=NULL,updated_at=now()
        WHERE research_job_id=$1`,[researchJobId,String(queueJobId||'')||null]);
      await this.pool.query(`UPDATE leadgen.research_jobs SET dispatch_state='DISPATCHED',blocked_reason=NULL,
        last_dispatch_attempt_at=now(),next_dispatch_attempt_at=NULL WHERE id=$1`,[researchJobId]);
      return {state:'DISPATCHED',queue_job_id:queueJobId||null};
    }catch(error){
      const code=safeCode(error);
      await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='RETRY_PENDING',
        attempt_count=attempt_count+1,last_error_code=$2,next_attempt_at=now()+interval '30 seconds',updated_at=now()
        WHERE research_job_id=$1`,[researchJobId,code]);
      await this.pool.query(`UPDATE leadgen.research_jobs SET dispatch_state='QUEUE_UNAVAILABLE',blocked_reason='DIRECT_QUEUE_RETRY_PENDING',
        last_dispatch_attempt_at=now(),next_dispatch_attempt_at=now()+interval '30 seconds' WHERE id=$1`,[researchJobId]);
      this.audit('RESEARCH_DIRECT_QUEUE_DEFERRED',{job_id:researchJobId,code});
      return {state:'RETRY_PENDING',error_code:code};
    }
  }

  async reconcile({limit=25}={}) {
    if(!this.enabled)return {enabled:false,selected:0,outcomes:[]};
    const claimed=await this.pool.query(`WITH selected AS (
      SELECT id FROM leadgen.research_job_dispatch_outbox WHERE dispatch_state IN('PENDING','RETRY_PENDING')
        AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE leadgen.research_job_dispatch_outbox o SET next_attempt_at=now()+interval '30 seconds',updated_at=now()
      FROM selected s WHERE o.id=s.id RETURNING o.research_job_id`,[Math.max(1,Math.min(100,Number(limit)||25))]);
    const outcomes=[];
    for(const row of claimed.rows)outcomes.push({research_job_id:row.research_job_id,...await this.dispatch(row.research_job_id)});
    return {enabled:true,selected:claimed.rowCount,outcomes};
  }

  async execute(payload) {
    if(!this.executor)throw new Error('Research direct executor is not configured');
    return this.executor.execute(payload);
  }
}

export class ResearchJobDirectExecutor {
  constructor({pool,stages={},audit=()=>{}}={}) {
    if(!pool)throw new Error('ResearchJobDirectExecutor requires a PostgreSQL pool');
    this.pool=pool;this.stages=stages;this.audit=audit;
  }

  async checkpoint(jobId,name) {
    await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET checkpoint=$2,updated_at=now() WHERE research_job_id=$1`,[jobId,name]);
  }

  async setStatus(jobId,status,{terminal=false}={}) {
    await this.pool.query(`UPDATE leadgen.research_jobs SET status=$2,
      started_at=CASE WHEN $2='DISCOVERING' THEN coalesce(started_at,now()) ELSE started_at END,
      completed_at=CASE WHEN $3 THEN coalesce(completed_at,now()) ELSE completed_at END,
      last_error=CASE WHEN $2='COMPLETED' THEN NULL ELSE last_error END WHERE id=$1`,[jobId,status,terminal]);
  }

  async execute({research_job_id:jobId,execution_key:executionKey}={}) {
    const claimed=await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='PROCESSING',
      attempt_count=attempt_count+1,updated_at=now() WHERE research_job_id=$1 AND execution_key=$2
      RETURNING checkpoint,dispatch_state`,[jobId,executionKey]);
    if(!claimed.rowCount)throw Object.assign(new Error('Research direct outbox row not found'),{code:'RESEARCH_DIRECT_OUTBOX_MISSING'});
    let checkpoint=claimed.rows[0].checkpoint;
    const order=['CREATED','QUERIES_GENERATED','DISCOVERY_COMPLETED','CONTACTS_CHECKED','COMPANIES_VERIFIED','SCORING_COMPLETED','COMPLETED'];
    const done=name=>order.indexOf(checkpoint)>=order.indexOf(name);
    try{
      if(!done('QUERIES_GENERATED')){await this.setStatus(jobId,'DISCOVERING');await this.stages.generateQueries?.(jobId);await this.checkpoint(jobId,'QUERIES_GENERATED');checkpoint='QUERIES_GENERATED';}
      if(!done('DISCOVERY_COMPLETED')){await this.stages.discover?.(jobId);await this.checkpoint(jobId,'DISCOVERY_COMPLETED');checkpoint='DISCOVERY_COMPLETED';}
      if(!done('CONTACTS_CHECKED')){await this.stages.checkContacts?.(jobId);await this.checkpoint(jobId,'CONTACTS_CHECKED');checkpoint='CONTACTS_CHECKED';}
      if(!done('COMPANIES_VERIFIED')){await this.setStatus(jobId,'CRAWLING');await this.stages.verify?.(jobId);await this.setStatus(jobId,'QUALIFYING');await this.checkpoint(jobId,'COMPANIES_VERIFIED');checkpoint='COMPANIES_VERIFIED';}
      if(!done('SCORING_COMPLETED')){await this.setStatus(jobId,'SCORING');await this.stages.score?.(jobId,executionKey);await this.checkpoint(jobId,'SCORING_COMPLETED');checkpoint='SCORING_COMPLETED';}
      await this.setStatus(jobId,'COMPLETED',{terminal:true});await this.checkpoint(jobId,'COMPLETED');
      await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='COMPLETED',completed_at=now(),updated_at=now() WHERE research_job_id=$1`,[jobId]);
      await this.stages.completed?.(jobId);
      this.audit('RESEARCH_DIRECT_QUEUE_COMPLETED',{job_id:jobId});
      return {research_job_id:jobId,status:'COMPLETED',checkpoint:'COMPLETED'};
    }catch(error){
      await this.pool.query(`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='RETRY_PENDING',last_error_code=$2,
        next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE research_job_id=$1`,[jobId,safeCode(error)]);
      throw error;
    }
  }
}

export function researchDirectQueueConfig(env=process.env){return Object.freeze({enabled:trueValue(env.RESEARCH_DIRECT_QUEUE_DISPATCH)});}
