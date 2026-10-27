// Batch 2 B9: provider credential encryption, validation, resolver precedence, provider test button
// and the API keys page markup. No database and no network: fetch is an in-process double.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSecretBox} from '../src/merchant/secretBox.js';
import {CredentialStore,validateValue,last4Of,providerUsage} from '../src/credentials/credentialResolver.js';
import {PROVIDERS,MERCHANT_PROVIDER_KEYS} from '../src/credentials/providerCatalog.js';
import {createProviderTester,testRequest} from '../src/credentials/providerTester.js';
import {pageMarkup,sourcePill,testText} from '../public/ui/v4/api-keys.js';

const KEY=crypto.randomBytes(32).toString('hex');
const MERCHANT='11111111-2222-4333-8444-555555555555';

// Store whose database rows are a plain object: {SIM:{provider:{field:value}}, <merchant>:{...}}.
class MemoryStore extends CredentialStore{
  constructor(rows,env){super({pool:null,secretKey:KEY,env});this.rows=rows;}
  async values(merchant){return this.rows[merchant||'SIM']||{};}
}

test('B9 encryption: AES-256-GCM round trip, bound to owner/provider/field, ciphertext never contains the key',()=>{
  const box=createSecretBox(KEY);
  const secret='tvly-SECRET-abcdef123456';
  const aad='provider-credential:SIM:-:tavily:api_key';
  const token=box.encrypt(secret,aad);
  assert.match(token,/^v1:/);
  assert.ok(!token.includes(secret));
  assert.equal(box.decrypt(token,aad),secret);
  // A ciphertext copied to another owner or field does not decrypt.
  assert.throws(()=>box.decrypt(token,`provider-credential:MERCHANT:${MERCHANT}:tavily:api_key`),/cannot be decrypted/);
  assert.equal(last4Of(secret),'3456');
  assert.equal(last4Of('short'),null);
});

test('B9 validation: unknown fields, control characters and merchant URLs to private hosts are refused',()=>{
  assert.throws(()=>validateValue({provider:'tavily',field:'password',value:'x',ownerScope:'SIM'}),{code:'CREDENTIAL_FIELD_UNKNOWN'});
  assert.throws(()=>validateValue({provider:'tavily',field:'api_key',value:'a\nb',ownerScope:'SIM'}),{code:'CREDENTIAL_VALUE_INVALID'});
  assert.equal(validateValue({provider:'translate',field:'base_url',value:'http://translate:5000',ownerScope:'SIM'}),'http://translate:5000');
  for(const url of ['http://api.example.com','https://translate:5000','https://127.0.0.1/v1','https://10.0.0.5','https://192.168.1.2','https://localhost/v1','https://[::1]/v1','https://user:pw@api.example.com'])
    assert.throws(()=>validateValue({provider:'llm',field:'base_url',value:url,ownerScope:'MERCHANT'}),error=>/^CREDENTIAL_URL/.test(error.code),url);
  assert.equal(validateValue({provider:'llm',field:'base_url',value:'https://api.deepseek.com',ownerScope:'MERCHANT'}),'https://api.deepseek.com');
});

test('B9 resolver precedence: merchant key, else SIM key, else environment; merchant set used only when complete',async()=>{
  const env={TAVILY_API_KEY:'env-tavily',HUNTER_API_KEY:'env-hunter',DATAFORSEO_LOGIN:'env-login',DATAFORSEO_PASSWORD:'env-pass',FEISHU_APP_SECRET:'REPLACE_WITH_SECRET'};
  const store=new MemoryStore({SIM:{tavily:{api_key:'sim-tavily'},feishu:{app_secret:'sim-feishu'}},
    [MERCHANT]:{tavily:{api_key:'merchant-tavily'},dataforseo:{login:'m-login'},feishu:{app_secret:'merchant-feishu'}}},env);
  assert.equal(await store.getCredential({merchantId:MERCHANT,provider:'tavily',field:'api_key'}),'merchant-tavily');
  assert.equal(await store.getCredential({merchantId:null,provider:'tavily',field:'api_key'}),'sim-tavily');
  assert.equal(await store.getCredential({merchantId:MERCHANT,provider:'hunter',field:'api_key'}),'env-hunter');
  // Incomplete merchant set (login without password) is not mixed with SIM's password.
  const dfs=await store.resolveProvider({merchantId:MERCHANT,provider:'dataforseo'});
  assert.deepEqual([dfs.source,dfs.values.login,dfs.values.password,dfs.merchant_billed],['ENV','env-login','env-pass',false]);
  // Feishu is SIM-only: a merchant row is ignored; placeholder env values count as unset.
  const feishu=await store.resolveProvider({merchantId:MERCHANT,provider:'feishu'});
  assert.equal(feishu.values.app_secret,'sim-feishu');assert.equal(feishu.source,'SIM');assert.equal(feishu.configured,false);
  const tavily=await store.resolveProvider({merchantId:MERCHANT,provider:'tavily'});
  assert.equal(tavily.merchant_billed,true);
  const overlay=await store.envFor({merchantId:MERCHANT});
  assert.equal(overlay.TAVILY_API_KEY,'merchant-tavily');assert.equal(overlay.HUNTER_API_KEY,'env-hunter');
  assert.equal(env.TAVILY_API_KEY,'env-tavily','the original environment is not modified');
  await assert.rejects(store.getCredential({merchantId:'not-a-uuid',provider:'tavily',field:'api_key'}),{code:'MERCHANT_INVALID_ID'});
});

