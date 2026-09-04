import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {applyPhase7Migration,PHASE10_CATEGORY_SCOPE_MIGRATION_KEY,
  PHASE10_AUDIT_HARDENING_MIGRATION_KEY,PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY,
  PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY,PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY,
  PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY,PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY,
  PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY,PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY,
  PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY,PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY,
  PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY,PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY,
  PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY,
  PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY,
  PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY,PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY,
  PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY,
  PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY} from '../src/phase7/migrationRunner.js';

const root=process.env.DPV_PROJECT_ROOT
  ? path.resolve(process.env.DPV_PROJECT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const serviceRoot=process.env.DPV_PROJECT_ROOT
  ? root
  : path.join(root,'services/demo-dashboard');
const migrationPath=path.join(root,'database/migrations',PHASE10_CATEGORY_SCOPE_MIGRATION_KEY);
const sql=fs.readFileSync(migrationPath,'utf8');
const auditMigrationPath=path.join(root,'database/migrations',PHASE10_AUDIT_HARDENING_MIGRATION_KEY);
const auditSql=fs.readFileSync(auditMigrationPath,'utf8');
const categoryOpportunityMigrationPath=path.join(root,'database/migrations',PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY);
const categoryOpportunitySql=fs.readFileSync(categoryOpportunityMigrationPath,'utf8');
const runner=fs.readFileSync(path.join(serviceRoot,'src/phase7/migrationRunner.js'),'utf8');
const liveDatabaseUrl=process.env.PHASE10_TEST_DATABASE_URL||'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

test('030 is transactional, additive, repeat-safe and never seeds an approved category scope',()=>{
  assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+leadgen\.dpv_product_category_scope/i);
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\.(?:category_procurement_match_results|product_opportunity_results|business_opportunity_decision_snapshots)/i);
  assert.match(sql,/dpv_product_category_scope_candidates/);
  assert.match(sql,/'DRAFT'::text approval_boundary/);
  assert.match(sql,/DROP CONSTRAINT IF EXISTS category_procurement_match_results_phase10_v2_contract_check/);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS idx_dpv_category_scope_alias_identity/);
});

test('030 separates approved scope, category match and SKU readiness with append-only lineage',()=>{
  for(const table of ['dpv_product_category_scope_revisions','dpv_product_category_scopes','dpv_product_category_scope_aliases',
    'category_procurement_match_scope_links'])assert.match(sql,new RegExp(`leadgen\\.${table}`));
  for(const field of ['scope_revision_id','match_basis','matched_scope_ids','observed_customer_category_ids',
    'similarity_rule','catalog_completeness_non_blocking'])assert.match(sql,new RegExp(field));
  for(const basis of ['EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE','AMBIGUOUS_SCOPE','OUT_OF_SCOPE'])assert.match(sql,new RegExp(`'${basis}'`));
  for(const field of ['sku_readiness_status','catalog_enrichment_required','category_scope_match_result_id'])assert.match(sql,new RegExp(field));
  for(const status of ['SKU_READY','SKU_PARTIAL','NO_EXACT_SKU','INTERNAL_CATALOG_UPLOAD_REQUIRED','OUT_OF_SCOPE'])assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/prevent_phase10_append_only_mutation/);
});

test('030 persists automatic evidence lifecycle, dual ResearchJob lineage and immutable events',()=>{
  for(const table of ['auto_evidence_tasks','auto_evidence_task_attempts','auto_evidence_schedule_events','human_evidence_exceptions'])assert.match(sql,new RegExp(`leadgen\\.${table}`));
  for(const field of ['category_research_job_id','contact_research_job_id','research_job_id','business_blocker',
    'technical_blocker','retry_at','attempt_count','budget_state','last_evidence_revision','input_digest'])assert.match(sql,new RegExp(field));
  for(const status of ['QUEUED','RUNNING','RETRY_SCHEDULED','EVIDENCE_EXHAUSTED','TEMPORARY_PROVIDER_ERROR','HUMAN_REVIEW_REQUIRED','BUDGET_PAUSED','COMPLETED'])assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/CATEGORY_PROCUREMENT_ENRICHMENT/);
  assert.match(sql,/DECISION_MAKER_ENRICHMENT/);
  assert.match(sql,/REAL_OPPORTUNITY_RESEARCH/);
  assert.match(sql,/UNIQUE \(company_id,product_profile,business_blocker,evidence_revision\)/);
  assert.match(sql,/UNIQUE \(task_id,attempt_number,stage,event_type\)/);
});

