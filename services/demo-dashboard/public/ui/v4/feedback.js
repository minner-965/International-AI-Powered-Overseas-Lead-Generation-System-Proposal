// 意见反馈 / Feedback: a floating button on every page (bottom-right on desktop, small button above
// the phone tab bar, and inside 我的), a dialog that attaches the current page, POST /api/feedback.
// Admins read and close feedback in the 意见反馈 inbox (GET/PATCH /api/admin/feedback).
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { session, sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';
import { setNavCount } from '../../crm-shell.js';

const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/** "页面标题 (#hash)" so SIM knows where the merchant was. */
export function currentPage(doc = document, loc = location) {
  const title = (doc.querySelector('#page-heading [lang="zh-CN"]')?.textContent || doc.title || '').trim();
  return `${title}${loc.hash ? ` (${loc.hash})` : ''}`.slice(0, 500);
}

let opener = null;
function dialog() {
  let box = document.getElementById('feedback-dialog');
  if (box) return box;
  box = document.createElement('dialog'); box.id = 'feedback-dialog'; box.className = 'sheet'; box.setAttribute('aria-labelledby', 'feedback-title');
  box.innerHTML = `<form method="dialog" novalidate><div class="sheet-head"><h3 id="feedback-title">${bi('意见反馈', 'Feedback')}</h3><button class="btn btn-icon" type="button" data-feedback-close aria-label="关闭 Close"${tip('关闭，不发送', 'Close without sending')}><i class="ti ti-x" aria-hidden="true"></i></button></div>
    <div class="sheet-body"><p class="meta">${bi('遇到问题、有建议，或想开通、续期，都可以直接告诉 SIM。', 'Tell SIM about a problem, an idea, or activation and renewal.')}</p>
    <div class="field"><label for="feedback-message">${bi('您想说的', 'Your message')}</label><textarea id="feedback-message" name="message" maxlength="4000" rows="5" required placeholder="例如：客户名录里某家公司资料不对 / e.g. a company's details are wrong"></textarea></div>
    <p class="meta v4-feedback-page"></p><p class="v4-form-status" role="status" aria-live="polite"></p></div>
    <div class="sheet-foot"><button class="btn" type="button" data-feedback-close${tip('取消，不发送', 'Cancel without sending')}>${bi('取消', 'Cancel')}</button><button class="btn btn-primary" type="submit"${tip('把留言和当前页面一起发给 SIM', 'Send the message with the current page to SIM')}><i class="ti ti-send" aria-hidden="true"></i>${bi('发送', 'Send')}</button></div></form>`;
  document.body.append(box);
  box.addEventListener('click', event => { if (event.target === box || event.target.closest('[data-feedback-close]')) box.close(); });
  box.addEventListener('close', () => opener?.focus?.({ preventScroll: true }));
  box.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target; const status = form.querySelector('.v4-form-status'); const message = form.message.value.trim();
    if (!message) { status.innerHTML = bi('请先写下您的问题或建议', 'Write your message first'); form.message.focus(); return; }
    const button = form.querySelector('[type="submit"]'); button.disabled = true; status.innerHTML = bi('正在发送', 'Sending');
    try { await json('/api/feedback', { page: box.dataset.page, message }); box.close(); form.reset(); status.textContent = ''; toast('已发送，谢谢！SIM 会尽快处理', 'Sent. Thank you — SIM will follow up'); }
    catch (error) { status.innerHTML = bi(...(error.status === 404 ? ['反馈服务暂未开放，请直接联系 SIM', 'Feedback is not available yet; contact SIM directly'] : ['发送未完成，请重试', 'Could not send; please retry'])); }
    finally { button.disabled = false; }
  });
  return box;
}

export function openFeedback(from = document.activeElement) {
  opener = from;
  const box = dialog();
  box.dataset.page = currentPage();
  box.querySelector('.v4-feedback-page').innerHTML = bi(`会附上当前页面：${box.dataset.page}`, 'The current page is attached');
  if (!box.open) box.showModal();
  box.querySelector('textarea').focus();
}

