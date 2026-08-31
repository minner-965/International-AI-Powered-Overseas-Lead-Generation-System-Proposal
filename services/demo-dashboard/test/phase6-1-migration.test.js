import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const migrationPath=path.join(root,'database/migrations/024_phase6_1_category_procurement_match.sql');
const migrationRunnerPath=path.join(root,'services/demo-dashboard/src/categoryProcurement/migrationRunner.js');

function migrationSource(){
  assert.equal(fs.existsSync(migrationPath),true,'V3 migration 024 must exist at the frozen path');
  return fs.readFileSync(migrationPath,'utf8');
}

function javascriptSources(directory){
  if(!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const target=path.join(directory,entry.name);
    if(entry.isDirectory()) return javascriptSources(target);
    return entry.isFile()&&/\.(?:m?js)$/.test(entry.name)?[{target,source:fs.readFileSync(target,'utf8')}]:[];
  });
}

test('V3 migration 024 is transactional, additive-only and preserves all Phase 5/6 history',()=>{
  const sql=migrationSource();
  assert.match(sql,/^\s*BEGIN;/i);
  assert.match(sql,/COMMIT;\s*$/i);
  assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE)\s+(?:TABLE\s+)?leadgen\./i);
  assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+leadgen\./i);
  assert.doesNotMatch(sql,/\bUPDATE\s+leadgen\.(?:companies|product_master|company_score_runs|customer_match_results|cooperation_feasibility_results|decision_makers)/i);
  assert.doesNotMatch(sql,/\bALTER\s+TABLE\s+leadgen\.product_master\s+(?:DROP|RENAME|ALTER\s+COLUMN)/i);
});

