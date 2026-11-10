// 发信健康 / Sending health (optimization plan batch 4). Shared by the merchant mailbox page and the
// SIM administrator's settings card:
//   - a mailbox pauses itself after a complaint or too many hard bounces; a person resumes it
//   - a new mailbox sends a few automatic first emails a day at first, at least 15 minutes apart
//   - the sending domain's SPF / DKIM / DMARC records, with what to do when one is missing
// API: GET /api/merchant/mailbox/deliverability, POST /api/merchant/mailbox/resume-sending (merchant),
//      GET /api/admin/sender-health, POST /api/admin/merchants/:id/resume-sending (SIM administrator).
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady, session } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

export const DELIVERABILITY_HOLDS = Object.freeze(['BOUNCE_RATE_HIGH', 'COMPLAINT_RECEIVED']);
const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
const when = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';

/** Why a mailbox is paused, in plain words. */
export function pauseText(reason, metrics = {}) {
  if (reason === 'COMPLAINT_RECEIVED') return ['已暂停：有收件人把邮件标记为垃圾邮件（投诉）。请检查收件名单和邮件内容，处理后再恢复发信', 'Paused: a recipient reported an email as spam. Check the list and the content, then resume'];
  if (reason === 'BOUNCE_RATE_HIGH') return [`已暂停：最近 ${metrics.sent ?? '—'} 封中有 ${metrics.hard_bounces ?? '—'} 封退信（${pct(metrics.bounce_rate)}），超过 3%。请删掉无效地址后再恢复发信`, `Paused: ${metrics.hard_bounces ?? '—'} of the last ${metrics.sent ?? '—'} emails bounced (${pct(metrics.bounce_rate)}), above 3%. Remove invalid addresses, then resume`];
  return ['已暂停发信', 'Sending is paused'];
}

/** Warm-up and spacing line for today. */
export function pacingText(pacing = {}) {
  if (!pacing.warmup_enabled) return [`两封邮件之间至少间隔 ${pacing.min_interval_minutes ?? 15} 分钟`, `At least ${pacing.min_interval_minutes ?? 15} minutes between emails`];
  const cap = pacing.warmup_cap_today ?? '—'; const sent = pacing.sent_today ?? 0;
  const next = pacing.next_allowed_at ? `；下一封最早 ${when(pacing.next_allowed_at)}` : '';
  const nextEn = pacing.next_allowed_at ? `; next one from ${new Date(pacing.next_allowed_at).toLocaleString('en-GB', { hour12: false })}` : '';
  return [`逐步放量：今天最多自动发 ${cap} 封，已发 ${sent} 封；两封至少间隔 ${pacing.min_interval_minutes ?? 15} 分钟${next}`, `Warm-up: up to ${cap} automatic emails today, ${sent} sent; at least ${pacing.min_interval_minutes ?? 15} minutes apart${nextEn}`];
}

const DNS_HINT = Object.freeze({
  spf: ['在域名解析里添加一条 TXT 记录，例如 v=spf1 include:（邮箱服务商提供的地址）~all', 'Add a TXT record such as v=spf1 include:<your provider> ~all'],
  dkim: ['在邮箱服务商后台开启 DKIM 签名，并按提示把公钥加到域名解析；如果已用其他选择器开启，可以忽略', 'Turn on DKIM signing with your provider and publish its key; ignore this if it uses another selector'],
  dmarc: ['在 _dmarc 子域添加 TXT 记录，例如 v=DMARC1; p=none; rua=mailto:（您的邮箱）', 'Add a TXT record at _dmarc, e.g. v=DMARC1; p=none; rua=mailto:<you>']
});
/** One row per record: [label zh, label en, ok?, status zh, status en, key]. Setup steps are listed separately (dnsHints). */
export function dnsRows(dns) {
  if (!dns || dns.status === 'INVALID_DOMAIN') return [];
  const row = (key, zh, en, item) => {
    if (item?.status === 'FOUND') return [zh, en, true, key === 'dkim' ? `已找到（选择器 ${item.selector}）` : key === 'dmarc' ? `已设置${item.policy ? `（策略 ${item.policy}）` : ''}` : '已设置', key === 'dkim' ? `Found (selector ${item.selector})` : 'Set', key];
    if (item?.status === 'LOOKUP_FAILED') return [zh, en, false, '暂时查不到，请稍后再查', 'Lookup failed; try later', key];
    if (item?.status === 'MULTIPLE') return [zh, en, false, '有多条记录，只能保留一条', 'More than one record; keep one', key];
    if (key === 'dkim') return [zh, en, false, '常用选择器下未找到', 'Not found (common selectors)', key];
    return [zh, en, false, '未设置', 'Missing', key];
  };
  return [row('spf', 'SPF 发信授权', 'SPF', dns.spf), row('dkim', 'DKIM 签名', 'DKIM', dns.dkim), row('dmarc', 'DMARC 策略', 'DMARC', dns.dmarc)];
}

