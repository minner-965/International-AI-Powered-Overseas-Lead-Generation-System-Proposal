import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifySnapshot} from '../src/opportunityPool/classifier.js';
import {classifySnapshotV2,operatingSignalStrength,OPPORTUNITY_POOL_V2_VERSION} from '../src/opportunityPool/classifierV2.js';
import {buildComparison,renderMarkdown,storedMismatch} from '../scripts/compare-opportunity-pool.mjs';

const SITE='https://shop.example.invalid';
function fixture({type='WHOLESALER',category='DRESSES',status='VERIFIED'}={}){
  return{observed_at:'2026-10-26T00:00:00Z',tables:{
    companies:[{id:'c',company_name:'Neutral Trading',country_code:'AE',website_url:SITE,verification_status:status}],
    prospect_category_sources:[{id:'s',source_url:`${SITE}/catalog`,source_authority:'OFFICIAL',verification_status:'VERIFIED'}],
    prospect_category_observations:category?[{id:'o',company_id:'c',source_id:'s',observation_type:'PRODUCT_CATEGORY',verification_status:'VERIFIED',normalized_profile:'WOMENSWEAR',normalized_category:category,evidence_text:'Dresses collection'}]:[],
    dpv_product_category_scope_current:[
      {id:'scope',scope_revision_id:'rev',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',approval_status:'APPROVED',effective_from:'2026-01-01'},
      {id:'gm',scope_revision_id:'rev',product_profile:'GENERAL_MERCHANDISE',normalized_category:'HOUSEHOLD_GOODS',approval_status:'APPROVED',effective_from:'2026-01-01'}],
    company_verification_evidence:type?[{id:'type',company_id:'c',evidence_type:type,source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/about`,evidence_text:'We are a trading company.'}]:[]}};
}
const operating=(id,observation_type,evidence_text)=>({id,company_id:'c',source_id:'s',observation_type,verification_status:'VERIFIED',normalized_profile:'WOMENSWEAR',evidence_text});
const band=(rows)=>rows[0].new_opportunity_pool_band;

test('V2 keeps v1 PRECISION and RELEVANT results when category and buyer-type evidence exist',()=>{
  const data=fixture();
  assert.equal(band(classifySnapshot(data)),'PRECISION');
  assert.equal(band(classifySnapshotV2(data)),'PRECISION');
  assert.equal(classifySnapshotV2(data)[0].rule_version,OPPORTUNITY_POOL_V2_VERSION);
  data.tables.prospect_category_observations[0].normalized_category='WOMENSWEAR';
  data.tables.dpv_product_category_scope_current.push({id:'profile',scope_revision_id:'rev',product_profile:'WOMENSWEAR',normalized_category:'WOMENSWEAR',approval_status:'APPROVED',effective_from:'2026-01-01'});
  assert.equal(band(classifySnapshot(data)),'RELEVANT');
  assert.equal(band(classifySnapshotV2(data)),'RELEVANT');
});

test('V2 GENERAL_RELEVANT requires category evidence: broad general trading alone becomes EXPLORATORY',()=>{
  const data=fixture({type:'GENERAL_TRADING',category:null});
  assert.equal(band(classifySnapshot(data)),'GENERAL_RELEVANT');
  const row=classifySnapshotV2(data)[0];
  assert.equal(row.new_opportunity_pool_band,'EXPLORATORY');
  assert.equal(row.active_opportunity_pool,'NO');
  assert.ok(row.v2_changes.includes('BROAD_SIGNAL_WITHOUT_CATEGORY_EVIDENCE'));
  // With an approved category observation the broad company stays GENERAL_RELEVANT (no buyer type needed).
  const withCategory=fixture({type:'GENERAL_TRADING'});
  assert.equal(band(classifySnapshot(withCategory)),'GENERAL_RELEVANT');
  assert.equal(band(classifySnapshotV2(withCategory)),'GENERAL_RELEVANT');
});

test('V2 explicit general-merchandise description on own pages supports the general merchandise profile only',()=>{
  const data=fixture({type:'GENERAL_TRADING',category:null});
  data.tables.company_verification_evidence.push({id:'desc',company_id:'c',evidence_type:'COMPANY_IDENTITY',source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/about`,evidence_text:'We distribute household goods and general merchandise across the GCC.'});
  const row=classifySnapshotV2(data)[0];
  assert.equal(row.new_opportunity_pool_band,'GENERAL_RELEVANT');
  assert.equal(row.category_basis,'GENERAL_MERCHANDISE_DESCRIPTION');
  assert.equal(row.profile_results.find(item=>item.product_profile==='WOMENSWEAR').band,'EXPLORATORY');
  // The same words inside third-party market-research text are not a description of the company.
  data.tables.company_verification_evidence[1].evidence_text='According to market research, household goods demand is projected to grow.';
  assert.equal(band(classifySnapshotV2(data)),'EXPLORATORY');
  // Another company's domain never counts.
  data.tables.company_verification_evidence[1]={...data.tables.company_verification_evidence[1],evidence_text:'general merchandise',source_url:'https://other.example.invalid/about'};
  assert.equal(band(classifySnapshotV2(data)),'EXPLORATORY');
});

test('operating signal strength: bare navigation words are weak, quantity or own context restores them',()=>{
  assert.equal(operatingSignalStrength({observation_type:'STORE_NETWORK',evidence_text:'HOME ABOUT STORE LOCATIONS SELECT COUNTRY CONTACT'}),'WEAK_ONLY');
  assert.equal(operatingSignalStrength({observation_type:'STORE_NETWORK',evidence_text:'Visit any of our 25 locations in Dubai'}),'QUANTIFIED');
  assert.equal(operatingSignalStrength({observation_type:'STORE_NETWORK',evidence_text:'Find our locations across the UAE'}),'CONTEXTUAL');
  assert.equal(operatingSignalStrength({observation_type:'STORE_NETWORK',evidence_text:'Store locator | branches'}),'STRONG');
  assert.equal(operatingSignalStrength({observation_type:'RETAIL_CHANNEL',evidence_text:'Menu Shop online Cart'}),'WEAK_ONLY');
  assert.equal(operatingSignalStrength({observation_type:'WAREHOUSE_INVENTORY',evidence_text:'Ver inventario'}),'WEAK_ONLY');
  assert.equal(operatingSignalStrength({observation_type:'WAREHOUSE_INVENTORY',evidence_text:'Contamos con nuestro inventario propio'}),'CONTEXTUAL');
  assert.equal(operatingSignalStrength({observation_type:'RETAIL_CHANNEL',evidence_text:'We supply retail stores and boutiques across the GCC'}),'CUSTOMER_DESCRIPTION');
  assert.equal(operatingSignalStrength({observation_type:'RETAIL_CHANNEL',evidence_text:'Visit our stores in Dubai Mall'}),'STRONG');
  assert.equal(operatingSignalStrength({observation_type:'IMPORT_ACTIVITY',evidence_text:'we import'}),'OTHER');
});

test('V2 weak navigation word no longer proves buyer type; a quantified store network still does',()=>{
  const data=fixture({type:null});
  data.tables.prospect_category_observations.push(operating('nav','STORE_NETWORK','HOME ABOUT STORE LOCATIONS SELECT COUNTRY'));
  assert.equal(band(classifySnapshot(data)),'PRECISION');
  const row=classifySnapshotV2(data)[0];
  assert.equal(row.new_opportunity_pool_band,'EXPLORATORY');
  assert.ok(row.notes.includes('WEAK_NAVIGATION_SIGNAL_NOT_COUNTED'));
  assert.ok(row.notes.includes('BUYER_TYPE_EVIDENCE_INCOMPLETE'));
  data.tables.prospect_category_observations.push(operating('real','STORE_NETWORK','We operate more than 40 stores across the UAE'));
  assert.equal(band(classifySnapshotV2(data)),'PRECISION');
});

test('V2 retail chain: own store network plus approved category is a valid buyer type; beauty leftovers do not count',()=>{
  const data=fixture({type:null});
  data.tables.company_verification_evidence.push({id:'chain',company_id:'c',evidence_type:'LOCATIONS',source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/stores`,evidence_text:'A department store group with 32 stores across the region.'});
  assert.equal(band(classifySnapshot(data)),'EXPLORATORY');
  const row=classifySnapshotV2(data)[0];
  assert.equal(row.new_opportunity_pool_band,'PRECISION');
  assert.equal(row.company_type_basis.company_type,'RETAIL_CHAIN');
  assert.ok(row.v2_changes.includes('RETAIL_CHAIN_BUYER_TYPE_BY_STORE_NETWORK_AND_CATEGORY'));
  data.tables.company_verification_evidence[0]={...data.tables.company_verification_evidence[0],evidence_text:'Our 12 salons and pharmacies'};
  assert.equal(band(classifySnapshotV2(data)),'EXPLORATORY');
  // Store network without approved category evidence is not enough.
  const noCategory=fixture({type:null,category:null});
  noCategory.tables.company_verification_evidence.push({id:'chain',company_id:'c',evidence_type:'LOCATIONS',source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/stores`,evidence_text:'A department store group with 32 stores.'});
  assert.equal(band(classifySnapshotV2(noCategory)),'EXPLORATORY');
});

test('V2 does not bypass identity verification: unverified retail chain is only flagged; rejected is not flagged',()=>{
  const data=fixture({type:null,status:'REVIEW'});
  data.tables.company_verification_evidence.push({id:'chain',company_id:'c',evidence_type:'LOCATIONS',source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/stores`,evidence_text:'Retail chain with 18 stores in Mexico.'});
  const row=classifySnapshotV2(data)[0];
  assert.equal(row.new_opportunity_pool_band,'EXPLORATORY');
  assert.equal(row.retail_chain_blocked_by_verification,true);
  assert.ok(row.notes.includes('IDENTITY_VERIFICATION_INCOMPLETE'));
  data.tables.companies[0].verification_status='REJECTED';
  assert.equal(classifySnapshotV2(data)[0].retail_chain_blocked_by_verification,false);
});

test('V2 keeps v1 explicit exclusions',()=>{
  const data=fixture();
  data.tables.prospect_category_observations.push({...data.tables.prospect_category_observations[0],id:'neg',observation_type:'INTERMEDIARY_EXCLUSION'});
  assert.equal(band(classifySnapshotV2(data)),'NOT_SUITABLE');
});

test('comparison: counts, transition matrix, plain-Chinese reasons and stored mismatch',()=>{
  const data=fixture({type:'GENERAL_TRADING',category:null});
  data.tables.companies.push({id:'d',company_name:'Dress Wholesale',country_code:'MX',website_url:SITE,verification_status:'VERIFIED'});
  data.tables.prospect_category_observations.push({id:'od',company_id:'d',source_id:'s',observation_type:'PRODUCT_CATEGORY',verification_status:'VERIFIED',normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES'});
  data.tables.company_verification_evidence.push({id:'td',company_id:'d',evidence_type:'WHOLESALER',source_type:'OFFICIAL_WEBSITE',source_url:`${SITE}/about`,evidence_text:'We wholesale clothing.'});
  const result=buildComparison(data);
  assert.equal(result.total,2);
  assert.equal(result.counts.old.GENERAL_RELEVANT,1);
  assert.equal(result.counts.new.EXPLORATORY,1);
  assert.equal(result.matrix.GENERAL_RELEVANT.EXPLORATORY,1);
  assert.equal(result.matrix.PRECISION.PRECISION,1);
  assert.equal(result.changed.length,1);
  assert.equal(result.changed[0].company_name,'Neutral Trading');
  assert.equal(result.changed[0].country,'阿拉伯联合酋长国');
  assert.match(result.changed[0].reason,/类目/);
  assert.match(result.changed[0].evidence,/trading company/);
  const mismatch=storedMismatch(result,[{company_id:'c',opportunity_pool_band:'GENERAL_RELEVANT'},{company_id:'d',opportunity_pool_band:'RELEVANT'}]);
  assert.deepEqual(mismatch,{mismatches:[{company_id:'d',stored:'RELEVANT',recomputed:'PRECISION'}],missing:0});
  const markdown=renderMarkdown(result,{storedCounts:{GENERAL_RELEVANT:1,RELEVANT:1},mismatch});
  assert.match(markdown,/泛相关 → 待研究/);
  assert.match(markdown,/保存结果与现场重算不一致 1 家/);
  assert.match(markdown,/零售连锁因企业核验未通过而未进池/);
  assert.doesNotMatch(markdown,/undefined|NaN/);
});

test('V2 classifier is not wired into the live opportunity pool service',()=>{
  const service=fs.readFileSync(new URL('../src/opportunityPool/OpportunityPoolService.js',import.meta.url),'utf8');
  assert.doesNotMatch(service,/classifierV2/);
  const script=fs.readFileSync(new URL('../scripts/compare-opportunity-pool.mjs',import.meta.url),'utf8');
  assert.match(script,/default_transaction_read_only=on/);
  assert.match(script,/BEGIN READ ONLY/);
  assert.doesNotMatch(script,/\b(?:INSERT|UPDATE|DELETE)\s/);
});
