import crypto from 'node:crypto';

export const SYSTEM_RECOMMENDATION_STATUSES = Object.freeze([
  'RECOMMENDED',
  'EVIDENCE_REQUIRED',
  'NOT_SUITABLE'
]);

export const DISPLAY_OPPORTUNITY_STATUSES = Object.freeze([
  'RECOMMENDED',
  'MANAGEMENT_APPROVED',
  'EVIDENCE_REQUIRED',
  'HOLD',
  'NOT_SUITABLE'
]);

const EXCLUDED_LIFECYCLES = new Set(['DUPLICATE', 'SUPERSEDED', 'INVALID', 'ARCHIVED']);
const DEAD_WEBSITE_STATES = new Set(['DEAD', 'INVALID', 'UNREACHABLE', 'UNSUPPORTED']);
const ELIGIBLE_BUYERS = new Set(['DIRECT_END_BUYER', 'DISTRIBUTION_BUYER']);

function upper(value) { return String(value ?? '').trim().toUpperCase(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function normalizeOpportunityRelationship(value) {
  const status = upper(value);
  if (status === 'NEW_PROSPECT') return 'NEW_PROSPECT';
  if (['EXISTING_CUSTOMER', 'INTERNAL_EXISTING_CUSTOMER'].includes(status)) return 'EXISTING_CUSTOMER';
  if (['HISTORICAL_REVIEW', 'HISTORICAL_CRM_LEAD', 'HISTORICAL_CONTACTED_LEAD'].includes(status)) return 'HISTORICAL_REVIEW';
  if (status === 'SUPPRESSED') return 'SUPPRESSED';
  return 'UNKNOWN';
}

export function deriveDisplayOpportunityStatus({
  system_recommendation_status,
  management_contact_status = 'NOT_REVIEWED',
  management_event_type = null,
  management_is_current = false,
  policy_contact_status = 'OPEN'
} = {}) {
  const system = upper(system_recommendation_status);
  if (!SYSTEM_RECOMMENDATION_STATUSES.includes(system)) throw new Error('SYSTEM_RECOMMENDATION_STATUS_INVALID');
  if (upper(policy_contact_status) === 'HOLD') return 'HOLD';
  if (management_is_current && upper(management_contact_status) === 'HOLD') return 'HOLD';
  if (system !== 'RECOMMENDED') return system;
  if (management_is_current && upper(management_event_type) === 'REQUEST_EVIDENCE') return 'EVIDENCE_REQUIRED';
  if (management_is_current && upper(management_contact_status) === 'MANAGEMENT_APPROVED') return 'MANAGEMENT_APPROVED';
  return 'RECOMMENDED';
}

export function deriveOpportunityDecision(input = {}) {
  const company = input.company || {};
  const buyer = input.buyer || input.buyer_business_model || {};
  const category = input.category || input.category_procurement_match || {};
  const cooperation = input.cooperation || input.cooperation_feasibility || {};
  const normalizedRelationship = normalizeOpportunityRelationship(
    input.underlying_relationship_status || input.relationship_status || cooperation.relationship_status
  );
  const rawRelationship = normalizeOpportunityRelationship(input.relationship_status || cooperation.relationship_status);
  const policyHold = input.company_suppressed === true
    || input.market_policy_hold === true
    || input.channel_policy_hold === true
    || rawRelationship === 'SUPPRESSED';
  const reasons = [];
  const exclusionReasons = [];
  const evidenceReasons = [];

  const verification = upper(company.verification_status);
  const lifecycle = upper(company.lifecycle_status);
  const buyerModel = upper(buyer.buyer_model);
  const buyerEligibility = upper(buyer.eligibility_status);
  const matchStatus = upper(category.match_status);
  const websiteStatus = upper(input.website_status || company.website_status || 'UNKNOWN');

  if (EXCLUDED_LIFECYCLES.has(lifecycle) || company.replaced_by_company_id) exclusionReasons.push('COMPANY_DUPLICATE_OR_INACTIVE');
  if (verification === 'REJECTED') exclusionReasons.push('COMPANY_IDENTITY_REJECTED');
  if (DEAD_WEBSITE_STATES.has(websiteStatus)) exclusionReasons.push('PUBLIC_WEBSITE_INVALID');
  if (normalizedRelationship === 'EXISTING_CUSTOMER' || input.confirmed_existing_customer === true) exclusionReasons.push('EXISTING_CUSTOMER');
  if (buyerModel === 'EXCLUDED_INTERMEDIARY' || buyerEligibility === 'INELIGIBLE') exclusionReasons.push('EXCLUDED_BUYER_MODEL');
  if (matchStatus === 'PRODUCT_MISMATCH') exclusionReasons.push('PRODUCT_MISMATCH');

  if (verification !== 'VERIFIED') evidenceReasons.push('COMPANY_VERIFICATION_REQUIRED');
  if (lifecycle !== 'ACTIVE' && !EXCLUDED_LIFECYCLES.has(lifecycle)) evidenceReasons.push('COMPANY_LIFECYCLE_REVIEW');
  if (normalizedRelationship === 'HISTORICAL_REVIEW' || normalizedRelationship === 'UNKNOWN') evidenceReasons.push('RELATIONSHIP_REVIEW_REQUIRED');
  if (!ELIGIBLE_BUYERS.has(buyerModel) || buyerEligibility !== 'ELIGIBLE') evidenceReasons.push('BUYER_MODEL_EVIDENCE_REQUIRED');
  if (buyerModel === 'DISTRIBUTION_BUYER' && input.procurement_resale_evidence !== true) evidenceReasons.push('DISTRIBUTION_PROCUREMENT_RESALE_EVIDENCE_REQUIRED');
  if (matchStatus !== 'CATEGORY_PROCUREMENT_MATCH') evidenceReasons.push('CATEGORY_PROCUREMENT_EVIDENCE_REQUIRED');
  if (input.identity_conflict === true) evidenceReasons.push('COMPANY_IDENTITY_CONFLICT');
  if (input.evidence_conflict === true) evidenceReasons.push('BUSINESS_EVIDENCE_CONFLICT');

  let systemStatus = 'RECOMMENDED';
  if (exclusionReasons.length) systemStatus = 'NOT_SUITABLE';
  else if (evidenceReasons.length) systemStatus = 'EVIDENCE_REQUIRED';

  const namedBuyerCount = Number(input.verified_named_buyer_count ?? cooperation.verified_decision_maker_count ?? 0);
  const verifiedRouteCount = Number(input.verified_email_route_count ?? 0);
  const cooperationReadiness = upper(cooperation.opportunity_readiness);
  let contactReadiness = 'EVIDENCE_REQUIRED';
  if (systemStatus === 'NOT_SUITABLE') contactReadiness = 'BLOCKED';
  else if (namedBuyerCount > 0 && verifiedRouteCount > 0 && cooperationReadiness === 'SALES_READY') contactReadiness = 'READY';
  else {
    if (namedBuyerCount <= 0) reasons.push('VERIFIED_BUYER_REQUIRED');
    if (verifiedRouteCount <= 0) reasons.push('VERIFIED_EMAIL_ROUTE_REQUIRED');
    if (cooperationReadiness !== 'SALES_READY') reasons.push('SALES_READINESS_REQUIRED');
  }

  const reasonCodes = [...new Set([...exclusionReasons, ...evidenceReasons, ...reasons, ...(policyHold ? ['POLICY_CONTACT_HOLD'] : [])])];
  const decision = {
    system_recommendation_status: systemStatus,
    contact_readiness: contactReadiness,
    policy_contact_status: policyHold ? 'HOLD' : 'OPEN',
    relationship_status: normalizedRelationship,
    reason_codes: reasonCodes,
    rule_version: 'business-opportunity-decision-v1'
  };
  return {
    ...decision,
    display_opportunity_status: deriveDisplayOpportunityStatus(decision),
    input_digest: crypto.createHash('sha256').update(JSON.stringify(stable({
      company,
      buyer,
      category,
      cooperation,
      normalized_relationship: normalizedRelationship,
      policy_hold: policyHold,
      confirmed_existing_customer: input.confirmed_existing_customer === true,
      procurement_resale_evidence: input.procurement_resale_evidence === true,
      verified_named_buyer_count: namedBuyerCount,
      verified_email_route_count: verifiedRouteCount,
      identity_conflict: input.identity_conflict === true,
      evidence_conflict: input.evidence_conflict === true,
      website_status: websiteStatus
    }))).digest('hex')
  };
}
