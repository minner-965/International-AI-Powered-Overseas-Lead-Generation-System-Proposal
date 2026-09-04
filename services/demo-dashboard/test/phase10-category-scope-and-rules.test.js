import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {calculateCategoryProcurementMatch,resolveApprovedCategoryScopeMatch} from '../src/categoryProcurement/categoryProcurementMatch.js';
import {calculateProductOpportunity} from '../src/categoryProcurement/productOpportunity.js';
import {resolveReadinessV3} from '../src/categoryProcurement/cooperationV3.js';
import {buildPhase10RuleDryRun,deriveOpportunityDecision} from '../src/phase7/opportunityDecision.js';
import {CategoryScopeService,validateCategoryScopeDraft} from '../src/categoryProcurement/CategoryScopeService.js';
import {buildPhase10CurrentOpportunityDryRun} from '../src/categoryProcurement/phase10DryRun.js';

const revision={id:'00000000-0000-4000-8000-000000001000',revision:1,approval_status:'APPROVED',effective_from:'2025-01-01T00:00:00.000Z'};
const dresses={id:'00000000-0000-4000-8000-000000001001',scope_revision_id:revision.id,product_profile:'WOMENSWEAR',normalized_category:'DRESSES',scope_status:'ACTIVE'};
const observation=(overrides={})=>({id:'00000000-0000-4000-8000-000000001002',normalized_profile:'WOMENSWEAR',normalized_category:'DRESSES',verification_status:'VERIFIED',source_authority:'OFFICIAL',...overrides});
const observed=(points,maximum,evidence_ids=['00000000-0000-4000-8000-000000001002'])=>({state:'OBSERVED',points,maximum,evidence_ids,reason_codes:[]});
const unknown=maximum=>({state:'UNKNOWN',points:null,maximum,evidence_ids:[],reason_codes:[]});
const dimensions={target_category_procurement_evidence:observed(45,45),buyer_business_model_fit:observed(25,25),assortment_depth:unknown(15),external_sourcing_import:unknown(10),recent_category_activity:unknown(5)};

function match(overrides={}){return calculateCategoryProcurementMatch({product_profile:'WOMENSWEAR',buyer_model:'DIRECT_END_BUYER',dimensions,
  scope_revision:revision,approved_category_scopes:[dresses],observed_customer_categories:[observation()],...overrides});}

test('Phase 10 resolves exact, taxonomy, alias and profile scope in frozen order',()=>{
  assert.equal(resolveApprovedCategoryScopeMatch({product_profile:'WOMENSWEAR',scope_revision:revision,approved_category_scopes:[dresses],observed_customer_categories:[observation()]}).match_basis,'EXACT_CATEGORY');
  const taxonomy=resolveApprovedCategoryScopeMatch({product_profile:'WOMENSWEAR',scope_revision:revision,
    approved_category_scopes:[{...dresses,taxonomy_node_id:'00000000-0000-4000-8000-000000001099'}],
    observed_customer_categories:[observation({normalized_category:'CASUAL_DRESSES',taxonomy_ancestor_ids:['00000000-0000-4000-8000-000000001099']})]});
  assert.equal(taxonomy.match_basis,'SIMILAR_CATEGORY');
  assert.equal(taxonomy.similarity_rule,'APPROVED_TAXONOMY_PARENT_CHILD');
  const alias=resolveApprovedCategoryScopeMatch({product_profile:'WOMENSWEAR',scope_revision:revision,
    approved_category_scopes:[dresses],category_scope_aliases:[{scope_revision_id:revision.id,scope_id:dresses.id,normalized_alias:'WOMENS_DRESS',alias_type:'SYNONYM',status:'ACTIVE'}],
    observed_customer_categories:[observation({normalized_category:'WOMENS_DRESS'})]});
  assert.equal(alias.match_basis,'SIMILAR_CATEGORY');
  assert.equal(alias.similarity_rule,'APPROVED_ALIAS_SYNONYM');
  const profileScope=resolveApprovedCategoryScopeMatch({product_profile:'WOMENSWEAR',scope_revision:revision,
    approved_category_scopes:[dresses],observed_customer_categories:[observation({normalized_category:'LINGERIE'})]});
  assert.equal(profileScope.match_basis,'PROFILE_SCOPE');
});

