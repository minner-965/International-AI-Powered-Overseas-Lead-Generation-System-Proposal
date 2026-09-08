import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const server=fs.readFileSync(path.join(root,'services/demo-dashboard/src/server.js'),'utf8');
const queueSource=fs.readFileSync(path.join(root,'services/demo-dashboard/src/jobs/phase5Queue.js'),'utf8');

function routeBlock(start,next,length=24000){
  const from=server.indexOf(start);
  assert.ok(from>=0,`missing ${start}`);
  const to=next?server.indexOf(next,from+start.length):-1;
  return server.slice(from,to>from?to:from+length);
}

test('V3 exposes category procurement, buyer model and category-level opportunity API surface',()=>{
  for(const route of [
    '/api/companies/:id/category-procurement-matches','/api/companies/:id/buyer-business-model',
    '/api/companies/:id/product-opportunities','/api/category-procurement/jobs',
    '/api/category-procurement/jobs/:id','/api/category-procurement/jobs/:id/results',
    '/api/internal/category-procurement/jobs/:id/run'
  ]) assert.ok(server.includes(route),`missing route ${route}`);
  assert.match(server,/app\.post\('\/api\/internal\/category-procurement\/jobs\/:id\/run',\s*requireInternalToken/);
});

test('Category Procurement job POST persists QUEUED ResearchJob before n8n orchestration',()=>{
  const block=routeBlock("app.post('/api/category-procurement/jobs'","app.get('/api/category-procurement/jobs");
  const creator=routeBlock('async function createCategoryProcurementResearchJob','function categoryProcurementJobResponse');
  assert.match(block,/createCategoryProcurementResearchJob/);
  assert.match(block,/'QUEUED'/);
  assert.match(block,/'CATEGORY_PROCUREMENT_ENRICHMENT'/);
  assert.match(block,/WOMENSWEAR/);
  assert.match(block,/GENERAL_MERCHANDISE/);
  assert.match(block,/202/);
  assert.match(creator,/INSERT\s+INTO\s+leadgen\.research_jobs/i);
  assert.match(creator,/'QUEUED'/);
  assert.match(creator,/'CATEGORY_PROCUREMENT_ENRICHMENT'/);
});

test('ordinary V3 APIs project business-safe allowlisted fields only',()=>{
  const start="app.get('/api/companies/:id/category-procurement-matches'";
  const block=routeBlock(start,"app.post('/api/category-procurement/jobs'");
  for(const field of [
    'category_procurement_match_score','category_procurement_match_band','category_procurement_match_status',
    'category_procurement_coverage','buyer_business_model','buyer_subtype','observed_categories',
    'match_basis','matched_scopes','observed_customer_categories','supplier_access_band','product_access_matrix',
    'readiness','readiness_blockers'
  ]) assert.match(block,new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(block,/supplier_price|supplier_currency|customer_sales_price|customer_sales_currency|margin|profit|historical_order_lines|historical_customer_id|historical_order_id|source_import_row_id|source_identity_key|shared_folder_path|asset_reference|raw_internal_payload|internal_description/i);
});

test('current opportunities use the MC04 query with category evidence and historical compatibility',()=>{
  const block=fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js'),'utf8');
  for(const field of [
    'opportunity_key','product_profile','category_procurement_match_score','category_procurement_match_band',
    'category_procurement_match_status','category_procurement_coverage','buyer_business_model','buyer_subtype',
    'observed_categories','match_basis','matched_scopes','observed_customer_categories',
    'opportunity_pool_band','is_active_business_opportunity','currentBusinessProjection'
  ]) assert.match(block,new RegExp(`\\b${field}\\b`));
  for(const removed of ['top_product_opportunity','product_opportunity_count','product_opportunity_status','sku_readiness_status']){
    assert.doesNotMatch(block,new RegExp(`\\b${removed}\\b`));
  }
  assert.match(block,/opportunity_key/);
  assert.match(block,/service\.list\(\{band:'ALL'\}\)/);
});

test('opportunity filters expose category facets without retired access gates',()=>{
  const block=routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  for(const filter of ['buyer_business_model','buyer_subtype','category_procurement_match_band','category_procurement_match_status']) {
    assert.match(block,new RegExp(`req\\.query\\.${filter}|req\\.query\\[['\"]${filter}['\"]\\]`));
  }
});

test('current opportunity order prioritizes approved pool bands then selected score',()=>{
  const block=fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js'),'utf8');
  assert.match(block,/PRECISION:0,RELEVANT:1,GENERAL_RELEVANT:2,EXPLORATORY:3,NOT_SUITABLE:4/);
  assert.match(block,/bandRank\[a\.opportunity_pool_band\]-bandRank\[b\.opportunity_pool_band\]/);
});

test('retired access axes remain explicit history rather than current business gates',()=>{
  const block=fs.readFileSync(path.join(root,'services/demo-dashboard/src/opportunityPool/currentBusinessProjection.js'),'utf8');
  assert.match(block,/historical_compatibility/);
  assert.match(block,/'product_access_matrix'/);
  assert.match(block,/delete current\[key\]/);
});

test('V3 queue topology is bounded at company × product_profile granularity',()=>{
  for(const queue of [
    'collect-category-buyer-evidence','classify-buyer-business-model','calculate-category-procurement-match',
    'calculate-product-opportunities','recalculate-cooperation-v3'
  ]) assert.match(queueSource,new RegExp(queue));
  assert.match(`${queueSource}\n${server}`,/company_id/);
  assert.match(`${queueSource}\n${server}`,/product_profile/);
});

test('V3 queue/job contracts retain retry, timeout and persisted category progress',()=>{
  const source=`${queueSource}\n${server}`;
  assert.match(source,/retry|retryLimit|retry_delay|retryBackoff/i);
  assert.match(source,/timeout|expireIn|expirationSeconds/i);
  for(const counter of [
    'category_profiles_attempted','category_sources_found','category_observations_found',
    'buyer_models_classified','category_matches_passed','category_matches_unknown',
    'product_opportunities_found','category_procurement_errors'
  ]) assert.match(source,new RegExp(counter));
});

test('Category Procurement persistence is append-only and execution-key replay safe',()=>{
  const servicePath=path.join(root,'services/demo-dashboard/src/categoryProcurement/CategoryProcurementService.js');
  assert.equal(fs.existsSync(servicePath),true);
  const source=fs.readFileSync(servicePath,'utf8');
  assert.match(source,/execution_key/i);
  assert.match(source,/INSERT\s+INTO\s+leadgen\.category_procurement_match_results/i);
  assert.doesNotMatch(source,/UPDATE\s+leadgen\.category_procurement_match_results/i);
  assert.doesNotMatch(source,/ON\s+CONFLICT[^;]*DO\s+UPDATE/i);
});

test('fresh VERIFIED + ACTIVE discovery enqueues category/buyer evidence without product_categories prefilter',()=>{
  const source=`${queueSource}\n${server}`;
  assert.match(source,/CATEGORY_PROCUREMENT_ENRICHMENT|collect-category-buyer-evidence/);
  assert.match(source,/VERIFIED/);
  assert.match(source,/ACTIVE/);
  const enqueueBlocks=source.match(/.{0,800}(?:CATEGORY_PROCUREMENT_ENRICHMENT|collect-category-buyer-evidence).{0,1200}/gis)||[];
  assert.ok(enqueueBlocks.length>0);
  assert.equal(enqueueBlocks.some(block=>/product_categories\s*(?:@>|&&|=)/i.test(block)),false);
});

test('V3 n8n workflow exists and keeps Express → n8n → pg-boss boundary',()=>{
  const workflowPath=path.join(root,'workflows/03-phase6_1-category-procurement-match.json');
  assert.equal(fs.existsSync(workflowPath),true);
  const workflow=fs.readFileSync(workflowPath,'utf8');
  assert.match(workflow,/category-procurement/i);
  assert.match(workflow,/internal\/category-procurement\/jobs/i);
  assert.match(workflow,/INTERNAL_API_TOKEN|internalApiToken|x-internal-token/i);
});
