import {randomUUID} from 'node:crypto';
import {AUTOMATION_CONTROLS} from './AutomationControlService.js';
import {parseSpendModeInput,spendPolicyFromSettings} from '../search/ProviderSpendPolicy.js';
import {contactVerificationTtlDays} from '../verification/contactVerificationPolicy.js';

const SEARCH_KEY=AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION;
const EMAIL_KEY=AUTOMATION_CONTROLS.PHASE13_AUTO_FIRST_TOUCH;
const CONTACT_KEY=AUTOMATION_CONTROLS.CONTACT_RESEARCH_EXECUTION;
const DEFAULT_POLICY='MC07_DPV_FIRST_TOUCH_V1';
const DEFAULT_BANDS=Object.freeze(['PRECISION','RELEVANT','GENERAL_RELEVANT']);
const CONTACT_REVISION='MC07_CONTACT_RESEARCH_V1';

// Three independent subsystems, each its own append-only control row.
export const AUTOMATION_SUBSYSTEMS=Object.freeze({search:SEARCH_KEY,email:EMAIL_KEY,contact_research:CONTACT_KEY});
const SUBSYSTEM_LABELS=Object.freeze({search:'research search',email:'auto first-touch email',contact_research:'contact research'});

const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const withoutPause=settings=>{const {paused_reason:_ignored,...rest}=settings||{};return rest;};
// Before migration 068 the contact research row does not exist: read it as disabled.
const MISSING_CONTACT=Object.freeze({control_key:CONTACT_KEY,enabled:false,revision:0,settings:{},updated_at:null,missing:true});

export class Phase13AutomationFacade {
  constructor({pool,controls,providerState,providerOrder=['tavily'],providerOrderFromEnv=false,audit=()=>{}}={}){
    Object.assign(this,{pool,controls,providerState,providerOrder,providerOrderFromEnv,audit});
  }

  async registry(){
    const [markets,categories]=await Promise.all([
      this.pool.query("SELECT market_code FROM leadgen.research_market_registry WHERE status='ACTIVE' AND search_enabled=true ORDER BY market_code"),
      this.pool.query("SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' ORDER BY id")
    ]);
    return {allowed_markets:markets.rows.map(row=>row.market_code),allowed_category_ids:categories.rows.map(row=>row.id)};
  }

  async contactControl(){
    try{return await this.controls.get(CONTACT_KEY);}
    catch(error){if(error?.code==='AUTOMATION_CONTROL_NOT_FOUND')return MISSING_CONTACT;throw error;}
  }

  async getState(){
    const [search,email,contact,registry,policy]=await Promise.all([
      this.controls.get(SEARCH_KEY),this.controls.get(EMAIL_KEY),this.contactControl(),this.registry(),
      this.pool.query('SELECT * FROM leadgen.phase13_first_touch_controls WHERE policy_revision=$1',[DEFAULT_POLICY])
    ]);
    const settings=email.settings||{};
    const spend=spendPolicyFromSettings(search.settings);
    const searchOn=search.enabled===true,emailOn=email.enabled===true&&policy.rows[0]?.enabled===true,contactOn=contact.enabled===true;
    // SIM's own sender is paused only after a provider-path failure (pauseEmail records the reason);
    // turning auto first-touch off by hand does not stop human-approved follow-ups.
    const senderPausedReason=email.enabled!==true&&settings.paused_reason?String(settings.paused_reason):null;
    return {
      automated_acquisition:searchOn||emailOn||contactOn,
      search_automation:searchOn,
      opportunity_auto_pool:true,
      contact_research_automation:contactOn,
      auto_first_touch_email:emailOn,
      inbound_reply_monitor:true,
      auto_email_followup_sequence:false,
      phone_whatsapp_automation:false,
      provider_spend_mode:spend.provider_spend_mode,
      paid_fallback_on_empty:spend.paid_fallback_on_empty,
      provider_order:(await this.currentProviderOrder(search)).map(value=>String(value).toLowerCase()),
      sim_sender_paused:Boolean(senderPausedReason),
      sim_sender_paused_reason:senderPausedReason,
      mode:settings.mode||'AUTO_FIRST_TOUCH',
      policy_revision:settings.policy_revision||DEFAULT_POLICY,
      template_set_key:'DPV_FIRST_TOUCH_V1',template_set_status:'APPROVED',sender_display_name:'Simon',
      allowed_bands:settings.allowed_bands||DEFAULT_BANDS,
      verification_ttl_days:Number(settings.verification_ttl_days)||contactVerificationTtlDays(),
      ...registry,
      subsystems:{
        search:{enabled:searchOn,control_key:SEARCH_KEY,revision:Number(search.revision),updated_at:search.updated_at||null},
        email:{enabled:emailOn,control_key:EMAIL_KEY,revision:Number(email.revision),updated_at:email.updated_at||null},
        contact_research:{enabled:contactOn,control_key:CONTACT_KEY,revision:Number(contact.revision),updated_at:contact.updated_at||null,
          ...(contact.missing?{control_missing:true}:{})}
      },
      revisions:{search:Number(search.revision),email:Number(email.revision),contact_research:Number(contact.revision)},
      updated_at:[search.updated_at,email.updated_at,contact.updated_at].filter(Boolean).map(value=>new Date(value).toISOString()).sort().at(-1)||null
    };
  }

