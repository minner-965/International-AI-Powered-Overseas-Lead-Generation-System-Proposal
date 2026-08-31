import { activateView } from '../crm-shell.js';
import { managementRequest } from '../phase7-ui.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
}[character]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const items = payload => Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
const first = (object, keys, fallback = '') => {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};
const finiteNumber = value => value === null || value === undefined || value === ''
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const identifier = item => text(first(item, ['job_id','id','research_job_id']));
const safeUrl = value => {
  try {
    const parsed = new URL(value, location.origin);
    return ['http:','https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
};
const dateTime = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
};
const dateTimeMarkup = value => value
  ? `<time datetime="${esc(value)}">${esc(dateTime(value))}</time>`
  : '-';

const state = {
  summary:null,
  tasks:[],
  recentJobs:[],
  jobs:[],
  nextCursor:'',
  jobsRequest:0,
  detailRequest:0,
  detailOpener:null,
  detailOpenerJobId:'',
  pendingJobFocus:'',
  dialogStep:1,
  dialogOpener:null,
  loaded:{ research:false, jobs:false },
};

const STATUS_LABELS = Object.freeze({
  ALL:['全部','All'], QUEUED:['等待开始','Queued'], RUNNING:['运行中','Running'],
  WAITING_EVIDENCE:['等待资料','Waiting for evidence'], COMPLETED:['已完成','Completed'],
  WAITING:['等待前序阶段','Waiting'],
  FAILED:['处理未完成','Not completed'], FAILED_RETRYABLE:['可重试','Failed, retryable'],
  FAILED_FINAL:['已结束','Failed, final'], CANCELLED:['已取消','Cancelled'],
});

const TYPE_LABELS = Object.freeze({
  COMPANY_DISCOVERY:['企业发现','Company discovery'],
  DECISION_MAKER_ENRICHMENT:['采购人员与联系方式','Buyer and contact evidence'],
  CATEGORY_PROCUREMENT_ENRICHMENT:['品类采购资料','Category procurement evidence'],
  REAL_OPPORTUNITY_RESEARCH:['真实机会补证','Real opportunity research'],
  RESEARCH:['市场研究','Market research'],
});

const BLOCKER_LABELS = Object.freeze({
  PRODUCT:['产品资料','Product evidence'], BUYER_MODEL:['采购模式','Buyer Model'],
  SUPPLIER_ACCESS:['供应商准入','Supplier Access'], CONTACT:['采购联系人','Buyer Contact'],
  BUYER_ROLE:['采购职责','Buyer Role'], EMAIL:['邮箱核验','Email verification'],
  TEMPORARY_ERROR:['暂时错误','Temporary Error'], HISTORY:['历史记录','History'],
  IDENTITY:['企业身份','Identity'], SUPPRESSION:['联系暂停','Contact Hold'], EVIDENCE_REQUIRED:['待补资料','Evidence Required'],
  JOB_FAILED:['任务未完成','Job Failed'],
});

const BLOCKER_ACTIONS = Object.freeze({
  PRODUCT:['收集品类资料','Collect category evidence'],
  BUYER_MODEL:['核验采购与转售模式','Verify buyer model and resale'],
  SUPPLIER_ACCESS:['复核供应商准入','Review supplier access'],
  CONTACT:['查找采购联系人','Find profile buyer'],
  BUYER_ROLE:['核验采购职责','Verify procurement responsibility'],
  EMAIL:['核验商务邮箱','Verify business email'],
  TEMPORARY_ERROR:['复核并重试任务','Review and retry task'],
  HISTORY:['打开客户记录复核','Open company record review'],
  IDENTITY:['打开企业身份复核','Open company identity review'],
  SUPPRESSION:['打开联系暂停复核','Open contact-hold review'],
  EVIDENCE_REQUIRED:['打开补证任务','Open evidence job'],
  JOB_FAILED:['复核任务错误','Review job error'],
});

const statusPair = value => STATUS_LABELS[text(value).toUpperCase()] || [text(value) || '待确认', text(value) || 'To confirm'];
const typePair = value => TYPE_LABELS[text(value).toUpperCase()] || [text(value) || '研究任务', text(value) || 'Research job'];
const blockerPair = value => BLOCKER_LABELS[text(value).toUpperCase()] || [text(value) || '待确认', text(value) || 'To confirm'];
const actionPair = value => BLOCKER_ACTIONS[text(value).toUpperCase()] || ['打开任务详情','Open job detail'];
const toneForStatus = value => {
  const code = text(value).toUpperCase();
  if (code === 'COMPLETED') return 'is-success';
  if (['FAILED','FAILED_FINAL','CANCELLED'].includes(code)) return 'is-danger';
  if (['WAITING_EVIDENCE','FAILED_RETRYABLE'].includes(code)) return 'is-warning';
  return '';
};
const statusBadge = value => {
  const pair = statusPair(value);
  return `<span class="p9-status-badge ${toneForStatus(value)}">${bi(pair[0],pair[1])}</span>`;
};

function setInlineState(host, zh, en, { error = false, retry = null } = {}) {
  if (!host) return;
  host.classList.toggle('is-error',error);
  host.innerHTML = `${bi(zh,en)}${retry ? ` <button class="btn btn-sm btn-outline-secondary" type="button" data-p9-retry>${bi('重新读取','Retry')}</button>` : ''}`;
  host.querySelector('[data-p9-retry]')?.addEventListener('click',retry);
}

function routeToJobs({ status = '', type = '', blocker = '', jobId = '', focus = true, trigger = null } = {}) {
  const url = new URL(location.href);
  url.hash = 'jobs';
  url.searchParams.set('jobs_tab','research');
  if (status) url.searchParams.set('jobs_status',status); else url.searchParams.delete('jobs_status');
  if (type) url.searchParams.set('jobs_type',type); else url.searchParams.delete('jobs_type');
  const blockerFilter = ['TEMPORARY_ERROR','JOB_FAILED','EVIDENCE_REQUIRED'].includes(blocker)
    ? blocker : blocker ? 'EVIDENCE_REQUIRED' : '';
  if (blockerFilter) url.searchParams.set('jobs_blocker',blockerFilter); else url.searchParams.delete('jobs_blocker');
  if (jobId) url.searchParams.set('job',jobId); else url.searchParams.delete('job');
  history.pushState(null,'',url);
  restoreJobsStateFromUrl();
  activateView('jobs',{ updateHash:false, focus });
  selectJobsTab('research',{ updateUrl:false, focus:false });
  void loadJobs();
  if (jobId) void openJobDetail(jobId,{ replaceState:true, trigger });
  else clearJobDetail({ restoreFocus:false });
}

function routeMetric(metric) {
  if (metric === 'active_jobs') return routeToJobs({ status:'RUNNING' });
  if (metric === 'evidence_tasks') return routeToJobs({ status:'WAITING_EVIDENCE' });
  if (metric === 'verified_profile_buyers') return routeToJobs({ type:'DECISION_MAKER_ENRICHMENT' });
  if (metric === 'contact_ready_opportunities') {
    const status = $('#opportunity-status');
    if (status) status.value = 'RECOMMENDED';
    activateView('opportunities');
    status?.dispatchEvent(new Event('change',{ bubbles:true }));
  }
}

function summaryMetric(labelZh, labelEn, value, metric, asOf) {
  const count = finiteNumber(value) ?? 0;
  return `<button class="p9-metric" type="button" data-summary-metric="${esc(metric)}"><span class="bi"><span lang="zh-CN">${esc(labelZh)}</span><span lang="en">${esc(labelEn)}</span></span><strong>${esc(count)}</strong><small>${bi(`截至 ${dateTime(asOf)}`,`As of ${dateTime(asOf)}`)}</small></button>`;
}

function providerState(summary) {
  const raw = text(first(summary,['hunter_budget_state','email_verification_state','provider_budget_state'],'DISABLED')).toUpperCase();
  if (['READY','ENABLED'].includes(raw)) return ['READY','邮箱核验：就绪','Email verification: Ready'];
  if (['BUDGET_HOLD','HOLD'].includes(raw)) return ['BUDGET_HOLD','邮箱核验：预算暂停','Email verification: Budget hold'];
  if (['TEMPORARY_ERROR','ERROR','UNAVAILABLE'].includes(raw)) return ['TEMPORARY_ERROR','邮箱核验：暂时错误','Email verification: Temporary error'];
  return ['DISABLED','邮箱核验：未启用','Email verification: Disabled'];
}

function renderSummary(summary) {
  const host = $('#research-workbench-summary');
  const provider = $('#research-provider-status');
  if (!host || !provider) return;
  const asOf = first(summary,['as_of','updated_at','captured_at']);
  host.setAttribute('aria-busy','false');
  host.innerHTML = [
    summaryMetric('活跃研究任务','Active research jobs',summary.active_jobs,'active_jobs',asOf),
    summaryMetric('补证任务','Evidence tasks',summary.evidence_tasks,'evidence_tasks',asOf),
    summaryMetric('已核验采购人员','Verified profile buyers',summary.verified_profile_buyers,'verified_profile_buyers',asOf),
    summaryMetric('有效联系路径','VALID / Contact-ready',first(summary,['contact_ready_opportunities','hunter_valid_routes'],0),'contact_ready_opportunities',asOf),
  ].join('');
  host.querySelectorAll('[data-summary-metric]').forEach(button => button.addEventListener('click',()=>routeMetric(button.dataset.summaryMetric)));
  const [code,zh,en] = providerState(summary);
  provider.dataset.state = code;
  provider.innerHTML = bi(zh,en);
  const asOfHost = $('#research-workbench-as-of');
  if (asOfHost) asOfHost.innerHTML = bi(`数据截至 ${dateTime(asOf)}`,`Data as of ${dateTime(asOf)}`);
  renderAlerts(summary,code);
  renderCatalogSummary();
}

function renderSummaryError() {
  const host = $('#research-workbench-summary');
  if (host) {
    host.setAttribute('aria-busy','false');
    host.innerHTML = `<div class="p9-inline-state is-error">${bi('研究指标读取失败。','Research metrics could not be loaded.')} <button class="btn btn-sm btn-outline-secondary" type="button" data-summary-retry>${bi('重新读取','Retry')}</button></div>`;
    host.querySelector('[data-summary-retry]')?.addEventListener('click',loadSummary);
  }
  const provider = $('#research-provider-status');
  if (provider) {
    provider.dataset.state = 'TEMPORARY_ERROR';
    provider.innerHTML = bi('邮箱核验：状态待确认','Email verification: Status to confirm');
  }
}

function renderAlerts(summary, providerCode) {
  const host = $('#research-workbench-alerts');
  if (!host) return;
  const alerts = [];
  if (providerCode === 'BUDGET_HOLD') alerts.push(['邮箱核验当前处于预算暂停状态。','Email verification is currently on budget hold.']);
  if (providerCode === 'TEMPORARY_ERROR') alerts.push(['邮箱核验服务暂时异常，请稍后复核任务。','Email verification is temporarily unavailable; review the job later.']);
  if (providerCode === 'DISABLED') alerts.push(['邮箱核验当前未启用，研究任务仍可使用其他已配置来源。','Email verification is disabled; research jobs can still use other configured sources.']);
  const safeAlerts = Array.isArray(summary?.alerts) ? summary.alerts.filter(item => item?.safe_to_display === true).slice(0,2) : [];
  for (const alert of safeAlerts) {
    const zh = text(first(alert,['message_zh','label_zh']));
    const en = text(first(alert,['message_en','label_en']));
    if (zh || en) alerts.push([zh || en,en || zh]);
  }
  host.hidden = alerts.length === 0;
  host.innerHTML = alerts.map(([zh,en])=>`<div class="p9-alert"><i class="ti ti-alert-triangle" aria-hidden="true"></i>${bi(zh,en)}</div>`).join('');
}

function catalogRecordForProfile(profile) {
  const summary = state.summary || {};
  const snapshots = first(summary,['catalog_profiles','catalog_snapshots','product_catalog_snapshots'],[]);
  if (Array.isArray(snapshots)) return snapshots.find(item=>text(first(item,['product_profile','profile'])).toUpperCase() === profile) || null;
  return snapshots?.[profile] || first(summary,[profile === 'WOMENSWEAR' ? 'womenswear_catalog' : 'general_merchandise_catalog'],null);
}

function renderCatalogSummary() {
  const host = $('#research-catalog-summary');
  const select = $('#research-category');
  if (!host || !select) return;
  const profile = text(select.selectedOptions[0]?.dataset.productProfile || 'WOMENSWEAR').toUpperCase();
  const record = catalogRecordForProfile(profile);
  if (!record) {
    host.innerHTML = `${bi('当前接口未返回该商品画像的目录摘要。','The current response does not include a catalog summary for this profile.')}`;
    return;
  }
  const rows = finiteNumber(first(record,['real_catalog_rows','catalog_rows','row_count','product_count','rows']));
  const coverage = first(record,['coverage','coverage_percent','snapshot_coverage'],'-');
  const captured = first(record,['captured_at','snapshot_captured_at','as_of']);
  host.innerHTML = `<div class="p9-catalog-facts"><div><small>${bi('产品画像','Product profile')}</small><strong>${esc(profile)}</strong></div><div><small>${bi('真实目录行','Real catalog rows')}</small><strong>${esc(rows ?? '-')}</strong></div><div><small>${bi('目录覆盖','Catalog coverage')}</small><strong>${esc(coverage)}</strong></div><div><small>${bi('快照时间','Snapshot captured')}</small><strong>${esc(dateTime(captured))}</strong></div></div>`;
}

async function loadSummary() {
  const host = $('#research-workbench-summary');
  host?.setAttribute('aria-busy','true');
  try {
    state.summary = await managementRequest('/api/research/workbench-summary');
    renderSummary(state.summary || {});
  } catch {
    state.summary = null;
    renderSummaryError();
  }
}

function taskBlocker(task) {
  return text(first(task,['blocker','blocker_group','latest_blocker','task_type'])).toUpperCase() || 'EVIDENCE';
}

function taskAge(task) {
  const days = finiteNumber(first(task,['evidence_age_days','age_days']));
  if (days !== null) return bi(`${Math.max(0,Math.round(days))} 天`,`${Math.max(0,Math.round(days))} days`);
  const captured = first(task,['evidence_captured_at','last_evidence_at','updated_at']);
  return captured ? dateTimeMarkup(captured) : '-';
}

function openEvidenceTask(task, trigger = null) {
  const blocker = taskBlocker(task);
  if (['HISTORY','IDENTITY','SUPPRESSION'].includes(blocker) && first(task,['company_id'])) {
    activateView('companies');
    return;
  }
  routeToJobs({ blocker, jobId:identifier(task), trigger });
}

function renderPriorityTasks(taskItems) {
  const host = $('#research-priority-tasks');
  if (!host) return;
  host.setAttribute('aria-busy','false');
  if (!taskItems.length) {
    setInlineState(host,'当前没有待处理的补证任务。','No evidence tasks currently require action.');
    return;
  }
  host.innerHTML = taskItems.slice(0,3).map((task,index)=>{
    const blocker = taskBlocker(task);
    const blockerLabel = blockerPair(blocker);
    const action = actionPair(blocker);
    const company = first(task,['company_name','resolved_company_name'],'-');
    const profile = first(task,['product_profile','profile'],'-');
    return `<article class="p9-priority-item"><span class="p9-priority-rank">${index + 1}</span><div class="p9-item-main"><strong>${esc(company)}</strong><small>${esc(profile)}</small></div><div class="p9-item-fact"><small>${bi('阻断','Blocker')}</small>${bi(blockerLabel[0],blockerLabel[1])}</div><div class="p9-item-fact"><small>${bi('资料时效','Evidence age')}</small>${taskAge(task)}</div><button class="btn btn-outline-primary" type="button" data-priority-index="${index}">${bi(action[0],action[1])}</button></article>`;
  }).join('');
  host.querySelectorAll('[data-priority-index]').forEach(button=>button.addEventListener('click',()=>openEvidenceTask(taskItems[Number(button.dataset.priorityIndex)],button)));
}

async function loadPriorityTasks() {
  const host = $('#research-priority-tasks');
  host?.setAttribute('aria-busy','true');
  try {
    const payload = await managementRequest('/api/research/tasks?limit=3&sort=priority_desc');
    state.tasks = items(payload).slice(0,3);
    renderPriorityTasks(state.tasks);
  } catch {
    state.tasks = [];
    if (host) {
      host.setAttribute('aria-busy','false');
      setInlineState(host,'补证任务读取失败。','Evidence tasks could not be loaded.',{ error:true, retry:loadPriorityTasks });
    }
  }
}

function jobMarket(job) {
  const marketCodes = Array.isArray(job?.market_codes) ? job.market_codes : [];
  return [first(job,['country_code','market_code','market'],marketCodes[0]),first(job,['city','region'])].map(text).filter(Boolean).join(' / ') || '-';
}

function jobProfile(job) {
  const profiles = Array.isArray(job?.product_profiles) ? job.product_profiles : [];
  return text(first(job,['product_profile','profile','product_category'],profiles[0] || '-'));
}

function jobObjective(job) {
  const value = text(first(job,['job_objective','objective','title','product_category'],'RESEARCH'));
  return ({
    COMPANY_DISCOVERY:'企业发现 / Company Discovery',
    BUYER_AND_CONTACT_EVIDENCE:'采购人员与联系方式 / Buyer and Contact Evidence',
    CATEGORY_PROCUREMENT_EVIDENCE:'品类采购资料 / Category Procurement Evidence',
    RESEARCH:'研究任务 / Research Job',
  })[value.toUpperCase()] || value;
}

function jobResultFacts(job) {
  const definitions = [
    ['companies_selected','入选企业','Selected'],
    ['category_matches','品类匹配','Category'],
    ['verified_buyers','核验采购人员','Buyers'],
    ['verified_email_routes','有效邮箱','VALID'],
  ];
  return definitions.map(([key,zh,en])=>{
    const value = finiteNumber(first(job,[key]));
    return value === null ? '' : `<small>${bi(zh,en)} <strong>${esc(value)}</strong></small>`;
  }).filter(Boolean).join('') || bi('尚未报告结果','Results not reported');
}

function jobProgress(job) {
  const percent = finiteNumber(first(job,['progress_percent','progress']));
  if (percent !== null) return `${Math.max(0,Math.min(100,Math.round(percent)))}%`;
  const selected = finiteNumber(first(job,['companies_selected','candidates_found']));
  const maximum = finiteNumber(first(job,['max_results']));
  if (selected !== null && maximum !== null && maximum > 0) return `${selected} / ${maximum}`;
  return '-';
}

function jobBlocker(job) {
  return text(first(job,['latest_blocker','blocker','blocker_group'])).toUpperCase();
}

function renderRecentJobs(jobItems) {
  const host = $('#research-recent-jobs');
  if (!host) return;
  host.setAttribute('aria-busy','false');
  if (!jobItems.length) {
    setInlineState(host,'当前没有研究任务。','No research jobs are available.');
    return;
  }
  host.innerHTML = jobItems.slice(0,6).map((job,index)=>{
    const type = typePair(first(job,['job_type','type'],'RESEARCH'));
    const updated = first(job,['updated_at','created_at']);
    return `<article class="p9-recent-item"><div class="p9-item-main"><strong>${esc(jobObjective(job))}</strong><small>${esc(jobMarket(job))} / ${esc(jobProfile(job))}</small></div><div class="p9-item-meta">${statusBadge(first(job,['status'],'QUEUED'))}<small>${bi(type[0],type[1])} / ${dateTimeMarkup(updated)}</small></div><button class="btn btn-outline-primary" type="button" data-recent-index="${index}">${bi('打开详情','Open details')}</button></article>`;
  }).join('');
  host.querySelectorAll('[data-recent-index]').forEach(button=>button.addEventListener('click',()=>routeToJobs({ jobId:identifier(jobItems[Number(button.dataset.recentIndex)]),trigger:button })));
}

async function loadRecentJobs() {
  const host = $('#research-recent-jobs');
  host?.setAttribute('aria-busy','true');
  try {
    const payload = await managementRequest('/api/research/jobs?view=inbox&limit=6&sort=updated_desc');
    state.recentJobs = items(payload).slice(0,6);
    renderRecentJobs(state.recentJobs);
  } catch {
    state.recentJobs = [];
    if (host) {
      host.setAttribute('aria-busy','false');
      setInlineState(host,'最近任务读取失败。','Recent jobs could not be loaded.',{ error:true, retry:loadRecentJobs });
    }
  }
}

const FILTER_URL_KEYS = Object.freeze({
  search:'jobs_search', status:'jobs_status', job_type:'jobs_type', market:'jobs_market',
  product_profile:'jobs_profile', blocker:'jobs_blocker', sort:'jobs_sort',
});

function restoreJobsStateFromUrl() {
  const form = $('#research-jobs-filters');
  if (!form) return;
  const params = new URLSearchParams(location.search);
  for (const [name,key] of Object.entries(FILTER_URL_KEYS)) {
    const control = form.elements.namedItem(name);
    if (!control) continue;
    const fallback = name === 'status' ? 'ALL' : name === 'sort' ? 'NEWEST' : '';
    control.value = params.get(key) ?? fallback;
    if (control.value === '' && fallback) control.value = fallback;
  }
}

function writeJobsStateToUrl({ push = true, clearJob = true } = {}) {
  const form = $('#research-jobs-filters');
  if (!form) return;
  const url = new URL(location.href);
  url.hash = 'jobs';
  url.searchParams.set('jobs_tab',currentJobsTab());
  for (const [name,key] of Object.entries(FILTER_URL_KEYS)) {
    const value = text(form.elements.namedItem(name)?.value);
    const defaultValue = name === 'status' ? 'ALL' : name === 'sort' ? 'NEWEST' : '';
    if (!value || value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key,value);
  }
  if (clearJob) url.searchParams.delete('job');
  history[push ? 'pushState' : 'replaceState'](null,'',url);
}

function currentJobsTab() {
  return $('#jobs-inbox-tabs [aria-selected="true"]')?.dataset.jobsTab || 'research';
}

function selectJobsTab(tab, { updateUrl = true, focus = false } = {}) {
  const resolved = ['research','import','export'].includes(tab) ? tab : 'research';
  $$('#jobs-inbox-tabs [data-jobs-tab]').forEach(button=>{
    const active = button.dataset.jobsTab === resolved;
    button.setAttribute('aria-selected',String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus({ preventScroll:true });
  });
  $$('[data-jobs-pane]').forEach(pane=>{ pane.hidden = pane.dataset.jobsPane !== resolved; });
  if (updateUrl) writeJobsStateToUrl({ push:true, clearJob:resolved !== 'research' });
}

function jobsQuery(cursor = '') {
  const form = $('#research-jobs-filters');
  const params = new URLSearchParams({ view:'inbox', limit:'25' });
  if (form) {
    for (const name of Object.keys(FILTER_URL_KEYS)) {
      const value = text(form.elements.namedItem(name)?.value);
      if (!value || (name === 'status' && value === 'ALL')) continue;
      params.set(name,value);
    }
  }
  if (cursor) params.set('cursor',cursor);
  return params.toString();
}

function renderJobs(jobItems,{ append = false } = {}) {
  const host = $('#research-jobs-list');
  if (!host) return;
  if (!jobItems.length && !append) {
    host.innerHTML = `<tr><td colspan="7" class="crm-loading-cell">${bi('当前筛选没有研究任务。','No research jobs match the current filters.')}</td></tr>`;
    return;
  }
  const rows = jobItems.map(job=>{
    const id = identifier(job);
    const type = typePair(first(job,['job_type','type'],'RESEARCH'));
    const status = first(job,['status'],'QUEUED');
    const stage = first(job,['progress_stage','stage','current_stage'],'-');
    const blocker = jobBlocker(job);
    const blockerLabel = blocker ? blockerPair(blocker) : null;
    const activity = first(job,['updated_at','created_at']);
    return `<tr data-job-id="${esc(id)}"><td data-label="任务 / Job"><div class="p9-job-objective"><strong>${esc(jobObjective(job))}</strong><small>${esc(id || '-')} / ${bi(type[0],type[1])}</small></div></td><td data-label="市场 / Market"><div class="p9-job-cell-stack"><span>${esc(jobMarket(job))}</span><small>${esc(jobProfile(job))}</small></div></td><td data-label="状态 / Status"><div class="p9-job-cell-stack">${statusBadge(status)}<small>${esc(stage)}</small></div></td><td data-label="进度 / Progress"><span class="p9-job-progress">${esc(jobProgress(job))}</span></td><td data-label="结果 / Results"><div class="p9-job-cell-stack">${jobResultFacts(job)}</div></td><td data-label="阻断 / Blocker"><div class="p9-job-cell-stack">${blockerLabel ? bi(blockerLabel[0],blockerLabel[1]) : bi('无已报告阻断','No reported blocker')}<small>${dateTimeMarkup(activity)}</small></div></td><td data-label="操作 / Action"><button class="btn btn-outline-primary" type="button" data-open-job="${esc(id)}">${bi('打开详情','Open details')}</button></td></tr>`;
  }).join('');
  if (append) host.insertAdjacentHTML('beforeend',rows); else host.innerHTML = rows;
  host.querySelectorAll('[data-open-job]').forEach(button=>button.addEventListener('click',()=>openJobDetail(button.dataset.openJob,{ trigger:button })));
  if (state.pendingJobFocus) {
    const focusButton = [...host.querySelectorAll('[data-open-job]')]
      .find(button=>button.dataset.openJob === state.pendingJobFocus);
    if (focusButton) {
      focusButton.focus({ preventScroll:true });
      state.pendingJobFocus = '';
    }
  }
}

function clearJobDetail({ restoreFocus = true } = {}) {
  state.detailRequest += 1;
  const host = $('#research-job');
  const empty = $('#jobs-empty');
  if (host) {
    host.hidden = true;
    host.removeAttribute('aria-busy');
    host.replaceChildren();
  }
  if (empty) empty.hidden = false;
  if (restoreFocus) {
    if (state.detailOpener?.isConnected && !state.detailOpener.closest('[hidden]')) {
      state.detailOpener.focus({ preventScroll:true });
    } else if (state.detailOpenerJobId) {
      state.pendingJobFocus = state.detailOpenerJobId;
    }
  }
  state.detailOpener = null;
  state.detailOpenerJobId = '';
}

async function loadJobs({ append = false } = {}) {
  const host = $('#research-jobs-list');
  const statusHost = $('#research-jobs-state');
  const next = $('#research-jobs-next');
  const requestId = ++state.jobsRequest;
  if (!append && host) host.innerHTML = `<tr><td colspan="7" class="crm-loading-cell">${bi('正在读取研究任务','Loading research jobs')}</td></tr>`;
  setInlineState(statusHost,'正在读取研究任务。','Loading research jobs.');
  next && (next.disabled = true);
  try {
    const payload = await managementRequest(`/api/research/jobs?${jobsQuery(append ? state.nextCursor : '')}`);
    if (requestId !== state.jobsRequest) return;
    const nextItems = items(payload);
    state.jobs = append ? [...state.jobs,...nextItems] : nextItems;
    state.nextCursor = text(payload?.next_cursor);
    renderJobs(nextItems,{ append });
    setInlineState(statusHost,`共显示 ${state.jobs.length} 项真实任务。`,`Showing ${state.jobs.length} real jobs.`);
    if (next) {
      next.hidden = !state.nextCursor;
      next.disabled = false;
    }
  } catch {
    if (requestId !== state.jobsRequest) return;
    if (!append && host) host.innerHTML = `<tr><td colspan="7" class="crm-loading-cell">${bi('研究任务读取失败。','Research jobs could not be loaded.')}</td></tr>`;
    setInlineState(statusHost,'研究任务读取失败。','Research jobs could not be loaded.',{ error:true, retry:()=>loadJobs() });
    if (next) next.hidden = true;
  }
}

function pipelineRecords(results) {
  const stages = first(results,['pipeline_stages','stages','pipeline'],{});
  if (Array.isArray(stages)) return new Map(stages.map(stage=>[text(first(stage,['stage','key','name'])).toUpperCase(),stage]));
  return new Map(Object.entries(stages || {}).map(([key,value])=>[key.toUpperCase(),value]));
}

function pipelineStage(stageMap, keys) {
  for (const key of keys) if (stageMap.has(key)) return stageMap.get(key);
  return null;
}

function renderPipelineStage(labelZh,labelEn,record) {
  const status = first(record || {},['status','state'],'UNKNOWN');
  const count = finiteNumber(first(record || {},['count','result_count','evidence_count','source_count']));
  const errors = finiteNumber(first(record || {},['error_count','errors']));
  const statusLabel = statusPair(status);
  return `<section class="p9-pipeline-stage"><strong>${bi(labelZh,labelEn)}</strong><span>${bi(statusLabel[0],statusLabel[1])}</span>${count === null ? '' : `<small>${bi('结果','Results')}: ${esc(count)}</small>`}${errors === null ? '' : `<small>${bi('错误','Errors')}: ${esc(errors)}</small>`}</section>`;
}

function renderJobDetail(job, results = null) {
  const host = $('#research-job');
  const empty = $('#jobs-empty');
  if (!host) return;
  const id = identifier(job);
  const stageMap = pipelineRecords(results || {});
  const evidence = items(first(results || {},['evidence','evidence_links','sources'],[])).slice(0,8);
  host.hidden = false;
  if (empty) empty.hidden = true;
  host.setAttribute('aria-busy','false');
  host.innerHTML = `<header class="p9-detail-header"><div><h3>${esc(jobObjective(job))}</h3><p class="crm-helper">${esc(id || '-')} / ${esc(jobMarket(job))} / ${esc(jobProfile(job))}</p></div><div class="p9-command-actions">${statusBadge(first(job,['status'],'UNKNOWN'))}<button class="btn btn-outline-secondary" type="button" data-refresh-job="${esc(id)}"><i class="ti ti-refresh" aria-hidden="true"></i>${bi('刷新','Refresh')}</button></div></header><div class="p9-pipeline" aria-label="研究任务流水线 Research job pipeline">${renderPipelineStage('企业身份','Identity',pipelineStage(stageMap,['IDENTITY']))}${renderPipelineStage('采购模式','Buyer Model',pipelineStage(stageMap,['BUYER_MODEL']))}${renderPipelineStage('品类采购','Category Procurement',pipelineStage(stageMap,['CATEGORY_PROCUREMENT','PRODUCT']))}${renderPipelineStage('供应商准入','Supplier Access',pipelineStage(stageMap,['SUPPLIER_ACCESS']))}${renderPipelineStage('采购人员与职责','Buyer / Role',pipelineStage(stageMap,['BUYER_ROLE','BUYER']))}${renderPipelineStage('邮箱核验','Email verification',pipelineStage(stageMap,['EMAIL_VERIFICATION','EMAIL','HUNTER']))}${renderPipelineStage('机会决策刷新','Decision refresh',pipelineStage(stageMap,['DECISION_REFRESH','DECISION']))}</div>${evidence.length ? `<section class="card crm-panel"><header class="card-header crm-panel-header"><h4 class="card-title">${bi('资料链接','Evidence links')}</h4></header><div class="card-body p9-evidence-links">${evidence.map(record=>{const url=safeUrl(first(record,['source_url','url','evidence_url']));return url ? `<a class="btn btn-outline-secondary" href="${esc(url)}" target="_blank" rel="noreferrer">${bi('打开来源','Open source')}</a>` : ''}).join('')}</div></section>` : ''}`;
  host.querySelector('[data-refresh-job]')?.addEventListener('click',()=>openJobDetail(id,{ replaceState:true }));
  host.scrollIntoView({ block:'start', behavior:'auto' });
}

async function openJobDetail(jobId,{ replaceState = false, trigger = null } = {}) {
  const id = text(jobId);
  if (!id) return;
  if (!replaceState) {
    state.detailOpener = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    state.detailOpenerJobId = id;
  }
  document.dispatchEvent(new CustomEvent('phase9:research-job-open',{ detail:{ jobId:id } }));
  const host = $('#research-job');
  const empty = $('#jobs-empty');
  const requestId = ++state.detailRequest;
  if (host) {
    host.hidden = false;
    host.setAttribute('aria-busy','true');
    host.innerHTML = `<div class="p9-inline-state">${bi('正在读取任务详情。','Loading job detail.')}</div>`;
  }
  if (empty) empty.hidden = true;
  const url = new URL(location.href);
  url.searchParams.set('job',id);
  url.searchParams.set('jobs_tab','research');
  url.hash = 'jobs';
  history[replaceState ? 'replaceState' : 'pushState'](null,'',url);
  try {
    const [jobResult,resultsResult] = await Promise.allSettled([
      managementRequest(`/api/research/jobs/${encodeURIComponent(id)}`),
      managementRequest(`/api/research/jobs/${encodeURIComponent(id)}/results`),
    ]);
    if (requestId !== state.detailRequest) return;
    if (jobResult.status === 'rejected') throw jobResult.reason;
    renderJobDetail(jobResult.value,resultsResult.status === 'fulfilled' ? resultsResult.value : null);
  } catch {
    if (requestId !== state.detailRequest || !host) return;
    host.setAttribute('aria-busy','false');
    host.innerHTML = `<div class="p9-inline-state is-error">${bi('任务详情读取失败。','Job detail could not be loaded.')} <button class="btn btn-outline-secondary" type="button" data-detail-retry>${bi('重新读取','Retry')}</button></div>`;
    host.querySelector('[data-detail-retry]')?.addEventListener('click',()=>openJobDetail(id,{ replaceState:true }));
  }
}

function renderScopeReview() {
  const host = $('#research-scope-review');
  const country = $('#research-country');
  const category = $('#research-category');
  const buyerTypes = $$('input[name="buyer_type"]:checked').map(input=>input.value);
  if (!host || !country || !category) return;
  const provider = providerState(state.summary || {});
  const values = [
    ['市场','Market',country.selectedOptions[0]?.textContent || country.value],
    ['产品画像','Product profile',category.selectedOptions[0]?.textContent || category.value],
    ['目标客户类型','Buyer types',buyerTypes.join(', ') || '-'],
    ['最大结果数','Maximum results',$('#research-limit')?.value || '-'],
    ['网络调用范围','Network call scope','受任务上限限制 / Bounded by the job limit'],
    ['邮箱核验','Email verification',`${provider[1]} / ${provider[2]}`],
    ['外发消息','Live sends','0'],
    ['重复防护','Duplicate safeguard','服务端任务标识 / Server job identity'],
  ];
  host.innerHTML = values.map(([zh,en,value])=>`<div><small>${bi(zh,en)}</small><strong>${esc(value)}</strong></div>`).join('');
}

function setDialogStep(step,{ focus = true } = {}) {
  const resolved = Math.max(1,Math.min(3,Number(step) || 1));
  state.dialogStep = resolved;
  $$('.p9-dialog-step[data-research-step]').forEach(panel=>{ panel.hidden = Number(panel.dataset.researchStep) !== resolved; });
  $$('#research-job-steps li').forEach((item,index)=>{
    if (index + 1 === resolved) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
  });
  const back = $('#research-step-back');
  const next = $('#research-step-next');
  const submit = $('#start-research');
  if (back) back.hidden = resolved === 1;
  if (next) next.hidden = resolved === 3;
  if (submit) submit.hidden = resolved !== 3;
  if (resolved === 3) renderScopeReview();
  if (focus) requestAnimationFrame(()=>{
    const panel = $(`.p9-dialog-step[data-research-step="${resolved}"]`);
    panel?.querySelector('select,input,button')?.focus({ preventScroll:true });
  });
}

function openResearchDialog(trigger) {
  const dialog = $('#research-job-dialog');
  if (!dialog) return;
  state.dialogOpener = trigger || document.activeElement;
  $('#research-create-status').textContent = '';
  if (state.summary) renderCatalogSummary(); else void loadSummary();
  setDialogStep(1,{ focus:false });
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(()=>$('#research-country')?.focus({ preventScroll:true }));
}

function closeResearchDialog(result = 'cancel') {
  const dialog = $('#research-job-dialog');
  if (dialog?.open) dialog.close(result);
}

function validateDialogStep() {
  const status = $('#research-create-status');
  if (status) status.textContent = '';
  if (state.dialogStep === 1) {
    for (const control of [$('#research-country'),$('#research-limit')]) {
      if (control && !control.checkValidity()) {
        control.reportValidity();
        control.focus();
        return false;
      }
    }
  }
  if (state.dialogStep === 2 && !$$('input[name="buyer_type"]:checked').length) {
    if (status) status.innerHTML = bi('至少选择一种目标客户类型。','Select at least one buyer type.');
    $('input[name="buyer_type"]')?.focus();
    return false;
  }
  return true;
}

function initializeDialog() {
  const dialog = $('#research-job-dialog');
  const form = $('#research-form');
  if (!dialog || !form) return;
  document.body.append(dialog);
  $$('[data-research-dialog-open]').forEach(button=>button.addEventListener('click',()=>openResearchDialog(button)));
  dialog.querySelectorAll('[data-research-dialog-close]').forEach(button=>button.addEventListener('click',()=>closeResearchDialog()));
  dialog.addEventListener('cancel',event=>{ event.preventDefault(); closeResearchDialog(); });
  dialog.addEventListener('click',event=>{
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeResearchDialog();
  });
  dialog.addEventListener('close',()=>{
    if (dialog.returnValue !== 'success' && state.dialogOpener?.isConnected && !state.dialogOpener.closest('[hidden]')) state.dialogOpener.focus({ preventScroll:true });
    state.dialogOpener = null;
  });
  $('#research-step-next')?.addEventListener('click',()=>{ if (validateDialogStep()) setDialogStep(state.dialogStep + 1); });
  $('#research-step-back')?.addEventListener('click',()=>setDialogStep(state.dialogStep - 1));
  $('#research-category')?.addEventListener('change',()=>{ renderCatalogSummary(); if (state.dialogStep === 3) renderScopeReview(); });
  form.addEventListener('change',()=>{ if (state.dialogStep === 3) renderScopeReview(); });
  form.addEventListener('submit',()=>{
    const status = $('#research-create-status');
    if (status) status.innerHTML = bi('正在校验并建立任务。','Validating and creating the job.');
  });
  document.addEventListener('phase9:research-job-created',()=>{
    closeResearchDialog('success');
    void Promise.allSettled([loadSummary(),loadPriorityTasks(),loadRecentJobs(),loadJobs()]);
  });
  document.addEventListener('phase9:research-job-create-failed',()=>{
    const status = $('#research-create-status');
    if (status) status.innerHTML = bi('研究任务建立失败，请检查连接后重试。','The research job could not be created. Check the connection and retry.');
    setDialogStep(3,{ focus:false });
    $('#start-research')?.focus({ preventScroll:true });
  });
  document.addEventListener('phase9:research-job-terminal',event=>{
    const jobId = text(event.detail?.jobId);
    if (jobId) void openJobDetail(jobId,{ replaceState:true });
  });
}

function initializeJobs() {
  const tabs = $$('#jobs-inbox-tabs [data-jobs-tab]');
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectJobsTab(tab.dataset.jobsTab));
    tab.addEventListener('keydown',event=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectJobsTab(tabs[nextIndex].dataset.jobsTab,{ focus:true });
    });
  });
  const params = new URLSearchParams(location.search);
  selectJobsTab(params.get('jobs_tab') || 'research',{ updateUrl:false, focus:false });
  restoreJobsStateFromUrl();
  $('#research-jobs-filters')?.addEventListener('change',()=>{
    writeJobsStateToUrl({ push:true });
    void loadJobs();
  });
  let searchTimer = 0;
  $('#research-jobs-search')?.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>{
      writeJobsStateToUrl({ push:true });
      void loadJobs();
    },180);
  });
  $('#research-jobs-next')?.addEventListener('click',()=>loadJobs({ append:true }));
  document.addEventListener('phase9:jobs-route',event=>{
    const route = event.detail || {};
    routeToJobs({ status:route.status, type:route.type, blocker:route.blocker, jobId:route.jobId, trigger:route.trigger });
  });
}

