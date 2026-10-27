import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {applyPhase7Migrations,GLOBAL_MARKETS_CATEGORIES_SEARCH_COST_MIGRATION_KEY} from '../src/phase7/migrationRunner.js';
import {ResearchBatchService} from '../src/researchBatch/ResearchBatchService.js';
import {SearchPlanService} from '../src/searchPlanning/SearchPlanService.js';
import {SearchCostControl,loadSearchCostConfig} from '../src/search/SearchCostControl.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';
import {PgFrozenSearchStore} from '../src/search/PgFrozenSearchStore.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';

// Isolated PostgreSQL proof for migration 065 and the search cost controls. Zero provider calls:
// the search provider below is an in-process double.
//   GLOBAL_MARKETS_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
// Each test builds its own throwaway database from the migration files.
const adminUrl=process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const actor={identity:'simon',role:'MANAGEMENT'};

async function withDatabase(source,run){
  const name=`gm_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(source?`CREATE DATABASE ${name} TEMPLATE ${pg.escapeIdentifier(source)}`:`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:6});
  try{return await run(pool,name);}
  finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

// An existing installation at 064: every file through 064 applied and recorded in the runner ledger.
async function databaseAt064(pool){
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)&&file<'065').sort();
  for(const file of files)await pool.query(await readFile(path.join(migrations,file),'utf8'));
  for(const file of files.filter(file=>file>='025')){
    const sql=await readFile(path.join(migrations,file),'utf8');
    await pool.query(`INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by) VALUES($1,$2,'test-064')`,
      [file,crypto.createHash('sha256').update(sql).digest('hex')]);
  }
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function approveCategories(pool,keys){
  const scopes=new CategoryScopeService({pool});
  const candidates=await scopes.listCandidates();
  const picked=keys.map(key=>candidates.find(c=>`${c.product_profile}:${c.normalized_category}`===key));
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:digest(keys.join()),actor:'simon',
    scopes:picked.map((c,i)=>({client_key:`s${i}`,product_profile:c.product_profile,normalized_category:c.normalized_category,source_fact_digest:c.source_fact_digest}))});
  return scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:digest(`a:${keys.join()}`),actor:'simon',actor_role:'MANAGEMENT'});
}

function mockProvider(){
  const calls=[];
  return {calls,provider:{name:'exa',endpoint:'https://search.invalid/search',search:async request=>{
    calls.push(request.query);
    return {provider:'exa',query:request.query,credits:1,costDollars:{total:0.007},
      results:[1,2].map(rank=>({title:`Buyer ${rank}`,url:`https://buyer-${rank}-${crypto.createHash('md5').update(request.query).digest('hex').slice(0,8)}.example/`,snippet:'Importer',rank,provider_score:null}))};
  }}};
}

function services(pool,env={}){
  const costControl=new SearchCostControl({pool,config:loadSearchCostConfig(env),providerOrder:async()=>['exa']});
  const planning=new SearchPlanService({pool});
  return {costControl,planning,batches:new ResearchBatchService({pool,planning,costControl})};
}

test('migration 065 applies to a fresh database built from every migration file and baselines',{skip:!adminUrl},async()=>{
  await withDatabase(null,async(pool,name)=>{
    const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
    assert.ok(files.includes(GLOBAL_MARKETS_CATEGORIES_SEARCH_COST_MIGRATION_KEY));
    for(const file of files)await pool.query(await readFile(path.join(migrations,file),'utf8'));
    const result=await applyPhase7Migrations({pool,expectedDatabase:name,baseline:true});
    assert.equal(result.globalMarketsCategoriesSearchCost.status,'BASELINED');
    const replay=await applyPhase7Migrations({pool,expectedDatabase:name});
    assert.equal(replay.globalMarketsCategoriesSearchCost.status,'SKIPPED_ALREADY_APPLIED');
  });
});

