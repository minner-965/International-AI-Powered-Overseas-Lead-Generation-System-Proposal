import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {applyPhase7Migration,PHASE10_CATEGORY_SCOPE_MIGRATION_KEY,
  PHASE10_AUDIT_HARDENING_MIGRATION_KEY,PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY} from '../src/phase7/migrationRunner.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const migrationPath=path.join(root,'database/migrations',PHASE10_CATEGORY_SCOPE_MIGRATION_KEY);
const sql=fs.readFileSync(migrationPath,'utf8');
const auditMigrationPath=path.join(root,'database/migrations',PHASE10_AUDIT_HARDENING_MIGRATION_KEY);
const auditSql=fs.readFileSync(auditMigrationPath,'utf8');
const categoryOpportunityMigrationPath=path.join(root,'database/migrations',PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY);
const categoryOpportunitySql=fs.readFileSync(categoryOpportunityMigrationPath,'utf8');
const runner=fs.readFileSync(path.join(root,'services/demo-dashboard/src/phase7/migrationRunner.js'),'utf8');
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

test('explicit migration runner applies and verifies 030 after 029 and then the Phase 10 audit hardening',()=>{
  assert.match(runner,/030_phase10_category_scope_and_auto_evidence\.sql/);
  assert.equal(PHASE10_AUDIT_HARDENING_MIGRATION_KEY,'031_phase10_controlled_evidence_audit_hardening.sql');
  assert.match(runner,/verifyPhase10CategoryScopeMigration/);
  assert.match(runner,/verifyPhase10AuditHardeningMigration/);
  assert.match(runner,/phase10MigrationPath/);
  assert.ok(runner.indexOf('categoryScope=await applyPhase7Migration')>runner.indexOf('realOpportunity=await applyPhase7Migration'));
  assert.ok(runner.indexOf('phase10Audit=await applyPhase7Migration')>runner.indexOf('categoryScope=await applyPhase7Migration'));
  assert.match(runner,/status:phase10CategoryOpportunity\.status/);
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
