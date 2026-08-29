import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerMatchEngine } from '../src/matching/customerMatchEngine.js';

let seq = 100;
const id = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
const observed = values => ({ values: Array.isArray(values) ? values : [values], evidence_ids: [id()] });

function profile(type = 'MANAGEMENT_BASELINE', featureCoverage = 75, overrides = {}) {
  const f = (values, coverage = 100) => ({ feature_value: { values }, coverage });
  return {
    id: id(), profile_type: type, version: type === 'MANAGEMENT_BASELINE' ? 'baseline-v1' : 'historical-v1',
    feature_coverage: featureCoverage,
    features: {
      buyer_types: f(['IMPORTER','WHOLESALER']), product_categories: f(['WOMENSWEAR','DRESSES']),
      markets: f(['AE']), channels: f(['WHOLESALE']), company_sizes: f(['SMALL','MEDIUM']),
      distribution_patterns: f(['REGIONAL_DISTRIBUTION']),
      commercial_moq: { feature_value: { min: 100, max: 2000 }, coverage: type === 'HISTORICAL_CUSTOMER_ICP' ? 100 : 0 },
      historical_win_similarity: { feature_value: { status: type === 'HISTORICAL_CUSTOMER_ICP' ? 'CALCULATED' : 'HISTORICAL_DATA_PENDING' }, coverage: type === 'HISTORICAL_CUSTOMER_ICP' ? 100 : 0 },
      ...overrides
    }
  };
}

function facts(overrides = {}) {
  return {
    buyer_types: observed('IMPORTER'), product_categories: observed('WOMENSWEAR'), markets: observed('AE'),
    channels: observed('WHOLESALE'), company_sizes: observed('SMALL'),
    distribution_patterns: observed('REGIONAL_DISTRIBUTION'),
    commercial_moq: { values: [], evidence_ids: [] }, historical_win_similarity: { values: [], evidence_ids: [] },
    ...overrides
  };
}

async function match(input) {
  const engine = new CustomerMatchEngine();
  try { return await engine.evaluate(input); } finally { engine.dispose(); }
}

test('strong management baseline match is separate from DPV score and exposes 75% coverage', async () => {
  const result = await match({ companyFacts: facts(), profile: profile(), dpvScore: 80 });
  assert.equal(result.match_score, 75);
  assert.equal(result.coverage_percent, 75);
  assert.equal(result.display_status, 'BASELINE_ICP');
  assert.equal(result.opportunity_matrix, 'PRIORITY_OPPORTUNITY');
  assert.equal(result.dimension_scores.commercial_moq_fit.points, 0);
  assert.equal(result.dimension_scores.historical_win_similarity.points, 0);
});

test('weak baseline and cross-market fixtures remain explicit mismatches', async () => {
  const weak = await match({ companyFacts: facts({
    buyer_types: observed('RETAILER'), product_categories: observed('ELECTRONICS'), markets: observed('BD'),
    channels: observed('DIRECT_TO_CONSUMER'), company_sizes: observed('ENTERPRISE'), distribution_patterns: observed('LOCAL_RETAIL')
  }), profile: profile(), dpvScore: 20 });
  assert.equal(weak.match_score, 0);
  assert.equal(weak.coverage_percent, 75);
  assert.ok(weak.reason_codes.includes('MARKET_CHANNEL_MISMATCH'));
  assert.equal(weak.opportunity_matrix, 'LOWER_PRIORITY');

  const crossMarket = await match({ companyFacts: facts({ markets: observed('BD') }), profile: profile(), dpvScore: 80 });
  assert.equal(crossMarket.dimension_scores.market_channel_fit.points, 8);
  assert.equal(crossMarket.match_score, 68);
});

test('historical profile scores wins and commercial fit only when evidence exists', async () => {
  const result = await match({
    companyFacts: facts({
      commercial_moq: { numeric_value: 500, evidence_ids: [id()] },
      historical_win_similarity: { similarity: 0.8, evidence_ids: [id()] }
    }),
    profile: profile('HISTORICAL_CUSTOMER_ICP', 100), dpvScore: 60
  });
  assert.equal(result.match_score, 98);
  assert.equal(result.coverage_percent, 100);
  assert.equal(result.display_status, 'HISTORICAL_ICP');
  assert.equal(result.dimension_scores.historical_win_similarity.points, 8);
});

test('low historical profile coverage suppresses numeric confidence', async () => {
  const result = await match({
    companyFacts: facts({ commercial_moq: { numeric_value: 500, evidence_ids: [id()] }, historical_win_similarity: { similarity: 1, evidence_ids: [id()] } }),
    profile: profile('HISTORICAL_CUSTOMER_ICP', 50), dpvScore: 80
  });
  assert.equal(result.match_score, null);
  assert.equal(result.display_status, 'INSUFFICIENT_PROFILE_DATA');
  assert.ok(result.reason_codes.includes('HISTORICAL_PROFILE_COVERAGE_BELOW_60'));
});

test('missing product, order and historical evidence reduce coverage rather than inventing fit', async () => {
  const result = await match({
    companyFacts: facts({
      product_categories: { values: [], evidence_ids: [] }, commercial_moq: { values: [], evidence_ids: [] },
      historical_win_similarity: { values: [], evidence_ids: [] }
    }),
    profile: profile('HISTORICAL_CUSTOMER_ICP', 100), dpvScore: 50
  });
  assert.equal(result.match_score, 55);
  assert.equal(result.coverage_percent, 55);
  assert.ok(result.reason_codes.includes('PRODUCT_CATEGORY_DATA_MISSING'));
  assert.ok(result.reason_codes.includes('COMMERCIAL_MOQ_DATA_MISSING'));
  assert.ok(result.reason_codes.includes('HISTORICAL_WIN_DATA_MISSING'));
});
