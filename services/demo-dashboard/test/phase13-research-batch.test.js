import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeBatchInput,buildScopeSnapshot,canonicalResearchScope,createOrReuseResearchJob} from '../src/researchBatch/ResearchBatchService.js';

const first='10000000-0000-4000-8000-000000000001';
const second='10000000-0000-4000-8000-000000000002';
const revision='20000000-0000-4000-8000-000000000001';
const options=()=>({markets:[
  {market_code:'AE',country_name:'United Arab Emirates',status:'ACTIVE',search_enabled:true,market_profile:'AE',languages:['en'],buyer_types:['Importer']},
  {market_code:'MX',country_name:'Mexico',status:'ACTIVE',search_enabled:true,market_profile:'MX',languages:['es','en'],buyer_types:['Wholesaler']},
  {market_code:'BD',country_name:'Bangladesh',status:'HIDDEN',search_enabled:false,market_profile:'BD',languages:['en'],buyer_types:['Importer']},
  {market_code:'US',country_name:'United States',status:'ACTIVE',search_enabled:false,market_profile:'US',languages:['en'],buyer_types:['Importer']}
],categories:[
  {id:first,scope_revision_id:revision,category_code:'TOPS',product_profile:'WOMENSWEAR',scope_status:'ACTIVE',approval_status:'APPROVED'},
  {id:second,scope_revision_id:revision,category_code:'HOUSEHOLD',product_profile:'GENERAL_MERCHANDISE',scope_status:'ACTIVE',approval_status:'APPROVED'},
  {id:'10000000-0000-4000-8000-000000000003',category_code:'DRAFT',scope_status:'ACTIVE',approval_status:'DRAFT'}
]});
const single=()=>({market_codes:['AE'],category_scope_ids:[first]});

