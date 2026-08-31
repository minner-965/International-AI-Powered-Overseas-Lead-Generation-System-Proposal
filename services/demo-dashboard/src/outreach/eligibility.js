import {
  CONTACT_VERIFICATION_DECISIONS,
  ELIGIBILITY_SNAPSHOT_SCHEMA_VERSION,
  ELIGIBLE_BUYER_MODELS,
  OUTREACH_POLICY_VERSION,
  unique,
  upper
} from './constants.js';
import { digestCanonical } from './marketingContext.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/i;

function text(value, maximum = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maximum);
}

function safeId(value) {
  const normalized = text(value, 128);
  return UUID.test(normalized) || SAFE_ID.test(normalized) ? normalized : null;
}

function idList(values, limit = 100) {
  return unique((Array.isArray(values) ? values : []).map(safeId).filter(Boolean)).slice(0, limit);
}

function first(input, paths, fallback = null) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], input);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function truthy(input, paths) {
  return paths.some(path => path.split('.').reduce((current, key) => current?.[key], input) === true);
}

function isMailboxRoute(contact = {}) {
  const contactType = upper(contact.contact_type || contact.type);
  const routeType = upper(contact.route_type || contact.channel);
  const email = String(contact.normalized_email || contact.email || contact.contact_value || '').trim();
  const explicitRoute = contact.active_business_email_route === true;
  const emailTypedRoute = ['EMAIL', 'BUSINESS_EMAIL', 'WORK_EMAIL'].includes(contactType)
    || ['EMAIL', 'BUSINESS_EMAIL', 'WORK_EMAIL'].includes(routeType);
  return Boolean(email) && (explicitRoute || emailTypedRoute);
}

export function evaluateContactVerification(contact = {}, {
  now = new Date(),
  ttlDays = 30,
  allowAcceptAllSend = false
} = {}) {
  const status = upper(contact.verification_status || contact.email_verification_status || 'NOT_VERIFIED');
  const mappedDecision = CONTACT_VERIFICATION_DECISIONS[status] || 'HOLD';
  const lastVerified = contact.last_verified_at ? new Date(contact.last_verified_at) : null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const ttlMs = Math.max(0, Number(ttlDays) || 0) * 86_400_000;
  const freshnessKnown = lastVerified && !Number.isNaN(lastVerified.getTime()) && !Number.isNaN(nowDate.getTime());
  const fresh = freshnessKnown && nowDate.getTime() - lastVerified.getTime() <= ttlMs && lastVerified <= nowDate;
  const reasonCodes = [];

  if (status === 'ACCEPT_ALL' && !allowAcceptAllSend) reasonCodes.push('CONTACT_ACCEPT_ALL_REQUIRES_MANUAL_RISK_REVIEW');
  else if (status === 'TEMPORARY_ERROR') reasonCodes.push('CONTACT_VERIFICATION_TEMPORARY_ERROR');
  else if (status === 'INVALID') reasonCodes.push('CONTACT_EMAIL_INVALID');
  else if (['DOMAIN_MX_VERIFIED', 'PUBLICLY_OBSERVED'].includes(status)) reasonCodes.push('MAILBOX_LEVEL_VERIFICATION_REQUIRED');
  else if (status !== 'VALID' && !(status === 'ACCEPT_ALL' && allowAcceptAllSend)) reasonCodes.push('CONTACT_VERIFICATION_REQUIRED');

  if (['VALID', 'ACCEPT_ALL'].includes(status) && !fresh) reasonCodes.push('CONTACT_VERIFICATION_EXPIRED');

  return {
    status,
    decision: mappedDecision,
    fresh: Boolean(fresh),
    eligible_for_send: reasonCodes.length === 0,
    reason_codes: unique(reasonCodes)
  };
}

/**
 * Pure Phase 7 eligibility gate. It reads Phase 6/6.1 facts but never mutates or
 * recalculates them. `stage: DRAFT` omits send-time kill-switch/approval checks;
 * `stage: SEND` (the default) enforces the complete pre-provider gate.
 */