  async isSearchEnabled(){return this.controls.isEnabled(SEARCH_KEY);}
  async isContactResearchEnabled(){return (await this.contactControl()).enabled===true;}
  // The spend policy lives on the research search control (FREE_ONLY when unset).
  async spendPolicy(){return spendPolicyFromSettings((await this.controls.get(SEARCH_KEY)).settings);}
  // With SEARCH_PROVIDER_ORDER configured the environment is authoritative; the stored
  // control settings only mirrored the earlier hard-coded default.
  async currentProviderOrder(control=null){
    if(this.providerOrderFromEnv)return this.providerOrder;
    return (control||await this.controls.get(SEARCH_KEY)).settings?.provider_order||this.providerOrder;
  }

  searchSettings(current,{providerSpendMode,paidFallbackOnEmpty}={}){
    const base=withoutPause(current?.settings);
    const spend=spendPolicyFromSettings(base);
    return {...base,provider_order:this.providerOrder,
      provider_spend_mode:providerSpendMode===undefined?spend.provider_spend_mode:parseSpendModeInput(providerSpendMode),
      paid_fallback_on_empty:paidFallbackOnEmpty===undefined?spend.paid_fallback_on_empty:paidFallbackOnEmpty};
  }
  emailSettings(){
    return {mode:'AUTO_FIRST_TOUCH',policy_revision:DEFAULT_POLICY,template_set_key:'DPV_FIRST_TOUCH_V1',
      allowed_bands:DEFAULT_BANDS,verification_ttl_days:contactVerificationTtlDays(),auto_followup:false};
  }
  contactSettings(){return {automation_revision:CONTACT_REVISION};}

  // All-on / all-off. Off pauses all three subsystems. On starts research search and auto
  // first-touch; contact research (paid search + Hunter) only starts when asked explicitly
  // (contactResearch:true) and otherwise keeps its current state.
  async setMaster({enabled,contactResearch=undefined,actor='dpv-management',reason='Management automation control',idempotencyKey=randomUUID()}={}){
    if(typeof enabled!=='boolean')throw fail('AUTOMATION_ENABLED_REQUIRED');
    if(contactResearch!==undefined&&typeof contactResearch!=='boolean')throw fail('AUTOMATION_CONTACT_RESEARCH_INVALID');
    const currentSearch=await this.controls.get(SEARCH_KEY);
    const search=await this.controls.set({controlKey:SEARCH_KEY,enabled,settings:this.searchSettings(currentSearch),actor,reason,idempotencyKey:`${idempotencyKey}:search`});
    const email=await this.controls.set({controlKey:EMAIL_KEY,enabled,settings:this.emailSettings(),actor,reason,idempotencyKey:`${idempotencyKey}:email`});
    await this.pool.query('UPDATE leadgen.phase13_first_touch_controls SET enabled=$2,updated_by=$3,updated_at=now() WHERE policy_revision=$1',[DEFAULT_POLICY,enabled,actor]);
    const contactEnabled=enabled?contactResearch===true?true:null:false;
    let contact=null;
    if(contactEnabled!==null&&!(await this.contactControl()).missing)
      contact=await this.controls.set({controlKey:CONTACT_KEY,enabled:contactEnabled,settings:this.contactSettings(),actor,reason,idempotencyKey:`${idempotencyKey}:contact_research`});
    this.audit('PHASE13_AUTOMATION_MASTER_CHANGED',{enabled,contact_research:contactEnabled,actor});
    return {search,email,contact_research:contact,state:await this.getState()};
  }

  // One subsystem. `enabled` may be omitted for search when only the spend settings change.
  async setSubsystem({subsystem,enabled,providerSpendMode,paidFallbackOnEmpty,actor='dpv-management',reason=null,idempotencyKey=randomUUID()}={}){
    const name=String(subsystem??'').trim().toLowerCase();
    const controlKey=AUTOMATION_SUBSYSTEMS[name];
    if(!controlKey)throw fail('AUTOMATION_SUBSYSTEM_INVALID',404);
    if(enabled!==undefined&&typeof enabled!=='boolean')throw fail('AUTOMATION_ENABLED_REQUIRED');
    if(name!=='search'&&(providerSpendMode!==undefined||paidFallbackOnEmpty!==undefined))throw fail('AUTOMATION_SETTING_NOT_SUPPORTED');
    if(paidFallbackOnEmpty!==undefined&&typeof paidFallbackOnEmpty!=='boolean')throw fail('PAID_FALLBACK_ON_EMPTY_INVALID');
    if(providerSpendMode!==undefined)parseSpendModeInput(providerSpendMode);
    if(enabled===undefined&&(name!=='search'||(providerSpendMode===undefined&&paidFallbackOnEmpty===undefined)))throw fail('AUTOMATION_ENABLED_REQUIRED');
    const current=name==='contact_research'?await this.contactControl():await this.controls.get(controlKey);
    if(current.missing)throw fail('AUTOMATION_CONTROL_NOT_FOUND',404);
    const nextEnabled=enabled===undefined?current.enabled===true:enabled;
    const settings=name==='search'?this.searchSettings(current,{providerSpendMode,paidFallbackOnEmpty})
      :name==='email'?this.emailSettings():this.contactSettings();
    const changeReason=String(reason||'').trim()||`Management ${nextEnabled?'enabled':'paused'} ${SUBSYSTEM_LABELS[name]}`;
    const event=await this.controls.set({controlKey,enabled:nextEnabled,settings,actor,reason:changeReason,idempotencyKey:`${idempotencyKey}:${name}`});
    if(name==='email')await this.pool.query('UPDATE leadgen.phase13_first_touch_controls SET enabled=$2,updated_by=$3,updated_at=now() WHERE policy_revision=$1',[DEFAULT_POLICY,nextEnabled,actor]);
    this.audit('PHASE13_AUTOMATION_SUBSYSTEM_CHANGED',{subsystem:name,enabled:nextEnabled,actor,
      ...(name==='search'?{provider_spend_mode:settings.provider_spend_mode,paid_fallback_on_empty:settings.paid_fallback_on_empty}:{})});
    return {subsystem:name,event,state:await this.getState()};
  }

