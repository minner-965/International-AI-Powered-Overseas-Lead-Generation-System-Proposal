// B3: operator cancellation of research batches and research jobs.
//
// research_jobs.status has no CANCELLED value, so a cancelled job is recorded as
// status FAILED + stop_reason_code OPERATOR_CANCELLED (allowed by
// research_jobs_phase9_stop_reason_check and immutable once written). Its direct-dispatch
// outbox row is closed (dispatch_state FAILED, last_error_code OPERATOR_CANCELLED) so the
// reconciler never dispatches it again and the executor skips it. Nothing is deleted:
// provider usage, cost estimates, batch snapshots and stage history stay as they are.
//
// Ownership: a merchant may cancel its own batches and the jobs it owns; SIM (admin) may
// cancel any. A job that another owner's still-open batch depends on is never stopped by a
// batch cancel (it is reported as kept_shared); a merchant cannot cancel such a job directly.
import {ACTIVE_RESEARCH_STATES} from '../researchBatch/ResearchBatchService.js';

export const OPERATOR_CANCELLED='OPERATOR_CANCELLED';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,status,details)=>Object.assign(new Error(code),{code,status,...(details?{details}:{})});
const TERMINAL_BATCH=new Set(['COMPLETED','PARTIAL','FAILED']);

// Close every still-open outbox row of the given jobs. Idempotent; used by the cancel path,
// the executor and scripts/close-cancelled-research-outbox.mjs.
export const CLOSE_CANCELLED_OUTBOX_SQL=`UPDATE leadgen.research_job_dispatch_outbox SET dispatch_state='FAILED',
  last_error_code='${OPERATOR_CANCELLED}',next_attempt_at=NULL,completed_at=coalesce(completed_at,now()),updated_at=now()
  WHERE research_job_id=ANY($1::uuid[]) AND dispatch_state NOT IN('COMPLETED','FAILED')
  RETURNING research_job_id,id`;
// Every outbox row of an already-cancelled job that is still open (repair of hand-cancelled jobs).
export const OPEN_OUTBOX_OF_CANCELLED_JOBS_SQL=`SELECT o.id,o.research_job_id,o.dispatch_state,o.last_error_code
  FROM leadgen.research_job_dispatch_outbox o JOIN leadgen.research_jobs j ON j.id=o.research_job_id
  WHERE j.status='FAILED' AND j.stop_reason_code='${OPERATOR_CANCELLED}' AND o.dispatch_state NOT IN('COMPLETED','FAILED')
  ORDER BY o.id`;

export async function closeCancelledOutbox(client,jobIds){
  if(!jobIds.length)return [];
  return (await client.query(CLOSE_CANCELLED_OUTBOX_SQL,[jobIds])).rows;
}

const isCancelled=job=>job?.status==='FAILED'&&job?.stop_reason_code===OPERATOR_CANCELLED;

export class ResearchCancellationService {
  constructor({pool,audit=()=>{}}={}){
    if(!pool)throw new Error('ResearchCancellationService requires a PostgreSQL pool');
    this.pool=pool;this.audit=audit;
  }

  async transaction(work){
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
    finally{client.release();}
  }

  // Stop unfinished jobs. Jobs already cancelled only get their outbox closed.
  async stopJobs(client,jobs,identity){
    const active=jobs.filter(job=>ACTIVE_RESEARCH_STATES.includes(job.status)).map(job=>job.id);
    if(active.length)await client.query(`UPDATE leadgen.research_jobs SET status='FAILED',
      stop_reason_code=coalesce(stop_reason_code,'${OPERATOR_CANCELLED}'),completed_at=coalesce(completed_at,now()),
      last_error=$2,blocked_reason='${OPERATOR_CANCELLED}',next_dispatch_attempt_at=NULL
      WHERE id=ANY($1::uuid[]) AND status=ANY($3::text[])`,[active,`Cancelled by ${identity}`.slice(0,500),ACTIVE_RESEARCH_STATES]);
    const closeIds=[...active,...jobs.filter(isCancelled).map(job=>job.id)];
    const closed=await closeCancelledOutbox(client,closeIds);
    return {cancelled_job_ids:active,closed_outbox_job_ids:[...new Set(closed.map(row=>row.research_job_id))]};
  }

  // Batches whose every child is a cancelled job are themselves CANCELLED (the status
  // refresh trigger alone would call them FAILED).
  async settleParentBatches(client,jobIds){
    if(!jobIds.length)return;
    await client.query(`UPDATE leadgen.research_batches b SET status='CANCELLED',updated_at=now()
      WHERE b.id IN(SELECT batch_id FROM leadgen.research_batch_children WHERE research_job_id=ANY($1::uuid[]))
        AND b.status<>'CANCELLED'
        AND NOT EXISTS(SELECT 1 FROM leadgen.research_batch_children c JOIN leadgen.research_jobs j ON j.id=c.research_job_id
          WHERE c.batch_id=b.id AND NOT (j.status='FAILED' AND j.stop_reason_code='${OPERATOR_CANCELLED}'))`,[jobIds]);
  }

