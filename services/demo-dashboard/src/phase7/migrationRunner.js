import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const PHASE7_MIGRATION_KEY = '025_phase7_outreach_and_data_exchange.sql';
export const PHASE7_HARDENING_MIGRATION_KEY = '026_phase7_data_exchange_crm_hardening.sql';
export const PHASE7_ROLE_HARDENING_MIGRATION_KEY = '027_phase7_management_role_hardening.sql';
export const PHASE8_CONTACT_READY_MIGRATION_KEY = '028_phase8_contact_ready_recommendation.sql';
export const PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY = '029_phase9_real_opportunity_research_audit.sql';
export const PHASE10_CATEGORY_SCOPE_MIGRATION_KEY = '030_phase10_category_scope_and_auto_evidence.sql';
export const PHASE10_AUDIT_HARDENING_MIGRATION_KEY = '031_phase10_controlled_evidence_audit_hardening.sql';
export const PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY = '032_phase10_category_level_product_opportunity.sql';
export const PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY = '033_phase10_orchestrator_heartbeat_and_dispatch_diagnostics.sql';
export const PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY = '034_phase10_research_direct_queue_outbox.sql';
export const PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY = '035_phase10_provider_usage_projection.sql';
export const PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY = '036_phase10_provider_usage_export_contract.sql';
export const PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY = '037_phase10_auto_evidence_strategy_attempts.sql';
export const PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY = '038_phase10_auto_evidence_checkpoint_replay.sql';
export const PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY = '039_phase10_tavily_fair_budget.sql';
export const PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY = '040_phase10_commercial_product_fit.sql';
export const PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY = '041_phase10_manual_official_route_queue.sql';
export const PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY = '042_phase10_gmail_api_provider.sql';
export const PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY = '043_phase10_budget_resume_continuation.sql';
export const PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY = '044_phase10_tavily_provider_account_only.sql';
export const PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY = '045_phase10_provider_account_state.sql';
export const PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY = '046_phase10_empty_research_job_purge_audit.sql';
export const PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY = '047_phase10_retire_internal_tavily_enforcement.sql';
export const PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY = '048_phase10_category_driven_context.sql';
export const PHASE10_1_CATEGORY_CONTACT_SIMPLIFICATION_MIGRATION_KEY = '049_phase10_1_category_contact_simplification.sql';
export const PHASE10_1_CATEGORY_STATUS_COMPATIBILITY_MIGRATION_KEY = '050_phase10_1_category_status_compatibility.sql';
const projectRoot = process.env.DPV_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const defaultPath = path.resolve(projectRoot, 'database/migrations', PHASE7_MIGRATION_KEY);
const hardeningPath = path.resolve(projectRoot, 'database/migrations', PHASE7_HARDENING_MIGRATION_KEY);
const roleHardeningPath = path.resolve(projectRoot, 'database/migrations', PHASE7_ROLE_HARDENING_MIGRATION_KEY);
const contactReadyPath = path.resolve(projectRoot, 'database/migrations', PHASE8_CONTACT_READY_MIGRATION_KEY);
const realOpportunityPath = path.resolve(projectRoot, 'database/migrations', PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY);
const categoryScopePath = path.resolve(projectRoot, 'database/migrations', PHASE10_CATEGORY_SCOPE_MIGRATION_KEY);
const phase10AuditPath = path.resolve(projectRoot, 'database/migrations', PHASE10_AUDIT_HARDENING_MIGRATION_KEY);
const phase10CategoryOpportunityPath = path.resolve(projectRoot, 'database/migrations', PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY);
const phase10OrchestratorDiagnosticsPath = path.resolve(projectRoot, 'database/migrations', PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY);
const phase10ResearchDirectQueuePath = path.resolve(projectRoot, 'database/migrations', PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY);
const phase10ProviderUsageProjectionPath = path.resolve(projectRoot, 'database/migrations', PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY);
const phase10ProviderUsageExportPath = path.resolve(projectRoot, 'database/migrations', PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY);
const phase10AutoEvidenceStrategyPath = path.resolve(projectRoot, 'database/migrations', PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY);
const phase10AutoEvidenceCheckpointPath = path.resolve(projectRoot, 'database/migrations', PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY);
const phase10TavilyFairBudgetPath = path.resolve(projectRoot, 'database/migrations', PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY);
const phase10CommercialProductFitPath = path.resolve(projectRoot, 'database/migrations', PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY);
const phase10ManualOfficialRoutePath = path.resolve(projectRoot, 'database/migrations', PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY);
const phase10GmailApiProviderPath = path.resolve(projectRoot, 'database/migrations', PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY);
const phase10BudgetResumeContinuationPath = path.resolve(projectRoot, 'database/migrations', PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY);
const phase10TavilyProviderAccountOnlyPath = path.resolve(projectRoot, 'database/migrations', PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY);
const phase10ProviderAccountStatePath = path.resolve(projectRoot, 'database/migrations', PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY);
const phase10EmptyResearchPurgeAuditPath = path.resolve(projectRoot, 'database/migrations', PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY);
const phase10RetireInternalTavilyEnforcementPath = path.resolve(projectRoot, 'database/migrations', PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY);
const phase10CategoryDrivenContextPath = path.resolve(projectRoot, 'database/migrations', PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY);
const phase10CategoryContactSimplificationPath = path.resolve(projectRoot, 'database/migrations', PHASE10_1_CATEGORY_CONTACT_SIMPLIFICATION_MIGRATION_KEY);
const phase10CategoryStatusCompatibilityPath = path.resolve(projectRoot, 'database/migrations', PHASE10_1_CATEGORY_STATUS_COMPATIBILITY_MIGRATION_KEY);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function migrationBody(sql) {
  return sql
    .replace(/^\s*BEGIN\s*;?/i, '')
    .replace(/COMMIT\s*;?\s*$/i, '')
    .trim();
}

