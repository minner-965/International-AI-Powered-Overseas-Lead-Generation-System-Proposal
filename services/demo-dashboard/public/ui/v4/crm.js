// CRM follow-up client: pipeline stages, tasks, activities, reply review and follow-up drafts.
// Reads and writes go through the shared management request helper (same session and errors).
import { managementRequest } from '../../phase7-ui.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;

export const STAGES = Object.freeze([
  ['NEW', '待联系', 'New', 's-new'], ['CONTACTED', '已联系', 'Contacted', 's-contacted'], ['REPLIED', '已回复', 'Replied', 's-replied'],
  ['QUOTED', '报价', 'Quoted', 's-quoted'], ['SAMPLE', '样品', 'Sample', 's-sample'], ['NEGOTIATING', '洽谈', 'Negotiating', 's-nego'],
  ['WON', '成交', 'Won', 's-won'], ['LOST', '流失', 'Lost', 's-lost']
]);
export const stageLabel = code => STAGES.find(([key]) => key === code) || ['NEW', '待联系', 'New', 's-new'];
export const stageMarkup = code => { const [, zh, en, cls] = stageLabel(code); return `<span class="stage ${cls}">${bi(zh, en)}</span>`; };

export const TASK_TYPES = Object.freeze({
  FOLLOW_UP: ['跟进', 'Follow-up', ''], REPLY_REVIEW: ['回复处理', 'Reply review', 'info'], QUOTATION: ['报价', 'Quotation', ''],
  SAMPLE: ['样品', 'Sample', ''], MEETING: ['会议', 'Meeting', ''], CRM_HANDOFF: ['移交跟进', 'Handoff', ''], OTHER: ['其他', 'Other', '']
});
export const taskTypePill = code => { const [zh, en, tone] = TASK_TYPES[code] || TASK_TYPES.OTHER; return `<span class="pill ${tone}">${bi(zh, en)}</span>`; };
export const taskDot = code => ({ REPLY_REVIEW: 'd-reply', QUOTATION: 'd-quote', SAMPLE: 'd-sample', MEETING: 'd-meet' }[code] || 'd-follow');

export const ACTIVITY_TYPES = Object.freeze([
  ['CALL', '电话', 'Call', 'phone'], ['WHATSAPP', 'WhatsApp', 'WhatsApp', 'brand-whatsapp'],
  ['MEETING', '会议', 'Meeting', 'calendar-event'], ['NOTE', '备注', 'Note', 'pencil'], ['EMAIL_MANUAL', '邮件', 'Email', 'mail']
]);
export const REPLY_INTENTS = Object.freeze({
  CATALOGUE: ['要目录', 'Catalog', ''], SAMPLE: ['要样品', 'Sample request', 'info'], QUOTATION: ['询价', 'Price inquiry', 'info'],
  MEETING: ['约会议', 'Meeting', 'info'], DEFER: ['以后再联系', 'Later', 'warn'], DECLINE: ['婉拒', 'Declined', 'bad'],
  OPT_OUT: ['退订', 'Opt-out', 'bad'], AUTO_REPLY: ['自动回复', 'Auto-reply', ''], IRRELEVANT: ['无关回复', 'Irrelevant', ''], REVIEW: ['待判断', 'To review', 'warn']
});
export const intentPill = code => { const [zh, en, tone] = REPLY_INTENTS[code] || REPLY_INTENTS.REVIEW; return `<span class="pill ${tone}">${bi(zh, en)}</span>`; };

