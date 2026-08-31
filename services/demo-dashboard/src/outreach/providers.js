import { createHmac, timingSafeEqual } from 'node:crypto';
import { upper } from './constants.js';

export const PROVIDER_PURPOSES = Object.freeze({
  COLD_OUTREACH: 'COLD_OUTREACH',
  OPT_IN: 'OPT_IN',
  TRANSACTIONAL: 'TRANSACTIONAL'
});

const RESEND_EVENT_TYPE_MAP = Object.freeze({
  'email.bounced': 'HARD_BOUNCED',
  'email.clicked': 'CLICKED',
  'email.complained': 'COMPLAINED',
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DELIVERY_DELAYED',
  'email.failed': 'FAILED',
  'email.opened': 'OPENED',
  'email.received': 'INBOUND_RECEIVED',
  'email.sent': 'PROVIDER_ACCEPTED'
});

function readHeader(headers, ...names) {
  const entries = Object.entries(headers || {});
  for (const name of names) {
    const pair = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (!pair) continue;
    const value = pair[1];
    if (Array.isArray(value)) return value.map(String).find(Boolean) || '';
    if (value !== undefined && value !== null) return String(value);
  }
  return '';
}

function constantTimeBase64Equal(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseSvixSignatures(signatureHeader = '') {
  return String(signatureHeader)
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [version, ...rest] = part.split(',');
      return {
        version: String(version || '').trim(),
        signature: rest.join(',').trim()
      };
    })
    .filter(part => part.version && part.signature);
}

function rawPayloadText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value ?? '');
}

export function verifySvixWebhook(rawBody, headers = {}, {
  webhookSecret = '',
  toleranceSeconds = 300,
  now = Date.now()
} = {}) {
  const payload = rawPayloadText(rawBody);
  const id = readHeader(headers, 'svix-id', 'webhook-id').trim();
  const timestamp = readHeader(headers, 'svix-timestamp', 'webhook-timestamp').trim();
  const signatureHeader = readHeader(headers, 'svix-signature', 'webhook-signature').trim();

  if (!payload) return { verified: false, code: 'RAW_BODY_REQUIRED', network_calls: 0 };
  if (!id || !timestamp || !signatureHeader) return { verified: false, code: 'WEBHOOK_HEADERS_REQUIRED', network_calls: 0 };
  if (!String(webhookSecret || '').startsWith('whsec_')) return { verified: false, code: 'WEBHOOK_SECRET_INVALID', network_calls: 0 };

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return { verified: false, code: 'WEBHOOK_TIMESTAMP_INVALID', network_calls: 0 };
  const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
  const nowSeconds = now instanceof Date ? now.getTime() / 1000 : Number(now) / 1000;
  if (Number.isFinite(nowSeconds) && Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { verified: false, code: 'WEBHOOK_TIMESTAMP_EXPIRED', network_calls: 0 };
  }

  let secretBytes;
  try {
    secretBytes = Buffer.from(String(webhookSecret).split('_')[1], 'base64');
  } catch {
    return { verified: false, code: 'WEBHOOK_SECRET_INVALID', network_calls: 0 };
  }

  const expected = createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  const signatures = parseSvixSignatures(signatureHeader)
    .filter(item => item.version === 'v1')
    .map(item => item.signature);
  const verified = signatures.some(signature => constantTimeBase64Equal(signature, expected));
  return {
    verified,
    code: verified ? 'WEBHOOK_VERIFIED' : 'WEBHOOK_SIGNATURE_INVALID',
    webhook_id: id,
    webhook_timestamp: timestampSeconds,
    network_calls: 0
  };
}

function normalizeResendEventType(value) {
  return RESEND_EVENT_TYPE_MAP[String(value || '').trim().toLowerCase()] || upper(value);
}

export function evaluateProviderPurpose({ provider = 'NONE', purpose, consent_status, use_case = 'DISABLED' } = {}) {
  const providerName = upper(provider || 'NONE');
  const normalizedPurpose = upper(purpose);
  const consent = upper(consent_status);
  const rawUseCase = upper(use_case || 'DISABLED');
  const useCase = rawUseCase === 'TRANSACTIONAL_RELATIONSHIP' ? 'TRANSACTIONAL' : rawUseCase;
  if (providerName === 'NONE') return { allowed: false, code: 'PROVIDER_NONE' };
  if (providerName === 'RESEND') {
    if (useCase === 'DISABLED' || normalizedPurpose === 'COLD_OUTREACH') {
      return { allowed: false, code: 'PROVIDER_PURPOSE_NOT_ALLOWED' };
    }
    if (useCase === 'OPT_IN' && (normalizedPurpose !== 'OPT_IN' || consent !== 'EXPLICIT_OPT_IN')) {
      return { allowed: false, code: 'PROVIDER_PURPOSE_NOT_ALLOWED' };
    }
    if (useCase === 'TRANSACTIONAL' && (
      normalizedPurpose !== 'TRANSACTIONAL'
      || !['EXPLICIT_OPT_IN', 'TRANSACTIONAL_RELATIONSHIP'].includes(consent)
    )) {
      return { allowed: false, code: 'PROVIDER_PURPOSE_NOT_ALLOWED' };
    }
    if (!['OPT_IN', 'TRANSACTIONAL'].includes(useCase)) return { allowed: false, code: 'PROVIDER_PURPOSE_NOT_ALLOWED' };
    return { allowed: true, code: 'PROVIDER_PURPOSE_ALLOWED' };
  }
  return { allowed: false, code: 'PROVIDER_POLICY_ADAPTER_REQUIRED' };
}