test('V3 migration creates catalog snapshot, taxonomy, public evidence, buyer model, match and opportunity entities',()=>{
  const sql=migrationSource();
  for(const table of [
    'product_profile_catalog_snapshots','product_taxonomy_nodes','product_taxonomy_aliases','product_master_taxonomy_assignments',
    'prospect_category_sources','prospect_category_observations','buyer_business_model_results',
    'category_procurement_match_results','category_procurement_match_dimensions','category_procurement_match_evidence',
    'product_opportunity_candidates','product_opportunity_results','product_opportunity_gaps','product_opportunity_gap_evidence'
  ]) assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS leadgen\\.${table}`,'i'));
});

test('catalog snapshots and taxonomy preserve UNKNOWN instead of forcing internal product classification',()=>{
  const sql=migrationSource();
  for(const field of ['snapshot_version','eligible_product_count','classified_product_count','unknown_product_count','source_digest','coverage_percent']) assert.match(sql,new RegExp(`\\b${field}\\b`,'i'));
  for(const status of ['CURRENT_CONFIRMED','HISTORICAL_ORDER_SUPPORTED','REFERENCE_ONLY','REVIEW','EXCLUDED','UNKNOWN']) assert.match(sql,new RegExp(`'${status}'`,'i'));
  assert.match(sql,/product_master_id\s+uuid\s+NOT NULL\s+REFERENCES\s+leadgen\.product_master\s*\(id\)/i);
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\.product_master/i);
});

test('buyer model schema freezes V3 buyer and eligibility enums',()=>{
  const sql=migrationSource();
  for(const model of ['DIRECT_END_BUYER','DISTRIBUTION_BUYER','UNCLEAR_INTERMEDIARY','EXCLUDED_INTERMEDIARY','UNKNOWN']) assert.match(sql,new RegExp(`'${model}'`));
  for(const subtype of ['CHAIN_RETAILER','DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET','LIFESTYLE_RETAILER','ORGANIZED_ECOM_RETAILER','IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING','SOURCING_AGENT','BROKER','OEM_ONLY','OTHER']) assert.match(sql,new RegExp(`'${subtype}'`));
  for(const value of ['ELIGIBLE','NEEDS_EVIDENCE','INELIGIBLE','P1_DIRECT','P2_DISTRIBUTION','REVIEW','EXCLUDED']) assert.match(sql,new RegExp(`'${value}'`));
});

test('Category Procurement Match is profile-specific, nullable, evidence-linked and append-only',()=>{
  const sql=migrationSource();
  for(const field of ['buyer_business_model_result_id','product_profile_catalog_snapshot_id','score','band','match_status','coverage_percent','calculation_version','taxonomy_version','input_digest','execution_key','reason_codes','missing_evidence']) assert.match(sql,new RegExp(`\\b${field}\\b`,'i'));
  for(const status of ['CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','WEAK_CATEGORY_MATCH','PRODUCT_MISMATCH','NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE','INELIGIBLE_BUYER_MODEL']) assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/score\s+(?:numeric|integer)(?![^,;]*NOT NULL)/i);
  assert.match(sql,/UNIQUE\s*\([^)]*(?:execution_key|company_id)[^)]*\)/i);
  assert.doesNotMatch(sql,/UNIQUE\s*\(\s*company_id\s*\)/i);
});

test('Product Opportunity stores only the four V3 recommendation states and real product foreign keys',()=>{
  const sql=migrationSource();
  for(const status of ['READY','PARTIAL_INTERNAL_CATALOG','NO_REAL_CANDIDATE','NOT_RUN_GATE_FAILED']) assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/product_master_id\s+uuid\s+NOT NULL\s+REFERENCES\s+leadgen\.product_master\s*\(id\)/i);
  assert.match(sql,/category_procurement_match_result_id\s+uuid\s+NOT NULL[\s\S]{0,1500}REFERENCES\s+leadgen\.category_procurement_match_results\s*\(id(?:\s*,\s*company_id)?\)/i);
  assert.match(sql,/CHECK\s*\(\s*rank\s+BETWEEN\s+1\s+AND\s+20\s*\)/i);
});

test('Cooperation V3 adds a separate Supplier Access axis and Product Access Matrix without renaming legacy matrices',()=>{
  const sql=migrationSource();
  for(const field of ['category_procurement_match_result_id','supplier_access_score','supplier_access_band','supplier_access_coverage','product_access_matrix','readiness_blockers','cooperation_calculation_version']) assert.match(sql,new RegExp(`\\b${field}\\b`,'i'));
  for(const matrix of ['DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS','DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS','DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS','MEDIUM_PRODUCT_HIGH_ACCESS','MEDIUM_PRODUCT_MEDIUM_ACCESS','LOW_PRODUCT','UNKNOWN_PRODUCT','INELIGIBLE_BUYER_MODEL']) assert.match(sql,new RegExp(`'${matrix}'`));
  assert.doesNotMatch(sql,/RENAME\s+COLUMN\s+(?:access_opportunity_matrix|opportunity_matrix)/i);
});

test('ResearchJob V3 type and all category/buyer query types are additive',()=>{
  const sql=migrationSource();
  assert.match(sql,/'CATEGORY_PROCUREMENT_ENRICHMENT'/);
  for(const queryType of ['category_assortment','retail_channel','store_network','import_activity','wholesale_activity','distribution_network','inventory_warehouse','intermediary_exclusion']) assert.match(sql,new RegExp(`'${queryType}'`));
});

test('V3 migration contains no real company/product fixture, private path or secret',()=>{
  const sql=migrationSource();
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+leadgen\.(?:companies|product_master|prospect_category_sources|prospect_category_observations|category_procurement_match_results)/i);
  assert.doesNotMatch(sql,/https?:\/\/(?!example\.(?:com|test))/i);
  assert.doesNotMatch(sql,/[A-Z]:\\|(?:api[_-]?key|token|password)\s*[=:]/i);
});

test('explicit existing-DB migration runner uses advisory lock, SHA-256 ledger and checksum conflict detection',()=>{
  assert.equal(fs.existsSync(migrationRunnerPath),true,'V3 migration runner must use the frozen categoryProcurement path');
  const sources=[...javascriptSources(path.join(root,'services/demo-dashboard/src')),...javascriptSources(path.join(root,'scripts'))];
  const runner=sources.find(({source})=>/sha-?256/i.test(source)&&/pg_(?:try_)?advisory_(?:xact_)?lock/i.test(source)&&/(?:schema_migrations|migration_(?:key|name)|applied_migrations)/i.test(source));
  assert.ok(runner,'expected an existing-database migration runner');
  assert.match(runner.source,/024_phase6_1_category_procurement_match|PHASE61_MIGRATION_PATH/i);
  assert.match(runner.source,/checksum/i);
  assert.match(runner.source,/applied_at/i);
  assert.match(runner.source,/checksum[\s\S]*(?:mismatch|conflict|different)/i);
  assert.match(runner.source,/process\.argv\.includes\(['"]--apply['"]\)/i,'npm migration command must execute the runner');
  assert.match(runner.source,/DPV_PROJECT_ROOT/i,'container and host must resolve the same migration root');
});
