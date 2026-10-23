// 商家管理 / Merchants (role ADMIN): list with status, trial / paid period, usage and referral;
// open a merchant account (temporary password shown once), extend trial, mark paid, disable,
// restore, reset password, edit quotas and features. GET/POST/PATCH /api/admin/merchants.
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { session, sessionReady } from './session.js';
import { statusPill, dateText } from './account.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const $ = (selector, root = document) => root.querySelector(selector);
const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
export const FILTERS = Object.freeze([['', '全部', 'All'], ['TRIAL', '试用中', 'Trial'], ['ACTIVE', '已开通', 'Active'], ['EXPIRED', '已到期', 'Expired'], ['DISABLED', '已停用', 'Disabled']]);
export const FEATURES = Object.freeze([['research', '找客户（研究任务）', 'Prospect search'], ['email', '发送邮件', 'Email sending'], ['crm_sync', '同步到飞书表', 'CRM sync']]);
const DEFAULT_QUOTAS = { monthly_searches: 200, daily_emails: 30 };
const state = { items: null, error: false, status: '', q: '', dialogFor: null };

/** Referral tree: who referred whom, by merchant id. */
export function referralIndex(items) {
  const children = new Map();
  for (const item of items || []) { const parent = item.referred_by?.id; if (parent) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(item); } }
  return children;
}
/** Restoring a disabled merchant returns it to the state its dates allow. */
export function restoreStatus(item, now = new Date()) {
  if (item.paid_until && new Date(item.paid_until) > now) return 'ACTIVE';
  if (item.trial_ends_at && new Date(item.trial_ends_at) > now) return 'TRIAL';
  return 'EXPIRED';
}
export function filterMerchants(items, { status = '', q = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return (items || []).filter(item => (!status || item.status === status) && (!needle || [item.company_name, item.contact_name, item.login_email].some(value => String(value || '').toLowerCase().includes(needle))));
}

const usageText = (used, limit) => `${used ?? '—'} / ${limit ?? '—'}`;
function periodCell(item) {
  if (item.status === 'TRIAL' || (!item.paid_until && item.trial_ends_at)) return `${bi('试用到', 'Trial ends')} <b>${esc(dateText(item.trial_ends_at))}</b>`;
  if (item.paid_until) return `${bi('付费到', 'Paid until')} <b>${esc(dateText(item.paid_until))}</b>`;
  return '—';
}
function referralCell(item, children) {
  const kids = children.get(item.id) || [];
  return `${item.referred_by ? `<span class="v4-ref-up">${bi('推荐人', 'Referred by')} ${esc(item.referred_by.company_name)}</span>` : ''}${kids.length ? `<span class="v4-ref-down"><i class="ti ti-arrow-elbow-right" aria-hidden="true"></i>${bi(`推荐了 ${kids.length} 家`, `Referred ${kids.length}`)}：${kids.map(kid => esc(kid.company_name)).join('、')}</span>` : ''}${!item.referred_by && !kids.length ? '<span class="meta">—</span>' : ''}${item.referral_code ? `<code class="v4-ref-code">${esc(item.referral_code)}</code>` : ''}`;
}
function actions(item) {
  const id = esc(item.id);
  const disabled = item.status === 'DISABLED';
  return `<div class="v4-row-actions">
    <button class="btn btn-sm" type="button" data-merchant-action="extend" data-merchant-id="${id}"${tip('把试用期往后延长几天', 'Extend the trial by some days')}>${bi('延长试用', 'Extend trial')}</button>
    <button class="btn btn-sm" type="button" data-merchant-action="paid" data-merchant-id="${id}"${tip('标记为已付费并设置服务到期日', 'Mark as paid and set the end date')}>${bi('标记已付费', 'Mark paid')}</button>
    <button class="btn btn-sm" type="button" data-merchant-action="quotas" data-merchant-id="${id}"${tip('修改每月找客户次数、每日发信数和可用功能', 'Edit monthly searches, daily emails and features')}>${bi('编辑额度与功能', 'Quotas & features')}</button>
    <button class="btn btn-sm" type="button" data-merchant-action="reset" data-merchant-id="${id}"${tip('生成新的临时密码，商家下次登录时需修改', 'Create a new temporary password; the merchant changes it at next sign-in')}>${bi('重置密码', 'Reset password')}</button>
    ${disabled ? `<button class="btn btn-sm btn-outline-primary" type="button" data-merchant-action="restore" data-merchant-id="${id}"${tip('恢复这个账号，商家可以重新登录', 'Restore the account so the merchant can sign in')}>${bi('恢复', 'Restore')}</button>` : `<button class="btn btn-sm btn-danger" type="button" data-merchant-action="disable" data-merchant-id="${id}"${tip('停用后商家不能登录，资料保留', 'The merchant cannot sign in; data is kept')}>${bi('停用', 'Disable')}</button>`}
  </div>`;
}

function listMarkup() {
  if (state.error) return stateBlock('error', '商家列表暂未读取', 'Merchants unavailable', { retry: true });
  if (!state.items) return skeletonRows(4);
  const items = filterMerchants(state.items, state);
  if (!state.items.length) return stateBlock('empty', '还没有商家账号，点“新建商家账号”开通第一个', 'No merchants yet; open the first account');
  if (!items.length) return stateBlock('empty', '没有符合条件的商家', 'No matching merchant');
  const children = referralIndex(state.items);
  return `<div class="table-wrap"><table class="v4-merchant-table"><caption class="sr-only">商家 Merchants</caption><thead><tr><th scope="col">${bi('商家', 'Merchant')}</th><th scope="col">${bi('状态', 'Status')}</th><th scope="col">${bi('试用 / 付费期', 'Period')}</th><th scope="col">${bi('用量', 'Usage')}</th><th scope="col">${bi('推荐关系', 'Referrals')}</th><th scope="col">${bi('操作', 'Actions')}</th></tr></thead><tbody>${items.map(item => `<tr data-merchant-row="${esc(item.id)}">
    <td class="m-main"><span class="co">${esc(item.company_name)}</span><span class="meta">${esc(item.contact_name || '')}${item.contact_name ? ' · ' : ''}${esc(item.login_email || '')}</span></td>
    <td class="m-side">${statusPill(item.status)}</td>
    <td>${periodCell(item)}</td>
    <td class="v4-usage-cell"><span>${bi('本月搜索', 'Searches')} <b>${usageText(item.usage?.searches_this_month, item.quotas?.monthly_searches)}</b></span><span>${bi('今日发信', 'Emails today')} <b>${usageText(item.usage?.emails_today, item.quotas?.daily_emails)}</b></span><span>${bi('线索', 'Leads')} <b>${item.usage?.leads ?? '—'}</b> · ${bi('最近登录', 'Last sign-in')} ${esc(item.usage?.last_login_at ? dateText(item.usage.last_login_at) : '—')}</span></td>
    <td class="v4-ref-cell">${referralCell(item, children)}</td>
    <td class="m-actions">${actions(item)}</td></tr>`).join('')}</tbody></table></div>`;
}

function render() {
  const list = $('#merchants-list');
  if (list) list.innerHTML = listMarkup();
  const count = $('#merchants-count');
  if (count && state.items) { const by = code => state.items.filter(item => item.status === code).length; count.innerHTML = bi(`共 ${state.items.length} 家 · 试用 ${by('TRIAL')} · 已开通 ${by('ACTIVE')} · 已到期 ${by('EXPIRED')}`, `${state.items.length} merchants · ${by('TRIAL')} trial · ${by('ACTIVE')} active · ${by('EXPIRED')} expired`); }
  document.querySelectorAll('[data-merchant-filter]').forEach(tab => { const on = tab.dataset.merchantFilter === state.status; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
}

export async function loadMerchants() {
  state.error = false;
  try { state.items = (await managementRequest('/api/admin/merchants'))?.items || []; }
  catch { state.error = true; state.items = null; }
  render();
}

// ---------- Dialog (create, extend, paid, quotas, reset, result) ----------
function dialog() {
  let box = document.getElementById('merchant-dialog');
  if (box) return box;
  box = document.createElement('dialog'); box.id = 'merchant-dialog'; box.className = 'sheet'; box.setAttribute('aria-labelledby', 'merchant-dialog-title');
  document.body.append(box);
  box.addEventListener('click', event => { if (event.target === box || event.target.closest('[data-merchant-close]')) box.close(); });
  box.addEventListener('close', () => state.opener?.focus?.({ preventScroll: true }));
  return box;
}
const field = (id, zh, en, input, cls = '') => `<div class="field${cls ? ` ${cls}` : ''}"><label for="${id}">${bi(zh, en)}</label>${input}</div>`;
const quotaFields = (quotas = DEFAULT_QUOTAS, features = {}) => `<div class="form-grid">${field('merchant-q-search', '每月找客户次数', 'Monthly searches', `<input id="merchant-q-search" name="monthly_searches" type="number" inputmode="numeric" min="0" max="100000" value="${esc(quotas.monthly_searches ?? DEFAULT_QUOTAS.monthly_searches)}">`)}${field('merchant-q-email', '每日发信数', 'Daily emails', `<input id="merchant-q-email" name="daily_emails" type="number" inputmode="numeric" min="0" max="10000" value="${esc(quotas.daily_emails ?? DEFAULT_QUOTAS.daily_emails)}">`)}</div>
  <fieldset class="field"><legend class="lbl">${bi('可用功能', 'Features')}</legend><div class="v4-choice-grid">${FEATURES.map(([key, zh, en]) => `<label class="v4-choice"><input type="checkbox" name="feature_${key}"${features[key] === false ? '' : ' checked'}><span>${esc(zh)}<small>${esc(en)}</small></span></label>`).join('')}</div></fieldset>`;
const sheet = (title, body, submit, submitTip) => `<form method="dialog" class="v4-merchant-form" novalidate><div class="sheet-head"><h3 id="merchant-dialog-title">${title}</h3><button class="btn btn-icon" type="button" data-merchant-close aria-label="关闭 Close"${tip('关闭，不保存', 'Close without saving')}><i class="ti ti-x" aria-hidden="true"></i></button></div><div class="sheet-body">${body}<p class="v4-form-status" role="status" aria-live="polite"></p></div><div class="sheet-foot"><button class="btn" type="button" data-merchant-close${tip(...(submit ? ['取消，不保存', 'Cancel without saving'] : ['关闭窗口；临时密码不会再显示', 'Close; the temporary password will not be shown again']))}>${submit ? bi('取消', 'Cancel') : bi('完成', 'Done')}</button>${submit ? `<button class="btn btn-primary" type="submit"${tip(...submitTip)}>${submit}</button>` : ''}</div></form>`;
const isoDate = date => date.toISOString().slice(0, 10);

export function passwordResultMarkup({ email, password, created = false }) {
  const loginUrl = `${location.origin}/login.html`;
  const text = `登录地址 Sign-in: ${loginUrl}\n登录邮箱 Email: ${email}\n临时密码 Temporary password: ${password}`;
  return `<div class="v4-temp-password"><p>${bi(created ? '账号已开通。请把下面的登录信息发给商家；临时密码只显示这一次。' : '已生成新的临时密码，只显示这一次。', created ? 'Account opened. Send these details to the merchant; the password is shown only once.' : 'A new temporary password was created; it is shown only once.')}</p>
    <dl class="facts"><div><dt>${bi('登录地址', 'Sign-in page')}</dt><dd>${esc(loginUrl)}</dd></div><div><dt>${bi('登录邮箱', 'Email')}</dt><dd>${esc(email)}</dd></div><div><dt>${bi('临时密码', 'Temporary password')}</dt><dd><code class="v4-password-code">${esc(password)}</code></dd></div></dl>
    <button class="btn btn-primary" type="button" data-copy-text="${esc(text)}"${tip('复制登录地址、邮箱和临时密码，发给商家', 'Copy the sign-in details for the merchant')}><i class="ti ti-copy" aria-hidden="true"></i>${bi('复制登录信息', 'Copy sign-in details')}</button>
    <p class="meta">${bi('商家首次登录后需要修改密码。', 'The merchant must change it at first sign-in.')}</p></div>`;
}

function open(kind, item = null) {
  const box = dialog(); state.dialogFor = { kind, item }; state.opener = document.activeElement;
  const name = item ? esc(item.company_name) : '';
  if (kind === 'create') {
    const referrers = (state.items || []).map(m => `<option value="${esc(m.id)}">${esc(m.company_name)}</option>`).join('');
    box.innerHTML = sheet(bi('新建商家账号', 'Open a merchant account'), `<div class="form-grid">${field('merchant-company', '公司名称', 'Company', '<input id="merchant-company" name="company_name" maxlength="200" required>')}${field('merchant-contact', '联系人', 'Contact person', '<input id="merchant-contact" name="contact_name" maxlength="120">')}${field('merchant-email', '登录邮箱', 'Sign-in email', '<input id="merchant-email" name="login_email" type="email" maxlength="200" required>')}${field('merchant-trial', '试用天数', 'Trial days', '<input id="merchant-trial" name="trial_days" type="number" inputmode="numeric" min="1" max="365" value="7">')}${field('merchant-referrer', '推荐人（可选）', 'Referred by (optional)', `<select id="merchant-referrer" name="referred_by_merchant_id"><option value="">无 None</option>${referrers}</select>`, 'wide')}</div>${quotaFields()}`, bi('开通账号', 'Open account'), ['建立账号并生成临时密码', 'Create the account and a temporary password']);
  } else if (kind === 'extend') {
    box.innerHTML = sheet(bi(`延长试用 · ${item.company_name}`, 'Extend trial'), `<p class="meta">${bi(`当前试用到 ${dateText(item.trial_ends_at)}`, `Trial currently ends ${dateText(item.trial_ends_at)}`)}</p>${field('merchant-extend', '延长天数', 'Days to add', '<input id="merchant-extend" name="extend_trial_days" type="number" inputmode="numeric" min="1" max="365" value="7" required>')}`, bi('延长', 'Extend'), ['保存新的试用到期日', 'Save the new trial end date']);
  } else if (kind === 'paid') {
    const next = new Date(); next.setFullYear(next.getFullYear() + 1);
    box.innerHTML = sheet(bi(`标记已付费 · ${item.company_name}`, 'Mark as paid'), `${field('merchant-paid', '服务到期日', 'Paid until', `<input id="merchant-paid" name="paid_until" type="date" min="${isoDate(new Date())}" value="${esc(item.paid_until ? String(item.paid_until).slice(0, 10) : isoDate(next))}" required>`)}<p class="meta">${bi('到期后账号自动变为只读，资料保留。', 'After this date the account becomes read-only; data is kept.')}</p>`, bi('标记已付费', 'Mark paid'), ['账号改为已开通，到期日如上', 'Set the account to active until this date']);
  } else if (kind === 'quotas') {
    box.innerHTML = sheet(bi(`编辑额度与功能 · ${item.company_name}`, 'Quotas & features'), `<div class="form-grid">${field('merchant-edit-company', '公司名称', 'Company', `<input id="merchant-edit-company" name="company_name" maxlength="200" value="${name}" required>`)}${field('merchant-edit-contact', '联系人', 'Contact person', `<input id="merchant-edit-contact" name="contact_name" maxlength="120" value="${esc(item.contact_name || '')}">`)}</div>${quotaFields(item.quotas || {}, item.features || {})}`, bi('保存', 'Save'), ['保存额度、功能和公司信息', 'Save quotas, features and company details']);
  } else if (kind === 'reset' || kind === 'disable') {
    const reset = kind === 'reset';
    box.innerHTML = sheet(bi(`${reset ? '重置密码' : '停用账号'} · ${item.company_name}`, reset ? 'Reset password' : 'Disable account'), `<p>${bi(...(reset ? ['将生成新的临时密码，原密码立即失效。', 'A new temporary password replaces the current one immediately.'] : ['停用后商家不能登录，资料全部保留，之后可以恢复。', 'The merchant cannot sign in; data is kept and you can restore later.']))}</p>`, bi(reset ? '重置密码' : '确认停用', reset ? 'Reset' : 'Disable'), reset ? ['生成新的临时密码', 'Create a new temporary password'] : ['停用这个商家账号', 'Disable this merchant account']);
  }
  if (!box.open) box.showModal();
  box.querySelector('input, select, button[type="submit"]')?.focus();
}

function quotasFrom(form) {
  return { quotas: { monthly_searches: Number(form.monthly_searches.value), daily_emails: Number(form.daily_emails.value) }, features: Object.fromEntries(FEATURES.map(([key]) => [key, form[`feature_${key}`].checked])) };
}
export function createProblem(body) {
  if (!body.company_name) return ['请填写公司名称', 'Enter the company name'];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.login_email || '')) return ['请填写正确的登录邮箱', 'Enter a valid sign-in email'];
  if (!(body.trial_days >= 1 && body.trial_days <= 365)) return ['试用天数应为 1–365', 'Trial days must be 1–365'];
  if ([body.quotas?.monthly_searches, body.quotas?.daily_emails].some(value => !(value >= 0))) return ['额度应为不小于 0 的数字', 'Quotas must be 0 or more'];
  return null;
}

async function submit(form) {
  const { kind, item } = state.dialogFor || {};
  const status = form.querySelector('.v4-form-status');
  const button = form.querySelector('[type="submit"]');
  const fail = error => { status.innerHTML = bi(...(error?.status === 409 ? ['这个登录邮箱已被使用', 'This sign-in email is already used'] : [400, 422].includes(error?.status) ? ['填写的信息有误，请检查', 'Some details are invalid'] : error?.status === 404 ? ['商家管理服务暂未开放', 'Merchant admin is not available yet'] : ['保存未完成，请重试', 'Could not save; please retry'])); button.disabled = false; };
  button.disabled = true; status.innerHTML = bi('正在保存', 'Saving');
  try {
    if (kind === 'create') {
      const body = { company_name: form.company_name.value.trim(), contact_name: form.contact_name.value.trim() || undefined, login_email: form.login_email.value.trim(), trial_days: Number(form.trial_days.value || 7), referred_by_merchant_id: form.referred_by_merchant_id.value || undefined, ...quotasFrom(form) };
      const problem = createProblem(body); if (problem) { status.innerHTML = bi(...problem); button.disabled = false; return; }
      const result = await json('/api/admin/merchants', body);
      dialog().innerHTML = sheet(bi('商家账号已开通', 'Merchant account opened'), passwordResultMarkup({ email: result?.user?.email || body.login_email, password: result?.temporary_password || '—', created: true }), '', null);
      void loadMerchants(); return;
    }
    if (kind === 'reset') {
      const result = await json(`/api/admin/merchants/${encodeURIComponent(item.id)}/reset-password`);
      dialog().innerHTML = sheet(bi(`新的临时密码 · ${item.company_name}`, 'New temporary password'), passwordResultMarkup({ email: item.login_email, password: result?.temporary_password || '—' }), '', null);
      return;
    }
    const patch = kind === 'extend' ? { extend_trial_days: Number(form.extend_trial_days.value) }
      : kind === 'paid' ? { status: 'ACTIVE', paid_until: form.paid_until.value }
        : kind === 'quotas' ? { company_name: form.company_name.value.trim(), contact_name: form.contact_name.value.trim(), ...quotasFrom(form) }
          : kind === 'disable' ? { status: 'DISABLED' } : null;
    if (kind === 'extend' && !(patch.extend_trial_days >= 1)) { status.innerHTML = bi('请填写延长天数', 'Enter the days to add'); button.disabled = false; return; }
    if (kind === 'paid' && !patch.paid_until) { status.innerHTML = bi('请选择服务到期日', 'Choose the end date'); button.disabled = false; return; }
    await json(`/api/admin/merchants/${encodeURIComponent(item.id)}`, patch, 'PATCH');
    dialog().close(); toast('已保存', 'Saved'); void loadMerchants();
  } catch (error) { fail(error); }
}

function mount() {
  const root = $('#merchants-root');
  if (!root) return;
  root.innerHTML = `<section class="card v4-merchants-card"><div class="toolbar v4-merchants-toolbar"><div class="tabs" role="tablist" aria-label="按状态筛选 Filter by status">${FILTERS.map(([key, zh, en]) => `<button type="button" role="tab" data-merchant-filter="${key}" aria-selected="${key === ''}"${tip(key ? `只看${zh}的商家` : '显示全部商家', key ? `Show ${en.toLowerCase()} merchants` : 'Show every merchant')}>${bi(zh, en)}</button>`).join('')}</div><span class="grow"></span><label class="search inline" for="merchants-search"><i class="ti ti-search" aria-hidden="true"></i><span class="sr-only">搜索商家 Search merchants</span><input id="merchants-search" type="search" autocomplete="off" placeholder="公司、联系人或邮箱 / Company, contact, email"></label><button class="btn btn-primary" type="button" data-merchant-create${tip('为新的供应商或外贸公司开通试用账号', 'Open a trial account for a new supplier')}><i class="ti ti-plus" aria-hidden="true"></i>${bi('新建商家账号', 'New merchant')}</button></div><div id="merchants-list" aria-live="polite"></div></section>`;
  render();
  root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void loadMerchants(); return; }
    const filter = event.target.closest('[data-merchant-filter]');
    if (filter) { state.status = filter.dataset.merchantFilter; render(); return; }
    if (event.target.closest('[data-merchant-create]')) { open('create'); return; }
    const action = event.target.closest('[data-merchant-action]');
    if (!action) return;
    const item = state.items?.find(m => String(m.id) === action.dataset.merchantId);
    if (!item) return;
    if (action.dataset.merchantAction === 'restore') { void json(`/api/admin/merchants/${encodeURIComponent(item.id)}`, { status: restoreStatus(item) }, 'PATCH').then(() => { toast('账号已恢复', 'Account restored'); void loadMerchants(); }).catch(() => toast('恢复未完成，请重试', 'Could not restore; retry', { tone: 'bad' })); return; }
    open(action.dataset.merchantAction, item);
  });
  root.addEventListener('input', event => { if (event.target.id === 'merchants-search') { state.q = event.target.value; render(); } });
  document.addEventListener('submit', event => { if (event.target.closest('#merchant-dialog')) { event.preventDefault(); void submit(event.target); } });
  document.addEventListener('click', async event => {
    const copy = event.target.closest('[data-copy-text]');
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy.dataset.copyText); toast('登录信息已复制', 'Sign-in details copied'); } catch { toast('请手动选中并复制', 'Select and copy it manually', { tone: 'warn' }); }
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'merchants') void loadMerchants(); });
  sessionReady.then(user => { if (user.role === 'ADMIN' && !document.querySelector('#view-merchants')?.hidden) void loadMerchants(); });
}
if (typeof document !== 'undefined') mount();
