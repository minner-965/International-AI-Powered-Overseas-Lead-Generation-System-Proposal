// Unusable-lead (无用线索) admin routes (migration 073). Mount after the workspace gate:
//   app.use(createLeadUsabilityRouter({service:leadUsabilityService}));
// Merchants never reach these paths (not in MERCHANT_ROUTES, and requireAdmin refuses them); they only
// see the lead_usability / unusable_lead fields on their own list rows.
import express from 'express';
import {requireAdmin} from '../merchant/auth.js';

const actorOf=req=>req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace';
const route=handler=>async(req,res,next)=>{
  try{await handler(req,res);}
  catch(error){if(error?.status&&error.code)return res.status(error.status).json({error:error.message,code:error.code});next(error);}
};

export function createLeadUsabilityRouter({service}={}){
  if(!service)throw new Error('Lead usability router requires service');
  const router=express.Router();
  router.get('/api/lead-usability/:companyId',requireAdmin,route(async(req,res)=>res.json(await service.history(req.params.companyId))));
  router.post('/api/lead-usability/:companyId/restore',requireAdmin,route(async(req,res)=>
    res.json(await service.restore(req.params.companyId,{actor:actorOf(req),reason:req.body?.reason}))));
  return router;
}
