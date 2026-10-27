#!/usr/bin/env node
// One-off, idempotent repair for research jobs that were cancelled by hand before the cancel
// API existed (status FAILED + stop_reason_code OPERATOR_CANCELLED) but whose direct-dispatch
// outbox row is still open (e.g. RETRY_PENDING / PAUSED_AUTOMATION_OFF), so the reconciler
// could dispatch them again. It closes those outbox rows (dispatch_state FAILED,
// last_error_code OPERATOR_CANCELLED) and marks batches whose every child is a cancelled job
// as CANCELLED. Nothing is deleted.
//
//   node scripts/close-cancelled-research-outbox.mjs            -> dry run: lists what would change
//   node scripts/close-cancelled-research-outbox.mjs --apply    -> applies in one transaction
// Database settings: DATABASE_URL, or POSTGRES_HOST/PORT/DB/USER/PASSWORD as for the server.
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {CLOSE_CANCELLED_OUTBOX_SQL,OPEN_OUTBOX_OF_CANCELLED_JOBS_SQL,OPERATOR_CANCELLED} from '../src/research/ResearchCancellationService.js';

const BATCHES_TO_SETTLE_SQL=`SELECT b.id FROM leadgen.research_batches b
  WHERE b.status<>'CANCELLED' AND EXISTS(SELECT 1 FROM leadgen.research_batch_children c WHERE c.batch_id=b.id)
    AND NOT EXISTS(SELECT 1 FROM leadgen.research_batch_children c JOIN leadgen.research_jobs j ON j.id=c.research_job_id
      WHERE c.batch_id=b.id AND NOT (j.status='FAILED' AND j.stop_reason_code='${OPERATOR_CANCELLED}'))
  ORDER BY b.id`;

export async function closeCancelledResearchOutbox(pool,{apply=false}={}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const open=(await client.query(`${OPEN_OUTBOX_OF_CANCELLED_JOBS_SQL} FOR UPDATE OF o`)).rows;
    const batches=(await client.query(BATCHES_TO_SETTLE_SQL)).rows.map(row=>row.id);
    let closed=[];
    if(apply){
      closed=(await client.query(CLOSE_CANCELLED_OUTBOX_SQL,[[...new Set(open.map(row=>row.research_job_id))]])).rows;
      if(batches.length)await client.query(`UPDATE leadgen.research_batches SET status='CANCELLED',updated_at=now() WHERE id=ANY($1::uuid[])`,[batches]);
      await client.query('COMMIT');
    }else await client.query('ROLLBACK');
    return {mode:apply?'APPLIED':'DRY_RUN',open_outbox_rows:open.map(row=>({outbox_id:String(row.id),research_job_id:row.research_job_id,
      dispatch_state:row.dispatch_state,last_error_code:row.last_error_code})),closed_outbox_rows:closed.length,batches_marked_cancelled:apply?batches:[],
      batches_to_mark_cancelled:batches};
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
  finally{client.release();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:2}):new pg.Pool({
    host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'leadgen',
    user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:2});
  try{console.log(JSON.stringify(await closeCancelledResearchOutbox(pool,{apply:process.argv.includes('--apply')}),null,2));}
  catch(error){console.error(JSON.stringify({status:'FAILED',code:error.code||'CLOSE_OUTBOX_FAILED',message:error.message}));process.exitCode=1;}
  finally{await pool.end();}
}
