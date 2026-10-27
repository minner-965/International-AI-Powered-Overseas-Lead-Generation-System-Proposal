// Batch 2 integration: route lists, feature gates, B9 key wiring (live SIM keys, merchant-billed search and
// Hunter), follow-up settings (072), market send windows and the new workspace pages. No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {merchantRouteAllowed,createWorkspaceGate} from '../src/merchant/auth.js';
import {merchantApiAllowed} from '../public/ui/v4/session.js';
import {selectCurrentCapacityProvider,CurrentCapacityRouter} from '../src/search/CurrentCapacityRouter.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';
import {SearchUsageAudit} from '../src/search/SearchUsageAudit.js';
import {SearchCostControl} from '../src/search/SearchCostControl.js';
import {TavilyProviderAccountState} from '../src/search/TavilyProviderAccountState.js';
import {ExaProviderAccountState} from '../src/search/ExaProviderAccountState.js';
import {HunterProvider} from '../src/enrichment/HunterProvider.js';
import {withLiveSearchKeys,merchantSearchCredentials,createJobSearchCredentials,createHunterKeyResolver} from '../src/credentials/searchCredentials.js';
import {FollowupSettingsService,createFollowupSettingsRouter,followupEnvDefaults} from '../src/crm/followupSettings.js';
import {CrmService} from '../src/crm/service.js';
import {normalizeSendWindow} from '../src/market/MarketRegistryService.js';
import {createMarketRegistryRouter} from '../src/market/marketRegistryRouter.js';
import {countMerchantSearchesThisMonth} from '../src/merchant/MerchantService.js';

const UUID='7b904157-785d-445b-9ca9-0357e8f4890c';
const MERCHANT='11111111-1111-4111-8111-111111111111';

test('merchant route list (server) and its browser mirror allow the batch 2 merchant endpoints and nothing more',()=>{
  const allowed=[['POST',`/api/research/batches/${UUID}/cancel`],['POST',`/api/research/jobs/${UUID}/cancel`],
    ['GET','/api/manual-companies'],['GET','/api/manual-companies/options'],['GET','/api/manual-companies/first-touch-drafts'],['GET',`/api/manual-companies/${UUID}`],
    ['POST','/api/manual-companies'],['POST',`/api/manual-companies/${UUID}/contacts`],['POST',`/api/manual-companies/${UUID}/activities`],
    ['POST',`/api/manual-companies/${UUID}/stage`],['POST',`/api/manual-companies/${UUID}/first-touch-drafts`],
    ['POST',`/api/manual-companies/first-touch-drafts/${UUID}/decision`],['GET','/api/first-touch/test-sends'],
    ['POST','/api/first-touch/test-sends'],['POST','/api/first-touch/test-sends/preview'],
    ['GET','/api/merchant/provider-credentials'],['PUT','/api/merchant/provider-credentials/tavily'],['PUT','/api/merchant/provider-credentials/llm'],
    ['POST','/api/merchant/provider-credentials/hunter/test'],['POST','/api/merchant/provider-credentials/exa/revoke'],
    ['POST','/api/translate'],['GET','/api/translate/languages']];
  const refused=[['PUT',`/api/manual-companies/${UUID}/test-flag`],['POST',`/api/manual-companies/${UUID}/assign`],
    ['PUT','/api/merchant/provider-credentials/feishu'],['PUT','/api/merchant/provider-credentials/translate'],['GET','/api/admin/provider-credentials'],
    ['GET','/api/automation/followup-settings'],['PUT','/api/automation/followup-settings'],['PUT','/api/markets/registry/AE'],
    ['POST',`/api/research/batches/${UUID}/retry`],['DELETE',`/api/manual-companies/${UUID}`]];
  for(const [method,path] of allowed){assert.equal(merchantRouteAllowed(method,path),true,`${method} ${path}`);assert.equal(merchantApiAllowed(method,path),true,`mirror ${method} ${path}`);}
  for(const [method,path] of refused){assert.equal(merchantRouteAllowed(method,path),false,`${method} ${path}`);assert.equal(merchantApiAllowed(method,path),false,`mirror ${method} ${path}`);}
});

