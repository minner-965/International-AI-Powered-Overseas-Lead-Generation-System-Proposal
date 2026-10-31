// Candidate selection for automated first touches. Selection is only a pre-filter: every
// candidate still passes the eligibility gate and the reservation function, which enforce the
// same rules again (merchant assignment, cross-sender recipient cooldown, per-sender limits).
//
// Plan C5: companies that cannot be sent to (no usable mailbox, suppressed, already contacted by this
// sender) are removed BEFORE the batch limit, so a page of unusable companies can no longer starve
// the eligible ones behind it. The rest are ordered band -> buyer model -> company size (medium first)
// -> import evidence -> contact readiness, not by company name.

const BAND_ORDER=`CASE p.opportunity_pool_band WHEN 'PRECISION' THEN 1 WHEN 'RELEVANT' THEN 2 ELSE 3 END`;
const BUYER_ORDER=`CASE buyer.buyer_model WHEN 'DIRECT_END_BUYER' THEN 1 WHEN 'DISTRIBUTION_BUYER' THEN 2 WHEN 'UNCLEAR_INTERMEDIARY' THEN 3 ELSE 4 END`;
const SIZE_ORDER=`CASE lower(coalesce(c.company_size_band,'unknown')) WHEN 'medium' THEN 1 WHEN 'small' THEN 2 WHEN 'large' THEN 3 WHEN 'micro' THEN 4 WHEN 'enterprise' THEN 5 ELSE 6 END`;
const IMPORT_ORDER=`CASE WHEN EXISTS(SELECT 1 FROM leadgen.company_verification_evidence e WHERE e.company_id=c.id AND e.evidence_type='IMPORTER')
      OR EXISTS(SELECT 1 FROM leadgen.prospect_category_observations o WHERE o.company_id=c.id AND o.observation_type='IMPORT_ACTIVITY') THEN 0 ELSE 1 END`;

// A mailbox-verified, active, unsuppressed email route of the company (outreach recipient or
// decision-maker contact). Domain / published-on-site checks stay in the eligibility gate.
const USABLE_ROUTE=`EXISTS(SELECT 1 FROM (
        SELECT lower(btrim(r.normalized_recipient)) address,r.verification_status status,r.lifecycle_status lifecycle
          FROM leadgen.outreach_recipients r WHERE r.company_id=c.id AND r.channel='EMAIL'
        UNION ALL
        SELECT lower(btrim(dc.contact_value_normalized)),dc.verification_status,dm.lifecycle_status
          FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
      ) route WHERE route.status IN('VALID','ACCEPT_ALL') AND coalesce(route.lifecycle,'ACTIVE')='ACTIVE' AND route.address LIKE '%@%'
        AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.lifted_at IS NULL
          AND s.normalized_recipient_hash=encode(sha256(convert_to(route.address,'UTF8')),'hex'))
        AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.lifted_at IS NULL
          AND s.normalized_recipient_hash=encode(sha256(convert_to(route.address,'UTF8')),'hex')))`;
const CONTACT_ORDER=`CASE WHEN EXISTS(SELECT 1 FROM leadgen.outreach_recipients r WHERE r.company_id=c.id AND r.channel='EMAIL' AND r.verification_status='VALID')
      OR EXISTS(SELECT 1 FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
        WHERE dm.company_id=c.id AND dc.verification_status='VALID' AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) THEN 0 ELSE 1 END`;

// owner(alias): the sender condition on a reservation/message alias (SIM = NULL merchant, or one merchant).
function candidateSql({from,ownerWhere,owner,limitParam}){
  return `SELECT p.company_id FROM ${from}
      JOIN leadgen.companies c ON c.id=p.company_id
      LEFT JOIN LATERAL (SELECT b.buyer_model FROM leadgen.buyer_business_model_results b
        WHERE b.company_id=c.id ORDER BY b.created_at DESC,b.id DESC LIMIT 1) buyer ON true
      WHERE ${ownerWhere} p.is_active_business_opportunity=true
        AND p.opportunity_pool_band=ANY($1::text[])
        AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND coalesce(buyer.buyer_model,'') <> 'EXCLUDED_INTERMEDIARY'
        AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE r.company_id=p.company_id AND ${owner('r')})
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages m WHERE m.company_id=c.id AND ${owner('m')}
          AND (m.sent_at IS NOT NULL OR m.transport_status='SMTP_ACCEPTED' OR m.send_status IN('PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS','SENDING','QUEUED')))
        AND ${USABLE_ROUTE}
      ORDER BY ${BAND_ORDER},${BUYER_ORDER},${SIZE_ORDER},${IMPORT_ORDER},${CONTACT_ORDER},
        p.observed_at DESC,p.company_id LIMIT ${limitParam}`;
}

// SIM's own first touches. A company assigned to any merchant (leadgen.merchant_companies) is
// that merchant's prospect: SIM never contacts it, so one buyer is not approached by SIM and a
// merchant (possibly a competitor of each other) at the same time.
export const SIM_FIRST_TOUCH_CANDIDATES_SQL=candidateSql({
  from:'leadgen.opportunity_pool_current p',
  ownerWhere:'NOT EXISTS(SELECT 1 FROM leadgen.merchant_companies mc WHERE mc.company_id=p.company_id) AND',
  owner:alias=>`${alias}.merchant_id IS NULL`,limitParam:'$2'
});

// One merchant's first touches: only companies assigned to that merchant.
export const MERCHANT_FIRST_TOUCH_CANDIDATES_SQL=candidateSql({
  from:'leadgen.merchant_companies mc JOIN leadgen.opportunity_pool_current p ON p.company_id=mc.company_id',
  ownerWhere:'mc.merchant_id=$2 AND',owner:alias=>`${alias}.merchant_id=$2`,limitParam:'$3'
});

const bands=value=>Array.isArray(value)?value:[];

export async function simFirstTouchCandidates(queryable,{allowedBands,limit=50}={}){
  return (await queryable.query(SIM_FIRST_TOUCH_CANDIDATES_SQL,[bands(allowedBands),limit])).rows;
}

export async function merchantFirstTouchCandidates(queryable,merchantId,{allowedBands,limit=20}={}){
  if(!merchantId)throw Object.assign(new Error('merchantId is required'),{code:'MERCHANT_REQUIRED'});
  return (await queryable.query(MERCHANT_FIRST_TOUCH_CANDIDATES_SQL,[bands(allowedBands),merchantId,limit])).rows;
}
