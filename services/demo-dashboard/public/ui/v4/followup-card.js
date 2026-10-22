// Company Detail follow-up card: stage, owner, next follow-up, quick activity log and timeline.
// Also owns the shared "log activity" sheet used by the phone workbench grid.
import { crm, STAGES, ACTIVITY_TYPES, TASK_TYPES, bi, esc, stageLabel, when, toLocalInput, fromLocalInput, stateBlock,
  notifyCrmChange, errorText, loadPipeline, pipelineItemFor } from './crm.js';

const EVENT_LABELS = {
  CALL: ['电话', 'Call', 'k-call'], WHATSAPP: ['WhatsApp', 'WhatsApp', 'k-call'], MEETING: ['会议', 'Meeting', 'k-call'], NOTE: ['备注', 'Note', ''],
  EMAIL_MANUAL: ['邮件', 'Email', 'k-mail'], CONTACTED: ['开发信已发送', 'Email sent', 'k-mail'], REPLIED: ['收到回复', 'Reply received', 'k-reply'],
  REPLY_RECEIVED: ['收到回复', 'Reply received', 'k-reply'], STAGE_CHANGED: ['阶段变更', 'Stage change', 'k-stage']
};
const TASK_STATUS = { OPEN: ['待办', 'Open'], IN_PROGRESS: ['进行中', 'In progress'], COMPLETED: ['已完成', 'Completed'], CANCELLED: ['已取消', 'Cancelled'] };
const eventLabel = item => item.kind === 'TASK' ? [...(TASK_TYPES[item.event_type] || TASK_TYPES.OTHER).slice(0, 2), ''] : EVENT_LABELS[item.event_type] || [item.event_type || '记录', item.event_type || 'Record', ''];

function timelineMarkup(items) {
  if (!items.length) return stateBlock('empty', '暂无跟进记录', 'No activity yet');
  return `<ul class="timeline">${items.map(item => {
    const [zh, en, cls] = eventLabel(item);
    const time = when(item.occurred_at);
    let text = esc(item.summary || '');
    if (item.kind === 'STAGE') {
      const from = item.from_stage ? stageLabel(item.from_stage) : null; const to = stageLabel(item.to_stage);
      text = `${from ? `${esc(from[1])} ${esc(from[2])} → ` : ''}${esc(to[1])} ${esc(to[2])}${item.actor ? ` · ${esc(item.actor)}` : ''}${item.result ? ` · ${esc(item.result)}` : ''}${item.summary ? ` · ${esc(item.summary)}` : ''}`;
    } else if (item.kind === 'TASK') { const status = TASK_STATUS[item.result]; if (status) text += `${text ? ' · ' : ''}${esc(status[0])} ${esc(status[1])}`; }
    else if (item.result) text += `${text ? ' · ' : ''}${esc(item.result)}`;
    return `<li class="${cls}"><div class="record"><span class="when">${esc(time ? time.zh : '—')} · ${bi(zh, en)}${item.kind !== 'STAGE' && item.actor ? ` · ${esc(item.actor)}` : ''}</span><span class="text">${text || '—'}</span></div></li>`;
  }).join('')}</ul>`;
}

