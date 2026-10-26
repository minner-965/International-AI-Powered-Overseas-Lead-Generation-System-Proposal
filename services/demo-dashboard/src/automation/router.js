import express from 'express';
import {randomUUID} from 'node:crypto';
import {AUTOMATION_SUBSYSTEMS} from './Phase13AutomationFacade.js';

const reasonOf=value=>{const text=String(value??'').replace(/[\u0000-\u001f]/g,' ').trim();return text?text.slice(0,500):null;};
const idempotencyOf=req=>{const key=String(req.get('idempotency-key')||'').trim();return key?key.slice(0,150):randomUUID();};
const ALLOWED_FIELDS=Object.freeze({
  search:new Set(['enabled','provider_spend_mode','paid_fallback_on_empty','reason']),
  email:new Set(['enabled','reason']),
  contact_research:new Set(['enabled','reason'])
});

// Automation control API. Reads: MANAGEMENT, DATA_ADMIN, SALES. Writes: MANAGEMENT, DATA_ADMIN.
// Every write goes through AutomationControlService.set: append-only control events with actor,
// reason and an idempotency key (Idempotency-Key header, or a generated one).
// reconcile: {search, contactResearch, email} — the worker passes run their own gates.
export function createAutomationRouter({automation,managementAuth,reconcile={}}={}){
  if(!automation)throw new Error('createAutomationRouter requires the automation facade');
  if(!managementAuth)throw new Error('createAutomationRouter requires management authentication');
  const router=express.Router();
  const read=[managementAuth.authenticate,managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES')];
  const write=[managementAuth.authenticate,managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN')];
  const run=async(name,args)=>reconcile[name]?reconcile[name](args):null;

  router.get('/api/automation/control',...read,async(_req,res,next)=>{
    try{res.json(await automation.getState());}catch(error){next(error);}
  });
  router.get('/api/automation/status',...read,async(_req,res,next)=>{
    try{res.json(await automation.status());}catch(error){next(error);}
  });

  // All-on / all-off. Off pauses search, auto first-touch and contact research. On starts search
  // and auto first-touch; contact research only when the body also says contact_research:true.
  router.put('/api/automation/control',...write,async(req,res,next)=>{
    try{
      const body=req.body||{};
      if(typeof body.enabled!=='boolean')return res.status(400).json({code:'AUTOMATION_ENABLED_REQUIRED'});
      if(body.contact_research!==undefined&&typeof body.contact_research!=='boolean')return res.status(400).json({code:'AUTOMATION_CONTACT_RESEARCH_INVALID'});
      const result=await automation.setMaster({enabled:body.enabled,contactResearch:body.contact_research,actor:req.managementUser.identity,
        reason:reasonOf(body.reason)||(body.enabled?'Management enabled automated acquisition':'Management paused automated acquisition'),
        idempotencyKey:idempotencyOf(req)});
      if(body.enabled){
        await run('search',{limit:25});
        if(result.state.contact_research_automation)await run('contactResearch',{limit:5});
        if(result.state.auto_first_touch_email)await run('email',{limit:1});
      }
      res.json(result.state);
    }catch(error){next(error);}
  });

  // One subsystem: search | email | contact_research. Body {enabled:boolean}; search also takes
  // provider_spend_mode (FREE_ONLY | ALLOW_PAID, NO_NEW_PAID_SPEND = FREE_ONLY) and
  // paid_fallback_on_empty (boolean), with or without enabled.
  router.put('/api/automation/control/:subsystem',...write,async(req,res,next)=>{
    try{
      const subsystem=String(req.params.subsystem||'').toLowerCase();
      if(!Object.hasOwn(AUTOMATION_SUBSYSTEMS,subsystem))return res.status(404).json({code:'AUTOMATION_SUBSYSTEM_INVALID'});
      const body=req.body;
      if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({code:'AUTOMATION_BODY_INVALID'});
      const unknown=Object.keys(body).filter(key=>!ALLOWED_FIELDS[subsystem].has(key));
      if(unknown.length)return res.status(400).json({code:'AUTOMATION_SETTING_NOT_SUPPORTED',fields:unknown});
      if(body.enabled!==undefined&&typeof body.enabled!=='boolean')return res.status(400).json({code:'AUTOMATION_ENABLED_REQUIRED'});
      const result=await automation.setSubsystem({subsystem,enabled:body.enabled,providerSpendMode:body.provider_spend_mode,
        paidFallbackOnEmpty:body.paid_fallback_on_empty,actor:req.managementUser.identity,reason:reasonOf(body.reason),
        idempotencyKey:idempotencyOf(req)});
      if(body.enabled===true){
        if(subsystem==='search')await run('search',{limit:25});
        if(subsystem==='contact_research'&&result.state.contact_research_automation)await run('contactResearch',{limit:5});
        if(subsystem==='email'&&result.state.auto_first_touch_email)await run('email',{limit:1});
      }
      res.json(result.state);
    }catch(error){next(error);}
  });

  router.post('/api/automation/reconcile',...write,async(req,res,next)=>{
    try{res.status(202).json({search:await run('search',{limit:25}),
      contact_research:await run('contactResearch',{limit:Math.max(1,Math.min(10,Number(req.body?.contact_limit)||5))}),
      email:await run('email',{limit:Math.max(1,Math.min(50,Number(req.body?.limit)||1))})});}catch(error){next(error);}
  });
  return router;
}
