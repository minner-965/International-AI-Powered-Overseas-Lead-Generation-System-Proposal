import {createConfiguredSearchProvider} from './SearchProviderRouter.js';

const configured=(name,config)=>name==='tavily'?Boolean(config.tavilyApiKey):name==='brave'?Boolean(config.braveApiKey)&&config.storageRightsConfirmed===true:name==='exa'?config.exaEnabled===true&&Boolean(config.exaApiKey):false;

// The explicit order is also the spending allowlist. Credentials alone never
// authorize a paid fallback; unsupported account-capacity adapters stay blocked.
export function selectCurrentCapacityProvider({order=[],config={},states={}}={}){
  const reasons=[];
  for(const raw of [...new Set(order.map(value=>String(value).toLowerCase()))]){
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
  async select(){return selectCurrentCapacityProvider({order:await this.getOrder(),config:this.config,states:await this.getStates()});}
  provider(selection){return createConfiguredSearchProvider({...this.config,provider:selection.provider},this.providerOverrides);}
}
