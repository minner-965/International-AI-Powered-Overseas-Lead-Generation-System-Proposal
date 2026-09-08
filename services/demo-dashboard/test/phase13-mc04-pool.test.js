import test from 'node:test';
import assert from 'node:assert/strict';
import {OpportunityPoolService,projectPoolDecision,publicPoolFields,summarizePoolRows} from '../src/opportunityPool/OpportunityPoolService.js';
import {CategoryProcurementService} from '../src/categoryProcurement/CategoryProcurementService.js';
import {queryCategoryProcurementOpportunities} from '../src/categoryProcurement/opportunitiesRoute.js';
import {ResearchWorkbenchService} from '../src/research/ResearchWorkbenchService.js';
import {readFile} from 'node:fs/promises';

const decision=(band='PRECISION')=>projectPoolDecision({company_id:'c',new_opportunity_pool_band:band,category_basis:'EXACT_CATEGORY',company_type_basis:{suitable_by_evidence:true},notes:['BUSINESS_ATTRIBUTION_REVIEW'],profile_results:[],evidence_references:[]},{contact_readiness:['NO_CONTACT_FOUND'],email_eligibility:{status:'BLOCKED',reason_codes:['NO_CURRENT_VERIFIED_EMAIL'],send_authorized:false}});
test('MC04 approved business bands activate automatically regardless of review or absent email',()=>{
  for(const band of ['PRECISION','RELEVANT','GENERAL_RELEVANT']){
    const row=decision(band);assert.equal(row.is_active_business_opportunity,true);assert.equal(row.email_send_eligibility.send_authorized,false);
    assert.equal(publicPoolFields(row).review_warning,true);
  }
  for(const band of ['EXPLORATORY','NOT_SUITABLE'])assert.equal(decision(band).is_active_business_opportunity,false);
});
test('MC04 summary measures company business pool independently of send/contact state',()=>{
  const rows=[decision(),decision('GENERAL_RELEVANT'),decision('EXPLORATORY')];
  rows[1].contact_readiness_labels=['PHONE_READY'];
  assert.deepEqual(summarizePoolRows(rows),{PRECISION:1,RELEVANT:0,GENERAL_RELEVANT:1,EXPLORATORY:1,NOT_SUITABLE:0,total:3,active:2,active_business_opportunities:2,contact_ready:1,email_ready:0,email_eligible:0});
});
test('MC04 broad scope and equipment or mixed-role warnings never block approved business membership',()=>{
  const row=projectPoolDecision({company_id:'c',new_opportunity_pool_band:'GENERAL_RELEVANT',category_basis:'NO_CURRENT_CATEGORY_EVIDENCE',company_type_basis:{suitable_by_evidence:true},notes:[],profile_results:[],evidence_references:[]},{contact_readiness:['NO_CONTACT_FOUND'],email_eligibility:{send_authorized:false}},
    {tables:{company_verification_evidence:[{company_id:'c',evidence_text:'Refrigeración equipment manufacturing. Are you a distributor?'}]}});
  assert.equal(row.is_active_business_opportunity,true);
  for(const flag of ['BROAD_SCOPE_CATEGORY_REVIEW','BUSINESS_SCOPE_REVIEW','BUSINESS_ATTRIBUTION_REVIEW','MIXED_MANUFACTURING_BUYER_ROLE_REVIEW'])assert.ok(row.review_flags.includes(flag));
});
test('MC04 public projection is additive and never declares mail authorized',()=>{
  const row=publicPoolFields({...decision(),id:'projection',revision:3});
  assert.equal(row.opportunity_pool_decision_id,'projection');assert.equal(row.id,undefined);assert.equal(row.contact_readiness,undefined);
  assert.equal(row.email_eligibility.send_authorized,false);
});
test('MC04 unchanged current replay does not append; A to B to A retains all history',async()=>{
  const history=[];let released=0;
  const client={release(){released++;},async query(sql,args=[]){
    if(sql.startsWith('SELECT *'))return{rows:history.slice(-1)};
    if(sql.startsWith('INSERT')){const row={id:String(history.length+1),company_id:args[0],input_digest:args[3],opportunity_pool_band:args[4]};history.push(row);return{rows:[row]};}
    return{rows:[]};
  }};
  const service=new OpportunityPoolService({pool:{async connect(){return client;}}});
  let band='PRECISION';service.preview=async()=>({observed_at:'2026-09-08T00:00:00Z',rows:[decision(band)],summary:{}});
  assert.equal((await service.refreshAll()).inserted,1);
  assert.equal((await service.refreshAll()).replayed,1);
  band='EXPLORATORY';assert.equal((await service.refreshAll()).inserted,1);
  band='PRECISION';assert.equal((await service.refreshAll()).inserted,1);
  assert.equal(history.length,3);assert.equal(released,4);
});
test('MC04 category assessment refreshes projection after legacy completion including replay',async()=>{
  const calls=[];
  const service=new CategoryProcurementService({pool:{},catalogService:{},opportunityPoolService:{async refreshCompany(id,options){calls.push(['pool',id,options.researchJobId]);return{rows:[decision()]};}}});
  service.calculateLegacyAndPersist=async()=>{calls.push(['legacy']);return{idempotent_replay:true};};
  const result=await service.calculateAndPersist({companyId:'c',researchJobId:'j'});
  assert.deepEqual(calls,[['legacy'],['pool','c','j']]);assert.equal(result.opportunity_pool.is_active_business_opportunity,true);
});
test('MC04 actual opportunity query keeps three bands with no contacts or legacy decisions, including ACTIVE alias',async()=>{
  const bands=['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'];
  const companies=bands.map((band,i)=>({id:`company-${i}`,company_id:`company-${i}`,company_name:`Company ${i}`,country_code:'AE'}));
  const statements=[];
  const pool={async query(sql){statements.push(sql);
    if(sql.includes('to_jsonb(p)'))return{rows:companies.map((c,i)=>({...c,pool_projection:{...decision(bands[i]),id:`pool-${i}`,company_id:c.id,
      profile_results:[{product_profile:'WOMENSWEAR',band:bands[i],category_basis:i===2?'NO_CURRENT_CATEGORY_EVIDENCE':'EXACT_CATEGORY'},
        {product_profile:'GENERAL_MERCHANDISE',band:i===2?'GENERAL_RELEVANT':'EXPLORATORY',category_basis:'NO_CURRENT_CATEGORY_EVIDENCE'}]}}))};
    if(sql.includes('clock_timestamp()'))return{rows:[{observed_at:'2026-09-08T00:00:00Z'}]};
    if(sql.startsWith('SELECT * FROM leadgen.companies')||sql.startsWith('SELECT c.id FROM leadgen.companies'))return{rows:companies};
    return{rows:[]};
  }};
  const options={pool,publicDataOriginSql:"'public_web'",companyMarketVisibleSql:()=> 'TRUE',excludesConfirmedExistingCustomerSql:()=> 'TRUE'};
  for(const query of [{},{status:'ALL',opportunity_pool_band:'ACTIVE'}]){
    const rows=await queryCategoryProcurementOpportunities({...options,query});
    assert.deepEqual(rows.map(r=>r.opportunity_pool_band),bands.slice(0,3));
    assert.ok(rows.every(r=>r.review_warning&&r.is_active_business_opportunity));
    assert.ok(rows.every(r=>r.contact_readiness_labels.includes('NO_CONTACT_FOUND')&&r.email_eligibility.send_authorized===false));
    assert.ok(rows.every(r=>r.email_eligibility.reason_codes.includes('EXISTING_EMAIL_AUTHORIZATION_REQUIRES_EVALUATION')));
    assert.ok(rows.every(r=>r.opportunity_decision_id===null));
  }
  const scoped=await queryCategoryProcurementOpportunities({...options,query:{product_profile:'GENERAL_MERCHANDISE'}});
  assert.deepEqual(scoped.map(row=>row.opportunity_pool_band),['GENERAL_RELEVANT']);
  assert.equal(scoped[0].product_profile,'GENERAL_MERCHANDISE');
  await assert.rejects(queryCategoryProcurementOpportunities({...options,query:{product_profile:'INVALID'}}),{code:'PRODUCT_PROFILE_INVALID'});
  const legacySql=statements.find(sql=>sql.includes('cpm.match_status'));
  assert.doesNotMatch(legacySql,/ORDER BY[^;]* LIMIT \$\d+$/);
  assert.ok(statements.every(sql=>/^\s*SELECT\b/.test(sql)));
});
test('MC04 research summary uses visible current companies and does not equate email ready with email eligible',async()=>{
  const visible={...decision(),company_id:'visible',contact_readiness_labels:['EMAIL_READY']};
  const hidden={...decision('GENERAL_RELEVANT'),company_id:'hidden'};
  const statements=[];
  const service=new ResearchWorkbenchService({pool:{async query(sql){statements.push(sql);return{rows:sql.includes('SELECT c.id')?[{id:'visible'}]:[{active_jobs:0,verified_profile_buyers:0,verified_email_routes:0,contact_ready_opportunities:0}]};}},
    opportunityPoolService:{async list(){return[visible,hidden];}},companyMarketVisibleSql:()=>"c.country_code<>'BD'"});
  service.catalogProfiles=async()=>[];service.budgetState=async()=>({mode:'DISABLED',state:'DISABLED'});service.listTasks=async()=>({total:0,items:[]});
  const result=await service.getSummary();
  assert.equal(result.opportunity_pool.active,1);assert.equal(result.opportunity_pool.email_ready,1);assert.equal(result.opportunity_pool.email_eligible,0);
  assert.equal(result.contact_ready_opportunities,1);assert.equal(result.legacy_first_contact_pending_opportunities,0);
  assert.ok(statements.some(sql=>sql.includes("c.country_code<>'BD'")));
});
test('MC04 research job result decorates independent business/contact/email fields',async()=>{
  const service=new ResearchWorkbenchService({pool:{async query(sql){return{rows:sql.includes('WITH linked_companies')?[{company_id:'c',company_name:'Company',country_code:'AE'}]:[],rowCount:0};}},
    opportunityPoolService:{async decorateRows(rows){return rows.map(row=>({...row,...publicPoolFields(decision())}));}}});
  service.getJob=async()=>({job_id:'j',status:'COMPLETED'});
  const result=await service.getJobResults('j');
  assert.equal(result.items[0].is_active_business_opportunity,true);assert.equal(result.items[0].email_send_eligibility.send_authorized,false);
  assert.equal(result.opportunity_pool.active,1);assert.equal(result.opportunity_pool.email_eligible,0);
  assert.equal(result.items[0].verification_calls,null);assert.equal(result.items[0].queries_executed,null);assert.equal(result.items[0].enrichment_record_present,false);
});
test('MC04 independent assessment and company promotion refresh after persistence without bootstrap',async()=>{
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  for(const [method,reason] of [['calculateCategoryMatchAndPersist','CATEGORY_MATCH_COMMITTED'],['calculateCommercialFitAndPersist','COMMERCIAL_ASSESSMENT_COMMITTED'],['calculateCooperationAndPersist','COOPERATION_ASSESSMENT_COMMITTED']]){
    assert.match(source,new RegExp(`await categoryProcurementService\\.${method}[^\\n]+;\\s+await opportunityPoolService\\.refreshCompany[^\\n]+${reason}`));
  }
  const direct=source.slice(source.indexOf('verify:async jobId=>'),source.indexOf('score:async(jobId'));
  assert.match(direct,/await verifyResearchCandidates[\s\S]+await opportunityPoolService\.refresh[\s\S]+return verified/);
  const endpoint=source.slice(source.indexOf("app.post('/api/internal/research/jobs/:id/verify-companies'"));
  assert.match(endpoint,/verifiedCompanyIds[\s\S]+await opportunityPoolService\.refresh\(\{companyIds:verifiedCompanyIds/);
});
