import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizePhoneWithContext } from '../src/contact/phoneUtils.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';
import { productScopeForCategory } from '../src/market/productProfiles.js';
import { CustomerMatchEngine } from '../src/matching/customerMatchEngine.js';
import { CustomerMatchService } from '../src/matching/customerMatchService.js';
import { IcpProfileService } from '../src/matching/icpProfileService.js';
import {
  MANAGEMENT_MARKETS, MANAGEMENT_PRODUCT_SCOPES, PREFERRED_BUYER_ROLES,
  PREFERRED_ORGANIZATION_TYPES, classifyManagementOrganization,
  normalizeManagementProductScope
} from '../src/matching/managementIcpProfiles.js';
import { generateResearchQueries } from '../src/search/queryGenerator.js';
import { normalizeCompanyName } from '../src/verification/verificationRules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/019_phase5_v2_management_icp_profiles.sql'), 'utf8');
let sequence = 500;
const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
const observed = values => ({ values: Array.isArray(values) ? values : [values], evidence_ids: [uuid()] });
const feature = values => ({ feature_value: { values }, coverage: 100 });

function managementProfile(productScope, categories) {
  return {
    id: uuid(), profile_type: 'MANAGEMENT_BASELINE',
    version: productScope === 'WOMENSWEAR' ? 'womenswear-baseline-v2' : 'general-merchandise-baseline-v1',
    product_scope: [productScope], feature_coverage: 75,
    features: {
      buyer_types: feature(['IMPORTER']),
      product_categories: feature(categories), markets: feature(['AE','MX','BD']),
      channels: feature(['DEPARTMENT_STORE']), company_sizes: feature(['LARGE']),
      distribution_patterns: feature(['MULTI_STORE']),
      commercial_moq: { feature_value: { status: 'NOT_CONFIGURED' }, coverage: 0 },
      historical_win_similarity: { feature_value: { status: 'HISTORICAL_DATA_PENDING' }, coverage: 0 }
    }
  };
}

function companyFacts() {
  return {
    buyer_types: observed('IMPORTER'), product_categories: observed('WOMENSWEAR'),
    markets: observed('MX'), channels: observed('DEPARTMENT_STORE'),
    company_sizes: observed('LARGE'), distribution_patterns: observed('MULTI_STORE'),
    commercial_moq: { values: [], evidence_ids: [] },
    historical_win_similarity: { values: [], evidence_ids: [] }
  };
}

test('MX MarketProfile has Spanish search, Mexico suffix and phone behavior without changing GENERIC', () => {
  const mx = getMarketProfile('MX');
  assert.deepEqual({ key: mx.profileKey, language: mx.defaultLanguage, secondary: mx.secondaryLanguages, phone: mx.phoneCountryCode }, {
    key: 'MX', language: 'es', secondary: ['en'], phone: '+52'
  });
  assert.equal(normalizeCompanyName('Grupo Moda S.A.P.I. de C.V.', mx), 'grupo moda');
  assert.equal(normalizePhoneWithContext('55 1234 5678', mx).normalized_value, '+525512345678');
  assert.equal(getMarketProfile('XX', 'Example Market').profileKey, 'GENERIC');
});

test('MX organized-buyer queries use profile vocabulary and retain the selected market', () => {
  const queries = generateResearchQueries({
    country_code: 'MX', country_name: 'Mexico', city: 'Monterrey',
    preferred_language: 'es', product_category: 'General Merchandise',
    buyer_types: ['Department Store', 'Supermarket', 'Large Retail Group']
  }, { maxQueries: 8 });
  assert.ok(queries.every(item => item.market_profile === 'MX' && item.preferred_language === 'es'));
  assert.ok(queries.every(item => /Mexico/.test(item.query_text) && /Monterrey/.test(item.query_text)));
  assert.ok(queries.some(item => /tienda departamental/i.test(item.query_text)));
  assert.ok(queries.some(item => /supermercado/i.test(item.query_text)));
  assert.ok(queries.some(item => /grupo de distribución|grupo minorista|cadena regional minorista/i.test(item.query_text)));
  assert.ok(queries.every(item => !/Dubai|Dhaka|Bangladesh|United Arab Emirates/i.test(item.query_text)));
});

test('management profiles preserve priority/expansion markets, scopes and target-role preferences', () => {
  assert.deepEqual(MANAGEMENT_MARKETS, { priority: ['AE','MX'], expansion: ['BD'] });
  assert.deepEqual(MANAGEMENT_PRODUCT_SCOPES, ['WOMENSWEAR','GENERAL_MERCHANDISE']);
  assert.ok(PREFERRED_ORGANIZATION_TYPES.WOMENSWEAR.includes('CHAIN_APPAREL_RETAILER'));
  assert.ok(PREFERRED_ORGANIZATION_TYPES.GENERAL_MERCHANDISE.includes('SUPERMARKET'));
  assert.ok(PREFERRED_BUYER_ROLES.includes('WOMENSWEAR_BUYER'));
  assert.ok(PREFERRED_BUYER_ROLES.includes('GENERAL_MERCHANDISE_BUYER'));
  assert.equal(productScopeForCategory("Women's Apparel"), 'WOMENSWEAR');
  assert.equal(productScopeForCategory('Household Goods'), 'GENERAL_MERCHANDISE');
  assert.equal(normalizeManagementProductScope('General Merchandise'), 'GENERAL_MERCHANDISE');
});