function gateFor(features){
  const merchants={findUserById:async()=>({id:'u',email:'anna@alpha.example',role:'MERCHANT',merchant_id:MERCHANT}),
    getMerchant:async()=>({id:MERCHANT,status:'ACTIVE',features})};
  const gate=createWorkspaceGate({merchants,env:{AUTH_REQUIRED:'true'},pool:{query:async()=>({rowCount:1,rows:[]})}});
  return async(method,path,body={})=>{
    let status=200,payload=null,passed=false;
    const res={status(code){status=code;return this;},json(value){payload=value;return this;}};
    await gate({path,method,body,query:{},session:{userId:'u'}},res,()=>{passed=true;});
    return passed?{status:200,passed}:{status,code:payload?.code};
  };
}

test('feature switches: research off still lets a merchant cancel; email off refuses manual first-touch decisions and test sends',async()=>{
  const researchOff=gateFor({research:false,email:true});
  assert.equal((await researchOff('POST','/api/research/batches')).code,'MERCHANT_FEATURE_DISABLED');
  assert.equal((await researchOff('POST','/api/research/batches/preview')).code,'MERCHANT_FEATURE_DISABLED');
  assert.equal((await researchOff('POST',`/api/research/batches/${UUID}/cancel`)).passed,true);
  assert.equal((await researchOff('POST',`/api/research/jobs/${UUID}/cancel`)).passed,true);
  const emailOff=gateFor({research:true,email:false});
  for(const path of [`/api/manual-companies/first-touch-drafts/${UUID}/decision`,'/api/first-touch/test-sends','/api/first-touch/test-sends/preview'])
    assert.equal((await emailOff('POST',path)).code,'MERCHANT_FEATURE_DISABLED',path);
  assert.equal((await emailOff('POST','/api/manual-companies')).passed,true);
  assert.equal((await emailOff('GET','/api/first-touch/test-sends')).passed,true);
});

test('search configuration reads SIM keys live; spreading it takes the value at that moment',()=>{
  const env={TAVILY_API_KEY:'',EXA_API_KEY:'exa-env'};
  const config=withLiveSearchKeys({provider:'tavily',tavilyApiKey:'stale',timeoutMs:1000},env);
  assert.equal(config.tavilyApiKey,'');assert.equal(config.exaApiKey,'exa-env');
  env.TAVILY_API_KEY='tvly-saved-on-page';
  assert.equal(config.tavilyApiKey,'tvly-saved-on-page');assert.equal({...config}.tavilyApiKey,'tvly-saved-on-page');
  assert.ok(Object.isFrozen(config));
});

test('account states follow a live SIM key',async()=>{
  let key='';
  const tavily=new TavilyProviderAccountState({pool:{query:async()=>({rows:[]})},apiKey:()=>key});
  assert.equal(tavily.apiKey,'');assert.equal(tavily.credentialFingerprint,null);
  key='tvly-1';assert.equal(tavily.apiKey,'tvly-1');assert.match(tavily.credentialFingerprint,/^[0-9a-f]{64}$/);
  const exa=new ExaProviderAccountState({apiKey:()=>key,enabled:true});
  key='';assert.equal((await exa.getState()).status,'AUTH_ERROR');
  key='exa-1';assert.equal((await exa.getState()).status,'AVAILABLE');
});

const credentialDouble=stored=>({resolveProvider:async({merchantId,provider})=>{
  const own=stored[merchantId]?.[provider];
  return own?{source:'MERCHANT',values:own,configured:true,merchant_billed:true}:{source:'SIM',values:{},configured:true,merchant_billed:false};
}});

