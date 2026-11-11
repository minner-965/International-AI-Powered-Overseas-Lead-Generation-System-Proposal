import express from 'express';
import {authRequired,requireAdmin} from './auth.js';
import {fail,merchantUuid} from './MerchantService.js';
import {createLoginAttempts} from './loginAttempts.js';
import {DELIVERABILITY_HOLD_REASONS} from '../outreach/senderHealth.js';

const TWO_FACTOR_PENDING_MS=5*60_000;
const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
const actorOf=req=>req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace';

// senderHealth (outreach/senderHealth.js) and checkDomain (outreach/sendingDomainCheck.js): batch 4
// mailbox health, warm-up pacing and SPF/DKIM/DMARC; simSenderEmail is SIM's own sending address.
// twoFactor (twoFactor.js, migration 078): authenticator-app codes; required for ADMIN, optional for merchants.
export function createMerchantRouter({merchants,env=process.env,senderHealth=null,checkDomain=null,simSenderEmail=()=>null,twoFactor=null}={}){
  const router=express.Router();
  // Durable sign-in failure limiter (migration 067): 8 failures / 15 min per address and per IP.
  const limiter=createLoginAttempts({pool:merchants.pool});
  const required=authRequired(env);

  // ---- auth ----
  const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
  const saveSession=req=>new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
  // The signed-in user as the pages see it, with the two-step sign-in state.
  const view=async user=>{
    const base=await merchants.userView(user);
    if(!twoFactor||!user?.id)return base;
    const state=await twoFactor.status(user);
    return{...base,two_factor:state,two_factor_setup_required:state.required&&!state.enabled};
  };
  router.post('/api/auth/login',asyncRoute(async(req,res)=>{
    const email=String(req.body?.email||'').trim().toLowerCase();
    if(await limiter.blocked(email,req.ip))return res.status(429).json({error:'Too many attempts; try again later',code:'AUTH_RATE_LIMITED'});
    let user;
    try{user=await merchants.authenticate({email,password:req.body?.password});}
    catch(error){if(error.code==='AUTH_INVALID_CREDENTIALS')await limiter.fail(email,req.ip);throw error;}
    // Two-step sign-in on: the password alone signs nobody in. The session only remembers who
    // passed it, for five minutes; failed codes keep counting against the same limiter.
    if(twoFactor&&user.totp_enabled_at){
      await regenerate(req);
      req.session.pendingTwoFactor={userId:user.id,email,at:Date.now()};
      await saveSession(req);
      return res.json({two_factor_required:true});
    }
    await limiter.reset(email);
    await regenerate(req);
    req.session.userId=user.id;
    await saveSession(req);
    res.json({user:await view(user)});
  }));
  router.post('/api/auth/2fa/verify',asyncRoute(async(req,res)=>{
    const pending=req.session?.pendingTwoFactor;
    if(!twoFactor||!pending||Date.now()-Number(pending.at)>TWO_FACTOR_PENDING_MS)
      return res.status(401).json({error:'Sign in again',code:'TWO_FACTOR_SESSION_EXPIRED'});
    if(await limiter.blocked(pending.email,req.ip))return res.status(429).json({error:'Too many attempts; try again later',code:'AUTH_RATE_LIMITED'});
    const user=await merchants.findUserById(pending.userId);
    if(!user||user.disabled_at)return res.status(401).json({error:'Sign in again',code:'TWO_FACTOR_SESSION_EXPIRED'});
    let result;
    try{result=await twoFactor.verifySignIn(user,{code:req.body?.code,recovery_code:req.body?.recovery_code});}
    catch(error){if(error.code==='TWO_FACTOR_CODE_INVALID')await limiter.fail(pending.email,req.ip);throw error;}
    await limiter.reset(pending.email);
    await regenerate(req);
    req.session.userId=user.id;
    await saveSession(req);
    res.json({user:await view(user),method:result.method,...(result.recovery_codes_left!==undefined?{recovery_codes_left:result.recovery_codes_left}:{})});
  }));
  const signedIn=req=>{
    if(!req.workspaceUser)throw fail('AUTH_REQUIRED','Sign in required',401);
    if(!twoFactor)throw fail('TWO_FACTOR_UNAVAILABLE','Two-step sign-in is not available',503);
    return req.workspaceUser;
  };
  const fresh=user=>merchants.findUserById(user.id);
  router.post('/api/auth/2fa/setup',asyncRoute(async(req,res)=>res.json(await twoFactor.beginSetup(await fresh(signedIn(req))))));
  router.post('/api/auth/2fa/enable',asyncRoute(async(req,res)=>{
    const user=await fresh(signedIn(req));
    const result=await twoFactor.enable(user,req.body?.code,user.email);
    res.json({...result,user:await view(await fresh(user))});
  }));
  router.post('/api/auth/2fa/recovery-codes',asyncRoute(async(req,res)=>{
    const user=await fresh(signedIn(req));
    res.json(await twoFactor.renewRecoveryCodes(user,req.body?.code,user.email));
  }));
  router.post('/api/auth/2fa/disable',asyncRoute(async(req,res)=>{
    const user=await fresh(signedIn(req));
    await twoFactor.disable(user,{password:req.body?.password,code:req.body?.code},user.email);
    res.json({user:await view(await fresh(user))});
  }));
  router.post('/api/auth/logout',asyncRoute(async(req,res)=>{
    if(req.session)await new Promise(resolve=>req.session.destroy(()=>resolve()));
    res.clearCookie('sim.sid');res.json({ok:true});
  }));
  router.get('/api/auth/me',asyncRoute(async(req,res)=>{
    if(req.workspaceUser)return res.json({user:await view(req.workspaceUser),auth_required:required});
    if(!required)return res.json({user:{id:null,email:null,display_name:String(env.DPV_WORKSPACE_ACTOR||'dpv-workspace'),role:'ADMIN',
      must_change_password:false,merchant:null},auth_required:false});
    res.status(401).json({error:'Sign in required',code:'AUTH_REQUIRED'});
  }));
  router.post('/api/auth/password',asyncRoute(async(req,res)=>{
    if(!req.workspaceUser)return res.status(401).json({error:'Sign in required',code:'AUTH_REQUIRED'});
    const user=await merchants.changePassword(req.workspaceUser.id,req.body||{});
    res.json({user:await view(user)});
  }));

  // ---- admin (SIM) ----
  router.get('/api/admin/merchants',requireAdmin,asyncRoute(async(_req,res)=>res.json(await merchants.listMerchants())));
  router.post('/api/admin/merchants',requireAdmin,asyncRoute(async(req,res)=>res.status(201).json(await merchants.createMerchant(req.body||{},actorOf(req)))));
  router.patch('/api/admin/merchants/:id',requireAdmin,asyncRoute(async(req,res)=>res.json({merchant:await merchants.updateMerchant(req.params.id,req.body||{},actorOf(req))})));
  router.post('/api/admin/merchants/:id/reset-password',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.resetPassword(req.params.id))));
  router.post('/api/admin/merchants/:id/companies',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.assignCompanies(req.params.id,req.body?.company_ids,actorOf(req)))));
  // A merchant lost its phone and recovery codes: SIM switches two-step sign-in off for its accounts.
  router.post('/api/admin/merchants/:id/reset-2fa',requireAdmin,asyncRoute(async(req,res)=>{
    if(!twoFactor)throw fail('TWO_FACTOR_UNAVAILABLE','Two-step sign-in is not available',503);
    const users=(await merchants.pool.query(`SELECT id FROM leadgen.workspace_users WHERE merchant_id=$1 AND totp_enabled_at IS NOT NULL`,[merchantUuid(req.params.id)])).rows;
    for(const user of users)await twoFactor.clear(user.id,'RESET_BY_ADMIN',actorOf(req));
    res.json({reset:users.length});
  }));
  router.get('/api/admin/sender-health',requireAdmin,asyncRoute(async(_req,res)=>{
    if(!senderHealth)throw fail('SENDER_HEALTH_UNAVAILABLE','Sending health is not available',503);
    const email=simSenderEmail();
    const [sim,dns,rows]=await Promise.all([senderHealth.status(null),email&&checkDomain?checkDomain(email):null,
      merchants.pool.query(`SELECT m.id,m.company_name,b.from_email,b.sending_hold_reason,b.sending_hold_at FROM leadgen.merchants_current m
        JOIN leadgen.merchant_mailboxes b ON b.merchant_id=m.id ORDER BY m.created_at`)]);
    const items=[];
    for(const row of rows.rows)items.push({merchant_id:row.id,company_name:row.company_name,from_email:row.from_email,
      hold:row.sending_hold_at?{reason:row.sending_hold_reason,at:row.sending_hold_at}:null,health:await senderHealth.status(row.id)});
    res.json({sim:{...sim,sender_email:email||null,dns},merchants:items});
  }));
  router.post('/api/admin/merchants/:id/resume-sending',requireAdmin,asyncRoute(async(req,res)=>{
    if(!senderHealth)throw fail('SENDER_HEALTH_UNAVAILABLE','Sending health is not available',503);
    res.json(await resumeMerchant(merchantUuid(req.params.id),actorOf(req),req.body?.note));
  }));
  router.get('/api/admin/feedback',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.listFeedback({status:req.query.status}))));
  router.patch('/api/admin/feedback/:id',requireAdmin,asyncRoute(async(req,res)=>res.json(await merchants.updateFeedback(req.params.id,req.body||{},actorOf(req)))));

  // A person resumes a mailbox that sender health paused (bounces or a complaint); nothing else to resume.
  async function resumeMerchant(id,actor,note){
    const mailbox=await merchants.mailbox(id);
    if(!DELIVERABILITY_HOLD_REASONS.includes(mailbox.sending_hold?.reason))
      throw fail('SENDER_NOT_PAUSED','This mailbox is not paused for bounces or a complaint',409);
    return{health:await senderHealth.resume(id,{actor,note:note?String(note).slice(0,160):null})};
  }

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
  // Batch 4: sending health, warm-up pacing and the domain's SPF/DKIM/DMARC records.
  router.get('/api/merchant/mailbox/deliverability',asyncRoute(async(req,res)=>{
    if(!senderHealth)throw fail('SENDER_HEALTH_UNAVAILABLE','Sending health is not available',503);
    const id=merchantOf(req);const mailbox=await merchants.mailbox(id);
    const [health,dns]=await Promise.all([senderHealth.status(id),mailbox.configured&&checkDomain?checkDomain(mailbox.from_email):null]);
    res.json({health,dns,hold:mailbox.sending_hold||null});
  }));
  router.post('/api/merchant/mailbox/resume-sending',asyncRoute(async(req,res)=>{
    if(!senderHealth)throw fail('SENDER_HEALTH_UNAVAILABLE','Sending health is not available',503);
    res.json(await resumeMerchant(merchantOf(req),actorOf(req),req.body?.note));
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
