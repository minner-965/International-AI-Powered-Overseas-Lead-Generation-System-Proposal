import {createHash} from 'node:crypto';

const PROVIDER='TAVILY';
const STATUSES=new Set(['AVAILABLE','UNKNOWN','RATE_LIMITED','CREDIT_EXHAUSTED','AUTH_ERROR','DEGRADED']);
const SOURCES=new Set(['USAGE_ENDPOINT','SEARCH_RESPONSE','ADMIN_REFRESH','STARTUP_PROBE']);
const cleanCode=(value,fallback='UNKNOWN')=>{
  const code=String(value||'').trim().toUpperCase().replace(/[^A-Z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100);
  return code||fallback;
};
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;

export class TavilyProviderAccountState {
  constructor({pool,apiKey='',usageEndpoint='https://api.tavily.com/usage',fetchImpl=fetch,
    refreshIntervalMs=600000,timeoutMs=10000,now=()=>new Date()}={}){
    if(!pool)throw new TypeError('TavilyProviderAccountState requires a PostgreSQL pool');
    this.pool=pool;this.apiKey=apiKey;this.usageEndpoint=usageEndpoint;this.fetchImpl=fetchImpl;
    this.refreshIntervalMs=Math.max(600000,Number(refreshIntervalMs)||600000);
    this.timeoutMs=Math.max(1000,Number(timeoutMs)||10000);this.now=now;
    this.credentialFingerprint=apiKey?createHash('sha256').update(apiKey).digest('hex'):null;
  }

  async getState(){
    const result=await this.pool.query(`SELECT provider_code,credential_fingerprint,status,remaining_credits,checked_at,retry_after_at,
      last_provider_error_code,updated_at FROM leadgen.provider_account_states WHERE provider_code=$1`,[PROVIDER]);
    return result.rows[0]||{provider_code:PROVIDER,status:'UNKNOWN',remaining_credits:null,checked_at:null,
      retry_after_at:null,last_provider_error_code:null,updated_at:null};
  }

  async transition(status,{source='SEARCH_RESPONSE',reasonCode=null,providerRequestId=null,retryAfterAt=null,
    usage=null}={}){
    const next=STATUSES.has(status)?status:'UNKNOWN';
    const eventSource=SOURCES.has(source)?source:'SEARCH_RESPONSE';
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`SELECT * FROM leadgen.provider_account_states
        WHERE provider_code=$1 FOR UPDATE`,[PROVIDER])).rows[0]||null;
      const values=usage||{};
      const updated=(await client.query(`INSERT INTO leadgen.provider_account_states
        (provider_code,credential_fingerprint,status,key_usage,key_limit,plan_usage,plan_limit,paygo_usage,paygo_limit,
         remaining_credits,checked_at,retry_after_at,last_provider_error_code,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12,now())
        ON CONFLICT(provider_code) DO UPDATE SET credential_fingerprint=EXCLUDED.credential_fingerprint,
          status=EXCLUDED.status,key_usage=coalesce(EXCLUDED.key_usage,leadgen.provider_account_states.key_usage),
          key_limit=coalesce(EXCLUDED.key_limit,leadgen.provider_account_states.key_limit),
          plan_usage=coalesce(EXCLUDED.plan_usage,leadgen.provider_account_states.plan_usage),
          plan_limit=coalesce(EXCLUDED.plan_limit,leadgen.provider_account_states.plan_limit),
          paygo_usage=coalesce(EXCLUDED.paygo_usage,leadgen.provider_account_states.paygo_usage),
          paygo_limit=coalesce(EXCLUDED.paygo_limit,leadgen.provider_account_states.paygo_limit),
          remaining_credits=EXCLUDED.remaining_credits,checked_at=now(),retry_after_at=EXCLUDED.retry_after_at,
          last_provider_error_code=EXCLUDED.last_provider_error_code,updated_at=now() RETURNING *`,[
        PROVIDER,this.credentialFingerprint,next,finite(values.key_usage),finite(values.key_limit),
        finite(values.plan_usage),finite(values.plan_limit),finite(values.paygo_usage),finite(values.paygo_limit),
        finite(values.remaining_credits),retryAfterAt,reasonCode?cleanCode(reasonCode):null
      ])).rows[0];
      if(!current||current.status!==next){
        await client.query(`INSERT INTO leadgen.provider_account_state_events
          (provider_code,old_status,new_status,source,sanitized_reason_code,provider_request_id,observed_at)
          VALUES($1,$2,$3,$4,$5,$6,now())`,[PROVIDER,current?.status||null,next,eventSource,
          reasonCode?cleanCode(reasonCode):null,String(providerRequestId||'').slice(0,200)||null]);
      }
      await client.query('COMMIT');return updated;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async assertCanCreate(){
    const state=await this.getState();
    if(state.status==='CREDIT_EXHAUSTED')throw Object.assign(new Error('搜索服务额度已用完，充值或额度恢复后可继续创建研究任务。'),{
      code:'SEARCH_PROVIDER_CREDITS_EXHAUSTED',status:423,created:false});
    if(state.status==='AUTH_ERROR')throw Object.assign(new Error('搜索服务配置不可用，请管理员检查。'),{
      code:'SEARCH_PROVIDER_CONFIGURATION_BLOCKED',status:503,created:false});
    return state;
  }

  async beforeSearch(){
    const state=await this.getState();
    if(state.status==='CREDIT_EXHAUSTED')throw Object.assign(new Error('Search provider credits are exhausted'),{
      code:'PROVIDER_CREDIT_EXHAUSTED',retryable:false});
    if(state.status==='AUTH_ERROR')throw Object.assign(new Error('Search provider configuration is blocked'),{
      code:'PROVIDER_AUTH_ERROR',retryable:false});
    if(state.status==='RATE_LIMITED'&&state.retry_after_at&&new Date(state.retry_after_at)>this.now()){
      throw Object.assign(new Error('Search provider is rate limited'),{code:'PROVIDER_RATE_LIMITED',retryable:true,
        retryAfterAt:new Date(state.retry_after_at)});
    }
    return state;
  }

  async observeSearchError(error){
    const code=cleanCode(error?.code);
    if(code==='RATE_LIMITED'){
      const seconds=Math.max(1,Math.min(86400,Number(error?.retryAfterSeconds)||60));
      return this.transition('RATE_LIMITED',{reasonCode:'HTTP_429',retryAfterAt:new Date(this.now().getTime()+seconds*1000)});
    }
    if(code==='CREDIT_EXHAUSTED')return this.transition('CREDIT_EXHAUSTED',{reasonCode:'HTTP_432'});
    if(code==='AUTH_ERROR'||code==='MISSING_API_KEY')return this.transition('AUTH_ERROR',{reasonCode:code});
    if(['TEMPORARY_ERROR','TIMEOUT','NETWORK_ERROR','HTTP_5XX'].includes(code))
      return this.transition('DEGRADED',{reasonCode:code});
    return this.getState();
  }

  async observeSearchSuccess(providerRequestId=null){
    return this.transition('AVAILABLE',{source:'SEARCH_RESPONSE',reasonCode:'SEARCH_SUCCEEDED',providerRequestId});
  }

  async refreshUsage({force=false,source='USAGE_ENDPOINT'}={}){
    const current=await this.getState();
    const sameCredential=current.credential_fingerprint&&current.credential_fingerprint===this.credentialFingerprint;
    if(!force&&sameCredential&&current.checked_at&&this.now()-new Date(current.checked_at)<this.refreshIntervalMs)
      return{...current,cached:true};
    if(!this.apiKey)return this.transition('AUTH_ERROR',{source,reasonCode:'MISSING_API_KEY'});
    let response;
    try{response=await this.fetchImpl(this.usageEndpoint,{headers:{accept:'application/json',authorization:`Bearer ${this.apiKey}`},
      signal:AbortSignal.timeout(this.timeoutMs)});}catch(error){
      return this.transition('DEGRADED',{source,reasonCode:error?.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR'});
    }
    if(response.status===429){
      const seconds=Math.max(1,Math.min(86400,Number(response.headers?.get?.('retry-after'))||60));
      return this.transition('RATE_LIMITED',{source,reasonCode:'HTTP_429',retryAfterAt:new Date(this.now().getTime()+seconds*1000)});
    }
    if(response.status===401||response.status===403)return this.transition('AUTH_ERROR',{source,reasonCode:`HTTP_${response.status}`});
    if(!response.ok)return this.transition('DEGRADED',{source,reasonCode:`HTTP_${response.status}`});
    let payload;try{payload=await response.json();}catch{return this.transition('DEGRADED',{source,reasonCode:'INVALID_RESPONSE'});}
    const usage={key_usage:payload?.key?.usage,key_limit:payload?.key?.limit,plan_usage:payload?.account?.plan_usage,
      plan_limit:payload?.account?.plan_limit,paygo_usage:payload?.account?.paygo_usage,paygo_limit:payload?.account?.paygo_limit};
    const planExhausted=finite(usage.plan_limit)!==null&&finite(usage.plan_usage)>=finite(usage.plan_limit);
    const paygoConfigured=finite(usage.paygo_limit)!==null&&finite(usage.paygo_limit)>0;
    const paygoExhausted=paygoConfigured&&finite(usage.paygo_usage)>=finite(usage.paygo_limit);
    const confirmedExhausted=planExhausted&&paygoConfigured&&paygoExhausted;
    usage.remaining_credits=confirmedExhausted?0:null;
    return this.transition(confirmedExhausted?'CREDIT_EXHAUSTED':'AVAILABLE',{source,reasonCode:'USAGE_REFRESHED',usage});
  }
}