test('a merchant job uses the merchant\'s own complete search keys; SIM jobs and incomplete keys use SIM',async()=>{
  const credentials=credentialDouble({[MERCHANT]:{tavily:{api_key:'tvly-merchant'},exa:{api_key:'exa-merchant'}}});
  assert.equal(await merchantSearchCredentials(credentials,null),null);
  assert.deepEqual(await merchantSearchCredentials(credentials,MERCHANT),{merchant_id:MERCHANT,
    config:{tavilyApiKey:'tvly-merchant',exaApiKey:'exa-merchant',exaEnabled:true},merchant_billed:['tavily','exa']});
  const pool={query:async(_sql,[id])=>({rows:id==='merchant-job'?[{merchant_id:MERCHANT}]:[{merchant_id:null}]})};
  const forJob=createJobSearchCredentials({pool,credentials});
  assert.equal(await forJob('sim-job'),null);
  assert.deepEqual((await forJob('merchant-job')).merchant_billed,['tavily','exa']);
  const hunterKey=createHunterKeyResolver({pool,credentials:credentialDouble({[MERCHANT]:{hunter:{api_key:'hunter-merchant'}}})});
  assert.equal(await hunterKey({researchJobId:'sim-job'}),null);
  assert.deepEqual(await hunterKey({researchJobId:'merchant-job'}),{apiKey:'hunter-merchant',merchantBilled:true,merchantId:MERCHANT});
});

test('provider selection: a merchant-billed provider is used even in FREE_ONLY and without SIM capacity',()=>{
  const config={searxngEnabled:false,tavilyApiKey:'',exaEnabled:false};
  const sim=selectCurrentCapacityProvider({order:['searxng','tavily'],config,states:{},paidBlocked:'FREE_ONLY',unitPrices:{TAVILY:0.008}});
  assert.equal(sim.provider,null);
  const own=selectCurrentCapacityProvider({order:['searxng','tavily'],config:{...config,tavilyApiKey:'tvly-merchant'},states:{tavily:{status:'CREDIT_EXHAUSTED'}},
    paidBlocked:'FREE_ONLY',unitPrices:{TAVILY:0.008},merchantBilled:['tavily']});
  assert.equal(own.provider,'tavily');assert.equal(own.merchant_billed,true);assert.equal(own.paid,false);
  // A free provider earlier in the order still comes first.
  const free=selectCurrentCapacityProvider({order:['searxng','tavily'],config:{searxngEnabled:true,searxngBaseUrl:'http://searxng:8080',tavilyApiKey:'k'},
    states:{searxng:{status:'AVAILABLE'}},merchantBilled:['tavily']});
  assert.equal(free.provider,'searxng');assert.equal(free.merchant_billed,undefined);
});

test('router builds the merchant provider with the merchant key and the SIM provider with SIM\'s key',async()=>{
  const built=[];
  const router=new CurrentCapacityRouter({config:{tavilyApiKey:'tvly-sim',searxngEnabled:false},getOrder:async()=>['tavily'],getStates:async()=>({tavily:{status:'AVAILABLE'}}),
    providerOverrides:{}});
  const credentials={merchant_id:MERCHANT,config:{tavilyApiKey:'tvly-merchant'},merchant_billed:['tavily']};
  const selected=await router.select({credentials});
  assert.equal(selected.merchant_billed,true);
  built.push(router.provider(selected,credentials).apiKey,router.provider({provider:'tavily'},credentials).apiKey);
  assert.deepEqual(built,['tvly-merchant','tvly-sim']);
});

