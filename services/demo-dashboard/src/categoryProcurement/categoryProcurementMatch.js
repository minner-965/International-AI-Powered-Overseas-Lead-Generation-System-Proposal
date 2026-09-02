import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DpvZenRulesAdapter } from '../scoring/zenRulesAdapter.js';

export const CATEGORY_PROCUREMENT_MATCH_VERSION='category-procurement-match-v2';
const upper=value=>String(value||'').trim().toUpperCase();
const unique=values=>[...new Set((values||[]).filter(Boolean))];
const projectRoot=process.env.DPV_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const rulesRoot=process.env.DPV_RULES_DIR?path.resolve(process.env.DPV_RULES_DIR):path.join(projectRoot,'rules');
const rulePath=path.join(rulesRoot,'category-procurement-match/v1/decision.json');
const observed=(points,maximum,evidence_ids,reason_codes)=>({state:'OBSERVED',points,maximum,evidence_ids:unique(evidence_ids),reason_codes});
const unknown=(maximum,reason)=>({state:'UNKNOWN',points:null,maximum,evidence_ids:[],reason_codes:[reason]});
export function resolveCategoryProcurementMatchBand(score){if(score===null||score===undefined||!Number.isFinite(Number(score)))return'UNKNOWN';const value=Number(score);return value>=80?'VERY_HIGH':value>=65?'HIGH':value>=60?'MEDIUM':value>=30?'LOW':'VERY_LOW';}

