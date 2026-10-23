import express from 'express';
import {createManagementAuth} from '../phase7/managementAuth.js';

const SALES_ROLES=Object.freeze(['SALES','MANAGEMENT']);
const FOLLOWUP_APPROVER_ROLES=Object.freeze(['MANAGEMENT','OUTREACH_APPROVER']);
const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);

export function createCrmRouter({service,env=process.env,managementAuth=null}){
  const router=express.Router();
  const auth=managementAuth||createManagementAuth(env);
  const read=[auth.authenticate];
  const salesWrite=[auth.authenticate,auth.requireRoles(...SALES_ROLES)];
  const approve=[auth.authenticate,auth.requireRoles(...FOLLOWUP_APPROVER_ROLES)];

  router.get('/pipeline',...read,asyncRoute(async(req,res)=>res.json(await service.listPipeline(req.query))));
  router.post('/opportunities/:id/stage',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.setStage(req.params.id,req.body,req.managementUser))));
  router.post('/opportunities/:id/activities',...salesWrite,asyncRoute(async(req,res)=>res.status(201).json(await service.addActivity(req.params.id,req.body,req.managementUser))));
  router.get('/companies/:id/timeline',...read,asyncRoute(async(req,res)=>res.json({items:await service.timeline(req.params.id,req.query)})));

  router.get('/tasks',...read,asyncRoute(async(req,res)=>res.json(await service.listTasks(req.query,req.managementUser))));
  router.post('/tasks',...salesWrite,asyncRoute(async(req,res)=>res.status(201).json(await service.createTask(req.body,req.managementUser))));
  router.patch('/tasks/:id',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.updateTask(req.params.id,req.body,req.managementUser))));

  router.post('/replies/:classificationId/review',...salesWrite,asyncRoute(async(req,res)=>res.json(await service.reviewReply(req.params.classificationId,req.body,req.managementUser))));

  router.get('/followup-drafts',...read,asyncRoute(async(req,res)=>{
    const [items,quota]=await Promise.all([service.listFollowupDrafts(req.query),service.followupQuota?service.followupQuota().catch(()=>null):null]);
    res.json({items,quota});
  }));
  router.post('/followup-drafts/:id/decision',...approve,asyncRoute(async(req,res)=>res.json(await service.decideFollowupDraft(req.params.id,req.body,req.managementUser))));
  return router;
}