test('executor: a merchant-billed query skips SIM\'s monthly budget and is recorded as billed to the merchant',async()=>{
  const calls={canSpend:0,audit:[]};
  const store={load:async()=>({id:'plan',plan:{queries:[{fingerprint:'q'}]}}),lookup:async()=>null,
    claim:async()=>({id:'x',request_snapshot:{query:'dresses importer dubai'}}),recordResponse:async()=>{},persist:async()=>[],results:async()=>[],attachUsage:async()=>{},fail:async()=>{}};
  const router={select:async({credentials}={})=>({provider:'tavily',merchant_billed:Boolean(credentials)}),
    provider:(_selected,credentials)=>({name:'tavily',endpoint:'https://fixture.invalid/search',key:credentials?.config?.tavilyApiKey||'sim',
      search:async()=>({results:[{url:'https://fixture.invalid/a'}]})})};
  const costControl={config:{reuseDays:0},canSpend:async()=>{calls.canSpend++;return{allowed:false,reason:'MONTHLY_BUDGET'};}};
  const auditFactory=(provider,{auditExtra}={})=>{calls.audit.push({key:provider.name,auditExtra});return{search:async()=>({results:[{url:'u'}],usage_event:{id:'e'}})};};
  const merchantRun=new FrozenSearchPlanExecutor({store,router,costControl,auditFactory,
    jobCredentials:async()=>({merchant_id:MERCHANT,config:{tavilyApiKey:'tvly-merchant'},merchant_billed:['tavily']})});
  const result=await merchantRun.executeJob('job');
  assert.equal(result.status,'COMPLETED');assert.equal(calls.canSpend,0);
  assert.deepEqual(calls.audit[0].auditExtra,{billed_to:'MERCHANT',merchant_id:MERCHANT});
  const simRun=new FrozenSearchPlanExecutor({store,router,costControl,auditFactory,jobCredentials:async()=>null});
  assert.equal((await simRun.executeJob('job')).status,'PAUSED_SEARCH_MONTHLY_BUDGET');assert.equal(calls.canSpend,1);
});

