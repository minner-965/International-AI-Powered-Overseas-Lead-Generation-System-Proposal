import {SearchProvider,SearchProviderError} from './SearchProvider.js';

// Local SearXNG instance (official searxng/searxng image, run as a separate
// service; AGPL-3.0 code is not modified or linked). JSON API: GET /search?format=json.
// Zero cost. Every failure mode (HTTP error, 429, CAPTCHA-blocked engines, timeout) is
// marked `fallback:true` and an empty page carries `fallbackOnEmpty`, so the frozen-plan
// executor moves the same query to the next provider in SEARCH_PROVIDER_ORDER.
export const DEFAULT_SEARXNG_BASE_URL='http://searxng:8080';
const CAPTCHA=/captcha|access denied|too many requests|suspended/i;

const languageFor=(language,country)=>{
  const lang=String(language||'').trim().toLowerCase();
  const cc=String(country||'').trim().toUpperCase();
  if(!/^[a-z]{2}$/.test(lang))return 'all';
  return /^[A-Z]{2}$/.test(cc)&&cc!=='ALL'?`${lang}-${cc}`:lang;
};
const fail=(message,options)=>Object.assign(new SearchProviderError(message,options),{fallback:true});

export class SearxngSearchProvider extends SearchProvider{
  constructor({baseUrl=DEFAULT_SEARXNG_BASE_URL,timeoutMs=15000,fetchImpl=fetch,engines=''}={}){
    super('searxng');
    this.baseUrl=String(baseUrl||DEFAULT_SEARXNG_BASE_URL).replace(/\/+$/,'');
    this.endpoint=`${this.baseUrl}/search`;
    Object.assign(this,{timeoutMs,fetchImpl,engines:String(engines||'').trim()});
    // Free provider: a failed attempt costs nothing, so the usage ledger may retry it safely.
    this.retrySafe=true;
  }
  async search({query,count=10,country='ALL',searchLang,onAttempt}={}){
    query=String(query||'').trim();
    if(!query)throw new SearchProviderError('SearXNG query is required',{code:'INVALID_SEARCH_PARAMETERS'});
    count=Math.max(1,Math.min(20,Math.floor(Number(count)||10)));
    const url=new URL(this.endpoint);
    url.searchParams.set('q',query);url.searchParams.set('format','json');url.searchParams.set('pageno','1');
    url.searchParams.set('language',languageFor(searchLang,country));url.searchParams.set('safesearch','0');
    if(this.engines)url.searchParams.set('engines',this.engines);
    await onAttempt?.({phase:'STARTED',attempt:1});
    let response=null,payload=null,error=null;
    try{response=await this.fetchImpl(url.toString(),{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs)});}
    catch(cause){const timedOut=['TimeoutError','AbortError'].includes(cause?.name);
      error=fail(timedOut?'SearXNG request timed out':'SearXNG request failed',{code:timedOut?'TIMEOUT':'NETWORK_ERROR',cause});}
    if(response&&!error){
      if(!response.ok){
        const s=response.status;
        error=s===429?fail('SearXNG rate limited the request',{code:'RATE_LIMITED',status:s,retryAfterSeconds:60})
          :s===403?fail('SearXNG refused the request (JSON format disabled or blocked)',{code:'SEARXNG_FORBIDDEN',status:s})
            :fail(`SearXNG returned HTTP ${s}`,{code:s>=500?'TEMPORARY_ERROR':'BAD_REQUEST',status:s});
      }else{
        try{payload=await response.json();}catch{error=fail('SearXNG returned invalid JSON',{code:'INVALID_RESPONSE',status:response.status});}
        if(!error&&!Array.isArray(payload?.results))error=fail('SearXNG response is missing results',{code:'INVALID_RESPONSE',status:response.status});
      }
    }
    const results=error?[]:payload.results.filter(r=>/^https?:\/\//i.test(String(r?.url||''))).slice(0,count);
    const unresponsive=error?[]:(Array.isArray(payload.unresponsive_engines)?payload.unresponsive_engines:[]);
    if(!error&&!results.length){
      // Upstream engines blocked by CAPTCHA / rate limits leave an empty page; that is a
      // capacity problem, not a "no companies found" answer.
      // A plain empty page is returned (recorded as NOT_FOUND) with fallbackOnEmpty so the
      // executor can still ask the next provider.
      const blocked=unresponsive.some(row=>CAPTCHA.test(Array.isArray(row)?row.join(' '):String(row)));
      if(blocked)error=fail('SearXNG upstream engines are blocked',{code:'RATE_LIMITED_CAPTCHA',retryAfterSeconds:600});
    }
    await onAttempt?.({phase:'FINISHED',attempt:1,status:response?.status??null,errorCode:error?.code||null});
    if(error){error.attempts=1;throw error;}
    return{provider:this.name,query,requestId:null,credits:0,creditsSource:'free_local_instance',costDollars:{total:0},fallbackOnEmpty:true,
      unresponsiveEngines:unresponsive.map(row=>Array.isArray(row)?String(row[0]):String(row)).slice(0,20),
      results:results.map((r,i)=>({title:String(r?.title||''),url:String(r.url),snippet:String(r?.content||'').slice(0,2000),
        provider_score:Number.isFinite(Number(r?.score))?Number(r.score):null,rank:i+1,engines:Array.isArray(r?.engines)?r.engines.slice(0,8):[]}))};
  }
}

// Short local cool-down after an observed failure; the router skips SearXNG meanwhile.
export class SearxngProviderAccountState{
  constructor({enabled=true,baseUrl=DEFAULT_SEARXNG_BASE_URL,now=()=>new Date()}={}){Object.assign(this,{enabled:enabled===true&&Boolean(baseUrl),now});this.local=null;}
  async getState(){
    const checked_at=this.now().toISOString();
    if(!this.enabled)return{provider_code:'SEARXNG',status:'DISABLED',remaining_credits:null,checked_at,retry_after_at:null,last_provider_error_code:null};
    if(this.local&&Date.parse(this.local.retry_after_at)<=this.now().getTime())this.local=null;
    if(this.local)return{provider_code:'SEARXNG',remaining_credits:null,checked_at,...this.local};
    return{provider_code:'SEARXNG',status:'AVAILABLE',remaining_credits:null,checked_at,retry_after_at:null,last_provider_error_code:null,cost_usd_per_query:0};
  }
  async refreshUsage(){return this.getState();}
  async ensureCanCreate(){return this.getState();}
  async observeSearchError(error){
    const code=String(error?.code||'SEARCH_ERROR');
    const seconds=Math.max(30,Math.min(3600,Number(error?.retryAfterSeconds)||120));
    this.local={status:'RATE_LIMITED',retry_after_at:new Date(this.now().getTime()+seconds*1000).toISOString(),last_provider_error_code:code.slice(0,120)};
    return this.getState();
  }
}
