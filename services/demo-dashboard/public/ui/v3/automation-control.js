import { activateView } from '../../crm-shell.js';
import { normalizeAutomationControl } from './automation-model.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';

const featureRows = [
  ['search','客户搜索','Lead search'],
  ['opportunity','业务机会入池','Business opportunity pool'],
  ['contactResearch','联系人研究','Contact research'],
  ['firstTouch','自动首封','Auto first-touch'],
  ['replies','客户回复监控','Inbound reply monitor'],
  ['followUp','后续邮件','Follow-up email'],
  ['phone','电话联系','Phone outreach'],
  ['whatsapp','WhatsApp 联系','WhatsApp outreach']
];

function statePill(on, offLabel = ['未启用','Not enabled']) {
  return `<span class="v3-automation-state ${on ? 'is-on' : 'is-off'}"><i aria-hidden="true"></i>${bi(...(on ? ['已启用','Enabled'] : offLabel))}</span>`;
}

// Three independent switches (each saved on its own by the server) plus the search spending choice.
const subsystemRows = [
  ['search','search','客户搜索','Lead search','按批准的类目和市场查找新的潜在客户企业','Find new prospect companies for approved categories and markets','开启后按客户搜索查找新的客户企业；关闭后任务暂停，开启后接着做|When on, search batches look for new companies; when off they pause and resume later'],
  ['email','firstTouch','自动首封','Auto first-touch','在目标市场的工作时间自动发送第一封开发信','Send the first email automatically during business hours in the target market','开启后自动给符合条件的新客户发第一封开发信；人工批准的跟进邮件不受这个开关影响|When on, eligible new prospects receive the first email automatically; approved follow-ups do not depend on this switch'],
  ['contact_research','contactResearch','联系人研究','Contact research','为业务机会查找采购负责人并核验商务邮箱','Find buyer contacts for opportunities and check business emails','开启后为业务机会查找联系人并核验邮箱（会使用邮箱核验额度）；关闭后不再自动查找|When on, buyer contacts are researched and emails checked (uses email-check credits); when off nothing runs automatically']
];
const spendChoices = [
  ['FREE_ONLY','只用免费搜索','Free search only','免费搜索暂不可用时任务暂停，稍后自动继续','Work pauses while free search is unavailable and resumes later','只使用本地免费搜索，不产生搜索费用|Use the local free search only; no search charges'],
  ['ALLOW_PAID','允许付费兜底','Allow paid fallback','免费搜索不可用时改用付费搜索，受每月花费上限限制','Use paid search when free search is unavailable, within the monthly limit','免费搜索不可用时使用付费搜索，每月花费不超过上限|Use paid search when free search is unavailable, never above the monthly limit']
];

function switchRow(name, label, note, tip, checked, { disabled = false, hook = 'data-automation-subsystem', id = '' } = {}) {
  return `<li><span class="k">${bi(...label)}<small class="v3-automation-note"${id ? ` id="${id}"` : ''}>${bi(...note)}</small></span><span class="v"><label class="v4-switch" data-tip="${esc(tip)}"><input type="checkbox" role="switch" ${hook}="${esc(name)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} aria-label="${esc(`${label[0]} ${label[1]}`)}"${id ? ` aria-describedby="${id}"` : ''}><span aria-hidden="true"></span></label></span></li>`;
}

