// Model assist service: runs one T1-T5 task end to end under llm-exec-standard-v1.
//   switches -> key resolution -> masked, delimited input -> reuse of an identical earlier result ->
//   monthly budget -> one model call (ledger row) -> schema / quote / enum / threshold checks ->
//   append-only evidence rows -> result for the caller.
// Nothing here decides a tier, a verification outcome or whether an email may be sent. In SHADOW mode
// the caller receives no usable evidence at all; in ASSIST mode only ACCEPTED items are offered, and
// callers may use them only to add evidence or to downgrade (see hooks.js).
import {SYSTEM_PROMPT,STANDARD_VERSION,promptVersion,extractionVersion,inputDigest} from './standard.js';
import {taskDefinition} from './tasks/index.js';
import {userMessage,parseModelJson,validateOutput} from './tasks/common.js';
import {createLlmClient,resolveModelConfig} from './llmClient.js';
import {costOf} from './pricing.js';
import {ModelAssistSettings} from './settings.js';
import {SqlLlmStore} from './store.js';

export class ModelAssistService{
  constructor({store,credentials,client=createLlmClient(),log=console}={}){
    if(!store)throw new Error('ModelAssistService requires a store');
    this.store=store;this.credentials=credentials;this.client=client;this.log=log;
    this.settings=new ModelAssistSettings({store});
  }

  /** Merchant has stored a complete model key of its own (merchant pays). */
  async merchantHasOwnKey(merchantId){
    if(!merchantId||!this.credentials)return false;
    return Boolean((await this.credentials.resolveProvider({merchantId,provider:'llm'}))?.merchant_billed);
  }

  async budgetLeft(config,merchantId){
    if(config.billed_to==='LOCAL')return true;
    const settings=config.billed_to==='MERCHANT'?await this.settings.merchant(merchantId):await this.settings.sim();
    const cap=settings.monthly_budget_usd;
    if(cap===null||cap===undefined)return true;
    const spent=await this.store.monthSpendUsd({billedTo:config.billed_to,merchantId:config.billed_to==='MERCHANT'?merchantId:null});
    return spent<Number(cap);
  }

  /**
   * Run one task. options: {merchantId}. Returns
   * {ran:false, code} when the switch, key, budget or input says no, else
   * {ran:true, task, mode, call_id, response_status, items:[...], accepted, review, usable, notes, cached}.
   */
  async run(task,args={},{merchantId=null}={}){
    const definition=taskDefinition(task);
    if(!definition)return{ran:false,code:'REFUSED_OUT_OF_SCOPE',response_status:'REFUSED_OUT_OF_SCOPE'};
    const switches=await this.settings.effective({merchantId,task});
    if(!switches.on)return{ran:false,code:switches.code};
    const config=await resolveModelConfig({credentials:this.credentials,merchantId,simKeyAllowed:switches.sim_key_allowed});
    if(!config.ok)return{ran:false,code:config.code};
    let request;
    try{request=definition.buildRequest(args);}
    catch(error){return{ran:false,code:error?.code||'LLM_INPUT_INVALID'};}
    const version=promptVersion(task);const digest=inputDigest(request.input);
    const meta={merchant_id:merchantId,task,standard_version:STANDARD_VERSION,prompt_version:version,input_digest:digest,
      request_id:request.input.request_id,provider:config.provider,model:config.model,billed_to:config.billed_to,credential_source:config.source};

    // Same input + same standard/prompt version + same model -> reuse (standard section 8).
    const previous=await this.store.findReusableCall({merchantId,inputDigest:digest,promptVersion:version,provider:config.provider,model:config.model});
    if(previous){
      const call=await this.store.insertCall({...meta,status:'CACHED',attempts:0,input_tokens:0,output_tokens:0,cost_amount:0,cost_currency:'USD',latency_ms:0,cached_from:previous.id});
      const output={...previous.output,request_id:request.input.request_id};
      return this.finish({definition,request,output,call,meta,mode:switches.mode,cached:true});
    }
    if(!await this.budgetLeft(config,merchantId))return{ran:false,code:'LLM_MONTHLY_BUDGET_REACHED'};

    const answer=await this.client.complete(config,{system:SYSTEM_PROMPT,user:userMessage(task,request.input),schema:definition.schema,schemaName:task});
    const cost=costOf({provider:config.provider,model:config.model,inputTokens:answer.input_tokens,outputTokens:answer.output_tokens});
    const output=answer.ok?parseModelJson(answer.text):null;
    const status=!answer.ok?answer.status:output?'OK':'INVALID_OUTPUT';
    const checked=output?validateOutput(definition,request,output):null;
    const finalStatus=status==='OK'&&checked?.response_status==='INVALID_OUTPUT'?'INVALID_OUTPUT':status;
    const call=await this.store.insertCall({...meta,status:finalStatus,error_code:finalStatus==='OK'?null:(answer.code||'SCHEMA_INVALID'),attempts:answer.attempts,
      input_tokens:answer.input_tokens,output_tokens:answer.output_tokens,cost_amount:cost.amount,cost_currency:cost.currency,latency_ms:answer.latency_ms,
      // Only a validated answer is kept for reuse; it is derived from public page text or a masked reply.
      output:finalStatus==='OK'?output:null});
    if(!answer.ok){
      this.log?.warn?.(JSON.stringify({event:'LLM_CALL_FAILED',task,provider:config.provider,code:answer.code,attempts:answer.attempts}));
      return{ran:true,task,mode:switches.mode,call_id:call.id,response_status:'FAILED',code:answer.code,items:[],accepted:[],review:[],usable:[],notes:[]};
    }
    return this.finish({definition,request,output,call,meta,mode:switches.mode,cached:false,checked});
  }

