const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const items = payload => Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.results) ? payload.results : [];
const firstValue = (object, keys) => keys.map(key => object?.[key]).find(value => value !== undefined && value !== null && value !== '');

const STATE_LABELS = Object.freeze({
  DRY_RUN_READY:['检查通过','Check passed'], DRY_RUN_FAILED:['需要修正','Correction required'],
  SUBMITTED:['已提交审批','Submitted for approval'], APPROVED:['已批准','Approved'], COMMITTED:['已写入','Committed'],
  PROCESSING:['正在生成','Generating'], QUEUED:['等待处理','Queued'], READY:['可下载','Ready to download'],
  FAILED:['处理未完成','Not completed'], EXPIRED:['已过期','Expired'],
  ACCEPTED:['可接收','Accepted'], REVIEW:['需复核','Review'], REJECTED:['已拒绝','Rejected'], DUPLICATE:['重复记录','Duplicate'],
  DRAFT:['草稿','Draft'], INVALID_DRAFT:['需要修正','Correction required'], PENDING_REVIEW:['待审核','Pending review'],
  NEEDS_CHANGES:['需修改','Needs changes'], SUPERSEDED:['已有新版本','Superseded'],
  BLOCKED:['尚未满足条件','Requirements not met'], ELIGIBLE:['满足审核条件','Ready for review'],
  MANAGEMENT_APPROVED:['已确认进入待联系','Queued for contact'], RECOMMENDED:['建议联系','Recommended'],
  EVIDENCE_REQUIRED:['待补充资料','Evidence required'], HOLD:['暂不联系','On hold'], NOT_SUITABLE:['当前不适合','Not suitable'],
  REQUEST_EVIDENCE:['已要求补充资料','Evidence requested'], REOPEN:['已重新评估','Reopened'],
  ACTIVE:['当前有效','Active'], STALE:['已失效','Stale'], OPEN:['开放','Open'],
  VALID:['有效','Valid'], ACCEPT_ALL:['全域接收，需复核','Accept-all; review required'],
  PUBLICLY_OBSERVED:['企业页面已登记','Published by business'], FORMAT_VALID:['格式有效','Format valid'],
  NOT_VERIFIED:['尚未核验','Not verified'], UNKNOWN:['待确认','To confirm'], INVALID:['无效','Invalid'],
  PROVIDER_ACCEPTED:['服务已接收','Provider accepted'], DELIVERED:['已送达','Delivered'],
  DELIVERY_DELAYED:['送达延迟','Delivery delayed'], COMPLAINED:['收到投诉','Complaint received'], OPTED_OUT:['不再联系','Opted out'],
  OPENED:['已打开','Opened'], CLICKED:['已点击','Clicked'], REPLIED:['已回复','Replied'],
  SOFT_BOUNCED:['暂未送达','Temporary delivery issue'], HARD_BOUNCED:['退信','Bounced'],
  CANCELLED:['已取消','Cancelled'], OPT_OUT:['不再联系','Opted out'], COMPLAINT:['投诉','Complaint'],
  CATALOGUE:['目录需求','Catalogue request'], SAMPLE:['样品需求','Sample request'], QUOTATION:['报价需求','Quotation request'],
  MEETING:['会议意向','Meeting request'], DEFER:['稍后联系','Follow up later'], DECLINE:['暂无意向','Declined'],
  AUTO_REPLY:['自动回复','Automatic reply'], IRRELEVANT:['无关回复','Irrelevant'],
});

const REASON_LABELS = Object.freeze({
  OPPORTUNITY_MANAGEMENT_APPROVAL_REQUIRED:['机会尚未确认联系','Contact approval required'],
  EXACT_VERSION_APPROVAL_REQUIRED:['当前消息版本尚未批准','Exact message approval required'],
  ACTIVE_BUSINESS_EMAIL_REQUIRED:['需补充有效商务邮箱','Active business email required'],
  CONTACT_VERIFICATION_REQUIRED:['需完成联系核验','Contact verification required'],
  MAILBOX_LEVEL_VERIFICATION_REQUIRED:['需完成邮箱级核验','Mailbox verification required'],
  BUYER_MODEL_REQUIRED:['需确认采购模式','Buyer Model required'],
  CATEGORY_PROCUREMENT_MATCH_REQUIRED:['需补充客户类目依据','Customer category evidence required'],
  PRODUCT_PROFILE_REQUIRED:['需确认产品画像','Product profile required'],
  COMPANY_SUPPRESSED:['企业当前暂停联系','Company contact is paused'],
  CONTACT_SUPPRESSED:['该联系方式当前暂停使用','Contact route is paused'],
  MARKETING_CONTEXT_APPROVAL_REQUIRED:['业务介绍版本尚未批准','Marketing context approval required'],
  DRAFT_VALIDATION_REQUIRED:['开发信需要完成检查','Draft validation required'],
  SOURCE_HASH_CHANGED:['文件内容已变化，请重新检查','File changed; run the check again'],
  REQUIRED_FIELD:['缺少必填字段','Required field is missing'],
  DUPLICATE_RECORD:['与现有记录重复','Duplicates an existing record'],
  COMPANY_DUPLICATE_OR_INACTIVE:['企业记录重复或已停用','Company record is duplicate or inactive'],
  COMPANY_IDENTITY_REJECTED:['企业身份未通过核验','Company identity is not verified'],
  PUBLIC_WEBSITE_INVALID:['企业官网不可用或无效','Official website is unavailable or invalid'],
  EXISTING_CUSTOMER:['当前是现有客户','This company is already a customer'],
  EXCLUDED_BUYER_MODEL:['客户采购模式不在范围内','Buyer model is out of scope'],
  PRODUCT_MISMATCH:['产品方向不匹配','Product scope does not match'],
  COMPANY_VERIFICATION_REQUIRED:['需补充企业核验','Company verification is required'],
  COMPANY_LIFECYCLE_REVIEW:['需复核当前数据状态','Current lifecycle status needs review'],
  RELATIONSHIP_REVIEW_REQUIRED:['需复核客户关系状态','Relationship status needs review'],
  BUYER_MODEL_EVIDENCE_REQUIRED:['需补充采购模式依据','Buyer-model evidence is required'],
  DISTRIBUTION_PROCUREMENT_RESALE_EVIDENCE_REQUIRED:['需补充分销采购与转售依据','Distribution procurement and resale evidence is required'],
  CATEGORY_PROCUREMENT_EVIDENCE_REQUIRED:['需补充品类采购依据','Category procurement evidence is required'],
  COMPANY_IDENTITY_CONFLICT:['企业身份资料存在冲突','Company identity evidence conflicts'],
  BUSINESS_EVIDENCE_CONFLICT:['业务资料存在冲突','Business evidence conflicts'],
  VERIFIED_BUYER_REQUIRED:['需补充已核验采购联系人','A verified buyer contact is required'],
  VERIFIED_EMAIL_ROUTE_REQUIRED:['需补充有效邮箱路径','A verified email route is required'],
  EVIDENCE_REQUIRED_CONTACT_ROUTE:['需查找公司邮箱、电话或 WhatsApp','Company email, phone or WhatsApp is required'],
  COMPANY_CONTACT_ROUTE_AVAILABLE:['已有公司级联系通道','Company-level contact route available'],
  SALES_READINESS_REQUIRED:['销售跟进条件尚未满足','Sales readiness is not met'],
  POLICY_CONTACT_HOLD:['当前存在联系暂停策略','A contact-hold policy is active'],
});

