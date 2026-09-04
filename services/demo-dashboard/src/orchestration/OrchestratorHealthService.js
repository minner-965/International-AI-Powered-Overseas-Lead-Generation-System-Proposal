import { createHash } from 'node:crypto';

export const DISPATCH_STATES=Object.freeze([
  'PENDING','DISPATCHED','ORCHESTRATOR_UNAVAILABLE','WORKFLOW_INACTIVE','WEBHOOK_AUTH_FAILED','QUEUE_UNAVAILABLE'
]);

const upper=value=>String(value||'').trim().toUpperCase();
const boundedInt=(value,fallback,min,max)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(min,Math.min(max,Math.trunc(number))):fallback;
};

export function heartbeatState(observedAt,{now=new Date(),intervalMinutes=30}={}) {
  if(!observedAt)return {state:'MISSING',observed_at:null};
  const observed=new Date(observedAt);
  const ttlMs=(2*boundedInt(intervalMinutes,30,1,1440)+5)*60*1000;
  return {state:now.getTime()-observed.getTime()<=ttlMs?'ACTIVE':'STALE',observed_at:observed.toISOString()};
}

function safeMetadata(value={}) {
  const allowed=['event','result','job_count','duration_ms'];
  return Object.fromEntries(allowed.filter(key=>value[key]!==undefined)
    .map(key=>[key,typeof value[key]==='string'?String(value[key]).slice(0,80):Number(value[key])]));
}

export class OrchestratorHealthService {
  constructor({pool,intervalMinutes=30,queuedThresholdMinutes=10,retryDelayMinutes=5,now=()=>new Date()}={}) {
    if(!pool)throw new Error('OrchestratorHealthService requires a PostgreSQL pool');
    this.pool=pool;
    this.intervalMinutes=boundedInt(intervalMinutes,30,1,1440);
    this.queuedThresholdMinutes=boundedInt(queuedThresholdMinutes,10,1,1440);
    this.retryDelayMinutes=boundedInt(retryDelayMinutes,5,1,1440);
    this.now=now;
  }

  async heartbeat({workflow_key,workflow_version='1',instance_id,status='HEALTHY',metadata={}}={}) {
    if(!/^[a-zA-Z0-9._-]{3,120}$/.test(String(workflow_key||'')))throw Object.assign(new Error('Invalid workflow key'),{status:400});
    if(!['RUNNING','HEALTHY','FAILED'].includes(upper(status)))throw Object.assign(new Error('Invalid heartbeat status'),{status:400});
    const instanceHash=createHash('sha256').update(String(instance_id||'unknown')).digest('hex');
    const result=await this.pool.query(`INSERT INTO leadgen.orchestrator_heartbeats
      (orchestrator_type,workflow_key,workflow_version,instance_id_hash,status,safe_metadata_json,observed_at)
      VALUES ('N8N',$1,$2,$3,$4,$5,$6) RETURNING observed_at`,[
      workflow_key,String(workflow_version).slice(0,80),instanceHash,upper(status),safeMetadata(metadata),this.now()]);
    return {state:'ACTIVE',observed_at:new Date(result.rows[0].observed_at).toISOString()};
  }

  async status(workflowKey) {
    const result=await this.pool.query(`SELECT observed_at FROM leadgen.orchestrator_heartbeats
      WHERE workflow_key=$1 AND status IN('RUNNING','HEALTHY') ORDER BY observed_at DESC,id DESC LIMIT 1`,[workflowKey]);
    return heartbeatState(result.rows[0]?.observed_at,{now:this.now(),intervalMinutes:this.intervalMinutes});
  }

  async recordDispatch(jobId,state,{reason=null,nextAttemptAt=null}={}) {
    if(!DISPATCH_STATES.includes(state))throw new Error('Invalid dispatch state');
    await this.pool.query(`UPDATE leadgen.research_jobs SET dispatch_state=$2,blocked_reason=$3,
      last_dispatch_attempt_at=now(),next_dispatch_attempt_at=$4 WHERE id=$1`,[jobId,state,reason?String(reason).slice(0,160):null,nextAttemptAt]);
  }

  async claimQueued(limit=25) {
    const result=await this.pool.query(`WITH candidates AS (
      SELECT id FROM leadgen.research_jobs
      WHERE status='QUEUED' AND dispatch_state<>'DISPATCHED'
        AND created_at<=now()-($1::int*interval '1 minute')
        AND (next_dispatch_attempt_at IS NULL OR next_dispatch_attempt_at<=now())
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE leadgen.research_jobs j SET last_dispatch_attempt_at=now(),
      next_dispatch_attempt_at=now()+($3::int*interval '1 minute')
      FROM candidates c WHERE j.id=c.id RETURNING j.*`,[this.queuedThresholdMinutes,limit,this.retryDelayMinutes]);
    return result.rows;
  }

  async watchdog({dispatch,limit=25}={}) {
    if(typeof dispatch!=='function')throw new Error('watchdog requires dispatch');
    const jobs=await this.claimQueued(Math.max(1,Math.min(100,Number(limit)||25)));
    const outcomes=[];
    for(const job of jobs){
      try{
        await dispatch(job);
        await this.recordDispatch(job.id,'DISPATCHED');
        outcomes.push({job_id:job.id,dispatch_state:'DISPATCHED'});
      }catch(error){
        await this.recordDispatch(job.id,'QUEUE_UNAVAILABLE',{reason:'DIRECT_QUEUE_RETRY_PENDING'});
        outcomes.push({job_id:job.id,dispatch_state:'QUEUE_UNAVAILABLE'});
      }
    }
    return {dispatch:{state:'DIRECT_PG_BOSS'},checked:jobs.length,outcomes};
  }
}
