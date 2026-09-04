import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DpvZenRulesAdapter } from '../scoring/zenRulesAdapter.js';
import {isCategoryMatchConfirmed,projectCategoryMatchStatus} from './categoryMatchStatus.js';

export const COOPERATION_V4_VERSION='cooperation-feasibility-v4';
export const COOPERATION_V3_VERSION=COOPERATION_V4_VERSION;
const upper=value=>String(value||'').trim().toUpperCase();
const unique=values=>[...new Set((values||[]).filter(Boolean))];
const projectRoot=process.env.DPV_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const rulesRoot=process.env.DPV_RULES_DIR?path.resolve(process.env.DPV_RULES_DIR):path.join(projectRoot,'rules');
const rulePath=path.join(rulesRoot,'cooperation-feasibility/v3/decision.json');
const accessMaximums={external_supplier_openness:20,supplier_onboarding_accessibility:20,buying_procurement_accessibility:20,commercial_operational_feasibility:20,supplier_lock_in_barrier:20};

export function calculateSupplierAccess({dimensions={}}={}){
  let known=0,points=0,total=0;const dimension_breakdown={},missing_evidence=[];
  for(const[key,maximum]of Object.entries(accessMaximums)){
    const fact=dimensions[key]||{};const effectiveMaximum=Number(fact.maximum)>0?Number(fact.maximum):maximum;total+=effectiveMaximum;const evidence_ids=unique(fact.evidence_ids);const state=upper(fact.state||'UNKNOWN');
    const observed=state!=='UNKNOWN'&&evidence_ids.length>0&&Number.isFinite(Number(fact.points));const value=observed?Math.max(0,Math.min(effectiveMaximum,Number(fact.points))):null;
    if(observed){known+=effectiveMaximum;points+=value;}else missing_evidence.push(key);
    dimension_breakdown[key]={state:observed?state:'UNKNOWN',points:value,maximum:effectiveMaximum,evidence_ids};
  }
  const supplier_access_coverage=total?Math.round(known/total*100):0;
  const supplier_access_score=supplier_access_coverage>=50&&known?Math.round(points/known*100):null;
  const supplier_access_band=supplier_access_score===null?'UNKNOWN':supplier_access_score>=80?'HIGH':supplier_access_score>=60?'MEDIUM':supplier_access_score>=40?'LOW_MEDIUM':'LOW';
  return {supplier_access_score,supplier_access_band,supplier_access_coverage,dimension_breakdown,missing_evidence};
}

export function resolveProductAccessMatrixV3({buyer_model,category_procurement_match_band,supplier_access_band}={}){
  const model=upper(buyer_model),product=upper(category_procurement_match_band),access=upper(supplier_access_band);
  if(model==='EXCLUDED_INTERMEDIARY')return 'INELIGIBLE_BUYER_MODEL';
  if(!product||product==='UNKNOWN')return 'UNKNOWN_PRODUCT';
  if(['LOW','VERY_LOW'].includes(product))return 'LOW_PRODUCT';
  if(['VERY_HIGH','HIGH'].includes(product)){
    const prefix=model==='DIRECT_END_BUYER'?'DIRECT_BUYER':model==='DISTRIBUTION_BUYER'?'DISTRIBUTION_BUYER':null;
    if(!prefix)return 'UNKNOWN_PRODUCT';
    return `${prefix}_HIGH_PRODUCT_${access==='HIGH'?'HIGH_ACCESS':['MEDIUM','LOW_MEDIUM'].includes(access)?'MEDIUM_ACCESS':'LOW_ACCESS'}`;
  }
  if(product==='MEDIUM')return access==='HIGH'?'MEDIUM_PRODUCT_HIGH_ACCESS':'MEDIUM_PRODUCT_MEDIUM_ACCESS';
  return 'UNKNOWN_PRODUCT';
}