export async function verifyPhase7Migration(client) {
  const tables = [
    'marketing_context_versions',
    'marketing_context_approvals',
    'business_opportunity_decision_snapshots',
    'business_opportunity_management_events',
    'contact_work_queue',
    'outreach_eligibility_snapshots',
    'outreach_recipients',
    'outreach_drafts',
    'outreach_draft_evidence',
    'outreach_draft_products',
    'outreach_approvals',
    'outbound_messages',
    'outbound_message_attempts',
    'email_webhook_inbox',
    'email_message_events',
    'outreach_threads',
    'inbound_messages',
    'reply_classifications',
    'contact_suppressions',
    'sales_tasks',
    'crm_sync_outbox',
    'product_master_revisions',
    'data_export_jobs',
    'data_export_download_events',
    'import_approvals'
  ];
  const relations = await client.query(
    `SELECT name,to_regclass('leadgen.'||name) relation
       FROM unnest($1::text[]) name
      ORDER BY name`,
    [tables]
  );
  const missing = relations.rows.filter(row => !row.relation).map(row => row.name);
  if (missing.length) {
    throw new Error(`Phase 7 migration verification failed; missing tables: ${missing.join(', ')}`);
  }

  const indexes = await client.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname='leadgen'
        AND indexname = ANY($1::text[])`,
    [[
      'idx_outbound_messages_provider_message_id',
      'idx_contact_suppressions_active_contact',
      'idx_contact_work_queue_one_active'
    ]]
  );
  if (indexes.rowCount !== 3) {
    throw new Error('Phase 7 migration verification failed; required partial unique indexes are incomplete');
  }
  return { tables_verified: tables.length, indexes_verified: indexes.rowCount };
}

export async function verifyPhase7HardeningMigration(client) {
  const result=await client.query(`SELECT to_regclass('leadgen.data_import_effect_outbox') effect_outbox,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.reference_data_import_rows'::regclass
      AND conname='reference_data_import_rows_row_status_check' AND pg_get_constraintdef(oid) LIKE '%REVIEW%') review_status`);
  if(!result.rows[0]?.effect_outbox||result.rows[0]?.review_status!==true){
    throw new Error('Phase 7 hardening migration verification failed');
  }
  return{hardening_tables_verified:1,review_row_status_verified:true};
}

export async function verifyPhase7RoleHardeningMigration(client) {
  const result=await client.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
    WHERE conrelid='leadgen.business_opportunity_management_events'::regclass
      AND conname='business_opportunity_management_events_actor_role_check'`);
  if(!result.rowCount||!result.rows[0].definition.includes('MANAGEMENT_APPROVER')){
    throw new Error('Phase 7 management role hardening migration verification failed');
  }
  return{management_role_constraint_verified:true};
}

