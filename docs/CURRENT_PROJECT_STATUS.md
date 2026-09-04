# DPV Current Project Status

This file is the single source of truth for current execution state. Historical plans and context files remain reference-only when they conflict with this snapshot.

<!-- CURRENT_PROJECT_STATUS_JSON:BEGIN -->
```json
{
  "generated_updated_at": "2026-09-04T14:02:00+08:00",
  "repository": "D:/codex/International-AI-Powered-Overseas-Lead-Generation-System-Proposal",
  "branch": "phase10-remove-internal-limits-20260904-112916",
  "commit": "5956dfe3ca4b32fa6508cc7e937e0ef2b46cbe67",
  "dirty_at_snapshot": false,
  "latest_released_phase": "Phase 9",
  "current_active_phase": "Phase 10",
  "phase_state": [
    "Phase 1–9 complete",
    "Phase 10 code/migration/UI/automation verified",
    "Phase 10 final acceptance incomplete",
    "WP-U00–U14 complete",
    "Work Package 15 implementation verified; controlled-address E2E pending",
    "Work Package 16 read-only inspection blocked by missing SPF, unknown DKIM selector and rejected Google sign-in",
    "WP-A04.2 provider-only research and continuation recovery passed",
    "WP-U13 real browser positive and reverse canaries passed",
    "WP-U14 implementation snapshot, documentation and release handoff complete"
  ],
  "final_acceptance_state": "INCOMPLETE",
  "business_result_state": "NO",
  "applied_migrations": [
    {"migration_key":"024_phase6_1_category_procurement_match.sql","sha256":"f468b82796e4941a65d81dc37f4a2cc9ca10ca0ccc938abf4ec4ad5a83b4930d"},
    {"migration_key":"025_phase7_outreach_and_data_exchange.sql","sha256":"e0bc7c3b8f618415953e5d6a2434c18fc1ec12a1a98b34c533ac13b2c580c9b3"},
    {"migration_key":"026_phase7_data_exchange_crm_hardening.sql","sha256":"a57693cad8e8cd5d003b2df99dab4f056d597b6f2c1d698dccd4c7feb96e7886"},
    {"migration_key":"027_phase7_management_role_hardening.sql","sha256":"7e709dc24bf2d90d6adfd77cc29cea92419931937beff13a33833b19a418ddec"},
    {"migration_key":"028_phase8_contact_ready_recommendation.sql","sha256":"c45f4d3be0e97583fd1b05a76120cec8b9d78b937f268f6f8150c9149c6252f4"},
    {"migration_key":"029_phase9_real_opportunity_research_audit.sql","sha256":"052cdf4bdbfe1a33ed024e228f1a5b8b78b2bab03b36356fec63949e41e59bdf"},
    {"migration_key":"030_phase10_category_scope_and_auto_evidence.sql","sha256":"1017a6e1b7b6cde1c1f3db9d5998530fe1efa9b29f2f3158af74934aefee278d"},
    {"migration_key":"031_phase10_controlled_evidence_audit_hardening.sql","sha256":"9a03c3ada14af3f60e79874b0952e2f04747a9e5f38f5f37fdd1beb466478c40"},
    {"migration_key":"032_phase10_category_level_product_opportunity.sql","sha256":"08a0f53fea796d959ecece135508c346127896436c5728640f60c25bef2fb0cb"},
    {"migration_key":"033_phase10_orchestrator_heartbeat_and_dispatch_diagnostics.sql","sha256":"31516a767984396038e8d02b62253a387f5707039325d904dd266060c88bc26c"},
    {"migration_key":"034_phase10_research_direct_queue_outbox.sql","sha256":"6f06331b5ae9622a780fcca34240251da7d9565c40ed76c7c15429b9161964ba"},
    {"migration_key":"035_phase10_provider_usage_projection.sql","sha256":"161aebfdd8af55bf857828c0fee7bb32276311bea6f80acc95763f72cc25370a"},
    {"migration_key":"036_phase10_provider_usage_export_contract.sql","sha256":"cf483ab93299f9d873922716b15a4d6161e125b5c6e29330ae6fcbe5b1f4f504"},
    {"migration_key":"037_phase10_auto_evidence_strategy_attempts.sql","sha256":"905078549ce5d8da331e9182df4481d8d062107b239d722bbe9eb5ba83b9afb5"},
    {"migration_key":"038_phase10_auto_evidence_checkpoint_replay.sql","sha256":"366d5faa13ea272860774694952eb9dfae6cd640b0b6f51aa8da55b2df81c173"},
    {"migration_key":"039_phase10_tavily_fair_budget.sql","sha256":"7bf6860215a38afcc09b5a9ba780d7ba9d927cf875ec800dc548845a3bc1aed0"},
    {"migration_key":"040_phase10_commercial_product_fit.sql","sha256":"d1798824a5223231a652a1789028a01afa2e787dd7d0afe27a6f421ff5c51c5f"},
    {"migration_key":"041_phase10_manual_official_route_queue.sql","sha256":"91ddefcb33e12bdf0843a9299d68ce92c97f3bc656f567d800b0c4a684eb7070"},
    {"migration_key":"042_phase10_gmail_api_provider.sql","sha256":"dd603f4c5dc7e43b57a017424670811053f99c63cd5450470d713663a508aa8e"},
    {"migration_key":"043_phase10_budget_resume_continuation.sql","sha256":"11a2bff129196b36ec04c32b6b4c593000e4bc955ece3d6af13a70b4cd130d14"},
    {"migration_key":"044_phase10_tavily_provider_account_only.sql","sha256":"ea05a88571852f63e96be9e8ea60b1e9366f4d283e0ebc743cfe665fee463a34"},
    {"migration_key":"045_phase10_provider_account_state.sql","sha256":"ec0d626b2b5599a9af4076dae2ecb19a0da0b0a8a5d3bb84a44e2a2e511bde80"},
    {"migration_key":"046_phase10_empty_research_job_purge_audit.sql","sha256":"d2c4ade50d1e76fbfb7a95608263660f078dbc9d1178e61aef26da7bfe6bb87c"},
    {"migration_key":"047_phase10_retire_internal_tavily_enforcement.sql","sha256":"63ec5e44937d068c83d73f57cd0aa7434a6ec653dfbce12acb0f523285bcd92c"}
  ],
  "current_real_data_counts": {
    "companies": 110,
    "sources": 231,
    "contacts": 62,
    "lead_reviews": 93,
    "collection_runs": 13,
    "research_jobs": 144,
    "current_opportunities": 17,
    "evidence_required": 13,
    "not_suitable": 3,
    "recommended": 1,
    "management_approved": 0,
    "decision_makers": 12,
    "decision_maker_contacts": 83,
    "valid_contact_routes": 0,
    "company_contact_routes": 83,
    "auto_evidence_tasks": 31,
    "provider_usage_events": 204,
    "commercial_fit_results": 61,
    "official_route_manual_task_revisions": 50,
    "official_route_manual_tasks_active": 50,
    "outreach_drafts": 0,
    "outbound_messages": 0,
    "inbound_messages": 0,
    "crm_sync_outbox": 0
  },
  "effective_runtime_flags": {
    "auto_evidence_enabled": true,
    "operator_override_enabled": false,
    "research_direct_queue_dispatch": true,
    "reconcile_minutes": 30,
    "tavily_usage_policy": "PROVIDER_ACCOUNT_ONLY",
    "local_daily_quota_enforcement": false,
    "local_per_run_quota_enforcement": false,
    "local_per_job_quota_enforcement": false,
    "local_company_profile_quota_enforcement": false,
    "local_purpose_pool_quota_enforcement": false,
    "local_global_billing_quota_enforcement": false,
    "numeric_max_attempt_blocking": false,
    "company_cooldown_blocking": false,
    "outbound_email_enabled": false,
    "gmail_api_enabled": false,
    "gmail_inbound_sync_enabled": false,
    "gmail_controlled_test_mode": true
  },
  "required_n8n_workflow_status": [
    {"workflow_key":"dpvPhase1TwoWeekDemo","purpose":"retired_research_webhook","active":false},
    {"workflow_key":"dpvPhase6Enrichment","purpose":"buyer_enrichment","active":true},
    {"workflow_key":"dpvPhase61CategoryProcurement","purpose":"category_procurement","active":true},
    {"workflow_key":"dpvPhase10AutoEvidenceReconciliation","purpose":"auto_evidence_reconciliation","active":true}
  ],
  "last_reconciliation_heartbeat": {
    "status": "ACTIVE",
    "observed_at": "2026-09-04T14:00:18.356+08:00"
  },
  "provider_configuration": {
    "search_provider": "tavily",
    "tavily_configured": true,
    "tavily_account_state": "AVAILABLE",
    "hunter_configured": true,
    "hunter_mode": "FREE_FIRST",
    "outbound_email_provider": "NONE",
    "inbound_email_provider": "NONE",
    "gmail_configured": false
  },
  "current_blockers": [
    "No SPF record is published for dpvinternational.com on either 1.1.1.1 or 8.8.8.8",
    "DKIM selector and activation state have not been obtained from Google Admin",
    "Google sign-in is currently on a rejected page and Gmail manual send/receive/header verification has not run",
    "Gmail OAuth client and user refresh authorization are not configured",
    "Controlled recipient is configured, but receipt/reply verification has not run",
    "No Management Approved opportunity; real prospect sending remains independently gated"
  ],
  "next_allowed_work_package": "Gmail controlled acceptance",
  "explicit_stop_boundary": "STOP after WP-U14; Gmail controlled-address E2E waits for OAuth, SPF and DKIM readiness"
}
```
<!-- CURRENT_PROJECT_STATUS_JSON:END -->

