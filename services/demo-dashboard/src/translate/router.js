// POST /api/translate {text, source, target} -> {text, provider, detected_source}
// Signed-in SIM administrator and merchants (the merchant route list must allow it). Rate limited per
// user; text at most 5000 characters. The translation is a suggestion: nothing is saved or sent.
import express from 'express';
import {LANGUAGES,MAX_TEXT_CHARS} from './translateClient.js';

const actorOf=req=>req.workspaceUser?.id||req.workspaceUser?.email||req.managementUser?.identity||req.ip||'anonymous';

export function createRateLimiter({max=20,windowMs=60_000,now=()=>Date.now()}={}){
  const hits=new Map();
  return key=>{
    const time=now();const list=(hits.get(key)||[]).filter(at=>time-at<windowMs);
    const allowed=list.length<max;if(allowed)list.push(time);
    hits.set(key,list);
    if(hits.size>5000)for(const [k,v] of hits)if(!v.some(at=>time-at<windowMs))hits.delete(k);
    return allowed;
  };
}

export function createTranslateRouter({client,limiter=createRateLimiter(),authRequired=true}={}){
  if(!client)throw new Error('createTranslateRouter requires a translate client');
  const router=express.Router();
  router.get('/api/translate/languages',(_req,res)=>res.json({languages:LANGUAGES,max_chars:MAX_TEXT_CHARS}));
  router.post('/api/translate',async(req,res,next)=>{
    try{
      if(authRequired&&!req.workspaceUser)return res.status(401).json({error:'Sign in required',code:'AUTH_REQUIRED'});
      if(!limiter(String(actorOf(req))))return res.status(429).json({error:'Too many translations; wait a minute',code:'TRANSLATE_RATE_LIMITED'});
      const merchantId=req.workspaceUser?.role==='MERCHANT'?req.workspaceUser.merchant_id:null;
      const result=await client.translate({text:req.body?.text,source:req.body?.source,target:req.body?.target},{merchantId});
      res.json({text:result.text,provider:result.provider,detected_source:result.detected_source||null});
    }catch(error){
      const status=Number(error?.status);
      if(error?.code&&status>=400&&status<600&&status!==500)return res.status(status).json({error:error.message,code:error.code});
      next(error);
    }
  });
  return router;
}
