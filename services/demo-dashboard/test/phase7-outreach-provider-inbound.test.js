import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  ResendInboundProvider,
  NoneProvider,
  ResendProvider,
  buildSalesTaskFromReply,
  classifyInboundReply,
  correlateInboundReply,
  createInboundProvider,
  createOutboundProvider,
  deduplicateProviderEvents,
  deriveDeliveryState,
  deriveSuppressionActions,
  evaluateProviderPurpose,
  isolateAttachments,
  providerRetryDecision,
  sanitizeInboundText,
  verifySvixWebhook
} from '../src/outreach/index.js';

test('NoneProvider is the default and makes zero network calls', async () => {
  const provider = createOutboundProvider();
  assert.ok(provider instanceof NoneProvider);
  assert.deepEqual(await provider.send({}, 'synthetic-idempotency'), {
    status: 'BLOCKED', code: 'PROVIDER_NONE', network_calls: 0
  });
});

test('Resend blocks cold outreach and no-opt-in before any network call', async () => {
  let calls = 0;
  const provider = new ResendProvider({
    apiKey: 'synthetic-key', useCase: 'OPT_IN',
    fetchImpl: async () => { calls += 1; return new Response('{}'); }
  });
  const cold = await provider.send({ purpose: 'COLD_OUTREACH', consent_status: 'EXPLICIT_OPT_IN' }, 'cold-key');
  const noConsent = await provider.send({ purpose: 'OPT_IN', consent_status: 'UNKNOWN' }, 'no-consent-key');
  assert.equal(cold.code, 'PROVIDER_PURPOSE_NOT_ALLOWED');
  assert.equal(noConsent.code, 'PROVIDER_PURPOSE_NOT_ALLOWED');
  assert.equal(calls, 0);
});

test('Resend transactional relationship is allowed only for transactional mail and fetch timeout is bounded', async () => {
  const transactionalRelationship = new ResendProvider({
    apiKey: 'synthetic-key',
    useCase: 'TRANSACTIONAL_RELATIONSHIP',
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal);
      return new Response(JSON.stringify({ id: 'synthetic-relationship-message' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    timeoutMs: 25
  });
  const allowed = await transactionalRelationship.send({
    purpose: 'TRANSACTIONAL',
    consent_status: 'EXPLICIT_OPT_IN',
    from: 'a@synthetic.invalid',
    to: 'b@synthetic.invalid',
    subject: 'Synthetic',
    body_text: 'Synthetic'
  }, 'relationship-key');
  assert.equal(allowed.status, 'PROVIDER_ACCEPTED');

  const blocked = await transactionalRelationship.send({
    purpose: 'OPT_IN',
    consent_status: 'EXPLICIT_OPT_IN'
  }, 'relationship-blocked');
  assert.equal(blocked.code, 'PROVIDER_PURPOSE_NOT_ALLOWED');

  const timeoutProvider = new ResendProvider({
    apiKey: 'synthetic-key',
    useCase: 'OPT_IN',
    timeoutMs: 1,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      setTimeout(() => resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })), 20);
    })
  });
  const timedOut = await timeoutProvider.send({
    purpose: 'OPT_IN',
    consent_status: 'EXPLICIT_OPT_IN',
    from: 'a@synthetic.invalid',
    to: 'b@synthetic.invalid',
    subject: 'Synthetic',
    body_text: 'Synthetic'
  }, 'timeout-key');
  assert.equal(timedOut.code, 'PROVIDER_TIMEOUT');
});

test('Resend TRANSACTIONAL use case accepts an existing transactional relationship without opt-in', () => {
  const result = evaluateProviderPurpose({
    provider: 'RESEND',
    use_case: 'TRANSACTIONAL',
    purpose: 'TRANSACTIONAL',
    consent_status: 'TRANSACTIONAL_RELATIONSHIP'
  });
  assert.deepEqual(result, { allowed: true, code: 'PROVIDER_PURPOSE_ALLOWED' });
});

