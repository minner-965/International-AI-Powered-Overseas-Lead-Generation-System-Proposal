// Low-cost model client (optimization plan E1). Plain fetch adapters, chosen over official SDKs in
// docs/REUSE_CANDIDATE_REGISTRY.md (three providers behind one small contract, no new dependency):
//   anthropic          POST {base}/messages            (Claude Haiku; structured output via output_config.format)
//   openai_compatible  POST {base}/chat/completions    (OpenAI, DeepSeek, Qwen/DashScope compatible mode, others)
//   ollama             POST {base}/chat/completions    (local Ollama, OpenAI-compatible endpoint, no key)
// Keys come only from the credential resolver (src/credentials). A merchant's own key is used for that
// merchant's work (merchant pays); SIM's key is used for a merchant only when the administrator allows
// it. Local or private addresses are refused for merchant keys at save time and again here.
import {privateHost} from '../credentials/credentialResolver.js';
import {llmBaseUrl} from '../credentials/providerTester.js';
import {providerSchema} from './jsonSchema.js';

export const DEFAULT_MODELS=Object.freeze({anthropic:'claude-haiku-5-5',deepseek:'deepseek-chat',qwen:'qwen-flash',dashscope:'qwen-flash',openai:'gpt-5-nano',ollama:'qwen2.5:7b'});
export const DEFAULT_OLLAMA_URL='http://ollama:11434/v1';
export const PROVIDER_CHOICES=Object.freeze(['anthropic','deepseek','qwen','openai','openai_compatible','ollama']);
export const kindOf=provider=>{
  const name=String(provider||'').toLowerCase();
  return name==='anthropic'?'anthropic':name==='ollama'?'ollama':'openai_compatible';
};
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});

/**
 * Resolve which model account a piece of work uses.
 * Returns {ok:true, provider, kind, base_url, model, api_key, source, billed_to, merchant_billed}
 * or {ok:false, code}. Never logs or returns the key outside this object.
 */
export async function resolveModelConfig({credentials,merchantId=null,simKeyAllowed=false}){
  if(!credentials)return{ok:false,code:'LLM_CREDENTIALS_UNAVAILABLE'};
  if(merchantId){
    const own=await credentials.resolveProvider({merchantId,provider:'llm'});
    if(own?.merchant_billed){
      const config=configFrom(own.values,{owner:'MERCHANT'});
      if(!config.ok)return config;
      return{...config,source:'MERCHANT',billed_to:'MERCHANT',merchant_billed:true};
    }
    if(!simKeyAllowed)return{ok:false,code:'LLM_MERCHANT_KEY_REQUIRED'};
  }
  const sim=await credentials.resolveProvider({merchantId:null,provider:'llm'});
  const config=configFrom(sim?.values||{},{owner:'SIM'});
  if(!config.ok)return config;
  return{...config,source:sim.source==='NONE'?'ENV':sim.source,billed_to:config.kind==='ollama'?'LOCAL':'SIM',merchant_billed:false};
}

function configFrom(values,{owner}){
  const provider=String(values.provider||'').trim().toLowerCase();
  if(!provider)return{ok:false,code:'LLM_NOT_CONFIGURED'};
  const kind=kindOf(provider);
  if(owner==='MERCHANT'&&kind==='ollama')return{ok:false,code:'LLM_LOCAL_MODEL_SIM_ONLY'};
  const base=kind==='ollama'?String(values.base_url||DEFAULT_OLLAMA_URL).replace(/\/+$/,''):llmBaseUrl(values);
  if(!base)return{ok:false,code:'LLM_BASE_URL_REQUIRED'};
  let url;try{url=new URL(base);}catch{return{ok:false,code:'LLM_BASE_URL_INVALID'};}
  if(owner==='MERCHANT'&&(url.protocol!=='https:'||privateHost(url.hostname)))return{ok:false,code:'LLM_BASE_URL_NOT_ALLOWED'};
  const apiKey=String(values.api_key||'').trim();
  if(kind!=='ollama'&&!apiKey)return{ok:false,code:'LLM_NOT_CONFIGURED'};
  const model=String(values.model||DEFAULT_MODELS[provider]||'').trim();
  if(!model)return{ok:false,code:'LLM_MODEL_REQUIRED'};
  return{ok:true,provider,kind,base_url:base,model,api_key:apiKey};
}

