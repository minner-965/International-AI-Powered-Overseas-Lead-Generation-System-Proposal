import { managementRequest } from '../phase7-ui.js';
import { phase8StatusMarkup } from './status.js';

const host = document.querySelector('#contact-queue-list');
const status = document.querySelector('#contact-queue-status');
let loaded = false;
const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const rows = payload => Array.isArray(payload) ? payload : payload?.items || [];
const date = value => value ? new Date(value).toLocaleString() : '-';

function emptyState() {
  return `<div class="p8-empty-state"><i class="ti ti-address-book-off" aria-hidden="true"></i><h3>${bi('当前没有待联系记录', 'No approved contacts are queued')}</h3><p>${bi('业务机会通过联系就绪门槛并由管理人员确认后，才会进入这里。', 'An opportunity appears here only after contact readiness and management approval.')}</p><button class="btn btn-outline-primary" type="button" data-open-view="opportunities">${bi('查看业务机会', 'Open Opportunities')}</button></div>`;
}

function render(items) {
  if (!host) return;
  host.innerHTML = items.length ? items.map(item => `<article class="crm-contact-queue-row">
    <div><strong>${esc(item.company_name || '-')}</strong><span class="crm-row-secondary">${esc(item.country_code || '-')} / ${esc(item.product_profile || '-')}</span></div>
    <div><small>${bi('队列状态', 'Queue status')}</small>${phase8StatusMarkup(item.queue_status || 'ACTIVE')}</div>
    <div><small>${bi('负责人', 'Owner')}</small><span>${esc(item.owner_identity || '-')}</span></div>
    <div><small>${bi('确认记录', 'Management approval')}</small><span>${esc(item.approved_by || '-')}</span><span class="crm-row-secondary">${esc(date(item.approved_at))}</span></div>
    <div><small>${bi('下一步', 'Next action')}</small><button class="btn btn-outline-primary" type="button" data-open-view="companies">${bi('查看客户主档', 'View company')}</button></div>
  </article>`).join('') : emptyState();
  host.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-app-nav="${button.dataset.openView}"]`)?.click()));
}

export async function loadContactQueue({ force = false } = {}) {
  if (!host || (loaded && !force)) return;
  host.setAttribute('aria-busy', 'true');
  if (status) status.innerHTML = bi('正在读取待联系记录', 'Loading Contact Queue');
  try {
    const payload = await managementRequest('/api/contact-queue');
    render(rows(payload));
    loaded = true;
    if (status) status.innerHTML = bi(`当前 ${rows(payload).length} 条待联系记录`, `${rows(payload).length} active queue items`);
  } catch (error) {
    host.innerHTML = `<div class="p8-empty-state"><i class="ti ti-alert-triangle" aria-hidden="true"></i><h3>${bi('待联系记录读取未完成', 'Contact Queue could not be loaded')}</h3><p>${bi('请确认管理访问后重试。', 'Confirm management access and try again.')}</p><button id="contact-queue-retry" class="btn btn-outline-primary" type="button">${bi('重试', 'Try again')}</button></div>`;
    host.querySelector('#contact-queue-retry')?.addEventListener('click', () => loadContactQueue({ force: true }));
    if (status) status.textContent = '';
  } finally {
    host.removeAttribute('aria-busy');
  }
}

document.addEventListener('crm:viewchange', event => {
  if (event.detail?.view === 'contact-queue') loadContactQueue();
});

if (location.hash === '#contact-queue') loadContactQueue();