/** Setup steps for each record that is missing or not found. */
export function dnsHints(rows) {
  return rows.filter(row => !row[2] && DNS_HINT[row[5]] && !/稍后/.test(row[3])).map(row => [row[0], row[1], ...DNS_HINT[row[5]]]);
}

/** Card body for one mailbox. `resume` is the data attribute value for the resume button (or null). */
export function deliverabilityMarkup({ health, dns, hold }, { resume = null, domainLabel = null } = {}) {
  const pausedReason = DELIVERABILITY_HOLDS.includes(hold?.reason) ? hold.reason : health?.paused?.reason || null;
  const metrics = health?.paused?.metrics || health?.metrics || {};
  const paused = pausedReason ? `<div class="v4-sender-paused" role="alert" data-sender-paused><p>${bi(...pauseText(pausedReason, metrics))}</p>${resume ? `<button class="btn btn-primary" type="button" data-sender-resume="${esc(resume)}"${tip('确认已清理收件名单或处理投诉后，恢复从这个邮箱发信；之后从零重新统计退信率', 'Resume sending after cleaning the list or handling the complaint; the bounce count starts again from zero')}><i class="ti ti-player-play" aria-hidden="true"></i>${bi('已处理，恢复发信', 'Resume sending')}</button>` : ''}</div>` : '';
  const m = health?.metrics || {};
  const rows = dnsRows(dns);
  const hints = dnsHints(rows);
  const hintList = hints.length ? `<details class="v4-dns-hints" data-dns-hints><summary>${bi('怎么设置', 'How to set up')}</summary><ul>${hints.map(([zh, en, hzh, hen]) => `<li><b>${esc(zh)}</b>${bi(hzh, hen)}</li>`).join('')}</ul></details>` : '';
  const dnsList = rows.length ? `<ul class="review-list v4-dns-list" data-dns-list>${rows.map(([zh, en, ok, tzh, ten]) => `<li class="${ok ? 'ok' : 'bad'}"><span class="k">${bi(zh, en)}</span><span class="v"><i class="ti ti-${ok ? 'circle-check' : 'alert-triangle'}" aria-hidden="true"></i>${bi(tzh, ten)}</span></li>`).join('')}</ul>${hintList}` : `<p class="meta">${bi('保存邮箱后显示域名检查结果', 'The domain check appears once a mailbox is saved')}</p>`;
  return `${paused}
    <ul class="review-list" data-sender-metrics><li><span class="k">${bi('最近退信', 'Recent bounces')}</span><span class="v">${bi(`最近 ${m.sent ?? 0} 封中退信 ${m.hard_bounces ?? 0} 封（${pct(m.bounce_rate)}）· 投诉 ${m.complaints ?? 0}`, `${m.hard_bounces ?? 0} of ${m.sent ?? 0} bounced (${pct(m.bounce_rate)}) · complaints ${m.complaints ?? 0}`)}</span></li>
    <li><span class="k">${bi('今天的发信节奏', 'Today\'s pace')}</span><span class="v">${bi(...pacingText(health?.pacing))}</span></li></ul>
    <h4 class="v4-subhead">${bi('域名设置检查', 'Domain check')}${dns?.domain || domainLabel ? ` <small>${esc(dns?.domain || domainLabel)}</small>` : ''}</h4>
    ${dnsList}
    <p class="meta">${bi('SPF、DKIM、DMARC 都设置好，开发信更不容易进垃圾箱。这里只做提醒，不影响发信。', 'With SPF, DKIM and DMARC set, emails are less likely to land in spam. This is advice only; sending is not blocked.')}</p>`;
}

