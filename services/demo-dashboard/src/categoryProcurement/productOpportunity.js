import crypto from 'node:crypto';

export const PRODUCT_OPPORTUNITY_VERSION='product-opportunity-v1';
const upper=value=>String(value||'').trim().toUpperCase();
const unique=values=>[...new Set((values||[]).filter(Boolean))];
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function catalogPriority(value){return {CURRENT_CONFIRMED:0,HISTORICAL_ORDER_SUPPORTED:1,REFERENCE_ONLY:2}[upper(value)]??9;}

export function calculateProductOpportunity(input={}){
  const category_procurement_match=input.category_procurement_match_result||input.category_procurement_match||{};
  const products=input.products||[];
  const observations=input.observed_categories||input.observations||[];
  const catalogSnapshot=input.catalog_snapshot||category_procurement_match.catalog_snapshot||{};
  const max_candidates=input.limit??input.max_candidates??20;
  const profile=upper(category_procurement_match.product_profile);
  const passed=upper(category_procurement_match.match_status)==='CATEGORY_PROCUREMENT_MATCH';
  if(!passed)return {recommendation_status:'NOT_RUN_GATE_FAILED',candidate_count:0,candidates:[],gaps:[],observed_categories:[],category_procurement_match_status:category_procurement_match.match_status||'NEEDS_PRODUCT_EVIDENCE',reason_codes:['CATEGORY_PROCUREMENT_GATE_FAILED'],missing_catalog_evidence:[],calculation_version:PRODUCT_OPPORTUNITY_VERSION,input_digest:sha([category_procurement_match.id,category_procurement_match.match_status])};
  const observedCategories=unique([...(category_procurement_match.observed_categories||[]),...observations.map(item=>item.normalized_category)]).map(upper);
  const observedSubcategories=unique(observations.map(item=>item.normalized_subcategory)).map(upper);
  const eligible=products.filter(item=>upper(item.product_profile||item.normalized_profile)===profile
    &&['CONFIRMED','SUPPORTED'].includes(upper(item.assignment_status))
    &&['CURRENT_CONFIRMED','HISTORICAL_ORDER_SUPPORTED','REFERENCE_ONLY'].includes(upper(item.catalog_status))
    &&observedCategories.includes(upper(item.normalized_category)));
  eligible.sort((left,right)=>{
    const checks=[
      (observedSubcategories.includes(upper(right.normalized_subcategory))?1:0)-(observedSubcategories.includes(upper(left.normalized_subcategory))?1:0),
      catalogPriority(left.catalog_status)-catalogPriority(right.catalog_status),
      upper(left.normalized_category).localeCompare(upper(right.normalized_category)),
      upper(left.normalized_subcategory).localeCompare(upper(right.normalized_subcategory)),
      String(left.product_master_id||left.id).localeCompare(String(right.product_master_id||right.id))
    ];
    return checks.find(value=>value!==0)||0;
  });
  const limit=Math.max(0,Math.min(20,Number(max_candidates)||20));
  const candidates=eligible.slice(0,limit).map((item,index)=>({product_master_id:item.product_master_id||item.id,rank:index+1,
    safe_product_name:item.safe_product_name||item.normalized_subcategory?.replaceAll('_',' ')||item.normalized_category?.replaceAll('_',' ')||null,
    product_profile:profile,normalized_category:item.normalized_category,normalized_subcategory:item.normalized_subcategory||null,
    catalog_status:item.catalog_status,reason_codes:unique(['REAL_PRODUCT_MASTER_REFERENCE',observedSubcategories.includes(upper(item.normalized_subcategory))?'OBSERVED_SUBCATEGORY_MATCH':'OBSERVED_CATEGORY_MATCH'])}));
  const incomplete=Number(catalogSnapshot.unknown_product_count||0)>0||Number(catalogSnapshot.classified_product_count||0)<Number(catalogSnapshot.eligible_product_count||0)||products.some(item=>['UNKNOWN','REVIEW'].includes(upper(item.assignment_status)));
  const status=candidates.length?(incomplete?'PARTIAL_INTERNAL_CATALOG':'READY'):'NO_REAL_CANDIDATE';
  const missing=candidates.length?incomplete?['INTERNAL_CATALOG_CLASSIFICATION_INCOMPLETE']:[]:['REAL_TAXONOMY_ASSIGNED_PRODUCT_CANDIDATE'];
  return {recommendation_status:status,candidate_count:candidates.length,candidates,gaps:[],observed_categories:observations,category_procurement_match_status:category_procurement_match.match_status,reason_codes:[status],missing_catalog_evidence:missing,
    calculation_version:PRODUCT_OPPORTUNITY_VERSION,input_digest:sha([category_procurement_match.id,candidates.map(item=>item.product_master_id),status])};
}

export function publicProductOpportunityProjection(result={}){
  return {product_opportunity_result_id:result.id||result.product_opportunity_result_id||null,product_profile:result.product_profile||null,
    recommendation_status:result.recommendation_status||'NOT_RUN_GATE_FAILED',candidate_count:Number(result.candidate_count||0),
    candidates:(result.candidates||[]).slice(0,20).map(item=>({product_master_id:item.product_master_id,rank:item.rank,
      display_label:item.safe_product_name||item.display_label||null,product_profile:item.product_profile,normalized_category:item.normalized_category,
      normalized_subcategory:item.normalized_subcategory||null,catalog_status:item.catalog_status,reason_codes:item.reason_codes||[]})),
    gaps:(result.gaps||[]).map(item=>({gap_type:item.gap_type,gap_status:item.gap_status,reason:item.reason,reason_codes:item.reason_codes||[]})),
    reason_codes:result.reason_codes||[],missing_catalog_evidence:result.missing_catalog_evidence||[],created_at:result.created_at||null};
}
