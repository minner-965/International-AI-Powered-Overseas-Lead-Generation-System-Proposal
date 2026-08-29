import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { SharedHistoryImportService } from '../src/referenceData/sharedHistoryImportService.js';

const enabled = /^(1|true|yes)$/i.test(process.env.RUN_PHASE5_POSTGRES_INTEGRATION || '');
const { Pool } = pg;
const hex = value => String(value).repeat(64).slice(0, 64);

function bundle(batchKey, sourceHash, identityToken) {
  const provenance = {
    source_file_hash: sourceHash,
    source_sheet: 'Orders',
    captured_at: '2026-08-28T00:00:00Z'
  };
  return {
    batch_key: batchKey,
    data_classification: 'INTERNAL_BUSINESS',
    dry_run_passed: true,
    errors: [],
    safety: { source_files_modified: 0,source_files_deleted: 0,source_files_created: 0,source_files_renamed: 0,source_files_moved: 0 },
    source_files: [{
      source_unc_path: '\\\\SERVER\\share\\orders.xlsx', source_filename: 'orders.xlsx',
      source_last_modified: '2026-08-28T00:00:00Z', source_size: 100,
      source_sha256_before: sourceHash, local_sha256: sourceHash, source_sha256_after: sourceHash,
      local_staging_path: 'D:\\staging\\orders.xlsx', copied_at: '2026-08-28T00:01:00Z', hash_verified: true
    }],
    entities: {
      HISTORICAL_CUSTOMERS: [{ ...provenance,source_row: 1,source_identity_key: hex(identityToken),
        external_customer_id: 'MX:test-customer',source_system: 'SHARED_CAVANNA_PO',company_name: 'TEST CUSTOMER',
        normalized_company_name: 'test customer',country_code: 'MX',market_code: 'MX',buyer_type: 'BUYER',company_size: null,
        first_order_date: '2026-01-01',last_order_date: '2026-01-01',repeat_order_count: 0,
        customer_role: 'INTERNAL_EXISTING_CUSTOMER',customer_type: 'CUSTOMER',channel_type: null,
        product_profiles: ['WOMENSWEAR'],identity_resolution_status: 'CONFIRMED',record_digest: hex(identityToken) }],
      CUSTOMER_ALIASES: [],
      HISTORICAL_ORDERS: [{ ...provenance,source_row: 2,source_identity_key: hex(String(Number(identityToken) + 1)),
        external_order_id: 'PO-TEST-1',external_customer_id: 'MX:test-customer',source_system: 'SHARED_CAVANNA_PO',
        order_date: '2026-01-01',customer_resolution_status: 'RESOLVED',order_status: 'CONFIRMED',delivery_date: null,
        order_date_source: 'EXPLICIT',quantity: 100,unit: 'PCS',unit_price: 2,order_value: 200,
        commercial_value_type: 'CUSTOMER_SALES_REVENUE',currency: 'USD',incoterm: 'FOB',container_sequence: null,
        product_profile: 'WOMENSWEAR',source_version: 1,supersedes_source_identity_key: null,record_digest: hex(String(Number(identityToken) + 1)) }],
      PRODUCT_MASTER: [],ORDER_LINES: [],HISTORICAL_CUSTOMER_CHANNELS: [],HISTORICAL_LEAD_OUTCOMES: []
    },
    reviews: [], summary: { customers_detected: 1,orders: 1,products: 0,followup_rows: 0,error_count: 0,warning_count: 0 }
  };
}

test('PostgreSQL import keeps replay ownership and appends a changed PO source version', { skip: !enabled }, async () => {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres', port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD
  });
  const service = new SharedHistoryImportService({ pool });
  try {
    const first = bundle('truth-first',hex('a'),'1');
    await service.dryRun(first); await service.commit(first.batch_key);
    const replay = bundle('truth-replay',hex('a'),'1');
    await service.dryRun(replay); await service.commit(replay.batch_key);
    const changed = bundle('truth-changed',hex('b'),'3');
    await service.dryRun(changed); await service.commit(changed.batch_key);

    const orders = await pool.query(`SELECT source_version,supersedes_historical_order_id
      FROM leadgen.historical_orders WHERE external_order_id='PO-TEST-1' ORDER BY source_version`);
    assert.equal(orders.rowCount, 2);
    assert.deepEqual(orders.rows.map(row => Number(row.source_version)), [1,2]);
    assert.equal(orders.rows[0].supersedes_historical_order_id, null);
    assert.ok(orders.rows[1].supersedes_historical_order_id);

    const imports = await pool.query(`SELECT b.import_batch_key,i.import_version,i.supersedes_import_id
      FROM leadgen.reference_data_imports i JOIN leadgen.reference_data_import_batches b ON b.id=i.import_batch_id
      WHERE i.import_type='HISTORICAL_ORDERS' ORDER BY b.created_at`);
    assert.deepEqual(imports.rows.map(row => Number(row.import_version)), [1,1,2]);
    assert.equal(imports.rows[0].supersedes_import_id, null);
    assert.equal(imports.rows[1].supersedes_import_id, null);
    assert.ok(imports.rows[2].supersedes_import_id);

    const duplicate = await pool.query(`SELECT r.row_status,r.replays_import_row_id
      FROM leadgen.reference_data_import_rows r JOIN leadgen.reference_data_imports i ON i.id=r.import_id
      JOIN leadgen.reference_data_import_batches b ON b.id=i.import_batch_id
      WHERE b.import_batch_key='truth-replay' AND i.import_type='HISTORICAL_ORDERS'`);
    assert.deepEqual([duplicate.rows[0].row_status,Boolean(duplicate.rows[0].replays_import_row_id)], ['DUPLICATE',true]);
  } finally { await pool.end(); }
});
