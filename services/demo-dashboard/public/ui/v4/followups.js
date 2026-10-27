// 跟进邮件审批 / Follow-up approval: drafts created by the follow-up scan, approved or discarded by a person.
// Approval only queues the draft; sending re-checks thread, opt-out, daily limit and the email switch.
import { crm, bi, esc, when, stateBlock, skeletonRows, notifyCrmChange, errorText, quotaMarkup } from './crm.js';
import { attachTranslateWidget, fieldTarget } from './translate-widget.js';

const $ = (selector, root = document) => root.querySelector(selector);
const STATUS = { PENDING_APPROVAL: ['待批准', 'Pending', 'warn'], APPROVED: ['已批准', 'Approved', 'info'], SENDING: ['发送中', 'Sending', 'info'],
  SENT: ['已发送', 'Sent', 'ok'], DISCARDED: ['已放弃', 'Discarded', ''], BLOCKED: ['未发送', 'Not sent', 'bad'], SUPERSEDED: ['已替换', 'Superseded', ''] };
const ordinal = n => ({ 2: '2nd', 3: '3rd', 4: '4th' }[n] || `${n}th`);
const state = { status: 'PENDING_APPROVAL', items: null, error: false, selected: null, generation: 0, quota: null };

const statusPill = code => { const [zh, en, tone] = STATUS[code] || ['状态待确认', 'Unknown', '']; return `<span class="pill ${tone}">${bi(zh, en)}</span>`; };

function listMarkup() {
  if (state.error) return stateBlock('error', '跟进邮件暂未读取', 'Follow-up drafts unavailable', { retry: true });
  if (!state.items) return skeletonRows(3);
  if (!state.items.length) return stateBlock('empty', state.status === 'PENDING_APPROVAL' ? '没有待批准的跟进邮件' : '没有符合条件的跟进邮件', state.status === 'PENDING_APPROVAL' ? 'No follow-up email awaiting approval' : 'No matching follow-up email');
  return `<ul class="drafts">${state.items.map(draft => {
    const due = when(draft.due_at);
    return `<li><button type="button" data-tip="打开这封跟进邮件，查看并修改内容|Open this follow-up email to review and edit" class="draft" data-draft="${esc(draft.id)}"${state.selected === draft.id ? ' aria-current="true"' : ''}><span class="l1"><span class="co">${esc(draft.company_name || '—')}</span><span class="tag">${bi(`第 ${draft.sequence_no} 封`, ordinal(draft.sequence_no))}</span></span><span class="subj">${esc(draft.subject)}</span><span class="meta"><span>${esc(draft.recipient || '—')}</span><span>${bi(`计划 ${due ? due.zh : '—'}`, `Scheduled ${due ? due.en : '—'}`)}</span>${draft.draft_status !== 'PENDING_APPROVAL' ? statusPill(draft.draft_status) : ''}</span></button></li>`;
  }).join('')}</ul>`;
}

