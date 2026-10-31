// Model assist settings, usage and the human review list (API keys page).
//   SIM administrator: GET  /api/admin/model-assist                          settings, model, usage, review count
//                      PUT  /api/admin/model-assist                          {enabled?, mode?, tasks?, monthly_budget_usd?}
//                      PUT  /api/admin/model-assist/merchants/:merchantId    {sim_key_allowed}
//                      GET  /api/admin/model-assist/review                   0.50-0.79 items of every owner
//                      POST /api/admin/model-assist/review/:evidenceId       {decision: CONFIRMED|REJECTED, note?}
//   Merchant (own work only; an administrator passes ?merchant_id=):
//                      GET/PUT /api/merchant/model-assist
//                      GET  /api/merchant/model-assist/review
//                      POST /api/merchant/model-assist/review/:evidenceId
// No key is ever returned: the model block carries provider, model name and readiness only.
import express from 'express';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
const actorOf=req=>req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace';
const isAdmin=req=>!req.workspaceUser||req.workspaceUser.role==='ADMIN';
const reviewView=row=>({evidence_id:row.id,task:row.task,mode:row.mode,subject_type:row.subject_type,company_id:row.company_id||null,company_name:row.company_name||null,
  subject_ref:row.subject_ref||null,item:row.item,quote:row.quote,confidence:row.confidence===null?null:Number(row.confidence),model:row.model,created_at:row.created_at});

export function createModelAssistRouter({assist}={}){
  if(!assist)throw new Error('createModelAssistRouter requires the model assist service');
  const router=express.Router();
  const adminOnly=(req,_res,next)=>next(isAdmin(req)?undefined:fail('ADMIN_REQUIRED','This function is available to the SIM administrator only',403));
  const merchantOf=req=>{
    if(req.workspaceUser?.role==='MERCHANT')return req.workspaceUser.merchant_id;
    const id=String(req.query.merchant_id||'');
    if(!UUID.test(id))throw fail('MERCHANT_REQUIRED','merchant_id is required for an administrator',400);
    return id;
  };
  const decide=async(req,merchantId,all)=>{
    if(!UUID.test(req.params.evidenceId))throw fail('LLM_EVIDENCE_NOT_FOUND','Item not found',404);
    const row=await assist.store.getEvidence(req.params.evidenceId);
    // A merchant only sees and decides its own items (404, not 403, for anything else).
    if(!row||(!all&&(row.merchant_id||null)!==(merchantId||null)))throw fail('LLM_EVIDENCE_NOT_FOUND','Item not found',404);
    if(row.status!=='REVIEW')throw fail('LLM_EVIDENCE_NOT_IN_REVIEW','This item does not need review',409);
    if(await assist.store.decisionFor(row.id))throw fail('LLM_EVIDENCE_ALREADY_DECIDED','This item was already reviewed',409);
    const decision=String(req.body?.decision||'').toUpperCase();
    if(!['CONFIRMED','REJECTED'].includes(decision))throw fail('LLM_DECISION_INVALID','decision must be CONFIRMED or REJECTED');
    const note=req.body?.note===undefined||req.body?.note===null?null:String(req.body.note).slice(0,1000);
    const saved=await assist.store.insertDecision({evidenceId:row.id,decision,note,actor:String(actorOf(req)).slice(0,320)});
    return{evidence_id:row.id,decision:saved.decision,decided_at:saved.decided_at};
  };

  // ---- SIM administrator ----
  router.get('/api/admin/model-assist',adminOnly,asyncRoute(async(_req,res)=>res.json(await assist.overview({admin:true}))));
  router.put('/api/admin/model-assist',adminOnly,asyncRoute(async(req,res)=>{
    await assist.settings.setSim(req.body||{},actorOf(req));
    res.json(await assist.overview({admin:true}));
  }));
  router.put('/api/admin/model-assist/merchants/:merchantId',adminOnly,asyncRoute(async(req,res)=>{
    if(!UUID.test(req.params.merchantId))throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
    res.json(await assist.settings.setSimKeyAllowed(req.params.merchantId,req.body?.sim_key_allowed,actorOf(req)));
  }));
  router.get('/api/admin/model-assist/review',adminOnly,asyncRoute(async(req,res)=>
    res.json({items:(await assist.store.reviewQueue({all:true,limit:req.query.limit})).map(reviewView)})));
  router.post('/api/admin/model-assist/review/:evidenceId',adminOnly,asyncRoute(async(req,res)=>res.json(await decide(req,null,true))));

  // ---- merchant's own work ----
  router.get('/api/merchant/model-assist',asyncRoute(async(req,res)=>res.json(await assist.overview({merchantId:merchantOf(req)}))));
  router.put('/api/merchant/model-assist',asyncRoute(async(req,res)=>{
    const merchantId=merchantOf(req);
    await assist.settings.setMerchant(merchantId,req.body||{},actorOf(req),{hasOwnKey:await assist.merchantHasOwnKey(merchantId)});
    res.json(await assist.overview({merchantId}));
  }));
  router.get('/api/merchant/model-assist/review',asyncRoute(async(req,res)=>
    res.json({items:(await assist.store.reviewQueue({merchantId:merchantOf(req),limit:req.query.limit})).map(reviewView)})));
  router.post('/api/merchant/model-assist/review/:evidenceId',asyncRoute(async(req,res)=>res.json(await decide(req,merchantOf(req),false))));

  router.use((error,_req,res,next)=>{
    const status=Number(error?.status);
    if(!error?.code||!(status>=400&&status<600)||status===500)return next(error);
    res.status(status).json({error:error.message,code:error.code});
  });
  return router;
}