export function evaluateOutreachEligibility(input = {}, options = {}) {
  const stage = upper(options.stage || input.stage || 'SEND');
  const sendStage = stage === 'SEND';
  const reasons = [];
  const companyVerification = upper(first(input, ['company.verification_status', 'company_verification_status']));
  const companyLifecycle = upper(first(input, ['company.lifecycle_status', 'company_lifecycle_status']));
  const relationship = upper(first(input, ['relationship_status', 'company.relationship_status'], 'UNKNOWN'));
  const buyerModel = upper(first(input, ['buyer_business_model.buyer_model', 'buyer_model', 'buyer_business_model']));
  const matchStatus = upper(first(input, ['category_procurement_match.match_status', 'category_procurement_match_status']));
  const readiness = upper(first(input, ['readiness.opportunity_readiness', 'readiness.readiness', 'opportunity_readiness', 'readiness_status']));
  const contact = input.contact || input.recipient || {};

  if (sendStage && input.outreach_enabled !== true) reasons.push('OUTREACH_DISABLED');
  if (sendStage && input.live_prospect_send_approved !== true) reasons.push('LIVE_PROSPECT_SEND_NOT_APPROVED');
  if (companyVerification !== 'VERIFIED') reasons.push('COMPANY_NOT_VERIFIED');
  if (companyLifecycle !== 'ACTIVE') reasons.push('COMPANY_NOT_ACTIVE');
  if (relationship !== 'NEW_PROSPECT') reasons.push('RELATIONSHIP_NOT_NEW_PROSPECT');
  if (!ELIGIBLE_BUYER_MODELS.includes(buyerModel)) reasons.push('BUYER_MODEL_NOT_ELIGIBLE');
  if (matchStatus !== 'CATEGORY_PROCUREMENT_MATCH') reasons.push('CATEGORY_PROCUREMENT_MATCH_REQUIRED');
  if (readiness !== 'SALES_READY') reasons.push('READINESS_NOT_SALES_READY');

  const namedBuyer = truthy(input, ['has_verified_profile_relevant_named_buyer', 'decision_route.verified_named_buyer']);
  const buyingDepartment = truthy(input, ['has_verified_buying_department', 'decision_route.verified_buying_department']);
  if (!namedBuyer && !buyingDepartment) reasons.push('VERIFIED_BUYER_ROUTE_REQUIRED');

  const activeRoute = truthy(input, ['has_active_business_email_route'])
    || isMailboxRoute(contact);
  if (!activeRoute) reasons.push('ACTIVE_BUSINESS_EMAIL_REQUIRED');

  const verification = evaluateContactVerification(contact, {
    now: options.now || input.now || new Date(),
    ttlDays: options.contactVerificationTtlDays ?? input.contact_verification_ttl_days ?? 30,
    allowAcceptAllSend: options.allowAcceptAllSend ?? input.allow_accept_all_send ?? false
  });
  reasons.push(...verification.reason_codes);

  if (truthy(input, ['company_suppressed', 'company.suppressed', 'suppressions.company_active'])) reasons.push('COMPANY_SUPPRESSED');
  if (truthy(input, ['contact_suppressed', 'contact.suppressed', 'recipient.suppressed', 'suppressions.contact_active'])) reasons.push('CONTACT_SUPPRESSED');

  if (sendStage) {
    const approvalStatus = upper(first(input, ['approval.status', 'approval_status']));
    if (approvalStatus !== 'APPROVED') reasons.push('EXACT_VERSION_APPROVAL_REQUIRED');
    if (input.approval_digest_matches !== true) reasons.push('APPROVAL_DIGEST_MISMATCH');
    if (input.provider_purpose_allowed !== true) reasons.push('PROVIDER_PURPOSE_NOT_ALLOWED');
    if (input.rate_caps_permit !== true) reasons.push('SEND_RATE_CAP_BLOCKED');
  }

  const reasonCodes = unique(reasons);
  return {
    stage,
    eligible: reasonCodes.length === 0,
    status: reasonCodes.length ? 'BLOCKED' : 'ELIGIBLE',
    reason_codes: reasonCodes,
    contact_verification: verification,
    policy_version: OUTREACH_POLICY_VERSION,
    fact_snapshot: {
      company_verification_status: companyVerification || 'UNKNOWN',
      company_lifecycle_status: companyLifecycle || 'UNKNOWN',
      relationship_status: relationship,
      buyer_model: buyerModel || 'UNKNOWN',
      category_procurement_match_status: matchStatus || 'UNKNOWN',
      readiness: readiness || 'UNKNOWN'
    }
  };
}

export function buildEligibilitySnapshot(input = {}, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date(options.now || input.now || Date.now());
  const draftGate = evaluateOutreachEligibility(input, { ...options, stage: 'DRAFT', now: nowDate });
  const sendGate = evaluateOutreachEligibility(input, { ...options, stage: 'SEND', now: nowDate });
  const snapshot = {
    schema_version: ELIGIBILITY_SNAPSHOT_SCHEMA_VERSION,
    policy_version: OUTREACH_POLICY_VERSION,
    generated_at: Number.isNaN(nowDate.getTime()) ? null : nowDate.toISOString(),
    company_id: safeId(first(input, ['company_id', 'company.id', 'company.company_id'])),
    market_code: upper(first(input, ['market_code', 'company.market_code'])),
    product_profile: upper(first(input, ['product_profile'])),
    buyer_business_model_result_id: safeId(first(input, ['buyer_business_model_result_id'])),
    category_procurement_match_result_id: safeId(first(input, ['category_procurement_match_result_id'])),
    product_opportunity_result_id: safeId(first(input, ['product_opportunity_result_id'])) || null,
    decision_maker_id: safeId(first(input, ['decision_maker_id'])),
    decision_maker_contact_id: safeId(first(input, ['decision_maker_contact_id', 'contact.id', 'recipient.id'])),
    marketing_context_version: text(first(input, ['marketing_context_version']), 80),
    generation_policy_version: text(first(input, ['generation_policy_version'], OUTREACH_POLICY_VERSION), 80),
    target_language: text(first(input, ['target_language']), 12).toLowerCase(),
    allowed_ctas: unique((input.allowed_ctas || []).map(value => text(value, 160)).filter(Boolean)).slice(0, 5),
    approved_claim_ids: idList(input.approved_claim_ids),
    evidence_ids: idList(input.evidence_ids),
    recommended_product_ids: idList(input.recommended_product_ids),
    fact_snapshot: {
      ...draftGate.fact_snapshot,
      supplier_access_band: upper(first(input, ['supplier_access_band', 'supplier_access.band'])),
      product_access_matrix: upper(first(input, ['product_access_matrix'])),
      product_opportunity_status: upper(first(input, ['product_opportunity_status', 'product_opportunity.recommendation_status'])),
      relationship_status: upper(first(input, ['relationship_status', 'company.relationship_status'], 'UNKNOWN'))
    },
    contact_verification: draftGate.contact_verification,
    draft_gate: {
      eligible: draftGate.eligible,
      status: draftGate.status,
      reason_codes: draftGate.reason_codes
    },
    send_gate: {
      eligible: sendGate.eligible,
      status: sendGate.status,
      reason_codes: sendGate.reason_codes
    }
  };
  return {
    snapshot,
    snapshot_digest: digestCanonical(snapshot),
    draft_eligible: draftGate.eligible,
    send_eligible: sendGate.eligible
  };
}