test('migration 065 applies through the runner on a database at 064 and enforces search cost controls',{skip:!adminUrl},async()=>{
  await withDatabase(null,async(pool,name)=>{
    await databaseAt064(pool);
    await approveCategories(pool,['WOMENSWEAR:DRESSES','WOMENSWEAR:TOPS']);
    const applied=await applyPhase7Migrations({pool,expectedDatabase:name});
    assert.equal(applied.globalMarketsCategoriesSearchCost.status,'APPLIED');
    assert.equal(applied.crmFollowupPipeline.status,'SKIPPED_ALREADY_APPLIED');

    const categories=(await pool.query(`SELECT id,normalized_category FROM leadgen.dpv_product_category_scope_current
      WHERE scope_status='ACTIVE' AND approval_status='APPROVED' ORDER BY normalized_category`)).rows;
    assert.ok(categories.length>=2,'template needs at least two approved categories');
    const [first,second]=categories;

    // Per-batch query cap.
    const capped=services(pool,{SEARCH_MAX_QUERIES_PER_BATCH:'5'});
    await assert.rejects(capped.batches.create({market_codes:['AE'],category_scope_ids:[first.id],idempotency_key:'cap-1'},actor),
      {code:'SEARCH_BATCH_QUERY_CAP_EXCEEDED',status:409});
    assert.equal(Number((await pool.query('SELECT count(*) FROM leadgen.research_jobs')).rows[0].count),0);

    // A batch within the caps freezes its estimate.
    const {batches,costControl}=services(pool,{});
    const preview=await batches.preview({market_codes:['AE'],category_scope_ids:[first.id]});
    assert.ok(preview.estimated_queries>0);assert.equal(preview.creation_allowed,true);
    const batch=await batches.create({market_codes:['AE'],category_scope_ids:[first.id],idempotency_key:'run-1'},actor);
    assert.equal(batch.estimated_queries,preview.estimated_queries);
    const jobOne=batch.children[0].research_job_id;

    // First run calls the provider once per planned query.
    const mock=mockProvider();
    const router={select:async()=>({provider:'exa',reason:'TEST_ORDER'}),provider:()=>mock.provider};
    const executor=new FrozenSearchPlanExecutor({pool,store:new PgFrozenSearchStore({pool}),router,costControl});
    const runOne=await executor.executeJob(jobOne);
    assert.equal(runOne.status,'COMPLETED');assert.equal(mock.calls.length,preview.estimated_queries);
    const spend=await costControl.monthSpend();
    assert.equal(spend.recorded_queries,mock.calls.length);
    assert.ok(Math.abs(spend.recorded_cost_usd-mock.calls.length*0.007)<1e-6);

    // A later run of the same scope reuses every stored result without another provider call.
    await pool.query(`UPDATE leadgen.research_jobs SET status='COMPLETED',completed_at=now() WHERE id=$1`,[jobOne]);
    const again=await batches.preview({market_codes:['AE'],category_scope_ids:[first.id]});
    assert.equal(again.search_cost.estimated_reused_queries,again.estimated_queries);assert.equal(again.estimated_cost_usd,0);
    const batchTwo=await batches.create({market_codes:['AE'],category_scope_ids:[first.id],idempotency_key:'run-2'},actor);
    const jobTwo=batchTwo.children[0].research_job_id;assert.notEqual(jobTwo,jobOne);
    const before=mock.calls.length;
    const runTwo=await executor.executeJob(jobTwo);
    assert.equal(runTwo.status,'COMPLETED');assert.equal(mock.calls.length,before,'reuse must not call the provider');
    assert.equal(runTwo.reused_queries,again.estimated_queries);
    const reuseEvents=(await pool.query(`SELECT status,used_units,result_payload->'audit' audit FROM leadgen.provider_usage_events
      WHERE research_job_id=$1`,[jobTwo])).rows;
    assert.equal(reuseEvents.length,again.estimated_queries);
    assert.ok(reuseEvents.every(row=>row.status==='SKIPPED'&&row.used_units===0&&row.audit.reuse===true&&row.audit.provider_cost_usd===0));
    assert.ok(Number((await pool.query(`SELECT count(*) FROM leadgen.research_candidates WHERE research_job_id=$1`,[jobTwo])).rows[0].count)>0);
    const unchanged=await costControl.monthSpend();
    assert.equal(unchanged.recorded_cost_usd,spend.recorded_cost_usd);

    // Category-independent coverage queries of a second category are reused too; only new precision text is paid.
    const third=await batches.create({market_codes:['AE'],category_scope_ids:[second.id],idempotency_key:'run-3'},actor);
    const beforeThird=mock.calls.length;
    const runThree=await executor.executeJob(third.children[0].research_job_id);
    assert.ok(runThree.reused_queries>0);assert.equal(mock.calls.length-beforeThird,third.estimated_queries-runThree.reused_queries);

    // Monthly budget: creation is refused and queued work pauses before a paid call.
    const tight=services(pool,{SEARCH_MAX_USD_PER_MONTH:String(unchanged.recorded_cost_usd)});
    await pool.query(`UPDATE leadgen.research_market_registry SET status='ACTIVE',search_enabled=true WHERE market_code='MX'`);
    await assert.rejects(tight.batches.create({market_codes:['MX'],category_scope_ids:[first.id],idempotency_key:'budget-1'},actor),
      {code:'SEARCH_MONTHLY_BUDGET_EXCEEDED',status:409});
    const queued=await batches.create({market_codes:['MX'],category_scope_ids:[first.id],idempotency_key:'budget-2'},actor);
    const paused=await new FrozenSearchPlanExecutor({pool,store:new PgFrozenSearchStore({pool}),router,costControl:tight.costControl})
      .executeJob(queued.children[0].research_job_id);
    assert.equal(paused.status,'PAUSED_SEARCH_MONTHLY_BUDGET');

    const estimate=(await pool.query('SELECT estimated_queries FROM leadgen.research_batch_cost_estimates WHERE batch_id=$1',[batch.batch_id])).rows[0];
    assert.equal(estimate.estimated_queries,preview.estimated_queries);
    await assert.rejects(pool.query('DELETE FROM leadgen.research_batch_cost_estimates WHERE batch_id=$1',[batch.batch_id]),/append-only/);
  });
});

