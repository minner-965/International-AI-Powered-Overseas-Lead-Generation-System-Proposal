import express from 'express';
import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';
import { DataExchangeContractError } from '../dataExchange/index.js';
import { createManagementAuth } from './managementAuth.js';
import { requiredUuid } from './repository.js';

const DRAFT_ROLES = Object.freeze(['SALES','MANAGEMENT']);
const MANAGEMENT_APPROVER_ROLES = Object.freeze(['MANAGEMENT','MANAGEMENT_APPROVER']);
const OUTREACH_APPROVER_ROLES = Object.freeze(['MANAGEMENT','OUTREACH_APPROVER']);
const SENDER_ROLES = Object.freeze(['MANAGEMENT','SENDER_OPERATOR']);
const DATA_ROLES = Object.freeze(['DATA_ADMIN','MANAGEMENT']);
const EXPORT_ROLES = Object.freeze(['SALES','MANAGEMENT','FINANCE']);

function asyncRoute(handler) {
  return (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
}

export function registerPhase7RawWebhookRoutes(app, { service, queue }) {
  if (!app?.post) throw new TypeError('Express app is required');
  const raw = express.raw({ type:() => true, limit:'1mb' });
  for (const provider of ['resend','corporate']) {
    app.post(`/api/webhooks/email/${provider}`, raw, asyncRoute(async (req,res) => {
      const result = await service.acceptWebhook(provider, Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''), req.headers);
      res.status(202).json(result);
    }));
  }
  void queue;
}