const pad = value => String(value).padStart(2, '0');
const dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
/** Due/occurred time as 今天 HH:MM, 昨天/明天 HH:MM or MM/DD HH:MM, plus whole overdue days. */
export function when(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.round((dayStart(date) - dayStart(now)) / 86400000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const [zh, en] = days === 0 ? ['今天', 'Today'] : days === -1 ? ['昨天', 'Yesterday'] : days === 1 ? ['明天', 'Tomorrow']
    : [`${pad(date.getMonth() + 1)}/${pad(date.getDate())}`, `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`];
  const overdueDays = date < now ? Math.max(1, Math.floor((now - date) / 86400000)) : 0;
  return { zh: `${zh} ${time}`, en: `${en} ${time}`, days, overdueDays, overdue: date < now };
}
export const shortDate = value => { const w = when(value); return w ? w.zh : '—'; };
export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const fromLocalInput = value => value ? new Date(value).toISOString() : null;

const query = params => { const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')); return q.toString() ? `?${q}` : ''; };
const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const crm = {
  pipeline: (params = {}) => managementRequest(`/api/crm/pipeline${query(params)}`),
  setStage: (opportunityId, body) => json(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}/stage`, body),
  addActivity: (opportunityId, body) => json(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}/activities`, body),
  timeline: companyId => managementRequest(`/api/crm/companies/${encodeURIComponent(companyId)}/timeline`),
  tasks: (params = {}) => managementRequest(`/api/crm/tasks${query(params)}`),
  createTask: body => json('/api/crm/tasks', body),
  updateTask: (taskId, body) => json(`/api/crm/tasks/${encodeURIComponent(taskId)}`, body, 'PATCH'),
  reviewReply: (classificationId, body) => json(`/api/crm/replies/${encodeURIComponent(classificationId)}/review`, body),
  drafts: (params = {}) => managementRequest(`/api/crm/followup-drafts${query(params)}`),
  decideDraft: (draftId, body) => json(`/api/crm/followup-drafts/${encodeURIComponent(draftId)}/decision`, body)
};

/** Announce a CRM write so lists, counters and the overview refresh. */
export const notifyCrmChange = detail => document.dispatchEvent(new CustomEvent('crm:changed', { detail }));

export const errorText = error => error?.status === 403 ? ['当前账号没有此操作权限', 'Your role cannot perform this action']
  : error?.status === 409 ? ['记录已被他人更新，请刷新后重试', 'The record changed. Refresh and retry']
  : error?.status === 503 ? ['系统维护中，暂不能保存', 'Saving is paused during maintenance']
  : ['未能完成，请重试', 'Could not complete. Please retry'];

export function stateBlock(kind, zh, en, { retry = false } = {}) {
  const icon = kind === 'error' ? 'alert-circle' : kind === 'loading' ? 'loader' : 'inbox';
  return `<div class="state" ${kind === 'error' ? 'role="alert"' : kind === 'loading' ? 'aria-busy="true"' : ''}><div class="glyph" aria-hidden="true"><i class="ti ti-${icon}"></i></div><b>${bi(zh, en)}</b>${retry ? `<button class="btn btn-sm" type="button" data-state-retry>${bi('重试', 'Retry')}</button>` : ''}</div>`;
}
export const skeletonRows = (rows = 3) => `<div class="skel-rows" aria-busy="true" aria-label="正在加载 Loading">${Array.from({ length: rows }, () => '<div class="skel-row"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>').join('')}</div>`;

// Shared pipeline snapshot (one request serves the list, the company card and pickers).
let pipelineCache = null; let pipelineAt = 0; let pipelineLoading = null;
export function loadPipeline({ force = false } = {}) {
  if (!force && pipelineCache && Date.now() - pipelineAt < 15000) return Promise.resolve(pipelineCache);
  if (pipelineLoading) return pipelineLoading;
  pipelineLoading = crm.pipeline({ limit: 500 }).then(payload => { pipelineCache = payload; pipelineAt = Date.now(); return payload; })
    .finally(() => { pipelineLoading = null; });
  return pipelineLoading;
}
export const invalidatePipeline = () => { pipelineAt = 0; };
if (typeof document !== 'undefined') document.addEventListener('crm:changed', invalidatePipeline);
export async function pipelineItemFor(companyId, productProfile) {
  const payload = await loadPipeline();
  const items = (payload?.items || []).filter(item => String(item.company_id) === String(companyId));
  return items.find(item => !productProfile || item.product_profile === productProfile) || items[0] || null;
}
