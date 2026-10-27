// B9 wiring: which provider keys a search or Hunter request uses.
//  - SIM's own keys: searchConfigFromEnv() reads them live from credentialStore.liveEnv(), so a key saved
//    on the API keys page applies without a restart (environment variables stay the fallback).
//  - A research job created by a merchant uses the merchant's own key for every provider the merchant
//    stored completely (merchant_billed). Such requests skip SIM's spend policy and monthly budget and
//    are recorded with billed_to MERCHANT; they still count toward the merchant's own search quota.

// Stored provider fields -> search configuration keys used by SearchProviderRouter.
export const SEARCH_CONFIG_FIELDS=Object.freeze({
  tavily:Object.freeze({api_key:'tavilyApiKey'}),
  exa:Object.freeze({api_key:'exaApiKey'}),
  brave:Object.freeze({api_key:'braveApiKey'}),
  dataforseo:Object.freeze({login:'dataForSeoLogin',password:'dataForSeoPassword'})
});

/** Getters for the SIM key fields of the search configuration (evaluated on every read). */
export function liveSearchKeyGetters(env){
  return{
    exaApiKey:()=>env.EXA_API_KEY||'',
    braveApiKey:()=>env.BRAVE_SEARCH_API_KEY||'',
    dataForSeoLogin:()=>env.DATAFORSEO_LOGIN||'',
    dataForSeoPassword:()=>env.DATAFORSEO_PASSWORD||'',
    tavilyApiKey:()=>env.TAVILY_API_KEY||''
  };
}

/** A frozen configuration whose provider key fields follow `env` (a live env proxy) on every read. */
export function withLiveSearchKeys(base,env){
  const out={...base};
  for(const [key,read] of Object.entries(liveSearchKeyGetters(env)))
    Object.defineProperty(out,key,{get:read,enumerable:true,configurable:false});
  return Object.freeze(out);
}

/** {merchant_id, config, merchant_billed:[provider]} for the merchant's own complete search keys, or null. */
export async function merchantSearchCredentials(credentials,merchantId){
  if(!credentials||!merchantId)return null;
  const config={};const billed=[];
  for(const [provider,fields] of Object.entries(SEARCH_CONFIG_FIELDS)){
    const resolved=await credentials.resolveProvider({merchantId,provider});
    if(!resolved?.merchant_billed)continue;
    for(const [field,key] of Object.entries(fields))config[key]=resolved.values[field]||'';
    // The merchant chose to use its own Exa account; SIM's EXA_ENABLED switch is about SIM's account.
    if(provider==='exa')config.exaEnabled=true;
    billed.push(provider);
  }
  return billed.length?{merchant_id:merchantId,config,merchant_billed:billed}:null;
}

async function jobMerchant(pool,jobId){
  if(!jobId)return null;
  return (await pool.query('SELECT merchant_id FROM leadgen.research_jobs WHERE id=$1',[jobId])).rows[0]?.merchant_id||null;
}

/** For FrozenSearchPlanExecutor({jobCredentials}): the job owner's own search keys, or null (SIM keys). */
export function createJobSearchCredentials({pool,credentials}){
  return async jobId=>merchantSearchCredentials(credentials,await jobMerchant(pool,jobId));
}

/** For HunterProvider({resolveKey}): the job merchant's own Hunter key, or null (SIM key). */
export function createHunterKeyResolver({pool,credentials}){
  return async({researchJobId}={})=>{
    const merchantId=await jobMerchant(pool,researchJobId);
    if(!merchantId)return null;
    const resolved=await credentials.resolveProvider({merchantId,provider:'hunter'});
    return resolved?.merchant_billed&&resolved.values.api_key?{apiKey:resolved.values.api_key,merchantBilled:true,merchantId}:null;
  };
}
