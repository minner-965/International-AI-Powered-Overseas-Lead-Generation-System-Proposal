import crypto from 'node:crypto';

export const PRODUCT_OPPORTUNITY_VERSION='product-opportunity-v2';
const upper=value=>String(value||'').trim().toUpperCase();
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function calculateProductOpportunity(input={}){
  const category_procurement_match=input.category_procurement_match_result||input.category_procurement_match||{};
  const passed=upper(category_procurement_match.match_status)==='CATEGORY_PROCUREMENT_MATCH';
  if(!passed){
    const skuReadiness=upper(category_procurement_match.match_status)==='PRODUCT_MISMATCH'?'OUT_OF_SCOPE':'NO_EXACT_SKU';
    return {recommendation_status:'NOT_RUN_GATE_FAILED',sku_readiness_status:skuReadiness,
      category_scope_match_result_id:category_procurement_match.id||null,
      candidate_count:0,candidates:[],gaps:[],observed_categories:[],
      category_procurement_match_status:category_procurement_match.match_status||'NEEDS_PRODUCT_EVIDENCE',
      reason_codes:['CATEGORY_PROCUREMENT_GATE_FAILED'],missing_catalog_evidence:[],
      calculation_version:PRODUCT_OPPORTUNITY_VERSION,
      input_digest:sha([category_procurement_match.id,category_procurement_match.match_status,skuReadiness])};
  }
  // Product/customer-deal imports build DPV category/profile, historical ICP and
  // scoring baselines. New-prospect opportunity qualification never reads or
  // matches product_master rows and never creates an exact-SKU candidate.
  return {recommendation_status:'CATEGORY_SCOPE_QUALIFIED',sku_readiness_status:'NO_EXACT_SKU',
    category_scope_match_result_id:category_procurement_match.id||null,
    candidate_count:0,candidates:[],gaps:[],observed_categories:[],
    category_procurement_match_status:category_procurement_match.match_status,
    reason_codes:['APPROVED_CATEGORY_SCOPE_QUALIFIED','EXACT_SKU_NOT_REQUIRED'],
    missing_catalog_evidence:[],
    calculation_version:PRODUCT_OPPORTUNITY_VERSION,
    input_digest:sha([category_procurement_match.id,category_procurement_match.match_status,
      category_procurement_match.scope_revision_id||null,category_procurement_match.matched_scope_ids||[],'CATEGORY_SCOPE_ONLY'])};
}

export function publicProductOpportunityProjection(result={}){
  return {product_opportunity_result_id:result.id||result.product_opportunity_result_id||null,product_profile:result.product_profile||null,
    recommendation_status:result.recommendation_status==='NOT_RUN_GATE_FAILED'?'NOT_RUN_GATE_FAILED':'CATEGORY_SCOPE_QUALIFIED',
    reason_codes:result.reason_codes||[],created_at:result.created_at||null};
}
