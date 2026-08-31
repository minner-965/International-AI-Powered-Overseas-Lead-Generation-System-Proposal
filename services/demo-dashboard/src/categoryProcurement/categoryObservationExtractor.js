import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { extractProductObservations } from '../productMatch/productObservationExtractor.js';

export const CATEGORY_OBSERVATION_EXTRACTION_VERSION='category-buyer-observation-v1';
const clean=(value,max=2000)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const upper=value=>String(value||'').trim().toUpperCase();
const official=new Set(['OFFICIAL','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT']);

const signals=[
  ['RETAIL_CHANNEL','OWN_RETAIL',/\b(?:our stores?|shop online|retail stores?|chain of stores?|tiendas|cadena minorista|nuestras tiendas)\b/i],
  ['STORE_NETWORK','OWN_RETAIL',/\b(?:store locator|locations|branches|more than \d+ stores?|sucursales|ubicaciones)\b/i],
  ['IMPORT_ACTIVITY','IMPORT',/\b(?:we import|importer of|importamos|importador(?:a)? de|international sourcing)\b/i],
  ['WHOLESALE_ACTIVITY','WHOLESALE',/\b(?:wholesale catalog|wholesale ordering|venta al mayoreo|mayorista|wholesale customers?)\b/i],
  ['DISTRIBUTION_NETWORK','DISTRIBUTION',/\b(?:dealer network|distribution network|supply retailers|red de distribuidores|distribuimos a tiendas)\b/i],
  ['WAREHOUSE_INVENTORY','WAREHOUSE',/\b(?:our warehouse|warehousing|inventory operation|centro de distribución|nuestro almac[eé]n|inventario)\b/i],
  ['THIRD_PARTY_BRAND_PORTFOLIO','DISTRIBUTION',/\b(?:brand portfolio|distributed brands|marcas que distribuimos|multi-brand portfolio)\b/i],
  ['BUYING_DEPARTMENT','BUYING',/\b(?:buying department|procurement department|purchasing team|departamento de compras|equipo de compras)\b/i],
  ['INTERMEDIARY_EXCLUSION','EXCLUSION',/\b(?:sourcing agent|brokerage services|broker|procurement agent|agente de compras|corredor|oem only|contract manufacturer only)\b/i]
];

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
  for(const[type,role,pattern]of signals){const match=pattern.exec(text);if(!match)continue;const evidence=evidenceWindow(text,match);const row={observation_type:type,raw_category:null,raw_product_name:null,
    raw_brand_or_department:type==='BUYING_DEPARTMENT'?match[0]:null,normalized_profile:upper(input.product_profile)||'UNKNOWN',normalized_category:null,
    normalized_subcategory:null,business_activity_role:role,evidence_text:evidence,source_authority:authority,
    verification_status:official.has(authority)?'VERIFIED':'REVIEW',captured_at:capturedAt,published_at:input.published_at||null,
    extraction_version:CATEGORY_OBSERVATION_EXTRACTION_VERSION,data_classification:'PUBLIC_WEB'};
    row.evidence_hash=sha([sourceUrl,type,evidence].join('|'));if(!seen.has(row.evidence_hash)){seen.add(row.evidence_hash);result.push(row);}}
  return result;
}