function previewMarkup(draft) {
  if (!draft) return `<div class="pb">${stateBlock('empty', '选择一封跟进邮件查看', 'Select a follow-up email to preview')}</div>`;
  const due = when(draft.due_at);
  const editable = draft.draft_status === 'PENDING_APPROVAL';
  return `<div class="ph"><div><button class="btn btn-ghost-primary v4-phone-back" data-tip="返回邮件列表|Back to the list" type="button" data-preview-back><i class="ti ti-chevron-left" aria-hidden="true"></i>${bi('返回', 'Back')}</button><h3 id="followup-preview-title">${bi('邮件预览', 'Draft preview')}</h3><p>${esc(draft.company_name || '—')} · ${bi(`第 ${draft.sequence_no} 封跟进`, `${ordinal(draft.sequence_no)} follow-up`)}</p></div><button class="lnk v4-link-btn" data-tip="打开这家企业的详情|Open this company's details" type="button" data-draft-company="${esc(draft.company_id)}">${bi('企业详情', 'Company')}<i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>
  <form class="pb preview" novalidate data-preview="${esc(draft.id)}">
    <dl class="to"><dt>${bi('收件人', 'To')}</dt><dd>${esc(draft.recipient || '—')}</dd><dt>${bi('计划发送', 'Scheduled')}</dt><dd>${due ? `${esc(due.zh)} · ${esc(due.en)}` : '—'}</dd><dt>${bi('状态', 'Status')}</dt><dd>${statusPill(draft.draft_status)}${draft.approved_by ? `<span class="meta">${esc(draft.approved_by)}</span>` : ''}</dd></dl>
    <div class="field"><label for="followup-subject">${bi('主题', 'Subject')}</label><input id="followup-subject" name="subject" maxlength="240" value="${esc(draft.subject)}"${editable ? '' : ' readonly'}></div>
    <div class="field"><label for="followup-body">${bi('正文', 'Body')}</label><textarea id="followup-body" name="body_text" maxlength="12000"${editable ? '' : ' readonly'}>${esc(draft.body_text)}</textarea></div>
    ${editable ? `<div class="v4-translate-slot" data-followup-translate></div>
    <div class="field v4-discard-reason" hidden><label for="followup-discard-reason">${bi('放弃原因（可选）', 'Reason (optional)')}</label><input id="followup-discard-reason" name="reason" maxlength="500"></div>
    <p class="v4-form-status" role="status" aria-live="polite"></p>
    <div class="actions"><button class="btn btn-danger" data-tip="不发送这封邮件（可填写原因）|Don't send this email (reason optional)" type="button" data-draft-discard>${bi('放弃', 'Discard')}</button><span class="grow"></span><button class="btn" data-tip="保存您的修改并批准发送|Save your edits and approve" type="button" data-draft-approve-edits disabled>${bi('修改后批准', 'Approve with edits')}</button><button class="btn btn-primary" data-tip="批准后按计划时间发出，发送前会再检查退订和每日额度|Approve; sent at the scheduled time after opt-out and quota checks" type="button" data-draft-approve>${bi('批准发送', 'Approve')}</button></div>
    <p class="meta v4-approval-note">${bi('批准后按计划时间发出；发送前会再次检查退订、回复和每日额度。', 'Sent at the scheduled time after approval; opt-out, replies and the daily limit are checked again before sending.')}</p>` : ''}
  </form>`;
}

function render() {
  const list = $('#followups-list'); const preview = $('#followups-preview');
  const quota = $('#followups-quota'); if (quota) { quota.innerHTML = quotaMarkup(state.quota); quota.hidden = !quota.innerHTML; }
  if (!list || !preview) return;
  list.innerHTML = listMarkup();
  const draft = state.items?.find(item => item.id === state.selected) || null;
  preview.innerHTML = previewMarkup(draft);
  $('#followups-root').classList.toggle('is-previewing', Boolean(draft) && state.previewOpen === true);
  const count = $('#followups-count');
  if (count) count.innerHTML = state.items ? bi(`${state.items.length} 封 · 批准后按计划时间发出`, `${state.items.length} · sent at the scheduled time after approval`) : '';
  wirePreview(draft);
}

function wirePreview(draft) {
  const form = $('#followups-preview form');
  if (!form || !draft || draft.draft_status !== 'PENDING_APPROVAL') return;
  const edits = form.querySelector('[data-draft-approve-edits]'); const approve = form.querySelector('[data-draft-approve]');
  const status = form.querySelector('.v4-form-status');
  attachTranslateWidget(form.querySelector('[data-followup-translate]'), { targets: [fieldTarget(form.body_text, ['正文', 'Body']), fieldTarget(form.subject, ['主题', 'Subject'])] });
  const dirty = () => form.subject.value !== draft.subject || form.body_text.value !== draft.body_text;
  form.addEventListener('input', () => { edits.disabled = !dirty(); approve.disabled = dirty(); });
  const decide = async (body, button) => {
    form.querySelectorAll('button').forEach(item => { item.disabled = true; });
    status.innerHTML = bi('正在保存', 'Saving');
    try { await crm.decideDraft(draft.id, body); state.selected = null; state.previewOpen = false; notifyCrmChange({ type: 'draft' }); }
    catch (error) { status.innerHTML = bi(...errorText(error)); form.querySelectorAll('button').forEach(item => { item.disabled = false; }); edits.disabled = !dirty(); approve.disabled = dirty(); button?.focus(); }
  };
  approve.addEventListener('click', () => decide({ decision: 'APPROVE' }, approve));
  edits.addEventListener('click', () => {
    if (!form.subject.value.trim() || !form.body_text.value.trim()) { status.innerHTML = bi('主题和正文不能为空', 'Subject and body are required'); return; }
    void decide({ decision: 'APPROVE', subject: form.subject.value.trim(), body_text: form.body_text.value.trim() }, edits);
  });
  const discard = form.querySelector('[data-draft-discard]'); const reason = form.querySelector('.v4-discard-reason');
  discard.addEventListener('click', () => {
    if (reason.hidden) { reason.hidden = false; discard.innerHTML = bi('确认放弃', 'Confirm discard'); form.reason.focus(); return; }
    void decide({ decision: 'DISCARD', reason: form.reason.value.trim() || undefined }, discard);
  });
}

