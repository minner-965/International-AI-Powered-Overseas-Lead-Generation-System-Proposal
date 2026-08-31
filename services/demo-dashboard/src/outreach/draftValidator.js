import { digestCanonical } from './marketingContext.js';
import { OUTREACH_POLICY_VERSION, unique, upper } from './constants.js';

const REPLY_PREFIX = /^\s*(re|fw|fwd)\s*:/i;
const INTERNAL_CANARY = /(supplier\s*(cost|price)|internal\s*(margin|profit)|raw\s*order|customer\s*note|staging\s*(path|directory)|\\\\[^\s]+\\|[a-z]:\\[^\s]+|api[_ -]?key|password|bearer\s+[a-z0-9._-]+)/i;
const COMMERCIAL_COMMITMENT = /(\bmoq\b|minimum order|lead[ -]?time|delivery within|certif(?:ied|ication)|payment terms?|\b(?:usd|eur|aed|mxn)\s*\d|[$€]\s*\d|guarantee(?:d)?\s+(?:price|delivery|quality))/i;

function asSet(values) {
  return new Set(Array.isArray(values) ? values.map(String) : []);
}

function unresolved(values, available) {
  const allowed = asSet(available);
  return unique((values || []).map(String).filter(value => !allowed.has(value)));
}

function removeApprovedClaimText(text, claims) {
  let remaining = text;
  for (const claim of claims || []) {
    const approved = String(claim?.claim_text || '').trim();
    if (approved) remaining = remaining.split(approved).join('');
  }
  return remaining;
}

export function validateOutreachDraft(output = {}, contract = {}) {
  const errors = [];
  const warnings = unique(output.policy_warnings || []);
  const subject = String(output.subject || '').trim();
  const body = String(output.body_text || '').trim();
  const language = String(output.language || '').trim().toLowerCase();
  const allowedEvidence = contract.available_evidence_ids || contract.evidence_ids || [];
  const allowedProducts = contract.available_product_ids || contract.recommended_product_ids || [];
  const allowedClaims = contract.approved_claims || [];
  const allowedClaimIds = allowedClaims.map(claim => String(claim.approved_claim_id));
  const messagePolicy = contract.message_policy || {};
  const maximumFollowups = Math.max(0, Number(messagePolicy.maximum_followups) || 0);
  const maximumProductsPerMessage = Math.max(0, Number(messagePolicy.maximum_products_per_message) || 0);

  if (!subject) errors.push('SUBJECT_REQUIRED');
  if (!body) errors.push('BODY_TEXT_REQUIRED');
  if (REPLY_PREFIX.test(subject)) errors.push('FABRICATED_THREAD_PREFIX');
  if (/<[a-z][\s\S]*>/i.test(body)) errors.push('PLAIN_TEXT_REQUIRED');
  if (INTERNAL_CANARY.test(`${subject}\n${body}`)) errors.push('RESTRICTED_INTERNAL_CONTENT');
  if (COMMERCIAL_COMMITMENT.test(removeApprovedClaimText(`${subject}\n${body}`, allowedClaims))) errors.push('UNSUPPORTED_COMMERCIAL_COMMITMENT');
  if (contract.target_language && language !== String(contract.target_language).toLowerCase()) errors.push('LANGUAGE_POLICY_MISMATCH');
  if (contract.input_digest && String(output.input_digest || '') !== String(contract.input_digest)) errors.push('INPUT_DIGEST_MISMATCH');

  const evidenceMissing = unresolved(output.used_evidence_ids, allowedEvidence);
  const productsMissing = unresolved(output.recommended_product_ids, allowedProducts);
  const claimsMissing = unresolved(output.approved_claim_ids, allowedClaimIds);
  if (evidenceMissing.length) errors.push('UNRESOLVED_EVIDENCE_REFERENCE');
  if (productsMissing.length) errors.push('UNRESOLVED_PRODUCT_REFERENCE');
  if (claimsMissing.length) errors.push('UNAPPROVED_CLAIM_REFERENCE');
  if (maximumFollowups && Array.isArray(output.followups) && output.followups.length > maximumFollowups) errors.push('FOLLOWUP_LIMIT_EXCEEDED');
  if (maximumProductsPerMessage && Array.isArray(output.recommended_product_ids)
    && unique(output.recommended_product_ids || []).length > maximumProductsPerMessage) errors.push('PRODUCT_LIMIT_EXCEEDED');

  const personalization = String(output.personalization_reason || '').trim();
  if (personalization && !(output.used_evidence_ids || []).length) errors.push('PERSONALIZATION_EVIDENCE_REQUIRED');
  for (const statement of output.personalization_statements || []) {
    if (!String(statement?.text || '').trim() || !(statement?.evidence_ids || []).length) errors.push('PERSONALIZATION_STATEMENT_EVIDENCE_REQUIRED');
    if (unresolved(statement?.evidence_ids, allowedEvidence).length) errors.push('UNRESOLVED_PERSONALIZATION_EVIDENCE');
  }

  const snapshot = contract.eligibility_snapshot || {};
  if (snapshot.company_id && contract.company_id && String(snapshot.company_id) !== String(contract.company_id)) errors.push('ELIGIBILITY_COMPANY_MISMATCH');
  if (snapshot.product_profile && contract.product_profile && upper(snapshot.product_profile) !== upper(contract.product_profile)) errors.push('ELIGIBILITY_PRODUCT_PROFILE_MISMATCH');
  if (snapshot.decision_maker_contact_id && contract.decision_maker_contact_id
    && String(snapshot.decision_maker_contact_id) !== String(contract.decision_maker_contact_id)) errors.push('ELIGIBILITY_RECIPIENT_MISMATCH');

  const reasonCodes = unique(errors);
  const normalized = {
    language,
    subject,
    body_text: body,
    followups: Array.isArray(output.followups) ? output.followups.map(value => String(value).trim()).filter(Boolean).slice(0, 3) : [],
    personalization_reason: personalization,
    used_evidence_ids: unique(output.used_evidence_ids || []),
    recommended_product_ids: unique(output.recommended_product_ids || []),
    approved_claim_ids: unique(output.approved_claim_ids || []),
    template_version: String(output.template_version || ''),
    skill_versions: output.skill_versions && typeof output.skill_versions === 'object' ? output.skill_versions : {},
    generation_version: String(output.generation_version || OUTREACH_POLICY_VERSION),
    input_digest: String(output.input_digest || ''),
    policy_warnings: warnings
  };
  return {
    valid: reasonCodes.length === 0,
    draft_status: reasonCodes.length ? 'INVALID_DRAFT' : 'PENDING_REVIEW',
    reason_codes: reasonCodes,
    draft: normalized,
    content_hash: digestCanonical({
      language: normalized.language,
      subject: normalized.subject,
      body_text: normalized.body_text,
      followups: normalized.followups,
      template_version: normalized.template_version
    })
  };
}
