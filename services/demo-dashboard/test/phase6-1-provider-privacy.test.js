import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TavilySearchProvider } from '../src/search/TavilySearchProvider.js';
import {
  buildCategoryBuyerDiscoveryQueries,
  publicCategoryProcurementProjection
} from '../src/categoryProcurement/CategoryProcurementService.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const canary=Object.freeze({
  product_master_id:'00000000-0000-4000-8000-000000009999',product_name:'PRIVATE_PRODUCT_SENTINEL_9F50',
  supplier_price:999999,supplier_currency:'USD',customer_sales_price:888888,customer_sales_currency:'USD',
  profit:66,margin:77,historical_customer_id:'PRIVATE_CUSTOMER_SENTINEL_9F50',
  historical_order_id:'PRIVATE_ORDER_SENTINEL_9F50',historical_order_lines:[{quantity:777777}],
  source_import_row_id:'PRIVATE_ROW_SENTINEL_9F50',source_identity_key:'PRIVATE_HASH_SENTINEL_9F50',
  shared_folder_path:'D:\\PRIVATE\\SOURCE_SENTINEL_9F50',asset_reference:'D:\\PRIVATE\\ASSET_SENTINEL_9F50',
  internal_description:'PRIVATE_DESCRIPTION_SENTINEL_9F50',raw_internal_payload:'PRIVATE_PAYLOAD_SENTINEL_9F50'
});
const forbiddenKeys=Object.keys(canary).filter(key=>key!=='product_master_id');
const forbiddenValues=Object.entries(canary)
  .filter(([key,value])=>key!=='product_master_id'&&(typeof value==='string'||typeof value==='number'))
  .map(([,value])=>value);

function assertNoCanary(value){
  const serialized=JSON.stringify(value);
  for(const key of forbiddenKeys) assert.equal(serialized.includes(key),false,`leaked key ${key}`);
  for(const forbidden of forbiddenValues) assert.equal(serialized.includes(String(forbidden)),false,`leaked value ${forbidden}`);
}

test('category/buyer discovery queries use only public prospect identity, market language and controlled public terms',()=>{
  const queries=buildCategoryBuyerDiscoveryQueries({
    company:{id:'synthetic-company',company_name:'Synthetic Buyer',official_domain:'buyer.example',country_code:'MX'},
    product_profile:'WOMENSWEAR',market_language:'es',
    public_category_terms:['ropa de mujer','vestidos'],public_business_terms:['tiendas','importador','almacén'],
    internal_products:[canary],historical_orders:[canary],max_queries:4
  });
  assert.ok(queries.length>0&&queries.length<=4);
  assert.match(JSON.stringify(queries),/buyer\.example|Synthetic Buyer/);
  assert.match(JSON.stringify(queries),/ropa de mujer|vestidos|tiendas|importador|almacén/i);
  assertNoCanary(queries);
});

test('Tavily receives an allowlisted payload with zero internal product/customer/order canary leakage',async()=>{
  let captured;
  const provider=new TavilySearchProvider({
    apiKey:'synthetic-key',
    fetchImpl:async(_url,options)=>{
      captured=JSON.parse(options.body);
      return new Response(JSON.stringify({request_id:'synthetic-request',usage:{credits:1},results:[]}),{status:200});
    }
  });
  const [query]=buildCategoryBuyerDiscoveryQueries({
    company:{company_name:'Synthetic Buyer',official_domain:'buyer.example',country_code:'AE'},
    product_profile:'WOMENSWEAR',public_category_terms:['women clothing'],public_business_terms:['stores','retail group'],
    internal_products:[canary],historical_orders:[canary],max_queries:1
  });
  await provider.search({query:query.query||query.query_text||query,count:4,country:'AE'});
  assert.deepEqual(Object.keys(captured).sort(),['auto_parameters','country','include_answer','include_images','include_raw_content','max_results','query','search_depth','topic'].sort());
  assertNoCanary(captured);
});

test('public V3 projection is a strict business-field whitelist',()=>{
  const projected=publicCategoryProcurementProjection({
    id:'synthetic-match',company_id:'synthetic-company',product_profile:'WOMENSWEAR',
    score:82,band:'VERY_HIGH',match_status:'CATEGORY_PROCUREMENT_MATCH',coverage_percent:90,
    buyer_model:'DIRECT_END_BUYER',buyer_subtype:'CHAIN_RETAILER',
    observed_categories:['DRESSES'],supplier_access_band:'MEDIUM',
    product_access_matrix:'DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS',readiness:'NEEDS_DECISION_MAKER',
    readiness_blockers:['NEEDS_DECISION_MAKER'],
    product_opportunity:{id:'synthetic-opportunity',product_profile:'WOMENSWEAR',recommendation_status:'READY',candidate_count:1,candidates:[{
      product_master_id:canary.product_master_id,safe_product_name:'Synthetic Safe Product',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',normalized_subcategory:'CASUAL_DRESS',rank:1,...canary
    }]},
    ...canary
  });
  const serialized=JSON.stringify(projected);
  for(const field of ['category_procurement_match_score','buyer_business_model','product_opportunity','supplier_access_band','product_access_matrix','readiness']) assert.match(serialized,new RegExp(field));
  assertNoCanary(projected);
});

test('V3 provider/service source contains no Hunter or LinkedIn runtime path',()=>{
  const directory=path.join(root,'services/demo-dashboard/src/categoryProcurement');
  assert.equal(fs.existsSync(directory),true,'V3 categoryProcurement module directory must exist');
  const source=fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&entry.name.endsWith('.js'))
    .map(entry=>fs.readFileSync(path.join(directory,entry.name),'utf8')).join('\n');
  assert.doesNotMatch(source,/HunterProvider|api\.hunter\.io|LinkedInDiscoveryAdapter/i);
  if(/linkedin\.com/i.test(source)) assert.match(source,/blockedDomains\s*:\s*\[[^\]]*linkedin\.com/i);
});

test('provider boundary source has no internal product row, price, order or private-path payload keys',()=>{
  const servicePath=path.join(root,'services/demo-dashboard/src/categoryProcurement/CategoryProcurementService.js');
  const source=fs.readFileSync(servicePath,'utf8');
  for(const key of ['supplier_price','customer_sales_price','historical_order_lines','shared_folder_path','raw_internal_payload']) {
    const providerCall=new RegExp(`(?:provider\\.search|searchProvider\\.search)[\\s\\S]{0,800}${key}`,'i');
    assert.doesNotMatch(source,providerCall);
  }
});

test('telemetry and queue payload construction are aggregate/ID-only',()=>{
  const directory=path.join(root,'services/demo-dashboard/src/categoryProcurement');
  const source=fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&entry.name.endsWith('.js'))
    .map(entry=>fs.readFileSync(path.join(directory,entry.name),'utf8')).join('\n');
  assert.doesNotMatch(source,/(?:telemetry|jobPayload|queuePayload)[\s\S]{0,1000}(?:supplier_price|customer_sales_price|historical_order_lines|shared_folder_path|raw_internal_payload)/i);
});

test('all Phase 6.1 test fixtures remain synthetic and contain no non-example web domains',()=>{
  const directory=path.join(root,'services/demo-dashboard/test');
  const source=fs.readdirSync(directory)
    .filter(name=>/^phase6-1-.*\.test\.js$/.test(name))
    .map(name=>fs.readFileSync(path.join(directory,name),'utf8')).join('\n');
  assert.doesNotMatch(source,/https?:\/\/(?![^\s'"`]*(?:\.example|\.test)(?:[\/:]|$)|schema\.org\/)/i);
});