function cardMarkup(item) {
  if (!item) return `<section class="card v4-followup-card" aria-labelledby="followup-title"><div class="ph"><div><h3 id="followup-title">${bi('跟进', 'Follow-up')}</h3></div></div>${stateBlock('empty', '该企业暂无当前销售机会', 'No current opportunity for this company')}</section>`;
  const [, zh, en] = stageLabel(item.pipeline_stage);
  const index = STAGES.findIndex(([key]) => key === item.pipeline_stage);
  return `<section class="card v4-followup-card" aria-labelledby="followup-title" data-opportunity-id="${esc(item.opportunity_id)}" data-version="${esc(item.crm_version ?? '')}">
    <div class="ph"><div><h3 id="followup-title">${bi('跟进', 'Follow-up')}</h3><p>${bi(`当前阶段 ${zh}`, `Current stage: ${en}`)}</p></div></div>
    <form class="pb v4-followup-form" novalidate>
      <div class="steps" role="group" aria-label="销售阶段 Pipeline stage">${STAGES.map(([key, szh, sen], i) => `<button type="button" data-stage="${key}" aria-pressed="${key === item.pipeline_stage}" class="${i < index && key !== 'LOST' ? 'done' : ''}${key === 'LOST' ? ' lost' : ''}">${esc(szh)}<small>${esc(sen)}</small></button>`).join('')}</div>
      <div class="field v4-lost-reason" hidden><label for="followup-lost-reason">${bi('流失原因', 'Lost reason')}</label><input id="followup-lost-reason" name="lost_reason" maxlength="500"></div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label for="followup-owner">${bi('负责人', 'Owner')}</label><input id="followup-owner" name="owner" maxlength="200" value="${esc(item.owner_identity || '')}" autocomplete="off"></div>
        <div class="field"><label for="followup-due">${bi('下次跟进', 'Next follow-up')}</label><input id="followup-due" name="next_action_due_at" type="datetime-local" value="${esc(toLocalInput(item.next_action_due_at))}"></div>
        <div class="field wide"><label for="followup-next">${bi('下一步', 'Next action')}</label><input id="followup-next" name="next_action" maxlength="500" value="${esc(item.next_action || '')}"></div>
      </div>
      <div class="btns v4-followup-save"><span class="v4-form-status" role="status" aria-live="polite"></span><button class="btn btn-primary" type="submit">${bi('保存', 'Save')}</button></div>
      <h4 class="sub-title">${bi('快速记录', 'Quick log')}</h4>
      <div class="quick">${ACTIVITY_TYPES.filter(([key]) => key !== 'EMAIL_MANUAL').map(([key, azh, aen, icon]) => `<button class="btn" type="button" data-log-type="${key}"><i class="ti ti-${icon}" aria-hidden="true"></i>${key === 'WHATSAPP' ? esc(azh) : bi(key === 'CALL' ? '记录电话' : azh, aen)}</button>`).join('')}</div>
    </form>
  </section>`;
}

