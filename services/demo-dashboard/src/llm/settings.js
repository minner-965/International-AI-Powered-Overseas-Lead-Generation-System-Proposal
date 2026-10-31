// Model assist switches (append-only rows in leadgen.llm_assist_settings, latest wins).
//  - SIM master switch "辅助模型 Model assist": OFF by default; governs SIM's own work.
//  - Per-task toggles T1-T5 and mode SHADOW (record only, default) / ASSIST (accepted evidence may be
//    read by rules, only to add evidence or to downgrade; never to bypass verification or eligibility).
//  - A merchant has its own switch for its own work. It can be turned on only with the merchant's own
//    model key, or when the administrator allows SIM's key for that merchant (llm_merchant_allowances).
import {TASKS} from './standard.js';

export const MODES=Object.freeze(['SHADOW','ASSIST']);
export const DEFAULT_SIM_BUDGET_USD=20;
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const offTasks=()=>Object.fromEntries(TASKS.map(task=>[task,false]));

export function normalizeSettings(row,{merchant=false}={}){
  const tasks=offTasks();
  for(const task of TASKS)if(row?.tasks&&row.tasks[task]===true)tasks[task]=true;
  // No row yet: SIM gets the default monthly cap; a merchant pays its own provider and has no cap.
  const budget=!row?(merchant?null:DEFAULT_SIM_BUDGET_USD):row.monthly_budget_usd===null||row.monthly_budget_usd===undefined?null:Number(row.monthly_budget_usd);
  return{enabled:row?.enabled===true,mode:MODES.includes(row?.mode)?row.mode:'SHADOW',tasks,monthly_budget_usd:budget,
    set_by:row?.set_by||null,set_at:row?.set_at||null};
}

/** Validate a settings change; unknown keys are refused, missing keys keep their current value. */
export function mergeSettings(current,patch={}){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw fail('LLM_SETTINGS_INVALID','Settings must be an object');
  const allowed=new Set(['enabled','mode','tasks','monthly_budget_usd','change_reason']);
  for(const key of Object.keys(patch))if(!allowed.has(key))throw fail('LLM_SETTINGS_INVALID',`Unknown setting ${key}`);
  const next={...current,tasks:{...current.tasks}};
  if('enabled' in patch){if(typeof patch.enabled!=='boolean')throw fail('LLM_SETTINGS_INVALID','enabled must be true or false');next.enabled=patch.enabled;}
  if('mode' in patch){if(!MODES.includes(patch.mode))throw fail('LLM_SETTINGS_INVALID','mode must be SHADOW or ASSIST');next.mode=patch.mode;}
  if('tasks' in patch){
    if(!patch.tasks||typeof patch.tasks!=='object'||Array.isArray(patch.tasks))throw fail('LLM_SETTINGS_INVALID','tasks must be an object');
    for(const [task,value] of Object.entries(patch.tasks)){
      if(!TASKS.includes(task))throw fail('LLM_SETTINGS_INVALID',`Unknown task ${task}`);
      if(typeof value!=='boolean')throw fail('LLM_SETTINGS_INVALID',`${task} must be true or false`);
      next.tasks[task]=value;
    }
  }
  if('monthly_budget_usd' in patch){
    const value=patch.monthly_budget_usd;
    if(value===null)next.monthly_budget_usd=null;
    else{const number=Number(value);if(!Number.isFinite(number)||number<0||number>100000)throw fail('LLM_SETTINGS_INVALID','monthly_budget_usd must be between 0 and 100000');next.monthly_budget_usd=Math.round(number*100)/100;}
  }
  return next;
}

export class ModelAssistSettings{
  constructor({store}){this.store=store;}
  async sim(){return normalizeSettings(await this.store.latestSettings(null));}
  async merchant(merchantId){return normalizeSettings(await this.store.latestSettings(merchantId),{merchant:true});}
  async simKeyAllowed(merchantId){return (await this.store.latestAllowance(merchantId))?.sim_key_allowed===true;}

  async setSim(patch,actor){
    const next=mergeSettings(await this.sim(),patch);
    await this.store.insertSettings(null,{...next,set_by:clip(actor),change_reason:patch.change_reason});
    return this.sim();
  }
  /** hasOwnKey: whether the merchant stored a complete model key of its own. */
  async setMerchant(merchantId,patch,actor,{hasOwnKey}){
    if(!await this.store.merchantExists(merchantId))throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
    const next=mergeSettings(await this.merchant(merchantId),patch);
    if(next.enabled&&!hasOwnKey&&!await this.simKeyAllowed(merchantId))
      throw fail('LLM_MERCHANT_KEY_REQUIRED','Add your own model key first (API keys page), or ask SIM to allow its key for your account',409);
    await this.store.insertSettings(merchantId,{...next,set_by:clip(actor),change_reason:patch.change_reason});
    return this.merchant(merchantId);
  }
  async setSimKeyAllowed(merchantId,allowed,actor){
    if(typeof allowed!=='boolean')throw fail('LLM_SETTINGS_INVALID','allowed must be true or false');
    if(!await this.store.merchantExists(merchantId))throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
    await this.store.insertAllowance(merchantId,allowed,clip(actor));
    return{merchant_id:merchantId,sim_key_allowed:allowed};
  }

  /** {on, mode, code, settings, sim_key_allowed} for one task of one owner. Fail-closed. */
  async effective({merchantId=null,task}){
    if(!TASKS.includes(task))return{on:false,code:'REFUSED_OUT_OF_SCOPE'};
    const settings=merchantId?await this.merchant(merchantId):await this.sim();
    if(!settings.enabled)return{on:false,code:'MODEL_ASSIST_OFF',settings};
    if(!settings.tasks[task])return{on:false,code:'MODEL_ASSIST_TASK_OFF',settings};
    return{on:true,code:null,mode:settings.mode,settings,sim_key_allowed:merchantId?await this.simKeyAllowed(merchantId):false};
  }
}
const clip=value=>String(value||'unknown').slice(0,320);
