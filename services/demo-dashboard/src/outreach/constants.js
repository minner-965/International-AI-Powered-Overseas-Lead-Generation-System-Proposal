export const OUTREACH_POLICY_VERSION = 'dpv-b2b-outreach-v1';
export const ELIGIBILITY_SNAPSHOT_SCHEMA_VERSION = 'outreach-eligibility-snapshot-v1';

export const ELIGIBLE_BUYER_MODELS = Object.freeze([
  'DIRECT_END_BUYER',
  'DISTRIBUTION_BUYER'
]);

export const CONTACT_VERIFICATION_DECISIONS = Object.freeze({
  VALID: 'READY_FOR_REVIEW',
  ACCEPT_ALL: 'MANUAL_RISK_REVIEW',
  UNKNOWN: 'HOLD',
  TEMPORARY_ERROR: 'RETRY_LATER',
  INVALID: 'SUPPRESS_CONTACT',
  NOT_VERIFIED: 'HOLD',
  DOMAIN_MX_VERIFIED: 'MAILBOX_VERIFICATION_REQUIRED',
  PUBLICLY_OBSERVED: 'MAILBOX_VERIFICATION_REQUIRED'
});

export const DRAFT_STATUSES = Object.freeze([
  'DRAFT',
  'INVALID_DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'EXPIRED'
]);

export const REPLY_INTENTS = Object.freeze([
  'CATALOGUE',
  'SAMPLE',
  'QUOTATION',
  'MEETING',
  'DEFER',
  'DECLINE',
  'OPT_OUT',
  'AUTO_REPLY',
  'IRRELEVANT',
  'REVIEW'
]);

export const CONTACT_SUPPRESSION_REASONS = Object.freeze([
  'INVALID_EMAIL',
  'HARD_BOUNCE',
  'SOFT_BOUNCE_LIMIT',
  'OPT_OUT',
  'COMPLAINT',
  'MANUAL',
  'PROVIDER_SUPPRESSED'
]);

export const OUTBOUND_STATES = Object.freeze([
  'QUEUED',
  'BLOCKED',
  'SENDING',
  'PROVIDER_ACCEPTED',
  'DELIVERED',
  'SOFT_BOUNCED',
  'HARD_BOUNCED',
  'FAILED',
  'CANCELLED'
]);

export function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
