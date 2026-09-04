import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateProductOpportunity,publicProductOpportunityProjection} from '../src/categoryProcurement/productOpportunity.js';

const passingMatch={
  id:'00000000-0000-4000-8000-000000000101',company_id:'00000000-0000-4000-8000-000000000102',
  product_profile:'WOMENSWEAR',score:70,coverage_percent:70,match_status:'CATEGORY_PROCUREMENT_MATCH',
  scope_revision_id:'00000000-0000-4000-8000-000000000103',
  matched_scope_ids:['00000000-0000-4000-8000-000000000104']
};

const productMasterCandidate={
  id:'00000000-0000-4000-8000-000000000201',safe_product_name:'Internal Dress Style',
  product_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS',
  assignment_status:'CONFIRMED',catalog_status:'CURRENT_CONFIRMED'
};

test('Product Opportunity runs only after Category Procurement Match PASS',()=>{
  for(const match_status of ['CATEGORY_CONFIRMATION_REQUIRED','NEEDS_PRODUCT_EVIDENCE','WEAK_CATEGORY_MATCH','CATEGORY_MISMATCH','PRODUCT_MISMATCH','INELIGIBLE_BUYER_MODEL']){
    const result=calculateProductOpportunity({category_procurement_match:{...passingMatch,score:null,match_status}});
    assert.equal(result.recommendation_status,'NOT_RUN_GATE_FAILED');
    assert.equal(result.candidate_count,0);
    assert.deepEqual(result.candidates,[]);
    assert.equal(result.sku_readiness_status,['CATEGORY_MISMATCH','PRODUCT_MISMATCH'].includes(match_status)?'OUT_OF_SCOPE':'NO_EXACT_SKU');
  }
});

test('approved category scope creates a category-level opportunity with no exact SKU candidate',()=>{
  const result=calculateProductOpportunity({category_procurement_match:passingMatch});
  assert.equal(result.recommendation_status,'CATEGORY_SCOPE_QUALIFIED');
  assert.equal(result.category_procurement_match_status,'CATEGORY_MATCH_CONFIRMED');
  assert.equal(result.sku_readiness_status,'NO_EXACT_SKU');
  assert.equal(result.candidate_count,0);
  assert.deepEqual(result.candidates,[]);
  assert.deepEqual(result.reason_codes,['APPROVED_CATEGORY_SCOPE_QUALIFIED','EXACT_SKU_NOT_REQUIRED']);
  assert.equal('catalog_enrichment_required' in result,false);
  assert.deepEqual(result.missing_catalog_evidence,[]);
});

test('product_master rows never enter a new-prospect category opportunity',()=>{
  const before=structuredClone(productMasterCandidate);
  const result=calculateProductOpportunity({
    category_procurement_match:passingMatch,
    products:[productMasterCandidate],
    observations:[{normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS'}],
    catalog_snapshot:{eligible_product_count:1,classified_product_count:1,unknown_product_count:0}
  });
  assert.equal(result.candidate_count,0);
  assert.deepEqual(result.candidates,[]);
  assert.deepEqual(productMasterCandidate,before);
});

test('product files, historical SKU order and candidate limit do not affect category-level result or digest',()=>{
  const first=calculateProductOpportunity({category_procurement_match:passingMatch,products:[productMasterCandidate],max_candidates:20});
  const second=calculateProductOpportunity({category_procurement_match:passingMatch,products:[],max_candidates:0,
    observations:[{normalized_category:'OTHER'}]});
  assert.equal(first.input_digest,second.input_digest);
  assert.deepEqual(first.candidates,second.candidates);
  assert.equal(first.candidate_count,0);
});

test('precise product candidates never rescue an excluded or unresolved category result',()=>{
  for(const match_status of ['INELIGIBLE_BUYER_MODEL','NEEDS_PRODUCT_EVIDENCE','PRODUCT_MISMATCH']){
    const result=calculateProductOpportunity({category_procurement_match:{...passingMatch,match_status},products:[productMasterCandidate]});
    assert.equal(result.recommendation_status,'NOT_RUN_GATE_FAILED');
    assert.equal(result.candidate_count,0);
    assert.deepEqual(result.candidates,[]);
  }
});

test('public Product Opportunity projection never exposes legacy SKU candidates',()=>{
  const projected=publicProductOpportunityProjection({id:'legacy-opportunity',product_profile:'WOMENSWEAR',
    recommendation_status:'READY',candidate_count:2,sku_readiness_status:'SKU_READY',
    candidates:[{product_master_id:'legacy-product',safe_product_name:'Legacy Style'}],reason_codes:['LEGACY']});
  assert.equal(projected.recommendation_status,'CATEGORY_SCOPE_QUALIFIED');
  assert.equal('candidate_count' in projected,false);
  assert.equal('candidates' in projected,false);
  assert.equal('sku_readiness_status' in projected,false);
});
