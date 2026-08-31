import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DpvZenRulesAdapter } from '../scoring/zenRulesAdapter.js';

export const BUYER_BUSINESS_MODEL_VERSION = 'buyer-business-model-v1';

const officialAuthorities = new Set(['OFFICIAL','OFFICIAL_WEBSITE','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT','REGISTRY']);
const upper = value => String(value || '').trim().toUpperCase();
const unique = values => [...new Set((values || []).filter(Boolean))];
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projectRoot=process.env.DPV_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const rulesRoot=process.env.DPV_RULES_DIR?path.resolve(process.env.DPV_RULES_DIR):path.join(projectRoot,'rules');
const rulePath=path.join(rulesRoot,'buyer-business-model/v1/decision.json');

function strongObservation(item = {}) {
  return upper(item.verification_status) === 'VERIFIED' && upper(item.source_authority) !== 'SEARCH_DISCOVERY' && Boolean(item.id);
}

function subtypeHint(observations, kind) {
  const hints = observations.map(item => upper(item.buyer_subtype || item.subtype_hint || item.raw_brand_or_department));
  const allowed = kind === 'direct'
    ? ['CHAIN_RETAILER','DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET','LIFESTYLE_RETAILER','ORGANIZED_ECOM_RETAILER']
    : kind === 'distribution' ? ['IMPORTER','WHOLESALER','DISTRIBUTOR'] : ['GENERAL_TRADING','SOURCING_AGENT','BROKER','OEM_ONLY'];
  return allowed.find(value => hints.includes(value)) || null;
}

export function buildBuyerBusinessModelFacts({ observations = [],product_profile = null,company={} } = {}) {
  const profile = upper(product_profile);
  const verified = observations.filter(strongObservation);
  const relevant = verified.filter(item => !profile || !upper(item.normalized_profile) || upper(item.normalized_profile) === profile || upper(item.normalized_profile) === 'UNKNOWN');
  const has = (...types) => relevant.some(item => types.includes(upper(item.observation_type)));
  const idsFor = (...types) => relevant.filter(item => types.includes(upper(item.observation_type))).map(item => item.id);
  const officialRetail = relevant.some(item => ['RETAIL_CHANNEL','STORE_NETWORK'].includes(upper(item.observation_type)) && officialAuthorities.has(upper(item.source_authority)));
  const categoryIds = idsFor('PRODUCT_CATEGORY','PRODUCT_ITEM');
  const procurementIds = idsFor('IMPORT_ACTIVITY','BUYING_DEPARTMENT');
  const operatingIds = idsFor('WAREHOUSE_INVENTORY','WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK','THIRD_PARTY_BRAND_PORTFOLIO');
  const exclusionIds = idsFor('INTERMEDIARY_EXCLUSION');
  const organizationType=upper(company.organization_type||company.buyer_subtype);
  const directAllowed=['CHAIN_RETAILER','DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET','LIFESTYLE_RETAILER','ORGANIZED_ECOM_RETAILER'];
  const distributionAllowed=['IMPORTER','WHOLESALER','DISTRIBUTOR'];
  const exclusionAllowed=['SOURCING_AGENT','BROKER','OEM_ONLY'];
  const directSubtype = subtypeHint(relevant,'direct') || (directAllowed.includes(organizationType)?organizationType:null);
  const distributionSubtype = subtypeHint(relevant,'distribution') || (distributionAllowed.includes(organizationType)?organizationType:null) || (has('IMPORT_ACTIVITY')?'IMPORTER':has('WHOLESALE_ACTIVITY')?'WHOLESALER':has('DISTRIBUTION_NETWORK')?'DISTRIBUTOR':null);
  const exclusionSubtype = subtypeHint(relevant,'exclusion') || (exclusionAllowed.includes(organizationType)?organizationType:null) || 'OTHER';
  const labelText=`${company.company_name||''} ${company.organization_type||''}`.toLowerCase();
  const labelOnly=/\b(?:general trading|trading|distributor|wholesaler|importer)\b/.test(labelText)||['GENERAL_TRADING','DISTRIBUTOR','WHOLESALER','IMPORTER'].includes(organizationType);
  return {
    target_category_confirmed:categoryIds.length>0,
    organized_own_retail_confirmed:officialRetail,
    procurement_import_confirmed:procurementIds.length>0,
    inventory_distribution_confirmed:operatingIds.length>0,
    strong_distribution_evidence:procurementIds.length>0&&operatingIds.length>1,
    intermediary_label_present:has('WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK','IMPORT_ACTIVITY')||labelOnly,
    exclusion_confirmed:exclusionIds.length>0,
    direct_subtype:directSubtype || 'OTHER',
    distribution_subtype:distributionSubtype || 'DISTRIBUTOR',
    unclear_subtype:distributionSubtype || (organizationType==='GENERAL_TRADING'||/general trading/.test(labelText)?'GENERAL_TRADING':'OTHER'),
    exclusion_subtype:exclusionSubtype,
    evidence_ids:unique([...categoryIds,...idsFor('RETAIL_CHANNEL','STORE_NETWORK'),...procurementIds,...operatingIds,...exclusionIds]),
    input_digest:sha(relevant.map(item=>[item.id,item.evidence_hash,item.verification_status,item.observation_type]))
  };
}

