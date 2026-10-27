// Proposed MC08 (plan C2 + classifier-level C1/C8) opportunity-pool classification.
// Copy-and-modify of ./classifier.js (v1_MC04). NOT WIRED into OpportunityPoolService or any route:
// it exists so the old/new comparison (scripts/compare-opportunity-pool.mjs) can be reviewed before
// Simon approves tightening. Pure: no providers, persistence, schema or send gates.
//
// Changes against v1_MC04:
//  1. GENERAL_RELEVANT now needs category evidence for that profile: at least one approved category
//     (or approved parent/alias/profile) observation, or — for GENERAL_MERCHANDISE only — an explicit
//     general-merchandise description on the company's own pages. Broad business signals alone → EXPLORATORY.
//  2. Broad-signal tightening: an operating observation whose only trigger is "locations"/"ubicaciones"
//     (store network), "shop online" (retail channel) or "inventario" (warehouse) is not evidence unless
//     the same snippet carries a quantity or explicit own-operation context.
//  3. Retail chain / department store is a valid buyer type when own store-network evidence and approved
//     category evidence both exist. Identity verification is still required (coordinator decision 2026-10-26):
//     an unverified (REVIEW) retail chain stays out of the pool and is only flagged
//     RETAIL_CHAIN_BLOCKED_BY_VERIFICATION so the C1 verifier change can be sized. REJECTED is never reopened.
//  Also: a RETAIL_CHANNEL snippet that describes the company's customers ("we supply retail stores") is not
//  evidence of its own retail operation.
export const OPPORTUNITY_POOL_V2_VERSION='v2_MC08';

const upper=value=>String(value||'').trim().toUpperCase();
const norm=value=>upper(value).replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');
const list=value=>Array.isArray(value)?value:[];
const official=new Set(['OFFICIAL','OFFICIAL_WEBSITE','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT','REGISTRY']);
const activeBands=['PRECISION','RELEVANT','GENERAL_RELEVANT'];
const rank={PRECISION:5,RELEVANT:4,GENERAL_RELEVANT:3,EXPLORATORY:2,NOT_SUITABLE:1};
const url=value=>{try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}};
const stableOrder=(a,b)=>String(b.created_at||b.calculated_at||b.verified_at||b.captured_at||'').localeCompare(String(a.created_at||a.calculated_at||a.verified_at||a.captured_at||''))||String(a.id||'').localeCompare(String(b.id||''));
const recent=rows=>[...rows].sort(stableOrder)[0];
const ref=row=>({id:row.id,source_id:row.source_id||null,source_url:row.source_url||null,evidence_type:row.observation_type||row.evidence_type||null,captured_at:row.captured_at||null});
function trusted(row){return upper(row.verification_status)==='VERIFIED'&&official.has(upper(row.source_authority))&&url(row.source_url)&&row.id;}

