import test from'node:test';
import assert from'node:assert/strict';
import{TASK_HEALTH_STATES,classifyTaskHealth,taskHealthAction,taskHealthAlerts}from'../src/autoEvidence/stuckTaskMonitor.js';
import{AutoEvidenceRepository}from'../src/autoEvidence/AutoEvidenceOrchestrator.js';

test('A15 exposes every required monitoring state',()=>{
  assert.deepEqual(TASK_HEALTH_STATES,[
    'HEALTHY_LONG_RUNNING','STALE_LEASE','PROVIDER_WAIT','CHECKPOINT_RECOVERABLE',
    'PROJECTION_DRIFT','NON_RETRYABLE_INPUT_ERROR','ORPHAN_DISPATCH','AMBIGUOUS_LINEAGE']);
});

test('A15 classifies healthy, stale, provider wait and checkpoint recovery independently',()=>{
  assert.equal(classifyTaskHealth({lease_expired:false}),'HEALTHY_LONG_RUNNING');
  assert.equal(classifyTaskHealth({lease_expired:true,worker_healthy:false}),'STALE_LEASE');
  assert.equal(classifyTaskHealth({provider_request_state:'RETRY_AFTER'}),'PROVIDER_WAIT');
  assert.equal(classifyTaskHealth({lease_expired:true,checkpoint_present:true,worker_healthy:true}),'CHECKPOINT_RECOVERABLE');
});

test('A15 classifies projection, terminal input, orphan and ambiguous lineage',()=>{
  assert.equal(classifyTaskHealth({projection_drift:true}),'PROJECTION_DRIFT');
  assert.equal(classifyTaskHealth({error_code:'TARGET_CATEGORY_REQUIRED',retryable:false}),'NON_RETRYABLE_INPUT_ERROR');
  assert.equal(classifyTaskHealth({dispatch_expected:true,outbox_count:0,live_queue_count:0}),'ORPHAN_DISPATCH');
  assert.equal(classifyTaskHealth({active_continuation_count:2}),'AMBIGUOUS_LINEAGE');
});

test('A15 maps automatic convergence actions and mandatory alerts',()=>{
  assert.equal(taskHealthAction('STALE_LEASE'),'CREATE_UNIQUE_CONTINUATION');
  assert.equal(taskHealthAction('PROJECTION_DRIFT'),'REBUILD_PROJECTION');
  assert.equal(taskHealthAction('ORPHAN_DISPATCH',{empty:true}),'PURGE_OR_ARCHIVE_EMPTY');
  assert.equal(taskHealthAction('NON_RETRYABLE_INPUT_ERROR'),'TERMINALIZE_WITHOUT_RETRY');
  assert.equal(taskHealthAction('PROVIDER_WAIT'),'DELAYED_RETRY');
  assert.deepEqual(taskHealthAlerts({stage_without_heartbeat:true,repeated_non_retryable_outbox_error:true,
    orphan_dispatch:true,active_continuation_count:2,provider_ledger_missing:true},'ORPHAN_DISPATCH'),[
    'STAGE_WITHOUT_HEARTBEAT','REPEATED_NON_RETRYABLE_OUTBOX_ERROR','QUEUED_OR_DISPATCHED_WITHOUT_OUTBOX',
    'DUPLICATE_ACTIVE_CONTINUATION','PROVIDER_CALLED_WITHOUT_LEDGER']);
});

test('A15 projection repair is bounded, queue-aware and terminal-task driven',async()=>{
  let captured;
  const repository=new AutoEvidenceRepository({pool:{query:async(sql,params)=>{
    captured={sql,params};return{rows:[{id:'job-1',status:'PARTIAL',stop_reason_code:'EVIDENCE_EXHAUSTED'}]};
  }}});
  const rows=await repository.reconcileStaleResearchJobProjections({limit:500,leaseMinutes:0});
  assert.equal(rows.length,1);assert.deepEqual(captured.params,[15,100]);
  assert.match(captured.sql,/pgboss\.job/);assert.match(captured.sql,/FOR UPDATE OF j SKIP LOCKED/);
  assert.match(captured.sql,/DUPLICATE_TASK_PROJECTION_RECONCILED/);
});