  async finish({definition,request,output,call,meta,mode,cached,checked=null}){
    const result=checked||(output?validateOutput(definition,request,output):{response_status:'INVALID_OUTPUT',items:[],notes:[],errors:['$: not a JSON object']});
    const common={call_id:call.id,request_id:meta.request_id,merchant_id:meta.merchant_id,task:meta.task,mode,...request.subject,provider:meta.provider,model:meta.model,
      standard_version:meta.standard_version,prompt_version:meta.prompt_version,extraction_version:extractionVersion(meta.task,meta.model),input_digest:meta.input_digest,
      response_status:result.response_status,notes:result.notes};
    const rows=result.items.length
      ?result.items.map(entry=>({...common,item_index:entry.index,item:entry.item,quote:entry.quote?String(entry.quote).slice(0,300):null,
        confidence:entry.confidence===null||!Number.isFinite(entry.confidence)?null:Math.max(0,Math.min(1,entry.confidence)),status:entry.status,reject_reason:entry.reject_reason}))
      :[{...common,item_index:null,item:null,quote:null,confidence:null,status:'NO_ITEMS',reject_reason:result.response_status==='INVALID_OUTPUT'?'SCHEMA_INVALID':null}];
    const saved=await this.store.insertEvidence(rows);
    const view=saved.map(row=>({evidence_id:row.id,status:row.status,reject_reason:row.reject_reason,item:row.item,quote:row.quote,confidence:row.confidence===null?null:Number(row.confidence)}));
    const accepted=view.filter(row=>row.status==='ACCEPTED');
    return{ran:true,task:meta.task,mode,cached,call_id:call.id,extraction_version:common.extraction_version,response_status:result.response_status,items:view,accepted,review:view.filter(row=>row.status==='REVIEW'),
      // Rules may read model evidence only in ASSIST mode, and only items at or above 0.80.
      usable:mode==='ASSIST'?accepted:[],notes:result.notes,errors:result.errors};
  }

  // ---------- views for the API keys page ----------
  async overview({merchantId=null,admin=false}={}){
    const settings=merchantId?await this.settings.merchant(merchantId):await this.settings.sim();
    const config=await resolveModelConfig({credentials:this.credentials,merchantId,simKeyAllowed:merchantId?await this.settings.simKeyAllowed(merchantId):false});
    const out={owner:merchantId?'MERCHANT':'SIM',merchant_id:merchantId,settings,
      model:config.ok?{ready:true,provider:config.provider,model:config.model,billed_to:config.billed_to,local:config.kind==='ollama'}:{ready:false,code:config.code},
      usage:await this.store.usage({merchantId}),review_count:(await this.store.reviewQueue({merchantId,limit:200})).length};
    if(merchantId){out.own_key=await this.merchantHasOwnKey(merchantId);out.sim_key_allowed=await this.settings.simKeyAllowed(merchantId);}
    if(admin&&!merchantId){
      out.usage_all=await this.store.usage({all:true});
      out.review_count=(await this.store.reviewQueue({all:true,limit:200})).length;
      out.merchant_allowances=await this.store.allowances();
    }
    return out;
  }
}

export const createModelAssist=({pool,store=null,credentials,fetchImpl,timeoutMs,retries,log}={})=>
  new ModelAssistService({store:store||new SqlLlmStore({pool}),credentials,client:createLlmClient({fetchImpl,timeoutMs,retries}),log});

/** Migration 075 verification for the migration runner. */
export async function verifyLlmAssistMigration(client){
  const tables=['llm_assist_settings','llm_merchant_allowances','llm_calls','llm_evidence','llm_review_decisions'];
  const found=(await client.query(`SELECT count(*)::int n FROM unnest($1::text[]) t WHERE to_regclass('leadgen.'||t) IS NOT NULL`,[tables])).rows[0].n;
  const guards=(await client.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = ANY($1::text[]) AND NOT tgisinternal`,[tables.map(table=>`${table}_history_guard`)])).rows[0].n;
  const sim=(await client.query(`SELECT enabled FROM leadgen.llm_assist_settings WHERE owner_scope='SIM' ORDER BY set_at,id LIMIT 1`)).rows[0];
  if(found!==tables.length||guards!==tables.length||!sim)throw new Error('Migration 075 verification failed: model assist tables, guards or initial switch row are missing');
  return{tables:found,guards,initial_enabled:sim.enabled};
}