// ---------- Admin inbox ----------
const inbox = { status: 'OPEN', items: null, error: false };
function inboxMarkup() {
  if (inbox.error) return stateBlock('error', '意见反馈暂未读取', 'Feedback unavailable', { retry: true });
  if (!inbox.items) return skeletonRows(3);
  if (!inbox.items.length) return stateBlock('empty', inbox.status === 'OPEN' ? '没有待处理的反馈' : '没有反馈', inbox.status === 'OPEN' ? 'No open feedback' : 'No feedback');
  return `<ul class="v4-feedback-list">${inbox.items.map(item => `<li class="${item.status === 'DONE' ? 'is-done' : ''}"><div class="v4-feedback-head"><b>${esc(item.merchant?.company_name || 'SIM')}</b><span class="meta">${esc(item.user_email || '')} · ${esc(item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '')}</span>${item.status === 'DONE' ? `<span class="pill ok">${bi('已处理', 'Done')}</span>` : `<span class="pill warn">${bi('待处理', 'Open')}</span>`}</div><p class="v4-feedback-msg">${esc(item.message)}</p><div class="v4-feedback-foot"><span class="meta">${bi('页面', 'Page')}：${esc(item.page || '—')}</span>${item.status === 'DONE' ? `<button class="btn btn-sm" type="button" data-feedback-status="OPEN" data-feedback-id="${esc(item.id)}"${tip('重新标记为待处理', 'Mark as open again')}>${bi('重新打开', 'Reopen')}</button>` : `<button class="btn btn-sm btn-primary" type="button" data-feedback-status="DONE" data-feedback-id="${esc(item.id)}"${tip('处理完后标记，商家的反馈会移到已处理', 'Mark handled; it moves to done')}><i class="ti ti-check" aria-hidden="true"></i>${bi('标记已处理', 'Mark done')}</button>`}</div></li>`).join('')}</ul>`;
}
function renderInbox() {
  const list = document.getElementById('feedback-inbox-list'); if (list) list.innerHTML = inboxMarkup();
  document.querySelectorAll('[data-feedback-filter]').forEach(tab => { const on = tab.dataset.feedbackFilter === inbox.status; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
}
export async function loadInbox() {
  inbox.error = false;
  try { inbox.items = (await managementRequest(`/api/admin/feedback?status=${inbox.status}`))?.items || []; if (inbox.status === 'OPEN') setNavCount('feedback', inbox.items.length); }
  catch { inbox.error = true; inbox.items = null; }
  renderInbox();
}
function mountInbox() {
  const root = document.getElementById('feedback-inbox-root');
  if (!root) return;
  root.innerHTML = `<section class="card"><div class="toolbar"><div class="tabs" role="tablist" aria-label="反馈状态 Feedback status">${[['OPEN', '待处理', 'Open'], ['DONE', '已处理', 'Done'], ['ALL', '全部', 'All']].map(([key, zh, en]) => `<button type="button" role="tab" data-feedback-filter="${key}" aria-selected="${key === 'OPEN'}"${tip(`只看${zh}的反馈`, `Show ${en.toLowerCase()} feedback`)}>${bi(zh, en)}</button>`).join('')}</div></div><div id="feedback-inbox-list" aria-live="polite"></div></section>`;
  renderInbox();
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-state-retry]')) { void loadInbox(); return; }
    const filter = event.target.closest('[data-feedback-filter]');
    if (filter) { inbox.status = filter.dataset.feedbackFilter; inbox.items = null; renderInbox(); void loadInbox(); return; }
    const mark = event.target.closest('[data-feedback-status]');
    if (!mark) return;
    mark.disabled = true;
    try { await json(`/api/admin/feedback/${encodeURIComponent(mark.dataset.feedbackId)}`, { status: mark.dataset.feedbackStatus }, 'PATCH'); toast('已更新', 'Updated'); void loadInbox(); }
    catch { mark.disabled = false; toast('更新未完成，请重试', 'Could not update; retry', { tone: 'bad' }); }
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'feedback-inbox') void loadInbox(); });
}

if (typeof document !== 'undefined' && document.getElementById('main-content')) {
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'v4-feedback-fab'; fab.dataset.feedbackOpen = '';
  fab.dataset.tip = '有问题或建议？直接发给 SIM，会自动带上当前页面|Questions or ideas? Send them to SIM with this page attached';
  fab.setAttribute('aria-label', '意见反馈 Feedback');
  fab.innerHTML = `<i class="ti ti-message-dots" aria-hidden="true"></i><span class="bi"><span lang="zh-CN">意见反馈</span><span lang="en">Feedback</span></span>`;
  document.body.append(fab);
  document.addEventListener('click', event => { const open = event.target.closest('[data-feedback-open]'); if (open) { event.preventDefault(); openFeedback(open); } });
  mountInbox();
  sessionReady.then(user => { if (user.role === 'ADMIN' && session.authEnabled) void loadInbox(); if (!document.getElementById('view-feedback-inbox')?.hidden) void loadInbox(); });
}
