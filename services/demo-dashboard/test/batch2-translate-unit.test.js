// Batch 2 B7: translate client (LibreTranslate first, low-cost model second, clear error otherwise) and
// POST /api/translate auth, limits and rate limiting. LibreTranslate and the model are mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createTranslateClient,validateTranslateRequest,MAX_TEXT_CHARS} from '../src/translate/translateClient.js';
import {createTranslateRouter,createRateLimiter} from '../src/translate/router.js';
import {translateErrorText,widgetMarkup,TRANSLATE_LANGUAGES} from '../public/ui/v4/translate-widget.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const credentialsWith=map=>({async resolveProvider({merchantId,provider}){
  const entry=map[`${merchantId||'SIM'}:${provider}`]||map[`SIM:${provider}`];
  return entry?{configured:true,values:entry,merchant_billed:Boolean(merchantId&&map[`${merchantId}:${provider}`])}:{configured:false,values:{},merchant_billed:false};
}});

test('B7 request validation: languages, same language and the 5000 character limit',()=>{
  assert.deepEqual(validateTranslateRequest({text:'Hola',target:'EN'}),{text:'Hola',source:'auto',target:'en'});
  assert.throws(()=>validateTranslateRequest({text:' ',target:'es'}),{code:'TRANSLATE_TEXT_REQUIRED'});
  assert.throws(()=>validateTranslateRequest({text:'x'.repeat(MAX_TEXT_CHARS+1),target:'es'}),{code:'TRANSLATE_TEXT_TOO_LONG',status:413});
  assert.throws(()=>validateTranslateRequest({text:'x',target:'ja'}),{code:'TRANSLATE_LANGUAGE_UNSUPPORTED'});
  assert.throws(()=>validateTranslateRequest({text:'x',source:'es',target:'es'}),{code:'TRANSLATE_SAME_LANGUAGE'});
});

test('B7 client: LibreTranslate request shape (zh -> zh-Hans), then model fallback, then TRANSLATE_UNAVAILABLE',async()=>{
  const calls=[];
  const libreUp=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return json({translatedText:'Hola',detectedLanguage:{language:'en',confidence:90}});};
  const client=createTranslateClient({credentials:credentialsWith({'SIM:translate':{base_url:'http://translate:5000/',api_key:''}}),fetchImpl:libreUp,env:{}});
  const out=await client.translate({text:'你好',source:'zh',target:'es'});
  assert.deepEqual(out,{text:'Hola',provider:'libretranslate',detected_source:'en'});
  assert.equal(calls[0].url,'http://translate:5000/translate');
  assert.deepEqual(calls[0].body,{q:'你好',source:'zh-Hans',target:'es',format:'text'});

  // LibreTranslate down -> the merchant's own model key answers (OpenAI-compatible).
  const seen=[];
  const fallback=async(url,init)=>{seen.push({url,init});if(url.includes('translate:5000'))throw new TypeError('fetch failed');
    return json({choices:[{message:{content:'Olá'}}]});};
  const merchant='11111111-2222-4333-8444-555555555555';
  const both=createTranslateClient({credentials:credentialsWith({'SIM:translate':{base_url:'http://translate:5000'},[`${merchant}:llm`]:{provider:'deepseek',model:'deepseek-chat',api_key:'m-key-123456'}}),fetchImpl:fallback,env:{}});
  const viaModel=await both.translate({text:'Hello',target:'pt'},{merchantId:merchant});
  assert.equal(viaModel.text,'Olá');assert.equal(viaModel.provider,'llm');assert.equal(viaModel.merchant_billed,true);
  assert.equal(seen[1].url,'https://api.deepseek.com/chat/completions');
  assert.equal(seen[1].init.headers.authorization,'Bearer m-key-123456');

  // Nothing configured -> clear 503.
  const none=createTranslateClient({credentials:credentialsWith({}),fetchImpl:async()=>{throw new Error('must not be called');},env:{}});
  await assert.rejects(none.translate({text:'Hello',target:'es'}),{code:'TRANSLATE_UNAVAILABLE',status:503});
  // LibreTranslate down and no model -> the LibreTranslate error.
  const down=createTranslateClient({credentials:credentialsWith({'SIM:translate':{base_url:'http://translate:5000'}}),fetchImpl:async()=>{throw new TypeError('fetch failed');},env:{}});
  await assert.rejects(down.translate({text:'Hello',target:'es'}),{code:'TRANSLATE_UNREACHABLE',status:503});
});

