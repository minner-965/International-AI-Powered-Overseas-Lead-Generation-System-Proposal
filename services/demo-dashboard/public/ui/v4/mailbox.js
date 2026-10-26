// 绑定发信邮箱 / Sending mailbox: pick a provider preset (fills servers and ports), enter the
// address and password (never shown back), save, test SMTP + IMAP, send a test email to yourself.
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady, session } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const $ = (selector, root = document) => root.querySelector(selector);
const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

// Used until GET /api/merchant/mailbox/presets answers (same hosts as the provider documentation).
export const FALLBACK_PRESETS = Object.freeze([
  { key: 'gmail', label: 'Gmail / Google Workspace', smtp_host: 'smtp.gmail.com', smtp_port: 587, imap_host: 'imap.gmail.com', imap_port: 993, help_url: 'https://support.google.com/mail/answer/185833' },
  { key: 'microsoft365', label: 'Microsoft 365 / Outlook', smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, help_url: 'https://support.microsoft.com/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353' },
  { key: 'zoho', label: 'Zoho Mail', smtp_host: 'smtp.zoho.com', smtp_port: 587, imap_host: 'imap.zoho.com', imap_port: 993, help_url: 'https://www.zoho.com/mail/help/zoho-smtp.html' },
  { key: 'aliyun', label: '阿里企业邮箱', smtp_host: 'smtp.qiye.aliyun.com', smtp_port: 587, imap_host: 'imap.qiye.aliyun.com', imap_port: 993, help_url: '' },
  { key: 'tencent', label: '腾讯企业邮箱', smtp_host: 'smtp.exmail.qq.com', smtp_port: 587, imap_host: 'imap.exmail.qq.com', imap_port: 993, help_url: '' },
  { key: 'netease', label: '网易企业邮箱', smtp_host: 'smtp.qiye.163.com', smtp_port: 587, imap_host: 'imap.qiye.163.com', imap_port: 993, help_url: '' },
  { key: 'other', label: '其他邮箱', smtp_host: '', smtp_port: 587, imap_host: '', imap_port: 993, help_url: '' }
]);

const HELP = {
  gmail: ['Gmail 需要先开启两步验证，再生成“应用专用密码”（16 位），把它填在密码栏，不能用平时登录的密码。', 'Gmail needs 2-step verification and an app password (16 characters); your normal password will not work.'],
  microsoft: ['Microsoft 365 需要管理员为该邮箱开启“SMTP 身份验证”；开了多重验证的账号请使用应用密码。', 'Microsoft 365 needs SMTP AUTH enabled for the mailbox; with MFA use an app password.'],
  zoho: ['Zoho 开启两步验证后，请在“安全 → 应用专用密码”生成密码；欧洲或中国区账号请把服务器改为 .eu / .com.cn。', 'With 2FA, create an app-specific password; EU or China accounts use the .eu / .com.cn servers.'],
  aliyun: ['阿里企业邮箱请先在网页邮箱“设置”里开启 IMAP/SMTP 服务；开启了安全登录的账号需使用三方客户端安全密码。', 'Enable IMAP/SMTP in Alibaba Mail settings; with secure login use the client password.'],
  tencent: ['腾讯企业邮箱请先开启 IMAP/SMTP 服务；开启了安全登录（微信动态码）的账号需在“客户端专用密码”生成密码。', 'Enable IMAP/SMTP in Tencent Exmail; with secure login generate a client-specific password.'],
  netease: ['网易企业邮箱请在网页邮箱“设置 → 客户端设置”开启 IMAP/SMTP，并使用客户端授权密码。', 'Enable IMAP/SMTP in NetEase settings and use the client authorization password.'],
  other: ['请向您的邮箱服务商或 IT 同事索取 SMTP（发信）和 IMAP（收信）服务器地址与端口。', 'Ask your email provider or IT for the SMTP (sending) and IMAP (receiving) servers and ports.']
};
export function helpFor(preset) {
  const key = `${preset?.key || ''} ${preset?.label || ''}`.toLowerCase();
  if (/gmail|google/.test(key)) return HELP.gmail;
  if (/microsoft|outlook|office|365/.test(key)) return HELP.microsoft;
  if (/zoho/.test(key)) return HELP.zoho;
  if (/ali|阿里/.test(key)) return HELP.aliyun;
  if (/tencent|exmail|qq|腾讯/.test(key)) return HELP.tencent;
  if (/netease|163|网易/.test(key)) return HELP.netease;
  return HELP.other;
}