export function classifyBuyerBusinessModel(input = {}) {
  const facts = input.facts || buildBuyerBusinessModelFacts(input);
  let buyer_model='UNKNOWN',buyer_subtype='OTHER',eligibility_status='NEEDS_EVIDENCE',priority_tier='REVIEW',confidence_band='UNKNOWN';
  const reason_codes=[];
  if(facts.exclusion_confirmed){
    buyer_model='EXCLUDED_INTERMEDIARY';buyer_subtype=facts.exclusion_subtype||'OTHER';eligibility_status='INELIGIBLE';priority_tier='EXCLUDED';confidence_band='HIGH';reason_codes.push('EXCLUDED_INTERMEDIARY_CONFIRMED');
  }else if(facts.target_category_confirmed&&facts.organized_own_retail_confirmed){
    buyer_model='DIRECT_END_BUYER';buyer_subtype=facts.direct_subtype||'OTHER';eligibility_status='ELIGIBLE';priority_tier='P1_DIRECT';confidence_band='HIGH';reason_codes.push('OWN_RETAIL_TARGET_CATEGORY_CONFIRMED');
  }else if(facts.target_category_confirmed&&facts.procurement_import_confirmed&&facts.inventory_distribution_confirmed){
    buyer_model='DISTRIBUTION_BUYER';buyer_subtype=facts.distribution_subtype||'DISTRIBUTOR';eligibility_status='ELIGIBLE';priority_tier='P2_DISTRIBUTION';confidence_band=facts.strong_distribution_evidence?'HIGH':'MEDIUM';reason_codes.push('CATEGORY_PROCUREMENT_AND_DISTRIBUTION_CONFIRMED');
  }else if(facts.intermediary_label_present||facts.procurement_import_confirmed||facts.inventory_distribution_confirmed||facts.target_category_confirmed){
    buyer_model='UNCLEAR_INTERMEDIARY';buyer_subtype=facts.unclear_subtype||'OTHER';eligibility_status='NEEDS_EVIDENCE';priority_tier='REVIEW';confidence_band='LOW';reason_codes.push(facts.target_category_confirmed?'BUYING_MODEL_EVIDENCE_INCOMPLETE':'INTERMEDIARY_LABEL_ONLY');
  }else reason_codes.push('BUYER_BUSINESS_MODEL_EVIDENCE_MISSING');
  return {...facts,buyer_model,buyer_subtype,eligibility_status,priority_tier,confidence_band,reason_codes,evidence_count:facts.evidence_ids?.length||0,calculation_version:BUYER_BUSINESS_MODEL_VERSION};
}

export class BuyerBusinessModelEngine {
  constructor({adapter=new DpvZenRulesAdapter({rulePaths:{buyerBusinessModel:rulePath}})}={}){this.adapter=adapter;}
  async evaluate(input={}){
    const facts=input.facts||buildBuyerBusinessModelFacts(input);
    const result=await this.adapter.evaluate('buyerBusinessModel',{facts},{trace:false});
    const {zen_trace:_trace,zen_performance:_performance,...clean}=result;
    return {...facts,...clean,evidence_count:facts.evidence_ids.length,input_digest:facts.input_digest};
  }
  dispose(){this.adapter.dispose();}
}
