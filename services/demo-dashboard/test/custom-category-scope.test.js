import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeProductObservation,setApprovedCategoryAliases,approvedScopeAliasEntries} from '../src/productMatch/productTaxonomy.js';
import {extractProductObservations} from '../src/productMatch/productObservationExtractor.js';
import {validateCategoryScopeDraft} from '../src/categoryProcurement/CategoryScopeService.js';
import {buildCategoryBuyerDiscoveryQueries} from '../src/categoryProcurement/CategoryEvidenceService.js';
import {searchProductTaxonomy} from '../src/categoryProcurement/productTaxonomyCatalog.js';
import {classifyCompanyBusiness} from '../src/opportunityPool/classifier.js';

const swimwear=[{product_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR',raw_alias:'Bademode',normalized_alias:'BADEMODE',language:'de',alias_type:'SYNONYM'},
  {product_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR',raw_alias:'泳装',normalized_alias:'泳装',language:'zh',alias_type:'SYNONYM'},
  {product_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR',raw_alias:'trajes de baño',normalized_alias:'TRAJES_DE_BAÑO',language:'es',alias_type:'SYNONYM'}];

test('taxonomy subset is the MIT Shopify taxonomy with names in every search language',()=>{
  const license=readFileSync(new URL('../../../rules/product-taxonomy/shopify/LICENSE',import.meta.url),'utf8');
  assert.match(license,/Copyright \(c\) Shopify/);assert.match(license,/Permission is hereby granted, free of charge/);
  const result=searchProductTaxonomy('swimwear',{limit:5});
  assert.equal(result.license,'MIT');assert.ok(result.items.length>0);
  const dresses=searchProductTaxonomy('Kleider').items.find(item=>item.taxonomy_id==='aa-1-4');
  assert.deepEqual(Object.keys(dresses.names).sort(),['de','en','es','fr','it','pt','tr','zh']);
  assert.equal(dresses.suggested_category_code,'DRESSES');assert.equal(dresses.suggested_product_profile,'WOMENSWEAR');
  assert.equal(searchProductTaxonomy('x').items.length,0);
  assert.ok(searchProductTaxonomy('kitchen',{profile:'GENERAL_MERCHANDISE'}).items.every(item=>item.suggested_product_profile==='GENERAL_MERCHANDISE'));
});

test('draft validation accepts the widened alias languages and keeps non-Latin aliases',()=>{
  const draft=validateCategoryScopeDraft({revision:3,source_reference:'test',source_digest:'a'.repeat(64),actor:'simon',
    scopes:[{client_key:'s',product_profile:'WOMENSWEAR',normalized_category:'Swimwear',source_fact_digest:'b'.repeat(64)}],
    aliases:['de','fr','pt','it','tr','ar','zh'].map((language,index)=>({scope_client_key:'s',raw_alias:['Bademode','maillots de bain','moda praia','costumi da bagno','mayo','ملابس السباحة','泳装'][index],language}))});
  assert.equal(draft.scopes[0].normalized_category,'SWIMWEAR');
  assert.deepEqual(draft.aliases.map(a=>a.normalized_alias),['BADEMODE','MAILLOTS_DE_BAIN','MODA_PRAIA','COSTUMI_DA_BAGNO','MAYO','ملابس_السباحة','泳装']);
  assert.throws(()=>validateCategoryScopeDraft({revision:1,source_reference:'x',source_digest:'a'.repeat(64),actor:'s',
    scopes:[{client_key:'s',product_profile:'WOMENSWEAR',normalized_category:'X',source_fact_digest:'b'.repeat(64)}],
    aliases:[{scope_client_key:'s',raw_alias:'x',language:'ja'}]}),{code:'CATEGORY_SCOPE_ALIAS_LANGUAGE_INVALID'});
});

test('approved scope aliases extend the classifier so a new category creates observations',()=>{
  setApprovedCategoryAliases([]);
  assert.equal(normalizeProductObservation({raw_category:'Bademode'}).assignment_status,'UNKNOWN');
  setApprovedCategoryAliases(swimwear);
  try{
    const german=normalizeProductObservation({raw_category:'Bademode Kollektion'});
    assert.equal(german.normalized_profile,'WOMENSWEAR');assert.equal(german.normalized_category,'SWIMWEAR');assert.equal(german.assignment_status,'CONFIRMED');
    assert.equal(normalizeProductObservation({raw_product_name:'女士泳装'}).normalized_category,'SWIMWEAR');
    assert.equal(normalizeProductObservation({raw_category:'swimwear'}).normalized_category,'SWIMWEAR');
    // Built-in categories keep their dictionary behaviour.
    assert.equal(normalizeProductObservation({raw_product_name:'maxi dress'}).normalized_subcategory,'MAXI_DRESS');
    const html=`<html><body><div class="product-card"><h3>Bademode Riviera</h3><span class="category">Bademode</span></div></body></html>`;
    const [observation]=extractProductObservations({html,source_url:'https://shop.example/bademode',source_authority:'OFFICIAL_STOREFRONT'});
    assert.equal(observation.normalized_category,'SWIMWEAR');assert.equal(observation.verification_status,'VERIFIED');
  }finally{setApprovedCategoryAliases([]);}
  assert.ok(approvedScopeAliasEntries([{product_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR'}]).some(e=>e.alias==='SWIMWEAR'));
  assert.equal(approvedScopeAliasEntries([{product_profile:'WOMENSWEAR',normalized_category:'DRESSES'}]).length,0);
});

test('category evidence queries lead with the specific category and its aliases; profile terms only supplement',()=>{
  const company={company_name:'Strand GmbH',official_root_domain:'strand.example',country_code:'DE'};
  const queries=buildCategoryBuyerDiscoveryQueries({company,product_profile:'WOMENSWEAR',max_queries:4,
    target_category:{code:'SWIMWEAR',aliases:['Bademode','swimwear']}});
  assert.deepEqual(queries.slice(0,2).map(q=>q.query_text),['site:strand.example swimwear','site:strand.example Bademode']);
  assert.ok(queries.some(q=>/women clothing/.test(q.query_text)));
  const profileOnly=buildCategoryBuyerDiscoveryQueries({company,product_profile:'WOMENSWEAR',max_queries:4,target_category:{code:'WOMENSWEAR'}});
  assert.equal(profileOnly[0].query_text,'site:strand.example women clothing');
});

test('opportunity pool: a new category observation is an exact category match; a similar alias match is RELEVANT',()=>{
  const company={id:'c1',company_name:'Strand GmbH',website_url:'https://strand.example',verification_status:'VERIFIED',country_code:'DE'};
  const source={id:'s1',company_id:'c1',source_url:'https://strand.example/bademode',verification_status:'VERIFIED',source_authority:'OFFICIAL_STOREFRONT'};
  const scope={id:'scope-swim',scope_revision_id:'r2',product_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR',approval_status:'APPROVED',scope_status:'ACTIVE',effective_from:'2026-01-01T00:00:00Z'};
  const observation=(id,fields)=>({id,company_id:'c1',source_id:'s1',source_authority:'OFFICIAL_STOREFRONT',verification_status:'VERIFIED',captured_at:'2026-10-01T00:00:00Z',...fields});
  const tables={prospect_category_sources:[source],dpv_product_category_scope_current:[scope],
    dpv_product_category_scope_aliases:[{scope_id:'scope-swim',scope_revision_id:'r2',normalized_alias:'BEACHWEAR',alias_type:'SIMILAR',status:'ACTIVE'}],
    prospect_category_observations:[observation('o-retail',{observation_type:'RETAIL_CHANNEL',normalized_profile:'WOMENSWEAR',evidence_text:'our stores'})]};
  const exact=classifyCompanyBusiness(company,{tables:{...tables,prospect_category_observations:[...tables.prospect_category_observations,
    observation('o1',{observation_type:'PRODUCT_CATEGORY',normalized_profile:'WOMENSWEAR',normalized_category:'SWIMWEAR',raw_category:'Bademode'})]}});
  assert.equal(exact.new_opportunity_pool_band,'PRECISION');assert.equal(exact.active_opportunity_pool,'YES');
  const similar=classifyCompanyBusiness(company,{tables:{...tables,prospect_category_observations:[...tables.prospect_category_observations,
    observation('o2',{observation_type:'PRODUCT_CATEGORY',normalized_profile:'UNKNOWN',normalized_category:null,raw_category:'Beachwear'})]}});
  assert.equal(similar.new_opportunity_pool_band,'RELEVANT');assert.equal(similar.category_basis,'SIMILAR_CATEGORY');
});
