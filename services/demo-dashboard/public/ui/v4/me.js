// 我的 / Me: account (status, trial or paid period, quota usage, referral code, password, sign out)
// and every page of the workspace the role may use, as a labelled menu (phones have no sidebar).
import { bi, esc } from './crm.js';
import { viewTip, tip } from './tooltips.js';
import { session, sessionReady, viewAllowed, trialDaysLeft } from './session.js';
import { statusPill, dateText, roleText } from './account.js';
import { toast } from './toast.js';

const groups = [
  ['我的账户', 'Account', [['mailbox', '绑定发信邮箱', 'Sending mailbox', 'mail-cog', 'b'], ['scope', '我的业务范围', 'Business scope', 'target', 'g'], ['api-keys', '接口密钥', 'API keys', 'key', 'n']]],
  ['获客', 'Prospecting', [['companies', '客户名录', 'Company Directory', 'building', 'b'], ['contact-ready', '待联系企业', 'Contact-ready', 'address-book', 'b'], ['opportunities', '销售机会', 'Opportunities', 'briefcase', 'b'], ['research', '研究任务', 'Research', 'list-search', 'g'], ['jobs', '任务列表', 'Research jobs', 'list-check', 'g'], ['manual-companies', '手动添加企业', 'Add companies', 'building-plus', 'b']]],
  ['跟进', 'Follow-up', [['tasks', '我的任务', 'My tasks', 'square-check', 'a'], ['replies', '回复与跟进', 'Replies', 'message-2', 'b'], ['followups', '跟进邮件审批', 'Follow-up approval', 'mail', 'b'], ['contact-queue', '开发信审核', 'First-touch review', 'mail-check', 'b']]],
  ['管理', 'Admin', [['merchants', '商家管理', 'Merchants', 'building-community', 'b'], ['feedback-inbox', '意见反馈', 'Feedback', 'message-report', 'a']]],
  ['数据与设置', 'Data & settings', [['data-import', '数据导入', 'Data import', 'file-import', 'a'], ['data-export', '数据导出', 'Data export', 'file-export', 'a'], ['settings', '系统设置', 'Settings', 'adjustments-horizontal', 'n'], ['categories', '品类范围', 'Category scope', 'category', 'n'], ['markets', '目标市场', 'Target markets', 'world', 'n'], ['customer-match', '客户画像', 'Customer profile', 'users-group', 'n'], ['evidence', '评估依据', 'Evidence', 'file-certificate', 'n']]]
];

const num = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null;
/** One usage row: "本月找客户 120 / 500 次" with a bar. */
export function usageRow(zh, en, used, limit, unitZh, unitEn) {
  const u = num(used); const l = num(limit);
  if (u === null && l === null) return '';
  const share = u !== null && l ? Math.min(100, Math.round(u / l * 100)) : 0;
  const tone = l && u >= l ? ' is-full' : share >= 80 ? ' is-high' : '';
  return `<div class="v4-usage${tone}"><div class="v4-usage-head"><span>${bi(zh, en)}</span><b>${u ?? '—'} / ${l ?? '—'} ${bi(unitZh, unitEn)}</b></div><div class="progress" role="progressbar" aria-label="${esc(zh)} ${esc(en)}" aria-valuemin="0" aria-valuemax="${l ?? 0}" aria-valuenow="${u ?? 0}"><span style="width:${share}%"></span></div></div>`;
}

