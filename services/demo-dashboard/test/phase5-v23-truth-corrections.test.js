import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { explicitCustomerPriceBand, weightedHistoricalCoverage } from '../src/matching/icpProfileService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/021_phase5_v23_truth_corrections.sql'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'services/demo-dashboard/src/referenceData/sharedHistoryImportService.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'services/demo-dashboard/src/server.js'), 'utf8');

test('historical customer price bands use only explicit price and currency pairs', () => {
  const single = explicitCustomerPriceBand([
    { customer_unit_price: null, customer_sales_currency: 'USD' },
    { customer_unit_price: 1.25, customer_sales_currency: 'USD' },
    { customer_unit_price: 9, customer_sales_currency: 'USD' },
    { customer_unit_price: 100, customer_sales_currency: 'UNKNOWN' }
  ]);
  assert.deepEqual({ sample: single.sampleSize, currency: single.value.currency, min: single.value.min, max: single.value.max },
    { sample: 2, currency: 'USD', min: 1.25, max: 9 });

  const mixed = explicitCustomerPriceBand([
    { customer_unit_price: 5, customer_sales_currency: 'USD' },
    { customer_unit_price: 80, customer_sales_currency: 'CNY' }
  ]);
  assert.equal(mixed.value.status, 'AVAILABLE_MULTICURRENCY');
  assert.equal(mixed.value.currency, 'MULTIPLE');
  assert.equal(mixed.value.min, null);
  assert.deepEqual(mixed.value.bands.map(band => band.currency), ['CNY','USD']);
});

test('historical coverage weights real order, price and repeat coverage without fabricated MOQ', () => {
  const coverage = weightedHistoricalCoverage({
    buyer_types: 100, markets: 100, product_categories: 100,
    order_quantity: 97.14, customer_price_band: 24.29, repeat_orders: 100,
    commercial_moq: 0, company_sizes: 0, channels: 0,
    distribution_patterns: 0, historical_win_similarity: 0
  });
  assert.equal(coverage, 63.21);
});

test('truth-correction migration scopes import identity per batch and removes inferred MOQ', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS reference_data_imports_import_type_content_sha256_key/);
  assert.match(migration, /idx_reference_import_batch_content_once[\s\S]*import_batch_id, import_type, content_sha256/);
  assert.match(migration, /idx_reference_import_unbatched_content_once[\s\S]*import_batch_id IS NULL/);
  assert.match(migration, /idx_reference_import_row_identity_per_import[\s\S]*import_id, source_identity_key/);
  assert.match(migration, /replays_import_row_id/);
  assert.match(migration, /UPDATE leadgen\.product_master[\s\S]*SET moq=NULL[\s\S]*SHARED_TF1/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+leadgen\.(?:historical|product_master)/i);
});

test('importer owns observations by batch and versions changed orders from PostgreSQL history', () => {
  assert.match(importer, /WHERE import_batch_id=\$1 AND import_type=\$2 AND content_sha256=\$3/);
  assert.match(importer, /importVersion,changedSource \? priorRecord\.id : null/);
  assert.match(importer, /rowStatus = replay\.rowCount \? 'DUPLICATE'/);
  assert.match(importer, /historical-order:\$\{p\.source_system\}:\$\{p\.external_order_id\}/);
  assert.match(importer, /sourceVersion = latest\.rowCount \? Number\(latest\.rows\[0\]\.source_version\) \+ 1 : 1/);
  assert.match(importer, /EXACT_CONFIRMED_ALIAS_AND_MARKET/);
  assert.match(importer, /EXACT_DOMAIN_AND_MARKET/);
});

test('all prospect-list routes share confirmed existing-customer exclusion and MX rebuild routing', () => {
  assert.match(server, /const excludesConfirmedExistingCustomerSql/);
  assert.ok((server.match(/excludesConfirmedExistingCustomerSql\('c'\)/g) || []).length >= 3);
  assert.match(server, /reference_market: clean\(req\.body\?\.reference_market\)\.toUpperCase\(\)/);
});
