// API keys pages (B9).
//   SIM administrator: GET  /api/admin/provider-credentials
//                      PUT  /api/admin/provider-credentials/:provider          {values:{field:value}}
//                      POST /api/admin/provider-credentials/:provider/revoke   {field?}
//                      POST /api/admin/provider-credentials/:provider/test
//   Merchant (own keys; an administrator passes ?merchant_id=):
//                      GET  /api/merchant/provider-credentials
//                      PUT  /api/merchant/provider-credentials/:provider
//                      POST /api/merchant/provider-credentials/:provider/(revoke|test)
// Responses never contain a stored value: only configured / last4 / set_at.
import express from 'express';
import {fail} from './credentialResolver.js';
import {createProviderTester} from './providerTester.js';

const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
const actorOf=req=>req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace';
const isAdmin=req=>!req.workspaceUser||req.workspaceUser.role==='ADMIN';

export function createTestLimiter({max=10,windowMs=10*60_000,now=()=>Date.now()}={}){
  const hits=new Map();
  return key=>{
    const time=now();const list=(hits.get(key)||[]).filter(at=>time-at<windowMs);
    if(list.length>=max){hits.set(key,list);return false;}
    list.push(time);hits.set(key,list);return true;
  };
}

export function createCredentialsRouter({credentials,tester=createProviderTester(),spendPolicy=null,testLimiter=createTestLimiter()}={}){
  if(!credentials)throw new Error('createCredentialsRouter requires a credential store');
  const router=express.Router();
  const adminOnly=(req,_res,next)=>next(isAdmin(req)?undefined:fail('ADMIN_REQUIRED','This function is available to the SIM administrator only',403));
  const merchantOf=req=>{
    if(req.workspaceUser?.role==='MERCHANT')return req.workspaceUser.merchant_id;
    if(req.query.merchant_id)return String(req.query.merchant_id);
    throw fail('MERCHANT_REQUIRED','merchant_id is required for an administrator',400);
  };
  const body=req=>{
    const values=req.body?.values;
    if(!values||typeof values!=='object'||Array.isArray(values))throw fail('CREDENTIAL_VALUES_REQUIRED','values must be an object of field: value');
    return values;
  };
  const runTest=async(req,merchantId)=>{
    if(!testLimiter(`${merchantId||'SIM'}:${req.params.provider}`))throw fail('CREDENTIAL_TEST_RATE_LIMITED','Too many tests; try again in a few minutes',429);
    credentials.scopeCheck(req.params.provider,merchantId);
    const resolved=await credentials.resolveProvider({merchantId,provider:req.params.provider});
    // A merchant tests only its own key, never the key SIM provides.
    const usable=merchantId?{...resolved,configured:resolved.merchant_billed}:resolved;
    const result=await tester(req.params.provider,usable);
    const source=merchantId?(resolved.merchant_billed?'MERCHANT':'NONE'):resolved.source;
    await credentials.recordTest({merchantId,provider:req.params.provider,source,ok:result.ok,code:result.code,actor:actorOf(req)});
    return{provider:req.params.provider,ok:result.ok,code:result.code,source};
  };

  // ---- SIM administrator ----
  router.get('/api/admin/provider-credentials',adminOnly,asyncRoute(async(_req,res)=>{
    const view=await credentials.view({merchantId:null});
    let spend=null;try{spend=spendPolicy?await spendPolicy():null;}catch{spend=null;}
    res.json({...view,search_spend_mode:spend?.mode||spend?.provider_spend_mode||null});
  }));
  router.put('/api/admin/provider-credentials/:provider',adminOnly,asyncRoute(async(req,res)=>
    res.json(await credentials.set({merchantId:null,provider:req.params.provider,values:body(req),actor:actorOf(req)}))));
  router.post('/api/admin/provider-credentials/:provider/revoke',adminOnly,asyncRoute(async(req,res)=>
    res.json(await credentials.revoke({merchantId:null,provider:req.params.provider,field:req.body?.field||null,actor:actorOf(req)}))));
  router.post('/api/admin/provider-credentials/:provider/test',adminOnly,asyncRoute(async(req,res)=>res.json(await runTest(req,null))));

  // ---- merchant's own keys ----
  router.get('/api/merchant/provider-credentials',asyncRoute(async(req,res)=>res.json(await credentials.view({merchantId:merchantOf(req)}))));
  router.put('/api/merchant/provider-credentials/:provider',asyncRoute(async(req,res)=>
    res.json(await credentials.set({merchantId:merchantOf(req),provider:req.params.provider,values:body(req),actor:actorOf(req)}))));
  router.post('/api/merchant/provider-credentials/:provider/revoke',asyncRoute(async(req,res)=>
    res.json(await credentials.revoke({merchantId:merchantOf(req),provider:req.params.provider,field:req.body?.field||null,actor:actorOf(req)}))));
  router.post('/api/merchant/provider-credentials/:provider/test',asyncRoute(async(req,res)=>res.json(await runTest(req,merchantOf(req)))));

  router.use((error,_req,res,next)=>{
    const status=Number(error?.status);
    if(!error?.code||!(status>=400&&status<600)||status===500)return next(error);
    res.status(status).json({error:error.message,code:error.code});
  });
  return router;
}
