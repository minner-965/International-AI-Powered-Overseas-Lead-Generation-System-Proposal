import {randomUUID} from 'node:crypto';
import {AUTOMATION_CONTROLS} from './AutomationControlService.js';

const SEARCH_KEY=AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION;
const EMAIL_KEY=AUTOMATION_CONTROLS.PHASE13_AUTO_FIRST_TOUCH;
const DEFAULT_POLICY='MC07_DPV_FIRST_TOUCH_V1';
const DEFAULT_BANDS=Object.freeze(['PRECISION','RELEVANT','GENERAL_RELEVANT']);

export class Phase13AutomationFacade {
  constructor({pool,controls,providerState,providerOrder=['tavily'],audit=()=>{}}={}){
    Object.assign(this,{pool,controls,providerState,providerOrder,audit});
  }

  async registry(){
    const [markets,categories]=await Promise.all([
      this.pool.query("SELECT market_code FROM leadgen.research_market_registry WHERE status='ACTIVE' AND search_enabled=true ORDER BY market_code"),
      this.pool.query("SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' ORDER BY id")
    ]);
    return {allowed_markets:markets.rows.map(row=>row.market_code),allowed_category_ids:categories.rows.map(row=>row.id)};
  }

  async getState(){
    const [search,email,registry,policy]=await Promise.all([
      this.controls.get(SEARCH_KEY),this.controls.get(EMAIL_KEY),this.registry(),
      this.pool.query('SELECT * FROM leadgen.phase13_first_touch_controls WHERE policy_revision=$1',[DEFAULT_POLICY])
    ]);
    const settings=email.settings||{};
    return {
      automated_acquisition:search.enabled===true,
      search_automation:search.enabled===true,
      opportunity_auto_pool:true,
      contact_research_automation:true,
      auto_first_touch_email:email.enabled===true&&policy.rows[0]?.enabled===true,
      inbound_reply_monitor:true,
      auto_email_followup_sequence:false,
      phone_whatsapp_automation:false,
      provider_spend_mode:'NO_NEW_PAID_SPEND',
      provider_order:(search.settings?.provider_order||this.providerOrder).map(value=>String(value).toLowerCase()),
      mode:settings.mode||'AUTO_FIRST_TOUCH',
      policy_revision:settings.policy_revision||DEFAULT_POLICY,
      template_set_key:'DPV_FIRST_TOUCH_V1',template_set_status:'APPROVED',sender_display_name:'Simon',
      allowed_bands:settings.allowed_bands||DEFAULT_BANDS,
      verification_ttl_days:Number(settings.verification_ttl_days||30),
      ...registry,
      revisions:{search:Number(search.revision),email:Number(email.revision)},
      updated_at:[search.updated_at,email.updated_at].sort().at(-1)
    };
  }

  async isSearchEnabled(){return this.controls.isEnabled(SEARCH_KEY);}
  async currentProviderOrder(){return (await this.controls.get(SEARCH_KEY)).settings?.provider_order||this.providerOrder;}

  async setMaster({enabled,actor='dpv-management',reason='Management automation control',idempotencyKey=randomUUID()}={}){
    const searchSettings={provider_order:this.providerOrder,provider_spend_mode:'NO_NEW_PAID_SPEND'};
    const emailSettings={mode:'AUTO_FIRST_TOUCH',policy_revision:DEFAULT_POLICY,template_set_key:'DPV_FIRST_TOUCH_V1',
      allowed_bands:DEFAULT_BANDS,verification_ttl_days:30,auto_followup:false};
    const search=await this.controls.set({controlKey:SEARCH_KEY,enabled,settings:searchSettings,actor,reason,idempotencyKey:`${idempotencyKey}:search`});
    const email=await this.controls.set({controlKey:EMAIL_KEY,enabled,settings:emailSettings,actor,reason,idempotencyKey:`${idempotencyKey}:email`});
    await this.pool.query('UPDATE leadgen.phase13_first_touch_controls SET enabled=$2,updated_by=$3,updated_at=now() WHERE policy_revision=$1',[DEFAULT_POLICY,enabled,actor]);
    this.audit('PHASE13_AUTOMATION_MASTER_CHANGED',{enabled,actor});
    return {search,email,state:await this.getState()};
  }

  async pauseEmail(reason='EMAIL_SUBSYSTEM_ERROR'){
    const current=await this.controls.get(EMAIL_KEY);
    if(!current.enabled)return current;
    const event=await this.controls.set({controlKey:EMAIL_KEY,enabled:false,settings:{...(current.settings||{}),paused_reason:String(reason).slice(0,160)},
      actor:'phase13-auto-first-touch',reason:'Email subsystem paused after provider-path error',idempotencyKey:`phase13:email-pause:${current.revision}:${String(reason).slice(0,80)}`});
    await this.pool.query('UPDATE leadgen.phase13_first_touch_controls SET enabled=false,updated_by=$2,updated_at=now() WHERE policy_revision=$1',[DEFAULT_POLICY,'phase13-auto-first-touch']);
    return event;
  }

  async status(){
    const state=await this.getState();
    let provider={status:'UNAVAILABLE'};
    try{provider=await this.providerState();}catch(error){provider={status:'UNAVAILABLE',code:error?.code||'PROVIDER_STATE_ERROR'};}
    provider={provider_code:provider.provider_code||'TAVILY',status:provider.status||'UNAVAILABLE',
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
      search:{status:state.search_automation?(String(provider.status)==='AVAILABLE'?'HEALTHY':'PAUSED'):'PAUSED',reason:state.search_automation?provider.status:'PAUSED_AUTOMATION_OFF',...search.rows[0]},
      opportunity_pool:{status:'HEALTHY'},contact_research:{status:'HEALTHY'},
      email:{status:state.auto_first_touch_email?'HEALTHY':'PAUSED',...email.rows[0]},
      reply_monitor:{status:'HEALTHY'},followup:{status:'OFF'},phone_whatsapp:{status:'OFF'}
    }};
  }
}
