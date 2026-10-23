// Sign-in page: POST /api/auth/login, then the forced password change when must_change_password,
// then back to the page that asked for sign-in (?next=, same-origin paths only).
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
  const notice = $('#login-notice');
  if (params.get('reason') === 'expired') show(notice, ['登录已过期，请重新登录。', 'Your session has ended. Please sign in again.']);
  let remembered = '';
  const toChange = (knownCurrent = '') => {
    remembered = knownCurrent;
    login.hidden = true; change.hidden = false;
    $('#password-current-field').hidden = Boolean(knownCurrent);
    document.title = '修改密码 · SIM外贸获客系统';
    $('#password-title').focus();
    (knownCurrent ? $('#password-new') : $('#password-current')).focus();
  };
  if (params.get('change') === '1') toChange();

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
    if (result.body?.user?.must_change_password) { toChange(password); return; }
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
    location.replace(next);
  });
}

if (typeof document !== 'undefined' && document.querySelector('#login-form')) mount();
