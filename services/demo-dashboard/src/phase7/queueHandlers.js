import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';

export function createPhase7QueueHandlers({ service }) {
  if (!service) throw new TypeError('Phase7 service is required');
  return Object.freeze({
    [PHASE5_QUEUES.VERIFY_OUTREACH_CONTACT]: data => service.verifyContactWork(data),
    [PHASE5_QUEUES.GENERATE_OUTREACH_DRAFT]: async data => ({
      status:'MANUAL_DRAFT_REQUIRED',company_id:data.company_id||null,provider_calls:0
    }),
    [PHASE5_QUEUES.VALIDATE_OUTREACH_DRAFT]: async data => {
      const draft=await service.repository.getDraft(data.draft_id);
      return {status:draft?.draft_status||'MISSING',draft_id:data.draft_id};
    },
    [PHASE5_QUEUES.SEND_OUTREACH_EMAIL]: data => service.sendMessageWork(data),
    [PHASE5_QUEUES.PROCESS_EMAIL_PROVIDER_EVENT]: data => service.processProviderEventWork(data),
    [PHASE5_QUEUES.PROCESS_INBOUND_MESSAGE]: data => service.processInboundWork(data),
    [PHASE5_QUEUES.CLASSIFY_INBOUND_REPLY]: data => service.classifyInboundWork(data),
    [PHASE5_QUEUES.CREATE_SALES_FOLLOWUP]: async data => ({
      ...(await service.createSalesFollowupWork(data)),automatic_send_allowed:false
    }),
    [PHASE5_QUEUES.SYNC_OUTREACH_TO_CRM]: async data => {
      const result=await service.processCrmSyncWork(data);
      if(result.status==='RETRYABLE_ERROR'){
        const error=new Error(result.configuration_status||result.error_code||'CRM_SYNC_RETRYABLE');
        error.code='CRM_SYNC_RETRYABLE';error.outbox=result;throw error;
      }
      return result;
    },
    [PHASE5_QUEUES.DISCOVER_SHARED_IMPORT_FILES]: data => service.discoverSharedImportFilesWork(data),
    [PHASE5_QUEUES.PARSE_REFERENCE_IMPORT]: async data => service.getImport(data.import_id),
    [PHASE5_QUEUES.COMMIT_REFERENCE_IMPORT]: data => service.commitImportWork(data),
    [PHASE5_QUEUES.EXPORT_BUSINESS_DATA]: data => service.processExportWork(data),
    [PHASE5_QUEUES.RECALCULATE_AFTER_IMPORT]: async data => ({
      status:'RECHECK_COMPLETED',resource_id:data.resource_id||data.import_id||null,
      ...(await service.repository.refreshOpportunityDecisions({ttlDays:Number(service.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)})),provider_calls:0
    }),
    [PHASE5_QUEUES.RECALCULATE_BUSINESS_OPPORTUNITIES]: async data => ({
      status:'RECHECK_COMPLETED',resource_id:data.resource_id||null,
      ...(await service.repository.refreshOpportunityDecisions({ttlDays:Number(service.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)})),provider_calls:0
    }),
    [PHASE5_QUEUES.REFRESH_OPPORTUNITY_EXCEPTION_QUEUE]: async data => ({
      status:'EXCEPTION_QUEUE_REFRESHED',resource_id:data.resource_id||null,
      ...(await service.repository.refreshOpportunityDecisions({ttlDays:Number(service.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)})),provider_calls:0
    })
  });
}
