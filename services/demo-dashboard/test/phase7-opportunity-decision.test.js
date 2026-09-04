import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveDisplayOpportunityStatus,
  deriveOpportunityDecision,
  normalizeOpportunityRelationship
} from '../src/phase7/opportunityDecision.js';

const eligible = (overrides = {}) => ({
  company: { verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' },
  buyer: { buyer_model: 'DIRECT_END_BUYER', eligibility_status: 'ELIGIBLE' },
  category: { match_status: 'CATEGORY_PROCUREMENT_MATCH',calculation_version:'category-procurement-match-v2',
    scope_revision_id:'00000000-0000-4000-8000-000000000001',match_basis:'EXACT_CATEGORY' },
  cooperation: { opportunity_readiness: 'SALES_READY', verified_decision_maker_count: 1 },
  relationship_status: 'NEW_PROSPECT',
  verified_email_route_count: 1,
  website_status: 'CURRENT',
  ...overrides
});

test('verified direct buyer and exact category match becomes recommended', () => {
  const result = deriveOpportunityDecision(eligible());
  assert.equal(result.system_recommendation_status, 'RECOMMENDED');
  assert.equal(result.business_fit_status, 'FIT');
  assert.equal(result.contact_readiness, 'READY');
  assert.equal(result.display_opportunity_status, 'RECOMMENDED');
  assert.equal(result.rule_version, 'business-opportunity-decision-v4');
  assert.match(result.input_digest, /^[a-f0-9]{64}$/);
});

test('distribution buyer additionally requires procurement-and-resale evidence', () => {
  const missing = deriveOpportunityDecision(eligible({
    buyer: { buyer_model: 'DISTRIBUTION_BUYER', eligibility_status: 'ELIGIBLE' }
  }));
  assert.equal(missing.system_recommendation_status, 'EVIDENCE_REQUIRED');
  assert.ok(missing.reason_codes.includes('DISTRIBUTION_PROCUREMENT_RESALE_EVIDENCE_REQUIRED'));
  const present = deriveOpportunityDecision(eligible({
    buyer: { buyer_model: 'DISTRIBUTION_BUYER', eligibility_status: 'ELIGIBLE' },
    procurement_resale_evidence: true
  }));
  assert.equal(present.system_recommendation_status, 'RECOMMENDED');
});

test('certain exclusions become not suitable while unresolved facts require evidence', () => {
  for (const input of [
    eligible({ company: { verification_status: 'VERIFIED', lifecycle_status: 'DUPLICATE' } }),
    eligible({ confirmed_existing_customer: true }),
    eligible({ buyer: { buyer_model: 'EXCLUDED_INTERMEDIARY', eligibility_status: 'INELIGIBLE' } }),
    eligible({ category: { match_status: 'PRODUCT_MISMATCH' } }),
    eligible({ website_status: 'DEAD' })
  ]) assert.equal(deriveOpportunityDecision(input).system_recommendation_status, 'NOT_SUITABLE');

  for (const input of [
    eligible({ company: { verification_status: 'REVIEW', lifecycle_status: 'ACTIVE' } }),
    eligible({ buyer: { buyer_model: 'UNKNOWN', eligibility_status: 'NEEDS_EVIDENCE' } }),
    eligible({ category: { match_status: 'NEEDS_PRODUCT_EVIDENCE' } }),
    eligible({ evidence_conflict: true })
  ]) assert.equal(deriveOpportunityDecision(input).system_recommendation_status, 'EVIDENCE_REQUIRED');
});

test('contact evidence is required before a business-fit opportunity can be recommended', () => {
  const missingContact = deriveOpportunityDecision(eligible({
    cooperation: { opportunity_readiness: 'NEEDS_DECISION_MAKER', verified_decision_maker_count: 0 },
    verified_email_route_count: 0
  }));
  assert.equal(missingContact.business_fit_status, 'FIT');
  assert.equal(missingContact.system_recommendation_status, 'EVIDENCE_REQUIRED');
  assert.equal(missingContact.contact_readiness, 'EVIDENCE_REQUIRED');
  assert.ok(missingContact.reason_codes.includes('EVIDENCE_REQUIRED_CONTACT'));

  const unclearRole = deriveOpportunityDecision(eligible({
    profile_relevant_buyer_count: 1, verified_buyer_role_count: 0,
    active_valid_email_route_count: 1
  }));
  assert.equal(unclearRole.system_recommendation_status, 'EVIDENCE_REQUIRED');
  assert.ok(unclearRole.reason_codes.includes('EVIDENCE_REQUIRED_BUYER_ROLE'));

  for (const emailFacts of [
    { business_email_route_count:1,active_valid_email_route_count:0,email_route_statuses:['ACCEPT_ALL'] },
    { business_email_route_count:1,active_valid_email_route_count:0,email_route_statuses:['UNKNOWN'] },
    { business_email_route_count:1,active_valid_email_route_count:0,expired_valid_email_route_count:1,email_route_statuses:['VALID'] }
  ]) {
    const emailRequired=deriveOpportunityDecision(eligible(emailFacts));
    assert.equal(emailRequired.system_recommendation_status,'EVIDENCE_REQUIRED');
    assert.ok(emailRequired.reason_codes.includes('EVIDENCE_REQUIRED_CONTACT_ROUTE'));
  }
});

test('verified company email, phone or public WhatsApp can make a fit company a business opportunity without a named buyer',()=>{
  for(const contactType of ['BUSINESS_EMAIL','BUSINESS_PHONE','BUSINESS_WHATSAPP']){
    const result=deriveOpportunityDecision(eligible({
      cooperation:{opportunity_readiness:'NEEDS_DECISION_MAKER',verified_decision_maker_count:0},
      profile_relevant_buyer_count:0,verified_buyer_role_count:0,active_valid_email_route_count:0,
      active_company_contact_route_count:1,company_contact_route_types:[contactType]
    }));
    assert.equal(result.business_fit_status,'FIT');
    assert.equal(result.contact_readiness,'READY');
    assert.equal(result.system_recommendation_status,'RECOMMENDED');
    assert.ok(result.reason_codes.includes('COMPANY_CONTACT_ROUTE_AVAILABLE'));
    assert.ok(!result.reason_codes.includes('EVIDENCE_REQUIRED_CONTACT'));
  }
});

test('contact readiness never compensates failed product or business gates', () => {

  const highAccessMismatch = deriveOpportunityDecision(eligible({
    category: { match_status: 'PRODUCT_MISMATCH' },
    cooperation: { opportunity_readiness: 'SALES_READY', verified_decision_maker_count: 5, supplier_access_band: 'HIGH' },
    verified_email_route_count: 5
  }));
  assert.equal(highAccessMismatch.system_recommendation_status, 'NOT_SUITABLE');
  assert.equal(highAccessMismatch.business_fit_status, 'NOT_SUITABLE');
});

test('exact SKU and legacy catalog state do not block fit, while closed supplier route is HOLD',()=>{
  const noSku=deriveOpportunityDecision(eligible({product_opportunity:{sku_readiness_status:'NO_EXACT_SKU',candidate_count:0},
    cooperation:{opportunity_readiness:'SALES_READY',supplier_access_band:'UNKNOWN',verified_decision_maker_count:1}}));
  assert.equal(noSku.business_fit_status,'FIT');
  assert.equal(noSku.system_recommendation_status,'RECOMMENDED');
  const legacyCatalog=deriveOpportunityDecision(eligible({product_opportunity:{sku_readiness_status:'INTERNAL_CATALOG_UPLOAD_REQUIRED',candidate_count:0,catalog_enrichment_required:true},
    cooperation:{opportunity_readiness:'SALES_READY',supplier_access_band:'UNKNOWN',verified_decision_maker_count:1}}));
  assert.equal(legacyCatalog.business_fit_status,'FIT');
  assert.equal(legacyCatalog.system_recommendation_status,'RECOMMENDED');
  assert.ok(!legacyCatalog.reason_codes.includes('INTERNAL_CATALOG_UPLOAD_REQUIRED'));
  const closed=deriveOpportunityDecision(eligible({cooperation:{opportunity_readiness:'HOLD',supplier_route_status:'CLOSED'}}));
  assert.equal(closed.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.equal(closed.policy_contact_status,'HOLD');
  assert.equal(closed.display_opportunity_status,'HOLD');
});

test('a legacy category match without an approved scope revision is not recommended by V3',()=>{
  const result=deriveOpportunityDecision(eligible({category:{match_status:'CATEGORY_PROCUREMENT_MATCH',calculation_version:'category-procurement-match-v1'}}));
  assert.equal(result.business_fit_status,'EVIDENCE_REQUIRED');
  assert.equal(result.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.ok(result.reason_codes.includes('DPV_APPROVED_CATEGORY_SCOPE_REQUIRED'));
});

test('policy hold and exact current management event deterministically derive five display states', () => {
  assert.equal(deriveDisplayOpportunityStatus({ system_recommendation_status: 'RECOMMENDED' }), 'RECOMMENDED');
  assert.equal(deriveDisplayOpportunityStatus({ system_recommendation_status: 'RECOMMENDED', management_contact_status: 'MANAGEMENT_APPROVED', management_is_current: true }), 'MANAGEMENT_APPROVED');
  assert.equal(deriveDisplayOpportunityStatus({ system_recommendation_status: 'RECOMMENDED', management_event_type: 'REQUEST_EVIDENCE', management_is_current: true }), 'EVIDENCE_REQUIRED');
  assert.equal(deriveDisplayOpportunityStatus({ system_recommendation_status: 'RECOMMENDED', policy_contact_status: 'HOLD' }), 'HOLD');
  assert.equal(deriveDisplayOpportunityStatus({ system_recommendation_status: 'NOT_SUITABLE', management_contact_status: 'MANAGEMENT_APPROVED', management_is_current: false }), 'NOT_SUITABLE');
});

test('legacy Phase 6 relationship values map without rewriting source facts', () => {
  assert.equal(normalizeOpportunityRelationship('INTERNAL_EXISTING_CUSTOMER'), 'EXISTING_CUSTOMER');
  assert.equal(normalizeOpportunityRelationship('HISTORICAL_CRM_LEAD'), 'HISTORICAL_REVIEW');
  assert.equal(normalizeOpportunityRelationship('REVIEW'), 'UNKNOWN');
});
