// Navigation counters (sidebar and phone tab bar): today's tasks, follow-up drafts awaiting
// approval and replies awaiting review. Each source fails independently and leaves its badge hidden.
import { setNavCount } from '../../crm-shell.js';
import { crm } from './crm.js';
import { managementRequest } from '../../phase7-ui.js';

const settle = async promise => { try { return await promise; } catch { return null; } };
let pending = null; let last = 0;
export async function refreshNavCounts({ force = false } = {}) {
  if (pending || (!force && Date.now() - last < 30000)) return pending;
  pending = (async () => {
    const [tasks, drafts, operations] = await Promise.all([
      settle(crm.tasks({ due: 'today' })), settle(crm.drafts({ status: 'PENDING_APPROVAL' })),
      settle(managementRequest('/api/outreach/operations-summary'))
    ]);
    const due = tasks?.summary?.due_today ?? 0;
    const approvals = drafts?.items?.length ?? 0;
    const replies = operations?.prospect?.pending_followups ?? 0;
    setNavCount('tasks', due); setNavCount('followups', approvals); setNavCount('replies', replies);
    setNavCount('messages', approvals + replies);
    last = Date.now();
  })().finally(() => { pending = null; });
  return pending;
}
document.addEventListener('crm:changed', () => void refreshNavCounts({ force: true }));
document.addEventListener('crm:viewchange', () => void refreshNavCounts());
void refreshNavCounts({ force: true });