test('approved Womenswear scope passes with zero internal SKU while missing customer evidence stays unresolved',()=>{
  const result=match({catalog_snapshot:{eligible_product_count:0,classified_product_count:0,unknown_product_count:0}});
  assert.equal(result.match_status,'CATEGORY_MATCH_CONFIRMED');
  assert.equal(result.match_basis,'EXACT_CATEGORY');
  assert.equal(result.catalog_completeness_non_blocking,true);
  const missing=match({observed_customer_categories:[],dimensions:{...dimensions,target_category_procurement_evidence:unknown(45)}});
  assert.equal(missing.match_status,'CATEGORY_CONFIRMATION_REQUIRED');
  assert.equal(missing.score,null);
});

test('irrelevant verified category is CATEGORY_MISMATCH and no approved scope is never guessed',()=>{
  const industrial=match({observed_customer_categories:[observation({normalized_profile:'UNKNOWN',normalized_category:'INDUSTRIAL_EQUIPMENT'})],
    confirmed_unrelated_assortment:true,dimensions:{...dimensions,target_category_procurement_evidence:observed(0,45)}});
  assert.equal(industrial.match_status,'CATEGORY_MISMATCH');
  assert.equal(industrial.match_basis,'OUT_OF_SCOPE');
  const unapproved=match({scope_revision:null,approved_category_scopes:[]});
  assert.equal(unapproved.match_status,'NEEDS_DPV_CATEGORY_SCOPE_APPROVAL');
});

test('category match plus zero SKU is category-only and requires a named or official contact route',()=>{
  const category=match();
  const opportunity=calculateProductOpportunity({category_procurement_match:{...category,id:'00000000-0000-4000-8000-000000001010',product_profile:'WOMENSWEAR'},products:[{
    id:'00000000-0000-4000-8000-000000001011',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',
    normalized_subcategory:'CASUAL_DRESS',assignment_status:'CONFIRMED',catalog_status:'CURRENT_CONFIRMED'
  }],observations:[observation()],catalog_snapshot:{eligible_product_count:1}});
  assert.equal(opportunity.recommendation_status,'CATEGORY_SCOPE_QUALIFIED');
  assert.equal(opportunity.sku_readiness_status,'NO_EXACT_SKU');
  assert.equal(opportunity.candidate_count,0);
  assert.deepEqual(opportunity.candidates,[]);
  assert.equal('catalog_enrichment_required' in opportunity,false);
  assert.ok(opportunity.reason_codes.includes('EXACT_SKU_NOT_REQUIRED'));
  const business=deriveOpportunityDecision({company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},
    buyer:{buyer_model:'DIRECT_END_BUYER',eligibility_status:'ELIGIBLE'},category,
    cooperation:{opportunity_readiness:'NEEDS_DECISION_MAKER',supplier_access_band:'UNKNOWN'},relationship_status:'NEW_PROSPECT'});
  assert.equal(business.business_fit_status,'FIT');
  assert.equal(business.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.ok(business.reason_codes.includes('EVIDENCE_REQUIRED_CONTACT'));
  assert.ok(business.reason_codes.includes('CONTACT_ROUTE_REQUIRED'));
});

test('Hunter UNKNOWN, history and suppression remain hard recommendation gates; Supplier Access UNKNOWN is not',()=>{
  const base={company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},buyer:{buyer_model:'DIRECT_END_BUYER',eligibility_status:'ELIGIBLE'},
    category:match(),cooperation:{opportunity_readiness:'SALES_READY',supplier_access_band:'UNKNOWN'},relationship_status:'NEW_PROSPECT',
    profile_relevant_buyer_count:1,verified_buyer_role_count:1,business_email_route_count:1};
  assert.equal(deriveOpportunityDecision({...base,active_valid_email_route_count:0,email_route_statuses:['UNKNOWN']}).system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.equal(deriveOpportunityDecision({...base,active_valid_email_route_count:1}).system_recommendation_status,'RECOMMENDED');
  assert.notEqual(deriveOpportunityDecision({...base,active_valid_email_route_count:1,relationship_status:'HISTORICAL_CRM_LEAD'}).system_recommendation_status,'RECOMMENDED');
  assert.notEqual(deriveOpportunityDecision({...base,active_valid_email_route_count:1,contact_suppressed:true}).system_recommendation_status,'RECOMMENDED');
  assert.equal(resolveReadinessV3({relationship_status:'NEW_PROSPECT',buyer_model:'DIRECT_END_BUYER',category_procurement_match_status:'CATEGORY_PROCUREMENT_MATCH',
    category_procurement_match_score:70,category_procurement_coverage:70,has_verified_decision_route:true,has_current_valid_contact_route:true,
    company_verified_active:true,eligible_target_organization:true,has_traceable_evidence:true,supplier_access_band:'UNKNOWN',product_opportunity_count:0}).opportunity_readiness,'SALES_READY');
});

