// Signed-in user (GET /api/auth/me). Loaded before every other workspace module:
// - any API answer 401 sends the browser to the sign-in page (and back here afterwards);
// - role, trial status, read-only state and feature switches are mirrored on <html> so
//   navigation and write buttons follow them (CSS + the read-only guard below);
// - business refusals (read-only, quota, mailbox not verified) are explained in plain words.
import { toast } from './toast.js';

export const LOGIN_PAGE = '/login.html';
/** Pages only SIM (role ADMIN) uses. */
export const ADMIN_VIEWS = Object.freeze(['settings', 'categories', 'markets', 'customer-match', 'data-import', 'data-export', 'merchants', 'feedback-inbox']);
/** Pages that need a merchant feature switch. */
export const FEATURE_VIEWS = Object.freeze({ research: 'research', jobs: 'research' });

export const session = { user: null, ready: false, authEnabled: true };
let resolveReady;
export const sessionReady = new Promise(resolve => { resolveReady = resolve; });

export const nextTarget = (loc = globalThis.location) => `${loc.pathname}${loc.search}${loc.hash}`;
export const loginUrl = (reason = '', loc = globalThis.location) => `${LOGIN_PAGE}?next=${encodeURIComponent(nextTarget(loc))}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
let leaving = false;
export function goToLogin(reason = '') {
  if (leaving || typeof location === 'undefined' || location.pathname === LOGIN_PAGE) return;
  leaving = true; location.replace(loginUrl(reason));
}

/** Whether a role (and its merchant feature switches) may open a view. Unknown user → allowed. */
export function viewAllowed(view, user = session.user) {
  if (!user) return true;
  if (user.role !== 'ADMIN' && ADMIN_VIEWS.includes(view)) return false;
  const feature = FEATURE_VIEWS[view];
  if (feature && user.merchant?.features && user.merchant.features[feature] === false) return false;
  return true;
}

/** Days left in a trial (rounded up), null when not a trial. */
export function trialDaysLeft(merchant, now = new Date()) {
  if (!merchant || merchant.status !== 'TRIAL' || !merchant.trial_ends_at) return null;
  const end = new Date(merchant.trial_ends_at);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end - now) / 86400000));
}
export const isReadOnly = user => Boolean(user?.merchant && (user.merchant.read_only || user.merchant.status === 'EXPIRED'));

// Plain-language explanations for refusals coming from any page.
export const REFUSALS = Object.freeze({
  MERCHANT_READ_ONLY: ['试用已结束，当前只能查看。请联系 SIM 开通。', 'Your trial has ended; the workspace is read-only. Contact SIM to reactivate.', null],
  MERCHANT_FEATURE_DISABLED: ['您的账号未开通这项功能，请联系 SIM。', 'This feature is not enabled for your account. Contact SIM.', null],
  MERCHANT_SEARCH_QUOTA_EXCEEDED: ['本月找客户额度已用完，请联系 SIM 增加额度。', 'This month\'s search quota is used up. Contact SIM for more.', null],
  MERCHANT_EMAIL_QUOTA_EXCEEDED: ['今日发信额度已用完，明天会继续发送。', 'Today\'s email quota is used up; sending resumes tomorrow.', null],
  MERCHANT_MAILBOX_NOT_VERIFIED: ['请先绑定并验证您的发信邮箱，才能发出邮件。', 'Bind and verify your sending mailbox before email can be sent.', { zh: '去绑定发信邮箱', en: 'Bind mailbox', href: '#mailbox' }]
});

const apiUrl = input => { const url = typeof input === 'string' ? input : input?.url || ''; return /(^|\/\/[^/]+)\/api\//.test(url) || url.startsWith('/api/'); };
if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !window.fetch.simSession) {
  const nativeFetch = window.fetch.bind(window);
  const wrapped = async (input, init) => {
    const response = await nativeFetch(input, init);
    if (!apiUrl(input)) return response;
    const url = typeof input === 'string' ? input : input?.url || '';
    if (response.status === 401 && !/\/api\/auth\/(login|password|me)\b/.test(url)) goToLogin('expired');
    else if ([403, 409].includes(response.status) && (response.headers.get('content-type') || '').includes('json')) {
      response.clone().json().then(body => {
        if (body?.code === 'PASSWORD_CHANGE_REQUIRED') { location.replace(`${LOGIN_PAGE}?change=1&next=${encodeURIComponent(nextTarget())}`); return; }
        const refusal = REFUSALS[body?.code];
        if (refusal) toast(refusal[0], refusal[1], { tone: 'warn', action: refusal[2] });
      }).catch(() => {});
    }
    return response;
  };
  wrapped.simSession = true;
  window.fetch = wrapped;
}

function applyUser(user) {
  const root = document.documentElement;
  root.dataset.role = user.role || 'MERCHANT';
  root.dataset.session = session.authEnabled ? 'signed-in' : 'local';
  const merchant = user.merchant;
  if (merchant) {
    root.dataset.merchantStatus = merchant.status || '';
    for (const [key, on] of Object.entries(merchant.features || {})) root.dataset[`feature${key.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())}`] = on === false ? 'off' : 'on';
  }
  if (isReadOnly(user)) root.dataset.readonly = 'true'; else delete root.dataset.readonly;
}

export async function loadSession() {
  let user = null;
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { goToLogin(); return null; }
    if (response.ok) user = (await response.json())?.user || null;
    else session.authEnabled = false;
  } catch { session.authEnabled = false; }
  // Sign-in not available yet (development): act as SIM's own workspace.
  if (!user) { session.authEnabled = false; user = { id: null, email: '', display_name: 'SIM', role: 'ADMIN', must_change_password: false, merchant: null }; }
  if (user.must_change_password && session.authEnabled) { location.replace(`${LOGIN_PAGE}?change=1&next=${encodeURIComponent(nextTarget())}`); return null; }
  session.user = user; session.ready = true;
  applyUser(user);
  resolveReady(user);
  document.dispatchEvent(new CustomEvent('crm:session', { detail: { user } }));
  return user;
}

export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* sign out locally anyway */ }
  location.replace(LOGIN_PAGE);
}

// Read-only (expired trial): write buttons stay visible but explain why they are unavailable.
const WRITE_CONTROLS = [
  '[data-research-dialog-open]', '#start-research', '#start-enrichment', '#reset', '[data-stage]', '[data-bar-stage]', '[data-bar-log]', '[data-log-type]', '[data-company-log]',
  '.v4-followup-form [type="submit"]', '#v4-log-dialog [type="submit"]', '[data-task-new]', '[data-task-complete]', '[data-task-reschedule]', '[data-task-assign]',
  '#v4-task-dialog [type="submit"]', '[data-draft-approve]', '[data-draft-approve-edits]', '[data-draft-discard]', '[data-reply-confirm]', '[data-reply-correct]',
  '[data-quick-action]', '#outreach-save', '#outreach-submit', '#outreach-approve', '#outreach-send', '#outreach-reject', '#outreach-contact-approve', '[data-contact-review]',
  '[data-phase7-action]', '[data-evidence-task]', '[data-automation-toggle]', '[data-mailbox-save]', '[data-mailbox-test]', '[data-mailbox-send-test]', '[data-scope-save]'
].join(',');
const READ_ONLY_TIP = '试用已结束，暂不能操作。请联系 SIM 开通|Trial ended; contact SIM to reactivate';
export function guardReadOnly(root = document) {
  if (document.documentElement.dataset.readonly !== 'true') return;
  root.querySelectorAll(WRITE_CONTROLS).forEach(el => {
    if (el.dataset.readonlyGuard) return;
    el.dataset.readonlyGuard = 'true';
    if (el.dataset.tip) el.dataset.tipBefore = el.dataset.tip;
    el.dataset.tip = READ_ONLY_TIP;
    el.setAttribute('aria-disabled', 'true');
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    const blocked = event.target.closest?.('[data-readonly-guard][aria-disabled="true"]');
    if (!blocked) return;
    event.preventDefault(); event.stopImmediatePropagation();
    toast(REFUSALS.MERCHANT_READ_ONLY[0], REFUSALS.MERCHANT_READ_ONLY[1], { tone: 'warn' });
  }, true);
  document.addEventListener('submit', event => {
    if (document.documentElement.dataset.readonly === 'true' && event.target.closest?.('#main-content, dialog') && event.submitter?.dataset.readonlyGuard) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('crm:session', () => {
    guardReadOnly();
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; guardReadOnly(); }); }).observe(document.body, { childList: true, subtree: true });
  });
  if (location.hash === '#login') location.replace(LOGIN_PAGE);
  else void loadSession();
}