function normalizedCategory(value){return upper(value).replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
function effectiveRevision(input={}){
  const revision=input.scope_revision||input.approved_scope_revision||{};
  const now=input.assessed_at?new Date(input.assessed_at):new Date();
  const from=revision.effective_from?new Date(revision.effective_from):null;
  const to=revision.effective_to?new Date(revision.effective_to):null;
  const approved=upper(revision.approval_status)==='APPROVED'&&revision.id
    &&from instanceof Date&&!Number.isNaN(from.getTime())&&from<=now
    &&(!to||(!Number.isNaN(to.getTime())&&to>now));
  return approved?revision:null;
}

export function resolveApprovedCategoryScopeMatch(input={}){
  const profile=upper(input.product_profile);
  const revision=effectiveRevision(input);
  const scopes=(input.approved_category_scopes||input.category_scopes||[]).filter(scope=>
    revision&&String(scope.scope_revision_id)===String(revision.id)
      &&upper(scope.product_profile)===profile&&upper(scope.scope_status||'ACTIVE')==='ACTIVE');
  if(!revision||!scopes.length)return {scope_revision_id:null,match_basis:null,matched_scope_ids:[],
    observed_customer_category_ids:[],similarity_rule:null,scope_status:'APPROVAL_REQUIRED'};
  const aliases=(input.category_scope_aliases||input.scope_aliases||[]).filter(alias=>
    String(alias.scope_revision_id)===String(revision.id)&&upper(alias.status||'ACTIVE')==='ACTIVE');
  const observations=(input.observed_customer_categories||input.observations||[]).filter(item=>
    item?.id&&upper(item.verification_status||'VERIFIED')==='VERIFIED'
      &&upper(item.source_authority||'OFFICIAL')!=='SEARCH_DISCOVERY'
      &&[profile,'UNKNOWN'].includes(upper(item.normalized_profile||profile))
      &&normalizedCategory(item.normalized_category||item.raw_category));
  if(!observations.length)return {scope_revision_id:revision.id,match_basis:null,matched_scope_ids:[],
    observed_customer_category_ids:[],similarity_rule:null,scope_status:'CUSTOMER_EVIDENCE_REQUIRED'};
  const result=(basis,scope,observation,rule)=>({scope_revision_id:revision.id,match_basis:basis,
    matched_scope_ids:[scope.id],observed_customer_category_ids:[observation.id],similarity_rule:rule,scope_status:'MATCHED'});
  for(const observation of observations){
    const observed=normalizedCategory(observation.normalized_category||observation.raw_category);
    const exact=scopes.find(scope=>normalizedCategory(scope.normalized_category)===observed);
    if(exact)return result('EXACT_CATEGORY',exact,observation,'NORMALIZED_CATEGORY_EQUALITY');
  }
  for(const observation of observations){
    const ancestors=unique([...(observation.taxonomy_ancestor_ids||[]),...(observation.taxonomy_descendant_ids||[])]).map(String);
    const related=scopes.find(scope=>scope.taxonomy_node_id&&ancestors.includes(String(scope.taxonomy_node_id)));
    if(related)return result('SIMILAR_CATEGORY',related,observation,'APPROVED_TAXONOMY_PARENT_CHILD');
  }
  for(const observation of observations){
    const observed=normalizedCategory(observation.normalized_category||observation.raw_category);
    const alias=aliases.find(item=>normalizedCategory(item.normalized_alias||item.raw_alias)===observed
      &&['EXACT','SYNONYM','PARENT','CHILD','SIMILAR'].includes(upper(item.alias_type)));
    const scope=alias&&scopes.find(item=>String(item.id)===String(alias.scope_id));
    if(scope)return result('SIMILAR_CATEGORY',scope,observation,
      ['PARENT','CHILD'].includes(upper(alias.alias_type))?'APPROVED_ALIAS_PARENT_CHILD':'APPROVED_ALIAS_SYNONYM');
  }
  const profileObservation=observations.find(item=>upper(item.normalized_profile)===profile);
  if(profileObservation){
    const profileScope=scopes.find(scope=>normalizedCategory(scope.normalized_category)===profile)||scopes[0];
    return result('PROFILE_SCOPE',profileScope,profileObservation,'APPROVED_PRODUCT_PROFILE_SCOPE');
  }
  return {scope_revision_id:revision.id,match_basis:'OUT_OF_SCOPE',matched_scope_ids:[],
    observed_customer_category_ids:observations.map(item=>item.id),similarity_rule:'NO_APPROVED_SCOPE_RELATION',scope_status:'OUT_OF_SCOPE'};
}

function relevantEvidence(observations,profile){
  return (observations||[]).filter(item=>upper(item.verification_status)==='VERIFIED'&&upper(item.source_authority)!=='SEARCH_DISCOVERY'
    &&(upper(item.normalized_profile)===profile||upper(item.normalized_profile)==='UNKNOWN'));
}

export function buildCategoryProcurementDimensions({observations=[],product_profile,buyer_business_model={}}={}){
  const profile=upper(product_profile);
  const evidence=relevantEvidence(observations,profile);
  const byType=(...types)=>evidence.filter(item=>types.includes(upper(item.observation_type)));
  const category=byType('PRODUCT_CATEGORY','PRODUCT_ITEM');
  const official=category.filter(item=>['OFFICIAL','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT'].includes(upper(item.source_authority)));
  const productNames=unique(category.map(item=>item.raw_product_name));
  const categories=unique(category.map(item=>item.normalized_category));
  const brands=unique(category.map(item=>item.raw_brand_or_department));
  let categoryDimension=unknown(45,'TARGET_CATEGORY_PROCUREMENT_EVIDENCE_UNKNOWN');
  if(category.length){
    const points=official.length&&productNames.length+brands.length>=3?45:official.some(item=>upper(item.observation_type)==='PRODUCT_CATEGORY')?40:official.length>=2?35:official.length===1?20:10;
    categoryDimension=observed(points,45,category.map(item=>item.id),['TARGET_CATEGORY_PROCUREMENT_EVIDENCE_OBSERVED']);
  }
  const model=upper(buyer_business_model.buyer_model);
  let buyerDimension=unknown(25,'BUYER_BUSINESS_MODEL_UNKNOWN');
  if(model==='DIRECT_END_BUYER')buyerDimension=observed(25,25,buyer_business_model.evidence_ids||[],['DIRECT_END_BUYER_CONFIRMED']);
  else if(model==='DISTRIBUTION_BUYER')buyerDimension=observed(upper(buyer_business_model.confidence_band)==='HIGH'?22:18,25,buyer_business_model.evidence_ids||[],['DISTRIBUTION_BUYER_CONFIRMED']);
  else if(model==='EXCLUDED_INTERMEDIARY')buyerDimension=observed(0,25,buyer_business_model.evidence_ids||[],['EXCLUDED_INTERMEDIARY_CONFIRMED']);
  let depthDimension=unknown(15,'ASSORTMENT_DEPTH_UNKNOWN');
  if(category.length){
    const breadth=productNames.length+categories.length+brands.length;
    const points=byType('PRODUCT_CATEGORY').length&&breadth>=6?15:breadth>=4?12:category.length>=3?8:3;
    depthDimension=observed(points,15,category.map(item=>item.id),['ASSORTMENT_DEPTH_OBSERVED']);
  }
  const sourcing=byType('IMPORT_ACTIVITY','THIRD_PARTY_BRAND_PORTFOLIO');
  let sourcingDimension=unknown(10,'EXTERNAL_SOURCING_IMPORT_UNKNOWN');
  if(sourcing.length){
    const points=sourcing.some(item=>upper(item.observation_type)==='IMPORT_ACTIVITY')?10:5;
    sourcingDimension=observed(points,10,sourcing.map(item=>item.id),['EXTERNAL_SOURCING_IMPORT_OBSERVED']);
  }
  const current=category.filter(item=>{
    if(item.content_fetched===false)return false;
    if(['OFFICIAL','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT'].includes(upper(item.source_authority)))return true;
    const published=item.published_at?new Date(item.published_at).getTime():0;
    return published&&Date.now()-published<=730*86400000;
  });
  let recentDimension=unknown(5,'RECENT_CATEGORY_ACTIVITY_UNKNOWN');
  if(current.length){
    const withinOneYear=current.some(item=>item.published_at&&Date.now()-new Date(item.published_at).getTime()<=365*86400000);
    recentDimension=observed(withinOneYear||current.some(item=>!item.published_at)?5:3,5,current.map(item=>item.id),['RECENT_CATEGORY_ACTIVITY_OBSERVED']);
  }
  return {dimensions:{target_category_procurement_evidence:categoryDimension,buyer_business_model_fit:buyerDimension,assortment_depth:depthDimension,external_sourcing_import:sourcingDimension,recent_category_activity:recentDimension},observed_categories:categories,confirmed_unrelated_assortment:Boolean(category.length&&category.every(item=>upper(item.normalized_profile)!==profile&&upper(item.normalized_profile)!=='UNKNOWN'))};
}

export function calculateCategoryProcurementMatch(input={}){
  const supplied=input.dimensions?{...input.dimensions,target_category_procurement_evidence:input.dimensions.target_category_procurement_evidence||input.dimensions.target_category_procurement}:null;
  const built=supplied?{dimensions:supplied,observed_categories:input.observed_categories||[],confirmed_unrelated_assortment:Boolean(input.confirmed_unrelated_assortment)}:buildCategoryProcurementDimensions(input);
  const maxima={target_category_procurement_evidence:45,buyer_business_model_fit:25,assortment_depth:15,external_sourcing_import:10,recent_category_activity:5};
  const dimensions={},missing_evidence=[],reason_codes=[];let coverage=0,raw=0;
  for(const[key,maximum]of Object.entries(maxima)){
    const fact=built.dimensions[key]||{};const ids=unique(fact.evidence_ids);const state=upper(fact.state||'UNKNOWN');
    const isObserved=state==='OBSERVED'&&(key==='buyer_business_model_fit'||ids.length>0)&&Number.isFinite(Number(fact.points));
    const points=isObserved?Math.max(0,Math.min(maximum,Math.round(Number(fact.points)))):null;
    if(isObserved){coverage+=maximum;raw+=points;}else missing_evidence.push(key);
    const codes=fact.reason_codes?.length?fact.reason_codes:[isObserved?`${key.toUpperCase()}_OBSERVED`:`${key.toUpperCase()}_UNKNOWN`];
    dimensions[key]={state:isObserved?'OBSERVED':state==='NOT_APPLICABLE'?'NOT_APPLICABLE':'UNKNOWN',points,maximum,evidence_ids:ids,reason_codes:codes};reason_codes.push(...codes);
  }
  const buyer=input.buyer_business_model_result||input.buyer_business_model||{};const model=upper(input.buyer_model||buyer.buyer_model);
  const scopeMatch=resolveApprovedCategoryScopeMatch(input);
  const categoryObserved=dimensions.target_category_procurement_evidence.state==='OBSERVED';
  const buyerObserved=dimensions.buyer_business_model_fit.state==='OBSERVED'&&['DIRECT_END_BUYER','DISTRIBUTION_BUYER'].includes(model);
  let score=null,band='UNKNOWN',match_status='NEEDS_PRODUCT_EVIDENCE';
  if(scopeMatch.scope_status==='APPROVAL_REQUIRED')match_status='NEEDS_DPV_CATEGORY_SCOPE_APPROVAL';
  else if(model==='EXCLUDED_INTERMEDIARY')match_status='INELIGIBLE_BUYER_MODEL';
  else if(categoryObserved&&(scopeMatch.match_basis==='OUT_OF_SCOPE'||built.confirmed_unrelated_assortment||dimensions.target_category_procurement_evidence.points===0)&&buyerObserved&&coverage>=70){score=raw;match_status='PRODUCT_MISMATCH';}
  else if(categoryObserved&&!buyerObserved&&['UNCLEAR_INTERMEDIARY','UNKNOWN'].includes(model))match_status='CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE';
  else if(categoryObserved&&buyerObserved&&scopeMatch.scope_status==='MATCHED'&&coverage>=70){score=raw;match_status=score>=60?'CATEGORY_PROCUREMENT_MATCH':'WEAK_CATEGORY_MATCH';}
  band=resolveCategoryProcurementMatchBand(score);
  reason_codes.push(match_status);
  return {score,band,match_status,coverage_percent:coverage,dimensions,observed_categories:built.observed_categories,
    ...scopeMatch,catalog_completeness_non_blocking:true,reason_codes:unique(reason_codes),
    missing_evidence:unique(missing_evidence),calculation_version:CATEGORY_PROCUREMENT_MATCH_VERSION};
}

export class CategoryProcurementMatchEngine{
  constructor({adapter=new DpvZenRulesAdapter({rulePaths:{categoryProcurementMatch:rulePath}})}={}){this.adapter=adapter;}
  async evaluate(input={}){
    const built=input.dimensions?{dimensions:input.dimensions,observed_categories:input.observed_categories||[],confirmed_unrelated_assortment:Boolean(input.confirmed_unrelated_assortment)}:buildCategoryProcurementDimensions(input);
    return calculateCategoryProcurementMatch({...input,...built,
      buyer_model:input.buyer_model||input.buyer_business_model?.buyer_model});
  }
  dispose(){this.adapter.dispose();}
}