// ---- Change 2: broad-signal tightening -------------------------------------------------------------
// Mirrors the signal list of categoryObservationExtractor.js. "weak" terms are the navigation-bar words
// the plan (C8) says no longer count alone; "strong" terms are the remaining alternatives of the same signal.
const STORE_UNITS='(?:stores?|shops?|locations?|branches|outlets?|showrooms?|boutiques?|tiendas|sucursales|ubicaciones|lojas|filiais|supermarkets?|hypermarkets?)';
const QUANTITY=new RegExp(`\\b\\d{1,5}\\s*\\+?\\s*${STORE_UNITS}\\b|\\b(?:more than|over|across|m[aá]s de|mais de)\\s+\\d{1,5}\\s*\\+?\\s*${STORE_UNITS}\\b`,'i');
export const OPERATING_SIGNAL_TERMS={
  STORE_NETWORK:{strong:/\b(?:store locator|branches|more than \d+ stores?|sucursales)\b/i,weak:/\b(?:locations|ubicaciones)\b/i,
    context:/\b(?:our|all|visit our|find (?:a|our)|nuestras|todas (?:las|nuestras))\s+(?:store\s+)?(?:locations|ubicaciones)\b|\blocations\s+(?:across|in|throughout|nationwide)\b/i},
  RETAIL_CHANNEL:{strong:/\b(?:our stores?|retail stores?|chain of stores?|tiendas|cadena minorista|nuestras tiendas)\b/i,weak:/\bshop online\b/i,
    context:/\b(?:in[- ]store|our (?:stores?|boutiques?|showrooms?)|visit (?:us|our store))\b/i},
  WAREHOUSE_INVENTORY:{strong:/\b(?:our warehouse|warehousing|inventory operation|centro de distribuci[oó]n|nuestro almac[eé]n)\b/i,weak:/\binventario\b/i,
    context:/\b(?:nuestro|gran|amplio)\s+inventario\b|\binventario\s+(?:propio|permanente|de m[aá]s de)\b|\b\d[\d.,]*\s*(?:m2|m²|metros cuadrados)\b/i},
};
// "we supply retail stores / serving supermarkets" names the company's customers, not its own shops.
const CUSTOMER_RETAIL=/\b(?:supply(?:ing)?|serv(?:e|es|ing)|deliver(?:ing)? to|for|to|our (?:clients|customers) (?:include|are)|abastecemos|surtimos|clientes?)\s+(?:\w+\s+){0,3}(?:retail stores?|chain of stores?|tiendas|cadena minorista|supermarkets?)\b/i;
/** STRONG | QUANTIFIED | CONTEXTUAL | WEAK_ONLY | CUSTOMER_DESCRIPTION | OTHER (types this tightening does not cover). */
export function operatingSignalStrength(row){
  const terms=OPERATING_SIGNAL_TERMS[upper(row.observation_type)];if(!terms)return 'OTHER';
  const text=String(row.evidence_text||'');
  if(upper(row.observation_type)==='RETAIL_CHANNEL'&&CUSTOMER_RETAIL.test(text)&&!/\b(?:our stores?|nuestras tiendas|our boutiques?)\b/i.test(text))return 'CUSTOMER_DESCRIPTION';
  if(terms.strong.test(text))return 'STRONG';
  if(!terms.weak.test(text))return 'STRONG'; // trigger not re-detectable in the stored window: keep v1 behaviour
  if(QUANTITY.test(text))return 'QUANTIFIED';
  if(terms.context.test(text))return 'CONTEXTUAL';
  return 'WEAK_ONLY';
}

// ---- Change 3: retail chain / department store -----------------------------------------------------
const RETAIL_CHAIN_TEXT=new RegExp(`\\b(?:department stores?|retail (?:chain|network|group)|chain of (?:stores|supermarkets|hypermarkets)|hypermarkets?|supermarket chain|tiendas departamentales|cadena (?:de tiendas|minorista|comercial)|lojas de departamento|rede de lojas)\\b|${QUANTITY.source}`,'i');
const BEAUTY_LEFTOVER=/\b(?:salons?|pharmac(?:y|ies)|farmacias?|drugstores?)\b/i;
// ---- Change 1: explicit general-merchandise description --------------------------------------------
export const GENERAL_MERCHANDISE_DESCRIPTION=/\b(?:general merchandise|department stores?|variety stores?|household (?:goods|products|items|essentials)|home (?:&|and) living|homewares?|non[- ]food (?:items|products|goods|range)|daily[- ]use (?:goods|items|products)|everyday essentials|hypermarkets?|discount stores?|dollar stores?|mercanc[ií]as? generales?|tiendas? departamental(?:es)?|art[ií]culos (?:para el|del) hogar|productos de uso diario|utilidades dom[eé]sticas|lojas? de departamento|artigos para (?:o )?lar)\b|بضائع عامة|أدوات منزلية|مستلزمات منزلية/i;

