export const TASK_HEALTH_STATES=Object.freeze([
  'HEALTHY_LONG_RUNNING','STALE_LEASE','PROVIDER_WAIT','CHECKPOINT_RECOVERABLE',
  'PROJECTION_DRIFT','NON_RETRYABLE_INPUT_ERROR','ORPHAN_DISPATCH','AMBIGUOUS_LINEAGE'
]);

const count=(snapshot,key)=>Number(snapshot?.[key]||0);
const upper=value=>String(value||'').trim().toUpperCase();

export function classifyTaskHealth(snapshot={}){
  const activeContinuations=count(snapshot,'active_continuation_count');
  if(activeContinuations>1||count(snapshot,'cross_task_reference_count')>0)return'AMBIGUOUS_LINEAGE';
  if(snapshot.provider_ledger_missing===true||snapshot.projection_drift===true
    ||(snapshot.canonical_terminal===true&&snapshot.projection_terminal===false))return'PROJECTION_DRIFT';
  if(snapshot.retryable===false||['TARGET_CATEGORY_REQUIRED','INVALID_RESEARCH_INPUT'].includes(upper(snapshot.error_code)))
    return'NON_RETRYABLE_INPUT_ERROR';
  if(['WAITING','IN_FLIGHT','RATE_LIMITED','RETRY_AFTER'].includes(upper(snapshot.provider_request_state)))return'PROVIDER_WAIT';
  if(snapshot.orphan_dispatch===true||(snapshot.dispatch_expected===true&&count(snapshot,'outbox_count')===0
    &&count(snapshot,'live_queue_count')===0))return'ORPHAN_DISPATCH';
  if(snapshot.lease_expired===true&&snapshot.checkpoint_present===true&&activeContinuations===0
    &&count(snapshot,'live_queue_count')===0&&snapshot.worker_healthy!==false)return'CHECKPOINT_RECOVERABLE';
  if(snapshot.lease_expired===true)return'STALE_LEASE';
  return'HEALTHY_LONG_RUNNING';
}

export function taskHealthAction(state,{empty=false}={}){
  return({
    HEALTHY_LONG_RUNNING:'OBSERVE',
    STALE_LEASE:'CREATE_UNIQUE_CONTINUATION',
    PROVIDER_WAIT:'DELAYED_RETRY',
    CHECKPOINT_RECOVERABLE:'RESUME_FROM_CHECKPOINT',
    PROJECTION_DRIFT:'REBUILD_PROJECTION',
    NON_RETRYABLE_INPUT_ERROR:'TERMINALIZE_WITHOUT_RETRY',
    ORPHAN_DISPATCH:empty?'PURGE_OR_ARCHIVE_EMPTY':'RESTORE_DISPATCH_OUTBOX',
    AMBIGUOUS_LINEAGE:'ALERT_AND_HOLD'
  })[state]||'ALERT_AND_HOLD';
}

export function taskHealthAlerts(snapshot={},state=classifyTaskHealth(snapshot)){
  const alerts=[];
  if(snapshot.stage_without_heartbeat===true)alerts.push('STAGE_WITHOUT_HEARTBEAT');
  if(snapshot.repeated_non_retryable_outbox_error===true)alerts.push('REPEATED_NON_RETRYABLE_OUTBOX_ERROR');
  if(state==='ORPHAN_DISPATCH')alerts.push('QUEUED_OR_DISPATCHED_WITHOUT_OUTBOX');
  if(count(snapshot,'active_continuation_count')>1)alerts.push('DUPLICATE_ACTIVE_CONTINUATION');
  if(snapshot.provider_ledger_missing===true)alerts.push('PROVIDER_CALLED_WITHOUT_LEDGER');
  return alerts;
}
