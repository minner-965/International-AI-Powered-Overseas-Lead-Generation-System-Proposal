import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  EXPORT_FORMATS,
  EXPORT_MODES,
  EXPORT_TYPES,
  PHASE7_SCHEMA_VERSION,
} from './constants.js';
import {
  buildDigest,
  DataExchangeContractError,
  escapeFormulaCell,
  stableJson,
} from './fileContract.js';

const BASE_COLUMNS = Object.freeze([
  'company_name',
  'market',
  'country_code',
  'website_url',
  'verification_status',
  'lifecycle_status',
  'buyer_business_model',
  'product_profile',
  'product_category_score',
  'product_category_score_band',
  'category_procurement_match',
  'customer_procurement_categories',
  'dpv_supply_categories',
  'category_opportunity_basis',
  'supplier_access',
  'product_access_matrix',
  'readiness',
  'readiness_blockers',
  'decision_maker',
  'buying_department',
  'business_contact',
  'contact_verification',
  'company_suppression',
  'contact_suppression',
  'draft_status',
  'approval_status',
  'send_status',
  'reply_summary',
  'owner',
  'next_action',
  'dpv_score',
  'management_baseline_match',
  'mexico_historical_reference_match',
  'source_reference_urls',
  'last_assessed_at',
  'last_verified_at',
]);

export const EXPORT_COLUMN_ALLOWLISTS = Object.freeze({
  SALES: Object.freeze([...BASE_COLUMNS]),
  MANAGEMENT: Object.freeze([...BASE_COLUMNS]),
  DATA_ADMIN: Object.freeze([...BASE_COLUMNS, 'external_lead_id', 'source_system']),
  FINANCE: Object.freeze([...BASE_COLUMNS, 'customer_sales_price', 'supplier_cost', 'currency']),
});

const NEVER_EXPORT = new Set([
  'api_key',
  'provider_secret',
  'profit',
  'margin',
  'raw_order_payload',
  'private_customer_notes',
  'source_unc_path',
  'local_staging_path',
  'internal_file_path',
  'provider_raw_payload',
  'internal_telemetry',
]);

function sameDigest(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(String(left ?? '')) || !/^[0-9a-f]{64}$/i.test(String(right ?? ''))) return false;
  return timingSafeEqual(Buffer.from(String(left).toLowerCase()), Buffer.from(String(right).toLowerCase()));
}

function exportColumnsForRole(role, { financeAuthorized = false } = {}) {
  const base = EXPORT_COLUMN_ALLOWLISTS[role];
  if (!base) return null;
  if (role !== 'FINANCE' || financeAuthorized !== true) {
    return base.filter((column) => column !== 'supplier_cost');
  }
  return base;
}

export function resolveExportRequest(request) {
  if (!EXPORT_TYPES.includes(request?.exportType)) {
    throw new DataExchangeContractError('EXPORT_TYPE_UNKNOWN', 'Unknown export type.');
  }
  if (!EXPORT_FORMATS.includes(request?.format)) {
    throw new DataExchangeContractError('EXPORT_FORMAT_UNKNOWN', 'Export format must be CSV or XLSX.');
  }
  if (!EXPORT_MODES.includes(request?.mode)) {
    throw new DataExchangeContractError('EXPORT_MODE_UNKNOWN', 'Unknown export mode.');
  }
  const allowlist = exportColumnsForRole(request?.requesterRole, { financeAuthorized: request?.financeAuthorized === true });
  if (!allowlist) throw new DataExchangeContractError('EXPORT_ROLE_FORBIDDEN', 'Requester role has no export permission.');
  if (request.mode === 'FULL_AUTHORIZED_MASTER' && !['MANAGEMENT', 'DATA_ADMIN'].includes(request.requesterRole)) {
    throw new DataExchangeContractError('FULL_EXPORT_FORBIDDEN', 'Role may not request the full master export.');
  }
  if (request.mode === 'SELECTED_ROWS' && (!Array.isArray(request.selectedEntityIds) || request.selectedEntityIds.length < 1)) {
    throw new DataExchangeContractError('SELECTED_ROWS_REQUIRED', 'Selected row export requires entity IDs.');
  }
  const requested = request.columns?.length ? request.columns : allowlist;
  const prohibited = requested.filter((column) => NEVER_EXPORT.has(column));
  const unauthorized = requested.filter((column) => !allowlist.includes(column));
  if (prohibited.length || unauthorized.length) {
    throw new DataExchangeContractError('EXPORT_COLUMN_FORBIDDEN', 'One or more export columns are not permitted.', { prohibited, unauthorized });
  }
  return Object.freeze({
    exportType: request.exportType,
    format: request.format,
    mode: request.mode,
    requesterRole: request.requesterRole,
    requesterIdentity: String(request.requesterIdentity ?? ''),
    financeAuthorized: request?.financeAuthorized === true,
    columns: Object.freeze([...new Set(requested)]),
    filters: Object.freeze({ ...(request.filters ?? {}) }),
    selectedEntityIds: Object.freeze([...(request.selectedEntityIds ?? [])]),
    schemaVersion: PHASE7_SCHEMA_VERSION,
  });
}