export function accountMarkup(user, { authEnabled = true } = {}) {
  const merchant = user?.merchant;
  const [roleZh, roleEn] = roleText(user);
  const days = trialDaysLeft(merchant);
  const period = merchant ? (merchant.status === 'TRIAL' ? [['试用到期', 'Trial ends', `${dateText(merchant.trial_ends_at)}${days !== null ? ` · ${bi(`剩余 ${days} 天`, `${days} days left`)}` : ''}`]] : merchant.paid_until ? [['服务到期', 'Paid until', dateText(merchant.paid_until)]] : []) : [];
  const facts = [['登录邮箱', 'Email', esc(user?.email || '—')], ...(merchant ? [['公司', 'Company', esc(merchant.company_name || '—')], ['发信署名', 'Sender name', esc(merchant.sender_name || merchant.company_name || '—')], ['账号状态', 'Status', statusPill(merchant.status)], ...period] : [])];
  const usage = merchant ? `<div class="v4-usage-list">${usageRow('本月找客户', 'Searches this month', merchant.usage?.searches_this_month, merchant.quotas?.monthly_searches, '次', '')}${usageRow('今日发信', 'Emails today', merchant.usage?.emails_today, merchant.quotas?.daily_emails, '封', '')}</div>` : '';
  const referral = merchant?.referral_code ? `<div class="v4-referral"><span>${bi('我的推荐码', 'Referral code')}</span><code>${esc(merchant.referral_code)}</code><button class="btn btn-sm" type="button" data-copy="${esc(merchant.referral_code)}"${tip('复制推荐码发给朋友，SIM 为他开通账号时填写', 'Copy the code for a friend; SIM enters it when opening their account')}>${bi('复制', 'Copy')}</button></div>` : '';
  const actions = authEnabled ? `<div class="btns v4-account-actions"><a class="btn" href="/login.html?change=1&amp;next=%2F%23me"${tip('修改登录密码', 'Change your sign-in password')}><i class="ti ti-key" aria-hidden="true"></i>${bi('修改密码', 'Change password')}</a><button class="btn" type="button" data-feedback-open${tip('给 SIM 留言：问题、建议或开通续费', 'Message SIM: questions, ideas or renewal')}><i class="ti ti-message-dots" aria-hidden="true"></i>${bi('意见反馈', 'Feedback')}</button><button class="btn btn-danger" type="button" data-logout${tip('退出登录，下次需要重新输入邮箱和密码', 'Sign out of the workspace')}><i class="ti ti-logout" aria-hidden="true"></i>${bi('退出登录', 'Sign out')}</button></div>`
    : `<div class="btns v4-account-actions"><button class="btn" type="button" data-feedback-open${tip('给 SIM 留言：问题、建议或开通续费', 'Message SIM: questions, ideas or renewal')}><i class="ti ti-message-dots" aria-hidden="true"></i>${bi('意见反馈', 'Feedback')}</button></div>`;
  return `<section class="m-me v4-account"><span class="avatar" aria-hidden="true">${esc((user?.display_name || user?.email || 'S').slice(0, 1).toUpperCase())}</span><div><b>${esc(user?.display_name || user?.email || 'SIM')}</b><p>${bi(roleZh, roleEn)}</p></div></section>
  <section class="card v4-account-card" aria-labelledby="account-title"><div class="ph"><div><h3 id="account-title">${bi('账户', 'Account')}</h3></div></div><div class="pb"><dl class="facts">${facts.map(([zh, en, value]) => `<div><dt>${bi(zh, en)}</dt><dd>${value}</dd></div>`).join('')}</dl>${usage}${referral}${actions}</div></section>`;
}

function render(user) {
  const root = document.querySelector('#me-root');
  if (!root) return;
  const menu = groups.map(([zh, en, items]) => [zh, en, items.filter(([view]) => viewAllowed(view, user))]).filter(([, , items]) => items.length);
  root.innerHTML = `${accountMarkup(user, { authEnabled: session.authEnabled })}${menu.map(([zh, en, items]) => `<h3 class="m-gt">${bi(zh, en)}</h3><ul class="m-list m-group">${items.map(([view, izh, ien, icon, tone]) => `<li><a class="m-menu" href="#${view}" data-open-view="${view}"${viewTip(view)}><span class="m-ico sm ${tone}"><i class="ti ti-${icon}" aria-hidden="true"></i></span><span class="t">${esc(izh)}<small>${esc(ien)}</small></span><span class="r"><i class="ti ti-chevron-right" aria-hidden="true"></i></span></a></li>`).join('')}</ul>`).join('')}`;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#me-root');
  if (root) {
    root.addEventListener('click', async event => {
      const link = event.target.closest('[data-open-view]');
      if (link) { event.preventDefault(); location.hash = `#${link.dataset.openView}`; return; }
      const copy = event.target.closest('[data-copy]');
      if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('已复制', 'Copied'); } catch { toast('请手动复制', 'Copy it manually', { tone: 'warn' }); } }
    });
    sessionReady.then(render);
  }
}