## Status interpretation

- Phase 1–9 are complete.
- Phase 10 code, migrations, UI and automation contracts are verified.
- Phase 10 final acceptance remains incomplete and the business-result state remains NO.
- WP-U00–U14 are complete. The provider-only research policy, canonical continuation, historical compatibility, live browser canary and release handoff have passed. WP15 implementation, migration, local tests and deployed disabled-state verification are complete; its real controlled-address send/reply/CRM E2E remains pending mailbox configuration.
- WP06 provides trustworthy workflow health and QUEUED recovery. WP07 adds the transactional ResearchJob outbox and direct pg-boss execution path while retaining n8n compatibility. WP08 makes `provider_usage_events` the canonical ResearchJob provider-usage source. WP09 separates business strategy attempts, Provider retries and worker recoveries. WP10's historical fair scheduling remains, while WP-A04.2 removes every application-enforced Tavily quantity budget and relies on confirmed Provider account credit state. WP11 expands and validates the verified-company pool. WP12 adds append-only Commercial Product Fit as a non-blocking ranking layer with an independent evidence coverage value. WP13 adds an append-only manual queue for verified official supplier, vendor, procurement and contact routes without granting send or approval permission. WP14 adds an executable GoRules native dependency health check. WP15 adds a gated Gmail API/OAuth provider, stable message identity, database idempotency, ambiguous-send reconciliation, historyId polling, structured DSN handling and existing Phase 7 inbound/CRM reuse.
- Contact qualification now prefers a verified named Buyer but accepts an official company email, business phone or public WhatsApp as a company-level opportunity route. Missing a person name no longer blocks `RECOMMENDED`; email sending remains independently management-approved and verification-gated.

## Execution boundary

The next permitted action is the remaining Gmail controlled-address acceptance. SPF and DKIM must pass and Google sign-in/OAuth must complete before any controlled send. Prospect sending remains off.
