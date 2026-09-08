import express from 'express';

export function createResearchBatchRouter({service,managementAuth,creationMaintenance=false}={}) {
  if(!service||!managementAuth)throw new Error('Research batch service and authentication required');
  const router=express.Router();
  const readers=managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES');
  const creators=managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN');
  router.use(managementAuth.authenticate,readers);
  router.get('/options',async(_req,res,next)=>{try{res.json(await service.options());}catch(error){next(error);}});
  router.post('/preview',async(req,res,next)=>{try{res.json(await service.preview(req.body||{}));}catch(error){next(error);}});
  router.get('/',async(req,res,next)=>{try{res.json(await service.list(req.query));}catch(error){next(error);}});
  router.get('/:id',async(req,res,next)=>{try{res.json(await service.get(req.params.id));}catch(error){next(error);}});
  router.post('/',creators,async(req,res,next)=>{
    try{
      if(creationMaintenance)return res.status(503).json({code:'RESEARCH_CREATION_MAINTENANCE',retryable:true});
      const result=await service.create({...req.body,idempotency_key:req.get('idempotency-key')||req.body?.idempotency_key},req.managementUser);
      res.status(result.idempotent_replay?200:202).json(result);
    }catch(error){next(error);}
  });
  return router;
}