test('organized end-buying organizations are accepted for their product profile', () => {
  for (const organizationType of ['large chain retailer','Department Store','Regional Retail Chain']) {
    assert.equal(classifyManagementOrganization({ productScope: 'WOMENSWEAR', organizationType }).eligible, true);
  }
  for (const organizationType of ['supermarket buying organization','Department Store','Large Retail Group']) {
    assert.equal(classifyManagementOrganization({ productScope: 'GENERAL_MERCHANDISE', organizationType }).eligible, true);
  }
});

test('explicitly excluded organizations receive stable reason codes', () => {
  const fixtures = [
    ['single independent small store','SMALL_SINGLE_STORE_RETAIL'],
    ['ordinary consumer','CONSUMER'], ['individual seller','INDIVIDUAL_SELLER'],
    ['sourcing agent','SOURCING_AGENT'], ['procurement agent','PROCUREMENT_AGENT'],
    ['OEM-only customer','OEM_ONLY'], ['ecommerce-only small seller','ECOMMERCE_ONLY_SMALL_SELLER'],
    ['unverified social account','UNVERIFIED_SOCIAL_ACCOUNT']
  ];
  for (const [description, reason] of fixtures) {
    const result = classifyManagementOrganization({ productScope: 'WOMENSWEAR', organizationType: 'Department Store', description });
    assert.deepEqual([result.eligible, result.reason_code], [false, reason]);
  }
});

test('Customer Match produces distinct product-specific results without changing DPV Score', async () => {
  const engine = new CustomerMatchEngine();
  try {
    const womenswear = await engine.evaluate({ companyFacts: companyFacts(), profile: managementProfile('WOMENSWEAR', ['WOMENSWEAR']), dpvScore: 60 });
    const general = await engine.evaluate({ companyFacts: companyFacts(), profile: managementProfile('GENERAL_MERCHANDISE', ['GENERAL_MERCHANDISE']), dpvScore: 60 });
    assert.equal(womenswear.match_score - general.match_score, 20);
    assert.equal(womenswear.profile_version, 'womenswear-baseline-v2');
    assert.equal(general.profile_version, 'general-merchandise-baseline-v1');
    assert.equal(womenswear.opportunity_matrix, 'PRIORITY_OPPORTUNITY');
    assert.equal(general.opportunity_matrix, 'STRATEGIC_MANUAL_REVIEW');
  } finally { engine.dispose(); }
});

test('active profile lookup is constrained by product scope and market', async () => {
  const calls = [];
  const profile = managementProfile('GENERAL_MERCHANDISE', ['GENERAL_MERCHANDISE']);
  const pool = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT id FROM leadgen\.icp_profiles/.test(sql)) return { rowCount: 1, rows: [{ id: profile.id }] };
    return { rowCount: 1, rows: [{ ...profile, feature_rows: [] }] };
  } };
  const service = new CustomerMatchService({ pool });
  try {
    const selected = await service.selectActiveProfile({ productScope: 'GENERAL_MERCHANDISE', marketCode: 'MX' });
    assert.equal(selected.version, 'general-merchandise-baseline-v1');
    assert.deepEqual(calls[0].params, ['GENERAL_MERCHANDISE','MX']);
    await assert.rejects(() => service.selectActiveProfile(), error => error.code === 'TARGET_CATEGORY_REQUIRED');
  } finally { service.engine.dispose(); }
});

test('profile listing API service exposes feature values for management display', async () => {
  const pool = { query: async () => ({ rows: [{
    id: uuid(), status: 'ACTIVE', feature_rows: [
      { id: uuid(), feature_key: 'priority_markets', feature_value: { values: ['AE','MX'] } },
      { id: uuid(), feature_key: 'expansion_markets', feature_value: { values: ['BD'] } },
      { id: uuid(), feature_key: 'buyer_roles', feature_value: { values: ['BUYER'] } }
    ]
  }] }) };
  const [profile] = await new IcpProfileService({ pool }).listProfiles();
  assert.deepEqual(profile.features.priority_markets.feature_value.values, ['AE','MX']);
  assert.deepEqual(profile.features.expansion_markets.feature_value.values, ['BD']);
  assert.deepEqual(profile.features.buyer_roles.feature_value.values, ['BUYER']);
});

test('migration 019 versions profiles, persists job product scope and keeps historical ICP inactive', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS product_profile text/);
  assert.match(migration, /product_profile IS NULL OR product_profile IN \('WOMENSWEAR','GENERAL_MERCHANDISE'\)/);
  assert.match(migration, /'womenswear-baseline-v2','ACTIVE'/);
  assert.match(migration, /'general-merchandise-baseline-v1','ACTIVE'/);
  assert.match(migration, /version='baseline-v1'[\s\S]*status<>'RETIRED'/);
  assert.match(migration, /'priority_markets'[\s\S]*\["AE","MX"\]/);
  assert.match(migration, /'expansion_markets'[\s\S]*\["BD"\]/);
  assert.match(migration, /'organization_types'/);
  assert.match(migration, /'buyer_roles'/);
  assert.match(migration, /'exclusions'/);
  assert.doesNotMatch(migration, /HISTORICAL_CUSTOMER_ICP[^\n]*'ACTIVE'/);
});
