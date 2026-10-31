import { loadProductTaxonomyCatalog } from '../categoryProcurement/productTaxonomyCatalog.js';

const PROFILES = Object.freeze({
  'Beauty & Personal Care': Object.freeze({
    category: 'Beauty & Personal Care',
    searchTerms: ['beauty products', 'cosmetics', 'personal care', 'skincare', 'hair care'],
    evidenceTerms: ['beauty', 'cosmetic', 'personal care', 'skin care', 'skincare', 'fragrance', 'perfume', 'hair care']
  }),
  "Women's Apparel": Object.freeze({
    category: "Women's Apparel",
    productScope: 'WOMENSWEAR',
    searchTerms: ["women's apparel", "women's clothing", 'ladies fashion', 'fashion garments', 'womenswear'],
    evidenceTerms: ['women apparel', "women's apparel", 'womenswear', 'ladies fashion', 'dress', 'skirt', 'garment', 'clothing']
  }),
  "Men's Apparel": Object.freeze({ category: "Men's Apparel", searchTerms: ["men's apparel", "men's clothing", 'menswear', 'fashion garments'], evidenceTerms: ["men's apparel", 'menswear', 'garment', 'clothing'] }),
  "Children's Apparel": Object.freeze({ category: "Children's Apparel", searchTerms: ["children's apparel", "children's clothing", 'kids fashion', 'childrenswear'], evidenceTerms: ["children's apparel", 'childrenswear', 'kids fashion', 'garment', 'clothing'] }),
  Bags: Object.freeze({ category: 'Bags', searchTerms: ['bags', 'handbags', 'fashion bags', 'travel bags', 'bag accessories'], evidenceTerms: ['bags', 'handbags', 'travel bags'] }),
  'Household Goods': Object.freeze({ category: 'Household Goods', productScope: 'GENERAL_MERCHANDISE', searchTerms: ['household goods', 'homeware', 'household products', 'home supplies'], evidenceTerms: ['household', 'homeware', 'home products'] }),
  'General Merchandise': Object.freeze({
    category: 'General Merchandise',
    productScope: 'GENERAL_MERCHANDISE',
    searchTerms: ['general merchandise', 'daily-use goods', 'household goods', 'home and living products', 'non-food products'],
    evidenceTerms: ['general merchandise', 'daily-use goods', 'household goods', 'homeware', 'home and living', 'non-food']
  })
});

// C8: localized category evidence terms. Spanish and Portuguese names come from the Shopify Standard
// Product Taxonomy localizations already imported for search terms (rules/product-taxonomy/shopify,
// MIT). That import has no Arabic locale, so Arabic uses the short reviewed list below.
const TAXONOMY_NODES = Object.freeze({
  "Women's Apparel": ['aa-1', 'aa-1-4', 'aa-1-13', 'aa-1-15', 'aa-1-12', 'aa-1-10', 'aa-1-6', 'aa-1-11'],
  "Men's Apparel": ['aa-1', 'aa-1-8', 'aa-1-12', 'aa-1-19', 'aa-1-10'],
  "Children's Apparel": ['aa-1-25', 'bt'],
  Bags: ['aa-5', 'aa-5-4', 'lb', 'lb-1'],
  'Household Goods': ['hg', 'hg-10', 'hg-11', 'hg-3', 'hg-15'],
  'General Merchandise': ['hg', 'hg-10', 'hg-11', 'hg-3', 'hg-15']
});
const CURATED_TERMS = Object.freeze({
  "Women's Apparel": { es: ['ropa de mujer', 'moda femenina', 'ropa femenina'], pt: ['moda feminina', 'roupas femininas'],
    ar: ['ملابس نسائية', 'أزياء نسائية', 'فساتين', 'عبايات', 'تنانير'] },
  "Men's Apparel": { ar: ['ملابس رجالية', 'أزياء رجالية'] },
  "Children's Apparel": { ar: ['ملابس أطفال'] },
  Bags: { ar: ['حقائب', 'حقائب يد'] },
  'Household Goods': { es: ['artículos para el hogar'], pt: ['utilidades domésticas', 'artigos para o lar'],
    ar: ['أدوات منزلية', 'مستلزمات منزلية', 'منتجات منزلية'] },
  'General Merchandise': { es: ['mercancía general', 'artículos para el hogar'], pt: ['utilidades domésticas', 'artigos para o lar'],
    ar: ['بضائع عامة', 'أدوات منزلية', 'مستلزمات منزلية'] }
});
const LOCALIZED_LANGUAGES = new Set(['es', 'pt', 'ar']);
const localizedCache = new Map();
function taxonomyNames() {
  try { return new Map(loadProductTaxonomyCatalog().categories.map(row => [row.id, row.names || {}])); } catch { return new Map(); }
}
let namesById = null;
/** Category evidence terms in the given languages (es/pt from Shopify, ar reviewed), lower case. */
export function localizedEvidenceTerms(category = '', languages = []) {
  const name = String(category).trim();
  const wanted = [...new Set((languages || []).map(value => String(value || '').toLowerCase().slice(0, 2)).filter(value => LOCALIZED_LANGUAGES.has(value)))].sort();
  const key = `${name}|${wanted.join(',')}`;
  if (localizedCache.has(key)) return localizedCache.get(key);
  namesById ||= taxonomyNames();
  const terms = [];
  for (const language of wanted) {
    for (const id of TAXONOMY_NODES[name] || []) {
      const value = namesById.get(id)?.[language];
      if (value) terms.push(value.toLowerCase());
    }
    terms.push(...(CURATED_TERMS[name]?.[language] || []));
  }
  const result = Object.freeze([...new Set(terms)]);
  localizedCache.set(key, result);
  return result;
}

export function getProductCategoryProfile(category = '', { languages = [] } = {}) {
  const name = String(category).trim();
  const base = PROFILES[name] || Object.freeze({
    category: name,
    searchTerms: [name.toLowerCase(), `${name.toLowerCase()} products`].filter(Boolean),
    evidenceTerms: [name.toLowerCase()].filter(Boolean)
  });
  const extra = localizedEvidenceTerms(name, languages);
  return extra.length ? Object.freeze({ ...base, evidenceTerms: [...new Set([...base.evidenceTerms, ...extra])] }) : base;
}

export function productScopeForCategory(category = '') {
  const normalized = String(category || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (['WOMENSWEAR','WOMEN_S_APPAREL','WOMENS_APPAREL','DRESSES','TOPS','SKIRTS','TROUSERS','OUTERWEAR','KNITWEAR'].includes(normalized)) {
    return 'WOMENSWEAR';
  }
  if (['GENERAL_MERCHANDISE','HOUSEHOLD_GOODS','DAILY_USE_GOODS','HOMEWARE','HOME_AND_LIVING','NON_FOOD'].includes(normalized)) {
    return 'GENERAL_MERCHANDISE';
  }
  return PROFILES[String(category || '').trim()]?.productScope || null;
}
