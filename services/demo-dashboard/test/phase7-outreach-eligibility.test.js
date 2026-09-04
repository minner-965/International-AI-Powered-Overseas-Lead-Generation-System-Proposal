import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEligibilitySnapshot,
  evaluateContactVerification,
  evaluateOutreachEligibility
} from '../src/outreach/index.js';

const NOW = new Date('2026-08-31T00:00:00.000Z');

function eligibleInput(overrides = {}) {
  return {
    outreach_enabled: true,
    live_prospect_send_approved: true,
    company: { verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' },
    relationship_status: 'NEW_PROSPECT',
    buyer_model: 'DIRECT_END_BUYER',
    category_procurement_match_status: 'CATEGORY_PROCUREMENT_MATCH',
    opportunity_readiness: 'SALES_READY',
    has_verified_profile_relevant_named_buyer: true,
    has_active_business_email_route: true,
    contact: {
      id: '00000000-0000-4000-8000-000000000011',
      normalized_email: 'buyer@synthetic.invalid',
      verification_status: 'VALID',
      last_verified_at: '2026-08-20T00:00:00.000Z'
    },
    company_suppressed: false,
    contact_suppressed: false,
    approval: { status: 'APPROVED' },
    approval_digest_matches: true,
    provider_purpose_allowed: true,
    rate_caps_permit: true,
    ...overrides
  };
}

test('complete exact-version send gate is eligible only when every independent condition passes', () => {
  const result = evaluateOutreachEligibility(eligibleInput(), { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.status, 'ELIGIBLE');
  assert.deepEqual(result.reason_codes, []);
});

test('active route requires a mailbox email route and VALID freshness, not phone, whatsapp or public observation', () => {
  for (const contact of [
    {
      id: '00000000-0000-4000-8000-000000000021',
      contact_type: 'PHONE',
      contact_value: '+971500000000',
      verification_status: 'VALID',
      last_verified_at: '2026-08-20T00:00:00.000Z'
    },
    {
      id: '00000000-0000-4000-8000-000000000022',
      contact_type: 'WHATSAPP',
      contact_value: '+971500000001',
      verification_status: 'VALID',
      last_verified_at: '2026-08-20T00:00:00.000Z'
    },
    {
      id: '00000000-0000-4000-8000-000000000023',
      contact_type: 'EMAIL',
      normalized_email: 'buyer@synthetic.invalid',
      verification_status: 'FORMAT_VALID',
      last_verified_at: '2026-08-20T00:00:00.000Z'
    },
    {
      id: '00000000-0000-4000-8000-000000000024',
      contact_type: 'EMAIL',
      normalized_email: 'buyer@synthetic.invalid',
      verification_status: 'PUBLICLY_OBSERVED',
      last_verified_at: '2026-08-20T00:00:00.000Z'
    }
  ]) {
    const result = evaluateOutreachEligibility(eligibleInput({ contact, has_active_business_email_route: false }), { now: NOW });
    assert.equal(result.eligible, false);
    assert.ok(result.reason_codes.some(reason => ['ACTIVE_BUSINESS_EMAIL_REQUIRED', 'CONTACT_VERIFICATION_REQUIRED', 'MAILBOX_LEVEL_VERIFICATION_REQUIRED'].includes(reason)));
  }
});

test('kill switches are mandatory for send but not factual draft-stage evaluation', () => {
  const input = eligibleInput({ outreach_enabled: false, live_prospect_send_approved: false });
  const send = evaluateOutreachEligibility(input, { now: NOW });
  assert.equal(send.eligible, false);
  assert.ok(send.reason_codes.includes('OUTREACH_DISABLED'));
  assert.ok(send.reason_codes.includes('LIVE_PROSPECT_SEND_NOT_APPROVED'));
  const draft = evaluateOutreachEligibility(input, { now: NOW, stage: 'DRAFT' });
  assert.equal(draft.eligible, true);
});

test('unclear, excluded and unknown buyer models are blocked without changing their Phase 6.1 facts', () => {
  for (const buyer_model of ['UNCLEAR_INTERMEDIARY', 'EXCLUDED_INTERMEDIARY', 'UNKNOWN']) {
    const input = eligibleInput({ buyer_model, supplier_access_score: 100, dpv_score: 100 });
    const result = evaluateOutreachEligibility(input, { now: NOW });
    assert.equal(result.eligible, false);
    assert.ok(result.reason_codes.includes('BUYER_MODEL_NOT_ELIGIBLE'));
    assert.equal(result.fact_snapshot.buyer_model, buyer_model);
    assert.equal(input.supplier_access_score, 100);
    assert.equal(input.dpv_score, 100);
  }
});

test('supplier access cannot compensate for Product Match or SALES_READY', () => {
  const result = evaluateOutreachEligibility(eligibleInput({
    category_procurement_match_status: 'WEAK_CATEGORY_MATCH',
    opportunity_readiness: 'NEEDS_DECISION_MAKER',
    supplier_access_score: 100
  }), { now: NOW });
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('CATEGORY_MATCH_CONFIRMATION_REQUIRED'));
  assert.ok(result.reason_codes.includes('READINESS_NOT_SALES_READY'));
});

test('existing relationships and both suppression levels remain independent blockers', () => {
  const result = evaluateOutreachEligibility(eligibleInput({
    relationship_status: 'INTERNAL_EXISTING_CUSTOMER',
    company_suppressed: true,
    contact_suppressed: true
  }), { now: NOW });
  assert.ok(result.reason_codes.includes('RELATIONSHIP_NOT_NEW_PROSPECT'));
  assert.ok(result.reason_codes.includes('COMPANY_SUPPRESSED'));
  assert.ok(result.reason_codes.includes('CONTACT_SUPPRESSED'));
});

test('exact approval, provider-purpose and rate-cap checks are non-compensable', () => {
  const result = evaluateOutreachEligibility(eligibleInput({
    approval: { status: 'PENDING_REVIEW' },
    approval_digest_matches: false,
    provider_purpose_allowed: false,
    rate_caps_permit: false
  }), { now: NOW });
  assert.deepEqual(result.reason_codes.slice(-4), [
    'EXACT_VERSION_APPROVAL_REQUIRED',
    'APPROVAL_DIGEST_MISMATCH',
    'PROVIDER_PURPOSE_NOT_ALLOWED',
    'SEND_RATE_CAP_BLOCKED'
  ]);
});

test('mailbox verification mapping and TTL preserve MX/domain-only distinction', () => {
  const cases = {
    VALID: ['READY_FOR_REVIEW', true],
    ACCEPT_ALL: ['MANUAL_RISK_REVIEW', false],
    UNKNOWN: ['HOLD', false],
    TEMPORARY_ERROR: ['RETRY_LATER', false],
    INVALID: ['SUPPRESS_CONTACT', false],
    NOT_VERIFIED: ['HOLD', false],
    DOMAIN_MX_VERIFIED: ['MAILBOX_VERIFICATION_REQUIRED', false],
    PUBLICLY_OBSERVED: ['MAILBOX_VERIFICATION_REQUIRED', false]
  };
  for (const [verification_status, [decision, eligible]] of Object.entries(cases)) {
    const result = evaluateContactVerification({ verification_status, last_verified_at: '2026-08-20T00:00:00Z' }, { now: NOW });
    assert.equal(result.decision, decision);
    assert.equal(result.eligible_for_send, eligible);
  }
  const expired = evaluateContactVerification({ verification_status: 'VALID', last_verified_at: '2026-06-01T00:00:00Z' }, { now: NOW });
  assert.equal(expired.eligible_for_send, false);
  assert.ok(expired.reason_codes.includes('CONTACT_VERIFICATION_EXPIRED'));
});

test('eligibility snapshot freezes the Phase 6.1 facts and shows draft/send gate divergence', () => {
  const snapshot = buildEligibilitySnapshot(eligibleInput({
    company_id: '00000000-0000-4000-8000-000000000101',
    market_code: 'AE',
    product_profile: 'WOMENSWEAR',
    buyer_business_model_result_id: '00000000-0000-4000-8000-000000000102',
    category_procurement_match_result_id: '00000000-0000-4000-8000-000000000103',
    product_opportunity_result_id: '00000000-0000-4000-8000-000000000104',
    decision_maker_id: '00000000-0000-4000-8000-000000000105',
    decision_maker_contact_id: '00000000-0000-4000-8000-000000000011',
    approved_claim_ids: ['claim.synthetic.womenswear'],
    evidence_ids: ['evidence.synthetic'],
    recommended_product_ids: ['product.synthetic'],
    allowed_ctas: ['REQUEST_PERMISSION_TO_SHARE_CATALOGUE'],
    supplier_access_band: 'HIGH',
    product_access_matrix: 'DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS',
    product_opportunity_status: 'READY'
  }), { now: NOW, stage: 'DRAFT' });
  assert.equal(snapshot.snapshot.schema_version, 'outreach-eligibility-snapshot-v1');
  assert.equal(snapshot.snapshot.fact_snapshot.buyer_model, 'DIRECT_END_BUYER');
  assert.equal(snapshot.snapshot.fact_snapshot.category_procurement_match_status, 'CATEGORY_PROCUREMENT_MATCH');
  assert.equal(snapshot.snapshot.fact_snapshot.product_access_matrix, 'DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS');
  assert.equal(snapshot.snapshot.draft_gate.eligible, true);
  assert.equal(snapshot.snapshot.send_gate.eligible, true);
  assert.match(snapshot.snapshot_digest, /^[a-f0-9]{64}$/);
});