let logContext = null; let logOpener = null;
function ensureLogDialog() {
  let dialog = document.getElementById('v4-log-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'v4-log-dialog'; dialog.className = 'sheet'; dialog.setAttribute('aria-labelledby', 'v4-log-title');
  dialog.innerHTML = `<form method="dialog" class="v4-log-form" novalidate>
    <div class="sheet-head"><h3 id="v4-log-title">${bi('记录跟进', 'Log activity')}</h3><button class="btn btn-icon" type="button" data-log-close aria-label="关闭 Close"><i class="ti ti-x" aria-hidden="true"></i></button></div>
    <div class="sheet-body">
      <div class="field v4-log-company"><label for="v4-log-opportunity">${bi('企业', 'Company')}</label><select id="v4-log-opportunity" name="opportunity"></select></div>
      <fieldset class="field"><legend class="lbl">${bi('类型', 'Type')}</legend><div class="seg-choice">${ACTIVITY_TYPES.map(([key, zh, en], i) => `<input type="radio" name="activity_type" id="v4-log-type-${key}" value="${key}"${i === 0 ? ' checked' : ''}><label for="v4-log-type-${key}">${esc(zh)}${zh === en ? '' : `<small>${esc(en)}</small>`}</label>`).join('')}</div></fieldset>
      <div class="field"><label for="v4-log-summary">${bi('内容', 'Summary')}</label><textarea id="v4-log-summary" name="summary" maxlength="2000" required></textarea></div>
      <div class="form-grid"><div class="field"><label for="v4-log-result">${bi('结果', 'Result')}</label><input id="v4-log-result" name="result" maxlength="200"></div>
      <div class="field"><label for="v4-log-occurred">${bi('发生时间', 'Occurred at')}</label><input id="v4-log-occurred" name="occurred_at" type="datetime-local"></div>
      <div class="field wide"><label for="v4-log-next">${bi('下次跟进（可选）', 'Next follow-up (optional)')}</label><input id="v4-log-next" name="next_follow_up_at" type="datetime-local"></div></div>
      <p class="v4-form-status" role="status" aria-live="polite"></p>
    </div>
    <div class="sheet-foot"><button class="btn" type="button" data-log-close>${bi('取消', 'Cancel')}</button><button class="btn btn-primary" type="submit">${bi('保存记录', 'Save')}</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  dialog.querySelectorAll('[data-log-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (logOpener?.isConnected) logOpener.focus({ preventScroll: true }); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = form.querySelector('.v4-form-status');
    const opportunityId = logContext?.opportunityId || form.opportunity.value;
    const summary = form.summary.value.trim();
    if (!opportunityId) { status.innerHTML = bi('请选择企业', 'Choose a company'); return; }
    if (!summary) { status.innerHTML = bi('请填写内容', 'Enter a summary'); form.summary.focus(); return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; status.innerHTML = bi('正在保存', 'Saving');
    try {
      await crm.addActivity(opportunityId, { activity_type: form.activity_type.value, summary, result: form.result.value.trim() || undefined,
        occurred_at: fromLocalInput(form.occurred_at.value) || undefined, next_follow_up_at: fromLocalInput(form.next_follow_up_at.value) || undefined });
      dialog.close(); notifyCrmChange({ type: 'activity', companyId: logContext?.companyId });
    } catch (error) { status.innerHTML = bi(...errorText(error)); }
    finally { submit.disabled = false; }
  });
  return dialog;
}

/** Open the log sheet; without a company context the sheet asks for the opportunity. */
export async function openLogDialog({ type = 'NOTE', opportunityId = null, companyId = null, opener = document.activeElement } = {}) {
  const dialog = ensureLogDialog();
  const form = dialog.querySelector('form');
  logContext = opportunityId ? { opportunityId, companyId } : null; logOpener = opener;
  form.reset();
  form.querySelector('.v4-form-status').textContent = '';
  form.occurred_at.value = toLocalInput(new Date());
  const typeInput = form.querySelector(`#v4-log-type-${type}`); if (typeInput) typeInput.checked = true;
  const companyField = form.querySelector('.v4-log-company');
  companyField.hidden = Boolean(opportunityId);
  if (!opportunityId) {
    form.opportunity.innerHTML = `<option value="">${esc('正在读取机会 Loading opportunities')}</option>`;
    loadPipeline().then(payload => {
      const items = (payload?.items || []).filter(item => !['WON', 'LOST'].includes(item.pipeline_stage));
      form.opportunity.innerHTML = `<option value="">选择企业 Choose a company</option>${items.map(item => `<option value="${esc(item.opportunity_id)}">${esc(item.company_name)}</option>`).join('')}`;
    }).catch(() => { form.opportunity.innerHTML = '<option value="">机会暂未读取 Opportunities unavailable</option>'; });
  }
  if (!dialog.open) dialog.showModal();
  (opportunityId ? form.summary : form.opportunity).focus();
}

async function loadTimeline(host, companyId) {
  host.innerHTML = stateBlock('loading', '正在读取跟进记录', 'Loading activity');
  try { const payload = await crm.timeline(companyId); host.innerHTML = timelineMarkup(payload?.items || []); }
  catch { host.innerHTML = stateBlock('error', '跟进记录暂未读取', 'Activity unavailable', { retry: true }); }
}

function wireCard(container, item, companyId, detail) {
  const card = container.querySelector('.v4-followup-card form');
  if (!card) return;
  let selected = item.pipeline_stage;
  const lost = card.querySelector('.v4-lost-reason');
  const status = card.querySelector('.v4-form-status');
  card.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.stage;
    card.querySelectorAll('[data-stage]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    lost.hidden = selected !== 'LOST'; if (selected === 'LOST') lost.querySelector('input').focus();
  }));
  card.querySelectorAll('[data-log-type]').forEach(button => button.addEventListener('click', () => openLogDialog({ type: button.dataset.logType, opportunityId: item.opportunity_id, companyId, opener: button })));
  card.addEventListener('submit', async event => {
    event.preventDefault();
    const reason = card.lost_reason.value.trim();
    if (selected === 'LOST' && !reason) { status.innerHTML = bi('请填写流失原因', 'Enter a lost reason'); card.lost_reason.focus(); return; }
    const submit = card.querySelector('[type="submit"]'); submit.disabled = true; status.innerHTML = bi('正在保存', 'Saving');
    try {
      await crm.setStage(item.opportunity_id, { stage: selected, lost_reason: selected === 'LOST' ? reason : undefined, owner: card.owner.value.trim() || undefined,
        next_action: card.next_action.value.trim() || undefined, next_action_due_at: card.next_action_due_at.value ? fromLocalInput(card.next_action_due_at.value) : null,
        expected_version: item.crm_version ?? undefined });
      status.innerHTML = bi('已保存', 'Saved');
      notifyCrmChange({ type: 'stage', companyId });
    } catch (error) { status.innerHTML = bi(...errorText(error)); }
    finally { submit.disabled = false; }
  });
}

