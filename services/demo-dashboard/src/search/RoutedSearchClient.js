import {SearchUsageAudit} from './SearchUsageAudit.js';
import {TavilyUsageAudit} from './TavilyUsageAudit.js';
import {FREE_PROVIDER_UNAVAILABLE,searchPauseError} from './ProviderSpendPolicy.js';

const PROFILES=new Set(['WOMENSWEAR','GENERAL_MERCHANDISE']);
const profileOf=value=>{const profile=String(value||'').trim().toUpperCase();return PROFILES.has(profile)?profile:null;};

// Search entry point for contact research (EnrichmentService) and category evidence
// (CategoryEvidenceService). It replaces the single provider built from SEARCH_PROVIDER with
// the same provider order, spend policy and monthly budget check as company discovery:
//  - the CurrentCapacityRouter picks the provider (FREE_ONLY never selects a paid provider);
//  - SearchCostControl.canSpend runs before every call;
//  - a SearXNG failure (fallback:true) moves to the next permitted provider;
//  - an empty free answer only moves to a paid provider when paid_fallback_on_empty is on.
// When no provider is permitted the call throws an error with `searchPause:true` and a pause
// code (PAUSED_FREE_PROVIDER_UNAVAILABLE, PAUSED_SEARCH_MONTHLY_BUDGET, ...); callers stop the
// search step and the work is picked up again later. It exposes the TavilyUsageAudit
// `search(args)` contract so callers keep their persistence callbacks.
export class RoutedSearchClient{
  constructor({router,costControl=null,pool=null,accountStates={},tavilyUsageConfig={},auditFactory=null,name='search_router'}={}){
    if(!router)throw new Error('RoutedSearchClient requires a provider router');
    Object.assign(this,{router,costControl,pool,accountStates,tavilyUsageConfig,name});
    this.auditFactory=auditFactory||((provider,selection)=>selection.provider==='tavily'
      ?new TavilyUsageAudit({provider,pool,...tavilyUsageConfig})
      :new SearchUsageAudit({provider,pool,retrySafeFailures:true}));
  }

  async search({excludeProviders=[],...args}={}){
    const tried=excludeProviders.map(value=>String(value).toLowerCase());
    let emptyAnswer=null,failedOver=false;
    for(;;){
      const selected=await this.router.select({exclude:tried,afterEmpty:Boolean(emptyAnswer)});
      if(!selected.provider){
        if(emptyAnswer)return emptyAnswer;
        throw searchPauseError(selected.reason===FREE_PROVIDER_UNAVAILABLE||!failedOver?selected.reason:'PAUSED_PROVIDER_UNAVAILABLE',{skipped:selected.skipped||[]});
      }
      if(this.costControl){
        const budget=await this.costControl.canSpend(selected.provider);
        if(!budget.allowed)throw searchPauseError(budget.reason==='FREE_ONLY'?FREE_PROVIDER_UNAVAILABLE:'PAUSED_SEARCH_MONTHLY_BUDGET');
      }
      const provider=this.router.provider(selected);
      const audit=this.auditFactory(provider,selected);
      let response;
      try{
        response=await audit.search({...args,productProfile:profileOf(args.productProfile),budgetPool:args.budgetPool||'EVIDENCE'});
      }catch(error){
        try{await this.accountStates?.[selected.provider]?.observeSearchError?.(error);}catch{}
        if(error?.fallback===true){tried.push(selected.provider);failedOver=true;continue;}
        throw error;
      }
      const results=response.results||[];
      if(response.fallbackOnEmpty===true&&!response.replay&&!results.length){
        tried.push(selected.provider);emptyAnswer={...response,provider:selected.provider,result_count:0};continue;
      }
      return {...response,provider:selected.provider};
    }
  }
}
