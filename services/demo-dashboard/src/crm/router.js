import express from 'express';
import {createManagementAuth} from '../phase7/managementAuth.js';
import {requestScope} from '../merchant/scope.js';
import {crmUuid} from './repository.js';

const SALES_ROLES=Object.freeze(['SALES','MANAGEMENT']);
const FOLLOWUP_APPROVER_ROLES=Object.freeze(['MANAGEMENT','OUTREACH_APPROVER']);
const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);

// deals (deals.js, migration 079): deal values, grade, key customers, reminder rules and reports.
export function createCrmRouter({service,env=process.env,managementAuth=null,deals=null}){
  const router=express.Router();
  const auth=managementAuth||createManagementAuth(env);
  const read=[auth.authenticate];
  const salesWrite=[auth.authenticate,auth.requireRoles(...SALES_ROLES)];
  const approve=[auth.authenticate,auth.requireRoles(...FOLLOWUP_APPROVER_ROLES)];

  router.get('/pipeline',...read,asyncRoute(async(req,res)=>res.json(await service.listPipeline(req.query,requestScope(req)))));
  router.post('/opportunities/:id/stage',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.setStage(req.params.id,req.body,req.managementUser,requestScope(req)))));
  router.post('/opportunities/:id/activities',...salesWrite,asyncRoute(async(req,res)=>res.status(201).json(await service.addActivity(req.params.id,req.body,req.managementUser,requestScope(req)))));
  if(deals){
    const actor=req=>req.managementUser?.identity||'workspace';
    router.get('/companies/:id/deal',...read,asyncRoute(async(req,res)=>res.json(await deals.dealView(crmUuid(req.params.id,'company_id'),requestScope(req)))));
    router.put('/companies/:id/deal',...salesWrite,asyncRoute(async(req,res)=>res.json(await deals.saveDeal(crmUuid(req.params.id,'company_id'),req.body||{},actor(req),requestScope(req)))));
    router.get('/key-customers',...read,asyncRoute(async(req,res)=>res.json(await deals.keyCustomers(requestScope(req)))));
    router.get('/reports',...read,asyncRoute(async(req,res)=>res.json(await deals.reports(requestScope(req)))));
    router.get('/reminder-rules',...read,asyncRoute(async(req,res)=>res.json(await deals.rules(requestScope(req)))));
    router.get('/reminder-rules/preview',...read,asyncRoute(async(req,res)=>res.json(await deals.previewReminders(requestScope(req)))));
    router.put('/reminder-rules',...salesWrite,asyncRoute(async(req,res)=>res.json(await deals.saveRules(req.body||{},actor(req),requestScope(req)))));
  }
  router.get('/companies/:id/timeline',...read,asyncRoute(async(req,res)=>res.json({items:await service.timeline(req.params.id,req.query,requestScope(req))})));

  router.get('/tasks',...read,asyncRoute(async(req,res)=>res.json(await service.listTasks(req.query,req.managementUser,requestScope(req)))));
  router.post('/tasks',...salesWrite,asyncRoute(async(req,res)=>res.status(201).json(await service.createTask(req.body,req.managementUser,requestScope(req)))));
  router.patch('/tasks/:id',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.updateTask(req.params.id,req.body,req.managementUser,requestScope(req)))));

  router.post('/replies/:classificationId/review',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.reviewReply(req.params.classificationId,req.body,req.managementUser,requestScope(req)))));

  router.get('/followup-drafts',...read,asyncRoute(async(req,res)=>{
    const [items,quota]=await Promise.all([service.listFollowupDrafts(req.query,requestScope(req)),service.followupQuota?service.followupQuota(requestScope(req)).catch(()=>null):null]);
    res.json({items,quota});
  }));
  router.post('/followup-drafts/:id/decision',...approve,asyncRoute(async(req,res)=>res.json(await service.decideFollowupDraft(req.params.id,req.body,req.managementUser,requestScope(req)))));
  return router;
}
