import express from 'express';
import {authRequired,requireAdmin} from './auth.js';
import {fail,merchantUuid} from './MerchantService.js';
import {createLoginAttempts} from './loginAttempts.js';

const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
const actorOf=req=>req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace';

export function createMerchantRouter({merchants,env=process.env}={}){
  const router=express.Router();
  // Durable sign-in failure limiter (migration 067): 8 failures / 15 min per address and per IP.
  const limiter=createLoginAttempts({pool:merchants.pool});
  const required=authRequired(env);

  // ---- auth ----
  router.post('/api/auth/login',asyncRoute(async(req,res)=>{
    const email=String(req.body?.email||'').trim().toLowerCase();
    if(await limiter.blocked(email,req.ip))return res.status(429).json({error:'Too many attempts; try again later',code:'AUTH_RATE_LIMITED'});
    let user;
    try{user=await merchants.authenticate({email,password:req.body?.password});}
    catch(error){if(error.code==='AUTH_INVALID_CREDENTIALS')await limiter.fail(email,req.ip);throw error;}
    await limiter.reset(email);
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
    req.session.userId=user.id;
    await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
    res.json({user:await merchants.userView(user)});
  }));
  router.post('/api/auth/logout',asyncRoute(async(req,res)=>{
    if(req.session)await new Promise(resolve=>req.session.destroy(()=>resolve()));
    res.clearCookie('sim.sid');res.json({ok:true});
  }));
  router.get('/api/auth/me',asyncRoute(async(req,res)=>{
    if(req.workspaceUser)return res.json({user:await merchants.userView(req.workspaceUser),auth_required:required});
    if(!required)return res.json({user:{id:null,email:null,display_name:String(env.DPV_WORKSPACE_ACTOR||'dpv-workspace'),role:'ADMIN',
      must_change_password:false,merchant:null},auth_required:false});
    res.status(401).json({error:'Sign in required',code:'AUTH_REQUIRED'});
  }));
  router.post('/api/auth/password',asyncRoute(async(req,res)=>{
    if(!req.workspaceUser)return res.status(401).json({error:'Sign in required',code:'AUTH_REQUIRED'});
    const user=await merchants.changePassword(req.workspaceUser.id,req.body||{});
    res.json({user:await merchants.userView(user)});
  }));

  // ---- admin (SIM) ----
  router.get('/api/admin/merchants',requireAdmin,asyncRoute(async(_req,res)=>res.json(await merchants.listMerchants())));
  router.post('/api/admin/merchants',requireAdmin,asyncRoute(async(req,res)=>res.status(201).json(await merchants.createMerchant(req.body||{},actorOf(req)))));
  router.patch('/api/admin/merchants/:id',requireAdmin,asyncRoute(async(req,res)=>res.json({merchant:await merchants.updateMerchant(req.params.id,req.body||{},actorOf(req))})));
  router.post('/api/admin/merchants/:id/reset-password',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.resetPassword(req.params.id))));
  router.post('/api/admin/merchants/:id/companies',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.assignCompanies(req.params.id,req.body?.company_ids,actorOf(req)))));
  router.get('/api/admin/feedback',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.listFeedback({status:req.query.status}))));
  router.patch('/api/admin/feedback/:id',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.updateFeedback(req.params.id,req.body||{},actorOf(req)))));

  // ---- merchant self-service (an admin passes ?merchant_id=) ----
  const merchantOf=req=>{
    if(req.workspaceUser?.role==='MERCHANT')return req.workspaceUser.merchant_id;
    if(req.query.merchant_id)return merchantUuid(req.query.merchant_id);
    throw fail('MERCHANT_REQUIRED','merchant_id is required for an administrator',400);
  };
  router.get('/api/merchant/onboarding',asyncRoute(async(req,res)=>res.json(await merchants.onboarding(merchantOf(req)))));
  router.get('/api/merchant/profile',asyncRoute(async(req,res)=>res.json(await merchants.profile(merchantOf(req)))));
  router.patch('/api/merchant/profile',asyncRoute(async(req,res)=>res.json(await merchants.updateProfile(merchantOf(req),req.body||{}))));
  router.get('/api/merchant/mailbox/presets',asyncRoute(async(_req,res)=>res.json(merchants.presets())));
  router.get('/api/merchant/mailbox',asyncRoute(async(req,res)=>res.json(await merchants.mailbox(merchantOf(req)))));
  router.put('/api/merchant/mailbox',asyncRoute(async(req,res)=>res.json(await merchants.saveMailbox(merchantOf(req),req.body||{},actorOf(req)))));
  router.post('/api/merchant/mailbox/test-connection',asyncRoute(async(req,res)=>res.json(await merchants.testConnection(merchantOf(req)))));
  // Automatic first touch is the merchant's own decision: SIM can see it but not switch it.
  router.put('/api/merchant/auto-first-touch',asyncRoute(async(req,res)=>{
    if(req.workspaceUser&&req.workspaceUser.role!=='MERCHANT')throw fail('MERCHANT_SELF_SERVICE_ONLY','Only the merchant can change this setting',403);
    res.json(await merchants.setAutoFirstTouch(merchantOf(req),req.body?.enabled,actorOf(req)));
  }));
  router.post('/api/merchant/mailbox/test-email',asyncRoute(async(req,res)=>res.json(await merchants.testEmail(merchantOf(req)))));
  router.get('/api/merchant/scope',asyncRoute(async(req,res)=>res.json(await merchants.scope(merchantOf(req)))));
  router.put('/api/merchant/scope',asyncRoute(async(req,res)=>res.json(await merchants.saveScope(merchantOf(req),req.body||{},actorOf(req)))));
  router.post('/api/feedback',asyncRoute(async(req,res)=>res.status(201).json(await merchants.createFeedback(req.body||{},req.workspaceUser))));

  router.use((error,_req,res,next)=>{
    if(!error?.code||!(Number(error.status)>=400&&Number(error.status)<500))return next(error);
    res.status(Number(error.status)).json({error:error.message,code:error.code,details:error.details});
  });
  return router;
}
