import {createConfiguredSearchProvider} from './SearchProviderRouter.js';

const configured=(name,config)=>name==='searxng'?config.searxngEnabled===true&&Boolean(config.searxngBaseUrl):name==='tavily'?Boolean(config.tavilyApiKey):name==='brave'?Boolean(config.braveApiKey)&&config.storageRightsConfirmed===true:name==='exa'?config.exaEnabled===true&&Boolean(config.exaApiKey):false;

// The explicit order is also the spending allowlist. Credentials alone never
// authorize a paid fallback; unsupported account-capacity adapters stay blocked.
export const DEFAULT_SEARCH_PROVIDER_ORDER=Object.freeze(['searxng','exa','tavily']);
export function parseSearchProviderOrder(value){
  const order=[...new Set(String(value??'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>/^[a-z][a-z0-9_]{1,39}$/.test(v)))];
  return order.length?order:[...DEFAULT_SEARCH_PROVIDER_ORDER];
}
// `exclude` lists providers that already failed (or returned nothing) for the current query.
export function selectCurrentCapacityProvider({order=[],config={},states={},exclude=[]}={}){
  const reasons=[];const excluded=new Set(exclude.map(v=>String(v).toLowerCase()));
  for(const raw of [...new Set(order.map(value=>String(value).toLowerCase()))]){
    if(excluded.has(raw)){reasons.push({provider:raw,reason:'FALLBACK_AFTER_PROVIDER_FAILURE'});continue;}
    if(!configured(raw,config)){reasons.push({provider:raw,reason:'NOT_CONFIGURED_OR_NOT_PERMITTED'});continue;}
    const state=states[raw]||{};
    if(state.status==='CREDIT_EXHAUSTED'||state.remaining_credits===0){reasons.push({provider:raw,reason:'CAPACITY_EXHAUSTED'});continue;}
    if(state.status==='AUTH_ERROR'||state.status==='DISABLED'){reasons.push({provider:raw,reason:'AUTH_ERROR'});continue;}
    if(state.status==='RATE_LIMITED'){reasons.push({provider:raw,reason:'RATE_LIMITED',retry_after_at:state.retry_after_at||null});continue;}
    if(state.status!=='AVAILABLE'){reasons.push({provider:raw,reason:'ACCOUNT_CAPACITY_UNCONFIRMED'});continue;}
    return {provider:raw,reason:reasons.length?'EXPLICIT_ORDER_NEXT_AVAILABLE':'EXPLICIT_ORDER_FIRST_AVAILABLE',skipped:reasons};
  }
  return {provider:null,reason:reasons.some(row=>row.reason==='CAPACITY_EXHAUSTED')?'PAUSED_PROVIDER_CAPACITY':'PAUSED_PROVIDER_UNAVAILABLE',skipped:reasons};
}

export class CurrentCapacityRouter {
  constructor({config={},getOrder,getStates,providerOverrides={}}={}){Object.assign(this,{config,getOrder,getStates,providerOverrides});}
  async select({exclude=[]}={}){return selectCurrentCapacityProvider({order:await this.getOrder(),config:this.config,states:await this.getStates(),exclude});}
  provider(selection){return createConfiguredSearchProvider({...this.config,provider:selection.provider},this.providerOverrides);}
}