const FIELD_LABELS = Object.freeze({
  company_name:['公司','Company'], market:['市场','Market'], country_code:['国家代码','Country code'], website_url:['企业网站','Official website'],
  verification_status:['核验状态','Verification'], lifecycle_status:['数据状态','Data status'], buyer_business_model:['客户采购模式','Buyer Model'],
  product_profile:['产品画像','Product Profile'], product_category_score:['商品类目评分','Product Category Score'],
  product_category_score_band:['类目评分等级','Category Score Band'],
  category_procurement_match:['类目采购匹配','Category Procurement Match'], supplier_access:['供应商准入','Supplier Access'],
  customer_procurement_categories:['客户采购/经营类目','Customer Procurement / Categories'],
  dpv_supply_categories:['DPV 可供货类目','DPV Supply Categories'], category_opportunity_basis:['类目机会依据','Category Opportunity Basis'],
  product_access_matrix:['类目与准入矩阵','Category Access Matrix'], readiness:['跟进准备状态','Readiness'], readiness_blockers:['阻碍项','Blockers'],
  decision_maker:['采购人员','Buying contact'], buying_department:['采购部门','Buying department'], business_contact:['商务联系方式','Business contact'],
  contact_verification:['联系核验','Contact verification'], draft_status:['开发信状态','Draft status'], approval_status:['消息审批','Message approval'],
  send_status:['联系状态','Outreach status'], reply_summary:['回复摘要','Reply summary'], owner:['负责人','Owner'], next_action:['下一步','Next action'],
  dpv_score:['DPV 评分','DPV Score'], management_baseline_match:['管理基准匹配','Management Baseline Match'],
  mexico_historical_reference_match:['墨西哥历史参考匹配','Mexico Historical Reference Match'], source_reference_urls:['来源链接','Source references'],
  last_assessed_at:['最近评估','Last assessed'], last_verified_at:['最近核验','Last verified'], external_lead_id:['外部线索编号','External lead ID'],
  source_system:['来源系统','Source system'], customer_sales_price:['客户成交价','Customer sales price'], supplier_cost:['供应成本','Supplier cost'], currency:['币种','Currency'],
});

export const phase7StateLabel = value => STATE_LABELS[text(value).toUpperCase()] || ['待确认','To confirm'];
export const phase7ReasonLabel = value => REASON_LABELS[text(value).toUpperCase()] || ['需业务复核','Business review required'];
export const phase7FieldLabel = value => FIELD_LABELS[text(value)] || ['业务字段','Business field'];

function statusTone(code) {
  return ['APPROVED','COMMITTED','READY','ACCEPTED','DELIVERED','VALID','ELIGIBLE','MANAGEMENT_APPROVED','RECOMMENDED'].includes(code)
    ? 'active' : ['REJECTED','FAILED','INVALID','HARD_BOUNCED','COMPLAINT','NOT_SUITABLE'].includes(code)
      ? 'rejected' : ['DRY_RUN_FAILED','REVIEW','NEEDS_CHANGES','EVIDENCE_REQUIRED','HOLD','ACCEPT_ALL'].includes(code) ? 'review' : 'unknown';
}

function statusBadge(value) {
  const code = text(value).toUpperCase() || 'UNKNOWN';
  const [zh,en] = phase7StateLabel(code);
  return `<span class="data-state-badge state-${statusTone(code)}">${bi(zh,en)}</span>`;
}

export const phase7StatusTone = value => statusTone(text(value).toUpperCase() || 'UNKNOWN');

export function phase7SessionHeaders() {
  return {};
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const response = await fetch(url, { cache:'no-store', credentials:'same-origin', ...options, headers });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || response.statusText || 'Request failed');
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

export { request as managementRequest };

async function downloadResponse(url, fallbackName) {
  const response = await fetch(url, { cache:'no-store', credentials:'same-origin' });
  if (!response.ok) {
    let message = response.statusText;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message || 'Download failed');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const basicName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : basicName || fallbackName;
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function setBusy(button, busy, labels) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  if (labels) button.innerHTML = busy ? bi(labels[0],labels[1]) : bi(labels[2],labels[3]);
}

function operationError(error, retryId = '') {
  const auth = [401,403].includes(error?.status);
  const unavailable = error?.status === 404 || error?.status === 503;
  const copy = auth ? ['当前账户需要相应权限。','The current account needs the required permission.']
    : unavailable ? ['此项服务尚未就绪，请稍后重试。','This service is not ready yet. Try again later.']
      : ['操作未完成，请检查后重试。','The operation was not completed. Check and try again.'];
  return `<div class="crm-data-error"><i class="ti ti-alert-circle" aria-hidden="true"></i><div>${bi(copy[0],copy[1])}</div>${retryId ? `<button id="${esc(retryId)}" class="btn btn-outline-secondary" type="button">${bi('重新读取','Retry')}</button>` : ''}</div>`;
}

const importState = { record:null };

function importSummaryRecord(payload) {
  return payload?.dry_run?.summary || payload?.dryRun?.summary || payload?.summary || payload?.import?.error_report?.summary || payload?.error_report?.summary || {};
}

function importRowsRecord(payload) {
  return items(payload?.dry_run?.rows || payload?.dryRun?.rows || payload?.rows || payload?.row_results);
}

function importRecordId(payload) {
  return firstValue(payload, ['id','import_id','importId']) || firstValue(payload?.import, ['id','import_id','importId']);
}

