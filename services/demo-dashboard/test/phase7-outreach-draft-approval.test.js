import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildApprovalDigest,
  buildMarketingContext,
  buildOutboundIdempotencyKey,
  matchesApproval,
  validateOutreachDraft
} from '../src/outreach/index.js';

const IDS = {
  company: '00000000-0000-4000-8000-000000000001',
  contact: '00000000-0000-4000-8000-000000000002',
  evidence: '00000000-0000-4000-8000-000000000003',
  product: '00000000-0000-4000-8000-000000000004',
  draft: '00000000-0000-4000-8000-000000000005',
  recipient: '00000000-0000-4000-8000-000000000006',
  approval: '00000000-0000-4000-8000-000000000007'
};

const claim = {
  approved_claim_id: 'claim.synthetic.womenswear',
  claim_text: 'We support selected womenswear categories.',
  allowed_markets: ['AE'],
  allowed_product_profiles: ['WOMENSWEAR'],
  proof_ids: ['proof.synthetic'],
  approved_by: 'manager.synthetic',
  approved_at: '2026-08-01T00:00:00Z',
  expires_at: null
};

const localePolicy = {
  markets: {
    AE: { default_language: 'en', allowed_languages: ['en'] },
    MX: { default_language: 'es', allowed_languages: ['es'] }
  }
};

const messagePolicy = {
  maximum_ctas_per_message: 1,
  maximum_followups: 3,
  maximum_products_per_message: 3,
  allowed_ctas: [
    'REQUEST_PERMISSION_TO_SHARE_CATALOGUE',
    'REQUEST_CATEGORY_DISCUSSION',
    'REQUEST_SHORT_INTRODUCTORY_CALL'
  ]
};

test('marketing context projects only allowlisted verified facts and resolves exact IDs', () => {
  const result = buildMarketingContext({
    company_id: IDS.company,
    company_display_name: 'Synthetic Retail Buyer',
    market_code: 'AE',
    product_profile: 'WOMENSWEAR',
    buyer_persona: 'Category buyer',
    marketing_context_version: 'context-v1',
    approved_claim_ids: [claim.approved_claim_id],
    evidence_ids: [IDS.evidence],
    recommended_product_ids: [IDS.product],
    target_language: 'en',
    allowed_ctas: ['REQUEST_PERMISSION_TO_SHARE_CATALOGUE'],
    evidence: [{ evidence_id: IDS.evidence, verified_summary: 'Verified synthetic category evidence' }],
    products: [{ product_id: IDS.product, display_name: 'Synthetic womenswear category', product_profile: 'WOMENSWEAR' }]
  }, { approvedClaims: [claim], localePolicy, messagePolicy, now: new Date('2026-08-31T00:00:00Z') });
  assert.equal(result.valid, true);
  assert.equal(result.context.approved_claims.length, 1);
  assert.equal(result.context.evidence.length, 1);
  assert.equal(result.context.products.length, 1);
  assert.deepEqual(result.context.allowed_ctas, ['REQUEST_PERMISSION_TO_SHARE_CATALOGUE']);
  assert.doesNotMatch(JSON.stringify(result.context), /raw_html|supplier_cost|<script>/i);
});

test('restricted top-level inputs are rejected and never projected to model context', () => {
  const result = buildMarketingContext({
    company_id: IDS.company,
    market_code: 'AE',
    product_profile: 'WOMENSWEAR',
    supplier_cost: 'CANARY-COST',
    api_key: 'CANARY-KEY'
  }, { localePolicy, messagePolicy });
  assert.equal(result.valid, false);
  assert.doesNotMatch(JSON.stringify(result.context), /CANARY|supplier_cost|api_key/i);
});

