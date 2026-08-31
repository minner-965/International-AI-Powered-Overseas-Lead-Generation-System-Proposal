import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { normalizeProductObservation, normalizeTaxonomyText } from './productTaxonomy.js';

const officialAuthorities = new Set([
  'OFFICIAL_PRODUCT_PAGE','OFFICIAL_CATEGORY_PAGE','OFFICIAL_CATALOG','OFFICIAL_DOCUMENT','OFFICIAL_STOREFRONT'
]);

function clean(value) {
  return String(value || '').replace(/\s+/g,' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function jsonLdProducts($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_,node) => {
    try {
      const parsed = JSON.parse($(node).text());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        if (String(item['@type'] || '').toLowerCase() === 'product' && item.name) {
          products.push({ name:clean(item.name),category:clean(item.category),brand:clean(item.brand?.name || item.brand),material:clean(item.material) });
        }
      }
    } catch { /* malformed public JSON-LD is ignored */ }
  });
  return products;
}

export function extractProductObservations(input = {}) {
  const html = String(input.html || '');
  const sourceUrl = clean(input.source_url);
  const authority = String(input.source_authority || input.source_type || 'OTHER_PUBLIC').toUpperCase();
  const sourceType = String(input.source_type || authority).toUpperCase();
  const capturedAt = input.captured_at || new Date().toISOString();
  if (!html || !sourceUrl) return [];
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]),style,noscript,svg').remove();
  const companyName = normalizeTaxonomyText(input.company_name);
  const title = clean($('title').first().text());
  const heading = clean($('main h1,h1').first().text());
  const pageCategory = [heading,title].find(value => value && normalizeTaxonomyText(value) !== companyName) || '';
  const products = jsonLdProducts($);

  $('[itemscope][itemtype*="Product"],article.product,.product-card,[data-product]').each((_,node) => {
    const root = $(node);
    const name = clean(root.find('[itemprop="name"],h1,h2,h3,.product-name,.title').first().text());
    if (!name || normalizeTaxonomyText(name) === companyName) return;
    products.push({
      name,
      category:clean(root.find('[itemprop="category"],.category').first().text()) || pageCategory,
      brand:clean(root.find('[itemprop="brand"],.brand').first().text()),
      material:clean(root.find('[itemprop="material"],.material').first().text()),
      evidence:clean(root.text()).slice(0,1200)
    });
  });

  if (!products.length && authority === 'SEARCH_DISCOVERY') {
    const text = clean($('body').text()).slice(0,1200);
    const normalized = normalizeProductObservation({ raw_category:text });
    if (normalized.assignment_status !== 'UNKNOWN') products.push({ name:null,category:text,evidence:text });
  }

  const observations = [];
  const seen = new Set();
  for (const product of products) {
    const rawName = clean(product.name) || null;
    const rawCategory = clean(product.category || pageCategory) || null;
    if (!rawName && !rawCategory) continue;
    const normalized = normalizeProductObservation({ raw_product_name:rawName,raw_category:rawCategory,raw_brand_or_department:product.brand });
    if (normalized.assignment_status === 'UNKNOWN') continue;
    const evidenceText = clean(product.evidence || [rawCategory,rawName,product.material].filter(Boolean).join(' · ')).slice(0,2000);
    const key = digest([sourceUrl,rawName,rawCategory,evidenceText].join('|'));
    if (seen.has(key)) continue;
    seen.add(key);
    const verifiable = officialAuthorities.has(authority) && ['CONFIRMED','SUPPORTED'].includes(normalized.assignment_status);
    observations.push({
      company_id:input.company_id || null,research_job_id:input.research_job_id || null,
      source_url:sourceUrl,source_type:sourceType,source_authority:authority,captured_at:capturedAt,
      raw_product_name:rawName,raw_category:rawCategory,raw_brand_or_department:clean(product.brand) || null,
      raw_attributes:product.material ? { material:clean(product.material) } : {},
      normalized_profile:normalized.normalized_profile,normalized_category:normalized.normalized_category,
      normalized_subcategory:normalized.normalized_subcategory,material:clean(product.material) || null,
      evidence_text:evidenceText,evidence_hash:key,extraction_version:'product-observation-v1',
      verification_status:verifiable ? 'VERIFIED' : 'REVIEW',data_classification:'PUBLIC_WEB',
      reason_codes:unique(normalized.reason_codes || [])
    });
  }
  return observations;
}

export { normalizeProductObservation } from './productTaxonomy.js';