function importRecordStatus(payload) {
  return firstValue(payload, ['api_status','status','import_status']) || firstValue(payload?.import, ['api_status','status','import_status']) || 'UNKNOWN';
}

function renderImportSummary(payload) {
  const host = document.querySelector('#data-import-summary');
  const stateHost = document.querySelector('#data-import-state');
  if (!host || !stateHost) return;
  const summary = importSummaryRecord(payload);
  const values = [
    ['accepted','可接收','Accepted'], ['review','需复核','Review'], ['rejected','已拒绝','Rejected'], ['duplicate','重复记录','Duplicate'],
  ];
  host.innerHTML = `<div class="crm-data-summary-grid">${values.map(([key,zh,en]) => `<div><strong>${esc(Number(summary[key] ?? 0))}</strong>${bi(zh,en)}</div>`).join('')}</div>`;
  const status = text(importRecordStatus(payload)).toUpperCase();
  stateHost.className = `data-state-badge state-${statusTone(status)}`;
  stateHost.innerHTML = bi(...phase7StateLabel(status));
  const submit = document.querySelector('#data-import-submit');
  const approve = document.querySelector('#data-import-approve');
  const commit = document.querySelector('#data-import-commit');
  const report = document.querySelector('#data-import-error-report');
  if (submit) submit.disabled = status !== 'DRY_RUN_READY';
  if (approve) approve.disabled = status !== 'SUBMITTED';
  if (commit) commit.disabled = status !== 'APPROVED';
  if (report) report.disabled = !importRecordId(payload) || Number(summary.review ?? 0) + Number(summary.rejected ?? 0) < 1;
}