  // Provider-path failure on SIM's own sender: auto first-touch stops and the reason is kept, so
  // approved follow-ups also wait until a person re-enables (or explicitly re-sets) email.
  async pauseEmail(reason='EMAIL_SUBSYSTEM_ERROR'){
    const current=await this.controls.get(EMAIL_KEY);
    if(!current.enabled&&current.settings?.paused_reason)return current;
    const event=await this.controls.set({controlKey:EMAIL_KEY,enabled:false,settings:{...(current.settings||{}),paused_reason:String(reason).slice(0,160)},
      actor:'phase13-auto-first-touch',reason:'Email subsystem paused after provider-path error',idempotencyKey:`phase13:email-pause:${current.revision}:${String(reason).slice(0,80)}`});
    await this.pool.query('UPDATE leadgen.phase13_first_touch_controls SET enabled=false,updated_by=$2,updated_at=now() WHERE policy_revision=$1',[DEFAULT_POLICY,'phase13-auto-first-touch']);
    return event;
  }

  async status(){
    const state=await this.getState();
    let provider={status:'UNAVAILABLE'};
    try{provider=await this.providerState();}catch(error){provider={status:'UNAVAILABLE',code:error?.code||'PROVIDER_STATE_ERROR'};}
    provider={provider_code:provider.provider_code||String(this.providerOrder?.[0]||'SEARCH').toUpperCase(),status:provider.status||'UNAVAILABLE',
      remaining_credits:provider.remaining_credits??null,checked_at:provider.checked_at||null,
      retry_after_at:provider.retry_after_at||null,last_provider_error_code:provider.last_provider_error_code||provider.code||null};
    const [search,email]=await Promise.all([
      this.pool.query(`SELECT planned,completed,greatest(planned-completed,0)::int pending,in_progress,last_successful_search FROM
        (SELECT
          coalesce((SELECT sum(jsonb_array_length(plan->'queries'))::int FROM leadgen.research_query_plans WHERE research_job_id IS NOT NULL),0) planned,
          (SELECT count(*)::int FROM leadgen.research_query_executions WHERE status IN('PERSISTED','NOT_FOUND')) completed,
          (SELECT count(*)::int FROM leadgen.research_query_executions WHERE status IN('PENDING','CLAIMED','PROVIDER_COMPLETED','RATE_LIMITED','TEMPORARY_ERROR')) in_progress,
          (SELECT max(completed_at) FROM leadgen.research_query_executions WHERE status IN('PERSISTED','NOT_FOUND')) last_successful_search) totals`),
      this.pool.query(`SELECT count(*) FILTER(WHERE status='RESERVED')::int queued,count(*) FILTER(WHERE status='PROVIDER_ACCEPTED')::int sent,
        count(*) FILTER(WHERE status='AMBIGUOUS')::int ambiguous FROM leadgen.phase13_first_touch_reservations`)
    ]);
    return {state,provider,subsystems:{
      search:{status:state.search_automation?(String(provider.status)==='AVAILABLE'?'HEALTHY':'PAUSED'):'PAUSED',reason:state.search_automation?provider.status:'PAUSED_AUTOMATION_OFF',
        provider_spend_mode:state.provider_spend_mode,...search.rows[0]},
      opportunity_pool:{status:'HEALTHY'},
      contact_research:{status:state.contact_research_automation?'HEALTHY':'PAUSED',...(state.contact_research_automation?{}:{reason:'PAUSED_AUTOMATION_OFF'})},
      email:{status:state.auto_first_touch_email?'HEALTHY':'PAUSED',...(state.sim_sender_paused?{reason:state.sim_sender_paused_reason}:{}),...email.rows[0]},
      reply_monitor:{status:'HEALTHY'},followup:{status:'OFF'},phone_whatsapp:{status:'OFF'}
    }};
  }
}
