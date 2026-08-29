import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSharedHistoryBundle } from '../src/referenceData/sharedHistoryBundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hash = value => String(value).repeat(64).slice(0, 64);
const sourceFile = ({ name, relative, sha }) => ({
  source_unc_path: `\\\\SERVER\\SHARE\\${relative}`,
  source_relative_path: relative,
  source_filename: name,
  source_last_modified: '2026-08-01T00:00:00Z',
  source_size: 100,
  source_sha256_before: sha,
  local_sha256: sha,
  source_sha256_after: sha,
  local_staging_path: `D:\\staging\\${name}`,
  copied_at: '2026-08-01T00:01:00Z',
  hash_verified: true
});

function fixtures() {
  const tf1Hash = hash('a');
  const poHash = hash('b');
  return {
    manifest: [
      sourceFile({ name: '(36th)TF1-PEDIDO SAMPLEBUYER.xlsx', relative: 'GENERAL MERCHANDISE\\(36th)TF1-PEDIDO SAMPLEBUYER.xlsx', sha: tf1Hash }),
      sourceFile({ name: 'PO-SAMPLE-2026 SAMPLEBUYER-SAMPLECLIENT.xlsx', relative: 'WOMENSWEAR\\PO-SAMPLE-2026 SAMPLEBUYER-SAMPLECLIENT.xlsx', sha: poHash })
    ],
    parsedWorkbooks: [
      { source_filename: '(36th)TF1-PEDIDO SAMPLEBUYER.xlsx', source_sha256: tf1Hash, family: 'TF1', sheets: [{
        source_sheet: 'TF1', parse_status: 'PARSED', header_row: 1,
        headers: ['Serial number','Product name','order volume','Factory price','Customer price'],
        rows: [{ source_row: 2, values: [1,'chair',500,10,15] }]
      }] },
      { source_filename: 'PO-SAMPLE-2026 SAMPLEBUYER-SAMPLECLIENT.xlsx', source_sha256: poHash, family: 'CAVANNA_PO', sheets: [{
        source_sheet: 'SAMPLE-CLIENT', parse_status: 'PARSED', header_row: 11,
        labels: { market: 'MEXICO', client: 'Sample Client', po: 'PO-SAMPLE-2026', date: '2026-05-21T00:00:00' },
        headers: ['STYLE','DESCRIPTION','OC QUANTITY','USD FOB','PRECIO VENTA','DELIVERY DATE'],
        rows: [{ source_row: 12, values: ['ST-1','dress',100,6.5,299,'2026-07-01'] }]
      }] }
    ]
  };
}

test('real-source bundle contract preserves provenance, price meanings and order/delivery dates', () => {
  const fixture = fixtures();
  const bundle = buildSharedHistoryBundle({
    batchKey: 'fixture-batch', ...fixture,
    safety: { source_files_modified: 0,source_files_deleted: 0,source_files_created: 0,source_files_renamed: 0,source_files_moved: 0 }
  });
  assert.equal(bundle.dry_run_passed, true);
  assert.deepEqual([bundle.summary.customers_detected,bundle.summary.orders,bundle.summary.products,bundle.summary.followup_rows], [1,1,2,0]);
  const order = bundle.entities.HISTORICAL_ORDERS[0];
  assert.equal(order.order_date, '2026-05-21');
  assert.equal(order.delivery_date, '2026-07-01');
  assert.equal(order.order_value, 650);
  assert.equal(order.commercial_value_type, 'CUSTOMER_SALES_REVENUE');
  const line = bundle.entities.ORDER_LINES[0];
  assert.equal(line.customer_sales_currency, 'USD');
  assert.equal(line.downstream_retail_price, 299);
  assert.equal(line.downstream_retail_currency, null);
  assert.notEqual(line.source_identity_key, line.product_source_identity_key);
  assert.ok(bundle.entities.PRODUCT_MASTER.every(product => product.moq === null));
  assert.equal(bundle.entities.HISTORICAL_LEAD_OUTCOMES.length, 0);
});

test('sensitive HR or finance source selection fails the production dry-run gate', () => {
  const fixture = fixtures();
  fixture.manifest[0].source_relative_path = '8.财务\\finance.xlsx';
  const bundle = buildSharedHistoryBundle({
    batchKey: 'sensitive-fixture', ...fixture,
    safety: { source_files_modified: 0,source_files_deleted: 0,source_files_created: 0,source_files_renamed: 0,source_files_moved: 0 }
  });
  assert.equal(bundle.dry_run_passed, false);
  assert.ok(bundle.errors.includes('SENSITIVE_SOURCE_SELECTED'));
});

test('server exposes aggregate import batches, dual matches and excludes confirmed existing customers', () => {
  const server = fs.readFileSync(path.join(root, 'services/demo-dashboard/src/server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/import-batches'/);
  assert.match(server, /getLatestReferences/);
  assert.match(server, /management_baseline/);
  assert.match(server, /mx_historical_reference/);
  assert.match(server, /historical_customer_company_links[\s\S]*link_status='CONFIRMED'/);
});