function renderSubsystems(model) {
  const rows = subsystemRows.map(([name,feature,zh,en,noteZh,noteEn,tip]) => switchRow(name,[zh,en],[noteZh,noteEn],tip,model.features[feature],
    { disabled: busy || (name === 'contact_research' && model.contactControlMissing), id: `automation-note-${name}` })).join('');
  const choices = spendChoices.map(([value,zh,en,noteZh,noteEn,tip]) => `<label class="v4-preset${model.spendMode === value ? ' is-on' : ''}" data-tip="${esc(tip)}"><input type="radio" name="provider_spend_mode" value="${value}" data-automation-spend${model.spendMode === value ? ' checked' : ''}${busy ? ' disabled' : ''}><b>${bi(zh,en)}</b><small>${bi(noteZh,noteEn)}</small></label>`).join('');
  const fallback = switchRow('paid_fallback_on_empty',['免费无结果时转付费','Paid search after empty free results'],
    model.spendMode === 'ALLOW_PAID' ? ['免费搜索没有找到结果时，再用付费搜索查一次','Ask paid search again when free search finds nothing'] : ['仅在“允许付费兜底”时可用','Available only with Allow paid fallback'],
    '默认关闭：免费搜索没有结果就记为无结果，不再花钱|Off by default: an empty free result is kept without paid searching',
    model.spendMode === 'ALLOW_PAID' && model.paidFallbackOnEmpty, { disabled: busy || model.spendMode !== 'ALLOW_PAID', hook: 'data-automation-empty-fallback', id: 'automation-note-empty-fallback' });
  const senderNotice = model.senderPaused ? `<div class="v3-automation-alert" role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>${bi('发信邮箱已暂停','Sender paused')}</strong><span>${bi('发信出现问题后已暂停，已批准的跟进邮件也在等待；处理后重新开启“自动首封”即可恢复','Sending paused after a delivery problem and approved follow-ups are waiting; switch Auto first-touch on again once resolved')}</span></div></div>` : '';
  return `<section class="v3-automation-subsystems" aria-labelledby="automation-subsystems-title"><h4 id="automation-subsystems-title">${bi('自动处理开关','Automation switches')}</h4>${senderNotice}<ul class="review-list v3-automation-switches">${rows}</ul><h4 id="automation-spend-title">${bi('搜索花费','Search spending')}</h4><div class="v4-presets v3-automation-spend" role="radiogroup" aria-labelledby="automation-spend-title">${choices}</div><ul class="review-list v3-automation-switches">${fallback}</ul></section>`;
}

function renderStrip(model) {
  return `<div class="v3-automation-strip"><span class="v3-automation-strip-title">${bi('自动获客','Automated acquisition')}</span>${statePill(model.enabled,['人工模式','Manual mode'])}${model.paused ? `<span class="v3-automation-strip-alert" role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i>${bi('当前流程已暂停','Current workflow paused')}</span>` : ''}<span class="v3-automation-strip-actions"><button class="btn btn-sm ${model.enabled ? '' : 'btn-primary'}" data-tip="一起开启或暂停客户搜索和自动首封；暂停时联系人研究也会暂停，开启需在运营设置单独打开|Turn lead search and auto first-touch on or off together; pausing also pauses contact research, which is switched on separately in settings" type="button" data-automation-toggle aria-pressed="${model.enabled}">${model.enabled ? bi('切换为人工处理','Switch to manual review') : bi('启用自动获客','Enable automation')}</button><button class="btn btn-sm btn-ghost-primary" data-tip="打开系统设置查看自动处理详情|Open settings for automation details" type="button" data-automation-view="settings">${bi('运营设置','Operations settings')}</button></span></div>`;
}

function renderPanel(model, location) {
  if (['research','jobs','contact'].includes(location)) return renderStrip(model);
  const isOverview = location === 'overview';
  const visibleFeatures = ['research','jobs'].includes(location)
    ? featureRows.filter(([key])=>['search','opportunity','contactResearch'].includes(key))
    : location === 'contact'
      ? featureRows.filter(([key])=>['firstTouch','replies','followUp'].includes(key))
      : featureRows;
  const metrics = [
    ['业务机会','Business Opportunity',model.metrics.opportunities,'target-arrow'],
    ['联系方式就绪','Contact Readiness',model.metrics.contactReady,'address-book'],
    ['邮件资格','Email Eligibility',model.metrics.emailEligible,'mail-check']
  ];
  return `<header class="v3-automation-head"><div><p class="v3-automation-kicker">${bi('运营控制','OPERATIONS CONTROL')}</p><h3>${bi('自动获客','Automated Acquisition')}</h3><p>${bi('客户搜索、机会、联系人、首封邮件与回复监控','Lead search, opportunities, contacts, first-touch email and reply monitoring')}</p></div><div class="v3-automation-master">${statePill(model.enabled,['人工模式','Manual mode'])}<button class="btn ${model.enabled ? 'btn-outline-secondary' : 'btn-primary'}" data-tip="一起开启或暂停客户搜索和自动首封；暂停时联系人研究也会暂停，开启需在运营设置单独打开|Turn lead search and auto first-touch on or off together; pausing also pauses contact research, which is switched on separately in settings" type="button" data-automation-toggle aria-pressed="${model.enabled}">${model.enabled ? bi('切换为人工处理','Switch to manual review') : bi('启用自动获客','Enable automation')}</button></div></header>
  ${model.paused ? `<div class="v3-automation-alert" role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>${bi('当前流程已暂停','Current workflow paused')}</strong><span>${bi('请检查搜索服务状态','Review search service status')}</span></div></div>` : ''}
  ${location === 'settings' ? renderSubsystems(model) : ''}
  ${isOverview ? `<div class="v3-automation-metrics">${metrics.map(([zh,en,value,icon])=>`<div><i class="ti ti-${icon}" aria-hidden="true"></i><span>${bi(zh,en)}</span><strong>${count(value)}</strong></div>`).join('')}</div>` : ''}
  <div class="v3-automation-grid"><section><h4>${bi('流程状态','Workflow status')}</h4><ul class="v3-automation-features">${visibleFeatures.map(([key,zh,en])=>`<li><span>${bi(zh,en)}</span>${statePill(model.features[key],['人工处理','Manual'])}</li>`).join('')}</ul></section><section><h4>${bi('搜索服务','Search operations')}</h4><dl class="v3-automation-facts"><div><dt>${bi('当前服务','Current provider')}</dt><dd>${esc(model.provider || '—')}</dd></div><div><dt>${bi('可用额度','Available capacity')}</dt><dd>${model.capacity === null ? '—' : count(model.capacity)}</dd></div></dl></section></div>
  <footer class="v3-automation-foot"><span>${bi('控制版本','Control revision')} ${esc(model.revision)}</span>${model.updatedAt ? `<time datetime="${esc(model.updatedAt)}">${esc(new Date(model.updatedAt).toLocaleString())}</time>` : ''}<button class="btn btn-ghost-primary" data-tip="重新读取自动处理状态|Reload automation status" type="button" data-automation-refresh>${bi('刷新状态','Refresh status')}</button></footer>`;
}

