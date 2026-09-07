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

export const OUTREACH_EXPORT_LABELS=Object.freeze({
  company_name:'公司 / Company',matched_categories:'目标类目 / Target Category',opportunity_status:'机会状态 / Opportunity Status',
  recipient:'收件邮箱 / Recipient',recipient_type:'收件人类型 / Recipient Type',recipient_source:'收件人来源 / Recipient Source',
  email_send_eligibility:'邮件联系资格 / Email Send Eligibility',management_approval:'当前管理审核 / Current Management Approval',
  draft_status:'开发信审核 / Draft Approval',business_contact_status:'联系状态 / Business Contact Status',
  transport_status:'邮件提交状态 / SMTP Status',receipt_evidence_status:'收件证据 / Receipt Evidence Status',
  sent_at:'发送时间 / Sent At',reply_status:'回复状态 / Reply Status',suppression:'停止联系 / Suppression',
  owner:'负责人 / Owner',next_action:'下一步 / Next Action',crm_sync:'跟进同步 / CRM Sync'
});
export function outreachExportValue(value,key=''){
  if(key==='matched_categories'){
    const categories={TOPS:'上衣 / Tops',DRESSES:'连衣裙 / Dresses',SKIRTS:'半身裙 / Skirts',PANTS:'裤装 / Pants',TROUSERS:'裤装 / Trousers',
      SHORTS:'短裤 / Shorts',OUTERWEAR:'外套 / Outerwear',KNITWEAR:'针织服装 / Knitwear',WOMENSWEAR:'女装 / Womenswear',
      ACTIVEWEAR:'运动服 / Activewear',SWIMWEAR:'泳装 / Swimwear',UNDERWEAR:'内衣 / Underwear',SLEEPWEAR:'睡衣 / Sleepwear',
      LOUNGEWEAR:'家居服 / Loungewear',GENERAL_MERCHANDISE:'百货 / General merchandise'};
    return String(value||'').split(';').map(part=>categories[part.trim().toUpperCase()]||part.trim()).filter(Boolean).join('; ');
  }
  const labels={SENT_NO_REPLY:'已发送，未回复 / Sent, no reply yet',SMTP_ACCEPTED:'邮件服务已接收 / Mail server accepted',
    UNCONFIRMED:'尚无收件确认 / Receipt not confirmed',RECEIVED_CONFIRMED:'收件已确认 / Receipt confirmed',
    NOT_SENT:'尚未发送 / Not sent',NOT_ATTEMPTED:'尚未提交 / Not submitted',REPLIED:'已回复 / Replied',
    OPTED_OUT:'已退订 / Opted out',DO_NOT_CONTACT:'停止联系 / Do not contact',NOT_CONTACTED:'尚未联系 / Not contacted',
    REVIEW_REPLY:'处理回复 / Review reply',REVIEW_SEND_RESULT:'核对发送结果 / Review send result',
    BOUNCED:'已退信 / Bounced',SEND_AMBIGUOUS:'发送待核对 / Send requires review',
    SEND_FAILED:'发送失败 / Send failed',ELIGIBLE:'符合联系条件 / Eligible',BLOCKED:'待补齐联系条件 / Pending requirements',
    MANAGEMENT_APPROVED:'已确认联系 / Contact approved',RECOMMENDED:'建议联系 / Recommended',
    APPROVED:'已批准 / Approved',DRAFT:'草稿 / Draft',PENDING_REVIEW:'待审核 / Pending review',
    OFFICIAL_COMPANY_EMAIL:'官方公司邮箱 / Official company email',OFFICIAL_DEPARTMENT_EMAIL:'官方部门邮箱 / Official department email',
    NAMED_BUYER_EMAIL:'实名联系人邮箱 / Named buyer email',NOT_REQUIRED:'暂无同步事项 / Nothing to sync',
    SYNCED:'已同步 / Synced',PENDING:'待同步 / Pending sync',WAIT_FOR_REPLY:'等待回复 / Wait for reply',
    STOP_CONTACT:'停止联系 / Stop contact',REVIEW_DRAFT:'审核开发信 / Review draft',NO_REPLY_YET:'尚未回复 / No reply yet',
    NOT_ASSIGNED:'待分配 / Not assigned'};
  return typeof value==='boolean'?(value?'是 / Yes':'否 / No'):(labels[value]??value??'');
}

const BASE_COLUMNS = Object.freeze([
  'company_name',
  ...Object.keys(OUTREACH_EXPORT_LABELS).filter(key=>!['company_name','matched_categories','opportunity_status','draft_status','owner','next_action'].includes(key)),
  'market',
  'matched_categories',
  'category_evidence',
  'company_verification',
  'buyer_type',
  'named_buyer',
  'official_email',
  'official_phone',
  'official_whatsapp',
  'official_contact_page',
  'opportunity_status',
  'primary_blocker',
  'latest_evidence_time',
  'evidence_url',
  'country_code',
  'website_url',
  'verification_status',
  'lifecycle_status',
  'buyer_business_model',
  'product_profile',
  'product_category_score',
  'product_category_score_band',
  'target_category_match',
  'observed_company_categories',
  'dpv_supply_categories',
  'category_opportunity_basis',
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

const PROVIDER_USAGE_COLUMNS = Object.freeze([
  'research_job_id','job_type','status','market','product_profile',
  'provider_call_count','provider_completed_count','provider_not_found_count',
  'provider_temporary_error_count','provider_failed_count','reserved_units',
  'used_units','released_units','last_provider_event_at','projection_updated_at',
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

function exportColumnsForRole(role, { financeAuthorized = false, exportType = '' } = {}) {
  const base = EXPORT_COLUMN_ALLOWLISTS[role];
  if (!base) return null;
  if (exportType === 'RESEARCH_JOB_PROVIDER_USAGE') return [...PROVIDER_USAGE_COLUMNS];
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
  const allowlist = exportColumnsForRole(request?.requesterRole, {
    financeAuthorized: request?.financeAuthorized === true,
    exportType: request?.exportType,
  });
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
