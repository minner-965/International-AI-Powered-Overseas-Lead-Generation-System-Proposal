import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCategoryProcurementMatch } from '../src/categoryProcurement/categoryProcurementMatch.js';

const observed=(points,maximum,evidence_ids=['synthetic-evidence-1'])=>({state:'OBSERVED',points,maximum,evidence_ids,reason_codes:[]});
const unknown=maximum=>({state:'UNKNOWN',points:null,maximum,evidence_ids:[],reason_codes:['MISSING_EVIDENCE']});

const dimensions=overrides=>({
  target_category_procurement_evidence:unknown(45),
  buyer_business_model_fit:unknown(25),
  assortment_depth:unknown(15),
  external_sourcing_import:unknown(10),
  recent_category_activity:unknown(5),
  ...overrides
});

function calculate(overrides={}){
  return calculateCategoryProcurementMatch({
    company_id:'00000000-0000-4000-8000-000000000010',
    product_profile:'WOMENSWEAR',
    catalog_snapshot:{
      id:'00000000-0000-4000-8000-000000000011',product_profile:'WOMENSWEAR',eligible_product_count:8,
      classified_product_count:8,unknown_product_count:0,snapshot_version:'synthetic-catalog-v1'
    },
    buyer_business_model:{
      id:'00000000-0000-4000-8000-000000000012',buyer_model:'DIRECT_END_BUYER',
      buyer_subtype:'CHAIN_RETAILER',eligibility_status:'ELIGIBLE'
    },
    scope_revision:{id:'00000000-0000-4000-8000-000000000020',approval_status:'APPROVED',effective_from:'2025-01-01T00:00:00.000Z'},
    approved_category_scopes:[{id:'00000000-0000-4000-8000-000000000021',scope_revision_id:'00000000-0000-4000-8000-000000000020',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',scope_status:'ACTIVE'}],
    observed_customer_categories:[{id:'00000000-0000-4000-8000-000000000022',normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',verification_status:'VERIFIED',source_authority:'OFFICIAL'}],
    dimensions:dimensions({
      target_category_procurement_evidence:observed(45,45,['synthetic-category-evidence']),
      buyer_business_model_fit:observed(25,25,['synthetic-buyer-evidence'])
    }),
    ...overrides
  });
}

test('Category Procurement Match weights and band boundaries are frozen',()=>{
  const result=calculate({dimensions:dimensions({
    target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:observed(25,25),
    assortment_depth:observed(15,15),external_sourcing_import:observed(10,10),recent_category_activity:observed(5,5)
  })});
  assert.equal(result.score,100);
  assert.equal(result.coverage_percent,100);
  assert.equal(result.band,'VERY_HIGH');
  for(const [targetPoints,expectedBand] of [[40,'HIGH'],[35,'MEDIUM'],[34,'LOW'],[4,'VERY_LOW']]){
    const boundary=calculate({dimensions:dimensions({
      target_category_procurement_evidence:observed(targetPoints,45),buyer_business_model_fit:observed(25,25)
    })});
    assert.equal(boundary.band,expectedBand);
  }
});

test('direct retailer with official target-category evidence passes at the 70 coverage and 60 score gates',()=>{
  const result=calculate();
  assert.equal(result.score,70);
  assert.equal(result.coverage_percent,70);
  assert.equal(result.band,'HIGH');
  assert.equal(result.match_status,'CATEGORY_MATCH_CONFIRMED');
});

test('eligible distribution buyer passes when category, sourcing and operating evidence satisfy its model gate',()=>{
  const result=calculate({
    buyer_business_model:{
      id:'00000000-0000-4000-8000-000000000013',buyer_model:'DISTRIBUTION_BUYER',buyer_subtype:'IMPORTER',eligibility_status:'ELIGIBLE'
    },
    dimensions:dimensions({
      target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:observed(18,25),
      external_sourcing_import:observed(8,10)
    })
  });
  assert.equal(result.score,71);
  assert.equal(result.coverage_percent,80);
  assert.equal(result.match_status,'CATEGORY_MATCH_CONFIRMED');
});

test('category confirmation is the only category gate and buyer-model detail is non-blocking',()=>{
  const missingCategory=calculate({dimensions:dimensions({
    target_category_procurement_evidence:unknown(45),buyer_business_model_fit:observed(25,25),
    assortment_depth:observed(15,15),external_sourcing_import:observed(10,10),recent_category_activity:observed(5,5)
  })});
  assert.equal(missingCategory.score,null);
  assert.equal(missingCategory.band,'UNKNOWN');
  assert.equal(missingCategory.match_status,'CATEGORY_CONFIRMATION_REQUIRED');

  const missingBuyer=calculate({
    buyer_business_model:{buyer_model:'UNKNOWN',buyer_subtype:'OTHER',eligibility_status:'NEEDS_EVIDENCE'},
    dimensions:dimensions({
      target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:unknown(25),
      assortment_depth:observed(15,15),external_sourcing_import:observed(10,10),recent_category_activity:observed(5,5)
    })
  });
  assert.equal(missingBuyer.score,75);
  assert.equal(missingBuyer.band,'HIGH');
  assert.equal(missingBuyer.match_status,'CATEGORY_MATCH_CONFIRMED');
});

test('confirmed company category is retained even when optional scoring coverage is low',()=>{
  const atGate=calculate({dimensions:dimensions({
    target_category_procurement_evidence:observed(35,45),buyer_business_model_fit:observed(25,25)
  })});
  assert.equal(atGate.score,60);
  assert.equal(atGate.match_status,'CATEGORY_MATCH_CONFIRMED');

  const belowGate=calculate({dimensions:dimensions({
    target_category_procurement_evidence:observed(34,45),buyer_business_model_fit:observed(25,25)
  })});
  assert.equal(belowGate.score,59);
  assert.equal(belowGate.match_status,'CATEGORY_MATCH_CONFIRMED');
});

test('sufficient observed unrelated assortment is PRODUCT_MISMATCH; absence of evidence is not',()=>{
  const mismatch=calculate({dimensions:dimensions({
    target_category_procurement_evidence:observed(0,45,['synthetic-unrelated-assortment']),
    buyer_business_model_fit:observed(25,25)
  }),confirmed_unrelated_assortment:true});
  assert.equal(mismatch.score,25);
  assert.equal(mismatch.match_status,'CATEGORY_MISMATCH');

  const absent=calculate({dimensions:dimensions({
    target_category_procurement_evidence:unknown(45),buyer_business_model_fit:observed(25,25)
  })});
  assert.equal(absent.score,null);
  assert.equal(absent.match_status,'CATEGORY_CONFIRMATION_REQUIRED');
});

test('buyer-model classification does not rewrite company-category confirmation',()=>{
  const unclear=calculate({
    buyer_business_model:{buyer_model:'UNCLEAR_INTERMEDIARY',buyer_subtype:'DISTRIBUTOR',eligibility_status:'NEEDS_EVIDENCE'},
    dimensions:dimensions({target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:unknown(25)})
  });
  assert.equal(unclear.score,45);
  assert.equal(unclear.match_status,'CATEGORY_MATCH_CONFIRMED');

  const excluded=calculate({
    buyer_business_model:{buyer_model:'EXCLUDED_INTERMEDIARY',buyer_subtype:'SOURCING_AGENT',eligibility_status:'INELIGIBLE'},
    dimensions:dimensions({target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:observed(0,25)})
  });
  assert.equal(excluded.match_status,'CATEGORY_MATCH_CONFIRMED');
});

test('internal SKU count and catalog snapshot completeness do not block an approved category scope match',()=>{
  for(const snapshot of [null,{eligible_product_count:0,classified_product_count:0,unknown_product_count:9}]){
    const result=calculate({catalog_snapshot:snapshot});
    assert.equal(result.score,70);
    assert.equal(result.band,'HIGH');
    assert.equal(result.match_status,'CATEGORY_MATCH_CONFIRMED');
    assert.equal(result.catalog_completeness_non_blocking,true);
  }
});

test('no approved DPV scope remains an explicit approval boundary rather than guessed scope',()=>{
  const result=calculate({scope_revision:null,approved_category_scopes:[]});
  assert.equal(result.match_status,'NEEDS_DPV_CATEGORY_SCOPE_APPROVAL');
  assert.equal(result.scope_revision_id,null);
  assert.deepEqual(result.matched_scope_ids,[]);
});

test('requested product categories, Management Match and DPV Score cannot create category facts',()=>{
  const result=calculate({
    dimensions:dimensions({}),
    companies_product_categories:['WOMENSWEAR'],
    management_match_score:100,
    mexico_historical_reference_match:100,
    dpv_score:100
  });
  assert.equal(result.score,null);
  assert.equal(result.match_status,'CATEGORY_CONFIRMATION_REQUIRED');
});
