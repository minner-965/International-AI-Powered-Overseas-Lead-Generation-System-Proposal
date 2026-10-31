import { evaluateContactVerification } from '../outreach/eligibility.js';
import { resolveTtlDays } from './contactVerificationPolicy.js';

// C7: re-verify a recipient whose mailbox verification is older than the one TTL setting, right
// before a first touch is reserved. One Hunter Email Verifier call (budgeted by HunterProvider);
// the stored contact and recipient rows get the fresh status, score and time. Never sends anything.
export function verificationExpired(recipient = {}, { now = new Date(), ttlDays = null } = {}) {
  const result = evaluateContactVerification({
    verification_status: recipient.verification_status, verification_score: recipient.verification_score,
    last_verified_at: recipient.verified_at || recipient.last_verified_at
  }, { now, ttlDays: resolveTtlDays(ttlDays) });
  return result.reason_codes.includes('CONTACT_VERIFICATION_EXPIRED');
}

export function createContactReverifier({ pool, hunter, now = () => new Date(), ttlDays = null } = {}) {
  if (!pool?.query) throw new TypeError('pool.query is required');
  return async function reverify({ companyId, recipient } = {}) {
    if (!recipient?.normalized_recipient || !verificationExpired(recipient, { now: now(), ttlDays })) {
      return { reverified: false, reason: 'NOT_EXPIRED' };
    }
    if (!hunter?.verifyEmail) return { reverified: false, reason: 'VERIFIER_UNAVAILABLE' };
    const job = recipient.decision_maker_contact_id
      ? (await pool.query('SELECT research_job_id FROM leadgen.decision_maker_contacts WHERE id=$1', [recipient.decision_maker_contact_id])).rows[0]
      : null;
    const result = await hunter.verifyEmail({
      researchJobId: job?.research_job_id || `reverify:${companyId}`, companyId, email: recipient.normalized_recipient
    });
    const item = result?.results?.[0];
    if (!item || !['COMPLETED', 'NOT_FOUND'].includes(String(result.status || '').toUpperCase()) || !item.verification_status) {
      return { reverified: false, reason: result?.error_code || result?.status || 'VERIFIER_NO_RESULT' };
    }
    const at = now();
    const score = Number.isFinite(Number(item.verification_score)) ? Number(item.verification_score) : null;
    if (recipient.decision_maker_contact_id) {
      await pool.query(`UPDATE leadgen.decision_maker_contacts SET verification_status=$2,verification_score=$3,
        verification_provider='HUNTER',last_verified_at=$4,updated_at=now() WHERE id=$1`,
      [recipient.decision_maker_contact_id, item.verification_status, score, at]);
    }
    if (recipient.outreach_recipient_id) {
      await pool.query(`UPDATE leadgen.outreach_recipients SET verification_status=$2,verified_at=$3,updated_at=now() WHERE id=$1`,
        [recipient.outreach_recipient_id, item.verification_status, at]);
    }
    return { reverified: true, verification_status: item.verification_status, verification_score: score, verified_at: at.toISOString() };
  };
}
