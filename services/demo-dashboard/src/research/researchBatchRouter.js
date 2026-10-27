import express from 'express';
import {requestScope} from '../merchant/scope.js';

export function createResearchBatchRouter({service,managementAuth,creationMaintenance=false,cancellation=null}={}) {
  if(!service||!managementAuth)throw new Error('Research batch service and authentication required');
  const router=express.Router();
  const readers=managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES');
  const creators=managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN');
  router.use(managementAuth.authenticate,readers);
  // B4: merchants only receive the markets and categories inside their own scope.
  router.get('/options',async(req,res,next)=>{try{res.json(await service.options(undefined,req.managementUser||null));}catch(error){next(error);}});
  // Spend refusals carry the estimate so the caller can show why creation was refused.
  const costRefusal=(error,res,next)=>error?.estimate&&error.status?
    res.status(error.status).json({error:error.message,code:error.code,search_cost:error.estimate})
    :/^MERCHANT_SCOPE_/.test(error?.code||'')?res.status(422).json({error:error.message,code:error.code,details:error.details||null}):next(error);
  router.post('/preview',async(req,res,next)=>{try{res.json(await service.preview(req.body||{},req.managementUser||{}));}catch(error){costRefusal(error,res,next);}});
  router.get('/',async(req,res,next)=>{try{res.json(await service.list(req.query,requestScope(req)));}catch(error){next(error);}});
  router.get('/:id',async(req,res,next)=>{try{res.json(await service.get(req.params.id,requestScope(req)));}catch(error){next(error);}});
  router.post('/',creators,async(req,res,next)=>{
    try{
      if(creationMaintenance)return res.status(503).json({code:'RESEARCH_CREATION_MAINTENANCE',retryable:true});
      const result=await service.create({...req.body,idempotency_key:req.get('idempotency-key')||req.body?.idempotency_key},req.managementUser);
      res.status(result.idempotent_replay?200:202).json(result);
    }catch(error){costRefusal(error,res,next);}
  });
  // B3: cancel a batch and its unfinished jobs (merchant: own batches; SIM: any).
  if(cancellation)router.post('/:id/cancel',creators,async(req,res,next)=>{
    try{res.json(await cancellation.cancelBatch(req.params.id,req.managementUser||{},requestScope(req)));}
    catch(error){if(error?.status&&error.code)return res.status(error.status).json({error:error.message,code:error.code,...(error.details?{details:error.details}:{})});next(error);}
  });
  return router;
}