export class NoneProvider {
  constructor() { this.name = 'NONE'; }
  capabilities() { return { outbound: false, purposes: [] }; }
  validatePurpose() { return { allowed: false, code: 'PROVIDER_NONE' }; }
  async health() { return { provider: this.name, configured: true, ready: false, network_calls: 0 }; }
  async send() { return { status: 'BLOCKED', code: 'PROVIDER_NONE', network_calls: 0 }; }
}

export class NoneInboundProvider {
  constructor() { this.name = 'NONE'; }
  capabilities() { return { inbound: false, verifies_raw_body: false, provider_events: [] }; }
  verifyWebhook() { return { verified: false, code: 'PROVIDER_NONE', network_calls: 0 }; }
  normalizeEvent() { return { verified: false, code: 'PROVIDER_NONE', network_calls: 0 }; }
}

export class ResendProvider {
  constructor({ apiKey = '', useCase = 'DISABLED', fetchImpl = globalThis.fetch, endpoint = 'https://api.resend.com/emails', timeoutMs = 10_000 } = {}) {
    this.name = 'RESEND';
    this.apiKey = String(apiKey || '');
    this.useCase = upper(useCase || 'DISABLED');
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 10_000);
    this.inflight = new Map();
    this.completed = new Map();
  }
  capabilities() { return { outbound: true, purposes: ['OPT_IN', 'TRANSACTIONAL'], use_case: this.useCase, timeout_ms: this.timeoutMs }; }
  validatePurpose(input = {}) { return evaluateProviderPurpose({ provider: this.name, use_case: this.useCase, ...input }); }
  async health() { return { provider: this.name, configured: Boolean(this.apiKey), ready: Boolean(this.apiKey) && this.useCase !== 'DISABLED', network_calls: 0 }; }
  async send(message = {}, idempotencyKey) {
    const purpose = this.validatePurpose(message);
    if (!purpose.allowed) return { status: 'BLOCKED', code: purpose.code, network_calls: 0 };
    if (!this.apiKey || typeof this.fetchImpl !== 'function') return { status: 'BLOCKED', code: 'PROVIDER_NOT_CONFIGURED', network_calls: 0 };
    const key = String(idempotencyKey || '').trim();
    if (!key) return { status: 'BLOCKED', code: 'IDEMPOTENCY_KEY_REQUIRED', network_calls: 0 };
    if (this.completed.has(key)) return { ...this.completed.get(key), idempotent_replay: true, network_calls: 0 };
    if (this.inflight.has(key)) return this.inflight.get(key);

    const operation = (async () => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': key
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            reply_to: message.reply_to,
            subject: message.subject,
            text: message.body_text
          }),
          ...(controller ? { signal: controller.signal } : {})
        });
        let payload = {};
        try { payload = await response.json(); } catch { payload = {}; }
        const result = response.ok
          ? { status: 'PROVIDER_ACCEPTED', code: 'PROVIDER_ACCEPTED', provider_message_id: payload.id || null, network_calls: 1 }
          : { status: 'FAILED', code: `PROVIDER_HTTP_${response.status}`, http_status: response.status, network_calls: 1 };
        if (response.ok) this.completed.set(key, result);
        return result;
      } catch (error) {
        if (error?.name === 'AbortError') return { status: 'FAILED', code: 'PROVIDER_TIMEOUT', error_type: 'NETWORK_ERROR', network_calls: 1 };
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    this.inflight.set(key, operation);
    try { return await operation; } finally { this.inflight.delete(key); }
  }
}

export class ResendInboundProvider {
  constructor({ webhookSecret = '', toleranceSeconds = 300, now = Date.now() } = {}) {
    this.name = 'RESEND';
    this.webhookSecret = String(webhookSecret || '');
    this.toleranceSeconds = toleranceSeconds;
    this.now = now;
  }
  capabilities() {
    return {
      inbound: true,
      verifies_raw_body: true,
      header_aliases: ['svix-id', 'svix-timestamp', 'svix-signature'],
      provider_events: Object.keys(RESEND_EVENT_TYPE_MAP)
    };
  }
  verifyWebhook(rawBody, headers = {}) {
    return verifySvixWebhook(rawBody, headers, {
      webhookSecret: this.webhookSecret,
      toleranceSeconds: this.toleranceSeconds,
      now: this.now
    });
  }
  normalizeEvent(rawBody, headers = {}) {
    const verification = this.verifyWebhook(rawBody, headers);
    if (!verification.verified) return verification;
    let payload;
    try {
      payload = JSON.parse(rawPayloadText(rawBody));
    } catch {
      return { verified: false, code: 'WEBHOOK_JSON_INVALID', network_calls: 0 };
    }
    const type = String(payload?.type || payload?.event || '').trim();
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    return {
      verified: true,
      code: 'WEBHOOK_VERIFIED',
      provider: 'RESEND',
      provider_event_id: verification.webhook_id,
      provider_message_id: String(data.email_id || data.id || data.message_id || '').trim() || null,
      event_type: normalizeResendEventType(type),
      raw_event_type: type || null,
      direction: type === 'email.received' ? 'INBOUND' : 'OUTBOUND',
      occurred_at: payload.created_at || data.created_at || new Date(verification.webhook_timestamp * 1000).toISOString(),
      metadata: {
        email_id: String(data.email_id || '').trim() || null,
        from: String(data.from || '').trim() || null,
        to: Array.isArray(data.to) ? data.to.map(String) : [],
        subject: String(data.subject || '').trim() || null
      },
      network_calls: 0
    };
  }
}

export function createOutboundProvider(config = {}) {
  const name = upper(config.provider || config.outboundEmailProvider || 'NONE');
  if (name === 'RESEND') return new ResendProvider(config);
  return new NoneProvider();
}

export function createInboundProvider(config = {}) {
  const name = upper(config.provider || config.inboundEmailProvider || 'NONE');
  if (name === 'RESEND') return new ResendInboundProvider(config);
  return new NoneInboundProvider();
}
