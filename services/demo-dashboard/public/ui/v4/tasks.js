// 我的任务 / My tasks: today, overdue, this week and all open follow-up tasks (/api/crm/tasks).
import { overdueText, crm, TASK_TYPES, REPLY_INTENTS, bi, esc, when, toLocalInput, fromLocalInput, taskTypePill, taskDot, stateBlock, skeletonRows,
  notifyCrmChange, errorText, loadPipeline } from './crm.js';

const $ = (selector, root = document) => root.querySelector(selector);
const RANGES = [['today', '今日', 'Today'], ['overdue', '逾期', 'Overdue'], ['week', '本周', 'This week'], ['all', '全部', 'All']];
const state = { range: 'today', type: '', mine: false, items: null, counts: {}, error: false, generation: 0 };
const storage = { get: key => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key, value) => { try { localStorage.setItem(key, value); } catch {} } };
const settle = async promise => { try { return await promise; } catch { return null; } };
const params = range => ({ due: range === 'all' ? undefined : range, mine: state.mine ? 'true' : undefined });

function sourceText(task) {
  if (task.source_intent && REPLY_INTENTS[task.source_intent]) { const [zh, en] = REPLY_INTENTS[task.source_intent]; return bi(`回复：${zh}`, `Reply: ${en}`); }
  return task.next_action ? esc(task.next_action) : '<span class="meta-dash">—</span>';
}

function rowMarkup(task) {
  const due = when(task.due_at);
  const dueHtml = due ? `${esc(due.zh)}${task.overdue ? `<small>${bi(...overdueText(due))}</small>` : due.days === 0 ? `<small>${bi('今天', 'Today')}</small>` : ''}` : bi('未设置', 'Not set');
  const actions = `<div class="acts"><button class="btn btn-primary btn-sm" data-tip="把这项任务标记为已完成|Mark this task as done" type="button" data-task-complete="${esc(task.id)}">${bi('完成', 'Complete')}</button><button class="btn btn-sm" data-tip="修改这项任务的截止时间|Change this task's due time" type="button" data-task-reschedule="${esc(task.id)}">${bi('改期', 'Reschedule')}</button><button class="btn btn-sm" data-tip="把这项任务交给其他同事|Assign this task to a colleague" type="button" data-task-assign="${esc(task.id)}">${bi('指派', 'Assign')}</button></div>`;
  return `<div class="task-row${task.overdue ? ' is-overdue' : ''}" role="row" data-task-id="${esc(task.id)}">
    <div class="type" role="cell"><i class="m-dot ${taskDot(task.task_type)} v4-phone-only" aria-hidden="true"></i><span class="v4-desktop-pill">${taskTypePill(task.task_type)}</span></div>
    <div class="who" role="cell"><button type="button" data-tip="打开这家企业的详情|Open this company's details" class="co v4-link-btn" data-task-company="${esc(task.company_id)}">${esc(task.company_name || '—')}</button><span class="meta">${esc(task.title || task.next_action || '')}</span></div>
    <div class="due${task.overdue ? ' overdue' : ''}" role="cell">${dueHtml}</div>
    <div class="owner" role="cell">${esc(task.owner || '—')}</div>
    <div class="src" role="cell"><span class="v4-phone-only-inline">${esc((TASK_TYPES[task.task_type] || TASK_TYPES.OTHER)[0])} · </span>${sourceText(task)}</div>
    <div role="cell">${actions}</div>
  </div>`;
}

function render() {
  const host = $('#tasks-list');
  if (!host) return;
  $('#tasks-range').innerHTML = RANGES.map(([key, zh, en]) => `<button type="button" data-tip="只看${zh}的任务|Show ${en} tasks" role="tab" data-task-range="${key}" aria-selected="${state.range === key}" tabindex="${state.range === key ? 0 : -1}">${bi(zh, en)}<span class="n${key === 'overdue' && state.counts.overdue ? ' bad' : ''}">${state.counts[key] ?? '—'}</span></button>`).join('');
  const summary = $('#tasks-summary');
  if (summary && state.counts.today != null) summary.innerHTML = bi(`今日 ${state.counts.today} 项，逾期 ${state.counts.overdue ?? 0} 项`, `${state.counts.today} due today, ${state.counts.overdue ?? 0} overdue`);
  if (state.error) { host.innerHTML = stateBlock('error', '任务暂未读取', 'Tasks unavailable', { retry: true }); return; }
  if (!state.items) { host.innerHTML = skeletonRows(4); return; }
  const rows = state.items.filter(task => !state.type || task.task_type === state.type);
  if (!rows.length) { host.innerHTML = stateBlock('empty', state.range === 'overdue' ? '没有逾期任务' : '没有待办任务', state.range === 'overdue' ? 'No overdue tasks' : 'No open tasks'); return; }
  host.innerHTML = `<div role="table" aria-label="任务 Tasks"><div class="task-row head-row" role="row"><div role="columnheader">${bi('类型', 'Type')}</div><div role="columnheader">${bi('企业 / 任务', 'Company / Task')}</div><div role="columnheader">${bi('截止', 'Due')}</div><div role="columnheader">${bi('负责人', 'Owner')}</div><div role="columnheader">${bi('来源', 'Source')}</div><div role="columnheader" class="acts-head">${bi('操作', 'Actions')}</div></div>${rows.map(rowMarkup).join('')}</div>`;
}

