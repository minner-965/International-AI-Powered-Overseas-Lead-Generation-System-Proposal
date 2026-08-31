import assert from 'node:assert/strict';
import test from 'node:test';
import * as taxonomy from '../src/productMatch/productTaxonomy.js';
import * as extractor from '../src/productMatch/productObservationExtractor.js';

const normalizeProductObservation = taxonomy.normalizeProductObservation
  || extractor.normalizeProductObservation;
const extractProductObservations = extractor.extractProductObservations;
const classifyProductMaster = taxonomy.classifyProductMaster;

function statusOf(value) {
  return value.assignment_status || value.normalization_status || value.status;
}

test('taxonomy normalizes explicit English, Spanish and Chinese aliases to the same canonical node', () => {
  assert.equal(typeof normalizeProductObservation, 'function');
  const fixtures = [
    { raw_product_name:'Classic blouse', raw_category:'Tops', language:'en' },
    { raw_product_name:'Blusa clásica', raw_category:'Ropa de mujer', language:'es' },
    { raw_product_name:'女式衬衫', raw_category:'女装上衣', language:'zh' }
  ];
  const normalized = fixtures.map(normalizeProductObservation);
  for (const result of normalized) {
    assert.equal(result.normalized_profile, 'WOMENSWEAR');
    assert.equal(result.normalized_category, 'TOPS');
    assert.equal(result.normalized_subcategory, 'BLOUSE');
    assert.ok(['CONFIRMED','SUPPORTED'].includes(statusOf(result)));
    assert.ok(result.taxonomy_version);
  }
});

test('ambiguous, empty and cross-profile inputs remain REVIEW or UNKNOWN', () => {
  const ambiguous = normalizeProductObservation({ raw_product_name:'Accessories set', raw_category:'Accessories' });
  assert.ok(['REVIEW','UNKNOWN'].includes(statusOf(ambiguous)));

  const empty = normalizeProductObservation({ raw_product_name:null, raw_category:null, raw_attributes:{} });
  assert.equal(statusOf(empty), 'UNKNOWN');
  assert.equal(empty.normalized_profile, 'UNKNOWN');

  const conflict = normalizeProductObservation({
    raw_product_name:'Women blouse', raw_category:'Tops', product_profile:'GENERAL_MERCHANDISE'
  });
  assert.equal(statusOf(conflict), 'REVIEW');
  assert.ok((conflict.reason_codes || []).some(code => /CONFLICT|CROSS_PROFILE/.test(code)));
});

test('product-master classification leaves raw facts unchanged and never fabricates UNKNOWN rows', () => {
  assert.equal(typeof classifyProductMaster, 'function');
  const unknown = Object.freeze({
    id:'00000000-0000-4000-8000-000000000030',product_name:'Unmapped synthetic item',
    product_profile:'UNKNOWN',category:null,moq:null
  });
  const before = JSON.stringify(unknown);
  const result = classifyProductMaster(unknown);
  assert.equal(result.assignment_status, 'UNKNOWN');
  assert.equal(result.normalized_profile, 'UNKNOWN');
  assert.equal(result.normalized_category, null);
  assert.equal(JSON.stringify(unknown), before);

  const conflict = Object.freeze({
    id:'00000000-0000-4000-8000-000000000031',product_name:'Women blouse',
    product_profile:'GENERAL_MERCHANDISE',category:null,moq:null
  });
  const conflicted = classifyProductMaster(conflict);
  assert.equal(conflicted.assignment_status, 'REVIEW');
  assert.equal(conflicted.normalized_category, null);
  assert.equal(conflict.category, null);
});

test('official product/category pages produce traceable public observations', () => {
  assert.equal(typeof extractProductObservations, 'function');
  const observations = extractProductObservations({
    html:`<html><head><title>Women's Tops</title></head><body><main>
      <h1>Women's Tops</h1><article itemscope itemtype="https://schema.org/Product">
        <h2 itemprop="name">Classic Blouse</h2><span itemprop="material">Cotton</span>
      </article></main></body></html>`,
    source_url:'https://buyer.example/women/tops',
    source_type:'OFFICIAL_CATEGORY_PAGE',
    source_authority:'OFFICIAL_CATEGORY_PAGE',
    captured_at:'2026-08-31T00:00:00.000Z',
    company_id:'00000000-0000-4000-8000-000000000001',
    research_job_id:'00000000-0000-4000-8000-000000000002'
  });
  assert.ok(observations.length >= 1);
  assert.ok(observations.some(item => /Classic Blouse/i.test(item.raw_product_name || '')));
  for (const item of observations) {
    assert.equal(item.source_url, 'https://buyer.example/women/tops');
    assert.equal(item.source_authority, 'OFFICIAL_CATEGORY_PAGE');
    assert.equal(item.captured_at, '2026-08-31T00:00:00.000Z');
    assert.match(item.evidence_text, /top|blouse/i);
    assert.equal(item.data_classification, 'PUBLIC_WEB');
  }
});

test('search snippets remain discovery hints and cannot become verified product facts', () => {
  const observations = extractProductObservations({
    html:'<div>Women dresses and household goods</div>',
    source_url:'https://search.example/result/1',
    source_type:'SEARCH_DISCOVERY',
    source_authority:'SEARCH_DISCOVERY',
    captured_at:'2026-08-31T00:00:00.000Z'
  });
  assert.equal(observations.every(item => item.verification_status !== 'VERIFIED'), true);
  assert.equal(observations.every(item => item.source_authority === 'SEARCH_DISCOVERY'), true);
});

test('company name and requested category alone produce no product observation', () => {
  const observations = extractProductObservations({
    html:'<html><head><title>Women Clothing Buyer LLC</title></head><body><h1>Women Clothing Buyer LLC</h1><p>Contact us</p></body></html>',
    source_url:'https://buyer.example/contact',
    source_type:'OFFICIAL_PRODUCT_PAGE',
    source_authority:'OFFICIAL_PRODUCT_PAGE',
    requested_category:'WOMENSWEAR',
    company_name:'Women Clothing Buyer LLC',
    captured_at:'2026-08-31T00:00:00.000Z'
  });
  assert.deepEqual(observations, []);
});
