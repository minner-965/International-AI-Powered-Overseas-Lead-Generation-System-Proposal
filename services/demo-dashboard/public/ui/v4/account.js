// Signed-in account in the shell: sidebar user block with sign-out, and the trial / expired
// banner under the top bar. Status words follow the merchant account (TRIAL, ACTIVE, EXPIRED).
import { bi, esc } from './crm.js';
import { tip } from './tooltips.js';
import { session, sessionReady, trialDaysLeft, isReadOnly, logout } from './session.js';

export const STATUS = Object.freeze({
  TRIAL: ['试用中', 'Trial', 'info'], ACTIVE: ['已开通', 'Active', 'ok'], EXPIRED: ['已到期', 'Expired', 'bad'], DISABLED: ['已停用', 'Disabled', 'bad']
});
export const statusPill = code => { const [zh, en, tone] = STATUS[code] || ['状态待确认', 'Unknown', '']; return `<span class="pill ${tone}">${bi(zh, en)}</span>`; };
export const dateText = value => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-') : '—'; };

/** Banner for the account state, or '' when nothing needs saying. */
export function bannerMarkup(user, now = new Date()) {
  const merchant = user?.merchant;
  if (!merchant) return '';
  const contact = `<button class="btn btn-sm" type="button" data-feedback-open${tip('给 SIM 留言：开通、续费或任何问题', 'Message SIM about activation, renewal or anything else')}>${bi('联系 SIM', 'Contact SIM')}</button>`;
  if (isReadOnly(user)) return `<div class="v4-banner bad"><i class="ti ti-lock" aria-hidden="true"></i><span class="t">${bi('试用已结束，请联系 SIM 开通。', 'Your trial has ended. Contact SIM to activate your account.')}<small>${bi('您的资料都已保留，现在可以查看，暂不能新建任务或发信。', 'Your data is kept; you can view it but cannot start new work or send email.')}</small></span>${contact}</div>`;
  const days = trialDaysLeft(merchant, now);
  if (days !== null) return `<div class="v4-banner ${days <= 2 ? 'warn' : 'info'}"><i class="ti ti-clock-hour-4" aria-hidden="true"></i><span class="t">${bi(`试用剩余 ${days} 天`, `${days} day${days === 1 ? '' : 's'} left in your trial`)}<small>${bi(`试用到 ${dateText(merchant.trial_ends_at)}。满意请联系 SIM 开通正式账号，资料会全部保留。`, `Trial ends ${dateText(merchant.trial_ends_at)}. Contact SIM to continue; all data is kept.`)}</small></span>${contact}</div>`;
  if (merchant.status === 'ACTIVE' && merchant.paid_until) {
    const left = Math.ceil((new Date(merchant.paid_until) - now) / 86400000);
    if (left >= 0 && left <= 7) return `<div class="v4-banner warn"><i class="ti ti-calendar-due" aria-hidden="true"></i><span class="t">${bi(`服务将于 ${left} 天后到期（${dateText(merchant.paid_until)}）`, `Service ends in ${left} days (${dateText(merchant.paid_until)})`)}<small>${bi('请联系 SIM 续期。', 'Contact SIM to renew.')}</small></span>${contact}</div>`;
  }
  return '';
}

export const roleText = user => user?.role === 'ADMIN' ? ['管理员', 'Admin'] : [user?.merchant?.company_name || '商家', 'Merchant'];
const initial = user => (user?.display_name || user?.merchant?.company_name || user?.email || 'S').trim().slice(0, 1).toUpperCase();

function render(user) {
  const name = document.getElementById('session-name');
  if (name) name.textContent = user.display_name || user.email || 'SIM';
  const role = document.getElementById('session-role');
  if (role) role.innerHTML = `<span lang="zh-CN">${esc(roleText(user)[0])}</span><span lang="en">${esc(roleText(user)[1])}</span>`;
  const avatar = document.getElementById('session-avatar');
  if (avatar) avatar.textContent = initial(user);
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) logoutButton.hidden = !session.authEnabled;
  const banner = document.getElementById('account-banner');
  if (banner) { banner.innerHTML = bannerMarkup(user); banner.hidden = !banner.innerHTML; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', event => { if (event.target.closest('#logout-button, [data-logout]')) { event.preventDefault(); void logout(); } });
  sessionReady.then(render);
}
