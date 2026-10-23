import {SearchUsageAudit} from './SearchUsageAudit.js';

export function searchPause(error){
 const code=String(error?.code||'SEARCH_ERROR');
 if(/CREDIT|CAPACITY/.test(code))return 'PAUSED_PROVIDER_CAPACITY';
 if(/RATE_LIMIT/.test(code))return 'PAUSED_PROVIDER_RATE_LIMIT';
 if(/AUTH|API_KEY/.test(code))return 'PAUSED_PROVIDER_AUTH';
 return 'PAUSED_SEARCH_REVIEW';
}

// One existing job, its immutable plan, and the existing usage ledger. Storage
// owns transactional candidate/hit persistence; the worker owns stage handoff.
export class FrozenSearchPlanExecutor {
 // jobAllowed(jobId) is the merchant guard: a job created by a merchant batch pauses when that
 // merchant is read-only, has research disabled or reached its monthly search quota.
 constructor({store,router,isEnabled=async()=>true,accountState=null,accountStates={},pool=null,auditFactory=null,costControl=null,reuseDays=0,jobAllowed=null}={}){
  Object.assign(this,{store,router,isEnabled,accountState,accountStates,pool,costControl,jobAllowed});
  this.reuseDays=Number(costControl?.config?.reuseDays??reuseDays)||0;
  this.auditFactory=auditFactory||((provider)=>new SearchUsageAudit({provider,pool,retrySafeFailures:true}));
 }
 async executeJob(jobId,{signal}={}){
  const frozen=await this.store.load(jobId);
  if(!frozen?.plan?.queries)throw Object.assign(new Error('PERSISTED_SEARCH_PLAN_REQUIRED'),{code:'PERSISTED_SEARCH_PLAN_REQUIRED',retryable:false});
  // Zero planned queries is a failed plan, never a completed search.
  if(!frozen.plan.queries.length)throw Object.assign(new Error('SEARCH_PLAN_EMPTY'),{code:'SEARCH_PLAN_EMPTY',retryable:false});
  let completed=0,replayed=0,reusedCount=0;
  const pause=(status)=>({completed:false,paused:true,status,completed_queries:completed,replayed_queries:replayed,reused_queries:reusedCount});
  for(const query of frozen.plan.queries){
   const prior=await this.store.lookup(frozen,query);
   if(prior&&['PERSISTED','NOT_FOUND'].includes(prior.status)){completed++;replayed++;continue;}
   if(prior?.response_snapshot){await this.store.persist(frozen,query,prior,prior.response_snapshot);completed++;replayed++;continue;}
   if(prior&&['CLAIMED','REVIEW_REQUIRED','FAILED','TEMPORARY_ERROR'].includes(prior.status))return pause('PAUSED_SEARCH_REVIEW');
   if(signal?.aborted||!await this.isEnabled())return pause('PAUSED_AUTOMATION_OFF');
   if(this.jobAllowed){const allowed=await this.jobAllowed(jobId);if(!allowed?.allowed)return pause(allowed?.code==='MERCHANT_SEARCH_QUOTA_EXCEEDED'?'PAUSED_MERCHANT_SEARCH_QUOTA':'PAUSED_MERCHANT_ACCOUNT');}
   // Fallback chain: a provider that fails with `fallback:true` (local SearXNG errors, 429,
   // CAPTCHA) or returns an empty page with `fallbackOnEmpty` hands the same query to the
   // next available provider in the configured order. Paid providers never fall back.
   const tried=[];let settled=false,emptyAnswer=false;
   for(;;){
    const selected=await this.router.select(tried.length?{exclude:tried}:undefined);
    if(!selected.provider){
     if(emptyAnswer){settled=true;break;}
     return pause(tried.length?'PAUSED_PROVIDER_UNAVAILABLE':selected.reason);
    }
    // Cross-run reuse: the same query text/market/language/provider executed recently costs nothing.
    if(this.reuseDays>0&&this.store.findReusable){
     const source=await this.store.findReusable(frozen,query,selected,{days:this.reuseDays});
     if(source){
      const reusedRow=await this.store.reuse(frozen,query,selected,source);
      if(reusedRow){reusedCount++;settled=true;break;}
     }
    }
    if(this.costControl){
     const budget=await this.costControl.canSpend(selected.provider);
     if(!budget.allowed)return pause('PAUSED_SEARCH_MONTHLY_BUDGET');
    }
    const execution=await this.store.claim(frozen,query,selected,tried.length?'FALLBACK_AFTER_PROVIDER_FAILURE':selected.reason);
    if(!execution)return pause('PAUSED_QUERY_IN_PROGRESS');
    const provider=this.router.provider(selected);
    const originalSearch=provider.search.bind(provider);
    // Save the provider outcome before candidate processing or ledger settlement.
    const recordingProvider={name:provider.name,endpoint:provider.endpoint,retrySafe:provider.retrySafe===true,search:async request=>{
     const response=await originalSearch(request);
     await this.store.recordResponse(execution,response);
     return response;
    }};
    let response;
    try{
     response=await this.auditFactory(recordingProvider).search({researchJobId:jobId,purpose:'NEW_COMPANY_DISCOVERY',budgetPool:'DISCOVERY',
      request:execution.request_snapshot,persistResults:async results=>({referenceIds:await this.store.persist(frozen,query,execution,{results})}),
      loadPersistedResults:async()=>this.store.results(execution)});
     if(response.replay){await this.store.recordResponse(execution,response);await this.store.persist(frozen,query,execution,response);}
     await this.store.attachUsage(execution,response.usage_event);
     if(response.replay)replayed++;
    }catch(error){
     await this.store.fail(execution,error);
     const state=this.accountStates?.[selected.provider]||(selected.provider==='tavily'?this.accountState:null);
     try{await state?.observeSearchError?.(error);}catch{}
     if(error?.fallback===true){tried.push(selected.provider);continue;}
     return pause(searchPause(error));
    }
    if(response.fallbackOnEmpty===true&&!response.replay&&!(response.results||[]).length){tried.push(selected.provider);emptyAnswer=true;continue;}
    settled=true;break;
   }
   if(settled)completed++;
  }
  return {completed:true,paused:false,status:'COMPLETED',completed_queries:completed,replayed_queries:replayed,reused_queries:reusedCount};
 }
}
