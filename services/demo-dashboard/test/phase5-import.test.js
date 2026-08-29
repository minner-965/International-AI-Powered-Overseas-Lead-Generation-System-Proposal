import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReferenceCsv, ReferenceDataImportService } from '../src/referenceData/referenceDataImportService.js';

const TEST_ONLY_CUSTOMERS_CSV = `external_customer_id,company_name,country_code,buyer_type,company_size,source_system
C-001,Test Fixture Buyer AE,AE,IMPORTER,SMALL,TEST_FIXTURE
C-002,,BD,WHOLESALER,MEDIUM,TEST_FIXTURE
C-001,Test Fixture Duplicate,AE,IMPORTER,SMALL,TEST_FIXTURE`;

class MemoryRepository {
  constructor(existing = []) { this.existing = new Set(existing); this.saved = new Map(); this.sequence = 0; }
  async findExistingDuplicateKeys(_type, keys) { return new Set(keys.filter(key => this.existing.has(key))); }
  async saveDryRun(parsed) {
    const id = `TEST-IMPORT-${++this.sequence}`;
    const record = {
      id, status: parsed.rows.some(row => row.row_status === 'ACCEPTED') ? 'VALIDATED' : 'VALIDATION_FAILED',
      row_count: parsed.rows.length,
      accepted_count: parsed.rows.filter(row => row.row_status === 'ACCEPTED').length,
      rejected_count: parsed.rows.filter(row => row.row_status === 'REJECTED').length,
      duplicate_count: parsed.rows.filter(row => row.row_status === 'DUPLICATE').length,
      rows: structuredClone(parsed.rows)
    };
    this.saved.set(id, record);
    return record;
  }
  async getImport(id) { return this.saved.get(id) || null; }
  async commit(id) {
    const record = this.saved.get(id);
    if (record.status !== 'VALIDATED') throw Object.assign(new Error('not validated'), { code: 'IMPORT_NOT_VALIDATED' });
    record.status = 'COMMITTED';
    for (const row of record.rows) if (row.row_status === 'ACCEPTED') row.row_status = 'COMMITTED';
    return record;
  }
}

test('CSV dry run validates rows, reports duplicates and does not commit automatically', async () => {
  const repository = new MemoryRepository();
  const service = new ReferenceDataImportService({ repository });
  const result = await service.dryRun({ importType: 'HISTORICAL_CUSTOMERS', sourceFilename: 'test-only-customers.csv', csvText: TEST_ONLY_CUSTOMERS_CSV });
  assert.equal(result.status, 'VALIDATED');
  assert.equal(result.row_count, 3);
  assert.equal(result.accepted_count, 1);
  assert.equal(result.rejected_count, 1);
  assert.equal(result.duplicate_count, 1);
  assert.equal(result.rows[1].error_codes.includes('REQUIRED_COMPANY_NAME'), true);
  assert.equal(result.rows[0].row_status, 'ACCEPTED');
});

test('dry run detects duplicates already committed in the repository', async () => {
  const repository = new MemoryRepository(['test_fixture:c-001']);
  const service = new ReferenceDataImportService({ repository });
  const result = await service.dryRun({ importType: 'HISTORICAL_CUSTOMERS', sourceFilename: 'test-only-customers.csv', csvText: TEST_ONLY_CUSTOMERS_CSV });
  assert.equal(result.accepted_count, 0);
  assert.equal(result.duplicate_count, 2);
  assert.equal(result.status, 'VALIDATION_FAILED');
});

test('commit is a separate audited state transition after validated dry run', async () => {
  const repository = new MemoryRepository();
  const service = new ReferenceDataImportService({ repository });
  const dryRun = await service.dryRun({ importType: 'HISTORICAL_CUSTOMERS', sourceFilename: 'test-only-customers.csv', csvText: TEST_ONLY_CUSTOMERS_CSV });
  assert.equal(dryRun.rows.some(row => row.row_status === 'COMMITTED'), false);
  const committed = await service.commit(dryRun.id);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(committed.rows.filter(row => row.row_status === 'COMMITTED').length, 1);
});

test('CSV import contract rejects wrong schema and invalid business fields', () => {
  assert.throws(() => parseReferenceCsv({ importType: 'HISTORICAL_ORDERS', sourceFilename: 'bad.csv', csvText: 'external_order_id\nO-1' }), error => error.code === 'CSV_SCHEMA_INVALID');
  const parsed = parseReferenceCsv({
    importType: 'HISTORICAL_LEAD_OUTCOMES', sourceFilename: 'bad-fields.csv',
    csvText: 'external_lead_id,company_name,country_code,outcome,sales_cycle_days\nL-1,Fixture,ARE,MAYBE,-2'
  });
  assert.equal(parsed.rows[0].row_status, 'REJECTED');
  assert.deepEqual(parsed.rows[0].error_codes.sort(), ['INVALID_COUNTRY_CODE','INVALID_OUTCOME','INVALID_SALES_CYCLE_DAYS'].sort());
});