test('Phase 10 dry-run exposes old/new category and business differences without mutation',()=>{
  const oldCategory={match_status:'NEEDS_INTERNAL_CATALOG_EVIDENCE'};
  const newCategory=match();const oldDecision={business_fit_status:'EVIDENCE_REQUIRED'};
  const newDecision=deriveOpportunityDecision({company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},buyer:{buyer_model:'DIRECT_END_BUYER',eligibility_status:'ELIGIBLE'},
    category:newCategory,cooperation:{opportunity_readiness:'NEEDS_DECISION_MAKER'},relationship_status:'NEW_PROSPECT'});
  const report=buildPhase10RuleDryRun({company_id:'company-1',product_profile:'WOMENSWEAR',old_category_result:oldCategory,
    new_category_result:newCategory,old_decision:oldDecision,new_decision:newDecision});
  assert.equal(report.old_category_status,'NEEDS_INTERNAL_CATALOG_EVIDENCE');
  assert.equal(report.new_category_status,'CATEGORY_MATCH_CONFIRMED');
  assert.equal(report.new_business_fit,'FIT');
  assert.equal('sku_readiness_status' in report,false);
  assert.equal(report.changed,true);
  assert.deepEqual(oldCategory,{match_status:'NEEDS_INTERNAL_CATALOG_EVIDENCE'});
});

test('legacy internal-catalog uncertainty projects to category confirmation without a catalog task',()=>{
  const result=resolveReadinessV3({relationship_status:'NEW_PROSPECT',buyer_model:'DIRECT_END_BUYER',
    category_procurement_match_status:'NEEDS_INTERNAL_CATALOG_EVIDENCE',category_procurement_match_score:70,
    category_procurement_coverage:70,has_verified_decision_route:true,has_current_valid_contact_route:true,
    company_verified_active:true,eligible_target_organization:true,has_traceable_evidence:true,
    supplier_access_band:'UNKNOWN',product_opportunity_count:0});
  assert.equal(result.opportunity_readiness,'CATEGORY_CONFIRMATION_REQUIRED');
  assert.ok(!result.readiness_blockers.includes('NEEDS_INTERNAL_CATALOG_EVIDENCE'));
  assert.ok(!result.readiness_blockers.includes('NEEDS_PRODUCT_RECOMMENDATION'));
});

test('current-opportunity dry-run uses a read-only transaction and handles an unapproved scope boundary',async()=>{
  const queries=[];
  const client={query:async(sql)=>{
    queries.push(sql);
    if(/to_regclass/.test(sql))return{rows:[{relation:null}]};
    if(/WITH current_match/.test(sql)||/FROM leadgen\.product_master pm/.test(sql))return{rows:[]};
    return{rows:[]};
  },release(){queries.push('RELEASE');}};
  const report=await buildPhase10CurrentOpportunityDryRun({pool:{connect:async()=>client}});
  assert.deepEqual(report,[]);
  assert.equal(queries[0],'BEGIN READ ONLY');
  assert.ok(queries.includes('COMMIT'));
  assert.equal(queries.at(-1),'RELEASE');
  assert.ok(!queries.some(sql=>/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)));
});

