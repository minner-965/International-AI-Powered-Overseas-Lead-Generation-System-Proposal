import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSupplierAccess,
  resolveProductAccessMatrixV3,
  resolveReadinessV3
} from '../src/categoryProcurement/cooperationV3.js';
import { buildCategoryProcurementWorkItems } from '../src/categoryProcurement/CategoryProcurementService.js';

const accessDimensions=overrides=>({
  external_supplier_openness:{state:'UNKNOWN',maximum:20,evidence_ids:[]},
  supplier_onboarding_accessibility:{state:'UNKNOWN',maximum:20,evidence_ids:[]},
  buying_procurement_accessibility:{state:'UNKNOWN',maximum:20,evidence_ids:[]},
  commercial_operational_feasibility:{state:'UNKNOWN',maximum:20,evidence_ids:[]},
  supplier_lock_in_barrier:{state:'UNKNOWN',maximum:20,evidence_ids:[]},
  ...overrides
});

const readyInput=overrides=>({
  relationship_status:'NEW_PROSPECT',company_verification_status:'VERIFIED',company_lifecycle_status:'ACTIVE',
  eligible_target_organization:true,buyer_model:'DIRECT_END_BUYER',
  category_procurement_match_status:'CATEGORY_PROCUREMENT_MATCH',category_procurement_match_score:70,
  category_procurement_coverage:70,has_verified_decision_route:true,has_current_valid_contact_route:true,
  has_traceable_evidence:true,company_verified_active:true,cooperation_feasibility_band:'MEDIUM',product_opportunity_status:'READY',
  product_opportunity_count:2,...overrides
});
const primary=result=>result.readiness||result.opportunity_readiness;

test('all-unknown Supplier Access publishes NULL/UNKNOWN and zero coverage',()=>{
  const result=calculateSupplierAccess({dimensions:accessDimensions({})});
  assert.equal(result.supplier_access_score,null);
  assert.equal(result.supplier_access_band,'UNKNOWN');
  assert.equal(result.supplier_access_coverage,0);
});

test('Supplier Access is independent from Category Procurement Match and ignores its score',()=>{
  const dimensions=accessDimensions({
    external_supplier_openness:{state:'OBSERVED',points:20,maximum:20,evidence_ids:['synthetic-access-1']},
    supplier_onboarding_accessibility:{state:'OBSERVED',points:15,maximum:20,evidence_ids:['synthetic-access-2']},
    buying_procurement_accessibility:{state:'OBSERVED',points:20,maximum:20,evidence_ids:['synthetic-access-3']},
    commercial_operational_feasibility:{state:'OBSERVED',points:15,maximum:20,evidence_ids:['synthetic-access-4']},
    supplier_lock_in_barrier:{state:'OBSERVED',points:15,maximum:20,evidence_ids:['synthetic-access-5']}
  });
  const lowProduct=calculateSupplierAccess({dimensions,category_procurement_match_score:10});
  const highProduct=calculateSupplierAccess({dimensions,category_procurement_match_score:100});
  assert.deepEqual(lowProduct,highProduct);
  assert.equal(highProduct.supplier_access_band,'HIGH');
});

test('Supplier Access claims without evidence IDs remain UNKNOWN',()=>{
  const result=calculateSupplierAccess({dimensions:accessDimensions({
    external_supplier_openness:{state:'OBSERVED',points:20,maximum:20,evidence_ids:[]},
    supplier_onboarding_accessibility:{state:'OBSERVED',points:20,maximum:20,evidence_ids:[]}
  })});
  assert.equal(result.supplier_access_score,null);
  assert.equal(result.supplier_access_band,'UNKNOWN');
  assert.equal(result.supplier_access_coverage,0);
});

test('Product Access Matrix V3 is deterministic and buyer-model specific',()=>{
  const cases=[
    ['DIRECT_END_BUYER','VERY_HIGH','HIGH','DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS'],
    ['DIRECT_END_BUYER','HIGH','MEDIUM','DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS'],
    ['DIRECT_END_BUYER','HIGH','LOW','DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS'],
    ['DISTRIBUTION_BUYER','VERY_HIGH','HIGH','DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS'],
    ['DISTRIBUTION_BUYER','HIGH','MEDIUM','DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS'],
    ['DISTRIBUTION_BUYER','HIGH','LOW','DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS'],
    ['DIRECT_END_BUYER','MEDIUM','HIGH','MEDIUM_PRODUCT_HIGH_ACCESS'],
    ['DISTRIBUTION_BUYER','MEDIUM','MEDIUM','MEDIUM_PRODUCT_MEDIUM_ACCESS'],
    ['DIRECT_END_BUYER','LOW','HIGH','LOW_PRODUCT'],
    ['UNKNOWN','UNKNOWN','HIGH','UNKNOWN_PRODUCT'],
    ['EXCLUDED_INTERMEDIARY','VERY_HIGH','HIGH','INELIGIBLE_BUYER_MODEL']
  ];
  for(const [buyer_model,category_procurement_match_band,supplier_access_band,expected] of cases){
    assert.equal(resolveProductAccessMatrixV3({buyer_model,category_procurement_match_band,supplier_access_band}),expected);
  }
});

test('equal product/access values preserve DIRECT_END_BUYER priority above DISTRIBUTION_BUYER',()=>{
  const direct=resolveProductAccessMatrixV3({buyer_model:'DIRECT_END_BUYER',category_procurement_match_band:'HIGH',supplier_access_band:'HIGH'});
  const distribution=resolveProductAccessMatrixV3({buyer_model:'DISTRIBUTION_BUYER',category_procurement_match_band:'HIGH',supplier_access_band:'HIGH'});
  assert.equal(direct,'DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS');
  assert.equal(distribution,'DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS');
  assert.notEqual(direct,distribution);
});