  async cancelBatch(batchId,actor={},scope=null){
    if(!UUID.test(String(batchId||'')))throw fail('RESEARCH_BATCH_ID_INVALID',400);
    const identity=String(actor.identity||actor.requested_by||'').trim()||'unknown';
    const merchantId=scope?.restrict?scope.merchantId:null;
    const outcome=await this.transaction(async client=>{
      const batch=(await client.query(`SELECT * FROM leadgen.research_batches WHERE id=$1
        AND ($2::uuid IS NULL OR merchant_id=$2) FOR UPDATE`,[batchId,merchantId])).rows[0];
      if(!batch)throw fail('RESEARCH_BATCH_NOT_FOUND',404);
      const children=(await client.query(`SELECT j.id,j.status,j.stop_reason_code,j.merchant_id,
          EXISTS(SELECT 1 FROM leadgen.research_batch_children o JOIN leadgen.research_batches ob ON ob.id=o.batch_id
            WHERE o.research_job_id=j.id AND o.batch_id<>$1 AND ob.status<>'CANCELLED') shared
        FROM leadgen.research_batch_children c JOIN leadgen.research_jobs j ON j.id=c.research_job_id
        WHERE c.batch_id=$1 ORDER BY j.id FOR UPDATE OF j`,[batchId])).rows;
      const own=job=>String(job.merchant_id||'')===String(batch.merchant_id||'');
      const stoppable=children.filter(job=>own(job)&&!job.shared);
      const keptShared=children.filter(job=>ACTIVE_RESEARCH_STATES.includes(job.status)&&!(own(job)&&!job.shared)).map(job=>job.id);
      if(batch.status==='CANCELLED'){
        const repaired=await this.stopJobs(client,stoppable.filter(isCancelled),identity);
        return {already_cancelled:true,...repaired,kept_shared_job_ids:keptShared};
      }
      if(TERMINAL_BATCH.has(batch.status)&&!children.some(job=>ACTIVE_RESEARCH_STATES.includes(job.status)))
        throw fail('RESEARCH_BATCH_NOT_CANCELLABLE',409,{status:batch.status});
      const stopped=await this.stopJobs(client,stoppable,identity);
      await client.query(`UPDATE leadgen.research_batches SET status='CANCELLED',updated_at=now() WHERE id=$1`,[batchId]);
      await this.settleParentBatches(client,stopped.cancelled_job_ids);
      return {already_cancelled:false,...stopped,kept_shared_job_ids:keptShared};
    });
    this.audit('RESEARCH_BATCH_CANCELLED',{batch_id:batchId,actor:identity,...outcome});
    return {batch_id:batchId,status:'CANCELLED',...outcome};
  }

  async cancelJob(jobId,actor={},scope=null){
    if(!UUID.test(String(jobId||'')))throw fail('RESEARCH_JOB_ID_INVALID',400);
    const identity=String(actor.identity||actor.requested_by||'').trim()||'unknown';
    const merchantId=scope?.restrict?scope.merchantId:null;
    const outcome=await this.transaction(async client=>{
      const job=(await client.query(`SELECT j.id,j.status,j.stop_reason_code,j.merchant_id,
          EXISTS(SELECT 1 FROM leadgen.research_batch_children c JOIN leadgen.research_batches b ON b.id=c.batch_id
            WHERE c.research_job_id=j.id AND b.status<>'CANCELLED' AND b.merchant_id IS DISTINCT FROM j.merchant_id) shared,
          ($2::uuid IS NULL OR j.merchant_id=$2 OR EXISTS(SELECT 1 FROM leadgen.research_batch_children c JOIN leadgen.research_batches b
            ON b.id=c.batch_id WHERE c.research_job_id=j.id AND b.merchant_id=$2)) visible
        FROM leadgen.research_jobs j WHERE j.id=$1 FOR UPDATE OF j`,[jobId,merchantId])).rows[0];
      if(!job||!job.visible)throw fail('RESEARCH_JOB_NOT_FOUND',404);
      if(merchantId&&String(job.merchant_id||'')!==String(merchantId))throw fail('RESEARCH_JOB_CANCEL_FORBIDDEN',403);
      if(isCancelled(job)){const repaired=await this.stopJobs(client,[job],identity);return {already_cancelled:true,...repaired};}
      if(!ACTIVE_RESEARCH_STATES.includes(job.status))throw fail('RESEARCH_JOB_NOT_CANCELLABLE',409,{status:job.status});
      if(merchantId&&job.shared)throw fail('RESEARCH_JOB_SHARED',409);
      const stopped=await this.stopJobs(client,[job],identity);
      await this.settleParentBatches(client,stopped.cancelled_job_ids);
      return {already_cancelled:false,...stopped};
    });
    this.audit('RESEARCH_JOB_CANCELLED',{job_id:jobId,actor:identity,...outcome});
    return {job_id:jobId,status:'CANCELLED',...outcome};
  }
}