export async function verifyPhase8ContactReadyMigration(client) {
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='business_opportunity_decision_snapshots' AND column_name='business_fit_status') business_fit_column,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='business_opportunity_current' AND column_name='business_fit_status') current_view_column,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.business_opportunity_decision_snapshots'::regclass
      AND conname='business_opportunity_decision_snapshots_business_fit_status_check'
      AND pg_get_constraintdef(oid) LIKE '%FIT%') business_fit_constraint,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.business_opportunity_decision_snapshots'::regclass
      AND conname='business_opportunity_decision_snapshots_v2_contact_ready_check'
      AND pg_get_constraintdef(oid) LIKE '%business-opportunity-decision-v2%') v2_contact_ready_constraint`);
  const row=result.rows[0]||{};
  if(!row.business_fit_column||!row.current_view_column||!row.business_fit_constraint||!row.v2_contact_ready_constraint){
    throw new Error('Phase 8 contact-ready recommendation migration verification failed');
  }
  return{business_fit_column_verified:true,current_view_business_fit_verified:true,
    business_fit_constraint_verified:true,v2_contact_ready_constraint_verified:true};
}

export async function verifyPhase9RealOpportunityMigration(client) {
  const result=await client.query(`SELECT
    (SELECT count(*)::integer FROM information_schema.columns
      WHERE table_schema='leadgen' AND table_name='research_jobs'
        AND column_name=ANY(ARRAY['idempotency_key','request_digest','created_by_identity','created_by_role',
          'research_wave','run_budget_cap_units','stop_reason_code'])) phase9_job_columns,
    to_regclass('leadgen.research_job_cohort_items') cohort_table,
    to_regclass('leadgen.research_job_stage_events') stage_events_table,
    to_regclass('leadgen.contact_verification_events') contact_verification_table,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.research_jobs'::regclass
      AND conname='research_jobs_job_type_check'
      AND pg_get_constraintdef(oid) LIKE '%REAL_OPPORTUNITY_RESEARCH%') phase9_job_type,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_research_jobs_phase9_idempotency'
      AND indexdef LIKE '%WHERE (idempotency_key IS NOT NULL)%') idempotency_index,
    (SELECT count(*)::integer FROM pg_trigger
      WHERE NOT tgisinternal AND tgname=ANY(ARRAY[
        'trg_research_job_cohort_items_immutable','trg_research_job_stage_events_immutable',
        'trg_contact_verification_events_immutable','trg_contact_verification_events_exact_reference',
        'trg_research_jobs_phase9_request_guard'
      ])) phase9_triggers`);
  const row=result.rows[0]||{};
  if(Number(row.phase9_job_columns)!==7||!row.cohort_table||!row.stage_events_table
    ||!row.contact_verification_table||!row.phase9_job_type||!row.idempotency_index
    ||Number(row.phase9_triggers)!==5){
    throw new Error('Phase 9 real-opportunity research audit migration verification failed');
  }
  return {phase9_job_columns_verified:7,phase9_tables_verified:3,
    phase9_audit_and_reference_triggers_verified:5,idempotency_index_verified:true};
}

export async function verifyPhase10CategoryScopeMigration(client) {
  const result=await client.query(`SELECT
    (SELECT count(*)::integer FROM information_schema.tables
      WHERE table_schema='leadgen' AND table_name=ANY(ARRAY[
        'dpv_product_category_scope_revisions','dpv_product_category_scopes',
        'dpv_product_category_scope_aliases','category_procurement_match_scope_links',
        'auto_evidence_tasks','auto_evidence_task_attempts','auto_evidence_schedule_events',
        'human_evidence_exceptions'])) phase10_tables,
    (SELECT count(*)::integer FROM information_schema.views
      WHERE table_schema='leadgen' AND table_name=ANY(ARRAY[
        'dpv_product_category_scope_current','dpv_product_category_scope_candidates',
        'human_evidence_exceptions_current'])) phase10_views,
    (SELECT count(*)::integer FROM information_schema.columns
      WHERE table_schema='leadgen' AND table_name='category_procurement_match_results'
        AND column_name=ANY(ARRAY['scope_revision_id','match_basis','matched_scope_ids',
          'observed_customer_category_ids','similarity_rule','catalog_completeness_non_blocking'])) category_columns,
    (SELECT count(*)::integer FROM information_schema.columns
      WHERE table_schema='leadgen' AND table_name='product_opportunity_results'
        AND column_name=ANY(ARRAY['sku_readiness_status','catalog_enrichment_required',
          'category_scope_match_result_id'])) product_columns,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='cooperation_feasibility_results' AND column_name='supplier_route_status') supplier_route_column,
    (SELECT count(*)::integer FROM pg_trigger WHERE NOT tgisinternal
      AND tgname=ANY(ARRAY[
        'trg_dpv_product_category_scope_revisions_immutable',
        'trg_dpv_product_category_scopes_immutable',
        'trg_dpv_product_category_scope_aliases_immutable',
        'trg_category_procurement_match_scope_links_immutable',
        'trg_auto_evidence_task_attempts_immutable',
        'trg_auto_evidence_schedule_events_immutable',
        'trg_human_evidence_exceptions_immutable',
        'trg_auto_evidence_tasks_identity_guard','trg_auto_evidence_tasks_job_lineage',
        'trg_category_procurement_match_phase10_scope_gate'])) phase10_triggers,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.category_procurement_match_results'::regclass
        AND conname='category_procurement_match_results_phase10_v2_contract_check') category_v2_contract,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.product_opportunity_results'::regclass
        AND conname='product_opportunity_results_phase10_v2_contract_check') product_v2_contract,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.business_opportunity_decision_snapshots'::regclass
        AND conname='business_opportunity_decision_snapshots_v3_contact_ready_check') decision_v3_contract`);
  const row=result.rows[0]||{};
  if(Number(row.phase10_tables)!==8||Number(row.phase10_views)!==3
    ||Number(row.category_columns)!==6||Number(row.product_columns)!==3
    ||!row.supplier_route_column||Number(row.phase10_triggers)!==10
    ||!row.category_v2_contract||!row.product_v2_contract||!row.decision_v3_contract){
    throw new Error('Phase 10 category-scope and auto-evidence migration verification failed');
  }
  return {phase10_tables_verified:8,phase10_views_verified:3,
    phase10_category_columns_verified:6,phase10_product_columns_verified:3,
    phase10_triggers_verified:10,phase10_rule_contracts_verified:3};
}

export async function verifyPhase10AuditHardeningMigration(client) {
  const result=await client.query(`SELECT
    (SELECT count(*)::integer FROM information_schema.columns
      WHERE table_schema='leadgen' AND table_name='auto_evidence_schedule_events'
        AND column_name=ANY(ARRAY['operator_identity','operator_role','approval_reference'])) audit_columns,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.auto_evidence_schedule_events'::regclass
        AND conname='auto_evidence_schedule_events_controlled_audit_check') audit_constraint,
    EXISTS(SELECT 1 FROM pg_trigger
      WHERE tgrelid='leadgen.category_procurement_match_results'::regclass
        AND tgname='trg_category_procurement_match_phase10_append_only' AND NOT tgisinternal) category_append_only`);
  const view=await client.query(`SELECT pg_get_viewdef('leadgen.dpv_product_category_scope_current'::regclass,true) definition,
    pg_get_functiondef('leadgen.enforce_phase10_approved_category_scope()'::regprocedure) gate_definition`);
  const definition=String(view.rows[0]?.definition||'').toLowerCase();
  const gateDefinition=String(view.rows[0]?.gate_definition||'').toLowerCase();
  const verification={audit_columns:Number(result.rows[0]?.audit_columns),
    audit_constraint:result.rows[0]?.audit_constraint===true,
    category_append_only:result.rows[0]?.category_append_only===true,
    profile_current_view:/distinct\s+on\s*\([^)]*product_profile\)/.test(definition),
    profile_observation_gate:/o\.normalized_profile\s*=\s*new\.product_profile/.test(gateDefinition)};
  if(verification.audit_columns!==3||!verification.audit_constraint
    ||!verification.category_append_only||!verification.profile_current_view
    ||!verification.profile_observation_gate){
    throw new Error(`Phase 10 controlled evidence audit hardening verification failed: ${JSON.stringify(verification)}`);
  }
  return {phase10_controlled_audit_columns_verified:3,phase10_controlled_audit_constraint_verified:true,
    phase10_scope_profile_boundary_verified:true,phase10_category_results_append_only_verified:true};
}

export async function verifyPhase10CategoryOpportunityMigration(client) {
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.product_opportunity_results'::regclass
        AND conname='product_opportunity_results_recommendation_status_check'
        AND pg_get_constraintdef(oid) LIKE '%CATEGORY_SCOPE_QUALIFIED%') recommendation_status_supported,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='leadgen.product_opportunity_results'::regclass
        AND conname='product_opportunity_results_phase10_category_only_check'
        AND pg_get_constraintdef(oid) LIKE '%candidate_count = 0%') category_only_contract`);
  const verification={recommendation_status_supported:result.rows[0]?.recommendation_status_supported===true,
    category_only_contract:result.rows[0]?.category_only_contract===true};
  if(!verification.recommendation_status_supported||!verification.category_only_contract){
    throw new Error(`Phase 10 category-level opportunity migration verification failed: ${JSON.stringify(verification)}`);
  }
  return {phase10_category_opportunity_status_verified:true,phase10_category_only_contract_verified:true};
}

