// 无用线索 / Unusable leads (migration 073). The server marks a company UNUSABLE after 5 automatic contact
// searches without a usable business email and returns `unusable_lead` + `lead_usability` on list rows.
// Pages hide those rows unless "显示无用线索 / Show unusable leads" is on; the SIM admin can restore one.
// Display only: skipping further searches is enforced on the server.
import { tip } from './tooltips.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;

export const isUnusableLead = row => row?.unusable_lead === true || row?.lead_usability?.status === 'UNUSABLE';

/** Rows to show: unusable leads only when `show` is on. Returns {rows, hidden}. */
export function visibleLeads(rows, show = false) {
  const list = Array.isArray(rows) ? rows : [];
  if (show) return { rows: list, hidden: 0 };
  const kept = list.filter(row => !isUnusableLead(row));
  return { rows: kept, hidden: list.length - kept.length };
}

/** The filter switch; `id` keeps a stable hook per page. */
export function unusableToggleMarkup(id, checked = false) {
  return `<label class="filter-control v4-unusable-filter" for="${esc(id)}"${tip('无用线索：自动查找 5 次仍没有可用的商务邮箱，已停止自动查找；默认不显示', 'Unusable leads: 5 automatic searches found no usable business email, so searching has stopped; hidden by default')}><input type="checkbox" id="${esc(id)}" data-show-unusable-leads${checked ? ' checked' : ''}>${bi('显示无用线索', 'Show unusable leads')}</label>`;
}

export function hiddenNoteMarkup(hidden) {
  return hidden > 0 ? `<span class="meta v4-unusable-hidden">${bi(`已隐藏 ${hidden} 家无用线索`, `${hidden} unusable leads hidden`)}</span>` : '';
}

/** Pill + (admin only) restore button for a row marked unusable. */
export function unusableBadgeMarkup(row, { admin = false } = {}) {
  if (!isUnusableLead(row)) return '';
  const attempts = Number(row.lead_usability?.attempts ?? row.lead_usability?.total_attempts ?? 0);
  const id = row.company_id || row.id;
  return `<span class="v4-unusable-badge"><span class="pill"${tip(`自动查找 ${attempts} 次仍没有可用的商务邮箱，已停止自动查找`, `${attempts} automatic searches found no usable business email; searching has stopped`)}>${bi('无用线索', 'Unusable lead')}</span>${admin && id ? `<button type="button" class="btn btn-outline-secondary v4-unusable-restore" data-lead-restore="${esc(id)}"${tip('恢复为正常线索，系统会重新自动查找商务邮箱（最多 5 次）', 'Restore as a normal lead; automatic email searches resume (up to 5)')}>${bi('恢复线索', 'Restore lead')}</button>` : ''}</span>`;
}

/** POST the restore; resolves to the server response, throws on refusal. */
export async function restoreLead(companyId, { reason = '', fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`/api/lead-usability/${encodeURIComponent(companyId)}/restore`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Restore failed'), { code: body.code, status: response.status });
  return body;
}

/** Wires restore buttons inside `root`; `done` runs after a successful restore (reload the list). */
export function bindRestoreButtons(root, done) {
  root?.querySelectorAll?.('[data-lead-restore]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    const target = event.currentTarget; target.disabled = true;
    try { await restoreLead(target.dataset.leadRestore); await done?.(); }
    catch { target.disabled = false; target.insertAdjacentHTML('afterend', `<span class="meta" role="status">${bi('恢复未完成，请重试', 'Restore did not complete. Retry.')}</span>`); }
  }));
}