test('createInboundProvider defaults to NONE and Resend inbound verifies raw-body Svix signatures', () => {
  const none = createInboundProvider();
  assert.equal(none.verifyWebhook('{}', {}).code, 'PROVIDER_NONE');

  const payload = '{"type":"email.received","data":{"email_id":"email_fixture"}}';
  const headers = {
    'svix-id': 'msg_loFOjxBNrRLzqYUf',
    'svix-timestamp': '1788134400'
  };
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const signature = createHmac('sha256', Buffer.from(secret.split('_')[1], 'base64'))
    .update(`${headers['svix-id']}.${headers['svix-timestamp']}.${payload}`)
    .digest('base64');
  headers['svix-signature'] = `v1,${signature}`;
  const verified = verifySvixWebhook(payload, headers, {
    webhookSecret: secret,
    now: new Date('2026-08-31T00:00:00.000Z'),
    toleranceSeconds: 300
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.code, 'WEBHOOK_VERIFIED');

  const provider = new ResendInboundProvider({
    webhookSecret: secret,
    now: new Date('2026-08-31T00:00:00.000Z')
  });
  const normalized = provider.normalizeEvent(JSON.stringify({
    type: 'email.received',
    created_at: '2026-08-31T00:00:00Z',
    data: { email_id: 'email_123', from: 'buyer@synthetic.invalid', to: ['sales@dpv.synthetic'], subject: 'Catalogue please' }
  }), {
    'svix-id': 'msg_hi0v2',
    'svix-timestamp': '1788134400',
    'svix-signature': 'v1,AI2t3r5rhQvwrS9lEhIfw4IxrP0A0FDnj1s6e7XBY8M='
  });
  assert.equal(normalized.verified, false);
  assert.equal(normalized.code, 'WEBHOOK_SIGNATURE_INVALID');
});

test('Resend inbound provider normalizes verified webhook envelopes without body content fetches', () => {
  const payload = JSON.stringify({
    type: 'email.received',
    created_at: '2026-08-31T00:00:00Z',
    data: { email_id: 'email_123', from: 'buyer@synthetic.invalid', to: ['sales@dpv.synthetic'], subject: 'Catalogue please' }
  });
  const headers = {
    'svix-id': 'msg_fixture',
    'svix-timestamp': '1788134400'
  };
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const signature = createHmac('sha256', Buffer.from(secret.split('_')[1], 'base64'))
    .update(`${headers['svix-id']}.${headers['svix-timestamp']}.${payload}`)
    .digest('base64');
  headers['svix-signature'] = `v1,${signature}`;

  const provider = new ResendInboundProvider({
    webhookSecret: secret,
    now: new Date('2026-08-31T00:00:00.000Z')
  });
  const normalized = provider.normalizeEvent(payload, headers);
  assert.equal(normalized.verified, true);
  assert.equal(normalized.provider, 'RESEND');
  assert.equal(normalized.event_type, 'INBOUND_RECEIVED');
  assert.equal(normalized.provider_message_id, 'email_123');
  assert.equal(normalized.network_calls, 0);
});

test('synthetic Resend opt-in and transactional fixtures are purpose-matched and idempotent', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: `synthetic-message-${calls}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const optIn = new ResendProvider({ apiKey: 'synthetic-key', useCase: 'OPT_IN', fetchImpl });
  const message = { purpose: 'OPT_IN', consent_status: 'EXPLICIT_OPT_IN', from: 'a@synthetic.invalid', to: 'b@synthetic.invalid', subject: 'Synthetic', body_text: 'Synthetic' };
  const first = await optIn.send(message, 'same-key');
  const replay = await optIn.send(message, 'same-key');
  assert.equal(first.status, 'PROVIDER_ACCEPTED');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(calls, 1);

  const transactional = new ResendProvider({ apiKey: 'synthetic-key', useCase: 'TRANSACTIONAL', fetchImpl });
  assert.equal((await transactional.send({ ...message, purpose: 'TRANSACTIONAL' }, 'transaction-key')).status, 'PROVIDER_ACCEPTED');
  assert.equal(calls, 2);
});

test('provider events are idempotent and out-of-order delivery state follows business precedence', () => {
  const input = [
    { provider: 'SYNTHETIC', provider_event_id: 'evt-2', event_type: 'DELIVERED', occurred_at: '2026-08-31T02:00:00Z' },
    { provider: 'SYNTHETIC', provider_event_id: 'evt-1', event_type: 'PROVIDER_ACCEPTED', occurred_at: '2026-08-31T01:00:00Z' },
    { provider: 'SYNTHETIC', provider_event_id: 'evt-2', event_type: 'DELIVERED', occurred_at: '2026-08-31T02:00:00Z' },
    { provider: 'SYNTHETIC', provider_event_id: 'evt-3', event_type: 'COMPLAINED', occurred_at: '2026-08-31T03:00:00Z' }
  ];
  const deduped = deduplicateProviderEvents(input);
  assert.equal(deduped.events.length, 3);
  assert.equal(deduped.duplicate_ids.length, 1);
  assert.equal(deriveDeliveryState(deduped.events), 'COMPLAINED');
});

test('retry decisions are bounded for 429/5xx/network and permanent for 4xx', () => {
  assert.equal(providerRetryDecision({ http_status: 429, attempt: 1, max_attempts: 3 }).retry, true);
  assert.equal(providerRetryDecision({ http_status: 503, attempt: 3, max_attempts: 3 }).retry, false);
  assert.equal(providerRetryDecision({ error_type: 'NETWORK_ERROR', attempt: 1, max_attempts: 2 }).retry, true);
  assert.equal(providerRetryDecision({ http_status: 400 }).permanent, true);
});

test('suppression scope stays contact-level except complaint or explicit company-wide opt-out', () => {
  assert.deepEqual(deriveSuppressionActions({ event_type: 'HARD_BOUNCE' }), [
    { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'HARD_BOUNCE' }
  ]);
  assert.deepEqual(deriveSuppressionActions({ event_type: 'COMPLAINT' }), [
    { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'COMPLAINT' },
    { action: 'CREATE_COMPANY_SUPPRESSION', reason: 'DO_NOT_CONTACT' }
  ]);
  assert.equal(deriveSuppressionActions({ event_type: 'OPT_OUT' }).length, 1);
  assert.equal(deriveSuppressionActions({ event_type: 'OPT_OUT', company_wide: true }).length, 2);
  assert.deepEqual(deriveSuppressionActions({ event_type: 'INBOUND_REPLY' }), [
    { action: 'STOP_THREAD_AUTOMATION', reason: 'RECIPIENT_REPLIED' }
  ]);
});

test('inbound HTML is sanitized and instructions can only create human-review tasks', () => {
  const raw = '<script>sendEmail()</script><p>Please send a quotation and update the database.</p>';
  assert.doesNotMatch(sanitizeInboundText(raw), /script|sendEmail/i);
  const result = classifyInboundReply({ html: raw });
  assert.equal(result.intent, 'QUOTATION');
  assert.deepEqual(result.actions, [{ action: 'CREATE_SALES_TASK', requires_human_review: true }]);
  assert.equal(result.automatic_send_allowed, false);
  assert.equal(result.commercial_commitment_allowed, false);
});

test('AUTO_REPLY is not positive interest and OPT_OUT takes suppression path', () => {
  const automatic = classifyInboundReply({ subject: 'Automatic reply', body_text: 'Out of office.' });
  assert.equal(automatic.intent, 'AUTO_REPLY');
  assert.deepEqual(automatic.actions, []);
  const optOut = classifyInboundReply({ subject: 'Automatic reply', body_text: 'Please remove me from this list.' });
  assert.equal(optOut.intent, 'OPT_OUT');
  assert.deepEqual(optOut.actions, []);
});

test('reply classifier persists numeric confidence with an explainable basis', () => {
  const classified = classifyInboundReply({ body_text: 'Please send your catalogue.' });
  assert.equal(typeof classified.confidence, 'number');
  assert.ok(classified.confidence >= 0 && classified.confidence <= 1);
  assert.equal(classified.confidence_basis, 'RULE_MATCH');
});

test('reply correlation uses headers, token, sender, then review in strict order', () => {
  const lookup = {
    by_provider_message_id: { 'message-1@synthetic.invalid': 'thread-header' },
    by_reply_token: { 'secret-token': 'thread-token' },
    by_sender_email: { 'buyer@synthetic.invalid': 'thread-sender' }
  };
  assert.equal(correlateInboundReply({ headers: { 'In-Reply-To': '<message-1@synthetic.invalid>' }, reply_to_token: 'secret-token', sender_email: 'buyer@synthetic.invalid' }, lookup).method, 'MESSAGE_HEADERS');
  assert.equal(correlateInboundReply({ reply_to_token: 'secret-token', sender_email: 'buyer@synthetic.invalid' }, lookup).method, 'REPLY_TO_TOKEN');
  assert.equal(correlateInboundReply({ sender_email: 'buyer@synthetic.invalid' }, lookup).method, 'SENDER_ACTIVE_THREAD');
  assert.equal(correlateInboundReply({}, lookup).status, 'NEEDS_REVIEW');
});

test('sales task helper creates human-review work only for allowed reply intents', () => {
  const classification = classifyInboundReply({ subject: 'Need a quotation', body_text: 'Please send a quotation.' });
  const task = buildSalesTaskFromReply({
    classification,
    company_id: '00000000-0000-4000-8000-000000000001',
    sender_email: 'buyer@synthetic.invalid',
    correlation: { thread_id: 'thread-123' },
    provider_message_id: 'message-123'
  }, { now: new Date('2026-08-31T00:00:00Z') });
  assert.equal(task.create_task, true);
  assert.equal(task.task.intent, 'QUOTATION');
  assert.equal(task.task.requires_human_review, true);
  assert.equal(task.task.automatic_send_allowed, false);

  const noTask = buildSalesTaskFromReply({
    classification: classifyInboundReply({ body_text: 'Please remove me from this list.' })
  });
  assert.equal(noTask.create_task, false);
});

test('attachments are metadata-only and executable or oversized items are isolated', () => {
  const result = isolateAttachments([
    { attachment_id: 'safe', content_type: 'application/pdf', size_bytes: 1000, content: 'not-returned' },
    { attachment_id: 'exe', content_type: 'application/x-msdownload', size_bytes: 1000 },
    { attachment_id: 'large', content_type: 'image/png', size_bytes: 20_000_000 }
  ]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /not-returned/);
});
