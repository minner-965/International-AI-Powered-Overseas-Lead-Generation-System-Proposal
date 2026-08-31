import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDownloadAllowed,
  buildDownloadAuditEvent,
  buildExportSnapshotDigest,
  createExportJob,
  finalizeExportJob,
  projectExportRow,
  resolveExportRequest,
  serializeCsv,
} from '../src/dataExchange/index.js';

test('export request enforces role-based columns, finance-only supplier cost and full-export restrictions', () => {
  assert.throws(
    () => resolveExportRequest({
      exportType: 'CUSTOMER_DEAL_HISTORY',
      format: 'CSV',
      mode: 'CURRENT_FILTER',
      requesterRole: 'SALES',
      requesterIdentity: 'sales@example.com',
      columns: ['company_name', 'supplier_cost'],
    }),
    (error) => error.code === 'EXPORT_COLUMN_FORBIDDEN'
  );

  assert.throws(
    () => resolveExportRequest({
      exportType: 'LEAD_MASTER_INTERNAL',
      format: 'CSV',
      mode: 'FULL_AUTHORIZED_MASTER',
      requesterRole: 'SALES',
      requesterIdentity: 'sales@example.com',
    }),
    (error) => error.code === 'FULL_EXPORT_FORBIDDEN'
  );

  const finance = resolveExportRequest({
    exportType: 'CUSTOMER_DEAL_HISTORY',
    format: 'CSV',
    mode: 'CURRENT_FILTER',
    requesterRole: 'FINANCE',
    requesterIdentity: 'finance@example.com',
    financeAuthorized: true,
    columns: ['company_name', 'supplier_cost', 'customer_sales_price', 'currency'],
  });
  assert.deepEqual(finance.columns, ['company_name', 'supplier_cost', 'customer_sales_price', 'currency']);
});

test('export rows and CSV serialization escape formula-leading values', () => {
  const request = resolveExportRequest({
    exportType: 'LEAD_MASTER_INTERNAL',
    format: 'CSV',
    mode: 'CURRENT_FILTER',
    requesterRole: 'MANAGEMENT',
    requesterIdentity: 'manager@example.com',
    columns: ['company_name', 'owner'],
  });
  const row = projectExportRow({ company_name: '=cmd', owner: '+owner' }, request);
  assert.deepEqual(row, { company_name: "'=cmd", owner: "'+owner" });
  const csv = serializeCsv(request.columns, [row]);
  assert.match(csv, /^﻿company_name,owner\r\n'=cmd,'\+owner\r\n$/);
});

test('export jobs carry digest, storage, token and expiry fields through ready/download audit flow', () => {
  const now = new Date('2026-08-31T10:00:00Z');
  const created = createExportJob({
    exportType: 'SALES_OPPORTUNITY',
    format: 'CSV',
    mode: 'SELECTED_ROWS',
    requesterRole: 'DATA_ADMIN',
    requesterIdentity: 'ops@example.com',
    selectedEntityIds: ['11111111-1111-1111-1111-111111111111'],
    columns: ['company_name', 'owner'],
  }, {
    now,
    tokenTtlSeconds: 600,
    fileTtlSeconds: 1800,
  });
  assert.equal(created.job.storageProvider, 'LOCAL_EXPORT_DIRECTORY');
  assert.ok(created.job.requestDigest);
  assert.ok(created.downloadToken);

  const rows = [{ company_name: 'DPV Buyer', owner: 'Alice' }];
  const ready = finalizeExportJob(created.job, {
    rows,
    fileBytes: Buffer.from('company_name,owner\r\nDPV Buyer,Alice\r\n', 'utf8'),
    internalFilePath: 'artifacts/exports/opportunities.csv',
    storageKey: 'artifacts/exports/opportunities.csv',
    now: new Date('2026-08-31T10:05:00Z'),
  });
  assert.equal(ready.status, 'READY');
  assert.equal(ready.rowCount, 1);
  assert.equal(ready.storageKey, 'artifacts/exports/opportunities.csv');

  assert.equal(assertDownloadAllowed({
    job: ready,
    requesterIdentity: 'ops@example.com',
    downloadToken: created.downloadToken,
    now: new Date('2026-08-31T10:06:00Z'),
  }), true);

  const audit = buildDownloadAuditEvent({
    job: ready,
    requesterIdentity: 'ops@example.com',
    authorizationStatus: 'AUTHORIZED',
    downloadToken: created.downloadToken,
    now: new Date('2026-08-31T10:06:00Z'),
  });
  assert.equal(audit.authorizationStatus, 'AUTHORIZED');
  assert.match(audit.requestDigest, /^[0-9a-f]{64}$/);
});

test('snapshot digest stays stable for the same filtered rows and schema', () => {
  const request = resolveExportRequest({
    exportType: 'LEAD_MASTER_INTERNAL',
    format: 'XLSX',
    mode: 'CURRENT_FILTER',
    requesterRole: 'MANAGEMENT',
    requesterIdentity: 'manager@example.com',
    columns: ['company_name', 'owner'],
    filters: { market: ['AE'] },
  });
  const rows = [{ company_name: 'Buyer One', owner: 'Amy' }];
  assert.equal(
    buildExportSnapshotDigest(rows, request),
    buildExportSnapshotDigest([{ owner: 'Amy', company_name: 'Buyer One' }], request)
  );
});
