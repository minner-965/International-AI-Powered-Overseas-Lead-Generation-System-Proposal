// Sign-in page: POST /api/auth/login, then the forced password change when must_change_password,
// then back to the page that asked for sign-in (?next=, same-origin paths only).
// Two-step sign-in (migration 078): after the password, the 6-digit app code (or a recovery code)
// at POST /api/auth/2fa/verify. Setup (?setup2fa=1, required for the administrator, optional for
// merchants from 我的): QR from POST /api/auth/2fa/setup, one code to /2fa/enable, then the
// recovery codes are shown once.
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;

/** Only same-origin workspace paths are followed after sign-in. */
export function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') && !next.includes('\\') ? next : '/';
}

/** Sign-in refusal → message. */
export function loginErrorText(status, code) {
  if (status === 401 || code === 'AUTH_INVALID_CREDENTIALS' || code === 'INVALID_CREDENTIALS') return ['邮箱或密码不正确，请重新输入。', 'Email or password is incorrect.'];
  if (code === 'ACCOUNT_DISABLED' || code === 'MERCHANT_DISABLED' || status === 403) return ['账号已停用，请联系 SIM。', 'This account is disabled. Contact SIM.'];
  if (status === 429) return ['尝试次数过多，请稍后再试。', 'Too many attempts. Try again later.'];
  if (status === 404) return ['登录服务暂未开放，请联系 SIM。', 'Sign-in is not available yet. Contact SIM.'];
  if (status === 0) return ['网络连接失败，请检查网络后重试。', 'Network error. Check your connection and retry.'];
  return ['登录未完成，请重试。', 'Sign-in failed. Please retry.'];
}

/** New password checks before it is sent. */
export function passwordProblem(current, next, confirm) {
  if (String(next).length < 8) return ['新密码至少 8 位。', 'Use at least 8 characters.'];
  if (next !== confirm) return ['两次输入的新密码不一致。', 'The new passwords do not match.'];
  if (current && next === current) return ['新密码不能与临时密码相同。', 'Choose a password different from the temporary one.'];
  return null;
}

/** Code checks before it is sent. */
export function codeProblem(value, recovery = false) {
  const text = String(value || '').trim();
  if (recovery) return text.replace(/[^a-z0-9]/gi, '').length === 10 ? null : ['恢复码是 10 位字母和数字，例如 abcde-23456。', 'A recovery code has 10 letters and digits, e.g. abcde-23456.'];
  return /^\d{6}$/.test(text.replace(/\s/g, '')) ? null : ['请输入 6 位数字。', 'Enter the 6 digits.'];
}
/** Second-step refusal → message. */
export function codeErrorText(status, code) {
  if (code === 'TWO_FACTOR_SESSION_EXPIRED') return ['登录已超时，请重新输入邮箱和密码。', 'This sign-in timed out. Enter your email and password again.'];
  if (status === 429) return ['尝试次数过多，请 15 分钟后再试。', 'Too many attempts. Try again in 15 minutes.'];
  if (code === 'TWO_FACTOR_CODE_INVALID') return ['验证码不正确或已用过。请等 App 上出现新的数字再试，并检查手机时间是否准确。', 'The code is wrong or was already used. Wait for a new code and check the time on your phone.'];
  return loginErrorText(status, code);
}
/** Text file of recovery codes. */
export function recoveryCodesText(codes, account) {
  return [`SIM外贸获客系统 恢复码 / SIM Prospecting recovery codes`, `账号 Account: ${account || ''}`, '每个只能用一次 / Each code works once.', '', ...codes].join('\n') + '\n';
}