export async function verifyPhase10OrchestratorDiagnosticsMigration(client) {
  const result=await client.query(`SELECT
    to_regclass('leadgen.orchestrator_heartbeats') IS NOT NULL heartbeat_table,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='leadgen' AND table_name='research_jobs'
      AND column_name IN('dispatch_state','blocked_reason','last_dispatch_attempt_at','next_dispatch_attempt_at','dispatch_execution_key')) diagnostic_columns,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.research_jobs'::regclass
      AND conname='research_jobs_dispatch_state_check') dispatch_constraint`);
  const verification={heartbeat_table:result.rows[0]?.heartbeat_table===true,
    diagnostic_columns:Number(result.rows[0]?.diagnostic_columns),dispatch_constraint:result.rows[0]?.dispatch_constraint===true};
  if(!verification.heartbeat_table||verification.diagnostic_columns!==5||!verification.dispatch_constraint){
    throw new Error(`Phase 10 orchestrator diagnostics migration verification failed: ${JSON.stringify(verification)}`);
  }
  return {phase10_orchestrator_heartbeat_verified:true,phase10_dispatch_diagnostics_verified:true};
}

export async function verifyPhase10ResearchDirectQueueMigration(client) {
  const result=await client.query(`SELECT
    to_regclass('leadgen.research_job_dispatch_outbox') IS NOT NULL outbox_table,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.research_job_dispatch_outbox'::regclass
      AND contype='u' AND pg_get_constraintdef(oid) LIKE '%research_job_id%') job_unique,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen' AND tablename='research_job_dispatch_outbox'
      AND indexdef LIKE '%dispatch_state%') reconcile_index`);
  const verification={outbox_table:result.rows[0]?.outbox_table===true,job_unique:result.rows[0]?.job_unique===true,
    reconcile_index:result.rows[0]?.reconcile_index===true};
  if(!verification.outbox_table||!verification.job_unique||!verification.reconcile_index){
    throw new Error(`Phase 10 research direct queue migration verification failed: ${JSON.stringify(verification)}`);
  }
  return {phase10_research_direct_outbox_verified:true,phase10_research_direct_singleton_verified:true};
}

export async function verifyPhase10ProviderUsageProjectionMigration(client) {
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='provider_usage_events' AND column_name='released_units') released_units_column,
    to_regclass('leadgen.provider_usage_projection_reconciliation_runs') IS NOT NULL reconciliation_table,
    (SELECT count(*)::int FROM information_schema.views WHERE table_schema='leadgen'
      AND table_name IN('research_job_provider_usage_summary','research_job_company_provider_usage_summary')) projection_views,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_provider_usage_events_job_company_provider') job_company_index`);
  const verification={released_units_column:result.rows[0]?.released_units_column===true,
    reconciliation_table:result.rows[0]?.reconciliation_table===true,
    projection_views:Number(result.rows[0]?.projection_views),job_company_index:result.rows[0]?.job_company_index===true};
  if(!verification.released_units_column||!verification.reconciliation_table
    ||verification.projection_views!==2||!verification.job_company_index){
    throw new Error(`Phase 10 provider usage projection migration verification failed: ${JSON.stringify(verification)}`);
  }
  return {phase10_provider_released_units_verified:true,phase10_provider_usage_views_verified:2,
    phase10_provider_reconciliation_verified:true};
}

export async function verifyPhase10ProviderUsageExportMigration(client) {
  const result=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='leadgen.data_export_jobs'::regclass
      AND conname='data_export_jobs_export_type_check'
      AND pg_get_constraintdef(oid) LIKE '%RESEARCH_JOB_PROVIDER_USAGE%') provider_usage_export_type`);
  if(result.rows[0]?.provider_usage_export_type!==true){
    throw new Error('Phase 10 provider usage export contract migration verification failed');
  }
  return {phase10_provider_usage_export_type_verified:true};
}

export async function verifyPhase10AutoEvidenceStrategyMigration(client) {
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name='strategy_attempt_count') task_strategy_counter,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_task_attempts' AND column_name='query_fingerprint') attempt_fingerprint,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='uq_auto_evidence_attempts_strategy_event') strategy_event_index,
    NOT EXISTS(SELECT 1 FROM leadgen.auto_evidence_tasks
      WHERE strategy_attempt_count>max_attempts OR provider_retry_count<0 OR worker_retry_count<0) counters_valid`);
  const row=result.rows[0]||{};
  if(!row.task_strategy_counter||!row.attempt_fingerprint||!row.strategy_event_index||!row.counters_valid){
    throw new Error('Phase 10 auto-evidence strategy migration verification failed');
  }
  return {phase10_auto_evidence_strategy_verified:true};
}

export async function verifyPhase10AutoEvidenceCheckpointMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name='checkpoint_replay_count') task_checkpoint,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_task_attempts' AND column_name='checkpoint_replay_count') attempt_checkpoint,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen' AND indexname='uq_auto_evidence_attempts_strategy_event'
      AND indexdef LIKE '%checkpoint_replay_count%') replay_unique`);
  const row=result.rows[0]||{};
  if(!row.task_checkpoint||!row.attempt_checkpoint||!row.replay_unique){
    throw new Error('Phase 10 auto-evidence checkpoint migration verification failed');
  }
  return{phase10_auto_evidence_checkpoint_verified:true};
}

export async function verifyPhase10TavilyFairBudgetMigration(client){
  const result=await client.query(`SELECT
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='provider_usage_events' AND column_name=ANY(ARRAY['budget_pool','product_profile'])) usage_columns,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name=ANY(ARRAY[
        'fairness_round_number','last_strategy_started_at','strategy_duplicate_prevented_count'])) fairness_columns,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_provider_usage_tavily_daily_pool') budget_index,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_auto_evidence_fair_dispatch') fairness_index`);
  const row=result.rows[0]||{};
  if(Number(row.usage_columns)!==2||Number(row.fairness_columns)!==3||!row.budget_index||!row.fairness_index){
    throw new Error('Phase 10 Tavily fair-budget migration verification failed');
  }
  return{phase10_tavily_fair_budget_verified:true};
}

export async function verifyPhase10CommercialProductFitMigration(client){
  const result=await client.query(`SELECT
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='leadgen' AND table_name=ANY(ARRAY[
      'commercial_product_fit_results','commercial_product_fit_dimensions','commercial_product_fit_evidence'])) fit_tables,
    to_regclass('leadgen.commercial_product_fit_current') IS NOT NULL current_view,
    (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY(ARRAY[
      'trg_commercial_product_fit_results_immutable','trg_commercial_product_fit_dimensions_immutable',
      'trg_commercial_product_fit_evidence_immutable'])) immutable_triggers,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen' AND indexname='idx_commercial_product_fit_ranking') ranking_index`);
  const row=result.rows[0]||{};
  if(Number(row.fit_tables)!==3||!row.current_view||Number(row.immutable_triggers)!==3||!row.ranking_index){
    throw new Error('Phase 10 Commercial Product Fit migration verification failed');
  }
  return{phase10_commercial_product_fit_tables_verified:3,phase10_commercial_product_fit_append_only_verified:true};
}