test('explicit migration runner applies Phase 10 migrations in order through category-driven context',()=>{
  assert.match(runner,/030_phase10_category_scope_and_auto_evidence\.sql/);
  assert.equal(PHASE10_AUDIT_HARDENING_MIGRATION_KEY,'031_phase10_controlled_evidence_audit_hardening.sql');
  assert.match(runner,/verifyPhase10CategoryScopeMigration/);
  assert.match(runner,/verifyPhase10AuditHardeningMigration/);
  assert.match(runner,/phase10MigrationPath/);
  assert.ok(runner.indexOf('categoryScope=await applyPhase7Migration')>runner.indexOf('realOpportunity=await applyPhase7Migration'));
  assert.ok(runner.indexOf('phase10Audit=await applyPhase7Migration')>runner.indexOf('categoryScope=await applyPhase7Migration'));
  assert.equal(PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY,'046_phase10_empty_research_job_purge_audit.sql');
  assert.equal(PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY,'047_phase10_retire_internal_tavily_enforcement.sql');
  assert.equal(PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY,'048_phase10_category_driven_context.sql');
  assert.ok(runner.indexOf('phase10EmptyResearchPurgeAudit=await applyPhase7Migration')>runner.indexOf('phase10ProviderAccountState=await applyPhase7Migration'));
  assert.ok(runner.indexOf('phase10RetireInternalTavilyEnforcement=await applyPhase7Migration')>runner.indexOf('phase10EmptyResearchPurgeAudit=await applyPhase7Migration'));
  assert.ok(runner.indexOf('phase10CategoryDrivenContext=await applyPhase7Migration')>runner.indexOf('phase10RetireInternalTavilyEnforcement=await applyPhase7Migration'));
  assert.match(runner,/status:phase10CategoryDrivenContext\.status/);
});

test('048 moves automatic evidence identity to target category scope while preserving legacy profile metadata',()=>{
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY),'utf8');
  assert.match(migration,/target_category_scope_key/);
  assert.match(migration,/target_category_code/);
  assert.match(migration,/UNIQUE \(company_id,target_category_scope_key,business_blocker,evidence_revision\)/);
  assert.match(migration,/ALTER COLUMN product_profile DROP NOT NULL/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});

