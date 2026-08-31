import { timingSafeEqual } from 'node:crypto';
import { digestCanonical } from './marketingContext.js';
import { unique, upper } from './constants.js';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function requiredPositiveInteger(value, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) throw new TypeError(`${name} must be a positive integer`);
  return normalized;
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sorted(values) {
  return unique((values || []).map(String)).sort();
}

export function buildContentHash(draft = {}) {
  return digestCanonical({
    language: String(draft.language || '').trim().toLowerCase(),
    subject: String(draft.subject || '').trim(),
    body_text: String(draft.body_text || '').trim(),
    followups: (draft.followups || []).map(value => String(value).trim()).filter(Boolean),
    template_version: String(draft.template_version || '').trim()
  });
}

/** Builds the immutable recipient x exact-message approval snapshot. */
export function buildApprovalSnapshot(input = {}) {
  const draft = input.draft || input;
  const contentHash = buildContentHash(draft);
  if (input.content_hash && String(input.content_hash) !== contentHash) throw new TypeError('content_hash does not match exact draft content');
  return {
    schema_version: 'outreach-approval-digest-v1',
    draft_id: required(input.draft_id || draft.id, 'draft_id'),
    draft_version: requiredPositiveInteger(input.draft_version ?? draft.draft_version ?? draft.version, 'draft_version'),
    content_hash: contentHash,
    recipient_id: required(input.recipient_id, 'recipient_id'),
    normalized_email: required(normalizeEmail(input.normalized_email || input.recipient_email), 'normalized_email'),
    company_id: required(input.company_id, 'company_id'),
    product_profile: upper(required(input.product_profile, 'product_profile')),
    from_identity: required(input.from_identity, 'from_identity'),
    reply_to: normalizeEmail(input.reply_to),
    channel: upper(required(input.channel || 'EMAIL', 'channel')),
    approved_claim_ids: sorted(input.approved_claim_ids || draft.approved_claim_ids),
    evidence_snapshot_hash: required(input.evidence_snapshot_hash, 'evidence_snapshot_hash')
  };
}

export function buildApprovalDigest(input = {}) {
  const snapshot = buildApprovalSnapshot(input);
  return { snapshot, approval_digest: digestCanonical(snapshot) };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function matchesApproval(approval = {}, current = {}) {
  try {
    const expected = buildApprovalDigest(current);
    const recordedDigest = approval.approval_digest || approval.digest;
    const status = upper(approval.status || approval.approval_status);
    const reasonCodes = [];
    if (status !== 'APPROVED') reasonCodes.push('APPROVAL_NOT_ACTIVE');
    if (!constantTimeEqual(recordedDigest, expected.approval_digest)) reasonCodes.push('APPROVAL_DIGEST_MISMATCH');
    return {
      matches: reasonCodes.length === 0,
      reason_codes: reasonCodes,
      expected_digest: expected.approval_digest,
      snapshot: expected.snapshot
    };
  } catch (error) {
    return { matches: false, reason_codes: ['APPROVAL_INPUT_INVALID'], error_code: error.name };
  }
}

export function buildOutboundIdempotencyKey({ approval_id, approved_content_hash, recipient, from_identity } = {}) {
  return digestCanonical({
    approval_id: required(approval_id, 'approval_id'),
    approved_content_hash: required(approved_content_hash, 'approved_content_hash'),
    recipient: required(normalizeEmail(recipient), 'recipient'),
    from_identity: required(from_identity, 'from_identity')
  });
}