/** Build the HTTP request for one completion. Exported for tests. */
export function buildHttpRequest(config,{system,user,schema,schemaName='output',maxTokens=2000}){
  if(config.kind==='anthropic'){
    const body={model:config.model,max_tokens:maxTokens,system,messages:[{role:'user',content:user}],
      output_config:{format:{type:'json_schema',schema:providerSchema(schema)}}};
    // Claude 5.x models take an effort level; extraction work runs at low effort.
    if(/^claude-[a-z]+-5/.test(config.model))body.output_config.effort='low';
    return{url:`${config.base_url}/messages`,init:{method:'POST',headers:{'content-type':'application/json','x-api-key':config.api_key,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)}};
  }
  const body={model:config.model,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}],
    // Strict JSON-schema output on OpenAI itself; JSON mode on DeepSeek, Qwen, Ollama and other
    // compatible services (the full schema is checked on our side either way).
    response_format:config.provider==='openai'&&/^https:\/\/api\.openai\.com\//.test(`${config.base_url}/`)?{type:'json_schema',json_schema:{name:schemaName.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64),schema:providerSchema(schema),strict:false}}:{type:'json_object'}};
  if(config.kind==='ollama')body.stream=false;
  const headers={'content-type':'application/json'};
  if(config.api_key)headers.authorization=`Bearer ${config.api_key}`;
  return{url:`${config.base_url}/chat/completions`,init:{method:'POST',headers,body:JSON.stringify(body)}};
}

/** {text, input_tokens, output_tokens, refused} from a provider answer. Exported for tests. */
export function parseHttpResponse(config,json){
  if(config.kind==='anthropic'){
    const text=(json?.content||[]).filter(block=>block?.type==='text').map(block=>block.text).join('');
    return{text,input_tokens:json?.usage?.input_tokens??null,output_tokens:json?.usage?.output_tokens??null,refused:json?.stop_reason==='refusal',truncated:json?.stop_reason==='max_tokens'};
  }
  const choice=json?.choices?.[0];
  // Reasoning models served locally may prefix their answer with a <think> block.
  const text=String(choice?.message?.content??'').replace(/^\s*<think>[\s\S]*?<\/think>\s*/i,'');
  return{text,input_tokens:json?.usage?.prompt_tokens??null,output_tokens:json?.usage?.completion_tokens??null,refused:choice?.finish_reason==='content_filter',truncated:choice?.finish_reason==='length'};
}

const statusCode=status=>status===401||status===403?'KEY_REJECTED':status===402?'NO_CREDIT':status===404?'ENDPOINT_NOT_FOUND':status===429?'RATE_LIMITED':`PROVIDER_HTTP_${status}`;
const retryableStatus=status=>status===408||status===409||status===429||status>=500;

/**
 * createLlmClient().complete(config, prompt) -> {ok, status, code, text, input_tokens, output_tokens, attempts, latency_ms}.
 * Retries only transport problems (timeout, network, 408/409/429/5xx). An answer that fails validation
 * is never retried to get "a different answer" (SERVER_WORKFLOW_EXECUTION_RULES).
 */
export function createLlmClient({fetchImpl=globalThis.fetch,timeoutMs=45_000,retries=2,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}){
  return{
    async complete(config,prompt){
      const request=buildHttpRequest(config,prompt);
      const started=now();let attempts=0;let last={status:'UNREACHABLE',code:'UNREACHABLE'};
      while(attempts<=retries){
        attempts+=1;
        let response;
        try{response=await fetchImpl(request.url,{...request.init,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
        catch(error){
          last=error?.name==='TimeoutError'||error?.name==='AbortError'?{status:'TIMEOUT',code:'TIMEOUT'}:{status:'UNREACHABLE',code:'UNREACHABLE'};
          if(attempts<=retries){await sleep(backoff(attempts));continue;}
          break;
        }
        let json=null;try{json=await response.json();}catch{json=null;}
        if(!response.ok){
          last={status:'HTTP_ERROR',code:statusCode(response.status)};
          if(retryableStatus(response.status)&&attempts<=retries){
            const after=Number(response.headers?.get?.('retry-after'));
            await sleep(Number.isFinite(after)&&after>0?Math.min(after*1000,10_000):backoff(attempts));continue;
          }
          break;
        }
        const parsed=parseHttpResponse(config,json);
        const base={attempts,latency_ms:Math.max(0,now()-started),input_tokens:parsed.input_tokens,output_tokens:parsed.output_tokens};
        if(parsed.refused)return{ok:false,status:'REFUSED',code:'PROVIDER_REFUSED',text:'',...base};
        if(parsed.truncated)return{ok:false,status:'INVALID_OUTPUT',code:'OUTPUT_TRUNCATED',text:parsed.text,...base};
        return{ok:true,status:'OK',code:null,text:parsed.text,...base};
      }
      return{ok:false,...last,text:'',attempts,latency_ms:Math.max(0,now()-started),input_tokens:null,output_tokens:null};
    }
  };
}
const backoff=attempt=>Math.min(8000,500*2**(attempt-1));
export {fail as llmFail};
