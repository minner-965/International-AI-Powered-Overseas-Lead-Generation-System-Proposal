import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/020_phase5_v23_shared_history.sql'), 'utf8');

test('V2.3 migration adds internal batch and immutable source-file provenance', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.reference_data_import_batches/);
  assert.match(sql, /'DISCOVERED','STAGED','PARSED','VALIDATED','DRY_RUN_PASSED'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.reference_data_source_files/);
  for (const field of [
    'source_unc_path','source_last_modified','source_size','source_sha256',
    'local_staging_path','local_sha256','source_sha256_after','copied_at','hash_verified'
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /data_classification\s+text\s+NOT NULL DEFAULT 'INTERNAL_BUSINESS'/);
  assert.match(sql, /Never emit through public evidence, prospect, opportunity or export APIs/);
});

test('V2.3 row provenance and deterministic identity remain traceable across source versions', () => {
  for (const field of [
    'import_batch_id','source_file_id','source_sheet','source_row','source_hash',
    'source_identity_key','captured_at','canonical_entity_type','canonical_entity_id',
    'supersedes_import_row_id'
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /SHA-256 of entity type \+ source file hash \+ sheet \+ normalized row key/);
  assert.match(sql, /source_identity_key\)\s+WHERE source_identity_key IS NOT NULL/);
  assert.match(sql, /row_status IN \('ACCEPTED','REVIEW','REJECTED','DUPLICATE','COMMITTED'\)/);
});

test('V2.3 models aliases, products, order lines and non-fabricated order dates', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.historical_customer_aliases/);
  assert.match(sql, /resolution_status text NOT NULL DEFAULT 'REVIEW'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.product_master/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.historical_order_lines/);
  assert.match(sql, /ALTER COLUMN order_date DROP NOT NULL/);
  for (const field of [
    'historical_customer_id','delivery_date','order_date_source','unit_price','order_value',
    'commercial_value_type','container_sequence','shipment_reference','product_profile','order_status'
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /Container sequence is not a customer or order identity/);
  assert.match(sql, /order_status IN \('CONFIRMED','CANCELLED','REVIEW','UNKNOWN'\)/);
  assert.match(sql, /Cancelled orders remain auditable/);
});

test('supplier, DPV customer and downstream retail prices have separate values and currencies', () => {
  for (const field of [
    'customer_sales_price','customer_sales_currency','supplier_price','supplier_currency',
    'downstream_retail_price','downstream_retail_currency','unclassified_price','unclassified_currency',
    'customer_unit_price','supplier_unit_price','unclassified_unit_price',
    'customer_sales_value','supplier_cost_value'
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /'DOWNSTREAM_RETAIL_PRICE'/);
  assert.match(sql, /price_type <> 'DOWNSTREAM_RETAIL_PRICE' OR downstream_retail_price IS NOT NULL/);
  assert.match(sql, /'CUSTOMER_SALES_REVENUE','SUPPLIER_COST','FACTORY_QUOTE','UNKNOWN'/);
  assert.match(sql, /order_value IS NULL OR commercial_value_type <> 'UNKNOWN'/);
});

test('same PO can retain source versions while each source identity remains idempotent', () => {
  assert.match(sql, /DROP CONSTRAINT IF EXISTS historical_orders_source_system_external_order_id_key/);
  assert.match(sql, /source_version integer NOT NULL DEFAULT 1/);
  assert.match(sql, /supersedes_historical_order_id uuid/);
  assert.match(sql, /idx_historical_orders_source_version_once[\s\S]*\(source_system, external_order_id, source_version\)/);
  assert.match(sql, /idx_historical_orders_source_identity[\s\S]*\(source_identity_key\)[\s\S]*WHERE source_identity_key IS NOT NULL/);
  assert.match(sql, /source_version = 1 OR \([\s\S]*source_identity_key IS NOT NULL[\s\S]*supersedes_historical_order_id IS NOT NULL/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(source_system,\s*external_order_id\)/);
});

test('confirmed historical-customer links provide the new-prospect exclusion boundary', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.historical_customer_company_links/);
  assert.match(sql, /link_status IN \('CONFIRMED','REVIEW','REJECTED'\)/);
  assert.match(sql, /idx_existing_customer_company_confirmed/);
  assert.match(sql, /customer_role text NOT NULL DEFAULT 'INTERNAL_EXISTING_CUSTOMER'/);
  assert.match(sql, /exclude the public company from the new-prospect pool/);
});

test('historical ICP metadata separates MX reference history from AE application', () => {
  for (const field of [
    'reference_market','application_markets','profile_basis','source_classification',
    'sample_size_customers','win_loss_coverage_status','rebuilt_at','build_key'
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /'MANAGEMENT_DEFINED','CONVERTED_ORDER_HISTORY'/);
  assert.match(sql, /profile_type <> 'HISTORICAL_CUSTOMER_ICP'[\s\S]*status <> 'ACTIVE'[\s\S]*reference_market IS NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_icp_profile_build_once/);
});

test('Customer Match idempotency is profile-specific so two scores stay independent', () => {
  assert.match(sql, /DROP INDEX IF EXISTS leadgen\.idx_customer_match_execution_once/);
  assert.match(sql, /\(company_id, reference_profile_id, execution_key\)/);
  assert.match(sql, /idx_customer_match_latest_by_profile_type/);
  assert.match(sql, /without combining their scores/);
});

test('migration is bounded to Phase 5 V2.3 schema work and inserts no production history', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+leadgen\.(?:historical_customers|historical_orders|historical_lead_outcomes|historical_customer_channels|product_master|historical_order_lines)/i);
  assert.doesNotMatch(sql, /PHASE\s*6/i);
});
