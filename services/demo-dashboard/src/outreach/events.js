import { unique, upper } from './constants.js';

const STATE_PRECEDENCE = Object.freeze({
  QUEUED: 10,
  BLOCKED: 15,
  SENDING: 20,
  PROVIDER_ACCEPTED: 30,
  DELIVERED: 40,
  SOFT_BOUNCED: 45,
  FAILED: 50,
  HARD_BOUNCED: 60,
  CANCELLED: 65,
  OPTED_OUT: 70,
  COMPLAINED: 80
});

export function deriveDeliveryState(events = [], initial = 'QUEUED') {
  const ordered = [{ event_type: upper(initial), occurred_at: null }, ...(events || [])]
    .map((event, index) => ({
      event_type: upper(event.event_type || event.status),
      occurred_at: event.occurred_at || event.created_at || null,
      provider_event_id: event.provider_event_id || null,
      index
    }))
    .filter(event => STATE_PRECEDENCE[event.event_type] !== undefined)
    .sort((a, b) => STATE_PRECEDENCE[b.event_type] - STATE_PRECEDENCE[a.event_type]
      || String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))
      || b.index - a.index);
  return ordered[0]?.event_type || upper(initial);
}

export function deduplicateProviderEvents(events = []) {
  const seen = new Set();
  const accepted = [];
  const duplicate_ids = [];
  for (const event of events || []) {
    const provider = upper(event.provider);
    const id = String(event.provider_event_id || '').trim();
    if (!provider || !id) continue;
    const key = `${provider}:${id}`;
    if (seen.has(key)) { duplicate_ids.push(key); continue; }
    seen.add(key);
    accepted.push(event);
  }
  return { events: accepted, duplicate_ids: unique(duplicate_ids) };
}

export function providerRetryDecision({ http_status, error_type, attempt = 1, max_attempts = 3 } = {}) {
  const status = Number(http_status);
  const transient = status === 429 || status >= 500 || upper(error_type) === 'NETWORK_ERROR';
  const retry = transient && Number(attempt) < Number(max_attempts);
  return {
    retry,
    permanent: !transient,
    next_delay_seconds: retry ? Math.min(300, 2 ** Math.max(0, Number(attempt) - 1) * 5) : null
  };
}
