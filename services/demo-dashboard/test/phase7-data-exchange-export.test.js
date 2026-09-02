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
import {Phase7Service} from '../src/phase7/service.js';

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

test('sales opportunity export uses approved category scope and omits SKU/catalog maintenance gates',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE'},opportunityQuery:async()=>[{
    company_id:'company-1',company_name:'Category Buyer',country_code:'AE',
    product_profile:'WOMENSWEAR',category_procurement_match_score:87,category_procurement_match_band:'VERY_HIGH',
    observed_customer_categories:['DRESSES',{canonical_name:'TOPS'}],matched_scopes:['WOMENSWEAR'],match_basis:'PROFILE_SCOPE',
    category_procurement_match_status:'CATEGORY_PROCUREMENT_MATCH',product_opportunity_status:'INTERNAL_CATALOG_UPLOAD_REQUIRED',
    product_opportunity_count:3,top_product_opportunity:'Legacy Dress',
    sku_readiness_status:'INTERNAL_CATALOG_UPLOAD_REQUIRED',catalog_enrichment_required:true,
    readiness_blockers:[],supplier_access_band:'UNKNOWN'
  }]});
  const [row]=await service.queryExportRows({exportType:'SALES_OPPORTUNITY',mode:'CURRENT_FILTER',filters:{},selectedEntityIds:[]});
  for(const removed of ['product_opportunity_status','product_opportunity_count','top_product_opportunity',
    'sku_readiness_status','catalog_enrichment_required'])assert.equal(removed in row,false);
  assert.equal(row.product_profile,'WOMENSWEAR');
  assert.equal(row.product_category_score,87);
  assert.equal(row.product_category_score_band,'VERY_HIGH');
  assert.equal(row.customer_procurement_categories,'DRESSES; TOPS');
  assert.equal(row.dpv_supply_categories,'WOMENSWEAR');
  assert.equal(row.category_opportunity_basis,'PROFILE_SCOPE');
});

test('default sales-opportunity export exposes category score context without exact-product fields',()=>{
  const request=resolveExportRequest({
    exportType:'SALES_OPPORTUNITY',format:'XLSX',mode:'FULL_AUTHORIZED_MASTER',
    requesterRole:'MANAGEMENT',requesterIdentity:'manager@example.com'
  });
  for(const field of ['product_profile','product_category_score','product_category_score_band',
    'customer_procurement_categories','dpv_supply_categories','category_opportunity_basis']) {
    assert.ok(request.columns.includes(field),`missing category export field ${field}`);
  }
  for(const removed of ['product_opportunity_status','product_opportunity_count','top_product_opportunity',
    'sku_readiness_status','catalog_enrichment_required']) assert.ok(!request.columns.includes(removed));
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