test('CategoryScopeService validates factual drafts and contains no automatic approval path',()=>{
  const draft=validateCategoryScopeDraft({revision:1,source_type:'TAXONOMY',source_reference:'taxonomy:v1',source_digest:'a'.repeat(64),actor:'scope.admin',
    scopes:[{client_key:'womenswear',product_profile:'WOMENSWEAR',normalized_category:'WOMENSWEAR',source_fact_digest:'b'.repeat(64)},
      {client_key:'dresses',parent_client_key:'womenswear',product_profile:'WOMENSWEAR',normalized_category:'Dresses',source_fact_digest:'c'.repeat(64)}],
    aliases:[{scope_client_key:'dresses',raw_alias:"Women's dresses",alias_type:'SYNONYM',language:'en'}]});
  assert.equal(draft.scopes[1].normalized_category,'DRESSES');
  assert.equal(draft.aliases[0].alias_type,'SYNONYM');
  assert.throws(()=>validateCategoryScopeDraft({...draft,scopes:[]}),/CATEGORY_SCOPE_FACTS_REQUIRED/);
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const source=fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/CategoryScopeService.js'),'utf8');
  assert.match(source,/VALUES\(\$1,'DRAFT'/);
  assert.match(source,/MANAGEMENT_APPROVAL_REQUIRED/);
  assert.match(source,/VALUES\(\$1,'APPROVED'/);
  assert.doesNotMatch(source,/UPDATE\s+leadgen\.dpv_product_category_scope_revisions/i);
});

test('CategoryScopeService read entry points use the approved boundary views',async()=>{
  const queries=[];const pool={query:async(sql,params)=>{queries.push([sql,params]);return{rows:[],rowCount:0};}};
  const service=new CategoryScopeService({pool});
  assert.deepEqual(await service.listCandidates({product_profile:'WOMENSWEAR'}),[]);
  assert.deepEqual(await service.listRevisions(),[]);
  assert.match(queries[0][0],/dpv_product_category_scope_candidates/);
  assert.match(queries[1][0],/dpv_product_category_scope_revisions/);
});

test('CategoryScopeService createDraft persists only DRAFT scope facts and management role gates approval',async()=>{
  const queries=[];let scopeNumber=0;
  const client={query:async(sql,params=[])=>{queries.push([sql,params]);
    if(/WHERE revision=\$1 AND source_digest=\$2/.test(sql))return{rows:[],rowCount:0};
    if(/INSERT INTO leadgen\.dpv_product_category_scope_revisions/.test(sql))return{rows:[{id:'00000000-0000-4000-8000-000000009000',revision:1,approval_status:'DRAFT'}],rowCount:1};
    if(/INSERT INTO leadgen\.dpv_product_category_scopes/.test(sql))return{rows:[{id:`00000000-0000-4000-8000-${String(++scopeNumber).padStart(12,'0')}`}],rowCount:1};
    return{rows:[],rowCount:0};},release(){}};
  const service=new CategoryScopeService({pool:{connect:async()=>client}});
  const created=await service.createDraft({revision:1,source_type:'TAXONOMY',source_reference:'taxonomy:v1',source_digest:'d'.repeat(64),actor:'scope.admin',
    scopes:[{client_key:'dresses',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',source_fact_digest:'e'.repeat(64)}]});
  assert.equal(created.approval_status,'DRAFT');
  assert.equal(created.scope_count,1);
  assert.ok(queries.some(([sql])=>/VALUES\(\$1,'DRAFT'/.test(sql)));
  await assert.rejects(()=>service.approveRevision({draft_revision_id:'x',revision:2,source_reference:'approval:1',
    source_digest:'f'.repeat(64),actor:'sales.user',actor_role:'SALES'}),/MANAGEMENT_APPROVAL_REQUIRED/);
});

test('CategoryScopeService approval appends a new approved revision and leaves the draft untouched',async()=>{
  const draftId='00000000-0000-4000-8000-000000009100';
  const scopeId='00000000-0000-4000-8000-000000009101';
  const approvedId='00000000-0000-4000-8000-000000009102';
  const queries=[];
  const client={query:async(sql,params=[])=>{queries.push([sql,params]);
    if(/WHERE id=\$1 AND approval_status='DRAFT'/.test(sql))return{rows:[{id:draftId}],rowCount:1};
    if(/WHERE revision=\$1 AND approval_status='APPROVED'/.test(sql))return{rows:[],rowCount:0};
    if(/SELECT s\.\*/.test(sql))return{rows:[{id:scopeId,product_profile:'WOMENSWEAR',normalized_category:'DRESSES',
      parent_scope_id:null,scope_status:'ACTIVE',taxonomy_node_id:null,source_fact_digest:'a'.repeat(64)}],rowCount:1};
    if(/SELECT \* FROM leadgen\.dpv_product_category_scope_aliases/.test(sql))return{rows:[],rowCount:0};
    if(/INSERT INTO leadgen\.dpv_product_category_scope_revisions/.test(sql))return{rows:[{id:approvedId,revision:2,approval_status:'APPROVED',supersedes_revision_id:draftId}],rowCount:1};
    if(/INSERT INTO leadgen\.dpv_product_category_scopes/.test(sql))return{rows:[{id:scopeId}],rowCount:1};
    return{rows:[],rowCount:0};
  },release(){}};
  const service=new CategoryScopeService({pool:{connect:async()=>client}});
  const approved=await service.approveRevision({draft_revision_id:draftId,revision:2,source_reference:'management:approval:2',
    source_digest:'b'.repeat(64),actor:'management.approver',actor_role:'MANAGEMENT_APPROVER',effective_from:'2026-09-01T00:00:00Z'});
  assert.equal(approved.approval_status,'APPROVED');
  assert.equal(approved.supersedes_revision_id,draftId);
  assert.equal(approved.scope_count,1);
  assert.ok(queries.some(([sql])=>/VALUES\(\$1,'APPROVED'/.test(sql)));
  assert.ok(!queries.some(([sql])=>/\bUPDATE\s+leadgen\.dpv_product_category_scope_revisions\b/i.test(sql)));
});
