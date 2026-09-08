import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSearchPlanningConfig,planningDigest} from '../src/searchPlanning/config.js';
import {planSearchQueries,normalizeSearchQuery,queryFingerprint,fairQueryIterator} from '../src/searchPlanning/queryPlanner.js';
import {evaluateDomainPolicy} from '../src/searchPlanning/domainPolicy.js';
const config=loadSearchPlanningConfig();
const buyers=['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'];
const scope=(market='AE',category='TOPS',id='category-tops')=>({market_code:market,country_name:market==='AE'?'United Arab Emirates':'Mexico',
  category_scope_id:id,category_code:category,languages:market==='AE'?['en']:['es','en'],buyer_types:buyers,product_profile:'WOMENSWEAR'});
const plan=scopes=>planSearchQueries({scopes},{config});

test('MC06 registry contains seven precision and eight coverage strategies with required fields',()=>{
  assert.equal(config.strategies.strategies.length,15);
  for(const s of config.strategies.strategies)for(const key of ['id','lane','enabled','buyer_type','category_mode','market_term_mode','city_mode','language_mode','template','priority'])assert.ok(Object.hasOwn(s,key));
  assert.deepEqual(config.lanes.lanes.map(l=>l.weight),[1,1]);
  assert.equal(config.lanes.hard_api_share_cap,false);
});
test('MC06 PostgreSQL Date and persisted JSON timestamp produce identical scope digests',()=>{
  const live={scopes:[scope()],updated_at:new Date('2026-09-08T00:00:00.000Z'),optional:undefined,items:[undefined]};
  assert.equal(planningDigest(live),planningDigest(JSON.parse(JSON.stringify(live))));
});
test('MC06 AE one category and MX one category expand all frozen languages deterministically',()=>{
  const ae=plan([scope()]);const mx=plan([scope('MX')]);
  assert.equal(ae.summary.planned_query_count,14);assert.equal(mx.summary.planned_query_count,28);
  assert.deepEqual(mx.summary.languages,['en','es']);
  assert.ok(mx.queries.some(q=>q.original_query.includes('importador')));
  assert.ok(mx.queries.some(q=>q.language==='es'&&q.original_query.includes('prendas superiores')));
  assert.deepEqual(plan([scope('MX')]),mx);
  assert.equal(mx.status,'PLANNED');assert.ok(mx.queries.every(q=>q.status==='PLANNED'));
});
test('MC06 2 markets x 13 frozen approved categories produces complete matrix without a strategy cap',()=>{
  const scopes=['AE','MX'].flatMap(m=>Array.from({length:13},(_,i)=>scope(m,`CATEGORY_${i}`,`id-${i}`)));
  const result=plan(scopes);
  assert.equal(result.summary.scopes,26);assert.equal(result.queries.length,546);
  assert.equal(result.summary.precision_planned,273);assert.equal(result.summary.coverage_planned,273);
  assert.equal(plan(scopes.filter(s=>s.market_code==='AE')).queries.length,182);
  assert.equal(plan(scopes.filter(s=>s.market_code==='MX')).queries.length,364);
  assert.equal(new Set(result.queries.map(q=>q.fingerprint)).size,result.queries.length);
  assert.equal(result.samples.PRECISION_LANE.length,5);assert.equal(result.samples.COVERAGE_LANE.length,5);
});
test('MC06 EN+AR is driven by frozen languages, not country hardcoding',()=>{
  const result=plan([{...scope(),languages:['en','ar']}]);
  assert.equal(result.queries.length,28);assert.ok(result.queries.some(q=>q.language==='ar'&&q.original_query.includes('مستورد')));
});
test('MC06 missing parent/unsupported language is explicit rather than invented scope',()=>{
  const result=plan([{...scope(),languages:['en','zz']}]);
  assert.ok(result.skipped.some(s=>s.reason==='FROZEN_PARENT_CATEGORY_MISSING'));
  assert.ok(result.skipped.some(s=>s.reason==='LANGUAGE_VOCABULARY_NOT_CONFIGURED'));
  assert.equal(result.queries.some(q=>q.strategy_id==='C01_PARENT_CATEGORY_RETAIL'),false);
  assert.equal(plan([{...scope(),parent_category:'Womenswear'}]).queries.length,15);
});
test('MC06 strong frozen aliases obey market/language and never load future registry aliases',()=>{
  const s={...scope(),approved_aliases:[
    {normalized_alias:'BLOUSES',alias_type:'SYNONYM',language:'en',market_code:'AE'},
    {normalized_alias:'TOPS',alias_type:'EXACT',language:'en'},
    {normalized_alias:'VESTIDOS',alias_type:'SYNONYM',language:'es'},
    {normalized_alias:'UNAPPROVED_PARENT',alias_type:'PARENT',language:'en'},
    {normalized_alias:'OTHER_MARKET',alias_type:'SYNONYM',language:'en',market_code:'MX'}]};
  const result=plan([s]);assert.equal(result.summary.precision_planned,14);
  assert.ok(result.queries.some(q=>q.original_query.includes('BLOUSES')));
  assert.ok(result.queries.every(q=>!q.original_query.includes('VESTIDOS')&&!q.original_query.includes('OTHER MARKET')));
});
test('MC06 normalization retains original form and full-scope fingerprint prevents cross-scope collapse',()=>{
  assert.equal(normalizeSearchQuery('  “ＴＯＰＳ”  importer importer   “Mexico”  '),'"TOPS" importer "Mexico"');
  const q=plan([scope()]).queries[0];
  assert.ok(q.original_query.includes('United Arab Emirates'));
  assert.equal(q.fingerprint,queryFingerprint({...q,normalized_query:q.normalized_query.toUpperCase()}));
  assert.equal(q.fingerprint,queryFingerprint({...q}));
  for(const field of ['strategy_version','strategy_id','lane','market_id','category_id','language','normalized_query','provider_purpose'])
    assert.notEqual(q.fingerprint,queryFingerprint({...q,[field]:`${q[field]}-changed`}));
});
test('MC06 duplicate frozen scope/language/alias does not duplicate a logical query',()=>{
  const s={...scope(),languages:['en','en']};const result=plan([s,s]);
  assert.equal(result.queries.length,14);
  const other={...s,category_scope_id:'another-approved-scope'};
  assert.equal(plan([s,other]).queries.length,28);
});
test('MC06 fair iterator alternates backlogs and lets remaining lane finish',()=>{
  const queries=[{lane:'PRECISION_LANE',id:'p1'},{lane:'PRECISION_LANE',id:'p2'},{lane:'PRECISION_LANE',id:'p3'},{lane:'COVERAGE_LANE',id:'c1'}];
  assert.deepEqual([...fairQueryIterator(queries,config.lanes)].map(q=>q.id),['p1','c1','p2','p3']);
});
test('MC06 strategy changes require distinct fingerprints while captured time changes do not',()=>{
  const one=plan([scope()]);const newer=structuredClone(config);newer.strategies.version='2.0.1';
  const two=planSearchQueries({scopes:[scope()]},{config:newer});
  assert.notEqual(one.queries[0].fingerprint,two.queries[0].fingerprint);
  assert.deepEqual(planSearchQueries({scopes:[scope()],captured_at:'yesterday'},{config}).queries,one.queries);
});
test('MC06 domain BLOCK applies exact host boundaries and all subdomains',()=>{
  for(const host of ['amazon.com','www.amazon.com.mx','shop.alibaba.com','aliexpress.com','made-in-china.com','youtube.com','tiktok.com','pinterest.com']){
    const result=evaluateDomainPolicy(`https://${host}/products`,{config});assert.equal(result.action,'BLOCK');assert.equal(result.keep,false);
  }
  assert.notEqual(evaluateDomainPolicy('https://amazon.com.example.org',{config}).action,'BLOCK');
  assert.equal(evaluateDomainPolicy('https://classified-spam.example.org',{config,sourceKind:'SEO_SPAM'}).keep,false);
  assert.equal(evaluateDomainPolicy('https://classified-scrape.example.org',{config,sourceKind:'SCRAPE_AGGREGATOR'}).action,'BLOCK');
});
test('MC06 social/news/directory hints are retained and not identity evidence',()=>{
  for(const host of ['linkedin.com','facebook.com','instagram.com','reuters.com','kompass.com','emirates-online.net']){
    const result=evaluateDomainPolicy(`https://${host}`,{config});assert.equal(result.action,'DEPRIORITIZE');assert.equal(result.keep,true);assert.equal(result.identity_evidence,false);
  }
  assert.equal(evaluateDomainPolicy('https://industry-directory.example.org',{config,verifiedOfficialDomain:'industry-directory.example.org',sourceKind:'DIRECTORY'}).action,'DEPRIORITIZE');
});
test('MC06 official domain priority requires explicit prior identity and never proves identity by itself',()=>{
  assert.equal(evaluateDomainPolicy('https://example.org/about',{config}).action,'DEPRIORITIZE');
  const result=evaluateDomainPolicy('https://www.example.org/contact',{config,verifiedOfficialDomain:'example.org',pageRole:'CONTACT'});
  assert.equal(result.action,'PRIORITIZE');assert.equal(result.identity_evidence,false);
  assert.equal(evaluateDomainPolicy('javascript:alert(1)',{config}).action,'BLOCK');
});
