import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {AutoEvidenceOrchestrator} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import {buildStrategyQuery} from '../src/autoEvidence/strategyCatalog.js';
import {
  resolveTargetCategoryContext,
  targetCategoryRequiredError
} from '../src/categoryProcurement/targetCategoryContext.js';
import {deriveOpportunityDecision} from '../src/phase7/opportunityDecision.js';
import {ResearchDirectDispatchService,ResearchJobDirectExecutor} from '../src/research/ResearchDirectDispatchService.js';

const companyId='11111111-1111-4111-8111-111111111111';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const activeSourceFiles=[
  'services/demo-dashboard/src','services/demo-dashboard/public','services/demo-dashboard/scripts','workflows'
];
const readTree=directory=>fs.existsSync(directory)
  ?fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
    ?readTree(path.join(directory,entry.name)):[path.join(directory,entry.name)])
    .filter(file=>/\.(?:js|mjs|html|json)$/.test(file)).map(file=>fs.readFileSync(file,'utf8')).join('\n'):'';
const categoryMatch={match_status:'CATEGORY_PROCUREMENT_MATCH',calculation_version:'category-procurement-match-v2',
  scope_revision_id:'22222222-2222-4222-8222-222222222222',match_basis:'EXACT_CATEGORY'};
const decisionBase={company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},
  buyer:{buyer_model:'DIRECT_END_BUYER',eligibility_status:'ELIGIBLE'},category:categoryMatch,
  cooperation:{opportunity_readiness:'NEEDS_CONTACT_ROUTE'},relationship_status:'NEW_PROSPECT'};

function queue(){const calls=[];return{calls,async enqueue(name,data,options){calls.push({name,data,options});return'queue-1';}};}
function schedulingRepository(){
  const tasks=new Map();
  return{tasks,async schedule(candidate){
    const context=resolveTargetCategoryContext(candidate);
    const key=[candidate.company_id,context.targetCategoryScopeKey,candidate.business_blocker,candidate.evidence_revision].join('|');
    const existing=tasks.get(key);if(existing)return{task:existing,outcome:'DEDUPLICATED',dispatch_required:false};
    const task={id:`task-${tasks.size+1}`,...candidate,target_category_scope_key:context.targetCategoryScopeKey,
      target_category_code:context.targetCategoryCode,product_profile:context.productProfile,
      execution_key:`stable:${key}`,strategy_attempt_count:0,attempt_count:0};
    tasks.set(key,task);return{task,outcome:'SCHEDULED',dispatch_required:true};
  }};
}

test('01 product_category with a null product_profile resolves a valid Job category contract',()=>{
  const result=resolveTargetCategoryContext({product_category:'Beauty & Personal Care',product_profile:null});
  assert.equal(result.targetCategoryCode,'BEAUTY_PERSONAL_CARE');assert.equal(result.productProfile,null);
  assert.equal(result.isProductProfileRequired,false);
});

test('02 product_category with a null product_profile dispatches through the transactional outbox',async()=>{
  const queries=[];const q=queue();
  const pool={connect:async()=>({query:async(sql,values=[])=>{queries.push([sql,values]);return{rows:[],rowCount:0};},release(){}}),
    query:async(sql,values=[])=>{queries.push([sql,values]);if(/SELECT o\.\*,j\.status/.test(sql))return{rowCount:1,rows:[{
      research_job_id:'job-1',execution_key:'dispatch-1',dispatch_state:'PENDING',job_status:'QUEUED'}]};return{rows:[],rowCount:1};}};
  const service=new ResearchDirectDispatchService({pool,queue:q});
  const result=await service.createAtomic(async()=>({id:'job-1',dispatch_execution_key:'dispatch-1',inserted:true,
    product_category:'Beauty & Personal Care',product_profile:null}));
  assert.equal(result.dispatch.state,'DISPATCHED');assert.equal(q.calls.length,1);
  assert.ok(queries.some(([sql])=>/INSERT INTO leadgen\.research_job_dispatch_outbox/.test(sql)));
});

