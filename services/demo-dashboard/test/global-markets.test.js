import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {buildStrategyQuery,marketRoleTerms,marketStrategyLocale} from '../src/autoEvidence/strategyCatalog.js';
import {generateDecisionMakerQueries} from '../src/enrichment/decisionMakerQueryGenerator.js';
import {marketSearchLanguages} from '../src/market/marketLanguages.js';
import {createMarketRegistryRouter} from '../src/market/marketRegistryRouter.js';
import {loadSearchPlanningConfig} from '../src/searchPlanning/config.js';
import {planSearchQueries} from '../src/searchPlanning/queryPlanner.js';

const root=new URL('../../../',import.meta.url);
const seed=JSON.parse(readFileSync(new URL('config/search/market-registry-seed.v1.json',root),'utf8'));
const migration=readFileSync(new URL('database/migrations/065_global_markets_categories_search_cost.sql',root),'utf8');
const config=loadSearchPlanningConfig();
const buyers=['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'];

test('registry seed covers the selected markets with valid zones, windows and vocabulary-backed languages',()=>{
  const codes='US CA GB DE FR IT ES NL PL SA AE QA KW IL TR MX BR CL CO PE AU NZ JP KR SG MY TH VN PH ID IN ZA NG KE EG MA'.split(' ');
  assert.deepEqual(seed.markets.map(m=>m.market_code),codes);
  const vocabulary=Object.keys(config.strategies.locales);
  for(const market of seed.markets){
    assert.ok(market.languages.length&&market.languages.every(l=>vocabulary.includes(l)),market.market_code);
    assert.ok(market.languages.includes('en'));
    assert.deepEqual(market.buyer_types,buyers);
    assert.match(market.timezone,/^[A-Z][A-Za-z_]+\/[A-Za-z_]+$/);
    assert.ok(market.business_send_window.days.length>=5&&market.business_send_window.start<market.business_send_window.end);
  }
  const by=Object.fromEntries(seed.markets.map(m=>[m.market_code,m]));
  assert.deepEqual(by.DE.languages,['de','en']);assert.deepEqual(by.BR.languages,['pt','en']);assert.deepEqual(by.JP.languages,['en']);
  assert.deepEqual(by.SA.business_send_window.days,[1,2,3,4,7]);assert.equal(by.US.timezone,'America/New_York');
  assert.equal(by.DE.country_terms.de,'Deutschland');
});

