// 二步验证 / Two-step sign-in card on 我的 (Me). Setup itself happens on the sign-in page
// (/login.html?setup2fa=1), so there is one setup screen. Here: state, renew recovery codes,
// and switch off (merchants only; required for the administrator).
// API: POST /api/auth/2fa/recovery-codes {code}, POST /api/auth/2fa/disable {password, code}.
import { bi, esc } from './crm.js';
import { tip } from './tooltips.js';
import { toast } from './toast.js';

const post = async (url, body) => {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: json };
};
const codeInput = (id, label) => `<div class="field"><label for="${id}">${bi(...label)}</label><input id="${id}" class="v4-code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>`;

/** Card markup for the signed-in user (exported for tests). */
export function twoFactorCardMarkup(user) {
  const state = user?.two_factor;
  if (!state) return '';
  const left = Number(state.recovery_codes_left || 0);
  const pill = state.enabled ? `<span class="pill ok"><i class="ti ti-shield-check" aria-hidden="true"></i>${bi('已开启', 'On')}</span>` : `<span class="pill warn"><i class="ti ti-shield" aria-hidden="true"></i>${bi('未开启', 'Off')}</span>`;
  const body = state.enabled
    ? `<p class="meta">${bi('登录时除了密码，还要输入手机验证器 App 上的 6 位数字。', 'Sign-in asks for your password and the 6-digit code from your authenticator app.')}</p>
      <p class="meta${left <= 3 ? ' v4-warn-text' : ''}" data-2fa-left>${bi(`剩余恢复码 ${left} 个${left <= 3 ? '，建议重新生成' : ''}`, `${left} recovery codes left${left <= 3 ? '; consider new ones' : ''}`)}</p>
      <div class="btns"><button class="btn" type="button" data-2fa-action="renew"${tip('作废旧的恢复码，生成 10 个新的（需要输入验证码）', 'Replace the recovery codes with 10 new ones (needs a code)')}><i class="ti ti-refresh" aria-hidden="true"></i>${bi('重新生成恢复码', 'New recovery codes')}</button>${state.required ? '' : `<button class="btn btn-danger" type="button" data-2fa-action="disable"${tip('关闭后登录只需要密码（需要输入密码和验证码）', 'After this, sign-in needs only the password (needs password and code)')}><i class="ti ti-shield-off" aria-hidden="true"></i>${bi('关闭二步验证', 'Turn off')}</button>`}</div>
      ${state.required ? `<p class="meta">${bi('管理员账号必须开启二步验证。', 'Two-step sign-in is required for the administrator.')}</p>` : ''}
      <div data-2fa-panel></div>`
    : `<p class="meta">${bi('开启后，登录除了密码还要输入手机验证器 App 上的 6 位数字，别人拿到密码也登录不了。', 'When on, sign-in also needs a 6-digit code from an app on your phone, so a stolen password is not enough.')}</p>
      <div class="btns"><a class="btn btn-primary" href="/login.html?setup2fa=1&amp;next=%2F%23me"${tip('用手机扫码绑定验证器 App，约 1 分钟', 'Scan a QR code with an authenticator app; about a minute')}><i class="ti ti-shield-lock" aria-hidden="true"></i>${bi('开启二步验证', 'Turn on two-step sign-in')}</a></div>`;
  return `<section class="card v4-2fa-card" aria-labelledby="two-factor-title" data-2fa-card><div class="ph"><div><h3 id="two-factor-title">${bi('二步验证', 'Two-step sign-in')}</h3></div>${pill}</div><div class="pb">${body}</div></section>`;
}

function renewForm() {
  return `<form class="v4-2fa-form" data-2fa-form="renew" novalidate>${codeInput('two-factor-renew-code', ['验证器上的 6 位数字', 'Code from your app'])}
    <p class="v4-form-status" role="status" aria-live="polite"></p><div class="btns"><button class="btn btn-primary" type="submit"${tip('生成新的恢复码，旧的立即作废', 'Create new codes; the old ones stop working')}>${bi('生成', 'Create')}</button></div></form>`;
}
function disableForm() {
  return `<form class="v4-2fa-form" data-2fa-form="disable" novalidate><div class="field"><label for="two-factor-password">${bi('登录密码', 'Password')}</label><input id="two-factor-password" type="password" autocomplete="current-password" required></div>${codeInput('two-factor-disable-code', ['验证器上的 6 位数字', 'Code from your app'])}
    <p class="v4-form-status" role="status" aria-live="polite"></p><div class="btns"><button class="btn btn-danger" type="submit"${tip('确认关闭二步验证', 'Confirm turning two-step sign-in off')}>${bi('确认关闭', 'Turn off')}</button></div></form>`;
}
/** Error code → message. */
export function twoFactorCardError(status, code) {
  if (code === 'TWO_FACTOR_CODE_INVALID') return ['验证码不正确或已用过，请等新的数字出现再试。', 'Wrong or already used code; wait for a new one.'];
  if (code === 'AUTH_INVALID_CREDENTIALS') return ['登录密码不正确。', 'The password is incorrect.'];
  if (status === 429) return ['尝试次数过多，请稍后再试。', 'Too many attempts. Try again later.'];
  return ['未完成，请重试。', 'Not done; please retry.'];
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-2fa-action]');
    if (!button) return;
    const panel = button.closest('[data-2fa-card]')?.querySelector('[data-2fa-panel]');
    if (!panel) return;
    panel.innerHTML = button.dataset['2faAction'] === 'renew' ? renewForm() : disableForm();
    panel.querySelector('input')?.focus();
  });
  document.addEventListener('submit', async event => {
    const form = event.target.closest?.('[data-2fa-form]');
    if (!form) return;
    event.preventDefault();
    const status = form.querySelector('.v4-form-status');
    const code = form.querySelector('.v4-code-input').value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { status.innerHTML = bi('请输入 6 位数字。', 'Enter the 6 digits.'); return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      if (form.dataset['2faForm'] === 'renew') {
        const result = await post('/api/auth/2fa/recovery-codes', { code });
        if (!result.ok) { status.innerHTML = bi(...twoFactorCardError(result.status, result.body?.code)); return; }
        const codes = result.body.recovery_codes || [];
        form.outerHTML = `<p class="meta">${bi('新的恢复码（只显示这一次，请抄下或复制保存）：', 'New recovery codes (shown only now; save them):')}</p><ul class="v4-recovery-codes">${codes.map(item => `<li><code>${esc(item)}</code></li>`).join('')}</ul>`;
        document.querySelector('[data-2fa-left]')?.replaceChildren(document.createRange().createContextualFragment(bi('剩余恢复码 10 个', '10 recovery codes left')));
        toast('已生成新的恢复码，旧的已作废', 'New recovery codes created; the old ones no longer work');
      } else {
        const result = await post('/api/auth/2fa/disable', { password: form.querySelector('#two-factor-password').value, code });
        if (!result.ok) { status.innerHTML = bi(...twoFactorCardError(result.status, result.body?.code)); return; }
        toast('二步验证已关闭', 'Two-step sign-in is off');
        setTimeout(() => location.reload(), 600);
      }
    } finally { submit.disabled = false; }
  });
}