/** SMTP / IMAP test result → plain words. */
export function testResultText(result) {
  if (!result) return ['尚未测试', 'Not tested yet'];
  if (result.ok) return ['连接成功', 'Connected'];
  const code = String(result.code || '').toUpperCase();
  if (/AUTH|LOGIN|CREDENTIAL|535/.test(code)) return ['用户名或密码不正确（Gmail 等需使用应用专用密码）', 'Username or password rejected (Gmail and others need an app password)'];
  if (/TIMEOUT|TIMEDOUT|ECONN|REFUSED|DNS|NOTFOUND|HOST|CONNECT/.test(code)) return ['连接不上服务器，请检查服务器地址和端口', 'Cannot reach the server; check the host and port'];
  if (/TLS|SSL|CERT/.test(code)) return ['加密方式不匹配，发信请使用 587 端口、收信使用 993 端口', 'Encryption mismatch; use port 587 for sending and 993 for receiving'];
  if (/NOT_CONFIGURED|MISSING/.test(code)) return ['请先保存邮箱信息', 'Save the mailbox first'];
  return ['连接未成功', 'Connection failed'];
}

const state = { presets: null, mailbox: null, error: false, preset: '', dirty: false, test: null, busy: false, autoBusy: false };

/** Test connection, then always read the stored mailbox again (success, failure or error), so the
 *  status panel shows what the server recorded (verification, failure count, sending pause). */
export async function testAndRefresh(request = url => json(url), fetchMailbox = () => managementRequest('/api/merchant/mailbox')) {
  let result = null; let error = null; let mailbox = null;
  try { result = await request('/api/merchant/mailbox/test-connection'); } catch (caught) { error = caught; }
  try { mailbox = await fetchMailbox(); } catch { mailbox = null; }
  return { result, error, mailbox };
}

/** Automatic first email switch -> what to show. The server decides; this only mirrors it. */
export function autoSendModel(mailbox, { readOnly = false } = {}) {
  const auto = mailbox?.auto_first_touch || {};
  const enabled = auto.enabled === true;
  const verified = Boolean(mailbox?.verified_at);
  const held = Boolean(mailbox?.sending_hold);
  const blocked = readOnly ? 'MERCHANT_READ_ONLY' : auto.blocked_reason || (verified ? null : 'MERCHANT_MAILBOX_NOT_VERIFIED');
  // Turning it off is always possible (except a read-only account); turning it on needs a verified mailbox.
  const disabled = readOnly || (!enabled && Boolean(blocked));
  let note;
  if (blocked === 'MERCHANT_READ_ONLY') note = ['试用已结束，续期后可以修改', 'The trial has ended; renew to change this'];
  else if (blocked === 'MERCHANT_FEATURE_DISABLED') note = ['您的账号暂未开通发信，请联系 SIM', 'Email sending is not enabled for your account; contact SIM'];
  else if (blocked === 'MERCHANT_MAILBOX_NOT_VERIFIED') note = enabled ? ['邮箱验证未通过，自动发送已暂停；重新测试连接成功后恢复', 'Paused until the mailbox passes Test connection again'] : ['邮箱验证通过后才能开启', 'Available after the mailbox is verified'];
  else if (enabled && held) note = ['已暂停：上一封邮件的发送结果未确认。请点“测试连接”，成功后自动恢复', 'Paused: the last send was not confirmed. Run Test connection to resume'];
  else if (enabled) note = ['已开启：在目标市场的工作时间，自动给新客户发送第一封开发信', 'On: first emails go out to new prospects during their business hours'];
  else note = ['已关闭：不会自动发送开发信', 'Off: no first emails are sent automatically'];
  return { enabled, disabled, blocked, held, note, active: enabled && !blocked && !held };
}

function presetTiles() {
  return `<div class="v4-presets" role="radiogroup" aria-label="邮箱服务商 Email provider">${state.presets.map(preset => `<label class="v4-preset${state.preset === preset.key ? ' is-on' : ''}"${tip(`使用${preset.label}的服务器设置`, `Use ${preset.label} server settings`)}><input type="radio" name="preset_key" value="${esc(preset.key)}"${state.preset === preset.key ? ' checked' : ''}><b>${esc(preset.label)}</b><small>${esc(preset.smtp_host || '手动填写 Manual')}</small></label>`).join('')}</div>`;
}

