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
  RETRY_SCHEDULED:['等待重试','Retry scheduled'], EVIDENCE_EXHAUSTED:['资料已核查','Evidence reviewed'],
  TEMPORARY_PROVIDER_ERROR:['服务暂时错误','Temporary service error'], HUMAN_REVIEW_REQUIRED:['需人工复核','Human review required'],
  BUDGET_PAUSED:['历史预算暂停','Historical budget pause'],
  PROVIDER_CAPACITY_WAIT:['等待搜索服务额度恢复','Waiting for search capacity'],
});

const TYPE_LABELS = Object.freeze({
  COMPANY_DISCOVERY:['企业发现','Company discovery'],
  DECISION_MAKER_ENRICHMENT:['采购人员与联系方式','Buyer and contact evidence'],
  CATEGORY_PROCUREMENT_ENRICHMENT:['公司类目资料','Company Category Evidence'],
  REAL_OPPORTUNITY_RESEARCH:['业务机会补证','Opportunity evidence'],
  AUTO_EVIDENCE:['自动补证','Auto enrichment'],
  RESEARCH:['市场研究','Market research'],
});

const BLOCKER_LABELS = Object.freeze({
  PRODUCT:['产品资料','Product evidence'], BUYER_MODEL:['采购模式','Buyer Model'],
  CONTACT:['联系方式','Contact route'],
  BUYER_ROLE:['采购职责','Buyer Role'], EMAIL:['邮箱核验','Email verification'],
  TEMPORARY_ERROR:['暂时错误','Temporary Error'], HISTORY:['历史记录','History'],
  IDENTITY:['企业身份','Identity'], SUPPRESSION:['联系暂停','Contact Hold'], EVIDENCE_REQUIRED:['待补资料','Evidence Required'],
  JOB_FAILED:['任务未完成','Job Failed'],
});

