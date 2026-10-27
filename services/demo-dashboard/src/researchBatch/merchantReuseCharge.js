// B6: a merchant batch that reuses a research job owned by someone else (SIM or another
// merchant) is charged against that merchant's monthly search quota. The charge is
// recorded on the merchant's own immutable research_batch_children row
// (scope_snapshot.merchant_reuse_charge), so no provider usage is attributed to a
// job the merchant does not own and the charge stays append-only with the batch history.
//
// A merchant is charged once per reused job: a later batch of the same merchant that
// includes the same job again is not charged a second time.

export const REUSE_CHARGE_KEY='merchant_reuse_charge';
export const billingPeriod=(now=new Date())=>now.toISOString().slice(0,7);

// SQL expression: searches charged to merchant $1 for reused research this UTC month.
export const merchantReuseChargesThisMonthSql=(merchantParam='$1')=>`SELECT coalesce(sum((c.scope_snapshot->'${REUSE_CHARGE_KEY}'->>'queries')::int),0)::int charged
  FROM leadgen.research_batch_children c JOIN leadgen.research_batches b ON b.id=c.batch_id
  WHERE b.merchant_id=${merchantParam}::uuid AND c.reused=true
    AND c.scope_snapshot->'${REUSE_CHARGE_KEY}'->>'billing_period'=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')`;

export async function countMerchantReuseChargesThisMonth(queryable,merchantId){
  if(!merchantId)return 0;
  return Number((await queryable.query(merchantReuseChargesThisMonthSql('$1'),[merchantId])).rows[0]?.charged||0);
}

// Whether `merchantId` must be charged for reusing `job` (a research_jobs row).
export async function reuseChargeDue(queryable,{merchantId,job}){
  if(!merchantId||!job||job.inserted)return false;
  if(job.merchant_id&&String(job.merchant_id)===String(merchantId))return false;
  const prior=await queryable.query(`SELECT 1 FROM leadgen.research_batch_children c JOIN leadgen.research_batches b ON b.id=c.batch_id
    WHERE b.merchant_id=$1::uuid AND c.research_job_id=$2 AND c.scope_snapshot ? '${REUSE_CHARGE_KEY}' LIMIT 1`,[merchantId,job.id]);
  return !prior.rowCount;
}