function statusBadge(mailbox) {
  if (mailbox?.verified_at && mailbox?.sending_hold) return `<span class="pill warn"><i class="ti ti-player-pause" aria-hidden="true"></i>${bi('发信已暂停', 'Sending paused')}</span>`;
  return mailbox?.verified_at ? `<span class="pill ok"><i class="ti ti-circle-check" aria-hidden="true"></i>${bi('已验证', 'Verified')}</span>` : `<span class="pill warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i>${bi('未验证', 'Not verified')}</span>`;
}

function resultRow(zh, en, result) {
  const [rzh, ren] = testResultText(result);
  const tone = !result ? '' : result.ok ? 'ok' : 'bad';
  return `<li class="${tone}"><span class="k">${bi(zh, en)}</span><span class="v"><i class="ti ti-${!result ? 'circle-dashed' : result.ok ? 'circle-check' : 'circle-x'}" aria-hidden="true"></i>${bi(rzh, ren)}${result && !result.ok && result.message ? `<small>${esc(result.message)}</small>` : ''}</span></li>`;
}

function failureNote(mailbox) {
  const failures = Number(mailbox?.consecutive_test_failures || 0);
  if (!mailbox?.verified_at || failures < 1) return '';
  const left = Math.max(0, 3 - failures);
  return `<p class="meta" data-mailbox-failures>${bi(`最近连续 ${failures} 次测试未通过；再有 ${left} 次未通过，邮箱需要重新验证`, `${failures} test(s) failed in a row; after ${left} more the mailbox must be verified again`)}</p>`;
}

function autoSendMarkup(mailbox) {
  const model = autoSendModel(mailbox, { readOnly: session.user?.merchant?.read_only === true });
  const tipText = model.disabled && !model.enabled ? ['邮箱验证通过后，可开启自动发送开发信', 'Verify the mailbox first, then switch this on'] : model.enabled ? ['关闭后不再自动发送开发信，已有的跟进邮件不受影响', 'Switch off to stop automatic first emails; follow-ups are not affected'] : ['开启后，系统在目标市场的工作时间，从这个邮箱给新客户自动发送第一封开发信，每天不超过您的发信额度', 'When on, first emails go out from this mailbox to new prospects during their business hours, within your daily email limit'];
  return `<ul class="review-list v4-auto-send" data-auto-send><li><span class="k">${bi('自动发送开发信', 'Automatic first emails')}</span><span class="v"><label class="v4-switch"${tip(...tipText)}><input type="checkbox" role="switch" data-auto-first-touch${model.enabled ? ' checked' : ''}${model.disabled || state.autoBusy ? ' disabled' : ''} aria-label="自动发送开发信 Automatic first emails" aria-describedby="mailbox-auto-note"><span aria-hidden="true"></span></label></span></li></ul>
      <p class="meta" id="mailbox-auto-note" data-auto-note>${bi(...model.note)}</p>`;
}