export async function loadFollowups() {
  const generation = ++state.generation; state.error = false;
  if (!state.items) render();
  try {
    const payload = await crm.drafts({ status: state.status });
    if (generation !== state.generation) return;
    state.items = payload?.items || [];
    state.quota = payload?.quota || null;
    if (!state.items.some(item => item.id === state.selected)) state.selected = window.matchMedia('(max-width: 900px)').matches ? null : state.items[0]?.id || null;
  } catch { if (generation !== state.generation) return; state.error = true; state.items = null; }
  render();
}

function mount() {
  const root = $('#followups-root');
  if (!root) return;
  $('#view-followups .head').innerHTML = `<div><h2 id="followups-title" class="bi"><span lang="zh-CN">跟进邮件审批</span><span lang="en">Follow-up approval</span></h2><p id="followups-count" class="meta"></p></div><div class="btns"><label for="followups-status"><span class="sr-only">状态 Status</span><select id="followups-status" class="select">${[['PENDING_APPROVAL', '待批准 Pending'], ['APPROVED', '已批准 Approved'], ['SENT', '已发送 Sent'], ['BLOCKED', '未发送 Not sent'], ['DISCARDED', '已放弃 Discarded'], ['ALL', '全部 All']].map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label></div>`;
  root.innerHTML = `<div id="followups-quota" hidden></div><div class="split"><section class="card v4-drafts-card" aria-labelledby="followups-list-title"><div class="ph"><div><h3 id="followups-list-title">${bi('跟进邮件', 'Follow-up drafts')}</h3><p>${bi('按计划发送时间', 'By scheduled time')}</p></div></div><div id="followups-list" aria-live="polite"></div></section><section id="followups-preview" class="card v4-preview-card" aria-labelledby="followup-preview-title"></section></div>`;
  render();
  $('#followups-status').addEventListener('change', event => { state.status = event.target.value; state.items = null; state.selected = null; void loadFollowups(); });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void loadFollowups(); return; }
    const item = event.target.closest('[data-draft]');
    if (item) { state.selected = item.dataset.draft; state.previewOpen = true; render(); $('#followups-preview .ph h3')?.setAttribute('tabindex', '-1'); $('#followups-preview .ph h3')?.focus({ preventScroll: true }); return; }
    if (event.target.closest('[data-preview-back]')) { const id = state.selected; state.previewOpen = false; render(); root.querySelector(`[data-draft="${CSS.escape(id || '')}"]`)?.focus(); return; }
    const company = event.target.closest('[data-draft-company]');
    if (company) document.dispatchEvent(new CustomEvent('crm:opencompany', { detail: { companyId: company.dataset.draftCompany } }));
  });
  document.addEventListener('click', event => { const link = event.target.closest('[data-draft-id]'); if (link) { state.selected = link.dataset.draftId; state.previewOpen = true; } });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'followups') void loadFollowups(); });
  document.addEventListener('crm:changed', () => { if (!document.querySelector('#view-followups')?.hidden) void loadFollowups(); });
  if (!document.querySelector('#view-followups')?.hidden) void loadFollowups();
}
mount();
