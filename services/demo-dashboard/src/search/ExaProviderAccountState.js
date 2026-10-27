const iso=now=>now().toISOString();
export class ExaProviderAccountState{
  constructor({pool=null,apiKey,enabled=true,now=()=>new Date(),capacityRetryHours=24}={}){
    // apiKey may be a function so a key saved on the API keys page applies without a restart (B9).
    Object.assign(this,{pool,apiKeySource:apiKey,enabled:enabled===true,now});
    this.capacityRetryHours=Math.max(1,Math.min(168,Number(capacityRetryHours)||24));
    this.local=null;
  }
  get apiKey(){return String((typeof this.apiKeySource==='function'?this.apiKeySource():this.apiKeySource)||'');}
  set apiKey(value){this.apiKeySource=value;}
  async latestEvent(){
    if(!this.pool)return null;
    return (await this.pool.query(`SELECT status,error_code,completed_at FROM leadgen.provider_usage_events WHERE provider='EXA' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`)).rows[0]||null;
  }
  async getState(){
    const checked_at=iso(this.now);
    if(!this.enabled)return{provider_code:'EXA',status:'DISABLED',remaining_credits:null,checked_at,retry_after_at:null,last_provider_error_code:null};
    if(!this.apiKey)return{provider_code:'EXA',status:'AUTH_ERROR',remaining_credits:null,checked_at,retry_after_at:null,last_provider_error_code:'MISSING_API_KEY'};
    if(this.local?.retry_after_at&&Date.parse(this.local.retry_after_at)<=this.now().getTime())this.local=null;
    if(this.local)return{provider_code:'EXA',remaining_credits:null,checked_at,...this.local};
    const row=await this.latestEvent();
    const code=String(row?.error_code||'');
    const completed=row?.completed_at?new Date(row.completed_at):null;
    const ageMs=completed&&Number.isFinite(completed.getTime())?this.now().getTime()-completed.getTime():Infinity;
    if(/CREDIT_EXHAUSTED/.test(code)&&ageMs<this.capacityRetryHours*3600000)return{provider_code:'EXA',status:'CREDIT_EXHAUSTED',remaining_credits:0,checked_at,retry_after_at:new Date(completed.getTime()+this.capacityRetryHours*3600000).toISOString(),last_provider_error_code:code};
    if(/AUTH|API_KEY/.test(code)&&ageMs<600000)return{provider_code:'EXA',status:'AUTH_ERROR',remaining_credits:null,checked_at,retry_after_at:new Date(completed.getTime()+600000).toISOString(),last_provider_error_code:code};
    if(/RATE_LIMIT/.test(code)&&ageMs<60000)return{provider_code:'EXA',status:'RATE_LIMITED',remaining_credits:null,checked_at,retry_after_at:new Date(completed.getTime()+60000).toISOString(),last_provider_error_code:code};
    // AVAILABLE means eligible to attempt, not a remote balance or credential check.
    return{provider_code:'EXA',status:'AVAILABLE',remaining_credits:null,checked_at,retry_after_at:null,last_provider_error_code:null,
      capacity_verified:false,credential_verified:['COMPLETED','NOT_FOUND'].includes(row?.status),
      last_successful_request_at:['COMPLETED','NOT_FOUND'].includes(row?.status)?completed?.toISOString()||null:null,
      state_source:row?'PERSISTED_REQUEST_OUTCOME':'LOCAL_CONFIGURATION_ONLY'};
  }
  async refreshUsage(){return this.getState();}
  async ensureCanCreate(){
    const state=await this.getState();
    if(state.status==='AVAILABLE')return state;
    const code=state.status==='CREDIT_EXHAUSTED'?'PROVIDER_CREDIT_EXHAUSTED':state.status==='AUTH_ERROR'?'PROVIDER_AUTH_ERROR':state.status==='RATE_LIMITED'?'PROVIDER_RATE_LIMITED':'SEARCH_PROVIDER_UNAVAILABLE';
    throw Object.assign(new Error(`Exa provider unavailable: ${state.status}`),{code,status:503,created:false,retryable:state.status==='RATE_LIMITED'});
  }
  async observeSearchError(error){
    const code=String(error?.code||'SEARCH_ERROR');
    if(/CREDIT_EXHAUSTED/.test(code))this.local={status:'CREDIT_EXHAUSTED',remaining_credits:0,retry_after_at:new Date(this.now().getTime()+this.capacityRetryHours*3600000).toISOString(),last_provider_error_code:code.slice(0,120)};
    else if(/AUTH|API_KEY/.test(code))this.local={status:'AUTH_ERROR',remaining_credits:null,retry_after_at:new Date(this.now().getTime()+600000).toISOString(),last_provider_error_code:code.slice(0,120)};
    else if(/RATE_LIMIT/.test(code)){const seconds=Math.max(1,Math.min(86400,Number(error?.retryAfterSeconds)||60));this.local={status:'RATE_LIMITED',remaining_credits:null,retry_after_at:new Date(this.now().getTime()+seconds*1000).toISOString(),last_provider_error_code:code.slice(0,120)};}
    return this.getState();
  }
}