function companyFacts(company,tables){
  const hostname=value=>{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}};
  const companyHost=hostname(company.website_url)||String(company.official_root_domain||'').toLowerCase().replace(/^www\./,'')||null;
  const ownedSource=row=>{const host=hostname(row.source_url);return !companyHost||host===companyHost||host?.endsWith(`.${companyHost}`);};
  const attributionRisk=row=>{try{const address=new URL(row.source_url);return /^blog\./i.test(address.hostname)||/(?:^|\/)blogs?(?:\/|$)|\/suppliers\/|\/los-10-/i.test(address.pathname)||/(?:^|\.)2gis\./i.test(address.hostname)||/\bare you\b[^?]{0,180}\?/i.test(row.evidence_text||'');}catch{return true;}};
  const sources=new Map(list(tables.prospect_category_sources).map(row=>[row.id,row]));
  const observations=list(tables.prospect_category_observations).filter(row=>row.company_id===company.id).map(row=>{
    const source=sources.get(row.source_id)||{};return{...row,source_url:source.company_id&&source.company_id!==company.id?null:source.source_url,source_status:source.verification_status,source_authority:source.source_authority||row.source_authority};
  }).filter(row=>trusted(row)&&upper(row.source_status)!=='REJECTED'&&ownedSource(row));
  const attributedObservations=observations.filter(row=>!attributionRisk(row));
  const allVerification=list(tables.company_verification_evidence).filter(row=>row.company_id===company.id&&official.has(upper(row.source_type))&&url(row.source_url)&&ownedSource(row));
  const verification=allVerification.filter(row=>!attributionRisk(row));
  const businessTypes=verification.filter(row=>['IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING','RETAILER','RETAIL_CHAIN','DEPARTMENT_STORE'].includes(upper(row.evidence_type)));
  const operatingAll=attributedObservations.filter(row=>['RETAIL_CHANNEL','STORE_NETWORK','IMPORT_ACTIVITY','WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK','WAREHOUSE_INVENTORY'].includes(upper(row.observation_type)));
  const weakOperating=operatingAll.filter(row=>['WEAK_ONLY','CUSTOMER_DESCRIPTION'].includes(operatingSignalStrength(row)));
  const operating=operatingAll.filter(row=>!['WEAK_ONLY','CUSTOMER_DESCRIPTION'].includes(operatingSignalStrength(row)));
  const models=list(tables.buyer_business_model_results).filter(row=>row.company_id===company.id);const model=recent(models);
  const links=list(tables.buyer_business_model_evidence).filter(row=>row.buyer_business_model_result_id===model?.id);
  const modelEvidence=attributedObservations.filter(row=>links.some(link=>link.prospect_category_observation_id===row.id));
  const verified=upper(company.verification_status)==='VERIFIED';
  const rejected=upper(company.verification_status)==='REJECTED';
  const suitable=businessTypes.some(row=>upper(row.evidence_type)!=='GENERAL_TRADING')||operating.length>0||
    (modelEvidence.length>0&&['DIRECT_END_BUYER','DISTRIBUTION_BUYER'].includes(upper(model?.buyer_model)));
  const broad=businessTypes.some(row=>upper(row.evidence_type)==='GENERAL_TRADING')||operating.length>0;
  const negative=observations.filter(row=>upper(row.observation_type)==='INTERMEDIARY_EXCLUSION');
  const identity=verification.filter(row=>upper(row.evidence_type)==='COMPANY_IDENTITY');
  const location=verification.filter(row=>['LOCATION','LOCATIONS'].includes(upper(row.evidence_type)));
  const excludedIdentity=identity.filter(row=>/\b(?:market research company|commercial strategy, advisory|importers search engine|company directory|bill.of.lading database|trade intelligence platform|plataforma de inteligencia comercial|industria alimentaria|food service y clientes|nearshore manufacturing)\b/i.test(row.evidence_text||''));
  excludedIdentity.push(...verification.filter(row=>/\b(?:manufacturer and distributor of healthy food ingredients|natural ingredients solutions for food businesses|our database includes online bill of lading data)\b/i.test(row.evidence_text||'')));
  const thirdPartyContent=verification.filter(row=>/\b(?:according to|market research|research findings|top players|market is projected|market.takeaways|market forecast|press.release|industry.report|Photo: Walmart)\b/i.test(`${row.evidence_text||''} ${row.source_url||''}`));
  const unrelatedProduct=verification.filter(row=>/\b(?:inulina de agave|fibra prebi[oó]tica|banking services|industrial machinery|industrial equipment|software solutions|refrigeration equipment|equipos de refrigeraci[oó]n)\b/i.test(row.evidence_text||''));
  const thirdPartyIds=new Set(thirdPartyContent.map(row=>row.id));
  // Own store network: tightened STORE_NETWORK observation, or own verification text naming a chain / quantity of stores.
  const storeNetwork=[...operating.filter(row=>upper(row.observation_type)==='STORE_NETWORK'),
    ...verification.filter(row=>['LOCATIONS','RETAIL_CHANNEL','COMPANY_SCALE','COMPANY_IDENTITY'].includes(upper(row.evidence_type))&&!thirdPartyIds.has(row.id)&&RETAIL_CHAIN_TEXT.test(row.evidence_text||'')&&!BEAUTY_LEFTOVER.test(row.evidence_text||''))];
  const gmDescription=[...verification.filter(row=>['COMPANY_IDENTITY','GENERAL_TRADING','PRODUCT_CATEGORY','RETAIL_CHANNEL','RETAILER'].includes(upper(row.evidence_type))&&!thirdPartyIds.has(row.id)),
    ...attributedObservations.filter(row=>['COMPANY_DESCRIPTION','COMPANY_CATEGORY'].includes(upper(row.observation_type)))].filter(row=>GENERAL_MERCHANDISE_DESCRIPTION.test(row.evidence_text||''));
  return{observations:attributedObservations,verification,verified,rejected,suitable,broad,typeEvidence:[...businessTypes,...operating,...modelEvidence],negative,model,excludedIdentity,thirdPartyContent,unrelatedProduct,
    attributionExcluded:[...observations,...allVerification].filter(attributionRisk),weakOperating,storeNetwork,gmDescription,identity,location,
    v1Broad:businessTypes.some(row=>upper(row.evidence_type)==='GENERAL_TRADING')||operatingAll.length>0};
}

