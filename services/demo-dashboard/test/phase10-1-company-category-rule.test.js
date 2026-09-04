import assert from 'node:assert/strict';
import test from 'node:test';

import {calculateCategoryProcurementMatch} from '../src/categoryProcurement/categoryProcurementMatch.js';
import {buildCategoryBuyerDiscoveryQueries} from '../src/categoryProcurement/CategoryEvidenceService.js';
import {buildStrategyQuery} from '../src/autoEvidence/strategyCatalog.js';

const revision={id:'10000000-0000-4000-8000-000000000001',approval_status:'APPROVED',effective_from:'2025-01-01T00:00:00.000Z'};
const scope=(category,profile='WOMENSWEAR')=>({id:`scope-${category}`,scope_revision_id:revision.id,product_profile:profile,normalized_category:category,scope_status:'ACTIVE'});
const evidence=(category,overrides={})=>({id:`evidence-${category}`,normalized_profile:'WOMENSWEAR',normalized_category:category,
  observation_type:'PRODUCT_CATEGORY',verification_status:'VERIFIED',source_authority:'OFFICIAL',...overrides});
function evaluate({category='DRESSES',target='DRESSES',profile='WOMENSWEAR',observations,productProfile=profile,...rest}={}){
  const rows=observations===undefined?[evidence(category,{normalized_profile:profile})]:observations;
  return calculateCategoryProcurementMatch({product_profile:productProfile,target_category_code:target,scope_revision:revision,
    approved_category_scopes:[scope(target,profile)],observed_customer_categories:rows,observations:rows,...rest});
}

test('B02 official Dresses page confirms the target category',()=>{
  assert.equal(evaluate().category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 official Homeware page confirms the target category',()=>{
  assert.equal(evaluate({category:'HOMEWARE',target:'HOMEWARE',profile:'GENERAL_MERCHANDISE'}).category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 category match needs no procurement page',()=>{
  const result=evaluate({observations:[evidence('DRESSES',{source_authority:'OFFICIAL_STOREFRONT'})]});
  assert.equal(result.category_confirmation_status,'MATCH_CONFIRMED');
  assert.equal(result.category_confirmation_reason,'TARGET_CATEGORY_MATCH');
});

test('B02 absence of supplier portal has no effect',()=>{
  assert.equal(evaluate({supplier_portal:false}).category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 absence of procurement announcement has no effect',()=>{
  assert.equal(evaluate({procurement_announcement:false}).category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 absence of exact SKU has no effect',()=>{
  assert.equal(evaluate({exact_sku_count:0}).category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 product_profile remains optional',()=>{
  const result=evaluate({productProfile:null});
  assert.equal(result.product_profile_optional,true);
  assert.equal(result.category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 explicit evidence that the company does not operate the category confirms mismatch',()=>{
  assert.equal(evaluate({category:'INDUSTRIAL_EQUIPMENT',confirmed_category_mismatch:true}).category_confirmation_status,'MISMATCH_CONFIRMED');
});

test('B02 insufficient evidence is match not confirmed with the required wording',()=>{
  const result=evaluate({observations:[]});
  assert.equal(result.category_confirmation_status,'MATCH_NOT_CONFIRMED');
  assert.equal(result.category_confirmation_message,'尚未确认该公司经营目标类目');
});

test('B02 credible directory evidence must link to the official company identity',()=>{
  const unlinked=evaluate({observations:[evidence('DRESSES',{source_authority:'CREDIBLE_PUBLIC_DIRECTORY',official_identity_linked:false})]});
  const linked=evaluate({observations:[evidence('DRESSES',{source_authority:'CREDIBLE_PUBLIC_DIRECTORY',official_identity_linked:true})]});
  assert.equal(unlinked.category_confirmation_status,'MATCH_NOT_CONFIRMED');
  assert.equal(linked.category_confirmation_status,'MATCH_CONFIRMED');
});

test('B02 category queries exclude procurement-route terms while contact queries retain Buyer job titles',()=>{
  const company={company_name:'Fixture Retailer',official_root_domain:'fixture.example',country_code:'AE'};
  const queries=buildCategoryBuyerDiscoveryQueries({company,product_profile:'WOMENSWEAR',max_queries:8});
  assert.ok(queries.length>0);
  assert.doesNotMatch(JSON.stringify(queries),/procurement|purchasing plan|supplier onboarding|vendor registration|tender|\brfp\b|\brfq\b|supplier portal/i);
  for(const code of ['S01_OFFICIAL_CATEGORY','S02_OFFICIAL_ASSORTMENT','S05_OFFICIAL_PRESS_PDF']){
    assert.doesNotMatch(buildStrategyQuery(code,{...company,target_category_code:'DRESSES'}).query_text,/procurement|supplier portal|vendor registration|tender|\brfp\b|\brfq\b/i);
  }
  assert.match(buildStrategyQuery('S04_OFFICIAL_LEADERSHIP',{...company,target_category_code:'DRESSES'}).query_text,/buyer|purchasing manager|procurement manager/i);
});
