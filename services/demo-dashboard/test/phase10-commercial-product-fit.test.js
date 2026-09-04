import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCommercialProductFitDimensions,calculateCommercialProductFit,
  COMMERCIAL_PRODUCT_FIT_DIMENSIONS,COMMERCIAL_PRODUCT_FIT_VERSION} from '../src/categoryProcurement/commercialProductFit.js';
import {deriveOpportunityDecision} from '../src/phase7/opportunityDecision.js';
import {CategoryProcurementService} from '../src/categoryProcurement/CategoryProcurementService.js';

const id=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const observation=(index,overrides={})=>({id:id(index),normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',
  observation_type:'PRODUCT_CATEGORY',verification_status:'VERIFIED',source_authority:'OFFICIAL_STOREFRONT',
  content_fetched:true,captured_at:'2026-09-01T00:00:00Z',...overrides});

test('Commercial Product Fit uses the six frozen weights and UNKNOWN is not zero',()=>{
  assert.deepEqual(COMMERCIAL_PRODUCT_FIT_DIMENSIONS,{assortment_relevance:25,commercial_positioning_price_band:20,
    attribute_specification_fit:15,moq_order_format_compatibility:15,import_sourcing_model_fit:15,
    recent_product_buying_signal:10});
  const result=calculateCommercialProductFit({product_profile:'WOMENSWEAR',dimensions:{
    assortment_relevance:{state:'OBSERVED',points:20,evidence_ids:[id(1)]}
  }});
  assert.equal(result.commercial_fit_score,80);
  assert.equal(result.commercial_fit_band,'HIGH');
  assert.equal(result.coverage_percent,25);
  assert.equal(result.dimensions.commercial_positioning_price_band.points,null);
  assert.equal(result.dimensions.commercial_positioning_price_band.state,'UNKNOWN');
  assert.equal(result.unknown_dimensions.length,5);
  assert.equal(result.calculation_version,COMMERCIAL_PRODUCT_FIT_VERSION);
});

test('an evidenced mismatch is zero while no evidence produces a null score',()=>{
  const mismatch=calculateCommercialProductFit({product_profile:'WOMENSWEAR',dimensions:{
    assortment_relevance:{state:'OBSERVED',points:0,evidence_ids:[id(1)]}
  }});
  assert.equal(mismatch.commercial_fit_score,0);
  assert.equal(mismatch.coverage_percent,25);
  assert.equal(mismatch.commercial_fit_band,'LOW');
  const unknown=calculateCommercialProductFit({product_profile:'WOMENSWEAR',dimensions:{}});
  assert.equal(unknown.commercial_fit_score,null);
  assert.equal(unknown.commercial_fit_band,'UNKNOWN');
  assert.equal(unknown.coverage_percent,0);
});

test('public facts support assortment, sourcing and recency while absent commercial terms are deferred without enrichment',()=>{
  const dimensions=buildCommercialProductFitDimensions({product_profile:'WOMENSWEAR',
    category_match:{match_status:'CATEGORY_PROCUREMENT_MATCH',match_basis:'EXACT_CATEGORY'},observations:[
      observation(1),observation(2,{observation_type:'PRODUCT_ITEM',raw_product_name:'Linen dress'}),
      observation(3,{observation_type:'IMPORT_ACTIVITY',business_activity_role:'IMPORT'}),
      observation(4,{observation_type:'DISTRIBUTION_NETWORK',business_activity_role:'DISTRIBUTION'})
    ]});
  assert.equal(dimensions.assortment_relevance.state,'OBSERVED');
  assert.equal(dimensions.import_sourcing_model_fit.points,15);
  assert.equal(dimensions.recent_product_buying_signal.state,'OBSERVED');
  for(const key of ['commercial_positioning_price_band','attribute_specification_fit','moq_order_format_compatibility']){
    assert.equal(dimensions[key].state,'UNKNOWN');assert.equal(dimensions[key].points,null);
    assert.match(dimensions[key].reason_codes[0],/_OPTIONAL_UNTIL_INTEREST$/);
  }
  const result=calculateCommercialProductFit({product_profile:'WOMENSWEAR',dimensions});
  assert.deepEqual(result.unknown_dimensions,[]);
  assert.deepEqual(result.deferred_dimensions,['commercial_positioning_price_band','attribute_specification_fit','moq_order_format_compatibility']);
});

test('Commercial Product Fit cannot change recommendation, contact, approval or send gates',()=>{
  const base={company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},
    buyer:{buyer_model:'DIRECT_END_BUYER',eligibility_status:'ELIGIBLE'},
    category:{match_status:'CATEGORY_PROCUREMENT_MATCH',calculation_version:'category-procurement-match-v2',
      scope_revision_id:id(9),match_basis:'EXACT_CATEGORY'},
    cooperation:{opportunity_readiness:'SALES_READY'},relationship_status:'NEW_PROSPECT',
    profile_relevant_buyer_count:1,verified_buyer_role_count:1,active_valid_email_route_count:0};
  const before=deriveOpportunityDecision(base);
  const after=deriveOpportunityDecision({...base,commercial_product_fit:{commercial_fit_score:100,commercial_fit_band:'HIGH',coverage_percent:100}});
  assert.equal(before.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.equal(after.system_recommendation_status,before.system_recommendation_status);
  assert.equal(after.contact_readiness,before.contact_readiness);
  assert.deepEqual(after.reason_codes,before.reason_codes);
});

test('idempotent persistence replay returns the same dimension explanation',async()=>{
  const service=new CategoryProcurementService({pool:{}});
  const client={query:async()=>({rowCount:1,rows:[{id:id(20),category_procurement_match_result_id:id(21),
    product_profile:'WOMENSWEAR',commercial_fit_score:80,commercial_fit_band:'HIGH',coverage_percent:25,
    unknown_dimensions:['commercial_positioning_price_band'],reason_codes:[],calculation_version:COMMERCIAL_PRODUCT_FIT_VERSION}]})};
  try{
    const result=await service.persistCommercialFit(client,{researchJobId:id(22),companyId:id(23),productProfile:'WOMENSWEAR',
      executionKey:'fit:replay',categoryMatch:{id:id(21),match_status:'CATEGORY_PROCUREMENT_MATCH',match_basis:'EXACT_CATEGORY'},
      observations:[observation(1)]});
    assert.equal(result.idempotent_replay,true);
    assert.equal(result.dimensions.assortment_relevance.state,'OBSERVED');
    assert.equal(result.dimensions.commercial_positioning_price_band.state,'UNKNOWN');
  }finally{service.dispose();}
});
