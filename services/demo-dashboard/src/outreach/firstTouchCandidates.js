// Candidate selection for automated first touches. Selection is only a pre-filter: every
// candidate still passes the eligibility gate and the reservation function, which enforce the
// same rules again (merchant assignment, cross-sender recipient cooldown, per-sender limits).

const BAND_ORDER=`CASE p.opportunity_pool_band WHEN 'PRECISION' THEN 1 WHEN 'RELEVANT' THEN 2 ELSE 3 END`;

// SIM's own first touches. A company assigned to any merchant (leadgen.merchant_companies) is
// that merchant's prospect: SIM never contacts it, so one buyer is not approached by SIM and a
// merchant (possibly a competitor of each other) at the same time.
export const SIM_FIRST_TOUCH_CANDIDATES_SQL=`SELECT p.company_id FROM leadgen.opportunity_pool_current p
    JOIN leadgen.companies c ON c.id=p.company_id
    WHERE p.is_active_business_opportunity=true
      AND p.opportunity_pool_band=ANY($1::text[])
      AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
      AND NOT EXISTS(SELECT 1 FROM leadgen.merchant_companies mc WHERE mc.company_id=p.company_id)
      AND NOT EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE r.company_id=p.company_id AND r.merchant_id IS NULL)
    ORDER BY ${BAND_ORDER},
      p.observed_at DESC,p.company_id LIMIT $2`;

// One merchant's first touches: only companies assigned to that merchant.
export const MERCHANT_FIRST_TOUCH_CANDIDATES_SQL=`SELECT p.company_id FROM leadgen.merchant_companies mc
      JOIN leadgen.opportunity_pool_current p ON p.company_id=mc.company_id
      JOIN leadgen.companies c ON c.id=p.company_id
      WHERE mc.merchant_id=$2 AND p.is_active_business_opportunity=true AND p.opportunity_pool_band=ANY($1::text[])
        AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE r.company_id=p.company_id AND r.merchant_id=$2)
      ORDER BY ${BAND_ORDER},p.observed_at DESC,p.company_id LIMIT $3`;

const bands=value=>Array.isArray(value)?value:[];

export async function simFirstTouchCandidates(queryable,{allowedBands,limit=50}={}){
  return (await queryable.query(SIM_FIRST_TOUCH_CANDIDATES_SQL,[bands(allowedBands),limit])).rows;
}

export async function merchantFirstTouchCandidates(queryable,merchantId,{allowedBands,limit=20}={}){
  if(!merchantId)throw Object.assign(new Error('merchantId is required'),{code:'MERCHANT_REQUIRED'});
  return (await queryable.query(MERCHANT_FIRST_TOUCH_CANDIDATES_SQL,[bands(allowedBands),merchantId,limit])).rows;
}
