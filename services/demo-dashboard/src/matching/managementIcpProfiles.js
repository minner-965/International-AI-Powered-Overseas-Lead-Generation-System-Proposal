import { productScopeForCategory } from '../market/productProfiles.js';

export const MANAGEMENT_MARKETS = Object.freeze({
  priority: Object.freeze(['AE', 'MX']),
  expansion: Object.freeze(['BD'])
});

export const MANAGEMENT_PRODUCT_SCOPES = Object.freeze(['WOMENSWEAR', 'GENERAL_MERCHANDISE']);

export const PREFERRED_ORGANIZATION_TYPES = Object.freeze({
  WOMENSWEAR: Object.freeze([
    'CHAIN_APPAREL_RETAILER', 'DEPARTMENT_STORE', 'LARGE_RETAIL_GROUP',
    'REGIONAL_RETAIL_CHAIN', 'APPAREL_IMPORTER', 'APPAREL_WHOLESALER',
    'APPAREL_DISTRIBUTOR'
  ]),
  GENERAL_MERCHANDISE: Object.freeze([
    'SUPERMARKET', 'DEPARTMENT_STORE', 'LARGE_RETAIL_GROUP',
    'REGIONAL_RETAIL_CHAIN', 'LIFESTYLE_DAILY_USE_GOODS_CHAIN',
    'GENERAL_MERCHANDISE_IMPORTER', 'GENERAL_MERCHANDISE_WHOLESALER',
    'GENERAL_MERCHANDISE_DISTRIBUTOR'
  ])
});

export const PREFERRED_BUYER_ROLES = Object.freeze([
  'BUYER', 'SENIOR_BUYER', 'CATEGORY_BUYER', 'FASHION_BUYER', 'WOMENSWEAR_BUYER',
  'APPAREL_BUYER', 'MERCHANDISE_BUYER', 'GENERAL_MERCHANDISE_BUYER',
  'HOUSEHOLD_BUYER', 'HOME_AND_LIVING_BUYER', 'NON_FOOD_BUYER',
  'PURCHASING_MANAGER', 'PROCUREMENT_MANAGER', 'HEAD_OF_BUYING',
  'SOURCING_MANAGER', 'CATEGORY_MANAGER'
]);

export const MANAGEMENT_EXCLUSIONS = Object.freeze([
  Object.freeze({ reason_code: 'UNVERIFIED_SOCIAL_ACCOUNT', pattern: /\bunverified\s+social\s+(?:account|profile)\b/i }),
  Object.freeze({ reason_code: 'ECOMMERCE_ONLY_SMALL_SELLER', pattern: /\b(?:(?:small\s+)?(?:e-?commerce|online)\s*[- ]?only(?:\s+small)?|(?:e-?commerce|online)\s+small)\s+seller\b/i }),
  Object.freeze({ reason_code: 'SMALL_SINGLE_STORE_RETAIL', pattern: /\b(?:single(?:\s+independent)?|independent)\s+(?:small\s+)?(?:retail\s+)?(?:shop|store)\b|\bpure\s+small\s+retail\s+shop\b/i }),
  Object.freeze({ reason_code: 'INDIVIDUAL_SELLER', pattern: /\bindividual\s+seller\b/i }),
  Object.freeze({ reason_code: 'CONSUMER', pattern: /\b(?:ordinary\s+)?consumer\b/i }),
  Object.freeze({ reason_code: 'SOURCING_AGENT', pattern: /\bsourcing\s+agent\b/i }),
  Object.freeze({ reason_code: 'PROCUREMENT_AGENT', pattern: /\bprocurement\s+agent\b/i }),
  Object.freeze({ reason_code: 'OEM_ONLY', pattern: /\bOEM\s*[- ]?only(?:\s+(?:buyer|customer))?\b/i })
]);

function normalizedType(value = '') {
  return String(value).trim().toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function canonicalOrganizationType(value = '') {
  const type = normalizedType(value);
  return ({
    LARGE_CHAIN_RETAILER: 'LARGE_RETAIL_GROUP',
    SUPERMARKET_BUYING_ORGANIZATION: 'SUPERMARKET',
    CHAIN_RETAILER: 'REGIONAL_RETAIL_CHAIN'
  })[type] || type;
}

export function normalizeManagementProductScope(value = '') {
  const normalized = normalizedType(value);
  if (MANAGEMENT_PRODUCT_SCOPES.includes(normalized)) return normalized;
  return productScopeForCategory(value);
}

export function classifyManagementOrganization({ productScope, organizationType = '', description = '' } = {}) {
  const scope = normalizeManagementProductScope(productScope);
  const type = canonicalOrganizationType(organizationType);
  const context = `${organizationType} ${description}`.trim();
  const exclusion = MANAGEMENT_EXCLUSIONS.find(rule => rule.pattern.test(context));
  if (exclusion) return { eligible: false, product_scope: scope, organization_type: type || null, reason_code: exclusion.reason_code };
  if (!scope) return { eligible: false, product_scope: null, organization_type: type || null, reason_code: 'TARGET_CATEGORY_REQUIRED' };
  const preferred = PREFERRED_ORGANIZATION_TYPES[scope] || [];
  if (preferred.includes(type)) return { eligible: true, product_scope: scope, organization_type: type, reason_code: 'PREFERRED_ORGANIZATION_TYPE' };
  return { eligible: false, product_scope: scope, organization_type: type || null, reason_code: 'ORGANIZATION_TYPE_NOT_PREFERRED' };
}