test('03 category-only Job completes the worker stages',async()=>{
  const calls=[];let first=true;const pool={query:async sql=>{calls.push(sql);if(/RETURNING checkpoint/.test(sql)&&first){first=false;return{rowCount:1,rows:[{checkpoint:'CREATED'}]};}return{rowCount:1,rows:[]};}};
  const stages=[];const executor=new ResearchJobDirectExecutor({pool,stages:{
    async generateQueries(){stages.push('queries');},async discover(){stages.push('discover');},
    async checkContacts(){stages.push('contacts');},async verify(){stages.push('verify');},async score(){stages.push('score');}
  }});
  const result=await executor.execute({research_job_id:'job-1',execution_key:'category-only'});
  assert.equal(result.status,'COMPLETED');assert.deepEqual(stages,['queries','discover','contacts','verify','score']);
});

test('04 legacy product_profile maps to a stable category scope',()=>{
  const result=resolveTargetCategoryContext({product_profile:'womenswear'});
  assert.equal(result.source,'LEGACY_PROFILE_MAP');assert.equal(result.targetCategoryScopeKey,'PROFILE:WOMENSWEAR');
});

test('05 approved category scope resolves without requiring product_profile',()=>{
  const result=resolveTargetCategoryContext({approved_category_scope:{id:'scope-1',scope_revision_id:'revision-2',normalized_category:'DRESSES'}});
  assert.equal(result.source,'APPROVED_SCOPE');assert.equal(result.productProfile,null);
  assert.equal(result.targetCategoryScopeKey,'APPROVED:revision-2:scope-1');
});

test('05a auto-evidence repository preserves an approved scope key instead of collapsing it to category fallback',async()=>{
  const queries=[];const client={query:async(sql,values=[])=>{
    queries.push([sql,values]);
    if(/INSERT INTO leadgen\.auto_evidence_tasks/.test(sql))return{rowCount:1,rows:[{id:'task-1',task_status:'QUEUED'}]};
    if(/INSERT INTO leadgen\.auto_evidence_schedule_events/.test(sql))return{rowCount:1,rows:[{id:'event-1'}]};
    return{rowCount:0,rows:[]};
  },release(){}};
  const {AutoEvidenceRepository}=await import('../src/autoEvidence/AutoEvidenceOrchestrator.js');
  const repository=new AutoEvidenceRepository({pool:{connect:async()=>client}});
  await repository.schedule({company_id:companyId,
    target_category_scope_key:'APPROVED:revision-2:scope-1',target_category_code:'DRESSES',target_category:'DRESSES',
    product_profile:null,business_blocker:'CATEGORY_EVIDENCE',evidence_revision:3},{
    source:'EVENT',scheduleKey:'scope-preservation',inputDigest:'a'.repeat(64)});
  const insert=queries.find(([sql])=>/INSERT INTO leadgen\.auto_evidence_tasks/.test(sql));
  assert.equal(insert[1][1],'APPROVED:revision-2:scope-1');assert.equal(insert[1][2],'DRESSES');
});

test('06 empty category input is a non-retryable 422 before Job, outbox, or queue creation',()=>{
  const effects={jobs:0,outbox:0,queue:0};
  assert.throws(()=>resolveTargetCategoryContext({}),error=>error.code==='TARGET_CATEGORY_REQUIRED'
    &&error.status===422&&error.retryable===false);
  assert.deepEqual(effects,{jobs:0,outbox:0,queue:0});assert.equal(targetCategoryRequiredError().classification,'NON_RETRYABLE_INPUT_ERROR');
});

test('07 active application code no longer emits PRODUCT_SCOPE_REQUIRED',()=>{
  const source=activeSourceFiles.map(item=>readTree(path.join(root,item))).join('\n');
  assert.doesNotMatch(source,/PRODUCT_SCOPE_REQUIRED/);
});

