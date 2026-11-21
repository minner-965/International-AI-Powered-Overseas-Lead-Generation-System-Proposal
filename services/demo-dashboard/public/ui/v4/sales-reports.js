// 销售报表 / Sales reports page and the 重点客户 / Key customers card on the workbench (migration 079).
// API: GET /api/crm/reports, GET/PUT /api/crm/reminder-rules, GET /api/crm/key-customers.
// Each account sees its own customers; the SIM administrator also sees each merchant's last 30 days.
import { LOST_REASONS, bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

export const STAGE_NAMES = Object.freeze({ NEW: ['新客户', 'New'], CONTACTED: ['已联系', 'Contacted'], REPLIED: ['已回复', 'Replied'], QUOTED: ['已报价', 'Quoted'],
  SAMPLE: ['寄样', 'Samples'], NEGOTIATING: ['谈判', 'Negotiating'], WON: ['成交', 'Won'], LOST: ['丢单', 'Lost'] });
export const FLAG_NAMES = Object.freeze({ HIGH_INTENT: ['高意向', 'Interested'], NO_FOLLOW_UP: ['太久没跟进', 'Gone quiet'],
  QUOTED_NO_REPLY: ['报价未回复', 'Quote unanswered'], SAMPLE_NO_CONFIRM: ['寄样未确认', 'Samples unconfirmed'] });
export const RISK_NAMES = Object.freeze({ OVERDUE_TASK: ['任务逾期', 'Task overdue'], LOW_HEALTH: ['健康度低', 'Low health'], CLOSE_DATE_PASSED: ['已过预计成交日', 'Close date passed'],
  NO_FOLLOW_UP: ['太久没跟进', 'Gone quiet'], QUOTED_NO_REPLY: ['报价未回复', 'Quote unanswered'], SAMPLE_NO_CONFIRM: ['寄样未确认', 'Samples unconfirmed'] });

/** 12,345.5 USD → "USD 12,346"; no currency → "—". */
export function moneyText(amount, currency) {
  if (amount === null || amount === undefined || !currency) return '—';
  return `${currency} ${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
/** " · 分级 A · USD 12,000" after the location, when a grade or amount was entered (migration 079). */
export function dealMeta(item) {
  const parts = [];
  if (item.customer_grade) parts.push(`${item.customer_grade} 级`);
  if (item.deal_amount !== null && item.deal_amount !== undefined && item.deal_currency) parts.push(`${item.deal_currency} ${Number(item.deal_amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  return parts.length ? ` · <b class="v4-deal-meta">${esc(parts.join(' · '))}</b>` : '';
}
export const PRIORITY = Object.freeze({ HIGH: ['高', 'High', 'bad'], NORMAL: ['普通', 'Normal', ''], LOW: ['低', 'Low', ''] });
/** Priority badge: shown for high and low only (normal is the default). */
export function priorityPill(priority) {
  const p = PRIORITY[priority];
  return p && priority !== 'NORMAL' ? ` <span class="pill ${p[2]}">${bi(`${p[0]}优先`, `${p[1]} priority`)}</span>` : '';
}
const pct = value => value === null || value === undefined ? '—' : `${value}%`;

function kpi(zh, en, value, hintZh = '', hintEn = '') {
  return `<div class="v4-report-kpi"><span class="k">${bi(zh, en)}</span><b>${value}</b>${hintZh ? `<small>${bi(hintZh, hintEn)}</small>` : ''}</div>`;
}

/** Report markup (exported for tests). */
export function reportMarkup(report) {
  const t = report.totals || {}; const cur = report.currency;
  const max = Math.max(1, ...(report.funnel || []).map(row => row.reached || 0));
  const funnel = (report.funnel || []).map(row => `<li><span class="k">${bi(...STAGE_NAMES[row.stage])}</span>
      <span class="v4-bar" aria-hidden="true"><span style="width:${Math.round((row.reached || 0) / max * 100)}%"></span></span>
      <span class="v">${bi(`到达 ${row.reached} · 当前 ${row.count}`, `reached ${row.reached} · now ${row.count}`)}${row.amount ? ` · ${esc(moneyText(row.amount, cur))}` : ''}${row.conversion !== null && row.conversion !== undefined ? ` <span class="pill">${bi(`转化 ${pct(row.conversion)}`, `${pct(row.conversion)} from previous`)}</span>` : ''}</span></li>`).join('');
  const countries = (report.countries || []).map(row => `<tr><td>${esc(row.country_code)}</td><td>${row.customers}</td><td>${row.active}</td><td>${row.won}</td><td>${esc(row.amount ? moneyText(row.amount, cur) : '—')}</td></tr>`).join('');
  const lost = (report.lost_reasons || []).map(row => `<li><span class="k">${LOST_REASONS[row.reason] ? bi(...LOST_REASONS[row.reason]) : esc(row.reason)}</span><span class="v">${row.count}</span></li>`).join('');
  const f = report.follow_up || {};
  const m = report.this_month || {};
  const others = (report.currencies || []).filter(row => row.currency !== cur);
  const otherLine = others.length ? `<p class="meta">${bi(`另有其他币种（不换算）：${others.map(row => `${moneyText(row.pipeline_amount, row.currency)} 在谈`).join('，')}`, `Other currencies, not converted: ${others.map(row => `${moneyText(row.pipeline_amount, row.currency)} in pipeline`).join(', ')}`)}</p>` : '';
  const expectedText = (m.expected_close?.amounts || []).map(row => moneyText(row.amount, row.currency)).join(' + ');
  const risks = (report.risks || []).map(row => `<li><div class="v4-key-row"><span class="t"><b>${esc(row.company_name)}</b><small>${esc(row.country_code || '—')} · ${bi(...(STAGE_NAMES[row.pipeline_stage] || [row.pipeline_stage, row.pipeline_stage]))}${row.deal_amount !== null && row.deal_amount !== undefined && row.deal_currency ? ` · ${esc(moneyText(row.deal_amount, row.deal_currency))}` : ''}</small></span><span class="f">${row.risks.map(risk => `<span class="pill warn">${bi(...(RISK_NAMES[risk] || [risk, risk]))}</span>`).join('')}</span></div></li>`).join('');
  const merchants = Array.isArray(report.merchants) ? `<section class="card" aria-labelledby="report-merchants-title"><div class="ph"><div><h3 id="report-merchants-title">${bi('商家近 30 天', 'Merchants, last 30 days')}</h3></div></div><div class="pb v4-table-wrap"><table class="v4-report-table"><thead><tr><th>${bi('商家', 'Merchant')}</th><th>${bi('新客户', 'New customers')}</th><th>${bi('跟进', 'Follow-ups')}</th><th>${bi('发信', 'Emails')}</th><th>${bi('成交', 'Won')}</th></tr></thead><tbody>${report.merchants.map(row => `<tr><td>${esc(row.company_name)}</td><td>${row.new_customers}</td><td>${row.follow_ups}</td><td>${row.emails_sent}</td><td>${row.won}</td></tr>`).join('') || `<tr><td colspan="5">${bi('还没有商家', 'No merchants yet')}</td></tr>`}</tbody></table></div></section>` : '';
  return `<div class="v4-report-kpis">${kpi('跟进中的客户', 'Active customers', t.active ?? 0, `共 ${t.customers ?? 0} 家`, `${t.customers ?? 0} in total`)}
      ${kpi('在谈金额', 'Pipeline value', esc(moneyText(t.pipeline_amount, cur)), `按赢率估算 ${moneyText(t.weighted_amount, cur)}`, `weighted ${moneyText(t.weighted_amount, cur)}`)}
      ${kpi('已成交', 'Won', t.won ?? 0, moneyText(t.won_amount, cur), moneyText(t.won_amount, cur))}
      ${kpi('逾期任务', 'Overdue tasks', `${f.overdue_tasks ?? 0} / ${f.open_tasks ?? 0}`, `逾期率 ${pct(f.overdue_rate)}`, `${pct(f.overdue_rate)} overdue`)}
      ${kpi('本月赢单率', 'Win rate this month', m.win_rate === null || m.win_rate === undefined ? '—' : pct(m.win_rate), m.win_rate === null || m.win_rate === undefined ? '本月还没有成交或丢单' : `成交 ${m.won} · 丢单 ${m.lost}`, m.win_rate === null || m.win_rate === undefined ? 'No deals closed this month' : `won ${m.won} · lost ${m.lost}`)}
      ${kpi('本月预计成交', 'Expected to close this month', m.expected_close?.count ?? 0, expectedText || '按预计成交日', expectedText || 'by expected close date')}</div>${otherLine}
    ${risks ? `<section class="card" aria-labelledby="report-risk-title"><div class="ph"><div><h3 id="report-risk-title">${bi('需要处理的商机', 'Deals at risk')}</h3><p>${bi('任务逾期、健康度低、过了预计成交日或太久没跟进的商机，问题多的排前面', 'Overdue tasks, low health, a passed close date or no recent contact; most issues first')}</p></div></div><div class="pb"><ul class="v4-key-list">${risks}</ul></div></section>` : ''}
    <div class="v4-report-grid">
      <section class="card" aria-labelledby="report-funnel-title"><div class="ph"><div><h3 id="report-funnel-title">${bi('成交漏斗', 'Sales funnel')}</h3><p>${bi('每个阶段曾经到达的客户数，以及从上一阶段走到这一步的比例', 'Customers that reached each stage, and the share that moved on from the previous one')}</p></div></div><ul class="review-list v4-funnel">${funnel}</ul></section>
      <section class="card" aria-labelledby="report-health-title"><div class="ph"><div><h3 id="report-health-title">${bi('跟进健康度', 'Follow-up health')}</h3></div></div><ul class="review-list">
        <li><span class="k">${bi('客户回复后多久跟进', 'Time to answer a reply')}</span><span class="v">${f.avg_response_hours === null || f.avg_response_hours === undefined ? bi('近 90 天还没有回复', 'No replies in 90 days') : bi(`平均 ${f.avg_response_hours} 小时（${f.replies_90d} 次回复）`, `${f.avg_response_hours} h on average (${f.replies_90d} replies)`)}</span></li>
        <li><span class="k">${bi('报价后未回复', 'Quotes unanswered')}</span><span class="v">${f.quoted_no_reply ?? 0}</span></li>
        <li><span class="k">${bi('太久没跟进', 'Gone quiet')}</span><span class="v">${f.no_follow_up ?? 0}</span></li>
        <li><span class="k">${bi('丢单原因', 'Lost reasons')}</span><span class="v">${lost ? `<ul class="v4-mini-list">${lost}</ul>` : bi('暂无丢单', 'No lost deals')}</span></li></ul></section>
    </div>
    <section class="card" aria-labelledby="report-country-title"><div class="ph"><div><h3 id="report-country-title">${bi('各国客户', 'Customers by country')}</h3></div></div><div class="pb v4-table-wrap"><table class="v4-report-table"><thead><tr><th>${bi('国家', 'Country')}</th><th>${bi('客户', 'Customers')}</th><th>${bi('跟进中', 'Active')}</th><th>${bi('成交', 'Won')}</th><th>${bi('金额', 'Value')}</th></tr></thead><tbody>${countries || `<tr><td colspan="5">${bi('还没有客户', 'No customers yet')}</td></tr>`}</tbody></table></div>${cur ? `<p class="meta">${bi(`金额以最常用的币种 ${cur} 统计`, `Values counted in the most used currency, ${cur}`)}</p>` : ''}</section>
    ${merchants}`;
}

/** Reminder rules form (exported for tests). */
export function rulesMarkup(rules, { busy = false } = {}) {
  const field = (name, zh, en, tipZh, tipEn) => `<div class="field"><label for="rules-${name}">${bi(zh, en)}</label><input id="rules-${name}" name="${name}" type="number" inputmode="numeric" min="1" max="90" step="1" value="${esc(rules[name])}"${busy ? ' disabled' : ''}${tip(tipZh, tipEn)}></div>`;
  return `<section class="card" aria-labelledby="rules-title"><div class="ph"><div><h3 id="rules-title">${bi('跟进提醒规则', 'Reminder rules')}</h3><p>${bi('到了天数，系统每小时自动在“我的任务”里加一条提醒；同一家客户同一种提醒只会有一条', 'When the days pass, a reminder task is added to My tasks (checked hourly); one per customer and kind')}</p></div></div>
    <form class="pb" data-rules-form novalidate><ul class="review-list v3-automation-switches"><li><span class="k">${bi('自动提醒', 'Automatic reminders')}</span><span class="v"><label class="v4-switch"${tip('关闭后不再自动生成提醒任务，已有任务不受影响', 'When off, no new reminder tasks are added; existing ones stay')}><input type="checkbox" role="switch" name="enabled"${rules.enabled ? ' checked' : ''}${busy ? ' disabled' : ''} aria-label="自动提醒 Automatic reminders"><span aria-hidden="true"></span></label></span></li></ul>
      <div class="form-grid">${field('no_follow_up_days', '多少天没联系就提醒', 'Days without contact', '已联系、已回复、报价、寄样、谈判阶段的客户，超过这么多天没有任何联系就提醒', 'Remind when an active customer has had no contact for this many days')}
      ${field('quoted_no_reply_days', '报价后几天没回复提醒', 'Days after a quote', '报价后客户这么多天没有回复就提醒，优先级为高', 'Remind (high priority) when a quote gets no reply for this many days')}
      ${field('sample_no_confirm_days', '寄样后几天没确认提醒', 'Days after samples', '寄样后客户这么多天没有回复确认就提醒，优先级为高', 'Remind (high priority) when samples get no confirmation for this many days')}</div>
      <p class="v4-form-status" role="status" aria-live="polite" data-rules-status></p>
      <div class="btns"><button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}${tip('保存提醒规则，只影响您自己的客户', 'Save the reminder rules for your own customers')}>${bi('保存规则', 'Save rules')}</button></div></form></section>`;
}

const state = { report: null, rules: null, error: false, busy: false };
function render() {
  const root = document.getElementById('sales-reports-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '报表暂未读取', 'Reports unavailable', { retry: true })}</section>`; return; }
  if (!state.report || !state.rules) { root.innerHTML = `<section class="card">${stateBlock('loading', '正在统计', 'Counting')}</section>`; return; }
  root.innerHTML = `${reportMarkup(state.report)}${rulesMarkup(state.rules, { busy: state.busy })}`;
}
export async function loadReports() {
  state.error = false; render();
  try { [state.report, state.rules] = await Promise.all([managementRequest('/api/crm/reports'), managementRequest('/api/crm/reminder-rules')]); }
  catch { state.error = true; }
  render();
}
async function saveRules(form) {
  const status = form.querySelector('[data-rules-status]');
  const body = { enabled: form.enabled.checked, no_follow_up_days: Number(form.no_follow_up_days.value), quoted_no_reply_days: Number(form.quoted_no_reply_days.value), sample_no_confirm_days: Number(form.sample_no_confirm_days.value) };
  if (Object.entries(body).some(([key, value]) => key !== 'enabled' && !(Number.isInteger(value) && value >= 1 && value <= 90))) { status.innerHTML = bi('天数请填 1 到 90 的整数', 'Use whole days from 1 to 90'); return; }
  state.busy = true; status.innerHTML = bi('正在保存', 'Saving');
  try { state.rules = await managementRequest('/api/crm/reminder-rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); state.busy = false; render(); toast('提醒规则已保存', 'Reminder rules saved'); }
  catch { state.busy = false; render(); const again = document.querySelector('[data-rules-status]'); if (again) again.innerHTML = bi('未能保存，请重试', 'Could not save; please retry'); }
}

// ---- 重点客户 on the workbench ----
/** Key-customer card (exported for tests). */
export function keyCustomersMarkup(data) {
  const items = (data.items || []).slice(0, 8);
  const c = data.counts || {};
  const chips = Object.entries({ quoted_no_reply: 'QUOTED_NO_REPLY', sample_no_confirm: 'SAMPLE_NO_CONFIRM', no_follow_up: 'NO_FOLLOW_UP', high_intent: 'HIGH_INTENT' })
    .map(([key, flag]) => `<span class="pill${['QUOTED_NO_REPLY', 'SAMPLE_NO_CONFIRM', 'NO_FOLLOW_UP'].includes(flag) && c[key] ? ' warn' : ''}">${bi(`${FLAG_NAMES[flag][0]} ${c[key] || 0}`, `${FLAG_NAMES[flag][1]} ${c[key] || 0}`)}</span>`).join('');
  const rows = items.map(item => `<li><a class="v4-key-row" href="#opportunities" data-key-company="${esc(item.company_id)}"${tip('打开销售机会，查看并跟进这家客户', 'Open opportunities to follow up this customer')}><span class="t"><b>${esc(item.company_name)}</b><small>${esc(item.country_code || '')} · ${bi(...(STAGE_NAMES[item.pipeline_stage] || [item.pipeline_stage, item.pipeline_stage]))}${item.customer_grade ? ` · ${esc(item.customer_grade)}` : ''}${item.deal_amount ? ` · ${esc(moneyText(item.deal_amount, item.deal_currency))}` : ''}</small></span><span class="f">${item.flags.filter(flag => flag !== 'HIGH_INTENT').map(flag => `<span class="pill warn">${bi(...FLAG_NAMES[flag])}</span>`).join('') || `<span class="pill ok">${bi(...FLAG_NAMES.HIGH_INTENT)}</span>`}</span></a></li>`).join('');
  return `<section class="card v4-key-customers" aria-labelledby="key-customers-title"><div class="ph"><div><h3 id="key-customers-title">${bi('重点客户', 'Key customers')}</h3><p>${bi('高意向、太久没跟进、报价或寄样后还没回复的客户', 'Interested customers, and ones that have gone quiet after contact, a quote or samples')}</p></div><a class="btn btn-sm" href="#sales-reports"${tip('查看完整销售报表和提醒规则', 'See the full sales reports and reminder rules')}>${bi('销售报表', 'Reports')}</a></div>
    <div class="pb"><div class="v4-key-chips">${chips}</div>${rows ? `<ul class="v4-key-list">${rows}</ul>` : `<p class="meta">${bi('目前没有需要特别关注的客户', 'No customers need special attention right now')}</p>`}</div></section>`;
}
async function loadKeyCustomers() {
  const overview = document.getElementById('view-overview');
  if (!overview) return;
  let host = document.getElementById('overview-key-customers');
  if (!host) {
    host = document.createElement('div'); host.id = 'overview-key-customers';
    const after = document.getElementById('overview-onboarding') || overview.querySelector('.v3-overview-heading');
    if (after) after.after(host); else overview.prepend(host);
  }
  try { host.innerHTML = keyCustomersMarkup(await managementRequest('/api/crm/key-customers')); }
  catch { host.innerHTML = ''; }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('sales-reports-root');
  if (root) {
    root.addEventListener('submit', event => { if (event.target.matches('[data-rules-form]')) { event.preventDefault(); void saveRules(event.target); } });
    root.addEventListener('click', event => { if (event.target.closest('[data-state-retry]')) void loadReports(); });
  }
  document.addEventListener('crm:viewchange', event => {
    if (event.detail?.view === 'sales-reports') void loadReports();
    if (event.detail?.view === 'overview') void loadKeyCustomers();
  });
  sessionReady.then(() => {
    if (!document.getElementById('view-sales-reports')?.hidden) void loadReports();
    if (!document.getElementById('view-overview')?.hidden) void loadKeyCustomers();
  });
}