function formMarkup() {
  const m = state.mailbox || {};
  const preset = state.presets.find(item => item.key === state.preset) || {};
  const value = (name, fallback = '') => esc(m[name] ?? fallback);
  const help = helpFor(preset);
  const manual = !preset.smtp_host;
  return `<div class="split v4-mailbox-split">
    <section class="card" aria-labelledby="mailbox-form-title"><div class="ph"><div><h3 id="mailbox-form-title">${bi('邮箱信息', 'Mailbox details')}</h3><p>${bi('① 选择服务商 ② 填写邮箱和密码 ③ 保存并测试', '① Pick a provider ② Enter address and password ③ Save and test')}</p></div></div>
    <form class="pb v4-mailbox-form" novalidate>
      <fieldset class="field"><legend class="lbl">${bi('邮箱服务商', 'Email provider')}</legend>${presetTiles()}</fieldset>
      <p class="v4-help"><i class="ti ti-info-circle" aria-hidden="true"></i><span class="v4-help-text">${bi(...help)}${preset.help_url ? `<br><a href="${esc(preset.help_url)}" target="_blank" rel="noreferrer">${bi('查看服务商说明', 'Provider guide')}</a>` : ''}</span></p>
      <div class="form-grid">
        <div class="field"><label for="mailbox-from-name">${bi('发件人名称', 'Sender name')}</label><input id="mailbox-from-name" name="from_name" maxlength="120" value="${value('from_name', session.user?.merchant?.sender_name || session.user?.merchant?.company_name || '')}" placeholder="例如 Li Na · Ningbo Textile"></div>
        <div class="field"><label for="mailbox-from-email">${bi('发件邮箱', 'From address')}</label><input id="mailbox-from-email" name="from_email" type="email" autocomplete="email" maxlength="200" value="${value('from_email')}" required></div>
        <div class="field"><label for="mailbox-username">${bi('登录用户名', 'Username')}</label><input id="mailbox-username" name="username" autocomplete="username" maxlength="200" value="${value('username')}" placeholder="通常与发件邮箱相同 Usually the same address"></div>
        <div class="field"><label for="mailbox-password">${bi('密码 / 授权码', 'Password / app password')}</label><input id="mailbox-password" name="password" type="password" autocomplete="new-password" maxlength="200" placeholder="${m.configured ? '已保存，如需更换请重新输入 Saved; type to replace' : ''}"${m.configured ? '' : ' required'}></div>
        <div class="field wide"><label for="mailbox-reply-to">${bi('回复地址（可选）', 'Reply-to (optional)')}</label><input id="mailbox-reply-to" name="reply_to" type="email" maxlength="200" value="${value('reply_to')}" placeholder="不填则回复到发件邮箱 Defaults to the from address"></div>
      </div>
      <details class="v4-servers"${manual ? ' open' : ''}><summary>${bi('服务器设置', 'Server settings')}</summary><div class="form-grid">
        <div class="field"><label for="mailbox-smtp-host">${bi('发信服务器 SMTP', 'SMTP host')}</label><input id="mailbox-smtp-host" name="smtp_host" maxlength="200" value="${esc(m.smtp_host || preset.smtp_host || '')}" required></div>
        <div class="field"><label for="mailbox-smtp-port">${bi('SMTP 端口', 'SMTP port')}</label><input id="mailbox-smtp-port" name="smtp_port" type="number" inputmode="numeric" min="1" max="65535" value="${esc(m.smtp_port || preset.smtp_port || 587)}" required></div>
        <div class="field"><label for="mailbox-imap-host">${bi('收信服务器 IMAP', 'IMAP host')}</label><input id="mailbox-imap-host" name="imap_host" maxlength="200" value="${esc(m.imap_host || preset.imap_host || '')}" required></div>
        <div class="field"><label for="mailbox-imap-port">${bi('IMAP 端口', 'IMAP port')}</label><input id="mailbox-imap-port" name="imap_port" type="number" inputmode="numeric" min="1" max="65535" value="${esc(m.imap_port || preset.imap_port || 993)}" required></div>
      </div></details>
      <p class="v4-form-status" role="status" aria-live="polite"></p>
      <div class="btns v4-mailbox-actions"><button class="btn btn-primary" type="submit" data-mailbox-save${tip('保存邮箱信息；密码会加密保存，之后不会再显示', 'Save the mailbox; the password is stored encrypted and never shown again')}><i class="ti ti-device-floppy" aria-hidden="true"></i>${bi('保存', 'Save')}</button><button class="btn btn-outline-primary" type="button" data-mailbox-test${tip('检查能否用这些信息发信（SMTP）和收信（IMAP），不会发出邮件', 'Check sending (SMTP) and receiving (IMAP) without sending email')}><i class="ti ti-plug-connected" aria-hidden="true"></i>${bi('测试连接', 'Test connection')}</button><button class="btn" type="button" data-mailbox-send-test${tip('发一封测试邮件到您自己的发件邮箱，确认对方能正常收到', 'Send one test email to your own address')}><i class="ti ti-send" aria-hidden="true"></i>${bi('发一封测试邮件给自己', 'Send me a test email')}</button></div>
    </form></section>
    <section class="card v4-mailbox-status" aria-labelledby="mailbox-status-title"><div class="ph"><div><h3 id="mailbox-status-title">${bi('邮箱状态', 'Mailbox status')}</h3></div>${statusBadge(m)}</div>
      <div class="pb"><ul class="review-list v4-test-results">${resultRow('发信 SMTP', 'Sending', state.test?.smtp ?? m.last_test?.smtp ?? null)}${resultRow('收信 IMAP', 'Receiving', state.test?.imap ?? m.last_test?.imap ?? null)}</ul>
      <p class="meta">${m.verified_at ? bi(`验证于 ${new Date(m.verified_at).toLocaleString('zh-CN')}`, `Verified ${new Date(m.verified_at).toLocaleString('en-GB')}`) : bi('保存后点“测试连接”，两项都成功即完成验证。', 'Save, then test: both checks passing verifies the mailbox.')}</p>
      ${failureNote(m)}
      <p class="meta">${bi('验证通过后，开发信和跟进邮件才会从这个邮箱发出；客户回复也会回到这里。', 'Once verified, your emails go out from this mailbox and replies come back to it.')}</p>
      ${autoSendMarkup(m)}</div></section>
  </div>`;
}

