import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProductOpportunity } from '../src/categoryProcurement/productOpportunity.js';

const product=(index,overrides={})=>({
  id:`00000000-0000-4000-8001-${String(index).padStart(12,'0')}`,
  safe_product_name:`Synthetic Product ${index}`,
  product_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS',
  assignment_status:'CONFIRMED',catalog_status:'CURRENT_CONFIRMED',...overrides
});

const passingMatch={
  id:'00000000-0000-4000-8000-000000000101',company_id:'00000000-0000-4000-8000-000000000102',
  product_profile:'WOMENSWEAR',score:70,coverage_percent:70,match_status:'CATEGORY_PROCUREMENT_MATCH'
};

function calculate(overrides={}){
  return calculateProductOpportunity({
    category_procurement_match:{...passingMatch,observed_categories:['DRESSES'],catalog_snapshot:{unknown_product_count:0}},
    observations:[{normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS',verification_status:'VERIFIED'}],
    products:[product(1),product(2)],
    max_candidates:20,
    ...overrides
  });
}

test('Product Opportunity runs only after Category Procurement Match PASS',()=>{
  for(const match_status of ['NEEDS_PRODUCT_EVIDENCE','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','WEAK_CATEGORY_MATCH','PRODUCT_MISMATCH','INELIGIBLE_BUYER_MODEL']){
    const result=calculate({category_procurement_match:{...passingMatch,score:null,match_status}});
    assert.equal(result.recommendation_status,'NOT_RUN_GATE_FAILED');
    assert.equal(result.candidate_count,0);
    assert.deepEqual(result.candidates,[]);
  }
});

test('READY contains only real classified product_master IDs and never pads fewer than five candidates',()=>{
  const result=calculate({products:[product(1),product(2)]});
  assert.equal(result.recommendation_status,'READY');
  assert.equal(result.candidate_count,2);
  assert.equal(result.candidates.length,2);
  assert.deepEqual(result.candidates.map(row=>row.product_master_id),[product(1).id,product(2).id]);
});

test('zero real candidates is allowed and does not reverse Category Procurement Match PASS',()=>{
  const before=structuredClone(passingMatch);
  const result=calculate({products:[]});
  assert.equal(result.recommendation_status,'NO_REAL_CANDIDATE');
  assert.equal(result.candidate_count,0);
  assert.deepEqual(passingMatch,before);
});

test('UNKNOWN, REVIEW, excluded and cross-profile internal products are never fabricated into candidates',()=>{
  const result=calculate({products:[
    product(1,{assignment_status:'UNKNOWN',normalized_category:null,normalized_subcategory:null}),
    product(2,{assignment_status:'REVIEW'}),
    product(3,{catalog_status:'EXCLUDED'}),
    product(4,{product_profile:'GENERAL_MERCHANDISE'}),
    product(5)
  ]});
  assert.equal(result.candidate_count,1);
  assert.deepEqual(result.candidates.map(row=>row.product_master_id),[product(5).id]);
});

test('Product Opportunity returns at most 20 deterministic candidates with no duplicate product IDs',()=>{
  const products=Array.from({length:25},(_,index)=>product(index+1,{match_strength:100-index}));
  const first=calculate({products});
  const second=calculate({products:[...products].reverse()});
  assert.equal(first.candidates.length,20);
  assert.equal(new Set(first.candidates.map(row=>row.product_master_id)).size,20);
  assert.deepEqual(first.candidates.map(row=>row.product_master_id),second.candidates.map(row=>row.product_master_id));
});

test('incomplete internal catalog yields PARTIAL_INTERNAL_CATALOG without changing customer category facts',()=>{
  const result=calculate({
    category_procurement_match:{...passingMatch,observed_categories:['DRESSES'],catalog_snapshot:{unknown_product_count:6}},
    products:[product(1)]
  });
  assert.equal(result.recommendation_status,'PARTIAL_INTERNAL_CATALOG');
  assert.notEqual(result.recommendation_status,'NOT_RUN_GATE_FAILED');
  assert.ok((result.missing_catalog_evidence||[]).length>0);
});

test('missing MOQ, certification, warehouse, price comparability and currency stay UNKNOWN rather than confirmed gaps',()=>{
  const result=calculate({
    products:[product(1,{moq:null,certifications:null,supplier_price:9,currency:'USD'})],
    observations:[{
      normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS',
      verification_status:'VERIFIED',public_retail_price:200,currency:'MXN',warehouse_information:null
    }]
  });
  for(const gap of result.gaps||[]){
    if(/MOQ|CERTIFICATION|WAREHOUSE|PRICE|CURRENCY/.test(gap.gap_type||gap.dimension||'')) assert.notEqual(gap.gap_status,'CONFIRMED_GAP');
  }
});

test('precise product candidates cannot rescue an excluded buyer model or create new prospect category facts',()=>{
  const excluded=calculate({
    category_procurement_match:{...passingMatch,score:0,match_status:'INELIGIBLE_BUYER_MODEL'},
    products:[product(1,{match_strength:100})]
  });
  assert.equal(excluded.recommendation_status,'NOT_RUN_GATE_FAILED');
  assert.equal(excluded.candidate_count,0);
});
