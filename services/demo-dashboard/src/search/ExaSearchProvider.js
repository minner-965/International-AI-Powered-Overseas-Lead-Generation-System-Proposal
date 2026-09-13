import {SearchProvider,SearchProviderError} from './SearchProvider.js';
const defaultEndpoint='https://api.exa.ai/search';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const retryAfterSeconds=(response,now=Date.now)=>{const raw=response?.headers?.get?.('retry-after');if(raw==null||raw==='')return null;const n=Number(raw);if(Number.isFinite(n))return Math.max(0,Math.ceil(n));const d=(Date.parse(raw)-now())/1000;return Number.isFinite(d)?Math.max(0,Math.ceil(d)):null;};

export class ExaSearchProvider extends SearchProvider{
  constructor({apiKey,endpoint=defaultEndpoint,timeoutMs=15000,fetchImpl=fetch,sleep=wait,maxAttempts=3,now=Date.now}={}){
    super('exa');Object.assign(this,{apiKey,endpoint:endpoint||defaultEndpoint,timeoutMs,fetchImpl,sleep,now});
    this.maxAttempts=Math.max(1,Math.min(3,Math.floor(Number(maxAttempts)||3)));
  }
  async search({query,count=10,country='ALL',onAttempt}={}){
    if(!this.apiKey)throw new SearchProviderError('Exa API key is not configured',{code:'MISSING_API_KEY'});
    query=String(query||'').trim();count=Math.max(1,Math.min(20,Math.floor(Number(count)||10)));country=String(country||'ALL').toUpperCase();
    if(!query)throw new SearchProviderError('Exa query is required',{code:'INVALID_SEARCH_PARAMETERS'});
    const body={query,type:'auto',numResults:count,contents:{highlights:{maxCharacters:2000}}};
    if(/^[A-Z]{2}$/.test(country))body.userLocation=country;
    for(let attempt=1;attempt<=this.maxAttempts;attempt++){
      await onAttempt?.({phase:'STARTED',attempt});
      let response=null,payload=null,error=null;
      try{response=await this.fetchImpl(this.endpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/json','x-api-key':this.apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(this.timeoutMs)});}
      catch(cause){const timedOut=['TimeoutError','AbortError'].includes(cause?.name);error=new SearchProviderError(timedOut?'Exa search request timed out':'Exa search request failed',{code:timedOut?'TIMEOUT':'NETWORK_ERROR',retryable:false});}
      if(response){try{payload=await response.json();}catch{if(response.ok)error=new SearchProviderError('Exa returned invalid JSON',{code:'INVALID_RESPONSE',status:response.status});}}
      if(response&&!response.ok&&!error){
        const s=response.status;
        const code=[401,403].includes(s)?'AUTH_ERROR':s===402?'CREDIT_EXHAUSTED':s===429?'RATE_LIMITED':s>=500?'TEMPORARY_ERROR':'BAD_REQUEST';
        error=new SearchProviderError(`Exa returned HTTP ${s}`,{code,status:s,retryable:s===429,retryAfterSeconds:s===429?retryAfterSeconds(response,this.now):null});
      }
      if(response?.ok&&!error&&!Array.isArray(payload?.results))error=new SearchProviderError('Exa response is missing results',{code:'INVALID_RESPONSE',status:response.status});
      await onAttempt?.({phase:'FINISHED',attempt,status:response?.status??null,errorCode:error?.code||null});
      if(!error)return{provider:this.name,query,requestId:payload?.requestId||null,searchTime:Number(payload?.searchTime||0),costDollars:payload?.costDollars||null,credits:1,creditsSource:'request_count',results:payload.results.map((r,i)=>({title:String(r?.title||''),url:String(r?.url||''),snippet:(Array.isArray(r?.highlights)?r.highlights.filter(v=>typeof v==='string').join('\n'):String(r?.text||'')).slice(0,2000),provider_score:null,rank:i+1}))};
      error.attempts=attempt;
      if(!error.retryable||attempt===this.maxAttempts)throw error;
      const delay=error.retryAfterSeconds==null?Math.min(4000,500*2**(attempt-1)):error.retryAfterSeconds*1000;
      if(delay>10000)throw error;
      await this.sleep(delay);
    }
  }
}