test('B9 catalog: merchants may add billed-per-account providers only; Feishu and translation are SIM-only',()=>{
  assert.deepEqual([...MERCHANT_PROVIDER_KEYS].sort(),['brave','dataforseo','exa','hunter','llm','tavily']);
  assert.equal(PROVIDERS.feishu.scope,'SIM');assert.equal(PROVIDERS.translate.scope,'SIM');
  const store=new MemoryStore({},{});
  assert.throws(()=>store.scopeCheck('feishu',MERCHANT),{code:'CREDENTIAL_SIM_ONLY'});
  assert.throws(()=>store.scopeCheck('nope',null),{code:'CREDENTIAL_PROVIDER_UNKNOWN'});
});

test('B9 provider usage (B8): search order, Exa switch, Hunter mode and CRM provider are reported',()=>{
  const env={SEARCH_PROVIDER_ORDER:'searxng,exa,tavily',EXA_ENABLED:'false',HUNTER_MODE:'FREE_FIRST',CRM_PROVIDER:'FEISHU'};
  assert.deepEqual(providerUsage('tavily',env),{enabled:true,code:'IN_SEARCH_ORDER',paid:true});
  assert.equal(providerUsage('exa',env).code,'EXA_DISABLED');
  assert.equal(providerUsage('brave',env).enabled,false);
  assert.equal(providerUsage('hunter',env).code,'HUNTER_FREE_FIRST');
  assert.equal(providerUsage('feishu',env).enabled,true);
});

test('B9 test button: account endpoints, key in headers only, result codes from mocked providers',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});
    if(url.includes('tavily'))return new Response(JSON.stringify({account:{}}),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('hunter'))return new Response(JSON.stringify({errors:[]}),{status:401,headers:{'content-type':'application/json'}});
    if(url.includes('feishu'))return new Response(JSON.stringify({code:10014,msg:'app secret invalid'}),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('dataforseo'))return new Response(JSON.stringify({status_code:20000}),{status:200,headers:{'content-type':'application/json'}});
    throw Object.assign(new Error('down'),{name:'TypeError'});
  };
  const tester=createProviderTester({fetchImpl,env:{}});
  assert.deepEqual(await tester('tavily',{configured:true,values:{api_key:'tvly-123456789'}}),{ok:true,code:'OK'});
  assert.equal(calls[0].url,'https://api.tavily.com/usage');
  assert.equal(calls[0].init.headers.authorization,'Bearer tvly-123456789');
  assert.deepEqual(await tester('hunter',{configured:true,values:{api_key:'h-123456789'}}),{ok:false,code:'KEY_REJECTED'});
  assert.ok(!calls[1].url.includes('h-123456789'),'Hunter key is sent in a header, not the URL');
  assert.deepEqual(await tester('feishu',{configured:true,values:{app_id:'cli_x',app_secret:'s'}}),{ok:false,code:'FEISHU_10014'});
  assert.deepEqual(await tester('dataforseo',{configured:true,values:{login:'a',password:'b'}}),{ok:true,code:'OK'});
  assert.deepEqual(await tester('translate',{configured:true,values:{base_url:'http://translate:5000'}}),{ok:false,code:'UNREACHABLE'});
  assert.deepEqual(await tester('exa',{configured:false,values:{}}),{ok:false,code:'NOT_CONFIGURED'});
  assert.equal(testRequest('llm',{provider:'anthropic',api_key:'k'}).init.headers['x-api-key'],'k');
  assert.equal(testRequest('llm',{provider:'deepseek',api_key:'k'}).url,'https://api.deepseek.com/models');
  assert.equal(testRequest('llm',{provider:'custom',api_key:'k'}),null);
});