function categoryMatch(company,profile,facts,tables,observedAt){
  const at=Date.parse(observedAt);const scopes=list(tables.dpv_product_category_scope_current).filter(row=>upper(row.product_profile)===profile&&upper(row.approval_status)==='APPROVED'&&upper(row.scope_status||'ACTIVE')==='ACTIVE'&&Date.parse(row.effective_from)<=at&&(!row.effective_to||Date.parse(row.effective_to)>at));
  const observations=facts.observations.filter(row=>['PRODUCT_CATEGORY','PRODUCT_ITEM','COMPANY_CATEGORY','COMPANY_DESCRIPTION'].includes(upper(row.observation_type))&&[profile,'UNKNOWN'].includes(upper(row.normalized_profile))&&norm(row.normalized_category||row.raw_category)).sort(stableOrder);
  const aliases=list(tables.dpv_product_category_scope_aliases).filter(row=>upper(row.status||'ACTIVE')==='ACTIVE');
  let basis='NO_CURRENT_CATEGORY_EVIDENCE',evidence=[],scopeIds=[];
  const direct=observations.flatMap(observation=>scopes.filter(scope=>norm(scope.normalized_category)===norm(observation.normalized_category||observation.raw_category)).map(scope=>({observation,scope,basis:norm(scope.normalized_category)===profile?'PROFILE_SCOPE':'EXACT_CATEGORY'}))).sort((a,b)=>(a.basis==='EXACT_CATEGORY'?0:1)-(b.basis==='EXACT_CATEGORY'?0:1)||stableOrder(a.observation,b.observation)||String(a.scope.id).localeCompare(String(b.scope.id)));
  if(direct.length){basis=direct[0].basis;evidence=[direct[0].observation];scopeIds=[direct[0].scope.id];}
  if(!evidence.length)for(const observation of observations){const alias=aliases.find(row=>norm(row.normalized_alias||row.raw_alias)===norm(observation.normalized_category||observation.raw_category)&&scopes.some(scope=>scope.id===row.scope_id&&scope.scope_revision_id===row.scope_revision_id));if(alias&&['EXACT','SYNONYM','PARENT','CHILD','SIMILAR'].includes(upper(alias.alias_type))){basis=['EXACT','SYNONYM'].includes(upper(alias.alias_type))?'APPROVED_EQUIVALENT_CATEGORY':'SIMILAR_CATEGORY';evidence=[observation];scopeIds=[alias.scope_id];break;}}
  const current=recent(list(tables.category_procurement_match_results).filter(row=>row.company_id===company.id&&upper(row.product_profile)===profile));
  const outOfScope=current?.match_basis==='OUT_OF_SCOPE'&&scopes.some(scope=>scope.scope_revision_id===current.scope_revision_id)&&observations.some(row=>list(current.observed_customer_category_ids).includes(row.id));
  if(!evidence.length&&current){const supported=observations.filter(row=>list(current.observed_customer_category_ids).includes(row.id));const supportedScopes=scopes.filter(row=>list(current.matched_scope_ids).includes(row.id)&&row.scope_revision_id===current.scope_revision_id);
    if(supported.length&&supportedScopes.length&&['EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE'].includes(current.match_basis)){basis=current.match_basis;evidence=supported;scopeIds=supportedScopes.map(row=>row.id);}}
  if(!outOfScope&&!evidence.length&&scopes.length){const observed=observations.find(row=>upper(row.normalized_profile)===profile);if(observed){basis='PROFILE_SCOPE';evidence=[observed];scopeIds=scopes.map(row=>row.id);}}
  return{basis,evidence,scopeIds,current,outOfScope,observations};
}

