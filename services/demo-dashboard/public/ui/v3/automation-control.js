import { activateView } from '../../crm-shell.js';
import { normalizeAutomationControl } from './automation-model.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';

const featureRows = [
  ['search','客户研究','Company research'],
  ['opportunity','业务机会入池','Business opportunity pool'],
  ['contactResearch','联系方式核验','Contact research'],
  ['firstTouch','首封开发信','First-touch email'],
  ['replies','客户回复监控','Inbound reply monitor'],
  ['followUp','后续邮件','Follow-up email'],
  ['phone','电话联系','Phone outreach'],
  ['whatsapp','WhatsApp 联系','WhatsApp outreach']
];

function statePill(on, offLabel = ['未启用','Not enabled']) {
  return `<span class="v3-automation-state ${on ? 'is-on' : 'is-off'}"><i aria-hidden="true"></i>${bi(...(on ? ['已启用','Enabled'] : offLabel))}</span>`;
}

function renderStrip(model) {
  return `<div class="v3-automation-strip"><span class="v3-automation-strip-title">${bi('自动获客','Automated acquisition')}</span>${statePill(model.enabled,['人工模式','Manual mode'])}${model.paused ? `<span class="v3-automation-strip-alert" role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i>${bi('当前流程已暂停','Current workflow paused')}</span>` : ''}<span class="v3-automation-strip-actions"><button class="btn btn-sm ${model.enabled ? '' : 'btn-primary'}" type="button" data-automation-toggle aria-pressed="${model.enabled}">${model.enabled ? bi('切换为人工处理','Switch to manual review') : bi('启用自动获客','Enable automation')}</button><button class="btn btn-sm btn-ghost-primary" type="button" data-automation-view="settings">${bi('运营设置','Operations settings')}</button></span></div>`;
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
  return `<header class="v3-automation-head"><div><p class="v3-automation-kicker">${bi('运营控制','OPERATIONS CONTROL')}</p><h3>${bi('自动获客','Automated Acquisition')}</h3><p>${bi('研究、机会、联系人、首封邮件与回复监控','Research, opportunities, contacts, first-touch email and reply monitoring')}</p></div><div class="v3-automation-master">${statePill(model.enabled,['人工模式','Manual mode'])}<button class="btn ${model.enabled ? 'btn-outline-secondary' : 'btn-primary'}" type="button" data-automation-toggle aria-pressed="${model.enabled}">${model.enabled ? bi('切换为人工处理','Switch to manual review') : bi('启用自动获客','Enable automation')}</button></div></header>
  ${model.paused ? `<div class="v3-automation-alert" role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><strong>${bi('当前流程已暂停','Current workflow paused')}</strong><span>${bi('请检查搜索服务状态','Review search service status')}</span></div></div>` : ''}
  ${isOverview ? `<div class="v3-automation-metrics">${metrics.map(([zh,en,value,icon])=>`<div><i class="ti ti-${icon}" aria-hidden="true"></i><span>${bi(zh,en)}</span><strong>${count(value)}</strong></div>`).join('')}</div>` : ''}
  <div class="v3-automation-grid"><section><h4>${bi('流程状态','Workflow status')}</h4><ul class="v3-automation-features">${visibleFeatures.map(([key,zh,en])=>`<li><span>${bi(zh,en)}</span>${statePill(model.features[key],['人工处理','Manual'])}</li>`).join('')}</ul></section><section><h4>${bi('搜索服务','Search operations')}</h4><dl class="v3-automation-facts"><div><dt>${bi('当前服务','Current provider')}</dt><dd>${esc(model.provider || '—')}</dd></div><div><dt>${bi('可用额度','Available capacity')}</dt><dd>${model.capacity === null ? '—' : count(model.capacity)}</dd></div></dl></section></div>
  <footer class="v3-automation-foot"><span>${bi('控制版本','Control revision')} ${esc(model.revision)}</span>${model.updatedAt ? `<time datetime="${esc(model.updatedAt)}">${esc(new Date(model.updatedAt).toLocaleString())}</time>` : ''}<button class="btn btn-ghost-primary" type="button" data-automation-refresh>${bi('刷新状态','Refresh status')}</button></footer>`;
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

function syncQueueLabels() {
  document.documentElement.dataset.acquisitionMode = model.enabled ? 'auto' : 'manual';
  const title = $('#contact-queue-title');
  const nav = $('[data-app-nav="contact-queue"] .bi');
  const workbench = $('#outreach-workbench-title');
  const labels = model.enabled ? ['自动首封联系','Auto first-touch'] : ['开发信审核','First-touch review'];
  for (const target of [title,nav]) if (target) target.innerHTML = `<span lang="zh-CN">${labels[0]}</span><span lang="en">${labels[1]}</span>`;
  if (workbench) workbench.innerHTML = model.enabled ? bi('自动首封联系队列','Auto First-touch Queue') : bi('邮件联系工作台','Email Contact Workbench');
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
      host.innerHTML = `<div class="v3-automation-error" role="alert"><div><strong>${bi('运营控制暂未返回','Operations control unavailable')}</strong><span>${bi('请刷新状态后重试','Refresh status to retry')}</span></div><button class="btn btn-outline-primary" type="button" data-automation-refresh>${bi('重试','Retry')}</button></div>`;
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

export function mountAutomationControl() {
  ensurePanels();
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