export async function verifyPhase10ManualOfficialRouteMigration(client){
  const result=await client.query(`SELECT
    to_regclass('leadgen.official_route_manual_tasks') IS NOT NULL task_table,
    to_regclass('leadgen.official_route_manual_task_current') IS NOT NULL current_view,
    EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgname='trg_official_route_manual_tasks_immutable') immutable_trigger,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_official_route_manual_tasks_queue') queue_index,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.official_route_manual_tasks'::regclass
      AND pg_get_constraintdef(oid) LIKE '%MANUAL_OFFICIAL_ROUTE_READY%') task_type_contract`);
  const row=result.rows[0]||{};
  if(!row.task_table||!row.current_view||!row.immutable_trigger||!row.queue_index||!row.task_type_contract){
    throw new Error('Phase 10 manual official route migration verification failed');
  }
  return{phase10_manual_official_route_queue_verified:true,phase10_manual_official_route_append_only_verified:true};
}

export async function verifyPhase10GmailApiProviderMigration(client){
  const result=await client.query(`SELECT
    to_regclass('leadgen.gmail_mailbox_checkpoints') checkpoint_table,
    to_regclass('leadgen.gmail_ambiguous_send_events') ambiguous_table,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='outbound_messages' AND column_name='rfc_message_id') rfc_message_id,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.outbound_messages'::regclass
      AND conname='outbound_messages_provider_check' AND pg_get_constraintdef(oid) LIKE '%GMAIL_API%') gmail_provider,
    EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgname='trg_gmail_ambiguous_send_events_immutable') immutable_trigger`);
  const row=result.rows[0]||{};
  if(!row.checkpoint_table||!row.ambiguous_table||!row.rfc_message_id||!row.gmail_provider||!row.immutable_trigger){
    throw new Error('Phase 10 Gmail API provider migration verification failed');
  }
  return{phase10_gmail_provider_verified:true,phase10_gmail_ambiguous_audit_verified:true};
}

export async function verifyPhase10BudgetResumeContinuationMigration(client){
  const result=await client.query(`SELECT
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='research_jobs' AND column_name=ANY(ARRAY[
        'resumed_from_research_job_id','resume_execution_key','resume_checkpoint_replay_count','resume_stage'])) lineage_columns,
    to_regclass('leadgen.auto_evidence_resume_outbox') outbox_table,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='research_jobs_resume_execution_key_uidx') resume_singleton,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='leadgen'
      AND indexname='idx_auto_evidence_resume_outbox_pending') pending_index`);
  const row=result.rows[0]||{};
  if(Number(row.lineage_columns)!==4||!row.outbox_table||!row.resume_singleton||!row.pending_index){
    throw new Error('Phase 10 budget-resume continuation migration verification failed');
  }
  return{phase10_budget_resume_lineage_verified:true,phase10_budget_resume_outbox_verified:true};
}

export async function verifyPhase10TavilyProviderAccountOnlyMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='provider_credit_ledger' AND column_name='credit_limit_units' AND is_nullable='YES') nullable_limit,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.provider_credit_ledger'::regclass
      AND conname='provider_credit_ledger_balance_check'
      AND pg_get_constraintdef(oid) LIKE '%credit_limit_units IS NULL%') unlimited_balance_check`);
  const row=result.rows[0]||{};
  if(!row.nullable_limit||!row.unlimited_balance_check){
    throw new Error('Phase 10 Tavily provider-account-only migration verification failed');
  }
  return{phase10_tavily_provider_account_only_verified:true};
}

export async function verifyPhase10ProviderAccountStateMigration(client){
  const result=await client.query(`SELECT
    to_regclass('leadgen.provider_account_states') state_table,
    to_regclass('leadgen.provider_account_state_events') event_table,
    to_regclass('leadgen.auto_evidence_ownership_repair_events') ownership_event_table,
    EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgname='trg_provider_account_state_events_immutable') immutable_event`);
  const row=result.rows[0]||{};
  if(!row.state_table||!row.event_table||!row.ownership_event_table||!row.immutable_event)throw new Error('Phase 10 provider account state migration verification failed');
  return{phase10_provider_account_state_verified:true};
}

export async function verifyPhase10EmptyResearchPurgeAuditMigration(client){
  const result=await client.query(`SELECT
    to_regclass('leadgen.research_job_purge_runs') runs,
    to_regclass('leadgen.research_job_purge_items') items`);
  if(!result.rows[0]?.runs||!result.rows[0]?.items)throw new Error('Phase 10 purge audit migration verification failed');
  return{phase10_empty_research_purge_audit_verified:true};
}

export async function verifyPhase10RetireInternalTavilyEnforcementMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.auto_evidence_tasks'::regclass
      AND conname='auto_evidence_tasks_task_status_check'
      AND pg_get_constraintdef(oid) LIKE '%PROVIDER_CAPACITY_WAIT%') provider_wait_status,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.auto_evidence_tasks'::regclass
      AND conname='auto_evidence_tasks_strategy_attempt_count_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%max_attempts%') no_fixed_strategy_cap,
    NOT EXISTS(SELECT 1 FROM leadgen.provider_credit_ledger
      WHERE provider='TAVILY' AND credit_limit_units IS NOT NULL) no_tavily_internal_ceiling`);
  const row=result.rows[0]||{};
  if(!row.provider_wait_status||!row.no_fixed_strategy_cap||!row.no_tavily_internal_ceiling)
    throw new Error('Phase 10 internal Tavily enforcement retirement verification failed');
  return{phase10_internal_tavily_enforcement_retired:true};
}