function panel(id, location) {
  const node = document.createElement('section');
  node.id = id;
  node.className = `card crm-panel v3-automation-panel v3-automation-${location}`;
  node.dataset.automationLocation = location;
  node.setAttribute('aria-live','polite');
  node.setAttribute('aria-busy','true');
  node.innerHTML = `<div class="v3-automation-loading">${bi('正在读取运营控制','Loading operations control')}</div>`;
  return node;
}

function ensurePanels() {
  const overview = $('#view-overview .v4-overview-ops');
  if (overview && !$('#automation-overview')) overview.after(panel('automation-overview','overview'));
  const research = $('#view-research .p9-command-header');
  if (research && !$('#automation-research')) research.after(panel('automation-research','research'));
  const jobs = $('#view-jobs .p9-jobs-tabs') || $('#view-jobs .crm-section-head');
  if (jobs && !$('#automation-jobs')) jobs.after(panel('automation-jobs','jobs'));
  const settings = $('#view-settings .crm-section-head');
  if (settings && !$('#automation-settings')) settings.after(panel('automation-settings','settings'));
  const contactHead = $('#view-contact-queue .crm-section-head');
  if (contactHead && !$('#automation-contact-queue')) contactHead.after(panel('automation-contact-queue','contact'));
}

async function request(url, options) {
  const response = await fetch(url, { credentials:'same-origin', ...options });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.status === 204 ? {} : response.json();
}

let model = normalizeAutomationControl();
let loading = false;
let busy = false;

function syncQueueLabels() {
  // The contact queue is in automatic mode only while auto first-touch itself is on.
  document.documentElement.dataset.acquisitionMode = model.features.firstTouch ? 'auto' : 'manual';
  const title = $('#contact-queue-title');
  const nav = $('[data-app-nav="contact-queue"] .bi');
  const workbench = $('#outreach-workbench-title');
  const labels = model.features.firstTouch ? ['自动首封联系','Auto first-touch'] : ['开发信审核','First-touch review'];
  for (const target of [title,nav]) if (target) target.innerHTML = `<span lang="zh-CN">${labels[0]}</span><span lang="en">${labels[1]}</span>`;
  if (workbench) workbench.innerHTML = model.features.firstTouch ? bi('自动首封联系队列','Auto First-touch Queue') : bi('邮件联系工作台','Email Contact Workbench');
  document.dispatchEvent(new CustomEvent('dpv:automationchange',{detail:model}));
}

function render() {
  ensurePanels();
  document.querySelectorAll('[data-automation-location]').forEach(host => {
    host.innerHTML = renderPanel(model, host.dataset.automationLocation);
    host.setAttribute('aria-busy','false');
  });
  syncQueueLabels();
}

