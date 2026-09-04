import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveResearchTaskType,projectResearchTask,researchTaskPriority,rankCohortCandidate
} from '../src/research/researchTaskProjection.js';
import { decodeCursor,encodeCursor,publicJob,publicJobStatus } from '../src/research/ResearchWorkbenchService.js';

const base={
  opportunity_id:'11111111-1111-4111-8111-111111111111',company_id:'22222222-2222-4222-8222-222222222222',
  company_name:'Fixture Buyer',market:'AE',product_profile:'WOMENSWEAR',reason_codes:[],readiness_blockers:[],
  profile_relevant_buyer_count:0,verified_buyer_role_count:0,business_email_route_count:0,active_valid_email_route_count:0,
  email_route_statuses:[],source_count:2,latest_activity:'2026-08-31T00:00:00Z'
};

test('evidence tasks are deterministic and near-contact-ready work ranks first',()=>{
  const email={...base,profile_relevant_buyer_count:1,verified_buyer_role_count:1,business_email_route_count:1,
    reason_codes:['EVIDENCE_REQUIRED_EMAIL']};
  assert.equal(deriveResearchTaskType(email),'VERIFY_EMAIL');
  assert.equal(researchTaskPriority(email),1);
  const category={...base,reason_codes:['CATEGORY_PROCUREMENT_EVIDENCE_REQUIRED']};
  assert.equal(deriveResearchTaskType(category),'COLLECT_CATEGORY_EVIDENCE');
  assert.equal(researchTaskPriority(category),4);
  assert.ok(projectResearchTask(email).priority<projectResearchTask(category).priority);
});

test('ACCEPT_ALL and UNKNOWN never project as contact-ready work',()=>{
  for(const status of ['ACCEPT_ALL','UNKNOWN']){
    const row={...base,profile_relevant_buyer_count:1,verified_buyer_role_count:1,business_email_route_count:1,
      active_valid_email_route_count:0,email_route_statuses:[status]};
    assert.equal(deriveResearchTaskType(row),'VERIFY_EMAIL');
    assert.equal(projectResearchTask(row).status,'WAITING_EVIDENCE');
  }
});

test('temporary provider error is retryable without becoming invalid',()=>{
  const task=projectResearchTask({...base,email_route_statuses:['TEMPORARY_ERROR']});
  assert.equal(task.task_type,'RETRY_TEMPORARY_PROVIDER_ERROR');
  assert.equal(task.status,'RETRYABLE');
  assert.equal(task.retry_state,'AVAILABLE');
});

test('cohort ranking is task-derived rather than score-derived',()=>{
  const near=rankCohortCandidate({...base,profile_relevant_buyer_count:1,verified_buyer_role_count:1,business_email_route_count:1});
  const early=rankCohortCandidate({...base,company_id:'33333333-3333-4333-8333-333333333333',reason_codes:['BUYER_MODEL_EVIDENCE_REQUIRED']});
  assert.equal(near.cohort_priority,1);
  assert.equal(early.cohort_priority,4);
  assert.match(near.selection_reason,/VERIFY_EMAIL/);
});

test('job status uses deterministic stop codes and public projection excludes private fields',()=>{
  assert.equal(publicJobStatus({status:'FAILED',stop_reason_code:'PROVIDER_TEMPORARY_ERROR_THRESHOLD'}),'FAILED_RETRYABLE');
  assert.equal(publicJobStatus({status:'FAILED',stop_reason_code:'HUNTER_AUTHENTICATION_FAILED'}),'FAILED_FINAL');
  assert.equal(publicJobStatus({status:'PARTIAL'}),'WAITING_EVIDENCE');
  const projected=publicJob({id:'job',status:'FAILED',stop_reason_code:'AUTHENTICATION_FAILED',last_error:'private details',
    job_type:'DECISION_MAKER_ENRICHMENT',country_code:'AE',product_profile:'WOMENSWEAR'});
  assert.equal(projected.status,'FAILED_FINAL');
  for(const forbidden of ['last_error','stop_reason_code','request_digest','idempotency_key'])assert.equal(forbidden in projected,false);
});

test('job progress is derived from the frozen cohort and terminal state',()=>{
  const running=publicJob({id:'running',status:'DISCOVERING',requested_company_ids:['a','b','c','d'],companies_attempted:2});
  assert.equal(running.progress_percent,50);
  const completed=publicJob({id:'complete',status:'COMPLETE',requested_company_ids:['a'],companies_attempted:1,max_results:15});
  assert.equal(completed.progress_percent,100);
});

test('company discovery projects live verification and contact counters',()=>{
  const projected=publicJob({id:'discovery',status:'COMPLETED',job_type:'COMPANY_DISCOVERY',
    candidates_found:3,reachable_candidates:2,candidates_verified:1,candidates_in_review:2,
    candidates_rejected_phase4:0,companies_promoted_new:1,companies_enriched_existing:0,
    public_emails_found:2,public_phones_found:4,public_whatsapp_found:1,contact_forms_found:1});
  assert.equal(projected.websites_found,2);
  assert.equal(projected.verified_companies,1);
  assert.equal(projected.review_required_companies,2);
  assert.equal(projected.companies_inserted,1);
  assert.equal(projected.contacts_found,8);
});

test('cursor contract is bounded and rejects malformed values',()=>{
  const encoded=encodeCursor(42);
  assert.equal(decodeCursor(encoded),42);
  assert.throws(()=>decodeCursor('not-a-cursor'),error=>error.code==='RESEARCH_CURSOR_INVALID'&&error.status===400);
});