test('market, language, CTA and allowlist mismatches fail before draft generation', () => {
  const result = buildMarketingContext({
    company_id: IDS.company,
    market_code: 'MX',
    product_profile: 'WOMENSWEAR',
    target_language: 'en',
    allowed_ctas: ['REQUEST_PERMISSION_TO_SHARE_CATALOGUE', 'REQUEST_CATEGORY_DISCUSSION'],
    company: { id: IDS.company, lifecycle_status: 'ACTIVE' },
    unreviewed_field: 'should-not-pass'
  }, { approvedClaims: [claim], localePolicy, messagePolicy, now: new Date('2026-08-31T00:00:00Z') });
  assert.equal(result.valid, false);
  for (const reason of ['UNALLOWLISTED_INPUT_FIELD:unreviewed_field', 'UNALLOWLISTED_PROJECTION_FIELD:company.lifecycle_status', 'LANGUAGE_NOT_ALLOWED', 'CTA_RESOLUTION_FAILED']) {
    assert.ok(result.errors.includes(reason), reason);
  }
});

test('nested projection contract rejects fields outside the safe repository projection', () => {
  const result = buildMarketingContext({
    company_id: IDS.company,
    market_code: 'AE',
    product_profile: 'WOMENSWEAR',
    target_language: 'en',
    allowed_ctas: ['REQUEST_PERMISSION_TO_SHARE_CATALOGUE'],
    evidence_ids: [IDS.evidence],
    recommended_product_ids: [IDS.product],
    company: { id: IDS.company, display_name: 'Synthetic Buyer', lifecycle_status: 'ACTIVE' },
    evidence: [{ id: IDS.evidence, verified_summary: 'Verified evidence', raw_payload: 'drop' }],
    products: [{ id: IDS.product, display_name: 'Synthetic Product', product_profile: 'WOMENSWEAR', assignment_status: 'CONFIRMED' }]
  }, { approvedClaims: [claim], localePolicy, messagePolicy, now: new Date('2026-08-31T00:00:00Z') });
  assert.equal(result.valid, false);
  for (const reason of [
    'UNALLOWLISTED_PROJECTION_FIELD:company.lifecycle_status',
    'RESTRICTED_INPUT_FIELD:evidence.0.raw_payload',
    'UNALLOWLISTED_PROJECTION_FIELD:products[0].assignment_status'
  ]) assert.ok(result.errors.includes(reason), reason);
});

function validDraft() {
  return {
    language: 'en',
    subject: 'Womenswear category discussion',
    body_text: `${claim.claim_text} May we share a short category catalogue?`,
    followups: [],
    personalization_reason: 'Relevant verified category activity',
    personalization_statements: [{ text: 'Relevant verified category activity', evidence_ids: [IDS.evidence] }],
    used_evidence_ids: [IDS.evidence],
    recommended_product_ids: [IDS.product],
    approved_claim_ids: [claim.approved_claim_id],
    template_version: 'cold-email-synthetic-v1',
    skill_versions: { 'dpv-b2b-outreach': 'v1' },
    generation_version: 'dpv-b2b-outreach-v1',
    input_digest: 'a'.repeat(64),
    policy_warnings: []
  };
}

function draftContract() {
  return {
    target_language: 'en',
    available_evidence_ids: [IDS.evidence],
    available_product_ids: [IDS.product],
    approved_claims: [claim],
    company_id: IDS.company,
    product_profile: 'WOMENSWEAR',
    decision_maker_contact_id: IDS.contact,
    eligibility_snapshot: {
      company_id: IDS.company,
      product_profile: 'WOMENSWEAR',
      decision_maker_contact_id: IDS.contact
    },
    input_digest: 'a'.repeat(64),
    message_policy: messagePolicy
  };
}

test('valid evidence-bound draft defaults to PENDING_REVIEW and never self-approves', () => {
  const result = validateOutreachDraft(validDraft(), draftContract());
  assert.equal(result.valid, true);
  assert.equal(result.draft_status, 'PENDING_REVIEW');
  assert.match(result.content_hash, /^[a-f0-9]{64}$/);
});