test('B9 page markup: never shows stored values, bilingual labels, merchant sees no system wording',()=>{
  const data={owner:'SIM',encryption_ready:true,search_spend_mode:'FREE_ONLY',items:[
    {provider:'tavily',group:'search',scope:'BOTH',label:{zh:'Tavily 搜索',en:'Tavily search'},in_use:'SIM',configured:true,usage:{enabled:true,code:'IN_SEARCH_ORDER'},
      fields:[{field:'api_key',label:{zh:'API 密钥',en:'API key'},secret:true,configured:true,last4:'3456',set_at:'2026-10-26T00:00:00Z'}],last_test:{ok:true,code:'OK',tested_at:'2026-10-26T00:00:00Z'}},
    {provider:'feishu',group:'crm',scope:'SIM',label:{zh:'飞书多维表',en:'Feishu Base'},in_use:'ENV',configured:false,usage:{enabled:false,code:'CRM_PROVIDER_OTHER'},
      fields:[{field:'app_id',label:{zh:'应用 ID',en:'App ID'},secret:false,configured:false,env_fallback:true}],last_test:null}]};
  const admin=pageMarkup(data,{admin:true,readOnly:false});
  assert.match(admin,/末四位 3456/);assert.match(admin,/type="password"/);assert.match(admin,/只用免费搜索/);
  assert.match(admin,/data-key-crm-note/);assert.match(admin,/未填完整/);
  assert.ok(!/value="[^"]+"/.test(admin.replace(/<option value="[^"]*">/g,'')),'inputs are always empty');
  const merchant=pageMarkup({...data,items:[{...data.items[0],in_use:'MERCHANT',usage:undefined}]},{admin:false,readOnly:true});
  assert.match(merchant,/使用您的密钥/);assert.match(merchant,/data-key-sim-only/);assert.match(merchant,/disabled/);
  assert.ok(!/服务器设置|Server settings|环境变量|数据库|Docker|PostgreSQL/i.test(merchant));
  assert.match(sourcePill({in_use:'SIM_PROVIDED'},false),/由 SIM 提供/);
  assert.deepEqual(testText({ok:false,code:'KEY_REJECTED'})[1],'The key was not accepted; check it and enter it again');
});

test('B9/B7 UI files: no forbidden company-facing words, bilingual buttons, stylesheet block appended',()=>{
  const forbidden=/\bDemo\b|真实数据|抓取|采集|爬取|去重|规则评分|Outreach disabled/;
  for(const file of ['../public/ui/v4/api-keys.js','../public/ui/v4/translate-widget.js']){
    const source=readFileSync(new URL(file,import.meta.url),'utf8');
    assert.ok(!forbidden.test(source),file);
  }
  const css=readFileSync(new URL('../public/ui/v4/app.css',import.meta.url),'utf8');
  assert.match(css,/Batch 2 B7\/B9[\s\S]*\.v4-translate[\s\S]*end Batch 2 B7\/B9/);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css.slice(css.indexOf('Batch 2 B7/B9'),css.indexOf('end Batch 2 B7/B9'))),'tokens only, no raw colours');
});

test('B9 liveEnv: SIM keys overlay the environment for clients built once at startup',async()=>{
  const env={FEISHU_APP_ID:'env-app',CRM_PROVIDER:'FEISHU'};
  const store=new MemoryStore({SIM:{feishu:{app_secret:'sim-secret-123456'}}},env);
  const live=store.liveEnv({refreshMs:60_000});
  await store.refreshLive();
  assert.equal(live.FEISHU_APP_SECRET,'sim-secret-123456');
  assert.equal(live.FEISHU_APP_ID,'env-app');assert.equal(live.CRM_PROVIDER,'FEISHU');
  assert.ok('FEISHU_APP_SECRET' in live);assert.equal({...live}.FEISHU_APP_SECRET,'sim-secret-123456');
  assert.equal(env.FEISHU_APP_SECRET,undefined,'process.env itself is not written');
  store.rows.SIM.feishu.app_secret='sim-secret-rotated';
  await store.refreshLive();
  assert.equal(live.FEISHU_APP_SECRET,'sim-secret-rotated');
  store.stopLive();
});