async function load({ announce = false } = {}) {
  if (loading) return;
  loading = true;
  ensurePanels();
  try {
    const [control, status] = await Promise.all([
      request('/api/automation/control'),
      request('/api/automation/status').catch(() => ({}))
    ]);
    model = normalizeAutomationControl(control,status);
    render();
    if (announce) document.querySelectorAll('[data-automation-location]').forEach(host=>host.dataset.refreshed='true');
  } catch {
    document.querySelectorAll('[data-automation-location]').forEach(host => {
      host.setAttribute('aria-busy','false');
      host.innerHTML = `<div class="v3-automation-error" role="alert"><div><strong>${bi('运营控制暂未返回','Operations control unavailable')}</strong><span>${bi('请刷新状态后重试','Refresh status to retry')}</span></div><button class="btn btn-outline-primary" data-tip="重新读取自动处理状态|Reload automation status" type="button" data-automation-refresh>${bi('重试','Retry')}</button></div>`;
    });
  } finally { loading = false; }
}

async function toggle(button) {
  if (loading) return;
  loading = true;
  document.querySelectorAll('[data-automation-toggle]').forEach(item=>item.disabled=true);
  try {
    const control = await request('/api/automation/control',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!model.enabled})});
    const status = await request('/api/automation/status').catch(()=>({}));
    model = normalizeAutomationControl(control,status);
    render();
  } catch {
    const panel = button.closest('[data-automation-location]');
    panel?.insertAdjacentHTML('afterbegin',`<div class="v3-automation-alert" role="alert"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>${bi('设置未保存','Setting was not saved')}</strong><span>${bi('请核对权限并重试','Check access and try again')}</span></div></div>`);
  } finally { loading = false; document.querySelectorAll('[data-automation-toggle]').forEach(item=>item.disabled=false); }
}

// One subsystem (or the search spend settings) per request; the server records each change.
async function saveSubsystem(input, subsystem, body) {
  if (busy) return;
  busy = true;
  const panel = input.closest('[data-automation-location]');
  // Re-rendering replaces the controls; keyboard focus returns to the control that was changed.
  const focusSelector = input.matches('[data-automation-spend]') ? `[data-automation-spend][value="${input.value}"]`
    : input.matches('[data-automation-empty-fallback]') ? '[data-automation-empty-fallback]' : `[data-automation-subsystem="${subsystem}"]`;
  const restoreFocus = () => { const host = panel?.id ? document.getElementById(panel.id) : null; host?.querySelector(focusSelector)?.focus(); };
  document.querySelectorAll('[data-automation-subsystem],[data-automation-spend],[data-automation-empty-fallback]').forEach(item=>item.disabled=true);
  try {
    const control = await request(`/api/automation/control/${encodeURIComponent(subsystem)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const status = await request('/api/automation/status').catch(()=>({}));
    model = normalizeAutomationControl(control,status);
    busy = false;
    render();
    restoreFocus();
  } catch {
    busy = false;
    render();
    restoreFocus();
    const host = panel?.id ? document.getElementById(panel.id) : null;
    host?.querySelector('.v3-automation-subsystems')?.insertAdjacentHTML('afterbegin',`<div class="v3-automation-alert" role="alert"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>${bi('设置未保存','Setting was not saved')}</strong><span>${bi('请核对权限并重试','Check access and try again')}</span></div></div>`);
  }
}

function onSettingChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches('[data-automation-subsystem]')) { void saveSubsystem(target, target.dataset.automationSubsystem, { enabled: target.checked }); return; }
  if (target.matches('[data-automation-spend]') && target.checked) { void saveSubsystem(target, 'search', { provider_spend_mode: target.value }); return; }
  if (target.matches('[data-automation-empty-fallback]')) void saveSubsystem(target, 'search', { paid_fallback_on_empty: target.checked });
}

export function mountAutomationControl() {
  ensurePanels();
  document.addEventListener('change', onSettingChange);
  document.addEventListener('click',event=>{
    const toggleButton=event.target.closest('[data-automation-toggle]');
    if(toggleButton){void toggle(toggleButton);return;}
    if(event.target.closest('[data-automation-refresh]'))void load({announce:true});
  });
  document.addEventListener('crm:viewchange',event=>{
    if(['overview','research','jobs','contact-queue','settings'].includes(event.detail?.view)){
      ensurePanels();
      if(!loading)void load();
    }
  });
  document.addEventListener('click',event=>{
    const route=event.target.closest('[data-automation-view]')?.dataset.automationView;
    if(route)activateView(route);
  });
  void load();
  return { refresh:load, getModel:()=>model };
}