test('usage audit records billed_to; SIM monthly spend excludes merchant-billed requests',async()=>{
  const audit=new SearchUsageAudit({provider:{name:'tavily',endpoint:'https://fixture.invalid/search',search:async()=>({results:[]})},auditExtra:{billed_to:'MERCHANT',merchant_id:MERCHANT}});
  const response=await audit.search({researchJobId:'job',purpose:'NEW_COMPANY_DISCOVERY',request:{query:'q'}});
  assert.equal(response.usage_event.result_payload.audit.billed_to,'MERCHANT');
  let sql='';
  const control=new SearchCostControl({pool:{query:async text=>{sql=text;return{rows:[{recorded_queries:0,recorded_cost_usd:0}]};}}});
  await control.monthSpend();
  assert.match(sql,/billed_to','SIM'\)<>'MERCHANT'/);
});

test('Hunter: SIM key is read live; a merchant key is sent for merchant jobs outside SIM\'s credit caps',async()=>{
  let simKey='';
  const headers=[];
  const fetchImpl=async(_url,options)=>{headers.push(options.headers['X-API-KEY']);return new Response(JSON.stringify({data:{status:'valid',score:90}}),{status:200});};
  const hunter=new HunterProvider({apiKey:()=>simKey,mode:'FREE_FIRST',fetchImpl,runCapUnits:0,dailyCapUnits:0,billingPeriodCapUnits:0,
    resolveKey:async({researchJobId})=>researchJobId==='merchant-job'?{apiKey:'hunter-merchant',merchantBilled:true,merchantId:MERCHANT}:null});
  assert.equal(hunter.capabilities.enabled,false);
  simKey='hunter-sim';assert.equal(hunter.capabilities.enabled,true);assert.equal(hunter.mode,'FREE_FIRST');
  const merchant=await hunter.verifyEmail({researchJobId:'merchant-job',companyId:null,email:'buyer@alpha.example'});
  assert.equal(merchant.status,'COMPLETED');assert.equal(merchant.usage_event.result_payload.billed_to,'MERCHANT');
  // SIM's caps are zero here, so SIM's own request is refused before any network call.
  await assert.rejects(hunter.verifyEmail({researchJobId:'sim-job',companyId:null,email:'buyer@beta.example'}),{code:'HUNTER_CREDIT_CAP'});
  assert.deepEqual(headers,['hunter-merchant']);
});

test('merchant monthly searches include reuse charges recorded on the merchant\'s own batches',async()=>{
  const pool={query:async sql=>/merchant_reuse_charge/.test(sql)?{rows:[{charged:4}]}:{rows:[{count:3}]}};
  assert.equal(await countMerchantSearchesThisMonth(pool,MERCHANT),7);
});

test('follow-up settings: environment until saved in the workspace, then the saved values (append-only via controls)',async()=>{
  assert.deepEqual(followupEnvDefaults({}),{enabled:false,daily_limit:50});
  assert.deepEqual(followupEnvDefaults({CRM_FOLLOWUP_DRAFTS_ENABLED:'true',CRM_FOLLOWUP_DAILY_LIMIT:'20'}),{enabled:true,daily_limit:20});
  let row={control_key:'CRM_FOLLOWUP_DRAFTS',enabled:false,revision:1,settings:{source:'ENVIRONMENT_DEFAULT',daily_limit:null}};
  const sets=[];
  const controls={get:async()=>row,set:async input=>{sets.push(input);row={...row,enabled:input.enabled,settings:input.settings,revision:row.revision+1,updated_by:input.actor,updated_at:'2026-10-26T00:00:00Z'};}};
  const settings=new FollowupSettingsService({controls,env:{CRM_FOLLOWUP_DRAFTS_ENABLED:'true',CRM_FOLLOWUP_DAILY_LIMIT:'30'}});
  assert.deepEqual(await settings.get(),{enabled:true,daily_limit:30,source:'ENVIRONMENT_DEFAULT',installed:true,revision:1,updated_by:null,updated_at:null});
  await assert.rejects(settings.set({enabled:'yes',daily_limit:5,actor:'simon'}),{code:'FOLLOWUP_ENABLED_INVALID'});
  await assert.rejects(settings.set({enabled:true,daily_limit:0,actor:'simon'}),{code:'FOLLOWUP_DAILY_LIMIT_INVALID'});
  await assert.rejects(settings.set({enabled:true,daily_limit:2.5,actor:'simon'}),{code:'FOLLOWUP_DAILY_LIMIT_INVALID'});
  const saved=await settings.set({enabled:false,daily_limit:12,actor:'simon@sim.example'});
  assert.equal(saved.source,'WORKSPACE');assert.equal(saved.enabled,false);assert.equal(saved.daily_limit,12);assert.equal(saved.revision,2);
  assert.equal(sets[0].controlKey,'CRM_FOLLOWUP_DRAFTS');assert.match(sets[0].idempotencyKey,/^followup-settings:/);
  // Before migration 072 the environment applies and saving is refused.
  const missing=new FollowupSettingsService({controls:{get:async()=>{throw Object.assign(new Error('x'),{code:'AUTOMATION_CONTROL_NOT_FOUND'});}},env:{}});
  assert.equal((await missing.get()).installed,false);
  await assert.rejects(missing.set({enabled:true,daily_limit:5,actor:'simon'}),{code:'FOLLOWUP_SETTINGS_UNAVAILABLE'});
});

test('CRM follow-ups obey the saved setting: scan disabled and daily limit from the settings page',async()=>{
  const settings={get:async()=>({enabled:false,daily_limit:7})};
  const crm=new CrmService({pool:{query:async()=>({rows:[{count:3}]})},repository:{},env:{CRM_FOLLOWUP_DRAFTS_ENABLED:'true',CRM_FOLLOWUP_DAILY_LIMIT:'99'},followupSettings:settings});
  assert.deepEqual(await crm.scanFollowups(),{status:'DISABLED',created:0});
  assert.deepEqual(await crm.followupQuota(),{sent_today:3,daily_limit:7,remaining:4});
  const envOnly=new CrmService({pool:{query:async()=>({rows:[{count:3}]})},repository:{},env:{CRM_FOLLOWUP_DAILY_LIMIT:'10'}});
  assert.equal((await envOnly.followupQuota()).daily_limit,10);
});

async function serve(app,run){
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  try{return await run(`http://127.0.0.1:${server.address().port}`);}finally{server.close();}
}
const managementAuth={authenticate:(req,_res,next)=>{req.managementUser={identity:'simon@sim.example',role:req.get('x-role')||'MANAGEMENT'};next();},
  requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.status(403).json({code:'FORBIDDEN'})};

test('follow-up settings API: management reads and saves; validation errors are 4xx JSON',async()=>{
  let current={enabled:false,daily_limit:50,source:'ENVIRONMENT_DEFAULT'};
  const settings={get:async()=>current,set:async({enabled,daily_limit,actor})=>{
    if(!Number.isInteger(daily_limit))throw Object.assign(new Error('bad'),{code:'FOLLOWUP_DAILY_LIMIT_INVALID',status:400});
    current={enabled,daily_limit,source:'WORKSPACE',updated_by:actor};return current;}};
  const app=express();app.use(express.json());app.use(createFollowupSettingsRouter({settings,managementAuth}));
  await serve(app,async base=>{
    assert.equal((await (await fetch(`${base}/api/automation/followup-settings`)).json()).source,'ENVIRONMENT_DEFAULT');
    const put=body=>fetch(`${base}/api/automation/followup-settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const bad=await put({enabled:true,daily_limit:'many'});assert.equal(bad.status,400);assert.equal((await bad.json()).code,'FOLLOWUP_DAILY_LIMIT_INVALID');
    const ok=await put({enabled:true,daily_limit:25});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{enabled:true,daily_limit:25,source:'WORKSPACE',updated_by:'simon@sim.example'});
    const sales=await fetch(`${base}/api/automation/followup-settings`,{method:'PUT',headers:{'content-type':'application/json','x-role':'SALES'},body:'{}'});
    assert.equal(sales.status,403);
  });
});

test('market send window: validation and the registry API (window alone, or together with the search switch)',async()=>{
  assert.deepEqual(normalizeSendWindow({days:[5,1,2,2,3,4],start:'08:30',end:'18:00'}),{days:[1,2,3,4,5],start:'08:30',end:'18:00'});
  for(const [input,code] of [[{days:[],start:'09:00',end:'17:00'},'MARKET_SEND_WINDOW_DAYS_INVALID'],[{days:[0],start:'09:00',end:'17:00'},'MARKET_SEND_WINDOW_DAYS_INVALID'],
    [{days:[1],start:'9:00',end:'17:00'},'MARKET_SEND_WINDOW_TIME_INVALID'],[{days:[1],start:'17:00',end:'09:00'},'MARKET_SEND_WINDOW_ORDER_INVALID'],[null,'MARKET_SEND_WINDOW_INVALID']])
    assert.throws(()=>normalizeSendWindow(input),{code});
  const calls=[];
  const service={list:async()=>[],
    setSendWindow:async(code,input)=>{calls.push(['window',code,input.business_send_window,input.actor]);return{market_code:code,business_send_window:normalizeSendWindow(input.business_send_window),changed:true,event_id:'e1'};},
    setSearchEnabled:async(code,input)=>{calls.push(['search',code,input.search_enabled]);return{market_code:code,search_enabled:input.search_enabled,changed:true,event_id:'e2'};}};
  const audits=[];
  const app=express();app.use(express.json());app.use('/api/markets/registry',createMarketRegistryRouter({service,managementAuth,audit:(event,fields)=>audits.push({event,...fields})}));
  await serve(app,async base=>{
    const put=body=>fetch(`${base}/api/markets/registry/AE`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const window=await put({business_send_window:{days:[1,2,3,4,5,6],start:'09:00',end:'18:00'}});
    assert.equal(window.status,200);assert.deepEqual((await window.json()).business_send_window,{days:[1,2,3,4,5,6],start:'09:00',end:'18:00'});
    assert.equal((await put({})).status,400);
    const both=await (await put({search_enabled:false,business_send_window:{days:[1],start:'10:00',end:'12:00'}})).json();
    assert.equal(both.search_enabled,false);assert.equal(both.send_window_event_id,'e1');
  });
  assert.deepEqual(calls.map(row=>row[0]),['window','window','search']);assert.equal(calls[0][3],'simon@sim.example');
  assert.ok(audits.some(row=>row.event==='MARKET_REGISTRY_SEND_WINDOW_CHANGED'));
});

test('workspace pages: new views, navigation, phone tabs, page tips and scripts are wired',async()=>{
  const read=file=>readFile(new URL(`../public/${file}`,import.meta.url),'utf8');
  const [html,shell,me,tips,pipeline,mailbox]=await Promise.all([read('index.html'),read('crm-shell.js'),read('ui/v4/me.js'),read('ui/v4/tooltips.js'),read('ui/v4/pipeline.js'),read('ui/v4/manual-company.js')]);
  for(const view of ['manual-companies','api-keys']){
    assert.match(html,new RegExp(`data-app-view="${view}"`));assert.match(html,new RegExp(`data-app-nav="${view}"`));
    assert.match(shell,new RegExp(`views\\['${view}'\\]`));assert.match(me,new RegExp(`'${view}'`));assert.match(tips,new RegExp(`'${view}': \\[`));
  }
  assert.match(html,/id="manual-companies-root"[^>]*><\/div><div id="first-touch-test-root"><\/div>/);
  assert.match(html,/id="api-keys-root" class="v4-stack-page"/);
  assert.match(html,/data-m-views="[^"]*\bmanual-companies\b/);assert.match(html,/data-m-views="me [^"]*\bapi-keys\b/);
  for(const script of ['manual-company','first-touch-test','api-keys','translate-widget','followup-settings'])assert.match(html,new RegExp(`src="/ui/v4/${script}\\.js"`));
  assert.match(html,/id="view-mailbox"[\s\S]*?data-first-touch-test-open[\s\S]*?id="mailbox-root"/);
  assert.match(html,/<span lang="zh-CN">我的接口密钥<\/span><span lang="en">My API keys<\/span>/);
  assert.match(html,/id="followup-settings-root"/);
  assert.match(pipeline,/item\.source === 'MANUAL'/);
  assert.match(mailbox,/attachPreviewTranslation/);
  const {ADMIN_VIEWS}=await import('../public/ui/v4/session.js');
  assert.ok(!ADMIN_VIEWS.includes('api-keys')&&!ADMIN_VIEWS.includes('manual-companies'));
});

test('settings page helpers: send window labels and follow-up settings card',async()=>{
  const {sendWindowText,sendWindowForm}=await import('../public/ui/v4/scope-settings.js');
  {
    assert.deepEqual(sendWindowText({days:[1,2,3,4,5],start:'09:00',end:'17:00'}),['周一至周五 09:00–17:00','Mon–Fri 09:00–17:00']);
    assert.deepEqual(sendWindowText({days:[6,1],start:'10:00',end:'12:00'}),['周一、周六 10:00–12:00','Mon, Sat 10:00–12:00']);
    assert.deepEqual(sendWindowText(null),['未设置','Not set']);
    const form=sendWindowForm({market_code:'AE',country_name:'United Arab Emirates',timezone:'Asia/Dubai',business_send_window:{days:[1,2],start:'09:00',end:'17:00'}});
    assert.match(form,/Asia\/Dubai/);assert.equal((form.match(/name="days" value="\d" checked/g)||[]).length,2);
  }
  const {followupSettingsMarkup}=await import('../public/ui/v4/followup-settings.js');
  const card=followupSettingsMarkup({enabled:true,daily_limit:25,source:'ENVIRONMENT_DEFAULT'});
  assert.match(card,/role="switch" name="enabled" checked/);assert.match(card,/name="daily_limit"[^>]*value="25"/);
  assert.match(card,/data-tip=/);assert.match(card,/<span lang="zh-CN">起草跟进邮件<\/span><span lang="en">Draft follow-up emails<\/span>/);
});