function render() {
  const root = $('#mailbox-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '邮箱信息暂未读取', 'Mailbox unavailable', { retry: true })}</section>`; return; }
  if (!state.presets) { root.innerHTML = `<section class="card">${skeletonRows(4)}</section>`; return; }
  root.innerHTML = formMarkup();
  updateBadge();
}

function updateBadge() {
  const verified = Boolean(state.mailbox?.verified_at);
  document.querySelectorAll('[data-mailbox-badge]').forEach(badge => { badge.hidden = verified || !state.presets; });
}

function payload(form) {
  const body = { preset_key: state.preset || undefined, smtp_host: form.smtp_host.value.trim(), smtp_port: Number(form.smtp_port.value), imap_host: form.imap_host.value.trim(), imap_port: Number(form.imap_port.value),
    username: form.username.value.trim() || form.from_email.value.trim(), from_email: form.from_email.value.trim(), from_name: form.from_name.value.trim(), reply_to: form.reply_to.value.trim() || undefined };
  if (form.password.value) body.password = form.password.value;
  return body;
}
export function mailboxProblem(body, configured) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.from_email || '')) return ['请填写正确的发件邮箱', 'Enter a valid from address'];
  if (!configured && !body.password) return ['请填写密码或授权码', 'Enter the password or app password'];
  if (!body.smtp_host || !body.imap_host) return ['请在“服务器设置”中填写服务器地址', 'Enter the server hosts under Server settings'];
  if (!(body.smtp_port > 0 && body.smtp_port < 65536 && body.imap_port > 0 && body.imap_port < 65536)) return ['端口应为 1–65535 的数字', 'Ports must be numbers from 1 to 65535'];
  return null;
}

async function save(form, status) {
  const body = payload(form);
  const problem = mailboxProblem(body, state.mailbox?.configured);
  if (problem) { status.innerHTML = bi(...problem); return false; }
  status.innerHTML = bi('正在保存', 'Saving');
  try {
    const saved = await json('/api/merchant/mailbox', body, 'PUT');
    state.mailbox = { ...(state.mailbox || {}), ...(saved && typeof saved === 'object' ? saved : body), configured: true };
    delete state.mailbox.password; state.dirty = false;
    form.password.value = '';
    return true;
  } catch (error) { status.innerHTML = bi(...([400, 422].includes(error.status) ? ['邮箱信息有误，请检查后再保存', 'Some details are invalid; check and save again'] : error.status === 404 ? ['邮箱绑定服务暂未开放，请联系 SIM', 'Mailbox binding is not available yet; contact SIM'] : ['保存未完成，请重试', 'Could not save; please retry'])); return false; }
}

