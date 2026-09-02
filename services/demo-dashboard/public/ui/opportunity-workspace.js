const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const statusMeta = Object.freeze({
  RECOMMENDED: { zh: '建议联系', en: 'Recommended', tone: 'primary' },
  EVIDENCE_REQUIRED: { zh: '待补资料', en: 'Evidence Required', tone: 'warning' },
  MANAGEMENT_APPROVED: { zh: '已确认待联系', en: 'Approved', tone: 'success' },
  HOLD: { zh: '暂不联系', en: 'Hold', tone: 'neutral' },
  NOT_SUITABLE: { zh: '当前不适合', en: 'Not Suitable', tone: 'danger' }
});

const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstValue = (item, keys, fallback = '') => {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};
const companyName = item => item?.company_name || item?.resolved_company_name || 'Company to confirm';
const profilePair = item => {
  const value = item?.product_profile_label || item?.product_profile;
  return ({ WOMENSWEAR:['女装','Womenswear'], GENERAL_MERCHANDISE:['日用百货','General merchandise'] })[String(value || '').toUpperCase()]
    || [value || '产品待确认',value || 'Product to confirm'];
};
const updatedAt = item => item?.calculated_at || item?.updated_at || item?.created_at;
const shortDate = value => {
  if (!value) return '待更新';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
};