export function createPhase7Router({ service, queue, requireInternalToken, env = process.env, managementAuth = null }) {
  const router = express.Router();
  const auth = managementAuth || createManagementAuth(env);
  const read = [auth.authenticate];
  const draftWrite = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...DRAFT_ROLES)];
  const managementApprove = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...MANAGEMENT_APPROVER_ROLES)];
  const outreachApprove = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...OUTREACH_APPROVER_ROLES)];
  const send = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...SENDER_ROLES)];
  const dataWrite = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...DATA_ROLES)];
  const exportWrite = [auth.authenticate,auth.requireCsrf,auth.requireRoles(...EXPORT_ROLES)];

  router.get('/api/management/session', ...read, auth.session);

  router.get('/api/opportunities/:id/decision-history', ...read, asyncRoute(async(req,res)=>res.json(await service.opportunityDecisionHistory(req.params.id))));
  router.post('/api/opportunities/:id/management-approve', ...managementApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.manageOpportunity(req.params.id,'MANAGEMENT_APPROVED',req.body,req.managementUser))));
  router.post('/api/opportunities/:id/hold', ...managementApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.manageOpportunity(req.params.id,'HOLD',req.body,req.managementUser))));
  router.post('/api/opportunities/:id/request-evidence', ...managementApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.manageOpportunity(req.params.id,'REQUEST_EVIDENCE',req.body,req.managementUser))));
  router.post('/api/opportunities/:id/reopen', ...managementApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.manageOpportunity(req.params.id,'REOPEN',req.body,req.managementUser))));
  router.get('/api/contact-queue', ...read, asyncRoute(async(req,res)=>res.json(await service.listContactQueue(req.query))));

  router.get('/api/outreach/marketing-context', ...read, asyncRoute(async(_req,res)=>res.json(await service.getMarketingContext())));
  router.post('/api/outreach/marketing-context/versions', ...outreachApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.createMarketingContext(req.body,req.managementUser))));
  router.post('/api/outreach/marketing-context/:id/approve', ...outreachApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.approveMarketingContext(req.params.id,req.body,req.managementUser))));

  router.post('/api/contacts/:id/hunter-verify', ...draftWrite, asyncRoute(async(req,res)=>res.status(202).json(await service.enqueueContactVerification(req.params.id,req.managementUser))));
  router.get('/api/contacts/:id/verification-history', ...read, asyncRoute(async(req,res)=>res.json(await service.repository.getContactVerificationHistory(req.params.id))));

  router.post('/api/outreach/drafts', ...draftWrite, asyncRoute(async(req,res)=>res.status(201).json(await service.createDraft(req.body,req.managementUser))));
  router.get('/api/outreach/drafts/:id', ...read, asyncRoute(async(req,res)=>{
    const draft=await service.repository.getDraft(req.params.id);if(!draft)return res.status(404).json({error:'Draft not found',code:'OUTREACH_DRAFT_NOT_FOUND'});res.json(draft);
  }));
  router.patch('/api/outreach/drafts/:id', ...draftWrite, asyncRoute(async(req,res)=>res.status(201).json(await service.reviseDraft(req.params.id,req.body,req.managementUser))));
  router.post('/api/outreach/drafts/:id/submit', ...draftWrite, asyncRoute(async(req,res)=>res.json(await service.submitDraft(req.params.id))));
  router.post('/api/outreach/drafts/:id/approve', ...outreachApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.approveDraft(req.params.id,req.body,req.managementUser))));
  router.post('/api/outreach/drafts/:id/reject', ...outreachApprove, asyncRoute(async(req,res)=>res.status(201).json(await service.rejectDraftApproval(req.params.id,req.body,req.managementUser))));
  router.post('/api/outreach/drafts/:id/supersede', ...draftWrite, asyncRoute(async(req,res)=>res.json(await service.supersedeDraft(req.params.id))));

  router.post('/api/outreach/messages/:id/enqueue', ...send, asyncRoute(async(req,res)=>res.status(202).json(await service.enqueueMessage(req.params.id,req.body))));
  router.get('/api/outreach/messages/:id', ...read, asyncRoute(async(req,res)=>{
    const message=await service.repository.getOutboundMessage(req.params.id);if(!message)return res.status(404).json({error:'Message not found',code:'OUTBOUND_MESSAGE_NOT_FOUND'});res.json(message);
  }));
  router.get('/api/outreach/messages/:id/events', ...read, asyncRoute(async(req,res)=>res.json(await service.repository.getOutboundEvents(req.params.id))));
  router.get('/api/outreach/threads/:id', ...read, asyncRoute(async(req,res)=>{
    const thread=await service.repository.getThread(req.params.id);if(!thread)return res.status(404).json({error:'Thread not found',code:'OUTREACH_THREAD_NOT_FOUND'});res.json(thread);
  }));
  router.get('/api/outreach/inbox', ...read, asyncRoute(async(req,res)=>res.json(await service.repository.listInbox(req.query))));

  router.post('/api/crm-sync-outbox', ...dataWrite, asyncRoute(async(req,res)=>res.status(201).json(await service.createCrmOutbox(req.body))));
  router.get('/api/crm-sync-outbox/:id', ...read, asyncRoute(async(req,res)=>res.json(await service.getCrmOutbox(req.params.id,req.managementUser))));
  router.post('/api/crm-sync-outbox/:id/process', ...dataWrite, asyncRoute(async(req,res)=>res.status(202).json(await service.enqueueCrmOutbox(req.params.id))));

  router.get('/api/data-imports/templates/:type', ...read, asyncRoute(async(req,res)=>{
    const template=await service.getTemplate(req.params.type);res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition',`attachment; filename="${template.filename}"`);res.send(template.buffer);
  }));
  router.post('/api/data-imports/dry-run', ...dataWrite, asyncRoute(async(req,res)=>res.status(201).json(await service.createImportDryRun(req.body,req.managementUser))));
  router.get('/api/data-imports/:id', ...read, asyncRoute(async(req,res)=>res.json(await service.getImport(req.params.id))));
  router.get('/api/data-imports/:id/rows', ...read, asyncRoute(async(req,res)=>res.json(await service.repository.getImportRows(req.params.id,req.query))));
  router.post('/api/data-imports/:id/submit', ...dataWrite, asyncRoute(async(req,res)=>res.json(await service.submitImport(req.params.id))));
  router.post('/api/data-imports/:id/approve', ...dataWrite, asyncRoute(async(req,res)=>res.status(201).json(await service.approveImport(req.params.id,req.body,req.managementUser))));
  router.post('/api/data-imports/:id/commit', ...dataWrite, asyncRoute(async(req,res)=>res.status(202).json(await service.enqueueImportCommit(req.params.id,req.managementUser))));
  router.get('/api/data-imports/:id/error-report', ...read, asyncRoute(async(req,res)=>{const report=await service.importErrorReport(req.params.id);
    res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition',`attachment; filename="${report.filename}"`);
    res.set('X-DPV-Error-Row-Count',String(report.row_count));res.send(report.buffer);}));

  router.post('/api/data-exports', ...exportWrite, asyncRoute(async(req,res)=>res.status(202).json(await service.createDataExport(req.body,req.managementUser))));
  router.get('/api/data-exports/:id', ...read, asyncRoute(async(req,res)=>res.json(await service.getExport(req.params.id,req.managementUser))));
  router.get('/api/data-exports/:id/download', ...read, asyncRoute(async(req,res)=>{
    const file=await service.downloadExport(req.params.id,req.managementUser,req.query.token);res.set('Content-Type',file.mimeType);
    res.set('Content-Disposition',`attachment; filename="${file.filename}"`);res.send(file.bytes);
  }));

  if (requireInternalToken) {
    router.post('/api/internal/phase7/orchestrate', requireInternalToken, asyncRoute(async(req,res)=>{
      const action=String(req.body?.action||'').trim().toUpperCase();
      if(action==='IMPORT_DISCOVER')return res.status(202).json(await service.enqueueSharedImportDiscovery(req.body));
      const resourceId=requiredUuid(req.body?.resource_id,'resource_id');
      const mapping={
        OUTREACH_RECHECK:PHASE5_QUEUES.RECALCULATE_BUSINESS_OPPORTUNITIES,
        EXPORT_PROCESS:PHASE5_QUEUES.EXPORT_BUSINESS_DATA,
        CRM_SYNC:PHASE5_QUEUES.SYNC_OUTREACH_TO_CRM
      };
      if(!mapping[action])return res.status(400).json({error:'Unsupported Phase 7 action',code:'PHASE7_ACTION_INVALID'});
      const key=action==='EXPORT_PROCESS'?'export_id':action==='CRM_SYNC'?'outbox_id':'resource_id';
      const queueJobId=await queue.enqueue(mapping[action],{[key]:resourceId,orchestrator_action:action},{singletonKey:`phase7:orchestrate:${action}:${resourceId}`});
      res.status(202).json({status:'QUEUED',action,resource_id:resourceId,queue: mapping[action],queue_job_id:queueJobId,provider_calls:0});
    }));
  }

  router.use((error,_req,res,_next)=>{
    const status=Number(error.status)||(
      error instanceof DataExchangeContractError?400:
      /NOT_FOUND$/.test(String(error.code||''))?404:
      /FORBIDDEN|BLOCKED|CONFLICT|MISMATCH|EXPIRED/.test(String(error.code||''))?409:500);
    if(status>=500)console.error(error);
    res.status(status).json({error:status>=500?'Internal server error':error.message,code:error.code||'PHASE7_INTERNAL_ERROR',details:status<500?error.details:undefined});
  });
  return router;
}

export { asyncRoute };