export async function loadTasks() {
  const generation = ++state.generation;
  state.error = false; if (!state.items) render();
  const [current, ...counts] = await Promise.all([settle(crm.tasks(params(state.range))), ...RANGES.map(([key]) => settle(crm.tasks({ ...params(key), limit: 500 })))]);
  if (generation !== state.generation) return;
  RANGES.forEach(([key], index) => { state.counts[key] = counts[index] ? counts[index].items.length : null; });
  if (!current) { state.error = true; state.items = null; } else state.items = current.items || [];
  render();
}

function ensureDialog() {
  let dialog = document.getElementById('v4-task-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'v4-task-dialog'; dialog.className = 'sheet'; dialog.setAttribute('aria-labelledby', 'v4-task-title');
  dialog.innerHTML = `<form class="v4-task-form" novalidate><div class="sheet-head"><h3 id="v4-task-title"></h3><button class="btn btn-icon" data-tip="关闭，不保存|Close without saving" type="button" data-task-close aria-label="关闭 Close"><i class="ti ti-x" aria-hidden="true"></i></button></div>
    <div class="sheet-body">
      <div class="field" data-task-field="company"><label for="v4-task-company">${bi('企业', 'Company')}</label><select id="v4-task-company" name="company_id"></select></div>
      <div class="field" data-task-field="type"><label for="v4-task-type">${bi('类型', 'Type')}</label><select id="v4-task-type" name="task_type">${Object.entries(TASK_TYPES).map(([key, [zh, en]]) => `<option value="${key}">${esc(zh)} ${esc(en)}</option>`).join('')}</select></div>
      <div class="field" data-task-field="title"><label for="v4-task-name">${bi('任务', 'Task')}</label><input id="v4-task-name" name="title" maxlength="200"></div>
      <div class="form-grid"><div class="field" data-task-field="due"><label for="v4-task-due">${bi('截止时间', 'Due')}</label><input id="v4-task-due" name="due_at" type="datetime-local"></div>
      <div class="field" data-task-field="owner"><label for="v4-task-owner">${bi('负责人', 'Owner')}</label><input id="v4-task-owner" name="owner" maxlength="200" autocomplete="off"></div></div>
      <div class="field" data-task-field="note"><label for="v4-task-note">${bi('备注', 'Note')}</label><input id="v4-task-note" name="note" maxlength="1000"></div>
      <p class="v4-form-status" role="status" aria-live="polite"></p>
    </div>
    <div class="sheet-foot"><button class="btn" data-tip="取消，不保存|Cancel without saving" type="button" data-task-close>${bi('取消', 'Cancel')}</button><button class="btn btn-primary" data-tip="保存这项任务|Save this task" type="submit">${bi('保存', 'Save')}</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-task-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (dialog.opener?.isConnected) dialog.opener.focus({ preventScroll: true }); });
  return dialog;
}

function openDialog(mode, task = null, opener = document.activeElement) {
  const dialog = ensureDialog(); const form = dialog.querySelector('form');
  form.reset(); dialog.opener = opener; dialog.dataset.mode = mode; dialog.dataset.taskId = task?.id || '';
  const show = { company: mode === 'new', type: mode === 'new', title: mode === 'new', due: mode !== 'assign', owner: mode !== 'reschedule', note: mode !== 'new' };
  for (const [key, visible] of Object.entries(show)) dialog.querySelector(`[data-task-field="${key}"]`).hidden = !visible;
  dialog.querySelector('#v4-task-title').innerHTML = mode === 'new' ? bi('新建任务', 'New task') : mode === 'reschedule' ? bi('改期', 'Reschedule') : bi('指派', 'Assign');
  form.querySelector('.v4-form-status').textContent = '';
  if (task) { form.due_at.value = toLocalInput(task.due_at); form.owner.value = task.owner || ''; }
  if (mode === 'new') {
    form.company_id.innerHTML = '<option value="">正在读取企业 Loading companies</option>';
    loadPipeline().then(payload => {
      const companies = new Map((payload?.items || []).map(item => [item.company_id, item.company_name]));
      form.company_id.innerHTML = `<option value="">选择企业 Choose a company</option>${[...companies].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}`;
    }).catch(() => { form.company_id.innerHTML = '<option value="">企业暂未读取 Companies unavailable</option>'; });
  }
  if (!dialog.open) dialog.showModal();
  (mode === 'new' ? form.company_id : mode === 'reschedule' ? form.due_at : form.owner).focus();
  form.onsubmit = async event => {
    event.preventDefault();
    const status = form.querySelector('.v4-form-status'); const submit = form.querySelector('[type="submit"]');
    try {
      if (mode === 'new') {
        if (!form.company_id.value || !form.title.value.trim()) { status.innerHTML = bi('请选择企业并填写任务', 'Choose a company and enter the task'); return; }
        submit.disabled = true;
        await crm.createTask({ company_id: form.company_id.value, task_type: form.task_type.value, title: form.title.value.trim(), due_at: fromLocalInput(form.due_at.value) || undefined, owner: form.owner.value.trim() || undefined });
      } else if (mode === 'reschedule') {
        if (!form.due_at.value) { status.innerHTML = bi('请选择新的截止时间', 'Choose a new due time'); return; }
        submit.disabled = true;
        await crm.updateTask(task.id, { due_at: fromLocalInput(form.due_at.value), note: form.note.value.trim() || undefined });
      } else {
        if (!form.owner.value.trim()) { status.innerHTML = bi('请填写负责人', 'Enter an owner'); return; }
        submit.disabled = true;
        await crm.updateTask(task.id, { owner: form.owner.value.trim(), note: form.note.value.trim() || undefined });
      }
      dialog.close(); notifyCrmChange({ type: 'task' });
    } catch (error) { status.innerHTML = bi(...errorText(error)); }
    finally { submit.disabled = false; }
  };
}

function mount() {
  const root = $('#tasks-root');
  if (!root) return;
  state.mine = storage.get('sim-tasks-mine') === 'true';
  const head = $('#view-tasks .head');
  head.innerHTML = `<div><h2 id="tasks-title" class="bi"><span lang="zh-CN">我的任务</span><span lang="en">My tasks</span></h2><p id="tasks-summary" class="meta"></p></div><div class="btns"><button class="btn btn-primary" data-tip="新建一项跟进任务，例如回电话、发报价|Create a follow-up task, e.g. call back or send a quote" type="button" data-task-new><i class="ti ti-plus" aria-hidden="true"></i>${bi('新建任务', 'New task')}</button></div>`;
  root.innerHTML = `<section class="card v4-tasks"><div class="toolbar"><div id="tasks-range" class="tabs" role="tablist" aria-label="任务范围 Task range"></div><span class="grow"></span><label class="v4-select-label" for="tasks-type"><span class="sr-only">类型 Type</span><select id="tasks-type" class="select"><option value="">全部类型 All types</option>${Object.entries(TASK_TYPES).map(([key, [zh, en]]) => `<option value="${key}">${esc(zh)} ${esc(en)}</option>`).join('')}</select></label><label class="toggle"><input id="tasks-mine" type="checkbox"${state.mine ? ' checked' : ''}><span class="bi"><span lang="zh-CN">只看我负责的</span><span lang="en">Mine only</span></span></label></div><div id="tasks-list" aria-live="polite"></div></section>`;
  render();
  $('#tasks-range').addEventListener('click', event => { const tab = event.target.closest('[data-task-range]'); if (!tab) return; state.range = tab.dataset.taskRange; state.items = null; void loadTasks(); });
  $('#tasks-range').addEventListener('keydown', event => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!step) return;
    const index = RANGES.findIndex(([key]) => key === state.range); state.range = RANGES[(index + step + RANGES.length) % RANGES.length][0];
    state.items = null; void loadTasks().then(() => $(`#tasks-range [data-task-range="${state.range}"]`)?.focus()); event.preventDefault();
  });
  $('#tasks-type').addEventListener('change', event => { state.type = event.target.value; render(); });
  $('#tasks-mine').addEventListener('change', event => { state.mine = event.target.checked; storage.set('sim-tasks-mine', String(state.mine)); state.items = null; void loadTasks(); });
  document.querySelector('#view-tasks').addEventListener('click', async event => {
    if (event.target.closest('[data-state-retry]')) { void loadTasks(); return; }
    if (event.target.closest('[data-task-new]')) { openDialog('new', null, event.target.closest('button')); return; }
    const company = event.target.closest('[data-task-company]');
    if (company) { document.dispatchEvent(new CustomEvent('crm:opencompany', { detail: { companyId: company.dataset.taskCompany } })); return; }
    const button = event.target.closest('[data-task-complete],[data-task-reschedule],[data-task-assign]');
    if (!button) return;
    const id = button.dataset.taskComplete || button.dataset.taskReschedule || button.dataset.taskAssign;
    const task = (state.items || []).find(item => item.id === id);
    if (button.dataset.taskReschedule) { openDialog('reschedule', task, button); return; }
    if (button.dataset.taskAssign) { openDialog('assign', task, button); return; }
    button.disabled = true;
    try { await crm.updateTask(id, { task_status: 'COMPLETED' }); notifyCrmChange({ type: 'task' }); }
    catch (error) { button.disabled = false; button.closest('.task-row')?.insertAdjacentHTML('beforeend', `<p class="v4-form-status" role="alert">${bi(...errorText(error))}</p>`); }
  });
  document.addEventListener('crm:newtask', event => openDialog('new', null, event.detail?.opener));
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'tasks') void loadTasks(); });
  document.addEventListener('crm:changed', () => { if (!document.querySelector('#view-tasks')?.hidden) void loadTasks(); });
  if (!document.querySelector('#view-tasks')?.hidden) void loadTasks();
}
mount();