test('033 adds heartbeat and dispatch diagnostics after 032 without business-status expansion',()=>{
  assert.equal(PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY,'033_phase10_orchestrator_heartbeat_and_dispatch_diagnostics.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY),'utf8');
  assert.match(migration,/leadgen\.orchestrator_heartbeats/);
  for(const state of ['PENDING','DISPATCHED','ORCHESTRATOR_UNAVAILABLE','WORKFLOW_INACTIVE','WEBHOOK_AUTH_FAILED','QUEUE_UNAVAILABLE'])
    assert.match(migration,new RegExp(`'${state}'`));
  const service=fs.readFileSync(path.join(serviceRoot,'src/orchestration/OrchestratorHealthService.js'),'utf8');
  assert.match(service,/FOR UPDATE SKIP LOCKED/i);
  assert.doesNotMatch(migration,/ALTER TYPE|DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.ok(runner.indexOf('phase10OrchestratorDiagnostics=await applyPhase7Migration')>runner.indexOf('phase10CategoryOpportunity=await applyPhase7Migration'));
});

test('034 adds one atomic ResearchJob dispatch outbox after 033',()=>{
  assert.equal(PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY,'034_phase10_research_direct_queue_outbox.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY),'utf8');
  assert.match(migration,/leadgen\.research_job_dispatch_outbox/);
  assert.match(migration,/UNIQUE \(research_job_id\)/);assert.match(migration,/UNIQUE \(execution_key\)/);
  assert.match(migration,/trg_research_jobs_dispatch_execution_key/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10ResearchDirectQueue=await applyPhase7Migration')>runner.indexOf('phase10OrchestratorDiagnostics=await applyPhase7Migration'));
});

test('035 makes provider usage events the canonical ResearchJob usage projection after 034',()=>{
  assert.equal(PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY,'035_phase10_provider_usage_projection.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY),'utf8');
  for(const field of ['provider_call_count','provider_completed_count','provider_not_found_count',
    'provider_temporary_error_count','reserved_units','used_units','released_units','last_provider_event_at'])
    assert.match(migration,new RegExp(field));
  assert.match(migration,/research_job_company_provider_usage_summary/);
  assert.match(migration,/provider_usage_projection_reconciliation_runs/);
  assert.doesNotMatch(migration,/UPDATE\s+leadgen\.provider_usage_events/i);
  assert.ok(runner.indexOf('phase10ProviderUsageProjection=await applyPhase7Migration')>runner.indexOf('phase10ResearchDirectQueue=await applyPhase7Migration'));
});

test('036 enables the canonical provider-usage Excel dataset after 035',()=>{
  assert.equal(PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY,'036_phase10_provider_usage_export_contract.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY),'utf8');
  assert.match(migration,/RESEARCH_JOB_PROVIDER_USAGE/);
  assert.match(migration,/data_export_jobs_export_type_check/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10ProviderUsageExport=await applyPhase7Migration')>runner.indexOf('phase10ProviderUsageProjection=await applyPhase7Migration'));
});

test('037 separates strategy, provider and worker retries without rewriting the append-only ledger',()=>{
  assert.equal(PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY,'037_phase10_auto_evidence_strategy_attempts.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY),'utf8');
  for(const field of ['strategy_code','strategy_version','strategy_attempt_number','query_fingerprint','locale','source_class',
    'new_url_count','usable_evidence_count','named_buyer_candidate_count','valid_contact_count',
    'provider_retry_count','worker_retry_count','started_at','finished_at','terminal_reason'])assert.match(migration,new RegExp(field));
  assert.match(migration,/max_attempts=10/);assert.match(migration,/strategy_state='READY'/);
  assert.doesNotMatch(migration,/UPDATE\s+leadgen\.auto_evidence_task_attempts/i);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10AutoEvidenceStrategy=await applyPhase7Migration')>runner.indexOf('phase10ProviderUsageExport=await applyPhase7Migration'));
});

test('038 makes a budget checkpoint replay distinct without consuming another strategy',()=>{
  assert.equal(PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY,'038_phase10_auto_evidence_checkpoint_replay.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY),'utf8');
  assert.match(migration,/checkpoint_replay_count/);assert.match(migration,/uq_auto_evidence_attempts_strategy_event/);
  assert.doesNotMatch(migration,/UPDATE\s+leadgen\.auto_evidence_task_attempts|DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10AutoEvidenceCheckpoint=await applyPhase7Migration')>runner.indexOf('phase10AutoEvidenceStrategy=await applyPhase7Migration'));
});

test('039 separates Tavily pools and persists fair scheduling counters',()=>{
  assert.equal(PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY,'039_phase10_tavily_fair_budget.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY),'utf8');
  for(const field of ['budget_pool','product_profile','fairness_round_number','last_strategy_started_at',
    'strategy_duplicate_prevented_count'])assert.match(migration,new RegExp(field));
  assert.match(migration,/'DISCOVERY','EVIDENCE'/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10TavilyFairBudget=await applyPhase7Migration')>
    runner.indexOf('phase10AutoEvidenceCheckpoint=await applyPhase7Migration'));
});

test('040 adds append-only Commercial Product Fit without product candidates or eligibility gates',()=>{
  assert.equal(PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY,'040_phase10_commercial_product_fit.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY),'utf8');
  for(const name of ['commercial_product_fit_results','commercial_product_fit_dimensions','commercial_product_fit_evidence',
    'commercial_product_fit_current'])assert.match(migration,new RegExp(name));
  for(const dimension of ['ASSORTMENT_RELEVANCE','COMMERCIAL_POSITIONING_PRICE_BAND','ATTRIBUTE_SPECIFICATION_FIT',
    'MOQ_ORDER_FORMAT_COMPATIBILITY','IMPORT_SOURCING_MODEL_FIT','RECENT_PRODUCT_BUYING_SIGNAL'])assert.match(migration,new RegExp(dimension));
  assert.match(migration,/coverage_percent/);assert.match(migration,/unknown_dimensions/);assert.match(migration,/append-only non-blocking commercial ranking/i);
  assert.doesNotMatch(migration,/product_opportunity_candidates|outreach|management_approval|send_permission/i);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10CommercialProductFit=await applyPhase7Migration')>
    runner.indexOf('phase10TavilyFairBudget=await applyPhase7Migration'));
});

test('041 adds the append-only manual official procurement route queue without send or approval bypasses',()=>{
  assert.equal(PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY,'041_phase10_manual_official_route_queue.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY),'utf8');
  for(const name of ['official_route_manual_tasks','official_route_manual_task_current','MANUAL_OFFICIAL_ROUTE_READY',
    'source_id','verified_at','owner_identity','manual_action_status','outcome'])assert.match(migration,new RegExp(name));
  for(const routeType of ['SUPPLIER_PORTAL','VENDOR_REGISTRATION','CONTACT_FORM','PROCUREMENT_DEPARTMENT_EMAIL','PROCUREMENT_DEPARTMENT_PHONE'])
    assert.match(migration,new RegExp(routeType));
  assert.match(migration,/append-only manual queue/i);assert.match(migration,/prevent_official_route_manual_task_mutation/);
  assert.doesNotMatch(migration,/outbound_messages|outreach_approvals|business_opportunity_management_events/i);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10ManualOfficialRoute=await applyPhase7Migration')>
    runner.indexOf('phase10CommercialProductFit=await applyPhase7Migration'));
});

test('042 adds the gated Gmail API provider, checkpoints and ambiguous-send audit after 041',()=>{
  assert.equal(PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY,'042_phase10_gmail_api_provider.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY),'utf8');
  for(const field of ['GMAIL_API','send_execution_key','rfc_message_id','provider_thread_id','gmail_mailbox_checkpoints',
    'gmail_ambiguous_send_events','RECIPIENT_OBSERVED_RECEIVED','PROVIDER_DELIVERED'])assert.match(migration,new RegExp(field));
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10GmailApiProvider=await applyPhase7Migration')>
    runner.indexOf('phase10ManualOfficialRoute=await applyPhase7Migration'));
});

test('043 adds immutable budget-resume lineage and a dedicated checkpoint dispatch outbox after 042',()=>{
  assert.equal(PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY,'043_phase10_budget_resume_continuation.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY),'utf8');
  for(const field of ['resumed_from_research_job_id','resume_execution_key','resume_checkpoint_replay_count',
    'resume_stage','auto_evidence_resume_outbox'])assert.match(migration,new RegExp(field));
  assert.match(migration,/UNIQUE \(task_id,checkpoint_replay_count\)/);
  assert.doesNotMatch(migration,/UPDATE\s+leadgen\.research_jobs|DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10BudgetResumeContinuation=await applyPhase7Migration')>
    runner.indexOf('phase10GmailApiProvider=await applyPhase7Migration'));
});

test('044 permits an audited provider-account-only Tavily ledger after 043',()=>{
  assert.equal(PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY,'044_phase10_tavily_provider_account_only.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY),'utf8');
  assert.match(migration,/credit_limit_units IS NULL/);
  assert.match(migration,/provider_credit_ledger_balance_check/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10TavilyProviderAccountOnly=await applyPhase7Migration')>
    runner.indexOf('phase10BudgetResumeContinuation=await applyPhase7Migration'));
});

test('045 adds provider account state and immutable transition events after 044',()=>{
  assert.equal(PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY,'045_phase10_provider_account_state.sql');
  const migration=fs.readFileSync(path.join(root,'database/migrations',PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY),'utf8');
  for(const field of ['provider_account_states','provider_account_state_events','CREDIT_EXHAUSTED','RATE_LIMITED','AUTH_ERROR'])
    assert.match(migration,new RegExp(field));
  assert.match(migration,/trg_provider_account_state_events_immutable/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
  assert.ok(runner.indexOf('phase10ProviderAccountState=await applyPhase7Migration')>
    runner.indexOf('phase10TavilyProviderAccountOnly=await applyPhase7Migration'));
});

test('032 adds category-level opportunity status without rewriting historical product opportunity rows',()=>{
  assert.equal(PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY,'032_phase10_category_level_product_opportunity.sql');
  assert.match(categoryOpportunitySql,/^BEGIN;/);assert.match(categoryOpportunitySql,/COMMIT;\s*$/);
  assert.match(categoryOpportunitySql,/CATEGORY_SCOPE_QUALIFIED/);
  assert.match(categoryOpportunitySql,/candidate_count=0/);
  assert.match(categoryOpportunitySql,/catalog_enrichment_required=false/);
  assert.match(categoryOpportunitySql,/sku_readiness_status IN \('NO_EXACT_SKU'\)/);
  assert.doesNotMatch(categoryOpportunitySql,/UPDATE\s+leadgen\.product_opportunity_results/i);
  assert.doesNotMatch(categoryOpportunitySql,/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  assert.match(runner,/verifyPhase10CategoryOpportunityMigration/);
  assert.ok(runner.indexOf('phase10CategoryOpportunity=await applyPhase7Migration')>runner.indexOf('phase10Audit=await applyPhase7Migration'));
});

test('031 requires attributed future controlled runs without inventing legacy approval facts',()=>{
  assert.match(auditSql,/^BEGIN;/);assert.match(auditSql,/COMMIT;\s*$/);
  assert.match(auditSql,/operator_identity/);assert.match(auditSql,/operator_role/);assert.match(auditSql,/approval_reference/);
  assert.match(auditSql,/schedule_source='MANUAL_RETRY'/);assert.match(auditSql,/NOT VALID/);
  assert.doesNotMatch(auditSql,/UPDATE\s+leadgen\.auto_evidence_schedule_events/i);
  assert.doesNotMatch(auditSql,/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  assert.match(auditSql,/DISTINCT ON \(s\.product_profile\)/);
  assert.match(auditSql,/o\.normalized_profile=NEW\.product_profile/);
  assert.match(auditSql,/trg_category_procurement_match_phase10_append_only/);
});

test('030 can apply and replay on an isolated PostgreSQL database without mutating legacy row counts',
  {skip:!liveDatabaseUrl},async()=>{
    const pool=new pg.Pool({connectionString:liveDatabaseUrl,max:2});
    try{
      const before=(await pool.query(`SELECT
        (SELECT count(*) FROM leadgen.companies)::int companies,
        (SELECT count(*) FROM leadgen.category_procurement_match_results)::int category_results,
        (SELECT count(*) FROM leadgen.product_opportunity_results)::int product_results,
        (SELECT count(*) FROM leadgen.business_opportunity_decision_snapshots)::int decisions,
        (SELECT count(*) FROM leadgen.dpv_product_category_scope_revisions)::int scope_revisions`)).rows[0];
      const applied=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase10-isolated-test'});
      assert.ok(['APPLIED','SKIPPED_ALREADY_APPLIED'].includes(applied.status));
      assert.equal(applied.phase10_tables_verified,8);assert.equal(applied.phase10_triggers_verified,10);
      assert.deepEqual((await pool.query(`SELECT
        (SELECT count(*) FROM leadgen.companies)::int companies,
        (SELECT count(*) FROM leadgen.category_procurement_match_results)::int category_results,
        (SELECT count(*) FROM leadgen.product_opportunity_results)::int product_results,
        (SELECT count(*) FROM leadgen.business_opportunity_decision_snapshots)::int decisions,
        (SELECT count(*) FROM leadgen.dpv_product_category_scope_revisions)::int scope_revisions`)).rows[0],before);
      const replay=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase10-isolated-test-replay'});
      assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
      assert.equal((await pool.query('SELECT count(*)::int count FROM leadgen.dpv_product_category_scope_revisions')).rows[0].count,before.scope_revisions);
      assert.match(applied.checksum_sha256,/^[a-f0-9]{64}$/);
      assert.equal(applied.checksum_sha256,digest(sql));
    }finally{await pool.end();}
  });

test('032 can apply and replay without rewriting historical opportunity or candidate rows',
  {skip:!liveDatabaseUrl},async()=>{
    const pool=new pg.Pool({connectionString:liveDatabaseUrl,max:2});
    try{
      const before=(await pool.query(`SELECT
        (SELECT count(*) FROM leadgen.product_opportunity_results)::int product_results,
        (SELECT count(*) FROM leadgen.product_opportunity_candidates)::int product_candidates`)).rows[0];
      const applied=await applyPhase7Migration({pool,migrationPath:categoryOpportunityMigrationPath,
        appliedBy:'phase10-category-opportunity-isolated-test'});
      assert.ok(['APPLIED','SKIPPED_ALREADY_APPLIED'].includes(applied.status));
      assert.equal(applied.phase10_category_opportunity_status_verified,true);
      assert.equal(applied.phase10_category_only_contract_verified,true);
      assert.deepEqual((await pool.query(`SELECT
        (SELECT count(*) FROM leadgen.product_opportunity_results)::int product_results,
        (SELECT count(*) FROM leadgen.product_opportunity_candidates)::int product_candidates`)).rows[0],before);
      const replay=await applyPhase7Migration({pool,migrationPath:categoryOpportunityMigrationPath,
        appliedBy:'phase10-category-opportunity-isolated-test-replay'});
      assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
    }finally{await pool.end();}
  });

test('040 can apply and replay without rewriting category, decision or commercial-fit rows',
  {skip:!liveDatabaseUrl},async()=>{
    const pool=new pg.Pool({connectionString:liveDatabaseUrl,max:2});
    const commercialPath=path.join(root,'database/migrations',PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY);
    try{
      const counts=()=>pool.query(`SELECT
        (SELECT count(*) FROM leadgen.category_procurement_match_results)::int category_results,
        (SELECT count(*) FROM leadgen.business_opportunity_decision_snapshots)::int decisions,
        (SELECT count(*) FROM leadgen.commercial_product_fit_results)::int commercial_results`);
      const before=(await counts()).rows[0];
      const first=await applyPhase7Migration({pool,migrationPath:commercialPath,appliedBy:'phase10-commercial-fit-live-test'});
      assert.ok(['APPLIED','SKIPPED_ALREADY_APPLIED'].includes(first.status));
      assert.equal(first.phase10_commercial_product_fit_tables_verified,3);
      assert.deepEqual((await counts()).rows[0],before);
      const replay=await applyPhase7Migration({pool,migrationPath:commercialPath,appliedBy:'phase10-commercial-fit-live-test-replay'});
      assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
      assert.deepEqual((await counts()).rows[0],before);
    }finally{await pool.end();}
  });
