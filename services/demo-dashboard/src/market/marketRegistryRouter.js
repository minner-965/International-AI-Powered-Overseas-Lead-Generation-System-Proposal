import express from 'express';

// GET  /api/markets/registry          MANAGEMENT, DATA_ADMIN, SALES
// PUT  /api/markets/registry/:code    MANAGEMENT  body {search_enabled:boolean, reason?:string}
export function createMarketRegistryRouter({service,managementAuth,audit=()=>{}}={}){
  if(!service||!managementAuth)throw new Error('Market registry service and authentication required');
  const router=express.Router();
  router.use(managementAuth.authenticate);
  router.get('/',managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'),async(_req,res,next)=>{
    try{res.json({items:await service.list()});}catch(error){next(error);}
  });
  router.put('/:code',managementAuth.requireRoles('MANAGEMENT'),async(req,res,next)=>{
    try{
      if(typeof req.body?.search_enabled!=='boolean')return res.status(400).json({error:'search_enabled must be true or false',code:'MARKET_SEARCH_ENABLED_REQUIRED'});
      const result=await service.setSearchEnabled(req.params.code,{search_enabled:req.body.search_enabled,
        reason:typeof req.body.reason==='string'?req.body.reason.slice(0,500):'',
        actor:req.managementUser.identity,role:req.managementUser.role});
      if(result.changed)audit('MARKET_REGISTRY_SEARCH_TOGGLED',{market_code:result.market_code,search_enabled:result.search_enabled,
        status:result.status,actor:req.managementUser.identity,event_id:result.event_id});
      res.json(result);
    }catch(error){next(error);}
  });
  return router;
}
