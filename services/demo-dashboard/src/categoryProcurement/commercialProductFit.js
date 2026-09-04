import crypto from 'node:crypto';

export const COMMERCIAL_PRODUCT_FIT_VERSION='commercial-product-fit-v2';

export const COMMERCIAL_PRODUCT_FIT_DIMENSIONS=Object.freeze({
  assortment_relevance:25,
  commercial_positioning_price_band:20,
  attribute_specification_fit:15,
  moq_order_format_compatibility:15,
  import_sourcing_model_fit:15,
  recent_product_buying_signal:10
});

const upper=value=>String(value||'').trim().toUpperCase();
const unique=values=>[...new Set((values||[]).filter(Boolean))];
const clamp=(value,maximum)=>Math.max(0,Math.min(maximum,Math.round(Number(value))));
const unknown=(maximum,reason)=>({state:'UNKNOWN',points:null,maximum,evidence_ids:[],reason_codes:[reason]});
const deferred=(maximum,reason)=>({state:'UNKNOWN',points:null,maximum,evidence_ids:[],reason_codes:[reason]});
const observed=(points,maximum,evidenceIds,reason)=>({state:'OBSERVED',points:clamp(points,maximum),maximum,
  evidence_ids:unique(evidenceIds),reason_codes:[reason]});

function verifiedPublic(observations=[],profile){
  return observations.filter(item=>item?.id&&upper(item.verification_status)==='VERIFIED'
    &&upper(item.source_authority)!=='SEARCH_DISCOVERY'
    &&[profile,'UNKNOWN'].includes(upper(item.normalized_profile||profile)));
}

export function buildCommercialProductFitDimensions({observations=[],product_profile,category_match={}}={}){
  const profile=upper(product_profile);
  const evidence=verifiedPublic(observations,profile);
  const byType=(...types)=>evidence.filter(item=>types.includes(upper(item.observation_type)));
  const categoryEvidence=byType('PRODUCT_CATEGORY','PRODUCT_ITEM');
  const sourcingEvidence=byType('IMPORT_ACTIVITY','WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK','THIRD_PARTY_BRAND_PORTFOLIO');
  const matchBasis=upper(category_match.match_basis);
  const matchStatus=upper(category_match.match_status);
  let assortment=unknown(25,'ASSORTMENT_RELEVANCE_UNKNOWN');
  if(categoryEvidence.length&&['EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE'].includes(matchBasis)){
    const distinct=unique(categoryEvidence.flatMap(item=>[item.normalized_category,item.normalized_subcategory,item.raw_product_name]));
    const base=matchBasis==='EXACT_CATEGORY'?20:matchBasis==='SIMILAR_CATEGORY'?17:14;
    assortment=observed(Math.min(25,base+Math.min(5,Math.max(0,distinct.length-1))),25,
      categoryEvidence.map(item=>item.id),'ASSORTMENT_RELEVANCE_SUPPORTED');
  }else if(categoryEvidence.length&&(matchBasis==='OUT_OF_SCOPE'||matchStatus==='PRODUCT_MISMATCH')){
    assortment=observed(0,25,categoryEvidence.map(item=>item.id),'ASSORTMENT_RELEVANCE_MISMATCH');
  }

  // These commercial terms are discussed by management only after the prospect
  // shows interest. Public facts may be used when already present, but their
  // absence must not create an enrichment requirement or an evidence gap.
  const positioning=deferred(20,'COMMERCIAL_POSITIONING_PRICE_BAND_OPTIONAL_UNTIL_INTEREST');
  const attributes=deferred(15,'ATTRIBUTE_SPECIFICATION_FIT_OPTIONAL_UNTIL_INTEREST');
  const orderFormat=deferred(15,'MOQ_ORDER_FORMAT_OPTIONAL_UNTIL_INTEREST');

  let sourcing=unknown(15,'IMPORT_SOURCING_MODEL_FIT_UNKNOWN');
  if(sourcingEvidence.length){
    const hasImport=sourcingEvidence.some(item=>upper(item.observation_type)==='IMPORT_ACTIVITY');
    const hasDistribution=sourcingEvidence.some(item=>['WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK'].includes(upper(item.observation_type)));
    sourcing=observed(hasImport&&hasDistribution?15:hasImport?13:10,15,sourcingEvidence.map(item=>item.id),
      'IMPORT_SOURCING_MODEL_SUPPORTED');
  }

  let recent=unknown(10,'RECENT_PRODUCT_BUYING_SIGNAL_UNKNOWN');
  const now=Date.now();
  const recentEvidence=categoryEvidence.filter(item=>{
    const published=item.published_at?new Date(item.published_at).getTime():0;
    if(published&&Number.isFinite(published))return now-published<=730*86400000;
    return item.content_fetched!==false&&['OFFICIAL','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT'].includes(upper(item.source_authority));
  });
  if(recentEvidence.length){
    const withinYear=recentEvidence.some(item=>item.published_at&&now-new Date(item.published_at).getTime()<=365*86400000);
    recent=observed(withinYear?10:8,10,recentEvidence.map(item=>item.id),'RECENT_PRODUCT_BUYING_SIGNAL_SUPPORTED');
  }
  return {assortment_relevance:assortment,commercial_positioning_price_band:positioning,
    attribute_specification_fit:attributes,moq_order_format_compatibility:orderFormat,
    import_sourcing_model_fit:sourcing,recent_product_buying_signal:recent};
}

