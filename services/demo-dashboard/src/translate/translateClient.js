// Server-side translation (B7). Order: self-hosted LibreTranslate (compose service `translate`, URL from
// the API keys page or LIBRETRANSLATE_URL) -> the low-cost model when one is configured -> a clear
// TRANSLATE_UNAVAILABLE error. The text is sent only to these two services.
import {llmBaseUrl} from '../credentials/providerTester.js';

export const LANGUAGES=Object.freeze(['en','zh','es','pt','ar','fr','de','it','tr']);
export const LANGUAGE_NAMES=Object.freeze({en:'English',zh:'Simplified Chinese',es:'Spanish',pt:'Portuguese',ar:'Arabic',fr:'French',de:'German',it:'Italian',tr:'Turkish'});
export const MAX_TEXT_CHARS=5000;
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const trimSlash=value=>String(value||'').replace(/\/+$/,'');

export function validateTranslateRequest({text,source='auto',target}={}){
  const value=typeof text==='string'?text:'';
  if(!value.trim())throw fail('TRANSLATE_TEXT_REQUIRED','Enter the text to translate');
  if(value.length>MAX_TEXT_CHARS)throw fail('TRANSLATE_TEXT_TOO_LONG',`Text is longer than ${MAX_TEXT_CHARS} characters`,413);
  const from=String(source||'auto').toLowerCase();const to=String(target||'').toLowerCase();
  if(from!=='auto'&&!LANGUAGES.includes(from))throw fail('TRANSLATE_LANGUAGE_UNSUPPORTED','Source language is not supported');
  if(!LANGUAGES.includes(to))throw fail('TRANSLATE_LANGUAGE_UNSUPPORTED','Target language is not supported');
  if(from===to)throw fail('TRANSLATE_SAME_LANGUAGE','Source and target language are the same');
  return{text:value,source:from,target:to};
}

export function createTranslateClient({credentials,fetchImpl=globalThis.fetch,env=process.env,timeoutMs=Number(env.TRANSLATE_TIMEOUT_MS||20000)}={}){
  // LibreTranslate 1.9 names simplified Chinese zh-Hans.
  const code=lang=>lang==='zh'?String(env.LIBRETRANSLATE_ZH_CODE||'zh-Hans'):lang;
  const call=async(url,init)=>{
    let response;
    try{response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
    catch(error){throw fail(error?.name==='TimeoutError'?'TRANSLATE_TIMEOUT':'TRANSLATE_UNREACHABLE','Translation service did not answer',503);}
    let json=null;try{json=await response.json();}catch{json=null;}
    if(!response.ok)throw fail(response.status===429?'TRANSLATE_RATE_LIMITED':'TRANSLATE_PROVIDER_ERROR','Translation service returned an error',response.status===429?429:502);
    return json;
  };

  async function libre(values,{text,source,target}){
    const json=await call(`${trimSlash(values.base_url)}/translate`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({q:text,source:source==='auto'?'auto':code(source),target:code(target),format:'text',...(values.api_key?{api_key:values.api_key}:{})})});
    if(typeof json?.translatedText!=='string')throw fail('TRANSLATE_PROVIDER_ERROR','Translation service returned no text',502);
    return{text:json.translatedText,provider:'libretranslate',detected_source:json.detectedLanguage?.language||null};
  }

  async function llm(values,{text,source,target}){
    const base=llmBaseUrl(values);
    if(!base)throw fail('TRANSLATE_UNAVAILABLE','Translation is not set up',503);
    const instruction=`Translate the user's business email text ${source==='auto'?'':`from ${LANGUAGE_NAMES[source]} `}into ${LANGUAGE_NAMES[target]}. Keep names, numbers, links, line breaks and the professional tone. Return only the translation.`;
    if(String(values.provider||'').toLowerCase()==='anthropic'){
      const json=await call(`${base}/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':values.api_key,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:values.model,max_tokens:4096,system:instruction,messages:[{role:'user',content:text}]})});
      const out=(json?.content||[]).filter(part=>part?.type==='text').map(part=>part.text).join('');
      if(!out)throw fail('TRANSLATE_PROVIDER_ERROR','Translation service returned no text',502);
      return{text:out,provider:'llm',detected_source:null};
    }
    const json=await call(`${base}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${values.api_key}`},
      body:JSON.stringify({model:values.model,temperature:0,messages:[{role:'system',content:instruction},{role:'user',content:text}]})});
    const out=json?.choices?.[0]?.message?.content;
    if(typeof out!=='string'||!out)throw fail('TRANSLATE_PROVIDER_ERROR','Translation service returned no text',502);
    return{text:out,provider:'llm',detected_source:null};
  }

  return{
    async translate(request,{merchantId=null}={}){
      const clean=validateTranslateRequest(request);
      const service=await credentials.resolveProvider({merchantId:null,provider:'translate'});
      let lastError=null;
      if(service.configured){
        try{return await libre(service.values,clean);}catch(error){lastError=error;}
      }
      const model=await credentials.resolveProvider({merchantId,provider:'llm'});
      if(model.configured)return {...await llm(model.values,clean),merchant_billed:model.merchant_billed};
      if(lastError)throw lastError;
      throw fail('TRANSLATE_UNAVAILABLE','Translation is not set up',503);
    }
  };
}
