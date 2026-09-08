import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContactReadiness } from '../../../scripts/lib/phase13-mc03-contact.mjs';

const company = { id: 'company', relationship_status: 'NEW_PROSPECT' };
const contact = { id: 'email', company_id: 'company', contact_type: 'EMAIL', normalized_value: 'test@example.com', source_url: 'https://example.com/contact', lifecycle_status: 'ACTIVE', verification_status: 'VALID', last_verified_at: '2026-09-07T00:00:00Z' };
function run(tables = {}, record = company) { return classifyContactReadiness(record, { observed_at: '2026-09-08T00:00:00Z', tables }); }
test('MC03 empty contacts remain missing, not an authorization', () => {
  assert.deepEqual(run().contact_readiness, ['NO_CONTACT_FOUND']);
  assert.equal(run().email_eligibility.send_authorized, false);
});
test('MC03 verified mailbox independent of pool, approvals and sending permission', () => {
  const tables = { contacts: [contact], outreach_approvals: [{ id: 'approval', company_id: company.id, decision: 'APPROVED' }] };
  const before = JSON.stringify(tables);
  const result = run(tables);
  assert.deepEqual(result.contact_readiness, ['EMAIL_READY']);
  assert.equal(result.email_eligibility.status, 'NOT_EVALUATED_FOR_SEND');
  assert.equal(result.email_eligibility.send_authorized, false);
  assert.deepEqual(run(tables, { ...company, new_opportunity_pool_band: 'precision' }), result);
  assert.equal(JSON.stringify(tables), before);
});
for (const status of ['DOMAIN_MX_VERIFIED', 'PUBLICLY_OBSERVED', 'ACCEPT_ALL', 'INVALID', 'UNKNOWN']) {
  test(`MC03 ${status} mailbox is not EMAIL_READY`, () => assert.equal(run({ contacts: [{ ...contact, verification_status: status }] }).contact_readiness.includes('EMAIL_READY'), false));
}
for (const date of ['2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z', null]) {
  test(`MC03 stale/future/missing verification ${date}`, () => assert.equal(run({ contacts: [{ ...contact, last_verified_at: date }] }).email_eligibility.verified_email_available, false));
}
test('MC03 suppression is per route; company suppression blocks all', () => {
  const tables = { contacts: [contact, { ...contact, id: 'other', normalized_value: 'other@example.com' }], contact_suppressions: [{ company_id: company.id, contact_id: 'email', lifted_at: null }] };
  assert.equal(run(tables).email_eligibility.verified_email_available, true);
  tables.company_suppressions = [{ company_id: company.id, lifted_at: null }];
  assert.equal(run(tables).email_eligibility.verified_email_available, false);
});
test('MC03 explicit phone is not WhatsApp; form and WhatsApp are separate', () => {
  const phone = { ...contact, contact_type: 'PHONE', normalized_value: '+971123456789', verification_status: 'PUBLICLY_OBSERVED' };
  assert.deepEqual(run({ contacts: [phone] }).contact_readiness, ['PHONE_READY']);
  const result = run({ contacts: [phone, { ...phone, id: 'wa', contact_type: 'WHATSAPP' }, { ...phone, id: 'form', contact_type: 'CONTACT_FORM', normalized_value: 'https://example.com/contact' }] });
  assert.deepEqual(result.contact_readiness, ['PHONE_READY', 'WHATSAPP_READY', 'FORM_READY']);
});
test('MC03 named department is not named buyer; verified actual buyer is', () => {
  const person = { id: 'person', company_id: company.id, lifecycle_status: 'ACTIVE', verification_status: 'VERIFIED', normalized_role: 'BUYER' };
  assert.deepEqual(run({ decision_makers: [person] }).contact_readiness, ['NO_CONTACT_FOUND']);
  assert.deepEqual(run({ decision_makers: [{ ...person, person_name: 'Test Buyer' }] }).contact_readiness, ['NAMED_BUYER_READY']);
});
test('MC03 prior accepted or ambiguous sends retain first-touch blocker', () => {
  for (const message of [{ transport_status: 'SMTP_ACCEPTED' }, { send_status: 'AMBIGUOUS' }]) {
    const result = run({ contacts: [contact], outbound_messages: [{ company_id: company.id, ...message }] });
    assert.equal(result.email_eligibility.status, 'BLOCKED');
    assert.ok(result.email_eligibility.reason_codes.includes('PRIOR_SEND_OR_AMBIGUOUS_FIRST_TOUCH'));
  }
});
test('MC03 archived or untraceable routes stay unready and snapshot timestamp required', () => {
  for (const change of [{ lifecycle_status: 'ARCHIVED' }, { source_url: null }]) assert.equal(run({ contacts: [{ ...contact, ...change }] }).email_eligibility.verified_email_available, false);
  assert.throws(() => classifyContactReadiness(company, { tables: {} }), /observed_at/);
});
test('MC03 projection relationship remains separate blocking governance fact', () => {
  const result = run({ contacts: [contact], business_opportunity_current: [{ company_id: company.id, relationship_status: 'EXISTING_CUSTOMER' }] }, { id: company.id });
  assert.ok(result.email_eligibility.reason_codes.includes('RELATIONSHIP_REQUIRES_EXISTING_GATES'));
  assert.deepEqual(result.contact_readiness, ['EMAIL_READY']);
});