export function resolveCommercialProductFitBand(score){
  if(score===null||score===undefined||!Number.isFinite(Number(score)))return'UNKNOWN';
  return Number(score)>=80?'HIGH':Number(score)>=60?'MEDIUM':'LOW';
}

export function calculateCommercialProductFit(input={}){
  const supplied=input.dimensions||buildCommercialProductFitDimensions(input);
  const dimensions={};let coveredWeight=0,earnedPoints=0;const unknownDimensions=[];const deferredDimensions=[];const reasonCodes=[];
  for(const[key,maximum]of Object.entries(COMMERCIAL_PRODUCT_FIT_DIMENSIONS)){
    const fact=supplied[key]||{};const evidenceIds=unique(fact.evidence_ids);const valid=upper(fact.state)==='OBSERVED'
      &&evidenceIds.length>0&&Number.isFinite(Number(fact.points));
    const points=valid?clamp(fact.points,maximum):null;
    dimensions[key]={state:valid?'OBSERVED':'UNKNOWN',points,maximum,evidence_ids:valid?evidenceIds:[],
      reason_codes:fact.reason_codes?.length?unique(fact.reason_codes):[valid?`${key.toUpperCase()}_SUPPORTED`:`${key.toUpperCase()}_UNKNOWN`]};
    reasonCodes.push(...dimensions[key].reason_codes);
    if(valid){coveredWeight+=maximum;earnedPoints+=points;}
    else if(dimensions[key].reason_codes.some(code=>String(code).endsWith('_OPTIONAL_UNTIL_INTEREST')))deferredDimensions.push(key);
    else unknownDimensions.push(key);
  }
  const score=coveredWeight?Math.round(earnedPoints/coveredWeight*100):null;
  const result={commercial_fit_score:score,commercial_fit_band:resolveCommercialProductFitBand(score),
    coverage_percent:coveredWeight,dimensions,unknown_dimensions:unknownDimensions,deferred_dimensions:deferredDimensions,
    reason_codes:unique(reasonCodes),calculation_version:COMMERCIAL_PRODUCT_FIT_VERSION};
  result.input_digest=crypto.createHash('sha256').update(JSON.stringify({product_profile:upper(input.product_profile),
    category_procurement_match_result_id:input.category_procurement_match_result_id||input.category_match?.id||null,
    dimensions})).digest('hex');
  return result;
}

export function publicCommercialProductFitProjection(result={}){
  const dimensionEntries=Array.isArray(result.dimensions)
    ? result.dimensions.map(item=>[String(item.dimension||'').toLowerCase(),item])
    : Object.entries(result.dimensions||{});
  const deferredDimensions=unique(result.deferred_dimensions?.length?result.deferred_dimensions:dimensionEntries
    .filter(([,item])=>(item.reason_codes||[]).some(code=>String(code).endsWith('_OPTIONAL_UNTIL_INTEREST')))
    .map(([key])=>key));
  return {commercial_product_fit_result_id:result.id||result.commercial_product_fit_result_id||null,
    category_procurement_match_result_id:result.category_procurement_match_result_id||null,
    product_profile:result.product_profile||null,commercial_fit_score:result.commercial_fit_score??null,
    commercial_fit_band:result.commercial_fit_band||'UNKNOWN',coverage_percent:Number(result.coverage_percent||0),
    dimensions:result.dimensions||[],unknown_dimensions:(result.unknown_dimensions||[]).filter(item=>!deferredDimensions.includes(String(item).toLowerCase())),
    deferred_dimensions:deferredDimensions,reason_codes:result.reason_codes||[],
    calculation_version:result.calculation_version||null,created_at:result.created_at||null};
}