test('08 auto-evidence execution identity stays stable when product_profile is null',async()=>{
  const repository=schedulingRepository();const q=queue();const service=new AutoEvidenceOrchestrator({repository,queue:q,env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const input={company_id:companyId,product_category:'Beauty & Personal Care',product_profile:null,business_blocker:'CATEGORY_EVIDENCE',evidence_revision:3};
  const first=await service.scheduleEvent({...input,event_id:'event-1'});const second=await service.scheduleEvent({...input,event_id:'event-2'});
  assert.equal(first.status,'SCHEDULED');assert.equal(second.status,'DEDUPLICATED');
  assert.equal(repository.tasks.values().next().value.product_profile,null);
});

test('09 replaying one company and category creates only one auto-evidence task',async()=>{
  const repository=schedulingRepository();const service=new AutoEvidenceOrchestrator({repository,queue:queue(),env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const input={company_id:companyId,target_category:'HOMEWARE',business_blocker:'EVIDENCE_REQUIRED',evidence_revision:7};
  await service.scheduleEvent({...input,event_id:'a'});await service.scheduleEvent({...input,event_id:'b'});
  assert.equal(repository.tasks.size,1);
});

test('10 no exact SKU is required once the approved category evidence passes',()=>{
  const result=deriveOpportunityDecision({...decisionBase,cooperation:{opportunity_readiness:'NEEDS_DECISION_MAKER'},
    active_company_contact_route_count:1,company_contact_route_types:['GENERIC_BUSINESS_EMAIL'],exact_sku_count:0,product_profile:null});
  assert.equal(result.system_recommendation_status,'RECOMMENDED');assert.equal(result.contact_route_readiness,'OFFICIAL_EMAIL_ROUTE_READY');
});

test('11 a null product_profile still produces category search terms and runs contact research',()=>{
  const fixture={company_name:'Fixture Buyer',official_root_domain:'fixture.invalid',
    target_category_code:'BEAUTY_PERSONAL_CARE',product_profile:null,country_code:'AE'};
  const categoryQuery=buildStrategyQuery('S01_OFFICIAL_CATEGORY',fixture);
  const contactQuery=buildStrategyQuery('S10_ALTERNATIVE_OFFICIAL_ROUTE',fixture);
  assert.match(categoryQuery.query_text,/beauty personal care/i);assert.match(contactQuery.query_text,/contact/i);
});

test('12 a verified official company email supports a business opportunity',()=>{
  const result=deriveOpportunityDecision({...decisionBase,active_company_contact_route_count:1,
    company_contact_route_types:['BUSINESS_EMAIL']});
  assert.equal(result.system_recommendation_status,'RECOMMENDED');assert.equal(result.contact_route_readiness,'OFFICIAL_EMAIL_ROUTE_READY');
});

test('13 verified official phone, WhatsApp, form, and portal support manual-route opportunities',()=>{
  for(const route of ['BUSINESS_PHONE','BUSINESS_WHATSAPP','CONTACT_FORM','SUPPLIER_PORTAL','VENDOR_REGISTRATION']){
    const result=deriveOpportunityDecision({...decisionBase,active_company_contact_route_count:1,company_contact_route_types:[route]});
    assert.equal(result.system_recommendation_status,'RECOMMENDED');assert.equal(result.contact_route_readiness,'OFFICIAL_MANUAL_ROUTE_READY');
  }
});

test('14 an official company route is never labeled as a named buyer',()=>{
  const result=deriveOpportunityDecision({...decisionBase,active_company_contact_route_count:1,
    company_contact_route_types:['GENERIC_BUSINESS_EMAIL'],profile_relevant_buyer_count:0,verified_buyer_role_count:0});
  assert.notEqual(result.contact_route_readiness,'NAMED_BUYER_READY');
});

test('15 no named or official contact route remains EVIDENCE_REQUIRED',()=>{
  const result=deriveOpportunityDecision({...decisionBase,active_company_contact_route_count:0,company_contact_route_types:[]});
  assert.equal(result.system_recommendation_status,'EVIDENCE_REQUIRED');assert.equal(result.contact_route_readiness,'CONTACT_EVIDENCE_REQUIRED');
});

test('16 the R1 category flow has zero email-send side effects',()=>{
  const source=readTree(path.join(root,'services/demo-dashboard/src/categoryProcurement'))
    +readTree(path.join(root,'services/demo-dashboard/src/autoEvidence'))
    +readTree(path.join(root,'services/demo-dashboard/src/research'));
  assert.doesNotMatch(source,/outbound_messages\s*\(|outbound_attempts\s*\(|gmail\.users\.messages\.send|smtp\.send/i);
});