test('Readiness V3 follows the frozen precedence and retains every blocker',()=>{
  const result=resolveReadinessV3(readyInput({
    relationship_status:'SUPPRESSED',buyer_model:'EXCLUDED_INTERMEDIARY',eligible_target_organization:false,
    category_procurement_match_status:'NEEDS_INTERNAL_CATALOG_EVIDENCE',category_procurement_match_score:null,
    category_procurement_coverage:0,has_verified_decision_route:false,has_current_valid_contact_route:false,
    has_traceable_evidence:false,cooperation_feasibility_band:'LOW'
  }));
  assert.equal(primary(result),'SUPPRESSED');
  for(const blocker of ['SUPPRESSED','INELIGIBLE_BUYER_MODEL','CATEGORY_CONFIRMATION_REQUIRED','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION']) {
    assert.ok(result.readiness_blockers.includes(blocker),`missing blocker ${blocker}`);
  }
});

test('Readiness V3 primary state follows all ordered gates',()=>{
  const cases=[
    [{relationship_status:'INTERNAL_EXISTING_CUSTOMER'},'EXISTING_CUSTOMER'],
    [{buyer_model:'EXCLUDED_INTERMEDIARY',eligible_target_organization:false,category_procurement_match_status:'INELIGIBLE_BUYER_MODEL'},'INELIGIBLE_BUYER_MODEL'],
    [{relationship_status:'HISTORICAL_CONTACTED_LEAD'},'HISTORICAL_REVIEW'],
    [{category_procurement_match_status:'NEEDS_INTERNAL_CATALOG_EVIDENCE',category_procurement_match_score:null},'CATEGORY_CONFIRMATION_REQUIRED'],
    [{category_procurement_match_status:'NEEDS_PRODUCT_EVIDENCE',category_procurement_match_score:null},'CATEGORY_CONFIRMATION_REQUIRED'],
    [{category_procurement_match_status:'CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE',buyer_model:'UNCLEAR_INTERMEDIARY',category_procurement_match_score:70},'REVIEW'],
    [{category_procurement_match_status:'PRODUCT_MISMATCH',category_procurement_match_score:10},'CATEGORY_MISMATCH'],
    [{category_procurement_match_status:'WEAK_CATEGORY_MATCH',category_procurement_match_score:59},'WEAK_CATEGORY_MATCH'],
    [{has_verified_decision_route:false},'NEEDS_DECISION_MAKER'],
    [{has_current_valid_contact_route:false},'NEEDS_CONTACT_ROUTE'],
    [{has_traceable_evidence:false},'NEEDS_VERIFICATION']
  ];
  for(const [overrides,expected] of cases) assert.equal(primary(resolveReadinessV3(readyInput(overrides))),expected);
});

test('both DIRECT_END_BUYER and DISTRIBUTION_BUYER can become SALES_READY when every independent gate passes',()=>{
  for(const buyer_model of ['DIRECT_END_BUYER','DISTRIBUTION_BUYER']){
    const result=resolveReadinessV3(readyInput({buyer_model}));
    assert.equal(primary(result),'SALES_READY');
  }
});

test('UNKNOWN/UNCLEAR/EXCLUDED buyer models never become SALES_READY even with high scores and contact',()=>{
  for(const buyer_model of ['UNKNOWN','UNCLEAR_INTERMEDIARY','EXCLUDED_INTERMEDIARY']){
    const result=resolveReadinessV3(readyInput({buyer_model}));
    assert.notEqual(primary(result),'SALES_READY');
  }
});

test('zero Product Opportunity candidates leaves Category Match and sales readiness intact',()=>{
  const result=resolveReadinessV3(readyInput({product_opportunity_status:'NO_REAL_CANDIDATE',product_opportunity_count:0}));
  assert.equal(primary(result),'SALES_READY');
  assert.ok(!result.readiness_blockers.includes('NEEDS_PRODUCT_RECOMMENDATION'));
  assert.ok(!result.readiness_blockers.includes('PRODUCT_MISMATCH'));
});

test('Supplier Access state and closed supplier routes no longer block readiness',()=>{
  assert.equal(primary(resolveReadinessV3(readyInput({supplier_access_band:'UNKNOWN',supplier_route_status:'UNKNOWN'}))),'SALES_READY');
  const closed=resolveReadinessV3(readyInput({supplier_route_status:'CLOSED'}));
  assert.equal(primary(closed),'SALES_READY');
  assert.ok(!closed.readiness_blockers.includes('HOLD'));
});

test('score and 70 coverage mandatory gates are both required for SALES_READY',()=>{
  assert.notEqual(primary(resolveReadinessV3(readyInput({category_procurement_match_score:59}))),'SALES_READY');
  assert.notEqual(primary(resolveReadinessV3(readyInput({category_procurement_coverage:69}))),'SALES_READY');
  assert.equal(primary(resolveReadinessV3(readyInput({category_procurement_match_score:60,category_procurement_coverage:70}))),'SALES_READY');
});

test('seven accepted companies produce fourteen unique company/profile V3 work items',()=>{
  const company_ids=Array.from({length:7},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
  const items=buildCategoryProcurementWorkItems({
    company_ids,product_profiles:['WOMENSWEAR','GENERAL_MERCHANDISE'],research_job_id:'00000000-0000-4000-8000-000000000100'
  });
  assert.equal(items.length,14);
  assert.equal(new Set(items.map(item=>`${item.company_id}:${item.product_profile}`)).size,14);
});
