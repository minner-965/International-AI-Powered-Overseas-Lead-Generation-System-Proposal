import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { extractProductObservations } from '../productMatch/productObservationExtractor.js';

export const CATEGORY_OBSERVATION_EXTRACTION_VERSION='company-category-observation-v3';
const clean=(value,max=2000)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const upper=value=>String(value||'').trim().toUpperCase();
const official=new Set(['OFFICIAL','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT']);

// C8: each signal has strong wording, and broad navigation words ("locations", "shop online",
// "inventario") that count only when the same evidence window carries a quantity or own-operation
// context — the same rule as opportunityPool/classifierV2.js. Portuguese and Arabic wording added.
const QUANTITY=/\b(?:(?:more than|over|across|m[aá]s de|mais de)\s+)?\d{1,5}\s*\+?\s*(?:stores?|shops?|locations?|branches|outlets?|showrooms?|boutiques?|tiendas|sucursales|ubicaciones|lojas|filiais|supermarkets?|hypermarkets?)\b/i;
const signals=[
  {type:'RETAIL_CHANNEL',role:'OWN_RETAIL',strong:/(?:\b(?:our stores?|retail stores?|chain of stores?|tiendas|cadena minorista|nuestras tiendas|nossas lojas|rede de lojas)\b|متاجرنا)/iu,
    weak:/\bshop online\b/i,context:/\b(?:in[- ]store|our (?:stores?|boutiques?|showrooms?)|visit (?:us|our store))\b/i},
  {type:'STORE_NETWORK',role:'OWN_RETAIL',strong:/(?:\b(?:store locator|branches|more than \d+ stores?|sucursales|filiais|nossas lojas)\b|فروعنا)/iu,
    weak:/\b(?:locations|ubicaciones)\b/i,context:/\b(?:our|all|visit our|find (?:a|our)|nuestras|todas (?:las|nuestras))\s+(?:store\s+)?(?:locations|ubicaciones)\b|\blocations\s+(?:across|in|throughout|nationwide)\b/i},
  {type:'IMPORT_ACTIVITY',role:'IMPORT',strong:/(?:\b(?:we import|importer of|importamos|importador(?:a)? de|international sourcing|importação|importadora de)\b|نستورد|مستورد)/iu},
  {type:'WHOLESALE_ACTIVITY',role:'WHOLESALE',strong:/(?:\b(?:wholesale catalog|wholesale ordering|venta al mayoreo|mayorista|wholesale customers?|atacadista|vendas no atacado|venda por atacado)\b|بالجملة|تجارة الجملة)/iu},
  {type:'DISTRIBUTION_NETWORK',role:'DISTRIBUTION',strong:/(?:\b(?:dealer network|distribution network|supply retailers|red de distribuidores|distribuimos a tiendas|rede de distribuição|distribuímos para)\b|شبكة توزيع)/iu},
  {type:'WAREHOUSE_INVENTORY',role:'WAREHOUSE',strong:/(?:\b(?:our warehouse|warehousing|inventory operation|centro de distribución|nuestro almac[eé]n|centro de distribuição|nosso estoque)\b|مستودعاتنا)/iu,
    weak:/\binventario\b/i,context:/\b(?:nuestro|gran|amplio)\s+inventario\b|\binventario\s+(?:propio|permanente|de m[aá]s de)\b|\b\d[\d.,]*\s*(?:m2|m²|metros cuadrados)\b/i},
  {type:'THIRD_PARTY_BRAND_PORTFOLIO',role:'DISTRIBUTION',strong:/\b(?:brand portfolio|distributed brands|marcas que distribuimos|multi-brand portfolio|marcas que distribu[ií]mos|portf[oó]lio de marcas)\b/iu}
];
/** First qualifying match of one signal: a strong term, or a weak term with quantity/context in its window. */
export function matchOperatingSignal(signal,text){
  const strong=signal.strong.exec(text);if(strong)return strong;
  if(!signal.weak)return null;
  const pattern=new RegExp(signal.weak.source,'gi');let match;
  while((match=pattern.exec(text))){const window=evidenceWindow(text,match);if(QUANTITY.test(window)||signal.context?.test(window))return match;}
  return null;
}

function evidenceWindow(text,match){const start=Math.max(0,match.index-180);return clean(text.slice(start,start+600));}

export function extractCategoryBuyerObservations(input={}){
  const html=String(input.html||'');const sourceUrl=clean(input.source_url);if(!html||!sourceUrl)return[];
  const authority=upper(input.source_authority||'OTHER_PUBLIC');const capturedAt=input.captured_at||new Date().toISOString();const result=[];const seen=new Set();
  const products=extractProductObservations({...input,source_authority:authority==='OFFICIAL'?'OFFICIAL_STOREFRONT':authority});
  for(const item of products){const row={observation_type:item.raw_product_name?'PRODUCT_ITEM':'PRODUCT_CATEGORY',raw_category:item.raw_category,
    raw_product_name:item.raw_product_name,raw_brand_or_department:item.raw_brand_or_department,normalized_profile:item.normalized_profile,
    normalized_category:item.normalized_category,normalized_subcategory:item.normalized_subcategory,business_activity_role:'OWN_RETAIL',
    evidence_text:item.evidence_text,source_authority:authority,verification_status:official.has(authority)?'VERIFIED':'REVIEW',captured_at:capturedAt,
    published_at:input.published_at||null,extraction_version:CATEGORY_OBSERVATION_EXTRACTION_VERSION,data_classification:'PUBLIC_WEB'};
    row.evidence_hash=sha([sourceUrl,row.observation_type,row.raw_product_name,row.raw_category,row.evidence_text].join('|'));if(!seen.has(row.evidence_hash)){seen.add(row.evidence_hash);result.push(row);}}
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const text=clean($('body').text(),100000);
  for(const signal of signals){const{type,role}=signal;const match=matchOperatingSignal(signal,text);if(!match)continue;const evidence=evidenceWindow(text,match);const row={observation_type:type,raw_category:null,raw_product_name:null,
    raw_brand_or_department:null,normalized_profile:upper(input.product_profile)||'UNKNOWN',normalized_category:null,
    normalized_subcategory:null,business_activity_role:role,evidence_text:evidence,source_authority:authority,
    verification_status:official.has(authority)?'VERIFIED':'REVIEW',captured_at:capturedAt,published_at:input.published_at||null,
    extraction_version:CATEGORY_OBSERVATION_EXTRACTION_VERSION,data_classification:'PUBLIC_WEB'};
    row.evidence_hash=sha([sourceUrl,type,evidence].join('|'));if(!seen.has(row.evidence_hash)){seen.add(row.evidence_hash);result.push(row);}}
  return result;
}