export function resolveReadinessV3(input={}){
  const blockers=[];const relationship=upper(input.relationship_status||'NEW_PROSPECT');const model=upper(input.buyer_model);
  if(input.suppressed===true||relationship==='SUPPRESSED')blockers.push('SUPPRESSED');
  if(input.existing_customer===true||relationship==='INTERNAL_EXISTING_CUSTOMER')blockers.push('EXISTING_CUSTOMER');
  if(model==='EXCLUDED_INTERMEDIARY')blockers.push('INELIGIBLE_BUYER_MODEL');else if(!['DIRECT_END_BUYER','DISTRIBUTION_BUYER'].includes(model))blockers.push('REVIEW');
  if(['HISTORICAL_CRM_LEAD','HISTORICAL_CONTACTED_LEAD'].includes(relationship))blockers.push('HISTORICAL_REVIEW');
  const rawStatus=upper(input.category_procurement_match_status||'CATEGORY_CONFIRMATION_REQUIRED');
  const status=projectCategoryMatchStatus(rawStatus);
  if(!isCategoryMatchConfirmed(rawStatus))blockers.push(status);else if(input.category_procurement_match_score==null||Number(input.category_procurement_match_score)<60)blockers.push('WEAK_CATEGORY_MATCH');else if(Number(input.category_procurement_coverage||0)<70)blockers.push('CATEGORY_CONFIRMATION_REQUIRED');
  if(input.has_verified_decision_route!==true&&input.has_current_valid_company_route!==true)blockers.push('NEEDS_DECISION_MAKER');
  if(input.has_current_valid_contact_route!==true&&input.has_current_valid_company_route!==true)blockers.push('NEEDS_CONTACT_ROUTE');
  const verifiedActive=input.company_verified_active===true||(upper(input.company_verification_status)==='VERIFIED'&&upper(input.company_lifecycle_status)==='ACTIVE');
  if(input.has_traceable_evidence!==true||!verifiedActive||input.eligible_target_organization!==true)blockers.push('NEEDS_VERIFICATION');
  if(upper(input.cooperation_feasibility_band)==='LOW')blockers.push('STRATEGIC_LONG_SHOT');
  const order=['SUPPRESSED','EXISTING_CUSTOMER','INELIGIBLE_BUYER_MODEL','HISTORICAL_REVIEW','HOLD',
    'NEEDS_DPV_CATEGORY_SCOPE_APPROVAL','CATEGORY_CONFIRMATION_REQUIRED',
    'CATEGORY_MISMATCH','WEAK_CATEGORY_MATCH','NEEDS_DECISION_MAKER',
    'NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION','STRATEGIC_LONG_SHOT','REVIEW'];
  const readiness=order.find(value=>blockers.includes(value))||'SALES_READY';return {readiness,opportunity_readiness:readiness,readiness_blockers:unique(blockers)};
}

export function mapCategoryProcurementToFeasibilityDimension({category_procurement_match_result={}}={}){
  const score=category_procurement_match_result.score==null?null:Number(category_procurement_match_result.score);
  const known=score!==null&&Number(category_procurement_match_result.coverage_percent||0)>=70&&isCategoryMatchConfirmed(category_procurement_match_result.match_status);
  return {state:known?upper(category_procurement_match_result.band):'UNKNOWN',points:known?(score>=80?15:score>=65?12:score>=60?9:score>=30?4:0):null,maximum:15,
    category_procurement_match_result_id:category_procurement_match_result.id||category_procurement_match_result.category_procurement_match_result_id||null,
    calculation_version:category_procurement_match_result.calculation_version||null,evidence_ids:[],unknown_fields:known?[]:['category_procurement_match']};
}

export class CooperationFeasibilityV3Engine{
  constructor({adapter=new DpvZenRulesAdapter({rulePaths:{cooperationFeasibilityV3:rulePath}})}={}){this.adapter=adapter;}
  async evaluate(input={}){
    const supplier=calculateSupplierAccess({dimensions:input.supplier_access_dimensions||{}});
    const readiness=resolveReadinessV3({...input,...supplier});
    return {...supplier,
      product_access_matrix:resolveProductAccessMatrixV3({...input,supplier_access_band:supplier.supplier_access_band}),
      ...readiness,cooperation_calculation_version:COOPERATION_V4_VERSION,
      rule_version:COOPERATION_V4_VERSION,
      supplier_route_status:input.supplier_route_closed===true||upper(input.supplier_route_status)==='CLOSED'
        ?'CLOSED':upper(input.supplier_route_status)==='SUPPORTED'?'SUPPORTED':'UNKNOWN'};
  }
  dispose(){this.adapter.dispose();}
}
