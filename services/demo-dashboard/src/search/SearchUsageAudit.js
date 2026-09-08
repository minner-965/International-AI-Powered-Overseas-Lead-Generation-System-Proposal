import {createHash,randomUUID} from 'node:crypto';
export function searchRequestFingerprint({provider,researchJobId,companyId=null,purpose,request={}}){
  return createHash('sha256').update(JSON.stringify({version:1,provider:String(provider).toUpperCase(),researchJobId,companyId,purpose,
    query:String(request.query||'').trim().replace(/\s+/g,' '),country:String(request.country||'ALL').toUpperCase(),
    language:request.searchLang||request.language||'en',offset:Number(request.offset||0),count:Number(request.count||10),
    depth:request.searchDepth||request.search_depth||null})).digest('hex');
}
// Brave result caching requires the caller's existing storage-rights gate. No secrets.
// Unfinished claims are
// deliberately held for investigation rather than automatically repeated/billed.
export class SearchUsageAudit{
  constructor({provider,pool=null,now=()=>new Date(),retrySafeFailures=false}={}){this.provider=provider;this.pool=pool;this.now=now;this.local=new Map();this.retrySafeFailures=retrySafeFailures;}
  async search({researchJobId,companyId=null,productProfile=null,purpose,budgetPool='DISCOVERY',request,persistResults=null,loadPersistedResults=null}){
    if(!researchJobId||!purpose)throw Object.assign(new Error('Research job and purpose are required'),{code:'SEARCH_AUDIT_CONTEXT_REQUIRED'});
    const provider=String(this.provider.name).toUpperCase();
    const fingerprint=searchRequestFingerprint({provider,researchJobId,companyId,purpose,request});
    let event,claimed=false;
    const audit={purpose,usage_group:budgetPool,attempt_count:0,attempts:[],billing_units_known:false,reference_ids:[]};
    if(this.pool){
      const inserted=await this.pool.query(`INSERT INTO leadgen.provider_usage_events
        (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,budget_pool,product_profile,result_payload)
        VALUES($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,$9::jsonb)
        ON CONFLICT(provider,request_fingerprint) DO NOTHING RETURNING *`,[researchJobId,companyId,provider,
        this.now().toISOString().slice(0,7),new URL(this.provider.endpoint).hostname+new URL(this.provider.endpoint).pathname,
        fingerprint,budgetPool,productProfile,JSON.stringify({audit})]);
      claimed=inserted.rowCount>0;
      event=inserted.rows[0]||(await this.pool.query('SELECT * FROM leadgen.provider_usage_events WHERE provider=$1 AND request_fingerprint=$2',[provider,fingerprint])).rows[0];
    }else{
      event=this.local.get(fingerprint);if(!event){event={id:randomUUID(),status:'RESERVED',result_payload:{audit}};this.local.set(fingerprint,event);claimed=true;}
    }
    if(!claimed&&this.retrySafeFailures&&['RATE_LIMITED','CREDIT_EXHAUSTED','AUTHENTICATION_FAILED','AUTH_ERROR','MISSING_API_KEY'].includes(event?.error_code)&&Number(event.used_units||0)===0){
      if(this.pool){const retried=await this.pool.query(`UPDATE leadgen.provider_usage_events SET status='RESERVED',error_code=NULL,completed_at=NULL WHERE id=$1 AND status IN('FAILED','TEMPORARY_ERROR') AND used_units=0 RETURNING *`,[event.id]);claimed=retried.rowCount>0;event=retried.rows[0]||event;}
      else if(['FAILED','TEMPORARY_ERROR'].includes(event.status)){claimed=true;event.status='RESERVED';}
    }
    if(!claimed){
      if(['COMPLETED','NOT_FOUND'].includes(event?.status)){
        const stored=event.result_payload?.audit||{};
        const results=Array.isArray(stored.results)?stored.results:await loadPersistedResults?.({referenceIds:stored.reference_ids||[],resultCount:stored.result_count||0})||[];
        if(Number(stored.result_count)>0&&!results.length)throw Object.assign(new Error('Persisted search results require review'),{code:'SEARCH_REPLAY_RESULTS_MISSING'});
        return{provider:this.provider.name,results,result_count:stored.result_count||0,replay:true,attempts:0,usage_event:event};
      }
      throw Object.assign(new Error('Previous search request requires review'),{code:event?.status==='RESERVED'?'SEARCH_REQUEST_IN_PROGRESS':'SEARCH_PREVIOUS_REQUEST_FAILED',retryable:false,usage_event:event});
    }
    const save=async(status,errorCode=null)=>{
      if(this.pool){const updated=await this.pool.query(`UPDATE leadgen.provider_usage_events SET status=$2,error_code=$3,
        result_payload=$4::jsonb,completed_at=CASE WHEN $2='RESERVED' THEN NULL ELSE now() END WHERE id=$1 RETURNING *`,[event.id,status,errorCode,JSON.stringify({audit})]);event=updated.rows[0]||event;}
      else{event={...event,status,error_code:errorCode,result_payload:{audit:structuredClone(audit)}};this.local.set(fingerprint,event);}
    };
    let response;
    try{
      response=await this.provider.search({...request,onAttempt:async attempt=>{
        if(attempt.phase==='STARTED'){audit.attempt_count++;audit.attempts.push({attempt:attempt.attempt,state:'STARTED'});}
        else{const current=audit.attempts.at(-1);if(current)Object.assign(current,{state:'FINISHED',http_status:attempt.status,error_code:attempt.errorCode});}
        await save('RESERVED');
      }});
      audit.result_count=response.results.length;
      audit.provider_used_units=Number(response.credits||0);
      audit.results=response.results.slice(0,20).map(row=>({title:String(row.title||'').slice(0,500),url:String(row.url||'').slice(0,2000),snippet:String(row.snippet||'').slice(0,2000),rank:row.rank}));
      const persisted=await persistResults?.(response.results)||{};
      audit.reference_ids=(persisted.referenceIds||[]).map(String).slice(0,20);
      await save(response.results.length?'COMPLETED':'NOT_FOUND');
      if(this.pool&&Number.isFinite(audit.provider_used_units))await this.pool.query('UPDATE leadgen.provider_usage_events SET used_units=$2 WHERE id=$1',[event.id,audit.provider_used_units]);
    }catch(error){
      // A provider result followed by a persistence failure must never be silently replayed.
      await save(error.retryable?'TEMPORARY_ERROR':'FAILED',response?'RESULT_PERSIST_FAILED':String(error.code||'SEARCH_ERROR').slice(0,120));
      error.usage_event=event;throw error;
    }
    return{...response,result_count:response.results.length,replay:false,usage_event:event};
  }
}
