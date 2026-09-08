import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySnapshot} from '../../../scripts/lib/phase13-mc03-classifier.mjs';
test('MC03 article and directory attribution does not prove own operations; clean evidence remains usable',()=>{
  for(const source_url of ['https://example.invalid/blog/article','https://blog.example.invalid/article','https://example.invalid/suppliers/list','https://example.invalid/los-10-mejores','https://2gis.ae/dubai/firm/123']){
    const data=fixture();data.tables.prospect_category_sources[0].source_url=source_url;
    const row=classifySnapshot(data)[0];
    assert.equal(row.new_opportunity_pool_band,'EXPLORATORY',source_url);
    assert.ok(row.notes.some(note=>note.startsWith('BUSINESS_ATTRIBUTION_REVIEW')));
    data.tables.prospect_category_sources.push({id:'clean',source_url:'https://example.invalid/catalog',source_authority:'OFFICIAL',verification_status:'VERIFIED'});
    data.tables.prospect_category_observations.push({...data.tables.prospect_category_observations[0],id:'clean-observation',source_id:'clean'});
    data.tables.companies[0].website_url='https://example.invalid';
    assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
  }
});
test('MC03 audience question is not a company type; credible self-description is independently retained',()=>{
  const data=fixture();data.tables.company_verification_evidence[0].evidence_text='Are you a distributor or brand owner?';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
  data.tables.company_verification_evidence.push({...data.tables.company_verification_evidence[0],id:'own-type',evidence_text:'We wholesale clothing.'});
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
});
function fixture(){return{observed_at:'2026-09-08T00:00:00Z',tables:{companies:[{id:'c',company_name:'Neutral',verification_status:'VERIFIED'}],
  prospect_category_sources:[{id:'s',source_url:'https://example.invalid/catalog',source_authority:'OFFICIAL',verification_status:'VERIFIED'}],
  prospect_category_observations:[{id:'o',company_id:'c',source_id:'s',observation_type:'PRODUCT_CATEGORY',verification_status:'VERIFIED',normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES'}],
  dpv_product_category_scope_current:[{id:'scope',scope_revision_id:'rev',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',approval_status:'APPROVED',effective_from:'2026-01-01'}],
  company_verification_evidence:[{id:'type',company_id:'c',evidence_type:'WHOLESALER',source_type:'OFFICIAL_WEBSITE',source_url:'https://example.invalid/about'}]}};}
test('MC03 exact category without contacts is precision and suppression does not alter business band',()=>{
  const data=fixture();data.tables.company_suppressions=[{company_id:'c',suppression_type:'OPT_OUT'}];
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
  assert.equal(classifySnapshot(data)[0].profile_results.length,2);
});
test('MC03 approved parent relation without a named buyer is relevant',()=>{
  const data=fixture();data.tables.prospect_category_observations[0].normalized_category='APPAREL';
  data.tables.dpv_product_category_scope_aliases=[{scope_id:'scope',scope_revision_id:'rev',normalized_alias:'APPAREL',alias_type:'PARENT',status:'ACTIVE'}];
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'RELEVANT');
});
test('MC03 evidenced general trading is general relevant; company name is not evidence',()=>{
  const data=fixture();data.tables.prospect_category_observations=[];data.tables.company_verification_evidence[0].evidence_type='GENERAL_TRADING';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'GENERAL_RELEVANT');
  data.tables.company_verification_evidence=[];data.tables.companies[0].company_name='Fashion Womenswear General Trading Wholesaler';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
});
test('MC03 unknown category does not imply mismatch and unverified observations cannot upgrade',()=>{
  const data=fixture();data.tables.prospect_category_observations[0].verification_status='REVIEW';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
});
test('MC03 traceable disallowed type excludes but a legacy exclusion label alone does not',()=>{
  const data=fixture();data.tables.companies[0].explicit_exclusion_reason='Old gate missing buyer';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
  data.tables.prospect_category_observations.push({...data.tables.prospect_category_observations[0],id:'negative',observation_type:'INTERMEDIARY_EXCLUSION'});
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'NOT_SUITABLE');
});
test('MC03 official self-description for research or food service defeats extracted third-party product labels',()=>{
  for(const evidence_text of ['Market Research Company, Reports and Consulting Services','We are a manufacturer and distributor of healthy food ingredients.']){
    const data=fixture();data.tables.company_verification_evidence.push({id:'negative',company_id:'c',evidence_type:'COMPANY_IDENTITY',source_type:'OFFICIAL_WEBSITE',source_url:'https://example.invalid/about',evidence_text});
    assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'NOT_SUITABLE');
  }
});
test('MC03 confirmed guide rejection differs from geographic mismatch',()=>{
  const data=fixture();data.tables.companies[0].verification_status='REJECTED';data.tables.companies[0].explicit_exclusion_reason='NOT_A_TARGET_COMPANY_PUBLIC_GUIDE';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'NOT_SUITABLE');
  data.tables.companies[0].explicit_exclusion_reason='MARKET_MISMATCH_US_COMPANY';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
});
test('MC03 exact beats an earlier broad profile independent of row ordering',()=>{
  const data=fixture();data.tables.prospect_category_observations.unshift({...data.tables.prospect_category_observations[0],id:'broad',normalized_category:'WOMENSWEAR'});
  data.tables.dpv_product_category_scope_current.push({...data.tables.dpv_product_category_scope_current[0],id:'broad-scope',normalized_category:'WOMENSWEAR'});
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
  data.tables.prospect_category_observations.reverse();assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'PRECISION');
  data.tables.prospect_category_observations=data.tables.prospect_category_observations.filter(row=>row.id==='broad');
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'RELEVANT');
});
test('MC03 current parent relationship uses cited observations and current approved revision',()=>{
  const data=fixture();data.tables.prospect_category_observations[0].normalized_category='APPAREL';
  data.tables.category_procurement_match_results=[{id:'match',company_id:'c',product_profile:'WOMENSWEAR',match_basis:'SIMILAR_CATEGORY',scope_revision_id:'rev',observed_customer_category_ids:['o'],matched_scope_ids:['scope']}];
  assert.equal(classifySnapshot(data)[0].profile_results[0].category_basis,'SIMILAR_CATEGORY');
  data.tables.dpv_product_category_scope_current[0].effective_to='2026-09-01';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
});
test('MC03 explicit cited mismatch is not overwritten by a matching profile fallback',()=>{
  const data=fixture();data.tables.prospect_category_observations[0].normalized_category='INDUSTRIAL_EQUIPMENT';
  data.tables.category_procurement_match_results=[{id:'mismatch',company_id:'c',product_profile:'WOMENSWEAR',match_basis:'OUT_OF_SCOPE',scope_revision_id:'rev',observed_customer_category_ids:['o'],matched_scope_ids:[]}];
  assert.equal(classifySnapshot(data)[0].profile_results[0].band,'NOT_SUITABLE');
  assert.equal(classifySnapshot(data)[0].profile_results[0].category_basis,'EVIDENCED_OUT_OF_SCOPE');
});
test('MC03 another company source never supports an exact match',()=>{
  const data=fixture();data.tables.prospect_category_sources[0].company_id='other';
  assert.equal(classifySnapshot(data)[0].new_opportunity_pool_band,'EXPLORATORY');
});