test('registry markets: 065 seeds inactive markets, management toggle is audited and enabled markets plan in their language',{skip:!adminUrl},async()=>{
  const {MarketRegistryService}=await import('../src/market/MarketRegistryService.js');
  await withDatabase(null,async(pool,name)=>{
    await databaseAt064(pool);
    const before=(await pool.query(`SELECT market_code,status,search_enabled,languages,updated_at FROM leadgen.research_market_registry
      WHERE market_code IN('AE','MX') ORDER BY market_code`)).rows;
    await approveCategories(pool,['WOMENSWEAR:DRESSES']);
    await applyPhase7Migrations({pool,expectedDatabase:name});
    assert.deepEqual((await pool.query(`SELECT market_code,status,search_enabled,languages,updated_at FROM leadgen.research_market_registry
      WHERE market_code IN('AE','MX') ORDER BY market_code`)).rows,before);
    const seeded=(await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='INACTIVE' AND NOT search_enabled)::int inactive
      FROM leadgen.research_market_registry WHERE source_reference LIKE 'migration-065:%'`)).rows[0];
    assert.deepEqual(seeded,{total:34,inactive:34});
    assert.equal(Number((await pool.query(`SELECT count(*) FROM leadgen.research_market_registry r
      WHERE NOT EXISTS(SELECT 1 FROM pg_timezone_names z WHERE z.name=r.timezone)`)).rows[0].count),0);

    const markets=new MarketRegistryService({pool});
    assert.ok((await markets.list()).some(row=>row.market_code==='DE'&&row.status==='INACTIVE'));
    assert.ok(!(await markets.list()).some(row=>row.market_code==='BD'));
    const enabled=await markets.setSearchEnabled('DE',{search_enabled:true,actor:'simon',role:'MANAGEMENT'});
    assert.equal(enabled.status,'ACTIVE');assert.equal(enabled.search_enabled,true);assert.equal(enabled.changed,true);
    assert.equal((await markets.setSearchEnabled('DE',{search_enabled:true,actor:'simon',role:'MANAGEMENT'})).changed,false);
    await assert.rejects(markets.setSearchEnabled('BD',{search_enabled:true,actor:'simon',role:'MANAGEMENT'}),{code:'MARKET_HIDDEN'});
    await assert.rejects(markets.setSearchEnabled('ZZ',{search_enabled:true,actor:'simon',role:'MANAGEMENT'}),{code:'MARKET_NOT_FOUND'});

    const {batches}=services(pool,{});
    const category=(await pool.query(`SELECT id FROM leadgen.dpv_product_category_scope_current WHERE normalized_category='DRESSES'`)).rows[0].id;
    const preview=await batches.preview({market_codes:['DE'],category_scope_ids:[category]});
    assert.deepEqual(preview.languages,['de','en']);
    assert.ok(preview.search_plan.samples.PRECISION_LANE.some(q=>q.original_query.includes('Deutschland')));
    assert.deepEqual(preview.research_scope_snapshot.scopes[0].country_terms,{de:'Deutschland',en:'Germany'});

    const disabled=await markets.setSearchEnabled('DE',{search_enabled:false,actor:'simon',role:'MANAGEMENT'});
    assert.equal(disabled.search_enabled,false);assert.equal(disabled.status,'ACTIVE');
    await assert.rejects(batches.preview({market_codes:['DE'],category_scope_ids:[category]}),{code:'RESEARCH_ACTIVE_MARKET_REQUIRED'});
    const events=await markets.events('DE');
    assert.deepEqual(events.map(e=>[e.previous_search_enabled,e.search_enabled,e.actor]),[[true,false,'simon'],[false,true,'simon']]);
    await assert.rejects(pool.query(`UPDATE leadgen.research_market_registry_events SET actor='x'`),/append-only/);
    assert.deepEqual(await markets.activeMarketCodes(),['AE','DE','MX']);
  });
});

test('custom category: draft with multilingual aliases, approval, observation from an alias and an active opportunity pool band',{skip:!adminUrl},async()=>{
  const {ApprovedCategoryAliasRefresher}=await import('../src/categoryProcurement/approvedCategoryAliases.js');
  const {extractCategoryBuyerObservations}=await import('../src/categoryProcurement/categoryObservationExtractor.js');
  const {CategoryEvidenceService}=await import('../src/categoryProcurement/CategoryEvidenceService.js');
  const {OpportunityPoolService}=await import('../src/opportunityPool/OpportunityPoolService.js');
  const {setApprovedCategoryAliases}=await import('../src/productMatch/productTaxonomy.js');
  await withDatabase(null,async(pool,name)=>{
    await databaseAt064(pool);
    await approveCategories(pool,['WOMENSWEAR:DRESSES']);
    await applyPhase7Migrations({pool,expectedDatabase:name});
    const scopes=new CategoryScopeService({pool});
    const draft=await scopes.createCustomDraft({product_profile:'WOMENSWEAR',normalized_category:'Swimwear',taxonomy_id:'aa-1-20',actor:'simon',
      names:{en:'Swimwear',es:'Trajes de baño',zh:'泳装',de:'Bademode',ar:'ملابس السباحة'}});
    assert.equal(draft.approval_status,'DRAFT');assert.equal(draft.scope_count,2);assert.equal(draft.alias_count,5);
    await assert.rejects(scopes.createCustomDraft({product_profile:'WOMENSWEAR',normalized_category:'DRESSES',names:{en:'Dresses'},actor:'simon'}),
      {code:'CATEGORY_SCOPE_ALREADY_APPROVED'});
    // Drafts do not change what the classifier or research may use.
    const refresher=new ApprovedCategoryAliasRefresher({pool,ttlMs:0});
    await refresher.refresh({force:true});
    const html=`<html><body><p>Visit our stores across Germany.</p><div class="product-card"><h3>Bademode Riviera</h3><span class="category">Bademode</span></div></body></html>`;
    const extract=()=>extractCategoryBuyerObservations({html,source_url:'https://strand.example/bademode',source_authority:'OFFICIAL_STOREFRONT',
      company_name:'Strand Mode GmbH',product_profile:'WOMENSWEAR'}).filter(row=>row.observation_type!=='RETAIL_CHANNEL'&&row.observation_type!=='STORE_NETWORK');
    assert.equal(extract().length,0);
    const approved=await scopes.approveRevision({draft_revision_id:draft.id,revision:draft.revision+1,source_reference:'custom-test',
      source_digest:digest('approve-swimwear'),actor:'simon',actor_role:'MANAGEMENT'});
    assert.equal(approved.scope_count,2);assert.equal(approved.alias_count,5);
    // effective_from comes from the application clock, which may run slightly ahead of the database clock.
    await new Promise(resolve=>setTimeout(resolve,250));
    const languages=(await pool.query(`SELECT a.language FROM leadgen.dpv_product_category_scope_aliases a
      JOIN leadgen.dpv_product_category_scope_current c ON c.id=a.scope_id AND c.scope_revision_id=a.scope_revision_id
      WHERE c.normalized_category='SWIMWEAR' ORDER BY 1`)).rows.map(row=>row.language);
    assert.deepEqual(languages,['ar','de','en','es','zh']);
    await refresher.refresh({force:true});
    try{
      const products=extract();
      assert.equal(products.length,1);assert.equal(products[0].normalized_category,'SWIMWEAR');assert.equal(products[0].normalized_profile,'WOMENSWEAR');

      // Persist through the existing evidence service and classify with the existing opportunity pool.
      const company=(await pool.query(`INSERT INTO leadgen.companies(company_name,normalized_domain,country_code,country_name,website_url,official_root_domain,verification_status)
        VALUES('Strand Mode GmbH','strand.example','DE','Germany','https://strand.example','strand.example','VERIFIED') RETURNING id`)).rows[0];
      const job=(await pool.query(`INSERT INTO leadgen.research_jobs(country,country_code,country_name,market_profile,product_category,max_results,job_type)
        VALUES('Germany','DE','Germany','DE','SWIMWEAR',5,'CATEGORY_PROCUREMENT_ENRICHMENT') RETURNING id`)).rows[0];
      const evidence=new CategoryEvidenceService({pool,provider:{name:'test',search:async()=>{throw new Error('no provider calls');}},aliasRefresher:refresher});
      const source=await evidence.persistSource({researchJobId:job.id,companyId:company.id,url:'https://strand.example/bademode',sourceType:'OFFICIAL_STOREFRONT',
        authority:'OFFICIAL_STOREFRONT',capturedAt:new Date()});
      for(const item of extractCategoryBuyerObservations({html,source_url:'https://strand.example/bademode',source_authority:'OFFICIAL_STOREFRONT',
        company_name:'Strand Mode GmbH',product_profile:'WOMENSWEAR'}))await evidence.persistObservation(source,item);
      const target=await evidence.targetCategory('WOMENSWEAR','SWIMWEAR',['de','en']);
      assert.deepEqual(target.aliases.slice(0,2),['Bademode','Swimwear']);

      const preview=await new OpportunityPoolService({pool}).preview({companyIds:[company.id]});
      const row=preview.rows[0];
      assert.ok(['PRECISION','RELEVANT'].includes(row.opportunity_pool_band),row.opportunity_pool_band);
      assert.equal(row.is_active_business_opportunity,true);
      const swim=row.profile_results.find(result=>result.product_profile==='WOMENSWEAR');
      assert.equal(swim.category_basis,'EXACT_CATEGORY');
    }finally{setApprovedCategoryAliases([]);}
  });
});
