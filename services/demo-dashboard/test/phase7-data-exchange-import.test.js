import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveImportSubmission,
  buildImportErrorReport,
  buildProductRevisionPlan,
  createImportDryRun,
  mapRelationshipStatus,
  mapVerificationDecision,
  nextImportVersion,
  submitImportDryRun,
  commitImportRecord,
} from '../src/dataExchange/index.js';

const hex = (seed) => String(seed).repeat(64).slice(0, 64);

test('prospect lead dry-run keeps fuzzy company links in review and blocks direct outreach promotion', () => {
  const dryRun = createImportDryRun({
    importType: 'PROSPECT_LEADS',
    sourceSha256: hex('a'),
    rows: [{
      external_lead_id: 'L-1',
      company_name: 'DPV Prospect',
      country_code: 'AE',
      source_reference: 'https://source.example',
      matchingStrategy: 'FUZZY_NAME_ONLY',
      enterOutreach: true,
    }],
  });
  assert.equal(dryRun.status, 'DRY_RUN_READY');
  assert.equal(dryRun.dryRun.rows[0].rowStatus, 'REVIEW');
  assert.equal(dryRun.dryRun.summary.review, 1);
  assert.equal(dryRun.dryRun.rows[0].reviewReasons.includes('PROSPECT_IMPORT_DOES_NOT_ENTER_OUTREACH'), true);
});

test('prospect lead dry-run marks exact canonical domain or external identity matches duplicate', () => {
  for (const existingCompanyMatch of ['EXACT_DOMAIN','EXACT_EXTERNAL_ID']) {
    const dryRun=createImportDryRun({importType:'PROSPECT_LEADS',sourceSha256:hex(existingCompanyMatch==='EXACT_DOMAIN'?'8':'9'),
      rows:[{external_lead_id:'L-EXISTING',company_name:'Existing Buyer',country_code:'MX',website_url:'https://buyer.example',
        source_reference:'https://source.example',existingCompanyMatch}]});
    assert.equal(dryRun.dryRun.rows[0].rowStatus,'DUPLICATE');
    assert.equal(dryRun.dryRun.summary.duplicate,1);
    assert.equal(dryRun.dryRun.summary.accepted,0);
  }
});

test('product master dry-run preserves product_master.id through append-only revision plans and taxonomy review', () => {
  const dryRun = createImportDryRun({
    importType: 'PRODUCT_MASTER_UPDATE',
    sourceSha256: hex('b'),
    rows: [{
      external_product_id: 'P-1',
      product_name: 'Knitted Dress',
      product_profile: 'WOMENSWEAR',
      category: 'DRESS',
      subcategory: 'MAXI',
      approved_sales_claim: 'Soft-touch jersey',
      catalog_status: 'ACTIVE',
      taxonomyConflict: true,
      productMasterId: 'product-master-1',
      latestRevisionNumber: 4,
    }],
  });
  assert.equal(dryRun.dryRun.rows[0].rowStatus, 'REVIEW');
  assert.equal(dryRun.dryRun.summary.taxonomyConflicts, 1);
  assert.equal(dryRun.dryRun.rows[0].revisionPlan.preservesProductMasterId, true);

  const revision = buildProductRevisionPlan({
    productMasterId: 'product-master-1',
    sourceImportId: dryRun.importId,
    sourceImportRowId: dryRun.dryRun.rows[0].rowDigest,
    latestRevisionNumber: 4,
    row: {
      external_product_id: 'P-1',
      product_name: 'Knitted Dress',
      product_profile: 'WOMENSWEAR',
      category: 'DRESS',
      subcategory: 'MAXI',
      catalog_status: 'ACTIVE',
    },
  });
  assert.equal(revision.productMasterId, 'product-master-1');
  assert.equal(revision.revisionNumber, 5);
  assert.equal(revision.preservesProductMasterId, true);
});

