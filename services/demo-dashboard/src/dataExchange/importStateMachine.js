import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  CONTACT_VERIFICATION_DECISIONS,
  DATASET_ROLES,
  DEAL_CONFIRMED_STATUSES,
  IMPORT_RECORD_STATUSES,
  IMPORT_ROW_STATUSES,
  IMPORT_SCHEMAS,
  IMPORT_TYPES,
  OUTREACH_RELATIONSHIP_STATUSES,
  PHASE7_SCHEMA_VERSION,
} from './constants.js';
import {
  buildDigest,
  DataExchangeContractError,
  stableJson,
} from './fileContract.js';

const PHASE7_TYPES = new Set(Object.values(IMPORT_TYPES));
const RECORD_STATUS_SET = new Set(IMPORT_RECORD_STATUSES);
const ROW_STATUS_SET = new Set(IMPORT_ROW_STATUSES);
const CONFIRMED_DEAL_SET = new Set(DEAL_CONFIRMED_STATUSES);
const RELATIONSHIP_STATUS_SET = new Set(OUTREACH_RELATIONSHIP_STATUSES);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function upper(value) {
  return text(value)?.toUpperCase() ?? null;
}

function integer(value) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
}

function decimal(value) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function dateOnly(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (!DATE_ONLY.test(normalized)) return `INVALID:${normalized}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? `INVALID:${normalized}`
    : normalized;
}

function isDigest(value) {
  return SHA256.test(String(value ?? ''));
}

function sameDigest(left, right) {
  if (!isDigest(left) || !isDigest(right)) return false;
  return timingSafeEqual(
    Buffer.from(String(left).toLowerCase()),
    Buffer.from(String(right).toLowerCase())
  );
}

function normalizeCountry(value) {
  const normalized = upper(value);
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : normalized;
}

function normalizeCurrency(value) {
  const normalized = upper(value);
  if (!normalized) return 'UNKNOWN';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : normalized;
}

function normalizeProductProfile(value) {
  const normalized = upper(value);
  if (!normalized) return 'UNKNOWN';
  if (['WOMENSWEAR', 'GENERAL_MERCHANDISE'].includes(normalized)) return normalized;
  return 'UNKNOWN';
}

function normalizeCatalogStatus(value) {
  const normalized = upper(value);
  if (!normalized) return 'UNKNOWN';
  if (['ACTIVE', 'INACTIVE', 'REVIEW', 'UNKNOWN'].includes(normalized)) return normalized;
  return normalized;
}

function normalizeDealStatus(value) {
  const normalized = upper(value);
  return normalized ?? 'UNKNOWN';
}

export function mapVerificationDecision(verificationStatus) {
  return CONTACT_VERIFICATION_DECISIONS[upper(verificationStatus)] ?? 'BLOCKED';
}

export function mapRelationshipStatus({ confirmedDeal = false, suppressed = false, hasHistoricalReference = false } = {}) {
  const relationshipStatus = suppressed
    ? 'SUPPRESSED'
    : confirmedDeal
      ? 'EXISTING_CUSTOMER'
      : hasHistoricalReference
        ? 'HISTORICAL_REVIEW'
        : 'NEW_PROSPECT';
  if (!RELATIONSHIP_STATUS_SET.has(relationshipStatus)) {
    throw new DataExchangeContractError('RELATIONSHIP_STATUS_INVALID', 'Relationship status mapping produced an invalid value.');
  }
  return relationshipStatus;
}

function buildDuplicateKey(importType, payload) {
  if (importType === IMPORT_TYPES.PROSPECT_LEADS) {
    return stableJson([
      importType,
      text(payload.external_lead_id)?.toLowerCase(),
      text(payload.website_url)?.toLowerCase(),
      normalizeCountry(payload.country_code),
    ]);
  }
  if (importType === IMPORT_TYPES.PRODUCT_MASTER_UPDATE) {
    return stableJson([
      importType,
      text(payload.external_product_id)?.toLowerCase(),
      text(payload.sku)?.toLowerCase(),
    ]);
  }
  return stableJson([
    importType,
    text(payload.external_customer_id)?.toLowerCase(),
    text(payload.external_deal_or_order_id)?.toLowerCase(),
    text(payload.external_product_id)?.toLowerCase(),
    text(payload.sku)?.toLowerCase(),
  ]);
}

function normalizePayload(importType, row) {
  if (importType === IMPORT_TYPES.PROSPECT_LEADS) {
    return Object.freeze({
      external_lead_id: text(row.external_lead_id),
      company_name: text(row.company_name),
      country_code: normalizeCountry(row.country_code),
      website_url: text(row.website_url)?.toLowerCase() ?? null,
      city: text(row.city),
      company_type: upper(row.company_type),
      contact_name: text(row.contact_name),
      contact_title: text(row.contact_title),
      business_email: text(row.business_email)?.toLowerCase() ?? null,
      business_phone: text(row.business_phone),
      product_profile: normalizeProductProfile(row.product_profile),
      source_reference: text(row.source_reference),
      owner: text(row.owner),
      notes: text(row.notes),
    });
  }
  if (importType === IMPORT_TYPES.PRODUCT_MASTER_UPDATE) {
    return Object.freeze({
      external_product_id: text(row.external_product_id),
      sku: text(row.sku),
      product_name: text(row.product_name),
      product_profile: normalizeProductProfile(row.product_profile),
      category: upper(row.category),
      subcategory: upper(row.subcategory),
      material: text(row.material),
      size_spec: text(row.size_spec),
      color: text(row.color),
      MOQ: integer(row.MOQ),
      packing: text(row.packing),
      certification: text(row.certification),
      approved_sales_claim: text(row.approved_sales_claim),
      catalog_status: normalizeCatalogStatus(row.catalog_status),
      effective_date: dateOnly(row.effective_date),
    });
  }
  return Object.freeze({
    external_customer_id: text(row.external_customer_id),
    company_name: text(row.company_name),
    country_code: normalizeCountry(row.country_code),
    external_deal_or_order_id: text(row.external_deal_or_order_id),
    deal_status: normalizeDealStatus(row.deal_status),
    order_date: dateOnly(row.order_date),
    currency: normalizeCurrency(row.currency),
    incoterm: upper(row.incoterm),
    external_product_id: text(row.external_product_id),
    sku: text(row.sku),
    product_name: text(row.product_name),
    quantity: decimal(row.quantity),
    customer_sales_price: decimal(row.customer_sales_price),
    supplier_cost: decimal(row.supplier_cost),
    owner: text(row.owner),
    source_reference: text(row.source_reference),
    external_line_id: text(row.external_line_id),
    line_number: integer(row.line_number),
    product_profile: normalizeProductProfile(row.product_profile),
    crosswalk_company_id: text(row.crosswalk_company_id)?.toLowerCase() ?? null,
    crosswalk_historical_customer_id: text(row.crosswalk_historical_customer_id)?.toLowerCase() ?? null,
    crosswalk_status: upper(row.crosswalk_status),
    crosswalk_method: upper(row.crosswalk_method),
  });
}

function baseValidation(importType, rawRow, normalizedPayload) {
  const schema = IMPORT_SCHEMAS[importType];
  if (!schema) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown import type.');
  const missingRequiredFields = schema.required.filter((key) => !text(rawRow[key]));
  const errors = [];
  if (missingRequiredFields.length) errors.push(...missingRequiredFields.map((key) => `REQUIRED_${key.toUpperCase()}`));
  if (normalizedPayload.country_code && !/^[A-Z]{2}$/.test(normalizedPayload.country_code)) {
    errors.push('INVALID_COUNTRY_CODE');
  }
  for (const dateKey of ['effective_date', 'order_date']) {
    if (normalizedPayload[dateKey] && String(normalizedPayload[dateKey]).startsWith('INVALID:')) {
      errors.push(`INVALID_${dateKey.toUpperCase()}`);
    }
  }
  for (const numberKey of ['MOQ', 'quantity', 'customer_sales_price', 'supplier_cost']) {
    if (normalizedPayload[numberKey] != null && !Number.isFinite(normalizedPayload[numberKey])) {
      errors.push(`INVALID_${numberKey.toUpperCase()}`);
    }
  }
  if (
    importType !== IMPORT_TYPES.PROSPECT_LEADS &&
    normalizedPayload.currency != null &&
    normalizedPayload.currency !== 'UNKNOWN' &&
    !/^[A-Z]{3}$/.test(normalizedPayload.currency)
  ) {
    errors.push('INVALID_CURRENCY');
  }
  for (const key of ['crosswalk_company_id', 'crosswalk_historical_customer_id']) {
    if (normalizedPayload[key] && !UUID.test(normalizedPayload[key])) errors.push(`INVALID_${key.toUpperCase()}`);
  }
  return {
    missingRequiredFields,
    errors: [...new Set(errors)],
  };
}

function classifyRow(importType, row, normalizedPayload) {
  const validation = baseValidation(importType, row, normalizedPayload);
  const warnings = [];
  const reviewReasons = [];
  const downstreamJobs = [];
  let createsEntity = false;
  let createsRevision = false;
  let ambiguousCrosswalk = false;
  let taxonomyConflict = false;
  let currencyOrPriceTypeWarning = false;
  let relationshipBoundary = null;
  let revisionPlan = null;

  if (importType === IMPORT_TYPES.PROSPECT_LEADS) {
    createsEntity = validation.errors.length === 0;
    if (row.existingCompanyMatch === 'EXACT_DOMAIN' || row.existingCompanyMatch === 'EXACT_EXTERNAL_ID') {
      createsEntity = false;
    } else if (row.matchingStrategy === 'FUZZY_NAME_ONLY' || row.ambiguousCompanyLink === true
      || row.existingCompanyMatch === 'FUZZY_OR_UNCERTAIN') {
      ambiguousCrosswalk = true;
      reviewReasons.push('FUZZY_COMPANY_LINK_REQUIRES_REVIEW');
    }
    if (row.enterOutreach === true) {
      reviewReasons.push('PROSPECT_IMPORT_DOES_NOT_ENTER_OUTREACH');
    }
    downstreamJobs.push('RECONCILE_PROSPECT_COMPANY');
  } else if (importType === IMPORT_TYPES.PRODUCT_MASTER_UPDATE) {
    createsRevision = validation.errors.length === 0;
    createsEntity = false;
    if (row.taxonomyConflict === true) {
      taxonomyConflict = true;
      reviewReasons.push('TAXONOMY_CONFLICT_REQUIRES_REVIEW');
    }
    if (normalizedPayload.product_profile === 'UNKNOWN' && text(row.product_profile)) {
      warnings.push('UNKNOWN_PRODUCT_PROFILE_REMAINS_UNKNOWN');
    }
    if (text(row.approved_sales_claim)) {
      warnings.push('APPROVED_SALES_CLAIM_REQUIRES_SEPARATE_APPROVAL');
      downstreamJobs.push('APPROVED_SALES_CLAIM_REVIEW');
    }
    downstreamJobs.push('REBUILD_PRODUCT_CATALOG_SNAPSHOT');
    downstreamJobs.push('RECALCULATE_AFFECTED_PRODUCT_PROFILES');
    revisionPlan = Object.freeze({
      productMasterId: row.productMasterId ?? null,
      preservesProductMasterId: row.productMasterId != null,
      revisionAction: 'APPEND_ONLY_REVISION',
      latestRevisionNumber: Number(row.latestRevisionNumber ?? 0),
    });
  } else {
    createsEntity = validation.errors.length === 0;
    const controlledCrosswalk = row.explicitCustomerCrosswalk === true
      || (normalizedPayload.crosswalk_status === 'CONFIRMED'
        && UUID.test(normalizedPayload.crosswalk_company_id || '')
        && row.crosswalkVerified !== false);
    if (!controlledCrosswalk) {
      ambiguousCrosswalk = true;
      reviewReasons.push('EXPLICIT_CUSTOMER_CROSSWALK_REQUIRED');
    }
    const confirmed = CONFIRMED_DEAL_SET.has(normalizedPayload.deal_status);
    if (!confirmed) {
      reviewReasons.push('CONFIRMED_CUSTOMER_RELATIONSHIP_REQUIRED');
    }
    if (normalizedPayload.currency === 'UNKNOWN') {
      currencyOrPriceTypeWarning = true;
      warnings.push('MISSING_CURRENCY_REMAINS_UNKNOWN');
    }
    if (row.crmStageOnly === true) {
      reviewReasons.push('CRM_STAGE_TEXT_ALONE_DOES_NOT_PROVE_CONVERSION');
    }
    if (confirmed && controlledCrosswalk) {
      relationshipBoundary = Object.freeze({
        markExistingCustomer: true,
        blockNewProspectOutreach: true,
        explicitConfirmedDeal: true,
      });
      downstreamJobs.push('REBUILD_ICP_CUSTOMER_MATCH');
      downstreamJobs.push('REMOVE_FROM_NEW_PROSPECT_OUTREACH');
    }
  }

  let rowStatus = 'ACCEPTED';
  if (validation.errors.length) rowStatus = 'REJECTED';
  else if (reviewReasons.length) rowStatus = 'REVIEW';
  if (!ROW_STATUS_SET.has(rowStatus)) {
    throw new DataExchangeContractError('ROW_STATUS_INVALID', 'Import row classification produced an invalid status.');
  }

  return Object.freeze({
    normalizedPayload,
    missingRequiredFields: validation.missingRequiredFields,
    errorCodes: validation.errors,
    warningCodes: [...new Set(warnings)],
    reviewReasons: [...new Set(reviewReasons)],
    rowStatus,
    createsEntity,
    createsRevision,
    ambiguousCrosswalk,
    taxonomyConflict,
    currencyOrPriceTypeWarning,
    downstreamJobs: [...new Set(downstreamJobs)],
    relationshipBoundary,
    revisionPlan,
  });
}

function buildRowRecord(importType, row, index, state) {
  const normalizedPayload = normalizePayload(importType, row);
  const classification = classifyRow(importType, row, normalizedPayload);
  const duplicateKey = buildDuplicateKey(importType, normalizedPayload);
  const rowDigest = buildDigest({
    importType,
    duplicateKey,
    normalizedPayload,
  });
  let rowStatus = classification.rowStatus;
  if (rowStatus !== 'REJECTED') {
    if (row.existingCompanyMatch === 'EXACT_DOMAIN' || row.existingCompanyMatch === 'EXACT_EXTERNAL_ID'
      || row.existingCanonicalDuplicate === true
      || state.duplicateKeys.has(duplicateKey) || state.priorCommittedDuplicateKeys.has(duplicateKey)) {
      rowStatus = 'DUPLICATE';
    } else {
      state.duplicateKeys.add(duplicateKey);
    }
  }
  return Object.freeze({
    rowNumber: index + 2,
    duplicateKey,
    rowDigest,
    rawPayload: Object.freeze({ ...row }),
    ...classification,
    rowStatus,
  });
}

export function summarizeDryRun(rows) {
  const summary = {
    accepted: 0,
    review: 0,
    rejected: 0,
    duplicate: 0,
    newEntities: 0,
    updatesOrRevisions: 0,
    ambiguousCrosswalks: 0,
    missingRequiredFields: 0,
    taxonomyConflicts: 0,
    currencyOrPriceTypeWarnings: 0,
    downstreamJobs: [],
  };
  for (const row of rows) {
    const status = String(row?.rowStatus ?? '').toUpperCase();
    if (status === 'ACCEPTED') summary.accepted += 1;
    else if (status === 'REVIEW') summary.review += 1;
    else if (status === 'REJECTED') summary.rejected += 1;
    else if (status === 'DUPLICATE') summary.duplicate += 1;
    if (row?.createsEntity) summary.newEntities += 1;
    if (row?.createsRevision) summary.updatesOrRevisions += 1;
    if (row?.ambiguousCrosswalk) summary.ambiguousCrosswalks += 1;
    if (row?.missingRequiredFields?.length) summary.missingRequiredFields += 1;
    if (row?.taxonomyConflict) summary.taxonomyConflicts += 1;
    if (row?.currencyOrPriceTypeWarning) summary.currencyOrPriceTypeWarnings += 1;
    for (const job of row?.downstreamJobs ?? []) {
      if (!summary.downstreamJobs.includes(job)) summary.downstreamJobs.push(job);
    }
  }
  return Object.freeze(summary);
}

export function assertDryRunCanPass({ importType, summary, dryRunDigest, sourceSha256 }) {
  if (!PHASE7_TYPES.has(importType)) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown Phase 7 import type.');
  if (!isDigest(dryRunDigest) || !isDigest(sourceSha256)) {
    throw new DataExchangeContractError('DIGEST_INVALID', 'Dry-run and source digests must be SHA-256 values.');
  }
  if (Number(summary?.rejected ?? 0) > 0 || Number(summary?.missingRequiredFields ?? 0) > 0) {
    throw new DataExchangeContractError('DRY_RUN_HAS_ERRORS', 'Dry-run contains rejected rows or missing required fields.');
  }
  return true;
}

export function assertApprovalMatches({ dryRun, approval, sourceSha256 }) {
  if (approval?.decision !== 'APPROVED') {
    throw new DataExchangeContractError('IMPORT_NOT_APPROVED', 'An exact approved decision is required.');
  }
  if (!sameDigest(dryRun?.digest, approval?.dryRunDigest)) {
    throw new DataExchangeContractError('DRY_RUN_DIGEST_CHANGED', 'Approval does not match the current dry-run.');
  }
  if (!sameDigest(sourceSha256, approval?.sourceSha256)) {
    throw new DataExchangeContractError('SOURCE_HASH_CHANGED', 'Approval does not match the current source file.');
  }
  return true;
}

export function assertCommitAllowed({ importRecord, dryRun, approval, currentSourceSha256 }) {
  if (!PHASE7_TYPES.has(importRecord?.importType)) {
    throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown Phase 7 import type.');
  }
  if (importRecord?.status === 'COMMITTED') return Object.freeze({ replay: true });
  if (dryRun?.passed !== true || Number(dryRun?.summary?.rejected ?? 0) !== 0
    || Number(dryRun?.summary?.review ?? 0) !== 0) {
    throw new DataExchangeContractError('DRY_RUN_NOT_PASSED', 'A successful dry-run with zero rejected or unresolved review rows is required.');
  }
  if (!sameDigest(importRecord?.sourceSha256, currentSourceSha256)) {
    throw new DataExchangeContractError('SOURCE_HASH_CHANGED', 'The source file changed after dry-run.');
  }
  assertApprovalMatches({ dryRun, approval, sourceSha256: currentSourceSha256 });
  return Object.freeze({ replay: false, advisoryLockKey: `phase7-import:${importRecord.importId}` });
}

export function nextImportVersion({ sameHashImport, latestVersion = 0 }) {
  if (sameHashImport) return Object.freeze({ replay: true, importVersion: sameHashImport.importVersion });
  return Object.freeze({ replay: false, importVersion: Number(latestVersion) + 1 });
}

export function createImportDryRun({
  importType,
  rows,
  sourceSha256,
  createdBy = 'phase7-data-exchange',
  latestVersion = 0,
  sameHashImport = null,
  priorCommittedDuplicateKeys = [],
} = {}) {
  if (!PHASE7_TYPES.has(importType)) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown Phase 7 import type.');
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  if (!isDigest(sourceSha256)) throw new DataExchangeContractError('DIGEST_INVALID', 'Source SHA-256 is required.');

  const version = nextImportVersion({ sameHashImport, latestVersion });
  const state = {
    duplicateKeys: new Set(),
    priorCommittedDuplicateKeys: new Set(priorCommittedDuplicateKeys),
  };
  const dryRunRows = rows.map((row, index) => buildRowRecord(importType, row, index, state));
  const summary = summarizeDryRun(dryRunRows);
  const digest = buildDigest({
    importType,
    sourceSha256: sourceSha256.toLowerCase(),
    schemaVersion: PHASE7_SCHEMA_VERSION,
    rows: dryRunRows.map((row) => ({
      rowDigest: row.rowDigest,
      rowStatus: row.rowStatus,
      warningCodes: row.warningCodes,
      reviewReasons: row.reviewReasons,
    })),
    summary,
  });
  const passed = Number(summary.rejected) === 0 && Number(summary.missingRequiredFields) === 0;
  if (passed) assertDryRunCanPass({ importType, summary, dryRunDigest: digest, sourceSha256 });
  const status = sameHashImport
    ? 'COMMITTED'
    : passed
      ? 'DRY_RUN_READY'
      : 'DRY_RUN_FAILED';
  if (!RECORD_STATUS_SET.has(status)) {
    throw new DataExchangeContractError('IMPORT_STATUS_INVALID', 'Import state produced an invalid status.');
  }
  return Object.freeze({
    importId: sameHashImport?.importId ?? randomUUID(),
    importType,
    datasetRole: DATASET_ROLES[importType],
    schemaVersion: PHASE7_SCHEMA_VERSION,
    importVersion: version.importVersion,
    replay: version.replay,
    status,
    createdBy,
    sourceSha256: sourceSha256.toLowerCase(),
    dryRun: Object.freeze({
      passed,
      digest,
      summary,
      rows: dryRunRows,
    }),
  });
}

export function submitImportDryRun(importRecord, { actor = 'phase7-data-exchange', now = new Date() } = {}) {
  if (importRecord?.status === 'COMMITTED') {
    return Object.freeze({ ...importRecord, submission: null });
  }
  if (importRecord?.status !== 'DRY_RUN_READY') {
    throw new DataExchangeContractError('IMPORT_SUBMIT_FORBIDDEN', 'Only a passing dry-run can be submitted for approval.');
  }
  return Object.freeze({
    ...importRecord,
    status: 'SUBMITTED',
    submission: Object.freeze({
      actor,
      submittedAt: new Date(now).toISOString(),
      digest: importRecord.dryRun.digest,
      sourceSha256: importRecord.sourceSha256,
    }),
  });
}

export function approveImportSubmission(importRecord, {
  approverIdentity,
  approverRole,
  decision = 'APPROVED',
  reason = null,
  now = new Date(),
} = {}) {
  if (!['SUBMITTED', 'APPROVED'].includes(importRecord?.status)) {
    throw new DataExchangeContractError('IMPORT_APPROVAL_FORBIDDEN', 'Import must be submitted before approval.');
  }
  if (!['APPROVED', 'REJECTED', 'REVOKED'].includes(decision)) {
    throw new DataExchangeContractError('IMPORT_APPROVAL_DECISION_INVALID', 'Unsupported import approval decision.');
  }
  const approval = Object.freeze({
    importId: importRecord.importId,
    decision,
    dryRunDigest: importRecord.dryRun.digest,
    sourceSha256: importRecord.sourceSha256,
    approverIdentity: text(approverIdentity),
    approverRole: text(approverRole),
    reason: text(reason),
    decidedAt: new Date(now).toISOString(),
    idempotencyKey: createHash('sha256')
      .update(`${importRecord.importId}:${decision}:${importRecord.dryRun.digest}:${importRecord.sourceSha256}:${approverIdentity}:${approverRole}`)
      .digest('hex'),
  });
  return Object.freeze({
    ...importRecord,
    status: decision === 'APPROVED' ? 'APPROVED' : 'SUBMITTED',
    approval,
  });
}

export function buildProductRevisionPlan({
  productMasterId,
  row,
  sourceImportId,
  sourceImportRowId,
  latestRevisionNumber = 0,
} = {}) {
  const normalizedPayload = normalizePayload(IMPORT_TYPES.PRODUCT_MASTER_UPDATE, row ?? {});
  if (!text(productMasterId)) {
    throw new DataExchangeContractError('PRODUCT_MASTER_ID_REQUIRED', 'Product revisions must preserve an existing product_master.id.');
  }
  return Object.freeze({
    productMasterId,
    sourceImportId: sourceImportId ?? null,
    sourceImportRowId: sourceImportRowId ?? null,
    supersedesRevisionId: row?.supersedesRevisionId ?? null,
    revisionNumber: Number(latestRevisionNumber) + 1,
    productProfile: normalizedPayload.product_profile,
    category: normalizedPayload.category,
    subcategory: normalizedPayload.subcategory,
    catalogStatus: normalizedPayload.catalog_status,
    effectiveDate: normalizedPayload.effective_date,
    approvalStatus: 'APPROVED',
    revisionPayload: normalizedPayload,
    preservesProductMasterId: true,
    recordDigest: buildDigest({
      productMasterId,
      sourceImportId,
      sourceImportRowId,
      normalizedPayload,
    }),
  });
}

export function commitImportRecord(importRecord, { approval, currentSourceSha256 = importRecord?.sourceSha256, now = new Date() } = {}) {
  const commitGate = assertCommitAllowed({
    importRecord,
    dryRun: importRecord?.dryRun,
    approval,
    currentSourceSha256,
  });
  if (commitGate.replay) {
    return Object.freeze({
      ...importRecord,
      replay: true,
      committedAt: importRecord.committedAt ?? new Date(now).toISOString(),
    });
  }
  const productRevisions = importRecord.dryRun.rows
    .filter((row) => row.rowStatus === 'ACCEPTED' && row.revisionPlan?.preservesProductMasterId)
    .map((row) => buildProductRevisionPlan({
      productMasterId: row.revisionPlan.productMasterId,
      row: row.rawPayload,
      sourceImportId: importRecord.importId,
      sourceImportRowId: row.rowDigest,
      latestRevisionNumber: row.revisionPlan.latestRevisionNumber,
    }));

  const relationshipEffects = importRecord.dryRun.rows
    .filter((row) => row.rowStatus === 'ACCEPTED' && row.relationshipBoundary)
    .map((row) => ({
      externalCustomerId: row.normalizedPayload.external_customer_id,
      externalDealOrOrderId: row.normalizedPayload.external_deal_or_order_id,
      ...row.relationshipBoundary,
    }));

  return Object.freeze({
    ...importRecord,
    status: 'COMMITTED',
    approval,
    committedAt: new Date(now).toISOString(),
    replay: false,
    advisoryLockKey: commitGate.advisoryLockKey,
    productRevisions,
    relationshipEffects,
  });
}

export function buildImportErrorReport(importRecord) {
  return importRecord?.dryRun?.rows
    ?.filter((row) => row.rowStatus === 'REJECTED' || row.rowStatus === 'REVIEW')
    .map((row) => Object.freeze({
      row_number: row.rowNumber,
      row_status: row.rowStatus,
      error_codes: row.errorCodes,
      warning_codes: row.warningCodes,
      review_reasons: row.reviewReasons,
    })) ?? [];
}
