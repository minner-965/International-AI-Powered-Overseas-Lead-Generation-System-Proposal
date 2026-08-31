import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBuyerBusinessModel } from '../src/categoryProcurement/buyerBusinessModel.js';

const evidence=(observation_type,overrides={})=>({
  id:`synthetic-${observation_type.toLowerCase()}-${overrides.sequence||1}`,
  observation_type,
  source_authority:'OFFICIAL',
  verification_status:'VERIFIED',
  normalized_profile:'WOMENSWEAR',
  evidence_text:`Synthetic ${observation_type.toLowerCase()} evidence`,
  ...overrides
});

function classify(observations,overrides={}){
  return classifyBuyerBusinessModel({
    company:{id:'00000000-0000-4000-8000-000000000001',company_name:'Synthetic Buyer Company',...overrides.company},
    product_profile:'WOMENSWEAR',
    observations,
    ...overrides
  });
}

test('organized chain retailer with sustained target-category retail evidence is DIRECT_END_BUYER P1',()=>{
  const result=classify([
    evidence('RETAIL_CHANNEL',{buyer_subtype:'CHAIN_RETAILER'}),
    evidence('STORE_NETWORK'),
    evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'}),
    evidence('PRODUCT_ITEM',{normalized_profile:'WOMENSWEAR',sequence:2})
  ]);
  assert.equal(result.buyer_model,'DIRECT_END_BUYER');
  assert.equal(result.buyer_subtype,'CHAIN_RETAILER');
  assert.equal(result.eligibility_status,'ELIGIBLE');
  assert.equal(result.priority_tier,'P1_DIRECT');
});

test('department store and supermarket/lifestyle chain are direct buyers only with relevant category evidence',()=>{
  for(const subtype of ['DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET','LIFESTYLE_RETAILER']){
    const result=classify([
      evidence('RETAIL_CHANNEL',{buyer_subtype:subtype}),
      evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'})
    ]);
    assert.equal(result.buyer_model,'DIRECT_END_BUYER');
    assert.equal(result.buyer_subtype,subtype);
  }
});

test('importer needs both procurement/import and stock/B2B/distribution evidence',()=>{
  const complete=classify([
    evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'}),
    evidence('IMPORT_ACTIVITY'),
    evidence('DISTRIBUTION_NETWORK'),
    evidence('WHOLESALE_ACTIVITY')
  ],{company:{organization_type:'IMPORTER'}});
  assert.equal(complete.buyer_model,'DISTRIBUTION_BUYER');
  assert.equal(complete.buyer_subtype,'IMPORTER');
  assert.equal(complete.priority_tier,'P2_DISTRIBUTION');

  const missingOperations=classify([
    evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'}),evidence('IMPORT_ACTIVITY')
  ],{company:{organization_type:'IMPORTER'}});
  assert.equal(missingOperations.buyer_model,'UNCLEAR_INTERMEDIARY');
  assert.equal(missingOperations.eligibility_status,'NEEDS_EVIDENCE');
});

test('wholesaler needs warehouse, wholesale catalog or network evidence in addition to target-category sourcing',()=>{
  const result=classify([
    evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'}),
    evidence('IMPORT_ACTIVITY'),evidence('WAREHOUSE_INVENTORY'),evidence('WHOLESALE_ACTIVITY')
  ],{company:{organization_type:'WHOLESALER'}});
  assert.equal(result.buyer_model,'DISTRIBUTION_BUYER');
  assert.equal(result.buyer_subtype,'WHOLESALER');
});

test('trading/distributor name, directory label or self-claim alone remains UNCLEAR_INTERMEDIARY',()=>{
  for(const facts of [
    {intermediary_label_present:true,unclear_subtype:'GENERAL_TRADING'},
    {intermediary_label_present:true,unclear_subtype:'DISTRIBUTOR'},
    {intermediary_label_present:true,unclear_subtype:'WHOLESALER'}
  ]){
    const result=classifyBuyerBusinessModel({facts:{
      target_category_confirmed:false,organized_own_retail_confirmed:false,procurement_import_confirmed:false,
      inventory_distribution_confirmed:false,exclusion_confirmed:false,evidence_ids:[],...facts
    }});
    assert.equal(result.buyer_model,'UNCLEAR_INTERMEDIARY');
    assert.equal(result.eligibility_status,'NEEDS_EVIDENCE');
    assert.equal(result.priority_tier,'REVIEW');
  }
});

test('sourcing agent and broker remain excluded even with many target-category pages',()=>{
  for(const subtype of ['SOURCING_AGENT','BROKER']){
    const result=classify([
      evidence('INTERMEDIARY_EXCLUSION',{buyer_subtype:subtype}),
      ...Array.from({length:6},(_,index)=>evidence('PRODUCT_ITEM',{normalized_profile:'WOMENSWEAR',sequence:index+1}))
    ]);
    assert.equal(result.buyer_model,'EXCLUDED_INTERMEDIARY');
    assert.equal(result.buyer_subtype,subtype);
    assert.equal(result.eligibility_status,'INELIGIBLE');
    assert.equal(result.priority_tier,'EXCLUDED');
  }
});

test('OEM-only producer without external buying is excluded from the new-customer PASS pool',()=>{
  const result=classify([
    evidence('INTERMEDIARY_EXCLUSION',{buyer_subtype:'OEM_ONLY',reason_code:'OEM_ONLY_NO_EXTERNAL_BUYING'}),
    evidence('PRODUCT_CATEGORY',{normalized_profile:'WOMENSWEAR'})
  ]);
  assert.equal(result.buyer_model,'EXCLUDED_INTERMEDIARY');
  assert.equal(result.buyer_subtype,'OEM_ONLY');
  assert.equal(result.eligibility_status,'INELIGIBLE');
});

test('general-trading company name is REVIEW/UNCLEAR, while requested categories and search hints cannot make it eligible',()=>{
  const result=classify([],{
    company:{company_name:'Synthetic General Trading',product_categories:['WOMENSWEAR']},
    search_hints:[{title:'Synthetic wholesaler womenswear'}]
  });
  assert.equal(result.buyer_model,'UNCLEAR_INTERMEDIARY');
  assert.notEqual(result.eligibility_status,'ELIGIBLE');
});
