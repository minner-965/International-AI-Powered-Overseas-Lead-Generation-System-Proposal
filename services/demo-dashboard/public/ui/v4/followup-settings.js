// 跟进邮件设置 / Follow-up email settings (settings page, SIM administrator). Whether follow-up emails 2 and 3
// are drafted for approval, and SIM's daily limit for first emails + follow-ups from SIM's own mailbox.
// API: GET/PUT /api/automation/followup-settings (every change is kept in the change history on the server).
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const API = '/api/automation/followup-settings';
const state = { data: null, error: false, busy: false };
const ERRORS = Object.freeze({
  FOLLOWUP_DAILY_LIMIT_INVALID: ['每日上限请填写 1 到 1000 之间的整数', 'Enter a whole number from 1 to 1000'],
  FOLLOWUP_SETTINGS_UNAVAILABLE: ['跟进邮件设置暂不可用，请联系技术支持', 'Follow-up settings are not available yet']
});
const errorPair = error => ERRORS[error?.code] || (error?.status === 403 ? ['当前账号不能修改这项设置', 'Your account cannot change this setting'] : ['未能保存，请重试', 'Could not save; please retry']);

/** Card markup for the current settings (exported for tests). */
export function followupSettingsMarkup(data, { busy = false } = {}) {
  const source = data.source === 'WORKSPACE'
    ? bi(`最近由 ${data.updated_by || '—'} 保存${data.updated_at ? ` · ${new Date(data.updated_at).toLocaleString('zh-CN')}` : ''}`, `Last saved by ${data.updated_by || '—'}`)
    : bi('当前使用服务器的初始设置，保存后以这里为准', 'Using the initial server values; once saved, this page decides');
  return `<form class="v4-followup-settings" novalidate data-followup-settings-form>
    <ul class="review-list v3-automation-switches"><li><span class="k">${bi('起草跟进邮件', 'Draft follow-up emails')}<small class="v3-automation-note" id="followup-settings-note">${bi('客户没回复时，按计划起草第 2、3 封跟进邮件，经您批准后才发出', 'When there is no reply, emails 2 and 3 are drafted on schedule and sent only after you approve them')}</small></span><span class="v"><label class="v4-switch"${tip('开启后每小时检查一次需要跟进的客户并起草邮件；关闭后不再起草，已批准的仍会发出', 'When on, prospects due for follow-up are checked hourly and drafts are created; when off nothing new is drafted, approved ones still go out')}><input type="checkbox" role="switch" name="enabled"${data.enabled ? ' checked' : ''}${busy ? ' disabled' : ''} aria-label="起草跟进邮件 Draft follow-up emails" aria-describedby="followup-settings-note"><span aria-hidden="true"></span></label></span></li></ul>
    <div class="form-grid"><div class="field"><label for="followup-daily-limit">${bi('每日发信上限（SIM 邮箱）', 'Daily email limit (SIM mailbox)')}</label><input id="followup-daily-limit" name="daily_limit" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${esc(data.daily_limit)}"${busy ? ' disabled' : ''}${tip('SIM 自己的邮箱每天最多发出的开发信和跟进邮件总数；商家按各自的每日额度', 'Most first and follow-up emails SIM\'s own mailbox sends per day; merchants use their own daily quota')}></div></div>
    <p class="meta">${source}</p>
    <div class="btns"><button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}${tip('保存跟进邮件设置，修改会记录在变更历史里', 'Save the follow-up settings; the change is kept in the history')}>${bi('保存设置', 'Save settings')}</button></div>
    <p class="v4-form-status" role="status" aria-live="polite" data-followup-settings-status></p></form>`;
}

function render() {
  const host = document.getElementById('followup-settings-body');
  if (!host) return;
  if (state.error) { host.innerHTML = stateBlock('error', '跟进邮件设置暂未读取', 'Follow-up settings unavailable', { retry: true }); return; }
  if (!state.data) { host.innerHTML = stateBlock('loading', '正在读取', 'Loading'); return; }
  host.innerHTML = followupSettingsMarkup(state.data, { busy: state.busy });
}

export async function loadFollowupSettings() {
  state.error = false;
  try { state.data = await managementRequest(API); } catch { state.error = true; state.data = null; }
  render();
}

async function save(form) {
  const status = form.querySelector('[data-followup-settings-status]');
  const limit = Number(form.daily_limit.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) { status.innerHTML = bi(...ERRORS.FOLLOWUP_DAILY_LIMIT_INVALID); form.daily_limit.focus(); return; }
  const body = { enabled: form.enabled.checked, daily_limit: limit };
  state.busy = true; status.innerHTML = bi('正在保存', 'Saving');
  try {
    state.data = await managementRequest(API, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    state.busy = false; render(); toast('跟进邮件设置已保存', 'Follow-up settings saved');
  } catch (error) {
    state.busy = false; render();
    const again = document.querySelector('[data-followup-settings-status]'); if (again) again.innerHTML = bi(...errorPair(error));
  }
}

function mount() {
  const root = document.getElementById('followup-settings-root');
  if (!root) return;
  root.innerHTML = `<section class="card crm-panel" aria-labelledby="followup-settings-title"><header class="card-header crm-panel-header"><div><h3 id="followup-settings-title" class="card-title">${bi('跟进邮件', 'Follow-up emails')}</h3></div></header><div class="card-body" id="followup-settings-body"></div></section>`;
  render();
  root.addEventListener('submit', event => { if (event.target.matches('[data-followup-settings-form]')) { event.preventDefault(); void save(event.target); } });
  root.addEventListener('click', event => { if (event.target.closest('[data-state-retry]')) void loadFollowupSettings(); });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'settings') void loadFollowupSettings(); });
  sessionReady.then(user => { if (user?.role === 'ADMIN' && !document.getElementById('view-settings')?.hidden) void loadFollowupSettings(); });
}
if (typeof document !== 'undefined') mount();