function profileMatch(company,profile,facts,tables,observedAt){
  const match=categoryMatch(company,profile,facts,tables,observedAt);
  let{basis,evidence,scopeIds}=match;const changes=[];
  const hasCategory=basis!=='NO_CURRENT_CATEGORY_EVIDENCE';
  // Change 3: own store network + approved category evidence makes a retail chain a suitable buyer type.
  // Verification is NOT bypassed; an unverified retail chain is only flagged for the C1 verifier work.
  const retailChain=hasCategory&&facts.storeNetwork.length>0;
  const verified=facts.verified;
  const suitable=facts.suitable||retailChain;
  if(retailChain&&!facts.suitable&&verified)changes.push('RETAIL_CHAIN_BUYER_TYPE_BY_STORE_NETWORK_AND_CATEGORY');
  const blockedByVerification=retailChain&&!facts.verified&&!facts.rejected;
  // Change 1: broad scope needs category evidence, or (general merchandise only) an explicit description.
  const gmDescription=profile==='GENERAL_MERCHANDISE'&&facts.gmDescription.length>0;
  let band='EXPLORATORY';
  if(match.outOfScope){band='NOT_SUITABLE';basis='EVIDENCED_OUT_OF_SCOPE';evidence=match.observations.filter(row=>list(match.current.observed_customer_category_ids).includes(row.id));}
  else if(verified&&suitable&&['EXACT_CATEGORY','APPROVED_EQUIVALENT_CATEGORY'].includes(basis))band='PRECISION';
  else if(verified&&suitable&&['SIMILAR_CATEGORY','PROFILE_SCOPE'].includes(basis))band='RELEVANT';
  else if(verified&&facts.broad&&(hasCategory||gmDescription)){band='GENERAL_RELEVANT';
    if(!hasCategory){basis='GENERAL_MERCHANDISE_DESCRIPTION';evidence=facts.gmDescription.slice(0,3);changes.push('GENERAL_MERCHANDISE_DESCRIPTION_SUPPORTS_BROAD_SCOPE');}}
  else if(verified&&facts.broad)changes.push('BROAD_SIGNAL_WITHOUT_CATEGORY_EVIDENCE');
  else if(verified&&facts.v1Broad&&!facts.broad)changes.push('BROAD_SIGNAL_WEAK_NAVIGATION_TERM_ONLY');
  return{product_profile:profile,band,category_basis:basis,scope_ids:scopeIds,evidence_references:evidence.map(ref),current_match_id:match.current?.id||null,v2_changes:changes,retail_chain_blocked_by_verification:blockedByVerification};
}