const BLOCKER_ACTIONS = Object.freeze({
  PRODUCT:['收集品类资料','Collect category evidence'],
  BUYER_MODEL:['核验采购与转售模式','Verify buyer model and resale'],
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

const statusPair = value => STATUS_LABELS[text(value).toUpperCase()] || ['待确认','To confirm'];
const typePair = value => TYPE_LABELS[text(value).toUpperCase()] || ['研究任务','Research job'];
const blockerPair = value => BLOCKER_LABELS[text(value).toUpperCase()] || ['待确认','To confirm'];
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
  host.classList.add('p9-inline-state');
  host.classList.toggle('is-error',error);
  host.innerHTML = `${bi(zh,en)}${retry ? ` <button class="btn btn-outline-secondary" type="button" data-p9-retry>${bi('重新读取','Retry')}</button>` : ''}`;
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

const AUTOMATION_STATUS_LABELS = Object.freeze({
  ENABLED:['已启用','Enabled'], READY:['已启用','Enabled'], DISABLED:['未启用','Disabled'],
  UNAVAILABLE:['状态暂不可用','Unavailable'], DEGRADED:['部分服务待恢复','Degraded'],
  BUDGET_PAUSED:['历史预算暂停（已退役）','Historical budget pause (retired)'], BUDGET_HOLD:['等待邮箱核验额度','Waiting for email verification credits'],
  RATE_LIMITED:['搜索服务速率等待','Search rate limited'], CREDIT_EXHAUSTED:['搜索服务额度已用完','Search credits exhausted'],
  AUTH_ERROR:['搜索服务配置不可用','Search configuration unavailable'], AUTH_INVALID:['搜索服务配置不可用','Search configuration unavailable'],
  AVAILABLE:['搜索服务可用','Search service available'], UNKNOWN:['搜索服务状态未知','Search status unknown'],
});

function automationProjection(summary = {}) {
  const nested = first(summary,['auto_evidence','automation','autoEvidence'],{});
  const source = nested && typeof nested === 'object' ? { ...summary,...nested } : summary;
  const enabledValue = first(source,['enabled','auto_evidence_enabled','automation_enabled'],null);
  const explicitStatus = text(first(source,['status','auto_evidence_state','automation_status'])).toUpperCase();
  const status = explicitStatus || (enabledValue === true ? 'ENABLED' : enabledValue === false ? 'DISABLED' : 'UNAVAILABLE');
  return {
    status,
    running:finiteNumber(first(source,['running','running_count','auto_evidence_running'],null)),
    retry:finiteNumber(first(source,['retry_scheduled','retry_scheduled_count','auto_evidence_retry_scheduled'],null)),
    paused:finiteNumber(first(source,['provider_capacity_wait'],null)),
    human:finiteNumber(first(source,['human_review_required','human_review_count','auto_evidence_human_review'],null)),
    last:first(source,['last_reconciled_at','last_reconciliation_at','auto_evidence_last_reconciled_at'],null),
    sourceHealth:text(first(source,['source_service_health','source_health'],'' )).toUpperCase(),
    emailHealth:text(first(source,['email_verification_health','email_service_health'],'' )).toUpperCase(),
    search:first(source,['search_service'],{})||{},
    tavily:first(source,['tavily_usage'],{})||{},
  };
}

function automationTone(status) {
  if (['ENABLED','READY'].includes(status)) return 'is-ready';
  if (['PROVIDER_CAPACITY_WAIT','BUDGET_PAUSED','BUDGET_HOLD','DEGRADED'].includes(status)) return 'is-paused';
  if (['UNAVAILABLE','ERROR'].includes(status)) return 'is-unavailable';
  return '';
}

const countText = value => value === null ? '-' : String(Math.max(0,Math.round(value)));
const serviceHealthPair = value => ({
  READY:['就绪','Ready'], ENABLED:['就绪','Ready'], DEGRADED:['部分可用','Degraded'],
  UNAVAILABLE:['暂不可用','Unavailable'], DISABLED:['未启用','Disabled']
})[value] || ['待同步','Pending'];

function renderAutomationMonitors(summary) {
  const value = automationProjection(summary);
  const statusLabel = AUTOMATION_STATUS_LABELS[value.status] || ['待同步','Pending'];
  const sourceHealth=serviceHealthPair(value.sourceHealth);
  const emailHealth=serviceHealthPair(value.emailHealth);
  const searchStatus=text(value.search?.status).toUpperCase()||'UNKNOWN';
  const searchLabel=AUTOMATION_STATUS_LABELS[searchStatus]||AUTOMATION_STATUS_LABELS.UNKNOWN;
  const tavily=value.tavily||{};
  const markup = [
    ['自动补证总开关','Auto enrichment switch',statusLabel,automationTone(value.status)],
    ['当前运行','Running',countText(value.running),''],
    ['等待重试','Retry scheduled',countText(value.retry),''],
    ['等待搜索服务容量','Waiting for search capacity',countText(value.paused),''],
    ['需人工复核','Human review',countText(value.human),''],
    ['资料服务 / 邮箱核验','Source / Email verification',[`资料 ${sourceHealth[0]} · 邮箱 ${emailHealth[0]}`,`Source ${sourceHealth[1]} · Email ${emailHealth[1]}`],''],
    ['搜索服务状态','Search service status',searchLabel,automationTone(searchStatus)],
    ['最近检查 / 最近对账','Last check / reconciliation',[`${value.search?.checked_at ? dateTime(value.search.checked_at) : '-'} · ${value.last ? dateTime(value.last) : '-'}`,`${value.search?.checked_at ? dateTime(value.search.checked_at) : '-'} · ${value.last ? dateTime(value.last) : '-'}`],''],
    ['今日 Tavily 用量单位','Tavily units used today',countText(finiteNumber(tavily.units_used_today)),''],
    ['今日已尝试企业','Companies attempted today',countText(finiteNumber(tavily.companies_attempted_today)),''],
    ['今日已尝试策略','Strategies attempted today',countText(finiteNumber(tavily.strategies_attempted_today)),''],
    ['今日新增可用资料','New usable evidence today',countText(finiteNumber(tavily.new_usable_evidence_today)),''],
  ].map(([zh,en,display,tone])=>`<div class="p10-automation-fact"><span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span><strong class="${tone}">${Array.isArray(display)?bi(display[0],display[1]):esc(display)}</strong></div>`).join('');
  ['#research-automation-monitor','#jobs-automation-monitor','#settings-automation-monitor'].forEach(selector=>{
    const host=$(selector);
    if (!host) return;
    host.setAttribute('aria-busy','false');
    host.innerHTML=markup;
  });
  const live=$('#phase10-automation-live');
  if (live) live.textContent=`自动补证${statusLabel[0]}，当前运行 ${countText(value.running)}，需人工复核 ${countText(value.human)}。 Auto enrichment ${statusLabel[1]}, ${countText(value.running)} running, ${countText(value.human)} human review.`;
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
  renderAutomationMonitors(summary);
}

function renderSummaryError() {
  const host = $('#research-workbench-summary');
  if (host) {
    host.setAttribute('aria-busy','false');
    host.innerHTML = `<div class="p9-inline-state is-error">${bi('研究指标读取失败。','Research metrics could not be loaded.')} <button class="btn btn-outline-secondary" type="button" data-summary-retry>${bi('重新读取','Retry')}</button></div>`;
    host.querySelector('[data-summary-retry]')?.addEventListener('click',loadSummary);
  }
  const provider = $('#research-provider-status');
  if (provider) {
    provider.dataset.state = 'TEMPORARY_ERROR';
    provider.innerHTML = bi('邮箱核验：状态待确认','Email verification: Status to confirm');
  }
  renderAutomationMonitors({ auto_evidence:{ status:'UNAVAILABLE' } });
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
  host.innerHTML = `<div class="p9-catalog-facts"><div><small>${bi('产品画像','Product profile')}</small><strong>${esc(profile)}</strong></div><div><small>${bi('商品目录行','Catalog rows')}</small><strong>${esc(rows ?? '-')}</strong></div><div><small>${bi('目录覆盖','Catalog coverage')}</small><strong>${esc(coverage)}</strong></div><div><small>${bi('快照时间','Snapshot captured')}</small><strong>${esc(dateTime(captured))}</strong></div></div>`;
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

function taskWorkstream(task) {
  const explicit=text(first(task,['task_class','workstream','evidence_workstream'])).toUpperCase();
  const status=text(first(task,['auto_evidence_status','automation_status'])).toUpperCase();
  if (explicit === 'HUMAN_REVIEW' || task?.human_review_required === true || status === 'HUMAN_REVIEW_REQUIRED') return 'HUMAN_REVIEW';
  return 'AUTO_ENRICHMENT';
}

function jobWorkstreamPair(record) {
  return ({
    AUTO_ENRICHMENT:['自动补证','Auto enrichment'],
    HUMAN_REVIEW:['需人工复核','Human review']
  })[taskWorkstream(record)] || ['自动补证','Auto enrichment'];
}

function taskAge(task) {
  const days = finiteNumber(first(task,['evidence_age_days','age_days']));
  if (days !== null) return bi(`${Math.max(0,Math.round(days))} 天`,`${Math.max(0,Math.round(days))} days`);
  const captured = first(task,['evidence_captured_at','last_evidence_at','updated_at']);
  return captured ? dateTimeMarkup(captured) : '-';
}

function strategyAttemptLabel(task){
  const strategy=Math.max(0,Number(first(task,['strategy_attempt_number','attempt_count'],0))||0);
  const provider=Math.max(0,Number(first(task,['provider_retry_number'],0))||0);
  const worker=Math.max(0,Number(first(task,['worker_retry_number'],0))||0);
  return bi(`已执行策略 ${strategy} · Provider 重试 ${provider} · Worker 恢复 ${worker}`,
    `Strategies executed ${strategy} · Provider retries ${provider} · Worker recoveries ${worker}`);
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
  host.classList.remove('p9-inline-state','is-error');
  host.setAttribute('aria-busy','false');
  const reviewItems=taskItems.filter(task=>taskWorkstream(task)==='HUMAN_REVIEW');
  if (!reviewItems.length) {
    setInlineState(host,'当前没有需要人工复核的例外。','No exceptions currently require human review.');
    return;
  }
  host.innerHTML = reviewItems.slice(0,3).map((task,index)=>{
    const blocker = taskBlocker(task);
    const blockerLabel = blockerPair(blocker);
    const action = ['处理例外','Review exception'];
    const company = first(task,['company_name','resolved_company_name'],'-');
    const profile = first(task,['product_profile','profile'],'-');
    return `<article class="p9-priority-item"><span class="p9-priority-rank">${index + 1}</span><div class="p9-item-main"><strong>${esc(company)}</strong><small>${esc(profile)}</small><small>${strategyAttemptLabel(task)}</small></div><div class="p9-item-fact"><small>${bi('阻断','Blocker')}</small>${bi(blockerLabel[0],blockerLabel[1])}</div><div class="p9-item-fact"><small>${bi('资料时效','Evidence age')}</small>${taskAge(task)}</div><button class="btn btn-outline-primary" type="button" data-priority-index="${index}">${bi(action[0],action[1])}</button></article>`;
  }).join('');
  host.querySelectorAll('[data-priority-index]').forEach(button=>button.addEventListener('click',()=>openEvidenceTask(reviewItems[Number(button.dataset.priorityIndex)],button)));
}

async function loadPriorityTasks() {
  const host = $('#research-priority-tasks');
  host?.setAttribute('aria-busy','true');
  try {
    const payload = await managementRequest('/api/research/tasks?limit=12&sort=priority_desc');
    state.tasks = items(payload).slice(0,12);
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
    CATEGORY_PROCUREMENT_EVIDENCE:'公司类目资料 / Company Category Evidence',
    COMPANY_CATEGORY_EVIDENCE:'公司类目资料 / Company Category Evidence',
    RESEARCH:'研究任务 / Research Job',
    AUTO_EVIDENCE:'自动补证 / Auto Enrichment',
  })[value.toUpperCase()] || (/^[A-Z0-9_:-]+$/.test(value) ? '研究任务 / Research Job' : value);
}

function jobResultFacts(job) {
  const definitions = [
    ['companies_selected','入选企业','Selected'],
    ['category_matches','品类匹配','Category'],
    ['verified_buyers','核验采购人员','Buyers'],
    ['verified_email_routes','有效邮箱','VALID'],
    ['provider_call_count','供应商调用','Provider calls'],
    ['used_units','已用额度','Used units'],
  ];
  return definitions.map(([key,zh,en])=>{
    const value = finiteNumber(first(job,[key]));
    return value === null ? '' : `<small>${bi(zh,en)} <strong>${esc(value)}</strong></small>`;
  }).filter(Boolean).join('') || bi('尚未报告结果','Results not reported');
}

function jobProgressValue(job) {
  const percent = finiteNumber(first(job,['progress_percent','progress']));
  if (percent !== null) return Math.max(0,Math.min(100,Math.round(percent)));
  const selected = finiteNumber(first(job,['companies_selected','candidates_found']));
  const maximum = finiteNumber(first(job,['max_results']));
  if (selected !== null && maximum !== null && maximum > 0) return Math.max(0,Math.min(99,Math.round((selected/maximum)*100)));
  return 0;
}

function jobProgress(job) {
  return `${jobProgressValue(job)}%`;
}

function jobProgressMarkup(job,{ compact=false }={}) {
  const percent=jobProgressValue(job);
  const stage=stagePair(first(job,['progress_stage','stage','current_stage'],first(job,['status'],'QUEUED')));
  return `<div class="p9-progress-block${compact?' is-compact':''}">
    <div class="p9-progress-copy"><strong>${bi(`当前阶段：${stage[0]}`,`Current stage: ${stage[1]}`)}</strong><b>${esc(percent)}%</b></div>
    <progress value="${esc(percent)}" max="100" aria-label="${esc(`研究任务进度 Research job progress: ${percent}%`)}">${esc(percent)}%</progress>
  </div>`;
}

function jobBlocker(job) {
  return text(first(job,['latest_blocker','blocker','blocker_group'])).toUpperCase();
}

const DISPATCH_LABELS=Object.freeze({
  PENDING:['已自动排队','Automatically queued'],DISPATCHED:['已自动排队','Automatically queued'],
  ORCHESTRATOR_UNAVAILABLE:['自动化服务暂不可用','Automation unavailable'],
  WORKFLOW_INACTIVE:['工作流未启用','Workflow inactive'],WEBHOOK_AUTH_FAILED:['工作流认证失败','Workflow authentication failed'],
  QUEUE_UNAVAILABLE:['任务队列暂不可用','Queue unavailable']
});
function dispatchLabel(job){
  const state=text(first(job,['dispatch_state'],'')).toUpperCase();
  const status=text(first(job,['auto_evidence_status','status'],'')).toUpperCase();
  const blocker=jobBlocker(job);
  if(status==='PROVIDER_CAPACITY_WAIT')return ['等待服务商重试','Waiting for Provider retry'];
  if(status==='EVIDENCE_EXHAUSTED')return ['自动搜索已完成','Automated research complete'];
  if(blocker==='PRODUCT')return ['类目待确认','Category confirmation required'];
  if(blocker==='CONTACT')return ['联系方式待补充','Contact route required'];
  return DISPATCH_LABELS[state]||null;
}

const STAGE_LABELS = Object.freeze({
  QUEUED:['等待开始','Queued'], DISCOVERING_SOURCES:['查找资料','Finding sources'], CRAWLING:['读取资料','Reading sources'],
  EXTRACTING:['整理资料','Extracting'], NORMALIZING_CATEGORY:['归一类目','Normalizing category'],
  VALIDATING_EVIDENCE:['核验资料','Validating evidence'], FINDING_BUYER:['查找采购负责人','Finding buyer'],
  VERIFYING_EMAIL:['核验商务邮箱','Verifying email'], REFRESHING_DECISION:['刷新机会状态','Refreshing status'],
  IDENTITY:['企业身份','Identity'], BUYER_MODEL:['采购模式','Buyer model'], CATEGORY_PROCUREMENT:['公司类目','Company category'],
  PRODUCT:['公司经营类目','Company category'],
  BUYER_ROLE:['采购人员与职责','Buyer / role'], BUYER:['采购人员与职责','Buyer / role'],
  EMAIL_VERIFICATION:['邮箱核验','Email verification'], EMAIL:['邮箱核验','Email verification'],
  DECISION_REFRESH:['机会状态刷新','Status refresh'], DECISION:['机会状态刷新','Status refresh'],
  DISCOVERING:['搜索候选企业','Searching candidate companies'], QUALIFYING:['核验公司真实性','Verifying company identity'],
  SCORING:['计算匹配结果','Calculating match results'], RUNNING:['自动处理中','Processing automatically'],
  COMPLETED:['全部阶段已完成','All stages completed'], WAITING_EVIDENCE:['自动核验已结束','Automated verification finished'],
});
const stagePair = value => STAGE_LABELS[text(value).toUpperCase()] || ['阶段待确认','Stage to confirm'];

function renderRecentJobs(jobItems) {
  const host = $('#research-recent-jobs');
  if (!host) return;
  host.classList.remove('p9-inline-state','is-error');
  host.setAttribute('aria-busy','false');
  if (!jobItems.length) {
    setInlineState(host,'当前没有研究任务。','No research jobs are available.');
    return;
  }
  host.innerHTML = jobItems.slice(0,6).map((job,index)=>{
    const type = typePair(first(job,['job_type','type'],'RESEARCH'));
    const workstream=jobWorkstreamPair(job);
    const updated = first(job,['updated_at','created_at']);
    return `<article class="p9-recent-item"><div class="p9-item-main"><strong>${esc(jobObjective(job))}</strong><small>${esc(jobMarket(job))} / ${esc(jobProfile(job))}</small><span class="p10-job-workstream">${bi(workstream[0],workstream[1])}</span></div><div class="p9-item-meta">${statusBadge(first(job,['status'],'QUEUED'))}<small>${bi(type[0],type[1])} / ${dateTimeMarkup(updated)}</small></div><button class="btn btn-outline-primary" type="button" data-recent-index="${index}">${bi('打开详情','Open details')}</button></article>`;
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
    const stageLabel=stagePair(stage);
    const workstream=jobWorkstreamPair(job);
    const blocker = jobBlocker(job);
    const blockerLabel = blocker ? blockerPair(blocker) : null;
    const activity = first(job,['updated_at','created_at']);
    const dispatch=dispatchLabel(job);
    const queuedAt=first(job,['queued_at']);
    return `<tr data-job-id="${esc(id)}"><td data-label="任务 / Job"><div class="p9-job-objective"><strong>${esc(jobObjective(job))}</strong><small>${esc(id || '-')} / ${bi(type[0],type[1])}</small><span class="p10-job-workstream">${bi(workstream[0],workstream[1])}</span></div></td><td data-label="市场 / Market"><div class="p9-job-cell-stack"><span>${esc(jobMarket(job))}</span><small>${esc(jobProfile(job))}</small></div></td><td data-label="状态 / Status"><div class="p9-job-cell-stack">${statusBadge(status)}<small>${bi(stageLabel[0],stageLabel[1])}</small>${dispatch?`<small>${bi(dispatch[0],dispatch[1])}</small>`:''}${queuedAt?`<small>${bi('排队时间','Queued')}: ${dateTimeMarkup(queuedAt)}</small>`:''}</div></td><td data-label="进度 / Progress">${jobProgressMarkup(job,{compact:true})}</td><td data-label="结果 / Results"><div class="p9-job-cell-stack">${jobResultFacts(job)}</div></td><td data-label="阻断 / Blocker"><div class="p9-job-cell-stack">${blockerLabel ? bi(blockerLabel[0],blockerLabel[1]) : bi('无已报告阻断','No reported blocker')}<small>${dateTimeMarkup(activity)}</small></div></td><td data-label="操作 / Action"><button class="btn btn-outline-primary" type="button" data-open-job="${esc(id)}">${bi('打开详情','Open details')}</button></td></tr>`;
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
  const listPanel = host?.closest('.p9-jobs-list-panel');
  const requestId = ++state.jobsRequest;
  if (listPanel) listPanel.hidden = false;
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
    setInlineState(statusHost,`共显示 ${state.jobs.length} 项任务。`,`Showing ${state.jobs.length} jobs.`);
    if (next) {
      next.hidden = !state.nextCursor;
      next.disabled = false;
    }
  } catch {
    if (requestId !== state.jobsRequest) return;
    if (!append && host) host.replaceChildren();
    if (!append && listPanel) listPanel.hidden = true;
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
  const workstream=jobWorkstreamPair(job);
  const dispatch=dispatchLabel(job);
  const phase10Stages=[
    ['查找资料','Finding sources',['DISCOVERING_SOURCES']],['读取资料','Reading sources',['CRAWLING']],
    ['整理资料','Extracting',['EXTRACTING']],['归一类目','Normalizing category',['NORMALIZING_CATEGORY']],
    ['核验资料','Validating evidence',['VALIDATING_EVIDENCE']],['查找采购负责人','Finding buyer',['FINDING_BUYER']],
    ['核验商务邮箱','Verifying email',['VERIFYING_EMAIL']],['刷新机会状态','Refreshing status',['REFRESHING_DECISION']]
  ];
  const hasPhase10Pipeline=phase10Stages.some(([, ,keys])=>keys.some(key=>stageMap.has(key)));
  const usageFacts=[
    ['供应商调用','Provider calls',first(job,['provider_call_count'],0)],
    ['完成','Completed',first(job,['provider_completed_count'],0)],
    ['未找到','Not found',first(job,['provider_not_found_count'],0)],
    ['临时错误','Temporary errors',first(job,['provider_temporary_error_count'],0)],
    ['预留额度','Reserved units',first(job,['reserved_units'],0)],
    ['已用额度','Used units',first(job,['used_units'],0)],
    ['已释放额度','Released units',first(job,['released_units'],0)],
    ['最近事件','Last event',dateTime(first(job,['last_provider_event_at']))]
  ];
  const usageMarkup=`<section class="card crm-panel"><header class="card-header crm-panel-header"><h4 class="card-title">${bi('供应商用量','Provider usage')}</h4></header><div class="card-body"><div class="p9-catalog-facts" aria-label="供应商用量 Provider usage">${usageFacts.map(([zh,en,value])=>`<div><small>${bi(zh,en)}</small><strong>${esc(value)}</strong></div>`).join('')}</div></div></section>`;
  const stages=hasPhase10Pipeline ? phase10Stages : [
    ['企业身份','Identity',['IDENTITY']],['采购模式','Buyer Model',['BUYER_MODEL']],
    ['公司经营类目','Company Category',['CATEGORY_PROCUREMENT','PRODUCT']],
    ['采购人员与职责','Buyer / Role',['BUYER_ROLE','BUYER']],['邮箱核验','Email verification',['EMAIL_VERIFICATION','EMAIL','HUNTER']],
    ['机会状态刷新','Status refresh',['DECISION_REFRESH','DECISION']]
  ];
  host.hidden = false;
  if (empty) empty.hidden = true;
  host.setAttribute('aria-busy','false');
  host.innerHTML = `<header class="p9-detail-header"><div><h3>${esc(jobObjective(job))}</h3><p class="crm-helper">${esc(id || '-')} / ${esc(jobMarket(job))} / ${esc(jobProfile(job))}</p><span class="p10-job-workstream">${bi(workstream[0],workstream[1])}</span>${dispatch?`<p class="crm-helper">${bi('调度诊断','Dispatch')}: ${bi(dispatch[0],dispatch[1])}</p>`:''}</div><div class="p9-command-actions">${statusBadge(first(job,['status'],'UNKNOWN'))}<button class="btn btn-outline-secondary" type="button" data-refresh-job="${esc(id)}"><i class="ti ti-refresh" aria-hidden="true"></i>${bi('刷新','Refresh')}</button></div></header><section class="card crm-panel p9-detail-progress" role="status" aria-live="polite" aria-atomic="true"><div class="card-body">${jobProgressMarkup(job)}</div></section>${usageMarkup}<div class="p9-pipeline p10-pipeline" aria-label="研究任务流水线 Research job pipeline">${stages.map(([zh,en,keys])=>renderPipelineStage(zh,en,pipelineStage(stageMap,keys))).join('')}</div>${evidence.length ? `<section class="card crm-panel"><header class="card-header crm-panel-header"><h4 class="card-title">${bi('资料链接','Evidence links')}</h4></header><div class="card-body p9-evidence-links">${evidence.map(record=>{const url=safeUrl(first(record,['source_url','url','evidence_url']));return url ? `<a class="btn btn-outline-secondary" href="${esc(url)}" target="_blank" rel="noreferrer">${bi('打开来源','Open source')}</a>` : ''}).join('')}</div></section>` : ''}`;
  host.querySelector('[data-refresh-job]')?.addEventListener('click',event=>{ event.currentTarget.disabled=true; void openJobDetail(id,{ replaceState:true }); });
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
  const productProfile=$('#research-product-profile');
  const buyerTypes = $$('input[name="buyer_type"]:checked').map(input=>input.value);
  if (!host || !country || !category) return;
  const provider = providerState(state.summary || {});
  const values = [
    ['市场','Market',country.selectedOptions[0]?.textContent || country.value],
    ['目标商品类目','Target category',category.selectedOptions[0]?.textContent || category.value],
    ['产品画像','Product profile',productProfile?.selectedOptions[0]?.textContent || '按目标类目确定 / Resolve from target category'],
    ['目标客户类型','Buyer types',buyerTypes.join(', ') || '-'],
    ['最大结果数','Maximum results',$('#research-limit')?.value || '-'],
    ['网络调用范围','Network call scope','按所选结果范围 / Selected result scope'],
    ['邮箱核验','Email verification',`${provider[1]} / ${provider[2]}`],
    ['外发消息','Live sends','0'],
    ['重复防护','Duplicate safeguard','服务端任务标识 / Server job identity'],
  ];
  host.innerHTML = values.map(([zh,en,value])=>`<div><small>${bi(zh,en)}</small><strong>${esc(value)}</strong></div>`).join('');
}

function setDialogStep(step,{ focus = true } = {}) {
  const resolved = Math.max(1,Math.min(4,Number(step) || 1));
  state.dialogStep = resolved;
  $$('.p9-dialog-step[data-research-step]').forEach(panel=>{ panel.hidden = Number(panel.dataset.researchStep) !== resolved; });
  $$('#research-job-steps li').forEach((item,index)=>{
    if (index + 1 === resolved) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
  });
  const back = $('#research-step-back');
  const next = $('#research-step-next');
  const submit = $('#start-research');
  if (back) back.hidden = resolved === 1;
  if (next) next.hidden = resolved === 4;
  if (submit) submit.hidden = resolved !== 4;
  if (resolved === 4) renderScopeReview();
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
    for (const control of [$('#research-country'),$('#research-category')]) {
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
  if (state.dialogStep === 3 && $('#research-limit') && !$('#research-limit').checkValidity()) {
    $('#research-limit').reportValidity();$('#research-limit').focus();return false;
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
  $('#research-category')?.addEventListener('change',()=>{ renderCatalogSummary(); if (state.dialogStep === 4) renderScopeReview(); });
  $('#research-product-profile')?.addEventListener('change',()=>{ if (state.dialogStep === 4) renderScopeReview(); });
  form.addEventListener('change',()=>{ if (state.dialogStep === 4) renderScopeReview(); });
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
    setDialogStep(4,{ focus:false });
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
    if (event.detail?.view === 'jobs') { void ensureJobsLoaded(); if(!state.summary) void loadSummary(); }
    if (event.detail?.view === 'settings' && !state.summary) void loadSummary();
  });
  $('#phase10-automation-refresh')?.addEventListener('click',event=>{
    const button=event.currentTarget;
    if(button.disabled) return;
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    Promise.resolve(loadSummary()).finally(()=>{button.disabled=false;button.removeAttribute('aria-busy');});
  });
  $('#phase10-provider-refresh')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    if(button.disabled)return;
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    const live=$('#phase10-automation-live');
    if(live)live.textContent='正在重新检查搜索服务。 Rechecking search service.';
    try{
      await managementRequest('/api/research/provider-status/refresh',{method:'POST'});
      await loadSummary();
      if(live)live.textContent='搜索服务状态已更新。 Search service status updated.';
    }catch{
      if(live)live.textContent='搜索服务状态检查未完成，请稍后重试。 Search service check did not complete; retry later.';
    }finally{
      button.disabled=false;
      button.removeAttribute('aria-busy');
    }
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
