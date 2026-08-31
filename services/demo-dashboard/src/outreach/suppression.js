import { unique, upper } from './constants.js';

/** Returns append-only actions; callers decide transaction/persistence. */
export function deriveSuppressionActions(input = {}) {
  const type = upper(input.event_type || input.type);
  const companyWide = input.company_wide === true || upper(input.scope) === 'COMPANY';
  const actions = [];

  if (type === 'HUNTER_INVALID' || (type === 'VERIFICATION' && upper(input.verification_status) === 'INVALID')) {
    actions.push({ action: 'CREATE_CONTACT_SUPPRESSION', reason: 'INVALID_EMAIL' });
  } else if (type === 'HARD_BOUNCE' || type === 'HARD_BOUNCED') {
    actions.push({ action: 'CREATE_CONTACT_SUPPRESSION', reason: 'HARD_BOUNCE' });
  } else if (type === 'SOFT_BOUNCE' || type === 'SOFT_BOUNCED') {
    const count = Number(input.soft_bounce_count || 1);
    const limit = Math.max(1, Number(input.soft_bounce_limit || 3));
    actions.push(count >= limit
      ? { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'SOFT_BOUNCE_LIMIT' }
      : { action: 'HOLD_CONTACT', reason: 'SOFT_BOUNCE_RETRY' });
  } else if (type === 'COMPLAINT' || type === 'COMPLAINED') {
    actions.push(
      { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'COMPLAINT' },
      { action: 'CREATE_COMPANY_SUPPRESSION', reason: 'DO_NOT_CONTACT' }
    );
  } else if (type === 'OPT_OUT' || type === 'OPTED_OUT') {
    actions.push({ action: 'CREATE_CONTACT_SUPPRESSION', reason: 'OPT_OUT' });
    if (companyWide) actions.push({ action: 'CREATE_COMPANY_SUPPRESSION', reason: 'DO_NOT_CONTACT' });
  } else if (type === 'PROVIDER_SUPPRESSED') {
    actions.push({ action: 'CREATE_CONTACT_SUPPRESSION', reason: 'PROVIDER_SUPPRESSED' });
  } else if (type === 'MANUAL_SUPPRESSION') {
    actions.push({ action: 'CREATE_CONTACT_SUPPRESSION', reason: 'MANUAL' });
  }

  if (['REPLY', 'INBOUND_REPLY'].includes(type)) actions.push({ action: 'STOP_THREAD_AUTOMATION', reason: 'RECIPIENT_REPLIED' });
  if (type === 'MANUAL_TAKEOVER') actions.push({ action: 'STOP_THREAD_AUTOMATION', reason: 'MANUAL_TAKEOVER' });

  const seen = new Set();
  return actions.filter(action => {
    const key = `${action.action}:${action.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function activeSuppressionReason(suppressions = [], now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  return unique((suppressions || []).filter(item => {
    if (item.lifted_at) return false;
    if (!item.expires_at) return true;
    const expires = new Date(item.expires_at);
    return !Number.isNaN(expires.getTime()) && expires > at;
  }).map(item => upper(item.reason || item.suppression_reason)));
}