export function classifyCompanyBusinessV2(company,{tables={},observedAt=new Date().toISOString()}={}){
  const facts=companyFacts(company,tables),notes=[];
  const profiles=['WOMENSWEAR','GENERAL_MERCHANDISE'].map(profile=>profileMatch(company,profile,facts,tables,observedAt));
  let selected=[...profiles].sort((a,b)=>rank[b.band]-rank[a.band])[0];
  if(facts.negative.length)selected={...selected,band:'NOT_SUITABLE',category_basis:'EXPLICIT_DISALLOWED_BUYER_EVIDENCE',evidence_references:facts.negative.map(ref)};
  else if(facts.excludedIdentity.length)selected={...selected,band:'NOT_SUITABLE',category_basis:'OFFICIAL_IDENTITY_NON_TARGET_BUSINESS',evidence_references:facts.excludedIdentity.map(ref)};
  else if(['NOT_A_TARGET_COMPANY_PUBLIC_GUIDE','OEM_ONLY_FINISHED_GOODS_SUPPLIER'].includes(upper(company.explicit_exclusion_reason))&&facts.rejected)selected={...selected,band:'NOT_SUITABLE',category_basis:upper(company.explicit_exclusion_reason),evidence_references:[]};
  else if(facts.thirdPartyContent.length>=2||facts.unrelatedProduct.length){selected={...selected,band:'EXPLORATORY',category_basis:'BUSINESS_ATTRIBUTION_OR_SCOPE_CONFLICT_REQUIRES_REVIEW',evidence_references:[...facts.thirdPartyContent,...facts.unrelatedProduct].map(ref)};notes.push('POSSIBLE_THIRD_PARTY_CONTENT_OR_UNRELATED_PRODUCT_NOT_ASSUMED_AS_BUYER_SCOPE');}
  if(company.explicit_exclusion_reason)notes.push('LEGACY_EXCLUSION_REQUIRES_REASON_REVIEW');
  if(['NOT_A_TARGET_COMPANY_PUBLIC_GUIDE','OEM_ONLY_FINISHED_GOODS_SUPPLIER'].includes(selected.category_basis))notes.push(`STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED:${company.id}:${company.explicit_exclusion_reason}`);
  if(facts.attributionExcluded.length)notes.push('BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED');
  if(upper(company.explicit_exclusion_reason).startsWith('MARKET_MISMATCH'))notes.push('MARKET_MISMATCH_RETAINED_SEPARATELY_FROM_BUSINESS_FIT');
  const retailBlocked=selected.band!=='NOT_SUITABLE'&&profiles.some(profile=>profile.retail_chain_blocked_by_verification);
  if(!facts.verified)notes.push('IDENTITY_VERIFICATION_INCOMPLETE');
  if(retailBlocked)notes.push('RETAIL_CHAIN_BLOCKED_BY_VERIFICATION');
  const suitableSelected=facts.suitable||(selected.v2_changes||[]).includes('RETAIL_CHAIN_BUYER_TYPE_BY_STORE_NETWORK_AND_CATEGORY');
  if(!suitableSelected)notes.push('BUYER_TYPE_EVIDENCE_INCOMPLETE');
  if(facts.weakOperating.length)notes.push('WEAK_NAVIGATION_SIGNAL_NOT_COUNTED');
  const v2Changes=[...new Set(['NOT_SUITABLE'].includes(selected.band)||selected.category_basis==='BUSINESS_ATTRIBUTION_OR_SCOPE_CONFLICT_REQUIRES_REVIEW'?[]:(selected.v2_changes||[]))];
  // A company-level downgrade explanation: when no profile reached a positive band only because of the new rules.
  if(selected.band==='EXPLORATORY'&&!v2Changes.length)for(const profile of profiles)for(const change of profile.v2_changes)if(change.startsWith('BROAD_SIGNAL'))v2Changes.push(change);
  const old=list(tables.business_opportunity_current).filter(row=>row.company_id===company.id);
  if(old.some(row=>(row.display_opportunity_status||row.system_recommendation_status)==='NOT_SUITABLE')&&selected.band!=='NOT_SUITABLE')notes.push('OLD_NOT_SUITABLE_REOPEN_REQUIRES_EXPLICIT_REVIEW');
  const companyType=(selected.v2_changes||[]).some(change=>change.startsWith('RETAIL_CHAIN'))?'RETAIL_CHAIN':company.company_type||null;
  return{company_id:company.id,company_name:company.company_name,market:company.country_code||company.country_name||null,rule_version:OPPORTUNITY_POOL_V2_VERSION,
    old_decision_status:old.map(row=>row.display_opportunity_status||row.system_recommendation_status),old_blocker:old.map(row=>({product_profile:row.product_profile||null,reason_codes:row.reason_codes||row.recommendation_reason_codes||[],business_fit_status:row.business_fit_status||null,contact_readiness:row.contact_readiness||null,policy_contact_status:row.policy_contact_status||null})),old_decisions:old,
    new_opportunity_pool_band:selected.band,category_basis:selected.category_basis,profile_results:profiles.map(profile=>selected.band==='NOT_SUITABLE'&&selected.category_basis!=='EVIDENCED_OUT_OF_SCOPE'?{...profile,band:'NOT_SUITABLE',company_exclusion_basis:selected.category_basis}:selected.category_basis==='BUSINESS_ATTRIBUTION_OR_SCOPE_CONFLICT_REQUIRES_REVIEW'?{...profile,band:'EXPLORATORY',company_review_basis:selected.category_basis}:profile),
    company_type_basis:{company_type:companyType,suitable_by_evidence:suitableSelected,broad_by_evidence:facts.broad,evidence_references:[...facts.typeEvidence,...(companyType==='RETAIL_CHAIN'?facts.storeNetwork:[])].map(ref)},
    explicit_exclusion_reason:company.explicit_exclusion_reason||null,evidence_references:selected.evidence_references,
    active_opportunity_pool:activeBands.includes(selected.band)?'YES':'NO',v2_changes:v2Changes,retail_chain_blocked_by_verification:retailBlocked,
    v2_evidence:{weak_operating_signals:facts.weakOperating.map(ref),store_network:facts.storeNetwork.map(ref),general_merchandise_description:facts.gmDescription.map(ref)},notes};
}
export function classifySnapshotV2(snapshot){const tables=snapshot.tables||{};return list(tables.companies).map(company=>classifyCompanyBusinessV2(company,{tables,observedAt:snapshot.observed_at||new Date().toISOString()}));}