/** Insert (or refresh) the follow-up block in Company Detail, after the identity header. */
export async function mountFollowupCard(detail, { companyId, productProfile = '' }) {
  if (!detail || !companyId) return;
  detail.querySelector('.v4-followup')?.remove();
  detail.querySelector('.m-actbar')?.remove();
  const block = document.createElement('div');
  block.className = 'cols v4-followup';
  block.dataset.companyId = companyId;
  block.innerHTML = `<div class="v4-followup-main">${stateBlock('loading', '正在读取跟进', 'Loading follow-up')}</div><section class="card v4-activity-card" aria-labelledby="activity-title"><div class="ph"><div><h3 id="activity-title">${bi('跟进记录', 'Activity')}</h3><p>${bi('最新在前', 'Newest first')}</p></div></div><div class="pb v4-timeline-host"></div></section>`;
  const header = detail.querySelector('.crm-detail-header');
  if (header) header.after(block); else detail.querySelector('.crm-detail-body')?.prepend(block);
  const timeline = block.querySelector('.v4-timeline-host');
  timeline.addEventListener('click', event => { if (event.target.closest('[data-state-retry]')) void loadTimeline(timeline, companyId); });
  void loadTimeline(timeline, companyId);
  let item = null;
  try { item = await pipelineItemFor(companyId, productProfile); }
  catch { block.querySelector('.v4-followup-main').innerHTML = `<section class="card">${stateBlock('error', '跟进信息暂未读取', 'Follow-up unavailable')}</section>`; return; }
  if (!block.isConnected) return;
  block.querySelector('.v4-followup-main').innerHTML = cardMarkup(item);
  if (!item) return;
  wireCard(block, item, companyId, detail);
  const bar = document.createElement('div');
  bar.className = 'm-actbar v4-phone-only';
  bar.innerHTML = `<button type="button" data-bar-log="CALL"><i class="ti ti-phone" aria-hidden="true"></i>记电话</button><button type="button" data-bar-log="WHATSAPP"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button><button type="button" data-bar-log="NOTE"><i class="ti ti-pencil" aria-hidden="true"></i>写跟进</button><button type="button" class="pri" data-bar-stage><i class="ti ti-flag" aria-hidden="true"></i>改阶段</button>`;
  bar.querySelectorAll('[data-bar-log]').forEach(button => button.addEventListener('click', () => openLogDialog({ type: button.dataset.barLog, opportunityId: item.opportunity_id, companyId, opener: button })));
  bar.querySelector('[data-bar-stage]').addEventListener('click', () => { const steps = block.querySelector('.steps'); steps?.scrollIntoView({ block: 'center' }); steps?.querySelector('[aria-pressed="true"]')?.focus(); });
  detail.append(bar);
  detail.classList.add('has-actbar');
}

document.addEventListener('crm:changed', event => {
  const detail = document.getElementById('detail');
  const block = detail?.querySelector('.v4-followup');
  if (detail?.open && block && (!event.detail?.companyId || event.detail.companyId === block.dataset.companyId)) {
    if (event.detail?.type === 'activity') { const host = block.querySelector('.v4-timeline-host'); if (host) void loadTimeline(host, block.dataset.companyId); }
    else void mountFollowupCard(detail, { companyId: block.dataset.companyId });
  }
});
// Phone workbench grid shortcuts.
document.addEventListener('click', event => {
  const action = event.target.closest('[data-quick-action]');
  if (!action) return;
  const key = action.dataset.quickAction;
  if (key === 'log-note' || key === 'log-call') { event.preventDefault(); void openLogDialog({ type: key === 'log-call' ? 'CALL' : 'NOTE', opener: action }); }
  if (key === 'new-task') { event.preventDefault(); location.hash = '#tasks'; requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('crm:newtask', { detail: { opener: action } }))); }
});
