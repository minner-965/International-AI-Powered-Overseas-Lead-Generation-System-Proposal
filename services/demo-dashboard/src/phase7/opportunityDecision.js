import crypto from 'node:crypto';

export const SYSTEM_RECOMMENDATION_STATUSES = Object.freeze([
  'RECOMMENDED',
  'EVIDENCE_REQUIRED',
  'NOT_SUITABLE'
]);

export const BUSINESS_FIT_STATUSES = Object.freeze([
  'FIT',
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
    || input.contact_suppressed === true
    || input.recipient_suppressed === true
    || input.market_policy_hold === true
    || input.channel_policy_hold === true
    || rawRelationship === 'SUPPRESSED'
    || input.supplier_route_closed === true
    || upper(cooperation.supplier_route_status) === 'CLOSED'
    || upper(cooperation.opportunity_readiness) === 'HOLD';
  const reasons = [];
  const exclusionReasons = [];
  const evidenceReasons = [];

  const verification = upper(company.verification_status);
  const lifecycle = upper(company.lifecycle_status);
  const buyerModel = upper(buyer.buyer_model);
  const buyerEligibility = upper(buyer.eligibility_status);
  const matchStatus = upper(category.match_status);
  const categoryRuleVersion=String(category.calculation_version||'');
  const categoryScopeBasis=upper(category.match_basis);
  const categoryScopeApproved=categoryRuleVersion==='category-procurement-match-v2'
    &&Boolean(category.scope_revision_id)
    &&['EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE'].includes(categoryScopeBasis);
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
  else if(!categoryScopeApproved)evidenceReasons.push('DPV_APPROVED_CATEGORY_SCOPE_REQUIRED');
  if (input.identity_conflict === true) evidenceReasons.push('COMPANY_IDENTITY_CONFLICT');
  if (input.evidence_conflict === true) evidenceReasons.push('BUSINESS_EVIDENCE_CONFLICT');

  let businessFitStatus = 'FIT';
  if (exclusionReasons.length) businessFitStatus = 'NOT_SUITABLE';
  else if (evidenceReasons.length) businessFitStatus = 'EVIDENCE_REQUIRED';

  const profileRelevantBuyerCount = Number(input.profile_relevant_buyer_count
    ?? input.verified_named_buyer_count ?? cooperation.verified_decision_maker_count ?? 0);
  const verifiedBuyerRoleCount = Number(input.verified_buyer_role_count ?? profileRelevantBuyerCount);
  const freshValidRouteCount = Number(input.active_valid_email_route_count ?? input.verified_email_route_count ?? 0);
  const businessEmailRouteCount = Number(input.business_email_route_count ?? freshValidRouteCount);
  const expiredValidRouteCount = Number(input.expired_valid_email_route_count ?? 0);
  const emailRouteStatuses = [...new Set((Array.isArray(input.email_route_statuses)
    ? input.email_route_statuses : []).map(upper).filter(Boolean))];
  const cooperationReadiness = upper(cooperation.opportunity_readiness);
  let contactReadiness = 'EVIDENCE_REQUIRED';
  if (businessFitStatus === 'NOT_SUITABLE' || policyHold) contactReadiness = 'BLOCKED';
  else if (profileRelevantBuyerCount > 0 && verifiedBuyerRoleCount > 0 && freshValidRouteCount > 0
    && cooperationReadiness === 'SALES_READY') contactReadiness = 'READY';
  else {
    if (profileRelevantBuyerCount <= 0) reasons.push('EVIDENCE_REQUIRED_CONTACT');
    else if (verifiedBuyerRoleCount <= 0) reasons.push('EVIDENCE_REQUIRED_BUYER_ROLE');
    if (freshValidRouteCount <= 0) reasons.push('EVIDENCE_REQUIRED_EMAIL');
    if (cooperationReadiness !== 'SALES_READY') reasons.push('SALES_READINESS_REQUIRED');
  }

  let systemStatus = 'EVIDENCE_REQUIRED';
  if (businessFitStatus === 'NOT_SUITABLE') systemStatus = 'NOT_SUITABLE';
  else if (businessFitStatus === 'FIT' && contactReadiness === 'READY' && !policyHold) systemStatus = 'RECOMMENDED';

  const reasonCodes = [...new Set([...exclusionReasons, ...evidenceReasons, ...reasons, ...(policyHold ? ['POLICY_CONTACT_HOLD'] : [])])];
  const decision = {
    business_fit_status: businessFitStatus,
    system_recommendation_status: systemStatus,
    contact_readiness: contactReadiness,
    policy_contact_status: policyHold ? 'HOLD' : 'OPEN',
    relationship_status: normalizedRelationship,
    reason_codes: reasonCodes,
    rule_version: 'business-opportunity-decision-v3'
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
      profile_relevant_buyer_count: profileRelevantBuyerCount,
      verified_buyer_role_count: verifiedBuyerRoleCount,
      active_valid_email_route_count: freshValidRouteCount,
      business_email_route_count: businessEmailRouteCount,
      expired_valid_email_route_count: expiredValidRouteCount,
      email_route_statuses: emailRouteStatuses,
      contact_suppressed: input.contact_suppressed === true,
      recipient_suppressed: input.recipient_suppressed === true,
      identity_conflict: input.identity_conflict === true,
      evidence_conflict: input.evidence_conflict === true,
      website_status: websiteStatus
    }))).digest('hex')
  };
}

export function buildPhase10RuleDryRun({
  company_id=null,product_profile=null,old_category_result={},new_category_result={},
  old_decision={},new_decision={}
}={}){
  const oldStatus=old_category_result.match_status||null;
  const newStatus=new_category_result.match_status||null;
  const remaining=[...(new_decision.reason_codes||[])];
  return {
    company_id,product_profile,
    old_category_status:oldStatus,
    new_category_status:newStatus,
    old_business_fit:old_decision.business_fit_status||null,
    new_business_fit:new_decision.business_fit_status||null,
    match_basis:new_category_result.match_basis||null,
    matched_scope:[...(new_category_result.matched_scope_ids||[])],
    remaining_evidence_blockers:[...new Set(remaining)],
    contact_readiness:new_decision.contact_readiness||'EVIDENCE_REQUIRED',
    changed:oldStatus!==newStatus
      ||(old_decision.business_fit_status||null)!==(new_decision.business_fit_status||null)
  };
}