export function projectExportRow(row, resolvedRequest) {
  return Object.fromEntries(
    resolvedRequest.columns.map((column) => [column, escapeFormulaCell(row?.[column] ?? '')])
  );
}

export function buildExportSnapshotDigest(rows, resolvedRequest) {
  return buildDigest({
    schemaVersion: resolvedRequest.schemaVersion,
    exportType: resolvedRequest.exportType,
    mode: resolvedRequest.mode,
    columns: resolvedRequest.columns,
    filters: resolvedRequest.filters,
    rows: rows.map((row) => projectExportRow(row, resolvedRequest)),
  });
}

export function issueDownloadToken({ tokenBytes = 18, now = new Date(), ttlSeconds = 900 } = {}) {
  const rawToken = randomBytes(tokenBytes).toString('base64url');
  const createdAt = new Date(now);
  return Object.freeze({
    rawToken,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(createdAt.getTime() + (ttlSeconds * 1000)).toISOString(),
  });
}

export function createExportJob(request, { now = new Date(), tokenTtlSeconds = 900, fileTtlSeconds = 3600 } = {}) {
  const resolved = resolveExportRequest(request);
  const snapshotAt = new Date(now);
  const download = issueDownloadToken({ now: snapshotAt, ttlSeconds: tokenTtlSeconds });
  const requestDigest = createHash('sha256')
    .update(stableJson({
      request: resolved,
      requesterIdentity: resolved.requesterIdentity,
      snapshotAt: snapshotAt.toISOString(),
    }))
    .digest('hex');
  return Object.freeze({
    job: Object.freeze({
      id: requestDigest,
      exportType: resolved.exportType,
      format: resolved.format,
      mode: resolved.mode,
      schemaVersion: resolved.schemaVersion,
      requesterIdentity: resolved.requesterIdentity,
      requesterRole: resolved.requesterRole,
      requestedColumns: resolved.columns,
      appliedColumns: resolved.columns,
      filters: resolved.filters,
      selectedEntityIds: resolved.selectedEntityIds,
      status: 'PROCESSING',
      snapshotAt: snapshotAt.toISOString(),
      requestDigest,
      storageProvider: 'LOCAL_EXPORT_DIRECTORY',
      storageKey: null,
      rowCount: null,
      fileSha256: null,
      internalFilePath: null,
      downloadTokenHash: download.tokenHash,
      downloadTokenIssuedAt: snapshotAt.toISOString(),
      downloadTokenExpiresAt: download.expiresAt,
      fileExpiresAt: new Date(snapshotAt.getTime() + (fileTtlSeconds * 1000)).toISOString(),
      lastDownloadedAt: null,
      completedAt: null,
    }),
    downloadToken: download.rawToken,
  });
}

export function finalizeExportJob(job, { rows, fileBytes, internalFilePath, storageKey = internalFilePath, now = new Date() } = {}) {
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
  return Object.freeze({
    ...job,
    status: 'READY',
    rowCount,
    fileSha256,
    internalFilePath,
    storageKey,
    completedAt: new Date(now).toISOString(),
  });
}

export function assertDownloadAllowed({ job, requesterIdentity, downloadToken, now = new Date() }) {
  if (job?.status !== 'READY') throw new DataExchangeContractError('EXPORT_NOT_READY', 'Export is not ready.');
  if (job?.requesterIdentity !== requesterIdentity) throw new DataExchangeContractError('DOWNLOAD_FORBIDDEN', 'Requester does not own this export.');
  if (!job?.downloadTokenExpiresAt || new Date(job.downloadTokenExpiresAt) <= now || !job?.fileExpiresAt || new Date(job.fileExpiresAt) <= now) {
    throw new DataExchangeContractError('EXPORT_EXPIRED', 'Export or download token has expired.');
  }
  const providedTokenHash = createHash('sha256').update(String(downloadToken ?? '')).digest('hex');
  if (!sameDigest(job.downloadTokenHash, providedTokenHash)) {
    throw new DataExchangeContractError('DOWNLOAD_TOKEN_INVALID', 'Download token is invalid.');
  }
  return true;
}

export function buildDownloadAuditEvent({ job, requesterIdentity, authorizationStatus, downloadToken, now = new Date() } = {}) {
  const requestDigest = buildDigest({
    exportJobId: job?.id,
    requesterIdentity,
    authorizationStatus,
    providedTokenHash: createHash('sha256').update(String(downloadToken ?? '')).digest('hex'),
    auditedAt: new Date(now).toISOString(),
  });
  return Object.freeze({
    exportJobId: job?.id ?? null,
    requesterIdentity,
    authorizationStatus,
    downloadedAt: new Date(now).toISOString(),
    requestDigest,
  });
}