async function ensureResearchLoaded({ force = false } = {}) {
  if (state.loaded.research && !force) return;
  state.loaded.research = true;
  await Promise.allSettled([loadSummary(),loadPriorityTasks(),loadRecentJobs()]);
}

async function ensureJobsLoaded({ force = false } = {}) {
  if (state.loaded.jobs && !force) return;
  state.loaded.jobs = true;
  restoreJobsStateFromUrl();
  await loadJobs();
  const requestedJob = new URLSearchParams(location.search).get('job');
  if (requestedJob) await openJobDetail(requestedJob,{ replaceState:true });
}

function initialize() {
  initializeDialog();
  initializeJobs();
  document.addEventListener('crm:viewchange',event=>{
    if (event.detail?.view === 'research') void ensureResearchLoaded();
    if (event.detail?.view === 'jobs') void ensureJobsLoaded();
  });
  window.addEventListener('popstate',()=>{
    restoreJobsStateFromUrl();
    const tab = new URLSearchParams(location.search).get('jobs_tab') || 'research';
    selectJobsTab(tab,{ updateUrl:false, focus:false });
    if (location.hash === '#jobs') {
      void loadJobs();
      const jobId = new URLSearchParams(location.search).get('job');
      if (jobId) void openJobDetail(jobId,{ replaceState:true });
      else clearJobDetail();
    }
  });
  const activeView = $('[data-app-view]:not([hidden])')?.dataset.appView;
  if (activeView === 'research') void ensureResearchLoaded();
  if (activeView === 'jobs') void ensureJobsLoaded();
}

initialize();
