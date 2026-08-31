import express from 'express';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createResearchRouter({service,managementAuth}={}) {
  if(!service||!managementAuth)throw new Error('Research router requires service and management auth');
  const router=express.Router();
  const readRoles=managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES');
  router.use(managementAuth.authenticate,readRoles);

  router.get('/workbench-summary',async(req,res,next)=>{
    try{service.assertReadRole(req.managementUser?.role);res.json(await service.getSummary());}catch(error){next(error);}
  });
  router.get('/tasks',async(req,res,next)=>{
    try{service.assertReadRole(req.managementUser?.role);res.json(await service.listTasks(req.query));}catch(error){next(error);}
  });
  router.get('/jobs',async(req,res,next)=>{
    if(String(req.query.view||'').toLowerCase()!=='inbox')return next();
    try{service.assertReadRole(req.managementUser?.role);res.json(await service.listJobs(req.query));}catch(error){next(error);}
  });
  router.get('/jobs/:id/results',async(req,res,next)=>{
    try{
      if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid research job',code:'RESEARCH_JOB_ID_INVALID'});
      service.assertReadRole(req.managementUser?.role);const result=await service.getJobResults(req.params.id);
      if(!result)return res.status(404).json({error:'Research job not found',code:'RESEARCH_JOB_NOT_FOUND'});res.json(result);
    }catch(error){next(error);}
  });
  router.get('/jobs/:id',async(req,res,next)=>{
    try{
      if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid research job',code:'RESEARCH_JOB_ID_INVALID'});
      service.assertReadRole(req.managementUser?.role);const result=await service.getJob(req.params.id);
      if(!result)return res.status(404).json({error:'Research job not found',code:'RESEARCH_JOB_NOT_FOUND'});res.json(result);
    }catch(error){next(error);}
  });
  return router;
}
