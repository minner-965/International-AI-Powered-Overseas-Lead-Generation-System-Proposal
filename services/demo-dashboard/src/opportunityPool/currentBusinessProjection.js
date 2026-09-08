// Current presentation only: never recalculates MC04 or rewrites stored history.
export const HISTORICAL_BUSINESS_FIELDS = Object.freeze([
  'supplier_access_score','supplier_access_band','supplier_access_coverage','supplier_route_count',
  'supplier_route_type','supplier_portal_url','supplier_vendor_route',
  'product_access_matrix','cooperation_matrix','readiness','readiness_blockers',
  'system_recommendation_status','business_fit_status','contact_readiness',
  'opportunity_decision_reason_codes','barrier_signals'
]);

export function currentBusinessProjection(row) {
  const current={...row};
  const history={...(row.historical_compatibility||{})};
  for(const key of HISTORICAL_BUSINESS_FIELDS){
    if(Object.hasOwn(current,key)){history[key]=current[key];delete current[key];}
  }
  if(row.legacy_display_opportunity_status!=null)history.display_opportunity_status=row.legacy_display_opportunity_status;
  return {...current,...(row.opportunity_pool_band?{display_opportunity_status:row.opportunity_pool_band}:{}),
    historical_compatibility:history};
}