function activateStatus(status) {
  const select = document.querySelector('#opportunity-status');
  if (!select) return;
  select.value = status;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  window.setTimeout(() => document.querySelector('.opw-inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function priorityScore(item, getBlocker) {
  const blocker = getBlocker(item, item?.reason_codes || item?.evidence_required_reasons || item?.blocker_reasons || []);
  const blockerWeight = ({ EMAIL: 90, BUYER_ROLE: 82, CONTACT: 78, SUPPLIER_ACCESS: 68, BUYER_MODEL: 64, PRODUCT: 58, IDENTITY: 48, HISTORY: 40, TEMPORARY_ERROR: 20 })[blocker] || 30;
  return blockerWeight + numberValue(item?.category_procurement_match_score) + numberValue(item?.match_score) / 10;
}

function workstreamFor(item, getBlocker) {
  const explicit = String(firstValue(item,['task_class','workstream','evidence_workstream'])).toUpperCase();
  const autoState = String(firstValue(item,['auto_evidence_status','automation_status','evidence_status'])).toUpperCase();
  if (explicit === 'HUMAN_REVIEW' || item?.human_review_required === true || autoState === 'HUMAN_REVIEW_REQUIRED') return 'human';
  return 'auto';
}

function workstreamStatus(item, stream) {
  const value = String(firstValue(item,['auto_evidence_stage','auto_evidence_status','automation_stage','automation_status'])).toUpperCase();
  const labels = {
    QUEUED:['等待执行','Queued'], DISCOVERING_SOURCES:['查找资料','Finding sources'], CRAWLING:['读取资料','Reading sources'],
    EXTRACTING:['整理资料','Extracting'], NORMALIZING_CATEGORY:['归一类目','Normalizing category'],
    VALIDATING_EVIDENCE:['核验资料','Validating evidence'], FINDING_BUYER:['查找采购负责人','Finding buyer'],
    VERIFYING_EMAIL:['核验商务邮箱','Verifying email'], REFRESHING_DECISION:['刷新机会状态','Refreshing status'],
    RETRY_SCHEDULED:['等待重试','Retry scheduled'], BUDGET_PAUSED:['预算暂停','Budget paused'],
    HUMAN_REVIEW_REQUIRED:['等待复核','Review required'], COMPLETED:['已完成','Completed']
  };
  return labels[value] || (stream === 'human' ? ['等待复核','Review required'] : ['等待自动处理','Awaiting automation']);
}

function renderWorkstreamList(host, records, stream, getBlocker, getBlockerLabel, onTask) {
  if (!host) return;
  const labels = {
    auto:{ empty:['当前没有自动补证事项','No auto-enrichment items'], action:['查看补证进度','View enrichment progress'] },
    human:{ empty:['当前没有人工复核事项','No human-review items'], action:['处理例外','Review exception'] }
  }[stream];
  if (!records.length) {
    host.innerHTML = `<div class="p10-workstream-empty"><i class="ti ti-circle-check" aria-hidden="true"></i><span class="bi"><span lang="zh-CN">${labels.empty[0]}</span><span lang="en">${labels.empty[1]}</span></span></div>`;
    return;
  }
  host.innerHTML = records.slice(0,3).map((item, index) => {
    const reasons = item?.reason_codes || item?.evidence_required_reasons || item?.blocker_reasons || [];
    const blocker = getBlocker(item, Array.isArray(reasons) ? reasons : [reasons]);
    const label = getBlockerLabel(blocker);
    const stage = workstreamStatus(item,stream);
    const profile=profilePair(item);
    return `<article class="p10-workstream-item">
      <div class="p10-workstream-company"><strong>${escapeHtml(companyName(item))}</strong><span class="bi"><span lang="zh-CN">${escapeHtml(profile[0])}</span><span lang="en">${escapeHtml(profile[1])}</span></span></div>
      <div class="p10-workstream-state"><span class="bi"><span lang="zh-CN">${escapeHtml(stage[0])}</span><span lang="en">${escapeHtml(stage[1])}</span></span><small class="bi"><span lang="zh-CN">${escapeHtml(label[0])}</span><span lang="en">${escapeHtml(label[1])}</span></small></div>
      <time datetime="${escapeHtml(updatedAt(item) || '')}">${escapeHtml(shortDate(updatedAt(item)))}</time>
      <button type="button" data-p10-task="${index}"><span class="bi"><span lang="zh-CN">${labels.action[0]}</span><span lang="en">${labels.action[1]}</span></span><i class="ti ti-arrow-right" aria-hidden="true"></i></button>
    </article>`;
  }).join('');
  host.querySelectorAll('[data-p10-task]').forEach(button => button.addEventListener('click', () => {
    const item = records[Number(button.dataset.p10Task)];
    const reasons = item?.reason_codes || item?.evidence_required_reasons || item?.blocker_reasons || [];
    const blocker = getBlocker(item, Array.isArray(reasons) ? reasons : [reasons]);
    onTask?.(item, blocker, button);
  }));
}

function renderWorkstreams(items, getStatus, getBlocker, getBlockerLabel, onTask) {
  const records = items
    .filter(item => getStatus(item) === 'EVIDENCE_REQUIRED')
    .sort((a,b)=>priorityScore(b,getBlocker)-priorityScore(a,getBlocker));
  const groups = { auto:[], human:[] };
  records.forEach(item=>groups[workstreamFor(item,getBlocker)].push(item));
  renderWorkstreamList(document.querySelector('#opportunity-auto-evidence-list'),groups.auto,'auto',getBlocker,getBlockerLabel,onTask);
  renderWorkstreamList(document.querySelector('#opportunity-priority-list'),groups.human,'human',getBlocker,getBlockerLabel,onTask);
  const countTargets = { auto:'#opportunity-auto-count',human:'#opportunity-human-count' };
  Object.entries(countTargets).forEach(([key,selector])=>{ const node=document.querySelector(selector); if(node) node.textContent=String(groups[key].length); });
}

function renderChart(counts, total) {
  const host = document.querySelector('#opportunity-status-chart');
  if (!host) return;
  const maximum = Math.max(1, ...Object.keys(statusMeta).map(status => numberValue(counts[status])));
  host.innerHTML = Object.entries(statusMeta).map(([status, meta]) => {
    const count = numberValue(counts[status]);
    const share = total ? Math.round((count / total) * 100) : 0;
    const relativeWidth = Math.max(count ? 8 : 0, Math.round((count / maximum) * 100));
    return `<button class="opw-chart-row is-${meta.tone}" type="button" data-opw-status="${status}" aria-label="${escapeHtml(meta.zh)} ${count}, ${share}%">
      <span class="opw-chart-label"><span>${escapeHtml(meta.zh)}</span><small>${escapeHtml(meta.en)}</small></span>
      <span class="opw-chart-track" aria-hidden="true"><span style="--opw-bar:${relativeWidth}%"></span></span>
      <strong>${count}</strong><small class="opw-chart-percent">${share}%</small>
    </button>`;
  }).join('');
}

export function renderOpportunityWorkspace({ items = [], counts = {}, getStatus, getBlocker, getBlockerLabel, getBlockerAction, onTask } = {}) {
  if (typeof getStatus !== 'function' || typeof getBlocker !== 'function') return;
  const total = items.length;
  const summary = document.querySelector('#opportunity-workspace-summary');
  if (summary) summary.setAttribute('aria-busy', 'false');
  document.querySelectorAll('[data-status-count]').forEach(node => {
    const status = node.dataset.statusCount;
    node.textContent = String(status === 'ALL' ? total : numberValue(counts[status]));
  });
  renderWorkstreams(items, getStatus, getBlocker, getBlockerLabel, onTask);
  renderChart(counts, total);
  document.querySelectorAll('[data-opw-status]').forEach(button => {
    button.onclick = () => activateStatus(button.dataset.opwStatus);
  });
}

export function setOpportunityResultSummary(count, status) {
  const host = document.querySelector('#opw-result-summary');
  if (!host) return;
  const meta = statusMeta[status];
  host.innerHTML = `<strong>${numberValue(count)}</strong><span><span lang="zh-CN">条${meta ? ` · ${meta.zh}` : ''}</span><span lang="en">records${meta ? ` · ${meta.en}` : ''}</span></span>`;
}