test('customer deal flow requires explicit confirmation, then marks existing-customer boundary on commit', () => {
  const draft = createImportDryRun({
    importType: 'CUSTOMER_DEALS',
    sourceSha256: hex('c'),
    rows: [{
      external_customer_id: 'C-100',
      company_name: 'Confirmed Buyer',
      country_code: 'MX',
      external_deal_or_order_id: 'O-200',
      deal_status: 'WON',
      currency: '',
      source_reference: 'https://crm.example/order/200',
      explicitCustomerCrosswalk: true,
      crmStageOnly: false,
    }],
  });
  assert.equal(draft.dryRun.rows[0].rowStatus, 'ACCEPTED');
  assert.equal(draft.dryRun.summary.currencyOrPriceTypeWarnings, 1);

  const submitted = submitImportDryRun(draft, { actor: 'sales-ops' });
  const approved = approveImportSubmission(submitted, {
    approverIdentity: 'manager@example.com',
    approverRole: 'MANAGEMENT',
  });
  const committed = commitImportRecord(approved, {
    approval: approved.approval,
    currentSourceSha256: hex('c'),
  });
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(committed.relationshipEffects.length, 1);
  assert.deepEqual(committed.relationshipEffects[0], {
    externalCustomerId: 'C-100',
    externalDealOrOrderId: 'O-200',
    markExistingCustomer: true,
    blockNewProspectOutreach: true,
    explicitConfirmedDeal: true,
  });
  assert.match(committed.advisoryLockKey, /^phase7-import:/);
  assert.equal(mapRelationshipStatus({ confirmedDeal: true }), 'EXISTING_CUSTOMER');
});

test('customer deal controlled crosswalk stays review unless confirmed and repository-verified', () => {
  const common={external_customer_id:'C-X',company_name:'Controlled Buyer',country_code:'MX',external_deal_or_order_id:'O-X',
    deal_status:'CONFIRMED',source_reference:'https://crm.example/O-X',crosswalk_company_id:'11111111-1111-4111-8111-111111111111'};
  const review=createImportDryRun({importType:'CUSTOMER_DEALS',sourceSha256:hex('6'),rows:[{...common,crosswalk_status:'REVIEW',crosswalkVerified:false}]});
  assert.equal(review.dryRun.rows[0].rowStatus,'REVIEW');
  assert.throws(()=>commitImportRecord({...review,status:'APPROVED'},{approval:{decision:'APPROVED',dryRunDigest:review.dryRun.digest,sourceSha256:review.sourceSha256}}),
    error=>error.code==='DRY_RUN_NOT_PASSED');
  const accepted=createImportDryRun({importType:'CUSTOMER_DEALS',sourceSha256:hex('7'),rows:[{...common,crosswalk_status:'CONFIRMED',crosswalkVerified:true}]});
  assert.equal(accepted.dryRun.rows[0].rowStatus,'ACCEPTED');
});

test('rejected import rows surface row-level errors, while same-hash replay remains idempotent and changed files advance version', () => {
  const failed = createImportDryRun({
    importType: 'CUSTOMER_DEAL_LINES',
    sourceSha256: hex('d'),
    rows: [{
      external_customer_id: 'C-101',
      company_name: '',
      country_code: 'MEX',
      external_deal_or_order_id: 'O-201',
      deal_status: 'OPEN',
      source_reference: 'https://crm.example/order/201',
    }],
  });
  assert.equal(failed.status, 'DRY_RUN_FAILED');
  const report = buildImportErrorReport(failed);
  assert.equal(report.length, 1);
  assert.equal(report[0].error_codes.includes('REQUIRED_COMPANY_NAME'), true);
  assert.equal(report[0].error_codes.includes('INVALID_COUNTRY_CODE'), true);

  const replay = nextImportVersion({ sameHashImport: { importVersion: 3 }, latestVersion: 3 });
  const changed = nextImportVersion({ sameHashImport: null, latestVersion: 3 });
  assert.deepEqual(replay, { replay: true, importVersion: 3 });
  assert.deepEqual(changed, { replay: false, importVersion: 4 });
});

test('verification decisions map to the Phase 7 approval/send boundary states', () => {
  assert.equal(mapVerificationDecision('VALID'), 'APPROVAL_ALLOWED');
  assert.equal(mapVerificationDecision('ACCEPT_ALL'), 'MANUAL_RISK_REVIEW');
  assert.equal(mapVerificationDecision('DOMAIN_MX_VERIFIED'), 'MAILBOX_VERIFICATION_REQUIRED');
});
