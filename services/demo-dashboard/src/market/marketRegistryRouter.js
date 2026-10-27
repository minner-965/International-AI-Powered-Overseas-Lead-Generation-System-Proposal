import express from 'express';

// GET  /api/markets/registry          MANAGEMENT, DATA_ADMIN, SALES
// PUT  /api/markets/registry/:code    MANAGEMENT  body {search_enabled?:boolean, business_send_window?:{days,start,end}, reason?:string}
//      (at least one of search_enabled / business_send_window; both are append-only audited)
export function createMarketRegistryRouter({service,managementAuth,audit=()=>{}}={}){
  if(!service||!managementAuth)throw new Error('Market registry service and authentication required');
  const router=express.Router();
  router.use(managementAuth.authenticate);
  router.get('/',managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'),async(_req,res,next)=>{
    try{res.json({items:await service.list()});}catch(error){next(error);}
  });
  router.put('/:code',managementAuth.requireRoles('MANAGEMENT'),async(req,res,next)=>{
    try{
      const hasWindow=req.body?.business_send_window!==undefined;
      if(typeof req.body?.search_enabled!=='boolean'&&!hasWindow)return res.status(400).json({error:'search_enabled must be true or false',code:'MARKET_SEARCH_ENABLED_REQUIRED'});
      const reason=typeof req.body.reason==='string'?req.body.reason.slice(0,500):'';
      const who={actor:req.managementUser.identity,role:req.managementUser.role};
      let result=null;
      if(hasWindow){
        if(typeof service.setSendWindow!=='function')return res.status(400).json({error:'Send window changes are not supported',code:'MARKET_SEND_WINDOW_UNSUPPORTED'});
        result=await service.setSendWindow(req.params.code,{business_send_window:req.body.business_send_window,reason,...who});
        if(result.changed)audit('MARKET_REGISTRY_SEND_WINDOW_CHANGED',{market_code:result.market_code,business_send_window:result.business_send_window,
          actor:req.managementUser.identity,event_id:result.event_id});
      }
      if(typeof req.body.search_enabled==='boolean'){
        const toggled=await service.setSearchEnabled(req.params.code,{search_enabled:req.body.search_enabled,reason,...who});
        if(toggled.changed)audit('MARKET_REGISTRY_SEARCH_TOGGLED',{market_code:toggled.market_code,search_enabled:toggled.search_enabled,
          status:toggled.status,actor:req.managementUser.identity,event_id:toggled.event_id});
        result=result?{...toggled,changed:Boolean(result.changed||toggled.changed),send_window_event_id:result.event_id||null}:toggled;
      }
      res.json(result);
    }catch(error){
      const status=Number(error?.status);
      if(/^MARKET_/.test(String(error?.code||''))&&status>=400&&status<500)return res.status(status).json({error:error.message,code:error.code});
      next(error);
    }
  });
  return router;
}
