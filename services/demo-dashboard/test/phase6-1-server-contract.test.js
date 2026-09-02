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

test('opportunities use one stable row per company and product profile with all V3 decision fields',()=>{
  const block=routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  for(const field of [
    'opportunity_key','product_profile','category_procurement_match_score','category_procurement_match_band',
    'category_procurement_match_status','category_procurement_coverage','buyer_business_model','buyer_subtype',
    'observed_categories','match_basis','matched_scopes','observed_customer_categories',
    'supplier_access_band','product_access_matrix','readiness','readiness_blockers'
  ]) assert.match(block,new RegExp(`\\b${field}\\b`));
  for(const removed of ['top_product_opportunity','product_opportunity_count','product_opportunity_status','sku_readiness_status']){
    assert.doesNotMatch(block,new RegExp(`\\b${removed}\\b`));
  }
  assert.match(block,/company_id[^\n]*(?:\|\||concat)[^\n]*product_profile|concat[^\n]*company_id[^\n]*product_profile/i);
  assert.doesNotMatch(block,/DISTINCT\s+ON\s*\(\s*c\.id\s*\)/i);
});

test('opportunity filters expose every V3 buyer/category/matrix facet',()=>{
  const block=routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  for(const filter of ['buyer_business_model','buyer_subtype','category_procurement_match_band','category_procurement_match_status','product_access_matrix']) {
    assert.match(block,new RegExp(`req\\.query\\.${filter}|req\\.query\\[['\"]${filter}['\"]\\]`));
  }
});

test('default opportunity order prioritizes PASS, direct buyer, match band/score, buyer/contact, access and legacy scores',()=>{
  const block=routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  const declaration=block.match(/const\s+default\w*Order\s*=/i);
  assert.ok(declaration,'missing default V3 opportunity-order declaration');
  const orderStart=declaration.index;
  const orderEnd=block.indexOf(';',orderStart);
  const orderBlock=block.slice(orderStart,orderEnd>orderStart?orderEnd:orderStart+5000);
  const positions=[
    /CATEGORY_PROCUREMENT_MATCH/i,/DIRECT_END_BUYER/i,/category_procurement_match_(?:band|score)|cpm\.(?:band|score)/i,
    /decision_maker|buyer_name|buyer_department/i,/contact_verification|best_contact/i,/supplier_access_band/i,
    /product_access_matrix/i,/customer_match/i,/historical_customer_match/i,/dpv_score/i
  ].map(pattern=>orderBlock.search(pattern));
  assert.equal(positions.every(position=>position>=0),true,`missing V3 order term: ${positions}`);
  for(let index=1;index<positions.length;index+=1) assert.ok(positions[index]>positions[index-1],`order term ${index} is out of sequence`);
  assert.match(orderBlock,/NULLS LAST/);
});

test('V3 Product Access Matrix remains separate from Phase 5 and Phase 6 matrices/scores',()=>{
  const block=routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  assert.match(block,/mr\.opportunity_matrix|customer_match.*opportunity_matrix/i);
  assert.match(block,/access_opportunity_matrix/);
  assert.match(block,/product_access_matrix/);
  assert.match(block,/dpv_score/);
  assert.match(block,/customer_match/);
  assert.match(block,/historical_customer_match/);
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
