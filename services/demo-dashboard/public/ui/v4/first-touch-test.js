// 发测试首封 / Send test first email (B2). Any element with [data-first-touch-test-open] opens the
// dialog (optionally data-company-id="<uuid>"); #first-touch-test-root, when present, shows today's
// remaining tests and the recent ones. Preview first, then send: subject "[TEST] …", only to the
// sender's own mailbox (SIM: also the test list), at most 10 a day, outside the market send window.
// API: GET /api/first-touch/test-sends, POST /api/first-touch/test-sends/preview, POST /api/first-touch/test-sends.
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';
import { TEMPLATES, previewMarkup, reasonText, attachPreviewTranslation } from './manual-company.js';

const API = '/api/first-touch/test-sends';
const json = (url, body) => managementRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const SEND_STATUS = Object.freeze({ PROVIDER_ACCEPTED: ['已发出', 'Sent', 'ok'], SENDING: ['发送中', 'Sending', 'info'], FAILED: ['发送失败', 'Send failed', 'bad'], BLOCKED: ['未发出', 'Not sent', 'bad'], AMBIGUOUS: ['结果待确认', 'Unconfirmed', 'warn'] });
const TEST_REASONS = Object.freeze({
  TEST_SEND_DAILY_LIMIT: ['今天的测试信已达 10 封上限', 'The 10 test emails for today are used'],
  TEST_RECIPIENT_NOT_ALLOWED: ['测试信只能发到自己的邮箱或测试收件名单', 'Tests go only to your own mailbox or the test list'],
  PREVIEW_CHANGED: ['内容已变化，请重新预览', 'The content changed; preview again'],
  COMPANY_NOT_FOUND: ['找不到这家公司', 'Company not found']
});
export const testErrorText = error => TEST_REASONS[error?.code] || reasonText(error);
const state = { status: null, companies: null, preview: null, opener: null, companyId: '' };

/** Remaining tests today, e.g. "今日还可发 7 封 / 7 left today". */
export const remainingMarkup = status => status ? `<span class="v4-test-remaining">${bi(`今日还可发 ${status.remaining_today} 封（每天最多 ${status.daily_limit} 封）`, `${status.remaining_today} left today (max ${status.daily_limit})`)}</span>` : '';
export function historyMarkup(items = []) {
  if (!items.length) return `<p class="meta">${bi('还没有发过测试信', 'No test emails yet')}</p>`;
  return `<ul class="v4-test-history">${items.map(item => { const [zh, en, tone] = SEND_STATUS[item.send_status] || [item.send_status, item.send_status, '']; return `<li><span class="pill ${tone}">${bi(zh, en)}</span><span class="v4-test-subject">${esc(item.subject)}</span><span class="meta">${esc(item.recipient)} · ${esc(new Date(item.created_at).toLocaleString('zh-CN'))}</span></li>`; }).join('')}</ul>`;
}

function dialog() {
  let box = document.getElementById('first-touch-test-dialog');
  if (box) return box;
  box = document.createElement('dialog'); box.id = 'first-touch-test-dialog'; box.className = 'sheet v4-test-sheet'; box.setAttribute('aria-labelledby', 'first-touch-test-title');
  document.body.append(box);
  box.addEventListener('click', event => {
    if (event.target === box || event.target.closest('[data-test-close]')) box.close();
    else if (event.target.closest('[data-test-preview]')) void preview();
  });
  box.addEventListener('change', () => { state.preview = null; renderPreview(); });
  box.addEventListener('submit', event => { event.preventDefault(); void send(); });
  box.addEventListener('close', () => state.opener?.focus?.({ preventScroll: true }));
  return box;
}
const field = (id, zh, en, input) => `<div class="field"><label for="${id}">${bi(zh, en)}</label>${input}</div>`;

function renderPreview() {
  const box = document.getElementById('first-touch-test-dialog'); if (!box) return;
  const host = box.querySelector('[data-test-preview-host]'); const sendButton = box.querySelector('[type="submit"]');
  if (host) host.innerHTML = state.preview ? `${previewMarkup({ to: box.querySelector('[name="recipient"]')?.value || '', subject: state.preview.subject, body: state.preview.body_text })}${state.preview.variables_source !== 'COMPANY' ? `<p class="meta">${bi('部分内容使用示例公司资料填充。', 'Some values use sample company details.')}</p>` : ''}<div class="v4-translate-host" data-test-translate></div>` : `<p class="meta">${bi('点“预览”查看完整邮件，确认后再发送。', 'Use “Preview” to read the full email before sending.')}</p>`;
  if (state.preview) attachPreviewTranslation(host?.querySelector('[data-test-translate]'), state.preview);
  if (sendButton) sendButton.disabled = !state.preview || state.status?.remaining_today === 0;
}

