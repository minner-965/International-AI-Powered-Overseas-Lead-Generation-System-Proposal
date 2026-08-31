import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDigest,
  buildTemplateContract,
  parseCsvUtf8,
  redactInternalPaths,
  serializeCsv,
  validateReadOnlyManifest,
  validateUploadMetadata,
} from '../src/dataExchange/index.js';

const hex = (seed) => String(seed).repeat(64).slice(0, 64);

test('upload contract accepts CSV/XLSX and restricts XLSM to the read-only shared-folder path', () => {
  assert.throws(
    () => validateUploadMetadata({
      filename: 'products.xlsm',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      byteLength: 1024,
      hasMacros: true,
    }),
    (error) => error.code === 'UNSUPPORTED_WORKBOOK_TYPE'
  );

  const accepted = validateUploadMetadata({
    filename: 'history.xlsm',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    byteLength: 2048,
    hasMacros: true,
  }, undefined, { allowHistoricalXlsm: true });
  assert.equal(accepted.extension, '.xlsm');
  assert.equal(accepted.allowHistoricalXlsm, true);
});

test('CSV parsing enforces UTF-8/header contract and export serialization escapes formulas', () => {
  const records = parseCsvUtf8(
    Buffer.from('external_lead_id,company_name,country_code,source_reference\nL-1,DPV Buyer,AE,https://source.example\n', 'utf8'),
    { importType: 'PROSPECT_LEADS' }
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].company_name, 'DPV Buyer');

  const csv = serializeCsv(['company_name', 'notes'], [{ company_name: '=2+2', notes: '@cmd' }]);
  assert.match(csv, /^﻿company_name,notes\r\n'=2\+2,'@cmd\r\n$/);
});

test('template contract advertises the Phase 7 schema and explicit workbook safety flags', () => {
  const contract = buildTemplateContract('CUSTOMER_DEALS');
  assert.equal(contract.schemaVersion, 'phase7-v1');
  assert.equal(contract.xlsx.formulasAllowed, false);
  assert.equal(contract.xlsx.externalLinksAllowed, false);
  assert.equal(contract.xlsx.macrosAllowed, false);
  assert.deepEqual(contract.requiredHeaders, [
    'external_customer_id',
    'company_name',
    'country_code',
    'external_deal_or_order_id',
    'deal_status',
    'source_reference',
  ]);
  for (const field of ['crosswalk_company_id','crosswalk_historical_customer_id','crosswalk_status','crosswalk_method']) {
    assert.ok(contract.headers.includes(field));
  }
  assert.deepEqual(contract.controlledCrosswalk, {
    companyIdField:'crosswalk_company_id',historicalCustomerIdField:'crosswalk_historical_customer_id',
    statusField:'crosswalk_status',methodField:'crosswalk_method',acceptedStatus:'CONFIRMED',
    policy:'The company UUID must resolve to an existing company; uncertain links remain REVIEW.',
  });
});

test('shared-folder manifests require allowlisted source and staged roots and redact internal paths recursively', () => {
  const manifest = validateReadOnlyManifest({
    sourcePath: '\\\\SERVER\\share\\orders\\orders.xlsx',
    stagedPath: 'D:\\staging\\phase7\\orders.xlsx',
    sourceSha256Before: hex('a'),
    localSha256: hex('a'),
    sourceSha256After: hex('a'),
    sourceMutations: { modified: 0, deleted: 0, renamed: 0, moved: 0, created: 0 },
    autoCommit: false,
  }, {
    allowlistedRoot: '\\\\SERVER\\share',
    allowlistedStagingRoots: ['D:\\staging\\phase7'],
  });
  assert.equal(manifest.parseLocalCopyOnly, true);
  assert.equal(manifest.sourceFilename, 'orders.xlsx');

  assert.throws(
    () => validateReadOnlyManifest({
      sourcePath: '\\\\SERVER\\share\\orders\\orders.xlsx',
      stagedPath: 'C:\\temp\\orders.xlsx',
      sourceSha256Before: hex('b'),
      localSha256: hex('b'),
      sourceSha256After: hex('b'),
      sourceMutations: { modified: 0, deleted: 0, renamed: 0, moved: 0, created: 0 },
      autoCommit: false,
    }, {
      allowlistedRoot: '\\\\SERVER\\share',
      allowlistedStagingRoots: ['D:\\staging\\phase7'],
    }),
    (error) => error.code === 'STAGING_ROOT_NOT_ALLOWED'
  );

  const redacted = redactInternalPaths({
    source_unc_path: '\\\\SERVER\\share\\orders.xlsx',
    nested: {
      local_staging_path: 'D:\\staging\\phase7\\orders.xlsx',
      safe: 'visible',
    },
  });
  assert.deepEqual(redacted, { nested: { safe: 'visible' } });
});

test('digest builder is stable across object key order', () => {
  assert.equal(
    buildDigest({ b: 2, a: 1 }),
    buildDigest({ a: 1, b: 2 })
  );
});