test('migration 065 inserts new markets INACTIVE without touching AE/MX and widens 029/024/030 checks',()=>{
  assert.match(migration,/'INACTIVE',false/);assert.match(migration,/ON CONFLICT \(market_code\) DO NOTHING/);
  assert.doesNotMatch(migration,/\('AE','United Arab Emirates'/);assert.doesNotMatch(migration,/\('MX','Mexico'/);
  assert.doesNotMatch(migration,/UPDATE leadgen\.research_market_registry/);
  assert.match(migration,/research_job_cohort_items_market_code_check CHECK\(market_code ~ '\^\[A-Z\]\{2\}\$'\)/);
  assert.match(migration,/language IN\('en','es','zh','de','fr','pt','it','tr','ar','und'\)/);
});

test('every new search language has buyer and all 13 category terms',()=>{
  const en=config.strategies.locales.en;
  for(const language of ['de','fr','pt','it','tr']){
    const locale=config.strategies.locales[language];
    for(const key of Object.keys(en).filter(key=>key!=='category_terms'))assert.ok(locale[key],`${language}.${key}`);
    assert.deepEqual(Object.keys(locale.category_terms).sort(),Object.keys(en.category_terms).sort());
  }
});

test('German market plans German and English queries with the localized country name',()=>{
  const result=planSearchQueries({scopes:[{market_code:'DE',country_name:'Germany',country_terms:{de:'Deutschland',en:'Germany'},
    category_scope_id:'c1',category_code:'DRESSES',languages:['de','en'],buyer_types:buyers,product_profile:'WOMENSWEAR'}]},{config});
  assert.deepEqual(result.summary.languages,['de','en']);
  assert.ok(result.queries.some(q=>q.language==='de'&&q.original_query==='"Kleider" Importeur "Deutschland"'));
  assert.ok(result.queries.some(q=>q.language==='en'&&q.original_query.includes('"Germany"')));
});

test('auto-evidence and enrichment wording is unchanged for AE/MX and follows market language elsewhere',()=>{
  const ae=['buyer','procurement manager','purchasing manager','category manager','sourcing manager','مدير المشتريات','مسؤول المشتريات'];
  assert.deepEqual(marketRoleTerms('AE'),ae);assert.equal(marketStrategyLocale('AE'),'en-ar-AE');
  assert.equal(marketRoleTerms('MX')[0],'Comprador');assert.equal(marketStrategyLocale('MX'),'es-MX');
  assert.equal(marketStrategyLocale('US'),'en');assert.equal(marketStrategyLocale('DE'),'en-de-DE');
  assert.ok(marketRoleTerms('DE').includes('Einkäufer')&&marketRoleTerms('DE').includes('buyer'));
  assert.deepEqual(marketSearchLanguages('ZZ'),['en']);
  const task={company_name:'Muster Handel GmbH',official_root_domain:'muster.example',country_code:'DE',target_category_code:'DRESSES'};
  assert.match(buildStrategyQuery('S06_LOCAL_LANGUAGE_ROLES',task).query_text,/Einkaufsleiter/);
  const mx=generateDecisionMakerQueries({company_name:'Moda SA',country_code:'MX',official_root_domain:'moda.example'});
  assert.match(mx[0].query_text,/registro de proveedores/);
  const br=generateDecisionMakerQueries({company_name:'Moda Ltda',country_code:'BR',official_root_domain:'moda.example'});
  assert.match(br[0].query_text,/cadastro de fornecedores/);
  const us=generateDecisionMakerQueries({company_name:'Acme Inc',country_code:'US'});
  assert.match(us[0].query_text,/procurement manager/);
});

test('no AE/MX market whitelist remains in the runtime paths moved to the registry',()=>{
  const files=['src/autoEvidence/AutoEvidenceOrchestrator.js','src/enrichment/EnrichmentService.js','src/research/ResearchWorkbenchService.js',
    'src/autoEvidence/strategyCatalog.js','src/enrichment/decisionMakerQueryGenerator.js'];
  for(const file of files){
    const source=readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\['AE', ?'MX'\]|IN\('AE','MX'\)|=== ?'MX'|==='AE'/,file);
  }
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.doesNotMatch(server,/market_codes must contain AE and\/or MX/);
  const compose=readFileSync(new URL('compose.yaml',root),'utf8');
  assert.match(compose,/AUTO_EVIDENCE_MARKET_CODES: \$\{AUTO_EVIDENCE_MARKET_CODES:-\}/);
});

async function routerHarness(t,service){
  const audits=[];
  const managementAuth={authenticate:(req,res,next)=>{if(!req.get('x-role'))return res.sendStatus(401);
    req.managementUser={identity:'simon',role:req.get('x-role')};next();},
    requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.sendStatus(403)};
  const app=express();app.use(express.json());
  app.use('/api/markets/registry',createMarketRegistryRouter({service,managementAuth,audit:(event,fields)=>audits.push({event,...fields})}));
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const request=(path,{method='GET',body,role='MANAGEMENT'}={})=>fetch(`http://127.0.0.1:${server.address().port}/api/markets/registry${path}`,
    {method,headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {request,audits};
}

test('market registry router: sales can read, only management can toggle, body is validated and changes are audited',async t=>{
  const calls=[];
  const service={list:async()=>[{market_code:'DE',status:'INACTIVE',search_enabled:false,languages:['de','en']}],
    setSearchEnabled:async(code,input)=>{calls.push({code,...input});
      if(code==='BD')throw Object.assign(new Error('MARKET_HIDDEN'),{code:'MARKET_HIDDEN',status:409});
      return {market_code:code,status:'ACTIVE',search_enabled:input.search_enabled,changed:true,event_id:'e1'};}};
  const h=await routerHarness(t,service);
  assert.equal((await h.request('',{role:null})).status,401);
  const listed=await h.request('',{role:'SALES'});assert.equal(listed.status,200);
  assert.equal((await listed.json()).items[0].market_code,'DE');
  assert.equal((await h.request('/DE',{method:'PUT',body:{search_enabled:true},role:'DATA_ADMIN'})).status,403);
  assert.equal((await h.request('/DE',{method:'PUT',body:{search_enabled:'yes'}})).status,400);
  const enabled=await h.request('/DE',{method:'PUT',body:{search_enabled:true}});
  assert.equal(enabled.status,200);assert.equal((await enabled.json()).status,'ACTIVE');
  assert.deepEqual(calls[0],{code:'DE',search_enabled:true,reason:'',actor:'simon',role:'MANAGEMENT'});
  assert.equal(h.audits[0].event,'MARKET_REGISTRY_SEARCH_TOGGLED');
  assert.equal((await h.request('/BD',{method:'PUT',body:{search_enabled:true}})).status,409);
});
