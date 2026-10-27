// Follow-up email settings (batch 2 D2, migration 072): whether follow-up emails 2 and 3 are drafted for
// approval, and SIM's daily cold-outreach limit (first touch + follow-ups from SIM's own mailbox).
// Stored as automation control CRM_FOLLOWUP_DRAFTS; every change is an append-only
// automation_control_events row. Until the setting is saved once in the workspace (settings.source
// 'ENVIRONMENT_DEFAULT', or before migration 072), CRM_FOLLOWUP_DRAFTS_ENABLED / CRM_FOLLOWUP_DAILY_LIMIT
// from the environment apply. Merchants use their own daily email quota instead.
import {randomUUID} from 'node:crypto';
import express from 'express';

export const FOLLOWUP_CONTROL_KEY='CRM_FOLLOWUP_DRAFTS';
export const FOLLOWUP_DAILY_LIMIT_MAX=1000;
const bool=(value,fallback=false)=>value===undefined||value===null||value===''?fallback:['1','true','yes','on'].includes(String(value).toLowerCase());
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export const clampLimit=value=>{const n=Number.parseInt(value,10);return Number.isInteger(n)&&n>=1?Math.min(n,FOLLOWUP_DAILY_LIMIT_MAX):50;};

export function followupEnvDefaults(env=process.env){
  return{enabled:bool(env.CRM_FOLLOWUP_DRAFTS_ENABLED,false),daily_limit:clampLimit(env.CRM_FOLLOWUP_DAILY_LIMIT||50)};
}

export class FollowupSettingsService{
  // controls: AutomationControlService (get/set). Without controls (tests, old databases) the environment applies.
  constructor({controls=null,env=process.env}={}){Object.assign(this,{controls,env});}

  async get(){
    const defaults=followupEnvDefaults(this.env);
    let row=null;
    if(this.controls){
      try{row=await this.controls.get(FOLLOWUP_CONTROL_KEY);}
      catch(error){if(error?.code!=='AUTOMATION_CONTROL_NOT_FOUND'&&!/automation_controls/.test(String(error?.message||'')))throw error;}
    }
    if(!row)return{...defaults,source:'ENVIRONMENT_DEFAULT',installed:false,revision:null,updated_by:null,updated_at:null};
    if(row.settings?.source!=='WORKSPACE')return{...defaults,source:'ENVIRONMENT_DEFAULT',installed:true,revision:Number(row.revision),updated_by:null,updated_at:null};
    return{enabled:row.enabled===true,daily_limit:clampLimit(row.settings?.daily_limit),source:'WORKSPACE',installed:true,
      revision:Number(row.revision),updated_by:row.updated_by,updated_at:row.updated_at};
  }
  async enabled(){return (await this.get()).enabled;}
  async dailyLimit(){return (await this.get()).daily_limit;}

  async set({enabled,daily_limit,actor,reason=null}={}){
    if(!this.controls)throw fail('FOLLOWUP_SETTINGS_UNAVAILABLE','Follow-up settings are not available',503);
    if(typeof enabled!=='boolean')throw fail('FOLLOWUP_ENABLED_INVALID','enabled must be true or false');
    const limit=Number(daily_limit);
    if(!Number.isInteger(limit)||limit<1||limit>FOLLOWUP_DAILY_LIMIT_MAX)throw fail('FOLLOWUP_DAILY_LIMIT_INVALID',`daily_limit must be a whole number from 1 to ${FOLLOWUP_DAILY_LIMIT_MAX}`);
    const current=await this.get();
    if(!current.installed)throw fail('FOLLOWUP_SETTINGS_UNAVAILABLE','Follow-up settings are not available yet',503);
    await this.controls.set({controlKey:FOLLOWUP_CONTROL_KEY,enabled,settings:{source:'WORKSPACE',daily_limit:limit},
      actor:String(actor||'dpv-workspace').slice(0,200),reason:String(reason||'Follow-up settings changed in the workspace').slice(0,500),
      idempotencyKey:`followup-settings:${randomUUID()}`});
    return this.get();
  }
}

// GET/PUT /api/automation/followup-settings (SIM administrator; merchants are refused by the workspace gate).
export function createFollowupSettingsRouter({settings,managementAuth}){
  const router=express.Router();
  const guard=managementAuth?[managementAuth.authenticate,managementAuth.requireRoles('MANAGEMENT')]:[];
  router.get('/api/automation/followup-settings',...guard,async(_req,res,next)=>{try{res.json(await settings.get());}catch(error){next(error);}});
  router.put('/api/automation/followup-settings',...guard,async(req,res,next)=>{
    try{
      res.json(await settings.set({enabled:req.body?.enabled,daily_limit:req.body?.daily_limit,
        actor:req.workspaceUser?.email||req.managementUser?.identity||'dpv-workspace',reason:req.body?.reason||null}));
    }catch(error){
      const status=Number(error?.status);
      if(error?.code&&status>=400&&status<500)return res.status(status).json({error:error.message,code:error.code});
      next(error);
    }
  });
  return router;
}
