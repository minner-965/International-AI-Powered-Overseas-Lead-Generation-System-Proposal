import {BraveSearchProvider} from './BraveSearchProvider.js';
import {TavilySearchProvider} from './TavilySearchProvider.js';
import {DataForSeoSearchProvider} from './DataForSeoSearchProvider.js';
import {ExaSearchProvider} from './ExaSearchProvider.js';

export const SEARCH_PURPOSES=Object.freeze(['COMPANY_DISCOVERY','COMPANY_VERIFICATION','CATEGORY_EVIDENCE','CONTACT_DISCOVERY','OFFICIAL_CONTACT_VERIFICATION','SHADOW_BENCHMARK']);
export function resolveSearchRoute(config={},purpose){
  if(!SEARCH_PURPOSES.includes(purpose))throw Object.assign(new Error('Unknown search purpose'),{code:'INVALID_SEARCH_PURPOSE'});
  if(purpose==='SHADOW_BENCHMARK')return {purpose,automatic:false,routes:[{...config,provider:'brave'},{...config,provider:'tavily',tavilySearchDepth:'basic'}]};
  if(String(config.provider||'').toLowerCase()==='exa')return {...config,purpose,provider:'exa'};
  // Explicit rollout switch preserves the running legacy configuration until credentials and storage rights are confirmed.
  if(config.dualSearchEnabled!==true)return {...config,purpose};
  return {...config,purpose,provider:purpose==='COMPANY_DISCOVERY'?'brave':'tavily',tavilySearchDepth:purpose==='COMPANY_DISCOVERY'?config.tavilySearchDepth:'advanced'};
}
export function createConfiguredSearchProvider(config={},overrides={}){
  if(overrides.provider)return overrides.provider;
  const common={timeoutMs:config.timeoutMs,fetchImpl:overrides.fetchImpl};
  switch(String(config.provider||'brave').toLowerCase()){
    case 'brave':return new BraveSearchProvider({...common,apiKey:config.braveApiKey});
    case 'tavily':return new TavilySearchProvider({...common,apiKey:config.tavilyApiKey,endpoint:config.tavilyEndpoint,searchDepth:config.tavilySearchDepth});
    case 'dataforseo':return new DataForSeoSearchProvider({...common,login:config.dataForSeoLogin,password:config.dataForSeoPassword});
    case 'exa':return new ExaSearchProvider({...common,apiKey:config.exaApiKey,endpoint:config.exaEndpoint});
    default:throw Object.assign(new Error('Unsupported search provider'),{code:'INVALID_SEARCH_PROVIDER'});
  }
}
export function createPurposeSearchProvider(config,purpose,overrides={}){
  const route=resolveSearchRoute(config,purpose);
  if(route.routes)throw Object.assign(new Error('Shadow search requires explicit benchmark execution'),{code:'SHADOW_NOT_ENABLED'});
  return createConfiguredSearchProvider(route,overrides);
}
export class SearchProviderRouter{
  constructor({config={},tavilyAccountState=null,exaAccountState=null}={}){Object.assign(this,{config,tavilyAccountState,exaAccountState});}
  route(purpose){return resolveSearchRoute(this.config,purpose);}
  forPurpose(purpose){
    this.route(purpose);
    return {getState:()=>this.getState(purpose),ensureCanCreate:()=>this.ensureCanCreate(purpose),
      refreshUsage:()=>{const p=this.route(purpose).provider,s=p==='tavily'?this.tavilyAccountState:p==='exa'?this.exaAccountState:null;return s?.refreshUsage?s.refreshUsage():this.getState(purpose)}};
  }
  async getState(purpose='COMPANY_DISCOVERY'){
    const route=this.route(purpose);
    if(route.provider==='tavily')return this.tavilyAccountState?this.tavilyAccountState.getState():{provider_code:'TAVILY',status:this.config.tavilyApiKey?'UNKNOWN':'AUTH_ERROR'};
    if(route.provider==='exa')return this.exaAccountState?this.exaAccountState.getState():{provider_code:'EXA',status:this.config.exaEnabled&&this.config.exaApiKey?'AVAILABLE':'AUTH_ERROR',remaining_credits:null,checked_at:null};
    if(route.provider==='brave')return {provider_code:'BRAVE',status:!this.config.braveApiKey?'AUTH_ERROR':!this.config.storageRightsConfirmed?'STORAGE_RIGHTS_REQUIRED':'UNKNOWN',remaining_credits:null,checked_at:null};
    return{provider_code:String(route.provider||'').toUpperCase(),status:'UNKNOWN'};
  }
  async ensureCanCreate(purpose='COMPANY_DISCOVERY'){
    const route=this.route(purpose);
    const accountState=route.provider==='tavily'?this.tavilyAccountState:route.provider==='exa'?this.exaAccountState:null;
    if(accountState?.ensureCanCreate)return accountState.ensureCanCreate();
    const state=await this.getState(purpose);
    if(['AUTH_ERROR','STORAGE_RIGHTS_REQUIRED'].includes(state.status))throw Object.assign(new Error('Search provider configuration needs review'),{code:state.status==='STORAGE_RIGHTS_REQUIRED'?'STORAGE_RIGHTS_NOT_CONFIRMED':'SEARCH_PROVIDER_CONFIGURATION_BLOCKED',status:503,created:false});
    return state;
  }
}