export async function openFirstTouchTest({ companyId = '' } = {}) {
  const box = dialog(); state.opener = document.activeElement; state.preview = null; state.companyId = companyId;
  box.innerHTML = `<div class="sheet-head"><h3 id="first-touch-test-title">${bi('发测试首封', 'Send test first email')}</h3><button class="btn btn-icon" type="button" data-test-close aria-label="关闭 Close"${tip('关闭', 'Close')}><i class="ti ti-x" aria-hidden="true"></i></button></div><div class="sheet-body">${stateBlock('loading', '正在读取', 'Loading')}</div>`;
  if (!box.open) box.showModal();
  try {
    const [status, companies] = await Promise.all([managementRequest(API), state.companies ? Promise.resolve(state.companies) : managementRequest('/api/manual-companies').then(r => r?.items || []).catch(() => [])]);
    state.status = status; state.companies = companies;
  } catch (error) {
    box.querySelector('.sheet-body').innerHTML = `<p role="alert">${bi(...testErrorText(error))}</p>`; return;
  }
  const recipients = (state.status.allowed_recipients || []).map(email => `<option value="${esc(email)}">${esc(email)}</option>`).join('');
  const companyOptions = `<option value="">示例公司资料 / Sample company details</option>${state.companies.map(c => `<option value="${esc(c.id)}"${c.id === companyId ? ' selected' : ''}>${esc(c.company_name)}</option>`).join('')}`;
  box.innerHTML = `<form method="dialog" class="v4-test-form" novalidate><div class="sheet-head"><h3 id="first-touch-test-title">${bi('发测试首封', 'Send test first email')}</h3><button class="btn btn-icon" type="button" data-test-close aria-label="关闭 Close"${tip('关闭，不发送', 'Close without sending')}><i class="ti ti-x" aria-hidden="true"></i></button></div>
    <div class="sheet-body"><p class="meta">${bi('使用真实开发信模板，主题前加 [TEST]，立即发出；不占发信额度，不计入“已联系”。', 'Uses the real first-email template with [TEST] in the subject and sends at once; no quota use, not counted as contacted.')} ${remainingMarkup(state.status)}</p>
    <div class="form-grid">${field('test-template', '模板', 'Template', `<select id="test-template" name="template_key">${Object.entries(TEMPLATES).map(([key, [zh, en]]) => `<option value="${esc(key || 'AUTO')}">${esc(zh)} / ${esc(en)}</option>`).join('')}</select>`)}${field('test-company', '公司资料', 'Company details', `<select id="test-company" name="company_id">${companyOptions}</select>`)}${field('test-recipient', '收件人', 'Recipient', `<select id="test-recipient" name="recipient" required>${recipients}</select>`)}</div>
    <button class="btn" type="button" data-test-preview${tip('生成邮件预览，不发送', 'Build the preview; nothing is sent')}><i class="ti ti-eye" aria-hidden="true"></i>${bi('预览', 'Preview')}</button>
    <div data-test-preview-host class="v4-test-preview"></div><p class="v4-form-status" role="status" aria-live="polite"></p></div>
    <div class="sheet-foot"><button class="btn" type="button" data-test-close${tip('关闭，不发送', 'Close without sending')}>${bi('取消', 'Cancel')}</button><button class="btn btn-primary" type="submit" disabled${tip('把预览中的测试信立即发出', 'Send the previewed test email now')}>${bi('发送测试信', 'Send test email')}</button></div></form>`;
  renderPreview();
  box.querySelector('select')?.focus();
}

const formBody = box => { const form = box.querySelector('form'); return { template_key: form.template_key.value, ...(form.company_id.value ? { company_id: form.company_id.value } : {}), recipient: form.recipient.value }; };
async function preview() {
  const box = dialog(); const status = box.querySelector('.v4-form-status');
  status.innerHTML = bi('正在生成预览', 'Building the preview');
  try { const body = formBody(box); state.preview = await json(`${API}/preview`, body); state.status = { ...state.status, remaining_today: state.preview.remaining_today }; status.innerHTML = ''; }
  catch (error) { state.preview = null; status.innerHTML = bi(...testErrorText(error)); }
  renderPreview();
}
async function send() {
  const box = dialog(); const status = box.querySelector('.v4-form-status'); const button = box.querySelector('[type="submit"]');
  if (!state.preview) return;
  button.disabled = true; status.innerHTML = bi('正在发送', 'Sending');
  try {
    const result = await json(API, { ...formBody(box), content_hash: state.preview.content_hash });
    box.close();
    if (result?.ok) toast('测试信已发出，请查收', 'Test email sent; check the inbox'); else toast('测试信未发出，请检查发信邮箱', 'Test email not sent; check the mailbox', { tone: 'warn' });
    void loadTestPanel();
  } catch (error) { status.innerHTML = bi(...testErrorText(error)); button.disabled = false; }
}

export async function loadTestPanel() {
  const root = document.getElementById('first-touch-test-root'); if (!root) return;
  try { const status = await managementRequest(API); root.innerHTML = `<section class="card v4-test-card"><div class="toolbar"><h3>${bi('测试首封', 'Test first emails')}</h3><span class="grow"></span>${remainingMarkup(status)}<button class="btn btn-primary" type="button" data-first-touch-test-open${tip('用真实开发信模板给自己的邮箱发一封测试信', 'Send a test of the real first email to your own mailbox')}><i class="ti ti-mail-forward" aria-hidden="true"></i>${bi('发测试首封', 'Send test first email')}</button></div>${historyMarkup(status.items)}</section>`; }
  catch (error) { root.innerHTML = `<section class="card v4-test-card">${error?.status === 409 ? `<p class="meta">${bi('绑定并测试发信邮箱后即可发测试首封。', 'Bind and test the sending mailbox to send test emails.')}</p>` : stateBlock('error', '测试信记录暂未读取', 'Test emails unavailable')}</section>`; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-first-touch-test-open]');
    if (trigger) { event.preventDefault(); void openFirstTouchTest({ companyId: trigger.dataset.companyId || '' }); }
  });
  sessionReady.then(() => void loadTestPanel());
}