export async function verifyPhase10CategoryDrivenContextMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name='target_category_scope_key' AND is_nullable='NO') task_scope_key,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name='target_category_code' AND is_nullable='NO') task_category_code,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_tasks' AND column_name='product_profile' AND is_nullable='YES') optional_task_profile,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='auto_evidence_schedule_events' AND column_name='target_category_scope_key') event_scope_key,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.auto_evidence_tasks'::regclass
      AND conname='auto_evidence_tasks_category_scope_identity_key') category_identity`);
  const row=result.rows[0]||{};
  if(!row.task_scope_key||!row.task_category_code||!row.optional_task_profile||!row.event_scope_key||!row.category_identity)
    throw new Error('Phase 10 category-driven context migration verification failed');
  return{phase10_category_driven_context_verified:true};
}

export async function verifyPhase10CategoryContactSimplificationMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='decision_maker_contacts' AND column_name='company_id' AND is_nullable='NO') company_contact_identity,
    to_regclass('leadgen.company_contact_route_current') IS NOT NULL company_route_view,
    to_regclass('leadgen.idx_decision_maker_contacts_company_canonical') IS NOT NULL company_route_index,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='official_route_manual_tasks' AND column_name='retired_policy') retired_policy_marker,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='leadgen.official_route_manual_tasks'::regclass
      AND tgname='trg_official_route_manual_tasks_no_new' AND NOT tgisinternal) manual_route_insert_retired`);
  const row=result.rows[0]||{};
  if(!row.company_contact_identity||!row.company_route_view||!row.company_route_index
    ||!row.retired_policy_marker||!row.manual_route_insert_retired)
    throw new Error('Phase 10.1 category/contact simplification migration verification failed');
  return{phase10_1_category_contact_simplification_verified:true};
}