async function serve(router,user){
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{const header=req.get('x-test-user');if(header)req.workspaceUser=JSON.parse(header);next();});
  app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body,who=user)=>fetch(`${base}/api/translate`,{method:'POST',headers:{'content-type':'application/json',...(who?{'x-test-user':JSON.stringify(who)}:{})},body:JSON.stringify(body)});
  return{post,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('B7 router: sign-in required, merchant id passed through, limits and rate limit enforced',async()=>{
  const seen=[];
  const client={async translate(request,options){seen.push({request,options});validateTranslateRequest(request);return{text:`[${request.target}] ${request.text}`,provider:'libretranslate',detected_source:'en'};}};
  const merchant={id:'u1',role:'MERCHANT',merchant_id:'11111111-2222-4333-8444-555555555555',email:'m@example.test'};
  const admin={id:'a1',role:'ADMIN',merchant_id:null,email:'simon@example.test'};
  const {post,close}=await serve(createTranslateRouter({client,limiter:createRateLimiter({max:3,windowMs:60_000})}));
  try{
    assert.equal((await post({text:'Hi',target:'es'},null)).status,401);
    const ok=await post({text:'Hi',target:'es'},merchant);
    assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{text:'[es] Hi',provider:'libretranslate',detected_source:'en'});
    assert.equal(seen[0].options.merchantId,merchant.merchant_id);
    const tooLong=await post({text:'x'.repeat(5001),target:'es'},admin);
    assert.equal(tooLong.status,413);assert.equal((await tooLong.json()).code,'TRANSLATE_TEXT_TOO_LONG');
    assert.equal(seen.at(-1).options.merchantId,null);
    assert.equal((await post({text:'Hi',target:'xx'},admin)).status,400);
    // Merchant: 1 used of 3; two more pass, the fourth is refused.
    assert.equal((await post({text:'a',target:'es'},merchant)).status,200);
    assert.equal((await post({text:'b',target:'es'},merchant)).status,200);
    const limited=await post({text:'c',target:'es'},merchant);
    assert.equal(limited.status,429);assert.equal((await limited.json()).code,'TRANSLATE_RATE_LIMITED');
  }finally{await close();}
  const unavailable=await serve(createTranslateRouter({client:{async translate(){throw Object.assign(new Error('Translation is not set up'),{code:'TRANSLATE_UNAVAILABLE',status:503});}}}));
  try{const response=await unavailable.post({text:'Hi',target:'es'},{id:'a1',role:'ADMIN'});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'TRANSLATE_UNAVAILABLE');}
  finally{await unavailable.close();}
});

test('B7 widget: language choices, bilingual buttons, plain-word errors',()=>{
  assert.deepEqual(TRANSLATE_LANGUAGES.map(([key])=>key).sort(),['ar','de','en','es','fr','it','pt','tr','zh']);
  const markup=widgetMarkup({id:'t1',target:'pt',targets:[{label:['正文','Body']},{label:['主题','Subject']}]});
  assert.match(markup,/翻译<\/span><span lang="en">Translate/);
  assert.match(markup,/使用译文<\/span><span lang="en">Use translation/);
  assert.match(markup,/value="pt" selected/);
  assert.match(markup,/data-translate-field/);
  assert.match(markup,/data-tip=/);
  assert.match(translateErrorText({code:'TRANSLATE_UNAVAILABLE'})[0],/暂未开通/);
  assert.match(translateErrorText({status:429})[1],/Too many/);
});
