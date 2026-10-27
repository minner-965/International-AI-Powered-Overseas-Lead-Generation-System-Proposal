// "Test" button per provider (B9): one cheap call that proves the key is accepted. Account / usage
// endpoints are used where the provider has one (no credit spent); Exa and Brave have none, so a
// single one-result search is made. Returns {ok, code, detail?}; never echoes the key.
const DEFAULT_TIMEOUT_MS=10_000;
const trimSlash=value=>String(value||'').replace(/\/+$/,'');
const LLM_BASES=Object.freeze({openai:'https://api.openai.com/v1',deepseek:'https://api.deepseek.com',anthropic:'https://api.anthropic.com/v1',
  qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1',dashscope:'https://dashscope.aliyuncs.com/compatible-mode/v1',moonshot:'https://api.moonshot.cn/v1',
  openrouter:'https://openrouter.ai/api/v1',groq:'https://api.groq.com/openai/v1',mistral:'https://api.mistral.ai/v1'});
export const llmBaseUrl=values=>trimSlash(values.base_url||LLM_BASES[String(values.provider||'').toLowerCase()]||'');

function statusCode(status){
  if(status===401||status===403)return'KEY_REJECTED';
  if(status===402)return'NO_CREDIT';
  if(status===429)return'RATE_LIMITED';
  if(status===404)return'ENDPOINT_NOT_FOUND';
  return`PROVIDER_HTTP_${status}`;
}

/** Build the request for a provider test. Exported for tests. */
export function testRequest(provider,values,env={}){
  switch(provider){
    case 'tavily':return{url:'https://api.tavily.com/usage',init:{headers:{accept:'application/json',authorization:`Bearer ${values.api_key}`}}};
    case 'exa':return{url:`${trimSlash(env.EXA_BASE_URL||'https://api.exa.ai')}/search`,init:{method:'POST',headers:{'content-type':'application/json','x-api-key':values.api_key},body:JSON.stringify({query:'wholesale apparel distributor',numResults:1})}};
    case 'brave':return{url:'https://api.search.brave.com/res/v1/web/search?q=wholesale&count=1',init:{headers:{accept:'application/json','x-subscription-token':values.api_key}}};
    case 'dataforseo':return{url:'https://api.dataforseo.com/v3/appendix/user_data',init:{headers:{accept:'application/json',authorization:`Basic ${Buffer.from(`${values.login}:${values.password}`).toString('base64')}`}},check:json=>json?.status_code===20000};
    case 'hunter':return{url:'https://api.hunter.io/v2/account',init:{headers:{accept:'application/json','x-api-key':values.api_key}}};
    case 'feishu':return{url:`${trimSlash(env.FEISHU_BASE_URL||'https://open.feishu.cn')}/open-apis/auth/v3/tenant_access_token/internal`,
      init:{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({app_id:values.app_id,app_secret:values.app_secret})},check:json=>json?.code===0};
    case 'translate':return{url:`${trimSlash(values.base_url)}/languages`,init:{headers:{accept:'application/json'}},check:json=>Array.isArray(json)};
    case 'llm':{
      const base=llmBaseUrl(values);
      if(!base)return null;
      if(String(values.provider||'').toLowerCase()==='anthropic')
        return{url:`${base}/models`,init:{headers:{'x-api-key':values.api_key,'anthropic-version':'2023-06-01'}}};
      return{url:`${base}/models`,init:{headers:{accept:'application/json',authorization:`Bearer ${values.api_key}`}}};
    }
    default:return null;
  }
}

export function createProviderTester({fetchImpl=globalThis.fetch,timeoutMs=DEFAULT_TIMEOUT_MS,env=process.env}={}){
  return async function testProvider(provider,resolved){
    if(!resolved?.configured)return{ok:false,code:'NOT_CONFIGURED'};
    const request=testRequest(provider,resolved.values,env);
    if(!request)return{ok:false,code:'TEST_NOT_AVAILABLE'};
    let response;
    try{response=await fetchImpl(request.url,{...request.init,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
    catch(error){return{ok:false,code:error?.name==='TimeoutError'?'TIMEOUT':'UNREACHABLE'};}
    let json=null;try{json=await response.json();}catch{json=null;}
    if(!response.ok)return{ok:false,code:statusCode(response.status)};
    if(request.check&&!request.check(json))return{ok:false,code:provider==='feishu'?`FEISHU_${Number(json?.code)||'REJECTED'}`:'UNEXPECTED_RESPONSE'};
    return{ok:true,code:'OK'};
  };
}