test('digest and policy limits are enforced deterministically', () => {
  const draft = validDraft();
  draft.input_digest = 'b'.repeat(64);
  draft.followups = ['1', '2', '3', '4'];
  draft.recommended_product_ids = [IDS.product, 'product-2', 'product-3', 'product-4'];
  const result = validateOutreachDraft(draft, draftContract());
  for (const reason of ['INPUT_DIGEST_MISMATCH', 'FOLLOWUP_LIMIT_EXCEEDED', 'PRODUCT_LIMIT_EXCEEDED', 'UNRESOLVED_PRODUCT_REFERENCE']) {
    assert.ok(result.reason_codes.includes(reason), reason);
  }
});

test('fabricated thread prefix, unresolved references, internal canaries and commercial commitments fail deterministically', () => {
  const draft = validDraft();
  draft.subject = 'Re: price discussion';
  draft.body_text = 'Supplier cost is C:\\staging\\orders.xlsx. MOQ 100, delivery within 7 days.';
  draft.used_evidence_ids = ['evidence.missing'];
  draft.recommended_product_ids = ['product.missing'];
  draft.approved_claim_ids = ['claim.missing'];
  const result = validateOutreachDraft(draft, draftContract());
  assert.equal(result.draft_status, 'INVALID_DRAFT');
  for (const reason of [
    'FABRICATED_THREAD_PREFIX', 'RESTRICTED_INTERNAL_CONTENT', 'UNSUPPORTED_COMMERCIAL_COMMITMENT',
    'UNRESOLVED_EVIDENCE_REFERENCE', 'UNRESOLVED_PRODUCT_REFERENCE', 'UNAPPROVED_CLAIM_REFERENCE'
  ]) assert.ok(result.reason_codes.includes(reason), reason);
});

function approvalInput(draft = validDraft()) {
  return {
    draft,
    draft_id: IDS.draft,
    draft_version: 1,
    recipient_id: IDS.recipient,
    recipient_email: 'Buyer@Synthetic.Invalid',
    company_id: IDS.company,
    product_profile: 'WOMENSWEAR',
    from_identity: 'sales@dpv.synthetic',
    reply_to: 'reply@dpv.synthetic',
    channel: 'EMAIL',
    approved_claim_ids: [claim.approved_claim_id],
    evidence_snapshot_hash: 'b'.repeat(64)
  };
}

test('approval binds recipient, content, sender, channel and evidence snapshot exactly', () => {
  const built = buildApprovalDigest(approvalInput());
  const approval = { status: 'APPROVED', approval_digest: built.approval_digest };
  assert.equal(matchesApproval(approval, approvalInput()).matches, true);
  const changed = approvalInput({ ...validDraft(), body_text: `${validDraft().body_text} Changed.` });
  assert.equal(matchesApproval(approval, changed).matches, false);
  assert.ok(matchesApproval(approval, changed).reason_codes.includes('APPROVAL_DIGEST_MISMATCH'));
  assert.notEqual(buildApprovalDigest(changed).approval_digest, built.approval_digest);
});

test('approval digest requires a positive integer draft version', () => {
  assert.throws(() => buildApprovalDigest({ ...approvalInput(), draft_version: 0 }), /draft_version must be a positive integer/i);
  assert.throws(() => buildApprovalDigest({ ...approvalInput(), draft_version: 1.5 }), /draft_version must be a positive integer/i);
});

test('outbound idempotency key is stable and changes with recipient or exact content', () => {
  const input = { approval_id: IDS.approval, approved_content_hash: 'c'.repeat(64), recipient: 'buyer@synthetic.invalid', from_identity: 'sales@dpv.synthetic' };
  assert.equal(buildOutboundIdempotencyKey(input), buildOutboundIdempotencyKey({ ...input, recipient: 'BUYER@SYNTHETIC.INVALID' }));
  assert.notEqual(buildOutboundIdempotencyKey(input), buildOutboundIdempotencyKey({ ...input, approved_content_hash: 'd'.repeat(64) }));
});
