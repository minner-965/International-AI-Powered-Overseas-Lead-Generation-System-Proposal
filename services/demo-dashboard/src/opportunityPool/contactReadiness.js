import { createHash } from 'node:crypto';
import { evaluateContactVerification } from '../outreach/eligibility.js';
import { contactVerificationTtlDays } from '../verification/contactVerificationPolicy.js';

const upper = value => String(value || '').toUpperCase();
const active = row => !row.lifted_at && (!row.lifecycle_status || upper(row.lifecycle_status) === 'ACTIVE');
const buyerRoles = new Set(['BUYER', 'SENIOR_BUYER', 'HEAD_OF_BUYING', 'PURCHASING', 'PROCUREMENT', 'CATEGORY_MANAGEMENT', 'MERCHANDISING', 'SOURCING']);

/** Offline descriptive mapping only. A readiness label never grants send permission. */
export function classifyContactReadiness(company, snapshot, { ttlDays = contactVerificationTtlDays() } = {}) {
  const tables = snapshot.tables || snapshot;
  const companyId = company.company_id || company.id;
  const rows = name => (tables[name] || []).filter(row => row.company_id === companyId);
  const now = new Date(snapshot.observed_at);
  if (!Number.isFinite(now.getTime())) throw new Error('Snapshot observed_at is required');
  const suppressionActive = row => active(row) && (!row.expires_at || new Date(row.expires_at).getTime() > now.getTime());
  const companySuppressed = rows('company_suppressions').some(suppressionActive);
  const people = rows('decision_makers');
  const personIds = new Set(people.filter(person => upper(person.lifecycle_status) === 'ACTIVE').map(person => person.id));
  const routes = [...rows('contacts'), ...rows('company_contact_routes'),
    ...(tables.decision_maker_contacts || []).filter(row => row.company_id === companyId || personIds.has(row.decision_maker_id))];
  const suppressions = [...rows('contact_suppressions'), ...(tables.outreach_recipient_suppressions || [])].filter(suppressionActive);
  const recipients = rows('outreach_recipients');
  const labels = new Set();
  const facts = [];
  const seen = new Set();
  for (const route of routes) {
    const type = upper(route.contact_type);
    const value = String(route.contact_value_normalized || route.normalized_value || route.contact_value || route.contact_value_raw || route.business_email || route.business_phone || '').trim();
    const key = `${route.id}:${type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hash = createHash('sha256').update(value.toLowerCase()).digest('hex');
    const linkedRecipients = recipients.filter(r => r.contact_id === route.id || r.decision_maker_contact_id === route.id);
    const suppressed = companySuppressed || suppressions.some(s =>
      s.contact_id === route.id || s.decision_maker_contact_id === route.id ||
      (s.normalized_recipient_hash && s.normalized_recipient_hash === hash) ||
      (s.recipient_id && linkedRecipients.some(r => r.id === s.recipient_id)));
    const status = upper(route.verification_status || route.contact_verification_status || route.email_verification_status);
    const traceable = Boolean(route.source_url);
    const usable = active(route) && (!route.decision_maker_id || personIds.has(route.decision_maker_id)) && traceable && Boolean(value) && !suppressed;
    let readiness = null;
    let verification = null;
    if (type.includes('EMAIL')) {
      verification = evaluateContactVerification({ verification_status: status, verification_score: route.verification_score, last_verified_at: route.last_verified_at || route.verified_at }, { now, ttlDays });
      if (usable && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && verification.eligible_for_send) readiness = 'EMAIL_READY';
    } else if (usable && ['PUBLICLY_OBSERVED', 'FORMAT_VALID', 'BUSINESS_WHATSAPP_OBSERVED', 'VALID'].includes(status)) {
      if (['PHONE', 'BUSINESS_PHONE'].includes(type) && /^\+?[\d\s().-]{7,}$/.test(value)) readiness = 'PHONE_READY';
      if (['WHATSAPP', 'BUSINESS_WHATSAPP'].includes(type)) readiness = 'WHATSAPP_READY';
      if (type === 'CONTACT_FORM' && /^https?:\/\//i.test(value)) readiness = 'FORM_READY';
    }
    if (readiness) labels.add(readiness);
    facts.push({ route_id: route.id, contact_type: type, verification_status: status, source_url: route.source_url || null,
      suppressed, readiness, reason_codes: verification?.reason_codes || [] });
  }
  if (!companySuppressed && people.some(person => active(person) && upper(person.verification_status) === 'VERIFIED' && person.person_name && buyerRoles.has(upper(person.normalized_role)))) labels.add('NAMED_BUYER_READY');
  if (!labels.size) labels.add(routes.length ? 'CONTACT_RESEARCHING' : 'NO_CONTACT_FOUND');
  const messages = rows('outbound_messages');
  const priorSend = messages.some(m => m.sent_at || upper(m.transport_status) === 'SMTP_ACCEPTED' || upper(m.send_status) === 'AMBIGUOUS');
  const reasons = [];
  if (companySuppressed) reasons.push('COMPANY_SUPPRESSED');
  if (!labels.has('EMAIL_READY')) reasons.push('NO_CURRENT_VERIFIED_EMAIL');
  if (priorSend) reasons.push('PRIOR_SEND_OR_AMBIGUOUS_FIRST_TOUCH');
  const relationships = [...new Set([company.relationship_status, company.company_relationship_status, company.relationship,
    ...rows('business_opportunity_current').map(r => r.relationship_status)].filter(Boolean))];
  if (relationships.some(relationship => upper(relationship) !== 'NEW_PROSPECT')) reasons.push('RELATIONSHIP_REQUIRES_EXISTING_GATES');
  return {
    contact_readiness: [...labels], contact_basis: facts,
    email_eligibility: {
      status: reasons.length ? 'BLOCKED' : 'NOT_EVALUATED_FOR_SEND', send_authorized: false,
      verified_email_available: labels.has('EMAIL_READY'), reason_codes: reasons,
      prior_send_or_ambiguous: priorSend, stored_relationships: relationships,
      stored_drafts: rows('outreach_drafts').map(r => ({ id: r.id, draft_status: r.draft_status, version: r.version })),
      stored_approvals: rows('outreach_approvals').map(r => ({ id: r.id, draft_id: r.draft_id, decision: r.decision })),
      outstanding_checks: ['CURRENT_RUNTIME_ELIGIBILITY', 'APPROVAL_VERSION_AND_EXPIRY', 'RECIPIENT_DOMAIN_AND_PURPOSE', 'RATE_CAPS', 'OPERATOR_SEND_AUTHORIZATION'],
      policy: 'MC03_READ_ONLY_NO_SEND_AUTHORIZATION', verification_ttl_days: ttlDays,
    },
  };
}
