import {SearchProvider,SearchProviderError} from './SearchProvider.js';
const endpoint='https://api.search.brave.com/res/v1/web/search';
// Official SearchCountry enum, not the separate ISO location-country enum.
const countries=new Set('AR AU AT BE BR CA CL DK FI FR DE GR HK IN ID IT JP KR MY MX NL NZ NO CN PL PT PH RU SA ZA ES SE CH TW TR GB US ALL'.split(' '));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BraveSearchProvider extends SearchProvider{
  constructor({apiKey,timeoutMs=10000,fetchImpl=fetch,sleep=wait,maxAttempts=3,now=Date.now}={}){
    super('brave');Object.assign(this,{apiKey,timeoutMs,fetchImpl,sleep,now,endpoint});
    this.maxAttempts=Math.max(1,Math.min(3,Math.floor(Number(maxAttempts)||3)));
  }
  async search({query,count=10,country='ALL',searchLang,language,offset=0,onAttempt}={}){
    if(!this.apiKey)throw new SearchProviderError('Brave Search API key is not configured',{code:'MISSING_API_KEY'});
    query=String(query||'').trim();country=String(country||'ALL').toUpperCase();
    const lang=String(searchLang||language||'en').toLowerCase();count=Number(count);offset=Number(offset);
    if(!query||query.length>400||query.split(/\s+/).length>50||!Number.isInteger(count)||count<1||count>20||!Number.isInteger(offset)||offset<0||offset>9||!/^([A-Z]{2}|ALL)$/.test(country)||! /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(lang))
      throw new SearchProviderError('Invalid Brave Search parameters',{code:'INVALID_SEARCH_PARAMETERS'});
    const providerCountry=countries.has(country)?country:'ALL';
    const url=new URL(endpoint);url.search=new URLSearchParams({q:query,count:String(count),country:providerCountry,search_lang:lang,offset:String(offset)});
    for(let attempt=1;attempt<=this.maxAttempts;attempt++){
      // Audit intent precedes I/O; an audit failure prevents a provider call.
      await onAttempt?.({phase:'STARTED',attempt});
      let response,error,payload;
      try{response=await this.fetchImpl(url,{headers:{accept:'application/json','x-subscription-token':this.apiKey},signal:AbortSignal.timeout(this.timeoutMs)});}
      catch(cause){const timedOut=['TimeoutError','AbortError'].includes(cause?.name);error=new SearchProviderError(timedOut?'Brave Search request timed out':'Brave Search request failed',{code:timedOut?'TIMEOUT':'NETWORK_ERROR',retryable:true});}
      if(response&&!response.ok){
        const auth=[401,403].includes(response.status),retryable=response.status===429||response.status>=500;
        const header=response.headers?.get?.('retry-after');let seconds=header===null||header===undefined?NaN:Number(header);
        if(!Number.isFinite(seconds))seconds=(Date.parse(header)-this.now())/1000;
        error=new SearchProviderError('Brave Search returned HTTP '+response.status,{code:auth?'AUTHENTICATION_FAILED':response.status===429?'RATE_LIMITED':response.status>=500?'TEMPORARY_ERROR':'HTTP_ERROR',status:response.status,retryable,retryAfterSeconds:Number.isFinite(seconds)?Math.max(0,Math.ceil(seconds)):null});
      }
      if(response?.ok){try{payload=await response.json();if(!payload||typeof payload!=='object'||(payload.web!==undefined&&!Array.isArray(payload.web?.results)))throw new Error();}
        catch{error=new SearchProviderError('Brave Search returned an invalid response',{code:'INVALID_RESPONSE',status:response.status});}}
      await onAttempt?.({phase:'FINISHED',attempt,status:response?.status??null,errorCode:error?.code||null});
      if(!error)return{provider:this.name,query,attempts:attempt,offset,count,country,providerCountry,searchLang:lang,
        moreResultsAvailable:payload.query?.more_results_available===true,
        results:(payload.web?.results||[]).map((result,index)=>({title:result?.title||'',url:result?.url||'',snippet:result?.description||'',rank:offset*count+index+1}))};
      error.attempts=attempt;
      if(!error.retryable||attempt===this.maxAttempts)throw error;
      const delay=error.retryAfterSeconds===null?Math.min(4000,500*2**(attempt-1)):error.retryAfterSeconds*1000;
      if(delay>10000)throw error;
      await this.sleep(delay);
    }
  }
}