function renderImportRows(payload) {
  const host = document.querySelector('#data-import-rows');
  if (!host) return;
  const rows = importRowsRecord(payload);
  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="4" class="crm-loading-cell">${bi('当前检查没有逐行事项。','No row-level items require attention.')}</td></tr>`;
    return;
  }
  host.innerHTML = rows.map(row => {
    const reasons = [...(row.error_codes || row.errorCodes || []), ...(row.review_reasons || row.reviewReasons || [])];
    const warnings = row.warning_codes || row.warningCodes || [];
    return `<tr><td>${esc(firstValue(row,['row_number','rowNumber']) || '-')}</td><td>${statusBadge(firstValue(row,['row_status','rowStatus']))}</td><td>${reasons.length ? reasons.map(reason => bi(...phase7ReasonLabel(reason))).join('') : bi('无需处理','No action required')}</td><td>${warnings.length ? warnings.map(reason => bi(...phase7ReasonLabel(reason))).join('') : '-'}</td></tr>`;
  }).join('');
}

async function refreshImportRecord() {
  const id = importRecordId(importState.record);
  if (!id) return;
  const payload = await request(`/api/data-imports/${encodeURIComponent(id)}`);
  importState.record = payload;
  renderImportSummary(payload);
  let rowsPayload = payload;
  if (!importRowsRecord(payload).length) {
    try { rowsPayload = await request(`/api/data-imports/${encodeURIComponent(id)}/rows`); } catch {}
  }
  renderImportRows(rowsPayload);
}

async function importTransition(action, button) {
  const id = importRecordId(importState.record);
  if (!id) return;
  const status = document.querySelector('#data-import-status');
  setBusy(button,true,['正在处理','Processing','继续','Continue']);
  if (status) status.innerHTML = bi('正在保存当前操作。','Saving this operation.');
  try {
    importState.record = await request(`/api/data-imports/${encodeURIComponent(id)}/${action}`, {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({})
    });
    await refreshImportRecord();
    if (status) status.innerHTML = action === 'commit' ? bi('业务记录已写入。','Business records have been committed.') : bi('当前操作已保存。','The operation has been saved.');
  } catch (error) {
    if (status) status.innerHTML = operationError(error);
  } finally {
    button?.removeAttribute('aria-busy');
    if (button) button.disabled = false;
    renderImportSummary(importState.record);
  }
}

function currentOpportunityFilters() {
  const form = document.querySelector('#opportunity-filters');
  if (!form) return {};
  return Object.fromEntries([...new FormData(form).entries()].filter(([,value]) => text(value)));
}

function exportJobId(payload) {
  return firstValue(payload, ['id','export_id','exportId']) || firstValue(payload?.job, ['id','export_id','exportId']);
}

function exportJob(payload) {
  return payload?.job || payload || {};
}

function exportJobStatus(payload) {
  return text(firstValue(exportJob(payload),['status','export_status'])).toUpperCase() || 'PROCESSING';
}

function renderExportResult(payload) {
  const host = document.querySelector('#data-export-result');
  const columnsHost = document.querySelector('#data-export-columns');
  if (!host || !columnsHost) return;
  const job = exportJob(payload);
  const columns = job.applied_columns || job.appliedColumns || job.requested_columns || job.requestedColumns || [];
  columnsHost.innerHTML = columns.length ? `<div class="crm-column-list">${columns.map(column => bi(...phase7FieldLabel(column))).join('')}</div>` : bi('当前任务尚未返回字段清单。','This job has not returned a column list yet.');
  const status = exportJobStatus(payload);
  const rowCount = firstValue(job,['row_count','rowCount']);
  const created = firstValue(job,['completed_at','completedAt','created_at','createdAt','snapshot_at','snapshotAt']);
  const expires = firstValue(job,['file_expires_at','fileExpiresAt','expires_at','expiresAt']);
  const id = exportJobId(payload);
  const token = firstValue(payload,['download_token','downloadToken']);
  const href = id ? `/api/data-exports/${encodeURIComponent(id)}/download${token ? `?token=${encodeURIComponent(token)}` : ''}` : '';
  const emptyReady = status === 'READY' && Number(rowCount || 0) === 0;
  const downloadAction = status === 'READY' && href && !emptyReady
    ? `<button id="data-export-download" class="btn btn-primary" type="button"><i class="ti ti-download" aria-hidden="true"></i>${bi('下载文件','Download file')}</button>`
    : '';
  const emptyNotice = emptyReady
    ? `<div class="alert alert-warning crm-export-empty" role="status">${bi('当前筛选没有数据。请选择“累计授权主库”或返回业务机会页调整筛选后再导出。','The current filters contain no rows. Choose “Cumulative permitted master” or adjust the Opportunity filters before exporting.')}</div>`
    : '';
  host.className = 'card-body crm-export-result';
  host.innerHTML = `<div class="crm-export-result-head"><div>${statusBadge(status)}<strong>${bi('业务数据文件','Business data file')}</strong></div>${downloadAction}</div>${emptyNotice}<dl class="crm-detail-facts"><div><dt>${bi('行数','Rows')}</dt><dd>${rowCount == null ? '-' : esc(rowCount)}</dd></div><div><dt>${bi('生成时间','Generated at')}</dt><dd>${created ? esc(new Date(created).toLocaleString()) : '-'}</dd></div><div><dt>${bi('文件有效期','Available until')}</dt><dd>${expires ? esc(new Date(expires).toLocaleString()) : '-'}</dd></div><div><dt>${bi('格式','Format')}</dt><dd>${esc(firstValue(job,['format','export_format']) || '-')}</dd></div></dl>`;
  document.querySelector('#data-export-download')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setBusy(button,true,['正在准备','Preparing','下载文件','Download file']);
    try { await downloadResponse(href,`DPV_Export.${text(firstValue(job,['format','export_format'])).toLowerCase() || 'xlsx'}`); }
    catch (error) { document.querySelector('#data-export-status').innerHTML = operationError(error); }
    finally { setBusy(button,false,['正在准备','Preparing','下载文件','Download file']); }
  });
}

async function pollExport(payload) {
  const id = exportJobId(payload);
  if (!id) return;
  const downloadToken = firstValue(payload,['download_token','downloadToken']);
  let current = payload;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = exportJobStatus(current);
    renderExportResult(current);
    if (['READY','FAILED','EXPIRED'].includes(status)) return current;
    await new Promise(resolve => setTimeout(resolve,2500));
    const refreshed = await request(`/api/data-exports/${encodeURIComponent(id)}`);
    current = downloadToken ? { job:refreshed?.job || refreshed, download_token:downloadToken } : refreshed;
  }
  return current;
}

function wireDataImport() {
  const form = document.querySelector('#data-import-form');
  if (!form) return;
  document.querySelector('#data-import-template')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const type = document.querySelector('#data-import-type')?.value || 'PROSPECT_LEADS';
    setBusy(button,true,['正在准备','Preparing','下载当前模板','Download template']);
    try { await downloadResponse(`/api/data-imports/templates/${encodeURIComponent(type)}`,`DPV_${type}_Template.xlsx`); }
    catch (error) { document.querySelector('#data-import-status').innerHTML = operationError(error); }
    finally { setBusy(button,false,['正在准备','Preparing','下载当前模板','Download template']); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#data-import-dry-run');
    const status = document.querySelector('#data-import-status');
    const file = document.querySelector('#data-import-file')?.files?.[0];
    if (!file) { status.innerHTML = bi('请选择 CSV 或 XLSX 文件。','Choose a CSV or XLSX file.'); return; }
    setBusy(button,true,['正在检查','Checking','检查文件','Check file']);
    status.innerHTML = bi('正在检查文件结构和逐行结果。','Checking the file structure and row results.');
    document.querySelector('#data-import-summary')?.setAttribute('aria-busy','true');
    try {
      const contentBase64 = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.addEventListener('load',()=>resolve(String(reader.result || '').split(',').at(-1) || ''),{ once:true });
        reader.addEventListener('error',()=>reject(reader.error || new Error('File read failed')),{ once:true });
        reader.readAsDataURL(file);
      });
      const body = {
        import_type:document.querySelector('#data-import-type')?.value,
        filename:file.name,
        mime_type:file.type || (file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        content_base64:contentBase64,
      };
      importState.record = await request('/api/data-imports/dry-run',{ method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
      renderImportSummary(importState.record);
      await refreshImportRecord();
      status.innerHTML = bi('文件检查完成，请查看结果。','File check completed. Review the results.');
    } catch (error) {
      status.innerHTML = operationError(error);
      document.querySelector('#data-import-rows').innerHTML = `<tr><td colspan="4" class="crm-loading-cell">${bi('文件检查未完成。','The file check was not completed.')}</td></tr>`;
    } finally {
      document.querySelector('#data-import-summary')?.setAttribute('aria-busy','false');
      setBusy(button,false,['正在检查','Checking','检查文件','Check file']);
    }
  });
  document.querySelector('#data-import-submit')?.addEventListener('click', event => importTransition('submit',event.currentTarget));
  document.querySelector('#data-import-approve')?.addEventListener('click', event => importTransition('approve',event.currentTarget));
  document.querySelector('#data-import-commit')?.addEventListener('click', event => importTransition('commit',event.currentTarget));
  document.querySelector('#data-import-error-report')?.addEventListener('click', async event => {
    const id = importRecordId(importState.record);
    if (!id) return;
    const button = event.currentTarget;
    setBusy(button,true,['正在准备','Preparing','下载逐行结果','Download row results']);
    try { await downloadResponse(`/api/data-imports/${encodeURIComponent(id)}/error-report`,'DPV_Import_Row_Results.xlsx'); }
    catch (error) { document.querySelector('#data-import-status').innerHTML = operationError(error); }
    finally { setBusy(button,false,['正在准备','Preparing','下载逐行结果','Download row results']); renderImportSummary(importState.record); }
  });
}

function wireDataExport() {
  const form = document.querySelector('#data-export-form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#data-export-create');
    const status = document.querySelector('#data-export-status');
    const values = new FormData(form);
    const body = {
      export_type: values.get('export_type'), mode: values.get('mode'), format: values.get('format'),
      filters: values.get('mode') === 'CURRENT_FILTER' ? currentOpportunityFilters() : {},
    };
    setBusy(button,true,['正在建立任务','Creating job','生成文件','Generate file']);
    status.innerHTML = bi('正在建立导出任务。','Creating the export job.');
    try {
      const payload = await request('/api/data-exports',{ method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
      renderExportResult(payload);
      const finalPayload = await pollExport(payload);
      status.innerHTML = exportJobStatus(finalPayload || payload) === 'FAILED' ? bi('文件生成未完成，请重试。','File generation was not completed. Try again.') : bi('导出任务已更新。','The export job has been updated.');
    } catch (error) {
      status.innerHTML = operationError(error);
      document.querySelector('#data-export-result').innerHTML = operationError(error,'data-export-retry');
      document.querySelector('#data-export-retry')?.addEventListener('click',()=>form.requestSubmit());
    } finally {
      setBusy(button,false,['正在建立任务','Creating job','生成文件','Generate file']);
    }
  });
}

export function initPhase7Ui() {
  wireDataImport();
  wireDataExport();
}

const detailStates = new WeakMap();

function detailEmpty(icon, zh, en, bodyZh, bodyEn) {
  return `<div class="crm-empty-state crm-phase7-detail-state"><i class="ti ${esc(icon)}" aria-hidden="true"></i><h4>${bi(zh,en)}</h4></div>`;
}

function detailError(panel, loader, error) {
  panel.innerHTML = `${operationError(error,'phase7-detail-retry')}`;
  panel.querySelector('#phase7-detail-retry')?.addEventListener('click',loader);
}

function factList(rows) {
  return `<dl class="crm-detail-facts">${rows.map(([zh,en,value]) => `<div><dt>${bi(zh,en)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function queueRecord(payload, { companyId = '', productProfile = '' } = {}) {
  const rows = items(payload);
  const company = text(companyId);
  const profile = text(productProfile).toUpperCase();
  const match = rows.find(row => {
    if (company && text(firstValue(row,['company_id','companyId'])) !== company) return false;
    if (profile && text(firstValue(row,['product_profile','productProfile'])).toUpperCase() !== profile) return false;
    return true;
  });
  return match || (payload && !Array.isArray(payload) ? payload.item || payload : null);
}

function blockerList(record) {
  const blockers = firstValue(record,['blocker_codes','blockers','reason_codes','reasonCodes']) || [];
  const values = Array.isArray(blockers) ? blockers : [];
  return values.length ? `<ul class="crm-phase7-reason-list">${values.map(reason => `<li>${bi(...phase7ReasonLabel(reason))}</li>`).join('')}</ul>` : bi('当前记录未列出其他阻碍项。','No additional blockers are recorded.');
}

function dateValue(record, keys) {
  const value = firstValue(record,keys);
  return value ? esc(new Date(value).toLocaleString()) : '-';
}

function opportunityRef(state) {
  if (state.opportunityId) return state.opportunityId;
  if (state.companyId && state.productProfile) return `${state.companyId}:${state.productProfile}`;
  return '';
}

function currentOpportunity(decision) {
  return decision?.current || decision?.opportunity || null;
}

function opportunityStatus(record) {
  return firstValue(record,['display_opportunity_status','displayOpportunityStatus','opportunity_status','opportunityStatus','system_recommendation_status','systemRecommendationStatus']) || 'UNKNOWN';
}

function policyStatus(value) {
  const code = text(value).toUpperCase();
  return code === 'OPEN' ? bi('开放','Open') : statusBadge(code || 'UNKNOWN');
}

function actionButton(action, zh, en, kind = 'btn-outline-secondary') {
  return `<button class="btn ${esc(kind)}" type="button" data-phase7-action="${esc(action)}">${bi(zh,en)}</button>`;
}

function actionLabels(action) {
  return action === 'MANAGEMENT_APPROVED' ? ['正在保存','Saving','确认进入待联系','Confirm Contact']
    : action === 'HOLD' ? ['正在保存','Saving','暂缓','Hold']
      : action === 'REQUEST_EVIDENCE' ? ['正在保存','Saving','要求补充资料','Request Evidence']
        : ['正在保存','Saving','重新打开','Reopen'];
}

function readinessActions(record) {
  const display = text(opportunityStatus(record)).toUpperCase();
  const system = text(firstValue(record,['system_recommendation_status','systemRecommendationStatus'])).toUpperCase();
  const actions = [];
  if (display === 'RECOMMENDED' && system === 'RECOMMENDED') actions.push(actionButton('MANAGEMENT_APPROVED','确认进入待联系','Confirm Contact','btn-primary'));
  if (['RECOMMENDED','MANAGEMENT_APPROVED','EVIDENCE_REQUIRED'].includes(display)) actions.push(actionButton('HOLD','暂缓','Hold'));
  if (['RECOMMENDED','MANAGEMENT_APPROVED'].includes(display)) actions.push(actionButton('REQUEST_EVIDENCE','要求补充资料','Request Evidence'));
  if (['MANAGEMENT_APPROVED','EVIDENCE_REQUIRED','HOLD'].includes(display)) actions.push(actionButton('REOPEN','重新打开','Reopen'));
  return actions.join('');
}

function managementFlash(state) {
  if (!state?.flash) return '';
  const klass = state.flash.error ? 'crm-data-error' : 'crm-phase7-success';
  return `<div class="${klass}" role="status" aria-live="polite">${state.flash.html}</div>`;
}

function managementActionPanel(state, record, queue) {
  const actions = readinessActions(record);
  if (!actions) return '';
  return `<section class="crm-phase7-summary-card crm-phase7-management-panel"><header><div><h4>${bi('管理操作','Management Actions')}</h4></div>${queue ? statusBadge(firstValue(queue,['queue_status','status']) || 'ACTIVE') : ''}</header>${managementFlash(state)}<label class="crm-phase7-input-label" for="phase7-owner-identity">${bi('待联系负责人（可选）','Contact queue owner (optional)')}<input id="phase7-owner-identity" class="form-control" name="owner_identity" maxlength="160" value="${esc(accessValues().actor || '')}"></label><label class="crm-phase7-input-label" for="phase7-management-reason">${bi('管理备注（可选）','Management note (optional)')}<textarea id="phase7-management-reason" class="form-control" name="reason" rows="3" maxlength="1000" placeholder="${esc('补充原因 / Add a short reason')}"></textarea></label><div class="crm-phase7-action-grid">${actions}</div><div class="crm-operation-status" data-phase7-management-status role="status" aria-live="polite"></div></section>`;
}

function queueSummary(queue) {
  if (!queue) return `<div class="crm-empty-inline">${bi('当前没有 Active Contact Queue 记录。','There is no active Contact Queue record right now.')}</div>`;
  return `<div class="crm-phase7-queue-card" id="phase7-contact-queue-entry">${factList([
    ['队列状态','Queue status',statusBadge(firstValue(queue,['queue_status','status']) || 'ACTIVE')],
    ['待联系负责人','Owner',esc(firstValue(queue,['owner_identity','ownerIdentity']) || '-')],
    ['确认人','Confirmed by',esc(firstValue(queue,['approved_by','approvedBy','actor_identity','actorIdentity']) || '-')],
    ['确认时间','Confirmed at',dateValue(queue,['approved_at','approvedAt','queue_created_at','queueCreatedAt','created_at','createdAt'])],
  ])}${(firstValue(queue,['reason_codes','reasonCodes']) || []).length ? `<section class="crm-detail-section"><h4>${bi('入队原因','Queue reasons')}</h4>${blockerList(queue)}</section>` : ''}</div>`;
}

function readinessNote(record) {
  return '';
}

function readinessEntryLinks() {
  return `<div class="crm-phase7-inline-actions"><button class="btn btn-ghost-primary" type="button" data-phase7-open-tab="data-history">${bi('查看状态历史','Open Status History')}</button><button class="btn btn-ghost-primary" type="button" data-phase7-open-tab="data-history">${bi('查看待联系队列','Open Contact Queue')}</button></div>`;
}

function renderReadiness(state, decision, queue) {
  const record = currentOpportunity(decision);
  if (!record) return detailEmpty('ti-lock-check','尚无机会状态','No opportunity status yet','','');
  const display = opportunityStatus(record);
  const system = firstValue(record,['system_recommendation_status','systemRecommendationStatus']) || display;
  const contact = firstValue(record,['contact_readiness','contactReadiness','verification_status']) || 'UNKNOWN';
  const policy = firstValue(record,['policy_contact_status','policyContactStatus']) || 'OPEN';
  return `<div class="crm-phase7-detail-grid"><section class="crm-phase7-summary-card"><header><div><h4>${bi('机会状态','Opportunity Status')}</h4></div>${statusBadge(display)}</header>${readinessNote(record)}${factList([
    ['资格状态','Eligibility status',statusBadge(system)],
    ['联系准备','Contact readiness',statusBadge(contact)],
    ['联系策略','Contact policy',policyStatus(policy)],
    ['产品画像','Product profile',esc(firstValue(record,['product_profile','productProfile']) || '-')],
    ['最近评估','Last assessed',dateValue(record,['last_assessed_at','lastAssessedAt','assessed_at','assessedAt','created_at','createdAt'])],
  ])}${readinessEntryLinks()}</section>${managementActionPanel(state,record,queue)}<section class="crm-detail-section"><h4>${bi('Contact Queue 入口','Contact Queue Entry')}</h4>${queueSummary(queue)}</section><section class="crm-detail-section"><h4>${bi('当前阻碍','Current blockers')}</h4>${blockerList(record)}</section></div>`;
}

function draftCards(records) {
  if (!records.length) return detailEmpty('ti-pencil','尚无开发信草稿','No drafts yet','联系条件和业务介绍版本准备完成后，可建立草稿。','A draft can be created after readiness and the approved business context are available.');
  return `<div class="crm-phase7-card-list">${records.map(record => `<article class="crm-phase7-record-card"><header><div><h4>${bi('开发信草稿','Outreach Draft')}</h4><small>${bi('版本','Version')} ${esc(firstValue(record,['version','draft_version','draftVersion']) || '-')}</small></div>${statusBadge(firstValue(record,['status','draft_status','draftStatus']))}</header>${factList([
    ['主题','Subject',esc(firstValue(record,['subject']) || '-')], ['收件角色','Recipient role',esc(firstValue(record,['recipient_role','recipientRole']) || '-')],
    ['最近修改','Last updated',firstValue(record,['updated_at','updatedAt','created_at','createdAt']) ? esc(new Date(firstValue(record,['updated_at','updatedAt','created_at','createdAt'])).toLocaleString()) : '-'],
  ])}</article>`).join('')}</div>`;
}

function messageCards(records) {
  if (!records.length) return detailEmpty('ti-mail-off','尚无消息记录','No message records','管理确认和具体消息审批相互独立；当前没有已建立消息。','Contact confirmation and exact-message approval are separate; no message has been created.');
  return `<div class="crm-phase7-card-list">${records.map(record => `<article class="crm-phase7-record-card"><header><div><h4>${bi('联系消息','Outreach Message')}</h4><small>${esc(firstValue(record,['channel']) || 'EMAIL')}</small></div>${statusBadge(firstValue(record,['state','status','send_status','sendStatus']))}</header>${factList([
    ['消息审批','Message approval',statusBadge(firstValue(record,['approval_status','approvalStatus']))],
    ['服务状态','Delivery state',statusBadge(firstValue(record,['provider_status','providerStatus','state','status']))],
    ['最近更新','Last updated',firstValue(record,['updated_at','updatedAt','created_at','createdAt']) ? esc(new Date(firstValue(record,['updated_at','updatedAt','created_at','createdAt'])).toLocaleString()) : '-'],
  ])}</article>`).join('')}</div>`;
}

function replyCards(records) {
  if (!records.length) return detailEmpty('ti-message-circle-off','尚无回复','No replies','当前没有客户回复或待处理下一步。','There is no customer reply or next action to review.');
  return `<div class="crm-phase7-card-list">${records.map(record => `<article class="crm-phase7-record-card"><header><div><h4>${bi('回复与下一步','Reply and Next Action')}</h4><small>${esc(firstValue(record,['received_at','receivedAt','created_at','createdAt']) ? new Date(firstValue(record,['received_at','receivedAt','created_at','createdAt'])).toLocaleString() : '-')}</small></div>${statusBadge(firstValue(record,['intent','reply_intent','replyIntent']))}</header>${factList([
    ['处理状态','Review status',statusBadge(firstValue(record,['review_status','reviewStatus','status']))],
    ['负责人','Owner',esc(firstValue(record,['owner','assigned_to','assignedTo']) || '-')],
    ['下一步','Next action',esc(firstValue(record,['next_action_label','nextActionLabel']) || '-')],
  ])}</article>`).join('')}</div>`;
}

function historyRows(records, { emptyZh = '尚无联系数据历史', emptyEn = 'No outreach data history' } = {}) {
  if (!records.length) return detailEmpty('ti-history',emptyZh,emptyEn,'当前没有联系核验、审批、消息或回复事件。','There are no verification, approval, message or reply events.');
  return `<div class="table-responsive" role="region" aria-label="联系数据历史 Outreach data history" tabindex="0"><table class="table table-vcenter crm-table crm-phase7-history"><thead><tr><th>${bi('时间','Date')}</th><th>${bi('业务事件','Business event')}</th><th>${bi('状态','Status')}</th></tr></thead><tbody>${records.map(record => `<tr><td>${dateValue(record,['occurred_at','occurredAt','created_at','createdAt','verified_at','verifiedAt'])}</td><td>${bi(...phase7StateLabel(firstValue(record,['event_type','eventType','type'])))}</td><td>${statusBadge(firstValue(record,['status','state','result','verification_status','verificationStatus']))}</td></tr>`).join('')}</tbody></table></div>`;
}

function decisionSnapshotTable(records) {
  if (!records.length) return `<div class="crm-empty-inline">${bi('尚无状态历史。','No status history yet.')}</div>`;
  return `<div class="table-responsive" id="phase7-decision-history" role="region" aria-label="机会状态历史 Opportunity status history" tabindex="0"><table class="table table-vcenter crm-table crm-phase7-history"><thead><tr><th>${bi('时间','Date')}</th><th>${bi('展示状态','Display status')}</th><th>${bi('资格状态','Eligibility status')}</th><th>${bi('联系准备','Contact readiness')}</th></tr></thead><tbody>${records.map(record => `<tr><td>${dateValue(record,['last_assessed_at','lastAssessedAt','assessed_at','assessedAt','created_at','createdAt'])}</td><td>${statusBadge(opportunityStatus(record))}</td><td>${statusBadge(firstValue(record,['system_recommendation_status','systemRecommendationStatus']) || 'UNKNOWN')}</td><td>${statusBadge(firstValue(record,['contact_readiness','contactReadiness']) || 'UNKNOWN')}</td></tr>`).join('')}</tbody></table></div>`;
}

function managementEventTable(records) {
  if (!records.length) return `<div class="crm-empty-inline">${bi('尚无管理操作记录。','No management actions have been recorded yet.')}</div>`;
  return `<div class="table-responsive" role="region" aria-label="管理操作历史 Management action history" tabindex="0"><table class="table table-vcenter crm-table crm-phase7-history"><thead><tr><th>${bi('时间','Date')}</th><th>${bi('动作','Action')}</th><th>${bi('操作人','Actor')}</th><th>${bi('备注','Note')}</th></tr></thead><tbody>${records.map(record => `<tr><td>${dateValue(record,['created_at','createdAt'])}</td><td>${statusBadge(firstValue(record,['event_type','eventType']) || firstValue(record,['management_contact_status','managementContactStatus']) || 'UNKNOWN')}</td><td>${esc(firstValue(record,['actor_identity','actorIdentity']) || '-')}</td><td>${esc(firstValue(record,['reason']) || '-')}</td></tr>`).join('')}</tbody></table></div>`;
}

function contactQueueTable(records) {
  if (!records.length) return `<div class="crm-empty-inline">${bi('尚无 Contact Queue 历史。','No Contact Queue history is available yet.')}</div>`;
  return `<div class="table-responsive" role="region" aria-label="待联系队列历史 Contact Queue history" tabindex="0"><table class="table table-vcenter crm-table crm-phase7-history"><thead><tr><th>${bi('入队时间','Queued at')}</th><th>${bi('队列状态','Queue status')}</th><th>${bi('负责人','Owner')}</th><th>${bi('原因','Reason')}</th></tr></thead><tbody>${records.map(record => `<tr><td>${dateValue(record,['created_at','createdAt','updated_at','updatedAt'])}</td><td>${statusBadge(firstValue(record,['queue_status','status']) || 'UNKNOWN')}</td><td>${esc(firstValue(record,['owner_identity','ownerIdentity']) || '-')}</td><td>${Array.isArray(firstValue(record,['reason_codes','reasonCodes'])) && firstValue(record,['reason_codes','reasonCodes']).length ? firstValue(record,['reason_codes','reasonCodes']).map(code => bi(...phase7ReasonLabel(code))).join('') : esc(firstValue(record,['reason']) || '-')}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderDecisionHistory(data) {
  const current = currentOpportunity(data.decision);
  const snapshots = items(data.decision?.snapshots);
  const events = items(data.decision?.management_events || data.decision?.managementEvents);
  const queueHistory = items(data.decision?.contact_queue_history || data.decision?.contactQueueHistory);
  if (!current && !snapshots.length && !events.length && !queueHistory.length && !data.history.length) {
    return detailEmpty('ti-history','尚无业务历史','No business history yet','','');
  }
  return `<div class="crm-phase7-card-list"><section class="crm-phase7-summary-card"><header><div><h4>${bi('当前机会状态','Current Opportunity State')}</h4></div>${current ? statusBadge(opportunityStatus(current)) : ''}</header>${current ? factList([
    ['资格状态','Eligibility status',statusBadge(firstValue(current,['system_recommendation_status','systemRecommendationStatus']) || 'UNKNOWN')],
    ['联系准备','Contact readiness',statusBadge(firstValue(current,['contact_readiness','contactReadiness']) || 'UNKNOWN')],
    ['联系策略','Contact policy',policyStatus(firstValue(current,['policy_contact_status','policyContactStatus']) || 'OPEN')],
    ['最近评估','Last assessed',dateValue(current,['last_assessed_at','lastAssessedAt','assessed_at','assessedAt','created_at','createdAt'])],
  ]) : `<div class="crm-empty-inline">${bi('尚无当前机会状态。','No current opportunity status.')}</div>`}</section><section class="crm-detail-section"><h4>${bi('状态历史','Status History')}</h4>${decisionSnapshotTable(snapshots)}</section><section class="crm-detail-section"><h4>${bi('管理操作历史','Management Action History')}</h4>${managementEventTable(events)}</section><section class="crm-detail-section"><h4>${bi('待联系队列','Contact Queue')}</h4>${contactQueueTable(queueHistory)}</section><section class="crm-detail-section"><h4>${bi('联系数据历史','Outreach Data History')}</h4>${historyRows(data.history,{ emptyZh:'尚无联系数据历史', emptyEn:'No outreach data history' })}</section></div>`;
}

async function optionalRequest(url) {
  try { return await request(url); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

async function detailData(detail) {
  const state = detailStates.get(detail);
  if (state.cache) return state.cache;
  const reference = opportunityRef(state);
  const query = new URLSearchParams({ company_id:state.companyId });
  if (state.opportunityId) query.set('opportunity_id',state.opportunityId);
  const [decision,queuePayload] = await Promise.all([
    reference ? optionalRequest(`/api/opportunities/${encodeURIComponent(reference)}/decision-history`) : null,
    optionalRequest(`/api/contact-queue?${query}`)
  ]);
  const queue = queueRecord(queuePayload,{ companyId:state.companyId, productProfile:state.productProfile });
  const draftInline = items(queue?.drafts || queuePayload?.drafts);
  const messageInline = items(queue?.messages || queuePayload?.messages);
  const draftIds = [...new Set([firstValue(queue,['draft_id','draftId']), ...(queue?.draft_ids || queue?.draftIds || [])].filter(Boolean))];
  const messageIds = [...new Set([firstValue(queue,['message_id','messageId']), ...(queue?.message_ids || queue?.messageIds || [])].filter(Boolean))];
  const threadIds = [...new Set([firstValue(queue,['thread_id','threadId']), ...(queue?.thread_ids || queue?.threadIds || [])].filter(Boolean))];
  const [drafts,messages,threads,inbox] = await Promise.all([
    Promise.all(draftIds.map(id => optionalRequest(`/api/outreach/drafts/${encodeURIComponent(id)}`))),
    Promise.all(messageIds.map(id => optionalRequest(`/api/outreach/messages/${encodeURIComponent(id)}`))),
    Promise.all(threadIds.map(id => optionalRequest(`/api/outreach/threads/${encodeURIComponent(id)}`))),
    optionalRequest(`/api/outreach/inbox?company_id=${encodeURIComponent(state.companyId)}`),
  ]);
  const messageEvents = await Promise.all(messageIds.map(id => optionalRequest(`/api/outreach/messages/${encodeURIComponent(id)}/events`)));
  const verificationHistory = await Promise.all(state.contactIds.map(id => optionalRequest(`/api/contacts/${encodeURIComponent(id)}/verification-history`)));
  state.cache = {
    decision,
    queue,
    drafts:[...draftInline,...drafts.filter(Boolean).map(value => value.draft || value)],
    messages:[...messageInline,...messages.filter(Boolean).map(value => value.message || value)],
    replies:[
      ...items(inbox).filter(record => text(firstValue(record,['company_id','companyId'])) === text(state.companyId)),
      ...threads.flatMap(value => items(value?.inbound_messages || value?.inboundMessages || value?.replies || value?.messages))
        .filter(record => firstValue(record,['direction']) !== 'OUTBOUND')
    ],
    history:[...items(queue?.events || queue?.history),...messageEvents.flatMap(items),...verificationHistory.flatMap(items)],
  };
  return state.cache;
}

async function loadDetailPanel(detail, key, { force = false } = {}) {
  const state = detailStates.get(detail);
  const panel = detail.querySelector(`#detail-panel-${key}`);
  if (!state || !panel || state.loading.has(key) || (state.loaded.has(key) && !force)) return;
  if (force) state.cache = null;
  state.loading.add(key);
  panel.setAttribute('aria-busy','true');
  panel.innerHTML = `<div class="crm-detail-loading" role="status">${bi('正在读取业务记录','Loading business records')}</div>`;
  const loader = () => loadDetailPanel(detail,key,{ force:true });
  try {
    const data = await detailData(detail);
    panel.innerHTML = key === 'outreach-readiness' ? renderReadiness(state,data.decision,data.queue)
      : key === 'outreach-drafts' ? draftCards(data.drafts)
        : key === 'outreach-messages' ? messageCards(data.messages)
          : key === 'outreach-replies' ? replyCards(data.replies)
            : renderDecisionHistory(data);
    if (key === 'outreach-readiness') wireReadinessPanel(detail,panel);
    state.loaded.add(key);
    if (key === 'outreach-readiness') state.flash = null;
  } catch (error) {
    detailError(panel,loader,error);
  } finally {
    state.loading.delete(key);
    panel.setAttribute('aria-busy','false');
  }
}

function selectPhase7Tab(detail, key) {
  detail.querySelector(`[data-detail-tab="${key}"]`)?.click();
}

async function performOpportunityAction(detail, panel, action, button) {
  const state = detailStates.get(detail);
  const reference = state ? opportunityRef(state) : '';
  const status = panel.querySelector('[data-phase7-management-status]');
  if (!state || !reference) return;
  const buttons = [...panel.querySelectorAll('[data-phase7-action]')];
  const owner = panel.querySelector('[name="owner_identity"]')?.value.trim() || '';
  const reason = panel.querySelector('[name="reason"]')?.value.trim() || '';
  const endpoint = {
    MANAGEMENT_APPROVED:'management-approve',
    HOLD:'hold',
    REQUEST_EVIDENCE:'request-evidence',
    REOPEN:'reopen',
  }[action];
  if (!endpoint) return;
  const labels = actionLabels(action);
  buttons.forEach(node => { node.disabled = true; });
  setBusy(button,true,labels);
  if (status) status.innerHTML = bi('正在保存管理操作。','Saving the management action.');
  try {
    await request(`/api/opportunities/${encodeURIComponent(reference)}/${endpoint}`,{
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({
        owner_identity: action === 'MANAGEMENT_APPROVED' ? owner || accessValues().actor || null : undefined,
        reason: reason || undefined,
        request_id:`ui-${action.toLowerCase()}-${Date.now()}`
      })
    });
    state.flash = {
      html: action === 'MANAGEMENT_APPROVED'
        ? bi('已加入待联系。','Added to Contact Queue.')
        : bi('管理操作已保存。','The management action has been saved.')
    };
    state.cache = null;
    state.loaded.delete('outreach-readiness');
    state.loaded.delete('data-history');
    await loadDetailPanel(detail,'outreach-readiness',{ force:true });
    if (!detail.querySelector('#detail-panel-data-history')?.hidden) await loadDetailPanel(detail,'data-history',{ force:true });
  } catch (error) {
    if (status) status.innerHTML = operationError(error);
  } finally {
    buttons.forEach(node => { node.disabled = false; });
    setBusy(button,false,labels);
  }
}

function wireReadinessPanel(detail, panel) {
  panel.querySelectorAll('[data-phase7-open-tab]').forEach(button => {
    button.addEventListener('click',() => selectPhase7Tab(detail,button.dataset.phase7OpenTab));
  });
  panel.querySelectorAll('[data-phase7-action]').forEach(button => {
    button.addEventListener('click',() => performOpportunityAction(detail,panel,button.dataset.phase7Action,button));
  });
}

export function attachPhase7CompanyDetail(detail, { companyId, opportunityId = '', productProfile = '', contactIds = [] } = {}) {
  if (!detail || !companyId) return;
  detailStates.set(detail,{ companyId:text(companyId), opportunityId:text(opportunityId), productProfile:text(productProfile).toUpperCase(), contactIds:[...new Set(contactIds.filter(Boolean).map(text))], loaded:new Set(), loading:new Set(), cache:null, flash:null });
  detail.querySelectorAll('[data-phase7-detail-tab]').forEach(tab => {
    const load = () => loadDetailPanel(detail,tab.dataset.detailTab);
    tab.addEventListener('click',load);
    tab.addEventListener('focus',load);
  });
}