async function post(url, body) {
  let response;
  try { response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { return { status: 0, body: null }; }
  const body2 = (response.headers.get('content-type') || '').includes('json') ? await response.json().catch(() => null) : null;
  return { status: response.status, ok: response.ok, body: body2 };
}

function show(el, pair) { el.innerHTML = bi(...pair); el.hidden = false; }

function mount() {
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  const login = $('#login-form'); const change = $('#password-form');
  const codeForm = $('#code-form'); const setup = $('#setup-form'); const recovery = $('#recovery-form');
  const forms = [login, change, codeForm, setup, recovery];
  const only = form => forms.forEach(item => { if (item) item.hidden = item !== form; });
  let account = '';
  let recoveryMode = false;
  // After sign-in: password change first, then the administrator's required setup, then the page.
  const afterSignIn = (user, password = '') => {
    if (user?.must_change_password) { toChange(password); return; }
    if (user?.two_factor_setup_required) { void toSetup(true); return; }
    location.replace(next);
  };
  const toCode = () => {
    only(codeForm); recoveryMode = false; setCodeMode();
    document.title = '输入验证码 · SIM外贸获客系统';
    $('#code-title').focus(); $('#code-input').focus();
  };
  const setCodeMode = () => {
    const input = $('#code-input');
    input.value = ''; input.inputMode = recoveryMode ? 'text' : 'numeric'; input.maxLength = recoveryMode ? 11 : 6;
    input.autocomplete = recoveryMode ? 'off' : 'one-time-code'; input.pattern = recoveryMode ? '.*' : '[0-9]{6}';
    $('#code-label').innerHTML = recoveryMode ? bi('恢复码', 'Recovery code') : bi('6 位验证码', '6-digit code');
    $('#code-mode').innerHTML = recoveryMode ? bi('改用验证器 App', 'Use the authenticator app') : bi('改用恢复码', 'Use a recovery code');
  };
  async function toSetup(required) {
    only(setup); document.title = '设置二步验证 · SIM外贸获客系统';
    $('#setup-cancel-row').hidden = required; $('#setup-cancel').href = next;
    const qr = $('#setup-qr'); qr.innerHTML = bi('正在生成二维码', 'Creating the QR code');
    const result = await post('/api/auth/2fa/setup', {});
    if (result.status === 401) { only(login); show($('#login-notice'), ['请先登录。', 'Please sign in first.']); return; }
    if (result.body?.code === 'TWO_FACTOR_ALREADY_ENABLED') { location.replace(next); return; }
    if (!result.ok) { qr.innerHTML = ''; show($('#setup-error'), ['二维码暂时生成不了，请刷新页面重试。', 'Could not create the QR code. Refresh and retry.']); return; }
    account = result.body.account || '';
    qr.innerHTML = `<img src="${esc(result.body.qr_data_url)}" width="200" height="200" alt="二维码：用验证器 App 扫描 QR code for your authenticator app">`;
    $('#setup-account').textContent = account; $('#setup-secret').textContent = result.body.secret;
    $('#setup-title').focus();
  }
  const toRecovery = codes => {
    only(recovery); document.title = '保存恢复码 · SIM外贸获客系统';
    $('#recovery-codes').innerHTML = codes.map(code => `<li><code>${esc(code)}</code></li>`).join('');
    recovery.dataset.codes = codes.join(' ');
    $('#recovery-title').focus();
  };
  const notice = $('#login-notice');
  if (params.get('reason') === 'expired') show(notice, ['登录已过期，请重新登录。', 'Your session has ended. Please sign in again.']);
  let remembered = '';
  const toChange = (knownCurrent = '') => {
    remembered = knownCurrent;
    only(change);
    $('#password-current-field').hidden = Boolean(knownCurrent);
    document.title = '修改密码 · SIM外贸获客系统';
    $('#password-title').focus();
    (knownCurrent ? $('#password-new') : $('#password-current')).focus();
  };
  if (params.get('change') === '1') toChange();
  else if (params.get('setup2fa') === '1') void toSetup(params.get('required') === '1');

  document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? '隐藏密码 Hide password' : '显示密码 Show password');
    button.querySelector('i').className = `ti ti-${visible ? 'eye-off' : 'eye'}`;
  }));

  login.addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#login-error'); error.hidden = true;
    const email = login.email.value.trim(); const password = login.password.value;
    if (!email || !password) { show(error, ['请填写登录邮箱和密码。', 'Enter your email and password.']); (email ? login.password : login.email).focus(); return; }
    const submit = $('#login-submit'); submit.disabled = true; submit.innerHTML = bi('正在登录', 'Signing in');
    const result = await post('/api/auth/login', { email, password });
    submit.disabled = false; submit.innerHTML = bi('登录', 'Sign in');
    if (!result.ok) { show(error, loginErrorText(result.status, result.body?.code)); login.password.select(); return; }
    if (result.body?.two_factor_required) { remembered = password; toCode(); return; }
    afterSignIn(result.body?.user, password);
  });

  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#code-error'); error.hidden = true;
    const value = $('#code-input').value.trim();
    const problem = codeProblem(value, recoveryMode);
    if (problem) { show(error, problem); $('#code-input').focus(); return; }
    const submit = $('#code-submit'); submit.disabled = true;
    const result = await post('/api/auth/2fa/verify', recoveryMode ? { recovery_code: value } : { code: value.replace(/\s/g, '') });
    submit.disabled = false;
    if (!result.ok) {
      if (result.body?.code === 'TWO_FACTOR_SESSION_EXPIRED') { only(login); show($('#login-error'), codeErrorText(result.status, result.body.code)); login.password.value = ''; login.password.focus(); return; }
      show(error, codeErrorText(result.status, result.body?.code)); $('#code-input').select(); return;
    }
    if (result.body?.method === 'RECOVERY_CODE') sessionStorage.setItem('sim-recovery-left', String(result.body.recovery_codes_left ?? ''));
    afterSignIn(result.body?.user, remembered);
  });
  // Six digits typed: submit without an extra tap.
  $('#code-input').addEventListener('input', event => { if (!recoveryMode && /^\d{6}$/.test(event.target.value)) codeForm.requestSubmit(); });
  $('#code-mode').addEventListener('click', () => { recoveryMode = !recoveryMode; setCodeMode(); $('#code-error').hidden = true; $('#code-input').focus(); });
  document.querySelectorAll('[data-back-to-login]').forEach(button => button.addEventListener('click', () => { only(login); login.password.value = ''; login.email.focus(); }));

  setup.addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#setup-error'); error.hidden = true;
    const value = $('#setup-code').value.replace(/\s/g, '');
    const problem = codeProblem(value);
    if (problem) { show(error, problem); $('#setup-code').focus(); return; }
    const submit = $('#setup-submit'); submit.disabled = true;
    const result = await post('/api/auth/2fa/enable', { code: value });
    submit.disabled = false;
    if (!result.ok) { show(error, result.body?.code === 'TWO_FACTOR_SETUP_NOT_STARTED' ? ['设置已过期，请刷新页面重新扫码。', 'The setup expired. Refresh and scan again.'] : codeErrorText(result.status, result.body?.code)); $('#setup-code').select(); return; }
    toRecovery(result.body.recovery_codes || []);
  });
  $('#setup-code').addEventListener('input', event => { if (/^\d{6}$/.test(event.target.value)) setup.requestSubmit(); });

  $('#recovery-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(recoveryCodesText(recovery.dataset.codes.split(' '), account)); $('#recovery-copy').innerHTML = `<i class="ti ti-check" aria-hidden="true"></i>${bi('已复制', 'Copied')}`; }
    catch { show($('#recovery-error'), ['无法自动复制，请手动抄下或点“下载”。', 'Copy is blocked; write them down or use Download.']); }
  });
  $('#recovery-download').addEventListener('click', () => {
    const blob = new Blob([recoveryCodesText(recovery.dataset.codes.split(' '), account)], { type: 'text/plain;charset=utf-8' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'SIM-recovery-codes.txt' });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  recovery.addEventListener('submit', event => {
    event.preventDefault();
    if (!$('#recovery-saved').checked) { show($('#recovery-error'), ['请先保存恢复码，再勾选确认。', 'Save the codes first, then tick the box.']); $('#recovery-saved').focus(); return; }
    location.replace(next);
  });

  change.addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#password-error'); error.hidden = true;
    const current = remembered || change.current_password.value;
    const problem = (!current && ['请填写当前密码。', 'Enter your current password.']) || passwordProblem(current, change.new_password.value, change.confirm_password.value);
    if (problem) { show(error, problem); return; }
    const submit = $('#password-submit'); submit.disabled = true;
    const result = await post('/api/auth/password', { current_password: current, new_password: change.new_password.value });
    submit.disabled = false;
    if (result.status === 401 && !remembered) { show(error, ['当前密码不正确。', 'The current password is incorrect.']); return; }
    if (!result.ok) { show(error, [400, 422].includes(result.status) ? ['新密码不符合要求，请换一个更长或更复杂的密码。', 'The new password does not meet the rules. Choose a longer one.'] : loginErrorText(result.status, result.body?.code)); return; }
    if (result.body?.user?.two_factor_setup_required) { void toSetup(true); return; }
    location.replace(next);
  });
}

if (typeof document !== 'undefined' && document.querySelector('#login-form')) mount();