test('MC05 all selection expands only active/search-enabled markets and active approved categories',()=>{
  const snapshot=buildScopeSnapshot(normalizeBatchInput({select_all_markets:true,select_all_categories:true}),options());
  assert.deepEqual(snapshot.markets.map(m=>m.market_code),['AE','MX']);
  assert.equal(snapshot.categories.length,2);assert.equal(snapshot.scopes.length,4);
  assert.equal(snapshot.scopes.find(s=>s.market_code==='MX').preferred_language,'es');
  assert.deepEqual(snapshot.scopes.find(s=>s.market_code==='MX').languages,['es','en']);
});
test('MC05 single and mixed multiselection preserve precise counts',()=>{
  assert.equal(buildScopeSnapshot(normalizeBatchInput(single()),options()).scopes.length,1);
  assert.equal(buildScopeSnapshot(normalizeBatchInput({...single(),market_codes:['AE','MX']}),options()).scopes.length,2);
  assert.equal(buildScopeSnapshot(normalizeBatchInput({...single(),category_scope_ids:[first,second]}),options()).scopes.length,2);
});
test('MC05 hidden markets remain excluded even if a registry incorrectly marks BD active',()=>{
  const catalog=options();catalog.markets[2].status='ACTIVE';catalog.markets[2].search_enabled=true;
  assert.throws(()=>buildScopeSnapshot(normalizeBatchInput({...single(),market_codes:['BD']}),catalog),{code:'RESEARCH_ACTIVE_MARKET_REQUIRED'});
});
test('MC05 empty, stale and unapproved selections fail before a job exists',()=>{
  assert.throws(()=>buildScopeSnapshot(normalizeBatchInput({}),options()),{code:'RESEARCH_ACTIVE_MARKET_REQUIRED'});
  assert.throws(()=>buildScopeSnapshot(normalizeBatchInput({...single(),category_scope_ids:[]}),options()),{code:'RESEARCH_APPROVED_CATEGORY_REQUIRED'});
  assert.throws(()=>buildScopeSnapshot(normalizeBatchInput({...single(),category_scope_ids:['10000000-0000-4000-8000-000000000003']}),options()),{code:'RESEARCH_APPROVED_CATEGORY_REQUIRED'});
});
test('MC05 snapshot copies category, market, languages and buyer values independently of registry changes',()=>{
  const catalog=options();const snapshot=buildScopeSnapshot(normalizeBatchInput(single()),catalog);
  catalog.markets[0].languages.push('fr');catalog.markets[0].buyer_types.push('Distributor');
  catalog.categories[0].category_code='REPLACED';
  assert.deepEqual(snapshot.scopes[0].languages,['en']);assert.deepEqual(snapshot.scopes[0].buyer_types,['Importer']);
  assert.equal(snapshot.categories[0].category_code,'TOPS');assert.equal(snapshot.scopes[0].product_category,'TOPS');
});
test('MC05 request normalization is order/repeated-selection independent',()=>{
  assert.deepEqual(normalizeBatchInput({market_codes:['mx','AE','AE'],category_scope_ids:[second,first,first],buyer_types:['Importer','Wholesaler']}),
    normalizeBatchInput({market_codes:['AE','MX'],category_scope_ids:[first,second],buyer_types:['Wholesaler','Importer']}));
  assert.throws(()=>normalizeBatchInput({...single(),max_results:101}),{code:'RESEARCH_MAX_RESULTS_INVALID'});
  assert.throws(()=>normalizeBatchInput({...single(),buyer_types:[]}),{code:'RESEARCH_BUYER_TYPES_INVALID'});
});
test('MC05 canonical active scope ignores requested budget/targets but preserves market category and location',()=>{
  const base={country_code:'AE',product_category:'women tops',product_profile:'WOMENSWEAR',city:' Dubai ',max_results:20};
  assert.equal(canonicalResearchScope(base),canonicalResearchScope({...base,product_category:'WOMEN_TOPS',city:'dubai',max_results:100,buyer_types:['Importer']}));
  assert.notEqual(canonicalResearchScope(base),canonicalResearchScope({...base,country_code:'MX'}));
  assert.equal(canonicalResearchScope(base),canonicalResearchScope({...base,product_profile:null}));
});
test('MC05 same active job from legacy origin is reused without insert or provider check',async()=>{
  const job={id:first,country_code:'AE',product_category:'Tops',product_profile:null,status:'DISCOVERING',buyer_types:['Importer']};
  const queries=[];let checked=0;
  const client={query:async(sql,args)=>{queries.push(sql);return sql.includes("job_type='COMPANY_DISCOVERY'")?{rows:[job],rowCount:1}:{rows:[],rowCount:0};}};
  const result=await createOrReuseResearchJob(client,{payload:{...job,product_category:'TOPS',product_profile:'WOMENSWEAR',max_results:100},idempotencyKey:'unit-reused',requestDigest:'a'.repeat(64),identity:'tester',role:'MANAGEMENT',beforeInsert:async()=>{checked++;}});
  assert.equal(result.id,first);assert.equal(result.active_scope_reused,true);assert.equal(result.inserted,false);
  assert.equal(checked,0);assert.equal(queries.some(q=>q.includes('INSERT INTO leadgen.research_jobs')),false);
  assert.equal(queries.some(q=>q.includes('INSERT INTO leadgen.research_job_scope_requests')),true);
});
test('MC05 retry after terminal transition resolves immutable alias rather than creating a new job',async()=>{
  const client={query:async sql=>sql.includes('a.request_digest alias_digest')?{rows:[{id:first,status:'COMPLETED',alias_digest:'b'.repeat(64),alias_actor:'tester'}],rowCount:1}:{rows:[],rowCount:0}};
  const input={payload:{},idempotencyKey:'replay',requestDigest:'b'.repeat(64),identity:'tester'};
  assert.equal((await createOrReuseResearchJob(client,input)).id,first);
  await assert.rejects(createOrReuseResearchJob(client,{...input,requestDigest:'c'.repeat(64)}),{code:'RESEARCH_IDEMPOTENCY_CONFLICT'});
});
test('MC05 schema is additive and snapshot/child/request history is guarded',()=>{
  const sql=readFileSync(new URL('../../../database/migrations/059_phase13_research_batches.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\.(?:opportunity_pool|companies|sources|contacts)/i);
  assert.match(sql,/research_batch_snapshot_immutable/);assert.match(sql,/research_batch_child_immutable/);
  assert.match(sql,/research_batch_request_immutable/);assert.match(sql,/research_job_scope_request_immutable/);
  assert.match(sql,/FOR UPDATE;[\s\S]*UPDATE leadgen.research_batches/);
  assert.doesNotMatch(sql,/DROP TABLE|ALTER TABLE leadgen.research_jobs/i);
});