export async function verifyPhase10CategoryStatusCompatibilityMigration(client){
  const result=await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.category_procurement_match_results'::regclass
      AND conname='category_procurement_match_results_match_status_check'
      AND pg_get_constraintdef(oid) LIKE '%CATEGORY_MATCH_CONFIRMED%'
      AND pg_get_constraintdef(oid) LIKE '%CATEGORY_PROCUREMENT_MATCH%') status_compatibility,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='decision_maker_contacts' AND column_name='canonical_route_key') canonical_route_key,
    to_regclass('leadgen.uq_decision_maker_contacts_company_route') IS NOT NULL company_route_unique`);
  const row=result.rows[0]||{};
  if(!row.status_compatibility||!row.canonical_route_key||!row.company_route_unique)
    throw new Error('Phase 10.1 category status compatibility migration verification failed');
  return{phase10_1_category_status_compatibility_verified:true};
}

export async function applyPhase7Migrations(options = {}) {
  const base=await applyPhase7Migration(options);
  const hardening=await applyPhase7Migration({...options,migrationPath:options.hardeningMigrationPath||hardeningPath,
    appliedBy:options.appliedBy||'dpv-phase7-explicit-migration-runner'});
  const roleHardening=await applyPhase7Migration({...options,migrationPath:options.roleHardeningMigrationPath||roleHardeningPath,
    appliedBy:options.appliedBy||'dpv-phase7-explicit-migration-runner'});
  const contactReady=await applyPhase7Migration({...options,migrationPath:options.contactReadyMigrationPath||contactReadyPath,
    appliedBy:options.appliedBy||'dpv-phase8-explicit-migration-runner'});
  const realOpportunity=await applyPhase7Migration({...options,migrationPath:options.phase9MigrationPath||realOpportunityPath,
    appliedBy:options.appliedBy||'dpv-phase9-explicit-migration-runner'});
  const categoryScope=await applyPhase7Migration({...options,migrationPath:options.phase10MigrationPath||categoryScopePath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10Audit=await applyPhase7Migration({...options,migrationPath:options.phase10AuditMigrationPath||phase10AuditPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10CategoryOpportunity=await applyPhase7Migration({...options,
    migrationPath:options.phase10CategoryOpportunityMigrationPath||phase10CategoryOpportunityPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10OrchestratorDiagnostics=await applyPhase7Migration({...options,
    migrationPath:options.phase10OrchestratorDiagnosticsMigrationPath||phase10OrchestratorDiagnosticsPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10ResearchDirectQueue=await applyPhase7Migration({...options,
    migrationPath:options.phase10ResearchDirectQueueMigrationPath||phase10ResearchDirectQueuePath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10ProviderUsageProjection=await applyPhase7Migration({...options,
    migrationPath:options.phase10ProviderUsageProjectionMigrationPath||phase10ProviderUsageProjectionPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10ProviderUsageExport=await applyPhase7Migration({...options,
    migrationPath:options.phase10ProviderUsageExportMigrationPath||phase10ProviderUsageExportPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10AutoEvidenceStrategy=await applyPhase7Migration({...options,
    migrationPath:options.phase10AutoEvidenceStrategyMigrationPath||phase10AutoEvidenceStrategyPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10AutoEvidenceCheckpoint=await applyPhase7Migration({...options,
    migrationPath:options.phase10AutoEvidenceCheckpointMigrationPath||phase10AutoEvidenceCheckpointPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10TavilyFairBudget=await applyPhase7Migration({...options,
    migrationPath:options.phase10TavilyFairBudgetMigrationPath||phase10TavilyFairBudgetPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10CommercialProductFit=await applyPhase7Migration({...options,
    migrationPath:options.phase10CommercialProductFitMigrationPath||phase10CommercialProductFitPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10ManualOfficialRoute=await applyPhase7Migration({...options,
    migrationPath:options.phase10ManualOfficialRouteMigrationPath||phase10ManualOfficialRoutePath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10GmailApiProvider=await applyPhase7Migration({...options,
    migrationPath:options.phase10GmailApiProviderMigrationPath||phase10GmailApiProviderPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10BudgetResumeContinuation=await applyPhase7Migration({...options,
    migrationPath:options.phase10BudgetResumeContinuationMigrationPath||phase10BudgetResumeContinuationPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10TavilyProviderAccountOnly=await applyPhase7Migration({...options,
    migrationPath:options.phase10TavilyProviderAccountOnlyMigrationPath||phase10TavilyProviderAccountOnlyPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10ProviderAccountState=await applyPhase7Migration({...options,
    migrationPath:options.phase10ProviderAccountStateMigrationPath||phase10ProviderAccountStatePath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10EmptyResearchPurgeAudit=await applyPhase7Migration({...options,
    migrationPath:options.phase10EmptyResearchPurgeAuditMigrationPath||phase10EmptyResearchPurgeAuditPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10RetireInternalTavilyEnforcement=await applyPhase7Migration({...options,
    migrationPath:options.phase10RetireInternalTavilyEnforcementMigrationPath||phase10RetireInternalTavilyEnforcementPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10CategoryDrivenContext=await applyPhase7Migration({...options,
    migrationPath:options.phase10CategoryDrivenContextMigrationPath||phase10CategoryDrivenContextPath,
    appliedBy:options.appliedBy||'dpv-phase10-explicit-migration-runner'});
  const phase10CategoryContactSimplification=await applyPhase7Migration({...options,
    migrationPath:options.phase10CategoryContactSimplificationMigrationPath||phase10CategoryContactSimplificationPath,
    appliedBy:options.appliedBy||'dpv-phase10.1-explicit-migration-runner'});
  const phase10CategoryStatusCompatibility=await applyPhase7Migration({...options,
    migrationPath:options.phase10CategoryStatusCompatibilityMigrationPath||phase10CategoryStatusCompatibilityPath,
    appliedBy:options.appliedBy||'dpv-phase10.1-explicit-migration-runner'});
  return {base,hardening,roleHardening,contactReady,
    realOpportunity:{...realOpportunity,status:realOpportunity.status},categoryScope,phase10Audit,phase10CategoryOpportunity,
    phase10OrchestratorDiagnostics,phase10ResearchDirectQueue,phase10ProviderUsageProjection,phase10ProviderUsageExport,
    phase10AutoEvidenceStrategy,phase10AutoEvidenceCheckpoint,phase10TavilyFairBudget,phase10CommercialProductFit,
    phase10ManualOfficialRoute,phase10GmailApiProvider,phase10BudgetResumeContinuation,phase10TavilyProviderAccountOnly,
    phase10ProviderAccountState,phase10EmptyResearchPurgeAudit,phase10RetireInternalTavilyEnforcement,phase10CategoryDrivenContext,
    phase10CategoryContactSimplification,phase10CategoryStatusCompatibility,
    status:phase10CategoryStatusCompatibility.status,database:phase10CategoryStatusCompatibility.database};
}

export async function applyPhase7Migration({
  pool,
  migrationPath = defaultPath,
  expectedDatabase = null,
  appliedBy = 'dpv-phase7-explicit-migration-runner'
} = {}) {
  if (!pool) throw new Error('applyPhase7Migration requires a PostgreSQL pool');
  const sql = await fs.readFile(migrationPath, 'utf8');
  const checksum = sha256(sql);
  const migrationKey = path.basename(migrationPath);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const database = await client.query(
      'SELECT current_database() database,current_user username'
    );
    if (expectedDatabase && database.rows[0].database !== expectedDatabase) {
      throw new Error(`Migration target mismatch: expected ${expectedDatabase}`);
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS leadgen');
    await client.query(
      `CREATE TABLE IF NOT EXISTS leadgen.schema_migrations(
        migration_key text PRIMARY KEY,
        checksum_sha256 text NOT NULL CHECK(checksum_sha256~'^[0-9A-Fa-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text NOT NULL DEFAULT current_user
      )`
    );
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`leadgen:migration:${migrationKey}`]
    );
    const prior = await client.query(
      'SELECT * FROM leadgen.schema_migrations WHERE migration_key=$1 FOR UPDATE',
      [migrationKey]
    );
    if (prior.rowCount) {
      if (prior.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Migration checksum mismatch for ${migrationKey}`);
      }
      const verification = migrationKey===PHASE7_HARDENING_MIGRATION_KEY
        ? await verifyPhase7HardeningMigration(client)
        :migrationKey===PHASE7_ROLE_HARDENING_MIGRATION_KEY
          ?await verifyPhase7RoleHardeningMigration(client)
          :migrationKey===PHASE8_CONTACT_READY_MIGRATION_KEY
            ?await verifyPhase8ContactReadyMigration(client)
            :migrationKey===PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY
              ?await verifyPhase9RealOpportunityMigration(client)
              :migrationKey===PHASE10_CATEGORY_SCOPE_MIGRATION_KEY
                ?await verifyPhase10CategoryScopeMigration(client)
                :migrationKey===PHASE10_AUDIT_HARDENING_MIGRATION_KEY
                  ?await verifyPhase10AuditHardeningMigration(client)
                  :migrationKey===PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY
                    ?await verifyPhase10CategoryOpportunityMigration(client)
                    :migrationKey===PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY
                      ?await verifyPhase10OrchestratorDiagnosticsMigration(client)
                      :migrationKey===PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY
                        ?await verifyPhase10ResearchDirectQueueMigration(client)
                        :migrationKey===PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY
                          ?await verifyPhase10ProviderUsageProjectionMigration(client)
                          :migrationKey===PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY
                            ?await verifyPhase10ProviderUsageExportMigration(client)
                            :migrationKey===PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY
                              ?await verifyPhase10AutoEvidenceStrategyMigration(client)
                              :migrationKey===PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY
                                ?await verifyPhase10AutoEvidenceCheckpointMigration(client)
                                :migrationKey===PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY
                                  ?await verifyPhase10TavilyFairBudgetMigration(client)
                                  :migrationKey===PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY
                                ?await verifyPhase10CommercialProductFitMigration(client)
                                :migrationKey===PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY
                                  ?await verifyPhase10ManualOfficialRouteMigration(client)
                                  :migrationKey===PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY
                                    ?await verifyPhase10GmailApiProviderMigration(client)
                                    :migrationKey===PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY
                                      ?await verifyPhase10BudgetResumeContinuationMigration(client)
                                      :migrationKey===PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY
                                        ?await verifyPhase10TavilyProviderAccountOnlyMigration(client)
          :migrationKey===PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY
                                          ?await verifyPhase10ProviderAccountStateMigration(client)
                                          :migrationKey===PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY
                                            ?await verifyPhase10EmptyResearchPurgeAuditMigration(client)
                                            :migrationKey===PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY
                                              ?await verifyPhase10RetireInternalTavilyEnforcementMigration(client)
                                              :migrationKey===PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY
                                                ?await verifyPhase10CategoryDrivenContextMigration(client)
                                                :migrationKey===PHASE10_1_CATEGORY_CONTACT_SIMPLIFICATION_MIGRATION_KEY
                                                  ?await verifyPhase10CategoryContactSimplificationMigration(client)
                                                  :migrationKey===PHASE10_1_CATEGORY_STATUS_COMPATIBILITY_MIGRATION_KEY
                                                    ?await verifyPhase10CategoryStatusCompatibilityMigration(client)
                                                    :await verifyPhase7Migration(client);
      await client.query('COMMIT');
      return {
        migration_key: migrationKey,
        checksum_sha256: checksum,
        status: 'SKIPPED_ALREADY_APPLIED',
        database: database.rows[0].database,
        ...verification
      };
    }
    await client.query(migrationBody(sql));
    await client.query(
      `INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by)
       VALUES($1,$2,$3)`,
      [migrationKey, checksum, appliedBy]
    );
    const verification = migrationKey===PHASE7_HARDENING_MIGRATION_KEY
      ? await verifyPhase7HardeningMigration(client)
      :migrationKey===PHASE7_ROLE_HARDENING_MIGRATION_KEY
        ?await verifyPhase7RoleHardeningMigration(client)
        :migrationKey===PHASE8_CONTACT_READY_MIGRATION_KEY
          ?await verifyPhase8ContactReadyMigration(client)
          :migrationKey===PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY
            ?await verifyPhase9RealOpportunityMigration(client)
            :migrationKey===PHASE10_CATEGORY_SCOPE_MIGRATION_KEY
              ?await verifyPhase10CategoryScopeMigration(client)
              :migrationKey===PHASE10_AUDIT_HARDENING_MIGRATION_KEY
                ?await verifyPhase10AuditHardeningMigration(client)
                :migrationKey===PHASE10_CATEGORY_OPPORTUNITY_MIGRATION_KEY
                  ?await verifyPhase10CategoryOpportunityMigration(client)
                  :migrationKey===PHASE10_ORCHESTRATOR_DIAGNOSTICS_MIGRATION_KEY
                    ?await verifyPhase10OrchestratorDiagnosticsMigration(client)
                    :migrationKey===PHASE10_RESEARCH_DIRECT_QUEUE_MIGRATION_KEY
                      ?await verifyPhase10ResearchDirectQueueMigration(client)
                      :migrationKey===PHASE10_PROVIDER_USAGE_PROJECTION_MIGRATION_KEY
                        ?await verifyPhase10ProviderUsageProjectionMigration(client)
                        :migrationKey===PHASE10_PROVIDER_USAGE_EXPORT_MIGRATION_KEY
                          ?await verifyPhase10ProviderUsageExportMigration(client)
                          :migrationKey===PHASE10_AUTO_EVIDENCE_STRATEGY_MIGRATION_KEY
                            ?await verifyPhase10AutoEvidenceStrategyMigration(client)
                            :migrationKey===PHASE10_AUTO_EVIDENCE_CHECKPOINT_MIGRATION_KEY
                              ?await verifyPhase10AutoEvidenceCheckpointMigration(client)
                              :migrationKey===PHASE10_TAVILY_FAIR_BUDGET_MIGRATION_KEY
                                ?await verifyPhase10TavilyFairBudgetMigration(client)
                                :migrationKey===PHASE10_COMMERCIAL_PRODUCT_FIT_MIGRATION_KEY
                                  ?await verifyPhase10CommercialProductFitMigration(client)
                                  :migrationKey===PHASE10_MANUAL_OFFICIAL_ROUTE_MIGRATION_KEY
                                    ?await verifyPhase10ManualOfficialRouteMigration(client)
                                    :migrationKey===PHASE10_GMAIL_API_PROVIDER_MIGRATION_KEY
                                      ?await verifyPhase10GmailApiProviderMigration(client)
                                      :migrationKey===PHASE10_BUDGET_RESUME_CONTINUATION_MIGRATION_KEY
                                        ?await verifyPhase10BudgetResumeContinuationMigration(client)
                                        :migrationKey===PHASE10_TAVILY_PROVIDER_ACCOUNT_ONLY_MIGRATION_KEY
                                          ?await verifyPhase10TavilyProviderAccountOnlyMigration(client)
                                          :migrationKey===PHASE10_PROVIDER_ACCOUNT_STATE_MIGRATION_KEY
                                            ?await verifyPhase10ProviderAccountStateMigration(client)
                                            :migrationKey===PHASE10_EMPTY_RESEARCH_PURGE_AUDIT_MIGRATION_KEY
                                              ?await verifyPhase10EmptyResearchPurgeAuditMigration(client)
                                              :migrationKey===PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY
                                                ?await verifyPhase10RetireInternalTavilyEnforcementMigration(client)
                                                :migrationKey===PHASE10_CATEGORY_DRIVEN_CONTEXT_MIGRATION_KEY
                                                  ?await verifyPhase10CategoryDrivenContextMigration(client)
                                                  :migrationKey===PHASE10_1_CATEGORY_CONTACT_SIMPLIFICATION_MIGRATION_KEY
                                                    ?await verifyPhase10CategoryContactSimplificationMigration(client)
                                                    :migrationKey===PHASE10_1_CATEGORY_STATUS_COMPATIBILITY_MIGRATION_KEY
                                                      ?await verifyPhase10CategoryStatusCompatibilityMigration(client)
                                                      :await verifyPhase7Migration(client);
    await client.query('COMMIT');
    return {
      migration_key: migrationKey,
      checksum_sha256: checksum,
      status: 'APPLIED',
      database: database.rows[0].database,
      ...verification
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv.includes('--apply')) {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'leadgen',
    user: process.env.POSTGRES_USER || 'leadgen',
    password: process.env.POSTGRES_PASSWORD
  });
  try {
    const result = await applyPhase7Migrations({
      pool,
      expectedDatabase: process.env.POSTGRES_DB || null
    });
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}