function wire(root) {
  root.addEventListener('change', event => {
    if (event.target.matches?.('[data-auto-first-touch]')) { void toggleAutoSend(event.target); return; }
    if (event.target.name === 'preset_key') {
      const form = event.target.form; const preset = state.presets.find(item => item.key === event.target.value);
      state.preset = event.target.value; state.dirty = true;
      const keep = Object.fromEntries(['from_name', 'from_email', 'username', 'reply_to'].map(name => [name, form[name].value]));
      state.mailbox = { ...(state.mailbox || {}), ...keep, smtp_host: preset?.smtp_host || '', smtp_port: preset?.smtp_port || 587, imap_host: preset?.imap_host || '', imap_port: preset?.imap_port || 993 };
      render(); root.querySelector(`input[name="preset_key"][value="${CSS.escape(state.preset)}"]`)?.focus();
    }
  });
  root.addEventListener('input', event => { if (!event.target.matches?.('[data-auto-first-touch]')) state.dirty = true; });
  root.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target; const status = form.querySelector('.v4-form-status');
    if (await save(form, status)) { render(); toast('邮箱信息已保存，请点“测试连接”完成验证', 'Saved. Use Test connection to verify'); document.dispatchEvent(new CustomEvent('crm:onboarding')); }
  });
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-state-retry]')) { void loadMailbox(); return; }
    const test = event.target.closest('[data-mailbox-test]'); const send = event.target.closest('[data-mailbox-send-test]');
    if (!test && !send) return;
    const form = root.querySelector('form'); const status = form.querySelector('.v4-form-status');
    if (state.busy) return;
    state.busy = true; (test || send).disabled = true;
    try {
      if (state.dirty || !state.mailbox?.configured) { if (!await save(form, status)) return; }
      if (test) {
        status.innerHTML = bi('正在测试发信和收信', 'Testing sending and receiving');
        const { result, error, mailbox } = await testAndRefresh();
        // The status panel always shows the stored state read back from the server.
        if (mailbox) { state.mailbox = mailbox; state.test = null; } else state.test = result;
        render();
        if (error) throw error;
        const passed = result?.smtp?.ok && result?.imap?.ok;
        toast(...(passed ? ['发信和收信都已连通，邮箱已验证', 'Sending and receiving work; mailbox verified'] : ['测试未通过，请查看右侧结果', 'Test failed; see the results']), { tone: passed ? 'ok' : 'warn' });
        if (passed) document.dispatchEvent(new CustomEvent('crm:onboarding'));
      } else {
        status.innerHTML = bi('正在发送测试邮件', 'Sending a test email');
        const result = await json('/api/merchant/mailbox/test-email');
        status.innerHTML = result?.ok ? bi(`测试邮件已发到 ${state.mailbox?.from_email || '您的邮箱'}，请查收`, `Test email sent to ${state.mailbox?.from_email || 'your address'}`) : bi('测试邮件未发出，请先“测试连接”查看原因', 'Test email not sent; run Test connection to see why');
      }
    } catch (error) {
      const current = root.querySelector('.v4-form-status') || status;
      current.innerHTML = bi(...(error.status === 404 ? ['邮箱测试服务暂未开放，请联系 SIM', 'Mailbox testing is not available yet; contact SIM'] : error.code === 'MERCHANT_MAILBOX_NOT_VERIFIED' ? ['请先通过“测试连接”', 'Pass Test connection first'] : ['测试未完成，请重试', 'Could not test; please retry']));
    } finally { state.busy = false; const button = root.querySelector(test ? '[data-mailbox-test]' : '[data-mailbox-send-test]'); if (button) button.disabled = false; }
  });
}

async function toggleAutoSend(input) {
  if (state.autoBusy) return;
  const enabled = input.checked;
  state.autoBusy = true; input.disabled = true;
  try {
    const saved = await json('/api/merchant/auto-first-touch', { enabled }, 'PUT');
    if (saved && typeof saved === 'object') state.mailbox = saved;
    toast(...(enabled ? ['已开启自动发送开发信', 'Automatic first emails are on'] : ['已关闭自动发送开发信', 'Automatic first emails are off']));
  } catch (error) {
    const reason = error.code === 'MERCHANT_MAILBOX_NOT_VERIFIED' ? ['请先通过“测试连接”验证邮箱', 'Verify the mailbox with Test connection first'] : error.code === 'MERCHANT_READ_ONLY' ? ['试用已结束，续期后可以修改', 'The trial has ended; renew to change this'] : error.code === 'MERCHANT_FEATURE_DISABLED' ? ['您的账号暂未开通发信，请联系 SIM', 'Email sending is not enabled for your account; contact SIM'] : ['设置未保存，请重试', 'Could not save; please retry'];
    toast(...reason, { tone: 'warn' });
    const mailbox = await managementRequest('/api/merchant/mailbox').catch(() => null);
    if (mailbox) state.mailbox = mailbox;
  } finally { state.autoBusy = false; render(); $('[data-auto-first-touch]')?.focus(); }
}

export async function loadMailbox() {
  state.error = false;
  const [presets, mailbox] = await Promise.all([
    managementRequest('/api/merchant/mailbox/presets').then(payload => payload?.items?.length ? payload.items : FALLBACK_PRESETS).catch(() => FALLBACK_PRESETS),
    managementRequest('/api/merchant/mailbox').catch(error => (error.status === 404 ? { configured: false } : null))
  ]);
  if (!mailbox) { state.error = true; render(); return; }
  state.presets = presets; state.mailbox = mailbox;
  if (!state.preset) state.preset = mailbox.preset_key || presets.find(item => item.smtp_host && item.smtp_host === mailbox.smtp_host)?.key || (mailbox.configured ? 'other' : presets[0]?.key || 'other');
  render();
}

if (typeof document !== 'undefined') {
  const root = $('#mailbox-root');
  if (root) {
    wire(root);
    document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'mailbox') void loadMailbox(); });
    sessionReady.then(user => { if (user.merchant) void loadMailbox(); });
  }
}
