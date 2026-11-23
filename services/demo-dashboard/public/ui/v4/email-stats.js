// 发信效果 / Email results on the 销售报表 page (plan item 6): sent, replies, bounces and complaints per day
// (30 days) or per month (12 months), and a note per sending mailbox. The automatic pause stays in 发信健康.
// API: GET /api/crm/email-stats?range=30d|12m
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';

export const WARNING_TEXT = Object.freeze({
  BOUNCE_HIGH: ['退信率 5% 以上，请先清理无效地址', 'Bounces at 5% or more; clean the list first'],
  BOUNCE_WATCH: ['退信率 2% 以上，留意收件地址质量', 'Bounces at 2% or more; watch address quality'],
  LOW_REPLIES: ['发了 50 封以上，回复率不到 1%，建议调整对象或内容', '50+ sent with under 1% replies; review the targets or the wording'],
  DAILY_VOLUME: ['有一天发了 40 封以上，建议分散发送', 'A day with 40+ emails; spread sending out'],
  COMPLAINTS: ['有收件人投诉为垃圾邮件', 'A recipient reported spam']
});
const LEVEL = Object.freeze({ HIGH: ['需要处理', 'Act now', 'bad'], WATCH: ['注意', 'Watch', 'warn'], OK: ['正常', 'OK', 'ok'] });
const pct = value => value === null || value === undefined ? '—' : `${value}%`;

/** Card markup (exported for tests). */
export function emailStatsMarkup(data, range = data?.range || '30d') {
  const t = data.totals || {};
  const rows = data.rows || [];
  const max = Math.max(1, ...rows.map(row => row.sent));
  const label = period => range === '12m' ? period : period.slice(5);
  const bars = rows.map(row => `<li><span class="k">${esc(label(row.period))}</span><span class="v4-bar" aria-hidden="true"><span style="width:${Math.round(row.sent / max * 100)}%"></span></span><span class="v">${bi(`发 ${row.sent} · 回 ${row.replied}${row.bounced ? ` · 退 ${row.bounced}` : ''}`, `sent ${row.sent} · replies ${row.replied}${row.bounced ? ` · bounced ${row.bounced}` : ''}`)}</span></li>`).join('');
  const toggle = ['30d', '12m'].map(key => `<button class="btn btn-sm" type="button" data-email-range="${key}" aria-pressed="${key === range}"${tip(key === '30d' ? '按天看最近 30 天' : '按月看最近 12 个月', key === '30d' ? 'Last 30 days, per day' : 'Last 12 months, per month')}>${key === '30d' ? bi('30 天', '30 days') : bi('12 个月', '12 months')}</button>`).join('');
  const boxes = (data.mailboxes || []).map(box => {
    const level = LEVEL[box.level] || LEVEL.OK;
    const name = box.sender_key === 'SIM' ? bi('SIM 发信邮箱', 'SIM mailbox') : esc(`${box.merchant_name ? `${box.merchant_name} · ` : ''}${box.label || '—'}`);
    const notes = (box.reasons || []).map(reason => `<li>${bi(...(WARNING_TEXT[reason] || [reason, reason]))}</li>`).join('');
    return `<li class="v4-mailbox-row"><div class="v4-key-row"><span class="t"><b>${name}</b><small>${bi(`发 ${box.totals?.sent ?? 0} · 回复率 ${pct(box.reply_rate)} · 退信率 ${pct(box.bounce_rate)}`, `sent ${box.totals?.sent ?? 0} · replies ${pct(box.reply_rate)} · bounces ${pct(box.bounce_rate)}`)}</small></span><span class="f"><span class="pill ${level[2]}">${bi(level[0], level[1])}</span></span></div>${notes ? `<ul class="v4-mini-list">${notes}</ul>` : ''}</li>`;
  }).join('');
  return `<section class="card v4-email-stats" aria-labelledby="email-stats-title"><div class="ph"><div><h3 id="email-stats-title">${bi('发信效果', 'Email results')}</h3><p>${bi('开发信和跟进信的发出、回复和退信；提示只作参考，自动暂停规则见发信健康', 'Emails sent, replies and bounces; notes are advice only, automatic pauses are under Sending health')}</p></div><div class="btns" role="group" aria-label="时间范围 Range">${toggle}</div></div>
    <div class="pb"><div class="v4-report-kpis v4-email-kpis">
      <div class="v4-report-kpi"><span class="k">${bi('发出', 'Sent')}</span><b>${t.sent ?? 0}</b></div>
      <div class="v4-report-kpi"><span class="k">${bi('回复率', 'Reply rate')}</span><b>${pct(t.reply_rate)}</b><small>${bi(`${t.replied ?? 0} 次回复`, `${t.replied ?? 0} replies`)}</small></div>
      <div class="v4-report-kpi"><span class="k">${bi('退信率', 'Bounce rate')}</span><b>${pct(t.bounce_rate)}</b><small>${bi(`${t.bounced ?? 0} 封退信 · ${t.complained ?? 0} 次投诉`, `${t.bounced ?? 0} bounced · ${t.complained ?? 0} complaints`)}</small></div></div>
      ${t.sent ? `<ul class="review-list v4-funnel v4-email-bars">${bars}</ul>` : `<p class="meta">${bi('这段时间还没有发出的邮件', 'No emails sent in this period')}</p>`}
      ${boxes ? `<h4 class="v4-subhead">${bi('发信邮箱', 'Mailboxes')}</h4><ul class="v4-key-list">${boxes}</ul>` : ''}</div></section>`;
}

const state = { range: '30d', data: null, error: false };
function render() {
  const root = document.getElementById('email-stats-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '发信效果暂未读取', 'Email results unavailable', { retry: true })}</section>`; return; }
  if (!state.data) { root.innerHTML = `<section class="card">${stateBlock('loading', '正在统计发信', 'Counting emails')}</section>`; return; }
  root.innerHTML = emailStatsMarkup(state.data, state.range);
}
async function load() {
  state.error = false; state.data = null; render();
  try { state.data = await managementRequest(`/api/crm/email-stats?range=${state.range}`); } catch { state.error = true; }
  render();
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('email-stats-root');
  if (root) root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void load(); return; }
    const button = event.target.closest('[data-email-range]');
    if (button && button.dataset.emailRange !== state.range) { state.range = button.dataset.emailRange; void load(); }
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'sales-reports') void load(); });
  sessionReady.then(() => { if (!document.getElementById('view-sales-reports')?.hidden) void load(); });
}
