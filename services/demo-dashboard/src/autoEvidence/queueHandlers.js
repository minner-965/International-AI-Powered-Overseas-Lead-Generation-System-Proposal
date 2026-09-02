import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';
import { AUTO_EVIDENCE_QUEUE_STAGE } from './AutoEvidenceOrchestrator.js';

export function createAutoEvidenceQueueHandlers({ service } = {}) {
  if (!service) throw new TypeError('Auto-evidence service is required');
  const runStage=(stage,data)=>service.runStage(stage,data).catch(error=>{
    console.error(JSON.stringify({
      event:'AUTO_EVIDENCE_QUEUE_ERROR',stage,task_id:data?.task_id||null,
      code:error?.code||'AUTO_EVIDENCE_QUEUE_UNHANDLED',constraint:error?.constraint||null,
      message:String(error?.message||error).slice(0,240)
    }));
    throw error;
  });
  return Object.freeze({
    [PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE]: data => service.reconcile(data),
    [PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE], data
    ),
    [PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY], data
    ),
    [PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH], data
    ),
    [PHASE5_QUEUES.FIND_PROFILE_BUYER]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.FIND_PROFILE_BUYER], data
    ),
    [PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL], data
    ),
    [PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3]: data => runStage(
      AUTO_EVIDENCE_QUEUE_STAGE[PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3], data
    ),
    [PHASE5_QUEUES.REFRESH_AUTO_EVIDENCE_EXCEPTION]: data => service.refreshException(data)
  });
}