// ---- SIM administrator card (settings page) ----
const admin = { data: null, error: false, busy: false };
export function adminSenderHealthMarkup(data) {
  const simPaused = data.sim?.paused ? `<p class="meta">${bi('恢复方法：在上方“自动化”里重新打开“自动发送开发信”，系统会从零重新统计。', 'To resume, switch automatic first emails back on above; counting starts again from zero.')}</p>` : '';
  const merchants = (data.merchants || []).filter(item => item.hold || !item.health?.healthy);
  const list = merchants.length ? `<ul class="review-list" data-merchant-senders>${merchants.map(item => `<li><span class="k">${esc(item.company_name)}<small>${esc(item.from_email || '')}</small></span><span class="v">${bi(...pauseText(item.hold?.reason || item.health?.paused?.reason, item.health?.paused?.metrics || item.health?.metrics))}${DELIVERABILITY_HOLDS.includes(item.hold?.reason) ? ` <button class="btn btn-sm" type="button" data-sender-resume="${esc(item.merchant_id)}"${tip('确认商家已处理后，恢复这个商家邮箱的发信', 'Resume this merchant\'s mailbox after the problem is handled')}>${bi('恢复发信', 'Resume')}</button>` : ''}</span></li>`).join('')}</ul>`
    : `<p class="meta">${bi(`${(data.merchants || []).length} 个商家邮箱都正常`, `All ${(data.merchants || []).length} merchant mailboxes are fine`)}</p>`;
  return `<h4 class="v4-subhead">${bi('SIM 邮箱', 'SIM mailbox')}${data.sim?.sender_email ? ` <small>${esc(data.sim.sender_email)}</small>` : ''}</h4>
    ${deliverabilityMarkup({ health: data.sim, dns: data.sim?.dns, hold: null })}${simPaused}
    <h4 class="v4-subhead">${bi('商家邮箱', 'Merchant mailboxes')}</h4>${list}`;
}
function renderAdmin() {
  const host = document.getElementById('sender-health-body');
  if (!host) return;
  if (admin.error) { host.innerHTML = stateBlock('error', '发信健康暂未读取', 'Sending health unavailable', { retry: true }); return; }
  if (!admin.data) { host.innerHTML = stateBlock('loading', '正在读取', 'Loading'); return; }
  host.innerHTML = adminSenderHealthMarkup(admin.data);
}
export async function loadAdminSenderHealth() {
  admin.error = false;
  try { admin.data = await managementRequest('/api/admin/sender-health'); } catch { admin.error = true; admin.data = null; }
  renderAdmin();
}
function mountAdmin() {
  const root = document.getElementById('sender-health-root');
  if (!root) return;
  root.innerHTML = `<section class="card crm-panel" aria-labelledby="sender-health-title"><header class="card-header crm-panel-header"><div><h3 id="sender-health-title" class="card-title">${bi('发信健康', 'Sending health')}</h3></div><div class="btns"><button class="btn btn-outline-primary" type="button" data-sender-health-refresh${tip('重新统计退信、投诉，并重新检查域名设置', 'Count bounces and complaints again and re-check the domain')}><i class="ti ti-refresh" aria-hidden="true"></i>${bi('刷新', 'Refresh')}</button></div></header><div class="card-body" id="sender-health-body"></div></section>`;
  renderAdmin();
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-state-retry],[data-sender-health-refresh]')) { void loadAdminSenderHealth(); return; }
    const button = event.target.closest('[data-sender-resume]');
    if (!button || admin.busy) return;
    admin.busy = true; button.disabled = true;
    try {
      await managementRequest(`/api/admin/merchants/${encodeURIComponent(button.dataset.senderResume)}/resume-sending`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      toast('已恢复这个商家邮箱的发信', 'Sending resumed for this mailbox');
    } catch { toast('未能恢复，请刷新后重试', 'Could not resume; refresh and retry', { tone: 'warn' }); }
    finally { admin.busy = false; void loadAdminSenderHealth(); }
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'settings' && session.user?.role === 'ADMIN') void loadAdminSenderHealth(); });
  sessionReady.then(user => { if (user?.role === 'ADMIN') { if (!document.getElementById('view-settings')?.hidden) void loadAdminSenderHealth(); } else root.hidden = true; });
}
if (typeof document !== 'undefined') mountAdmin();
