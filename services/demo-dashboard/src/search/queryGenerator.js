import { marketLocationText, marketProfileForJob } from '../market/marketProfiles.js';
import { getProductCategoryProfile } from '../market/productProfiles.js';

export const CATEGORY_SYNONYMS = Object.freeze({
  'Beauty & Personal Care': ['beauty products', 'cosmetics', 'personal care', 'skincare', 'hair care'],
  "Women's Apparel": ["women's apparel", "women's clothing", 'ladies fashion', 'fashion garments', 'womenswear'],
  "Men's Apparel": ["men's apparel", "men's clothing", 'menswear', 'fashion garments'],
  "Children's Apparel": ["children's apparel", "children's clothing", 'kids fashion', 'childrenswear'],
  Bags: ['bags', 'handbags', 'fashion bags', 'travel bags', 'bag accessories'],
  'Household Goods': ['household goods', 'homeware', 'household products', 'home products', 'home supplies']
});

const BUYER_TERMS = Object.freeze({
  Importer: ['importer', 'import company'],
  Wholesaler: ['wholesaler', 'wholesale supplier'],
  Distributor: ['distributor', 'distribution company'],
  'Chain Apparel Retailer': ['apparel retail chain'],
  'Department Store': ['department store'],
  Supermarket: ['supermarket buying organization'],
  'Large Retail Group': ['large retail group'],
  'Regional Retail Chain': ['regional retail chain']
});

function categoryTerms(category) {
  return getProductCategoryProfile(category).searchTerms;
}

export function searchCountryCode(country, explicitCode = '') {
  const profile = marketProfileForJob({ country_code: explicitCode, country_name: country });
  return profile.countryCode === 'XX' ? 'ALL' : profile.countryCode;
}

function normalizeQueryKey(query) {
  return query.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

export function generateResearchQueries(job) {
  const profile = marketProfileForJob(job);
  const country = String(job.country_name || job.country || profile.countryName).trim();
  const city = String(job.city || '').trim();
  const category = String(job.product_category || '').trim();
  const buyers = Array.isArray(job.buyer_types) && job.buyer_types.length ? job.buyer_types : ['Importer', 'Wholesaler', 'Distributor'];
  const synonyms = categoryTerms(category);
  const market = marketLocationText(job, profile);
  const termsForBuyer = buyer => ({
    Importer: profile.importerTerms,
    Wholesaler: profile.wholesalerTerms,
    Distributor: profile.distributorTerms,
    'Apparel Importer': profile.importerTerms,
    'Apparel Wholesaler': profile.wholesalerTerms,
    'Apparel Distributor': profile.distributorTerms,
    'General Merchandise Importer': profile.importerTerms,
    'General Merchandise Wholesaler': profile.wholesalerTerms,
    'General Merchandise Distributor': profile.distributorTerms,
    'Chain Apparel Retailer': profile.retailTerms,
    'Department Store': profile.departmentStoreTerms,
    Supermarket: profile.supermarketTerms,
    'Supermarket Buying Organization': profile.supermarketTerms,
    'Large Retail Group': profile.strategicTerms,
    'Regional Retail Chain': profile.retailTerms,
    'Lifestyle / Daily-use Goods Chain': profile.retailTerms
  }[buyer] || BUYER_TERMS[buyer] || [String(buyer).toLowerCase()]);
  const directBuyerTerms = buyers.map(buyer => termsForBuyer(buyer)[0]).join(' ');
  const candidates = [
    {
      query_text: `"${synonyms[0]}" ${profile.smeTerms[0]} ${profile.distributorTerms[0]} ${market}`.trim(),
      query_type: 'sme_regional', buyer_type: 'Distributor'
    },
    {
      query_text: `"${synonyms[1 % synonyms.length]}" ${profile.smeTerms[1] || profile.smeTerms[0]} ${profile.wholesalerTerms[0]} ${market}`.trim(),
      query_type: 'sme_regional', buyer_type: 'Wholesaler'
    },
    {
      query_text: `"${synonyms[2 % synonyms.length]}" ${directBuyerTerms} ${market}`.trim(),
      query_type: 'buyer_category', buyer_type: buyers.join(',')
    },
    {
      query_text: `"${synonyms[3 % synonyms.length]}" ${profile.tradingTerms[0]} ${market}`.trim(),
      query_type: 'general_trading', buyer_type: null
    },
    {
      query_text: `"${synonyms[4 % synonyms.length]}" ${profile.strategicTerms[0]} ${market}`.trim(),
      query_type: 'strategic_account', buyer_type: 'Distributor'
    }
  ];

  buyers.forEach((buyer, buyerIndex) => {
    const terms = termsForBuyer(buyer);
    for (const synonym of synonyms) {
      for (const term of terms) {
        candidates.push({
          query_text: `"${synonym}" ${term} ${market}`.trim(),
          query_type: 'buyer_category', buyer_type: buyer
        });
      }
    }
  });

  const marketStrategies = [
    ...profile.importerTerms.map(term => [term, 'buyer_category', 'Importer']),
    ...profile.wholesalerTerms.map(term => [term, 'buyer_category', 'Wholesaler']),
    ...profile.distributorTerms.map(term => [term, 'buyer_category', 'Distributor']),
    ...profile.tradingTerms.map(term => [term, 'general_trading', null]),
    ...profile.retailTerms.map(term => [term, 'strategic_account', 'Retailer']),
    ...profile.departmentStoreTerms.map(term => [term, 'strategic_account', 'Department Store']),
    ...profile.supermarketTerms.map(term => [term, 'strategic_account', 'Supermarket']),
    ...profile.strategicTerms.map(term => [term, 'strategic_account', null])
  ];
  for (const synonym of synonyms) {
    for (const [term, queryType, buyerType] of marketStrategies) {
      candidates.push({
        query_text: `"${synonym}" ${term} ${market}`.trim(),
        query_type: queryType,
        buyer_type: buyerType
      });
    }
  }

  const seen = new Set();
  return candidates.filter(item => {
    const key = normalizeQueryKey(item.query_text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => ({
    ...item,
    country,
    country_code: profile.countryCode,
    country_name: country,
    city: city || null,
    region: job.region || null,
    preferred_language: job.preferred_language || profile.defaultLanguage,
    market_profile: profile.profileKey,
    product_category: category
  }));
}
