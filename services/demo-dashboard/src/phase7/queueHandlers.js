import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';

async function scheduleAutoEvidence(service,eventKey,payload={}){
  if(!service.queue?.enqueue||!eventKey)return null;
  return service.queue.enqueue(PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE,
    {schedule_source:'EVENT',event_id:eventKey,...payload},
    {singletonKey:`phase10:auto-evidence:event:${String(eventKey).slice(0,180)}`});
}

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
    [PHASE5_QUEUES.PROCESS_EMAIL_PROVIDER_EVENT]: async data => {
      const result=await service.processProviderEventWork(data);
      const sourceId=data.webhook_id||data.event_id||data.message_id||null;
      const scheduleJobId=await scheduleAutoEvidence(service,sourceId&&`email-provider-event:${sourceId}`,{
        company_id:data.company_id||null,resource_id:data.resource_id||null,message_id:data.message_id||null
      });
      return {...result,auto_evidence_schedule_job_id:scheduleJobId};
    },
    [PHASE5_QUEUES.PROCESS_INBOUND_MESSAGE]: async data => {
      const result=await service.processInboundWork(data);
      const sourceId=data.inbound_id||data.message_id||null;
      const scheduleJobId=await scheduleAutoEvidence(service,sourceId&&`inbound-message:${sourceId}`,{
        company_id:data.company_id||null,resource_id:data.resource_id||null,message_id:data.message_id||null
      });
      return {...result,auto_evidence_schedule_job_id:scheduleJobId};
    },
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
    [PHASE5_QUEUES.RECALCULATE_BUSINESS_OPPORTUNITIES]: async data => {
      const result={status:'RECHECK_COMPLETED',resource_id:data.resource_id||null,
        ...(await service.repository.refreshOpportunityDecisions({ttlDays:Number(service.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)})),provider_calls:0};
      return {...result,auto_evidence_schedule_job_id:await scheduleAutoEvidence(service,
        `opportunity-recalculated:${data.resource_id||'all'}`,{
          company_id:data.company_id||null,resource_id:data.resource_id||null,product_profile:data.product_profile||null
        })};
    },
    [PHASE5_QUEUES.REFRESH_OPPORTUNITY_EXCEPTION_QUEUE]: async data => {
      const result={status:'EXCEPTION_QUEUE_REFRESHED',resource_id:data.resource_id||null,
        ...(await service.repository.refreshOpportunityDecisions({ttlDays:Number(service.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)})),provider_calls:0};
      return {...result,auto_evidence_schedule_job_id:await scheduleAutoEvidence(service,
        `opportunity-exception:${data.resource_id||'all'}`,{
          company_id:data.company_id||null,resource_id:data.resource_id||null,product_profile:data.product_profile||null
        })};
    }
  });
}
