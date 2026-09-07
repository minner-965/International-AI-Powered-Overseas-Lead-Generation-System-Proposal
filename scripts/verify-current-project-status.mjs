import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const statusPath = join(root, 'docs', 'CURRENT_PROJECT_STATUS.md');
const schemaPath = join(root, 'docs', 'current-project-status.schema.json');
const changelogPath = join(root, 'docs', 'VERSION_CHANGELOG.md');
const statusText = readFileSync(statusPath, 'utf8');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const changelog = readFileSync(changelogPath, 'utf8');

const match = statusText.match(/<!-- CURRENT_PROJECT_STATUS_JSON:BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- CURRENT_PROJECT_STATUS_JSON:END -->/);
if (!match) throw new Error('Current project status JSON block is missing');
const status = JSON.parse(match[1]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const key of schema.required) assert(Object.hasOwn(status, key), `Missing current status field: ${key}`);
for (const key of Object.keys(status)) assert(Object.hasOwn(schema.properties, key), `Unknown current status field: ${key}`);
assert(/^[0-9a-f]{40}$/.test(status.commit), 'Current status commit is invalid');
assert(schema.properties.latest_released_phase.enum.includes(status.latest_released_phase), 'Latest released phase is invalid');
assert(['Phase 10', 'Phase 11', 'Phase 12'].includes(status.current_active_phase), 'Current active phase must be a supported exact phase');
const phase12Active = status.current_active_phase === 'Phase 12';
if (phase12Active) {
  const ui = status.phase12_ui;
  assert(ui && typeof ui === 'object' && !Array.isArray(ui), 'Phase 12 UI work-package metadata is required');
  assert(JSON.stringify(ui.scope) === JSON.stringify(['WP-UI15', 'WP-UI16']), 'Phase 12 authorization is limited to cleanup and release handoff');
  assert(ui.prior_release_acceptance === 'PASS', 'Phase 12 must preserve the accepted Phase 11 release');
  if(ui.full_phase_acceptance === 'PASS') {
    assert(ui.status === 'ACCEPTANCE_COMPLETION' && status.final_acceptance_state === 'PASS', 'Phase 12 PASS requires acceptance completion state');
    assert(ui.acceptance_report === 'docs/PHASE12_ACCEPTANCE_COMPLETION.md', 'Phase 12 acceptance report path must be explicit');
    const reportPath=join(root,ui.acceptance_report);
    assert(existsSync(reportPath),'Phase 12 acceptance report is missing');
    const report=readFileSync(reportPath,'utf8');
    const evidenceMatch=report.match(/<!-- PHASE12_ACCEPTANCE_JSON:BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- PHASE12_ACCEPTANCE_JSON:END -->/);
    assert(evidenceMatch,'Phase 12 acceptance requires structured actual evidence');
    const evidence=JSON.parse(evidenceMatch[1]);
    assert(evidence.performance_exception?.accepted_by_user===true && evidence.performance_exception.cold_load_growth_percent===37.48,'Preserve the user accepted specific measured performance exception');
    assert(evidence.reference?.status==='PASS' && evidence.reference.same_viewport===true,'Reference comparison must pass at the same viewport');
    assert(evidence.accessibility?.status==='AUTOMATED_AND_BROWSER_ASSESSED' && evidence.accessibility.human_screen_reader==='NOT_TESTED' && evidence.accessibility.wcag_certification===false,'Accessibility assessment must disclose its human screen-reader and certification limitations');
    for(const [key,value] of Object.entries({reference:'PASS',accessibility:'AUTOMATED_AND_BROWSER_ASSESSED',human_screen_reader:'NOT_TESTED',wcag_certification:false}))assert(ui.accepted_assessment?.[key]===value,'Accepted assessment scope must remain explicit');
    assert(evidence.regression?.failed===0 && Number.isInteger(evidence.regression.passed) && evidence.regression.passed>0,'Actual passing regression evidence required');
    assert(evidence.business?.task_email_sends===0,'UI acceptance must not cause live email sends');
    assert(Array.isArray(evidence.remaining_limitations) && evidence.remaining_limitations.length>0,'Acceptance scope limitations must be disclosed');
    assert(!status.current_blockers.some(item=>item.startsWith('PHASE12_')),'Open Phase 12 blockers preclude acceptance');
    assert(['Phase 11 (Controlled outreach)','Phase 12 (Workspace UI)'].includes(status.latest_released_phase),'Accepted UI does not invent an unrelated release');
    if(status.latest_released_phase==='Phase 12 (Workspace UI)')assert(/^[0-9a-f]{40}$/.test(ui.release?.commit) && ui.release.push==='VERIFIED','Phase 12 released state requires actual verified Git release metadata');
  } else {
    assert(ui.status === 'CLEANUP_AND_RELEASE_HANDOFF' && ui.full_phase_acceptance === 'NOT_ACCEPTED', 'Phase 12 must not claim final acceptance while recorded assessment gaps remain');
    assert(status.latest_released_phase === 'Phase 11 (Controlled outreach)', 'Unaccepted Phase 12 must preserve the accepted Phase 11 release');
    assert(status.final_acceptance_state === 'INCOMPLETE', 'Unaccepted Phase 12 final acceptance remains incomplete');
  }
  assert(status.next_allowed_work_package === 'STOP_AWAIT_PRODUCTION_POLICY', 'Phase 12 must stop after the authorized release handoff');
  assert(ui.stop_after === 'WP-UI16' && status.explicit_stop_boundary.includes('WP-UI16'), 'Phase 12 STOP must name WP-UI16');
  const uiSchema = schema.properties.phase12_ui;
  for (const key of uiSchema.required) assert(Object.hasOwn(ui, key), `Missing Phase 12 UI metadata: ${key}`);
  for (const key of Object.keys(ui)) assert(Object.hasOwn(uiSchema.properties, key), `Unknown Phase 12 UI metadata: ${key}`);
} else assert(!Object.hasOwn(status, 'phase12_ui'), 'Phase 12 metadata requires Phase 12 to be active');
if (status.current_active_phase === 'Phase 10') {
  assert(status.final_acceptance_state === 'PASS', 'Phase 10 pre-email final acceptance must pass');
  assert(status.business_result_state === 'YES', 'Phase 10 pre-email business result must be YES');
  assert(status.next_allowed_work_package === 'POST_PHASE10_EMAIL_CONFIGURATION', 'Next boundary must be post-Phase10 email configuration');
  assert(!Object.hasOwn(status, 'phase11_readiness'), 'Phase 11 readiness requires Phase 11 to be active');
} else {
  assert(['INCOMPLETE','PASS'].includes(status.final_acceptance_state), 'Phase 11 acceptance state is invalid');
  assert(status.business_result_state === 'NO', 'Phase 11 readiness has no outreach business result');
  assert(schema.properties.next_allowed_work_package.enum.includes(status.next_allowed_work_package), 'Phase 11 next work package is invalid');
  const readiness = status.phase11_readiness;
  assert(readiness && typeof readiness === 'object' && !Array.isArray(readiness), 'Phase 11 readiness evidence is missing');
  const expectedOqScope=Array.from({length:17},(_,i)=>`WP-OQ${String(i).padStart(2,'0')}`);
  assert(JSON.stringify(readiness.scope) === JSON.stringify(expectedOqScope), 'Phase 11 readiness scope must record WP-OQ00 through WP-OQ16');
  for (const key of ['wp_oq00','wp_oq01','wp_oq02','wp_oq03','wp_oq04','wp_oq05','wp_oq06','wp_oq07','wp_oq09']) assert(readiness[key] === 'PASS', `Phase 11 ${key} must pass`);
  for(const key of ['wp_oq08','wp_oq12','wp_oq13','wp_oq14','wp_oq15','wp_oq16'])assert(schema.properties.phase11_readiness.properties[key].enum.includes(readiness[key]),`${key} status is invalid`);
  assert(schema.properties.phase11_readiness.properties.wp_oq10.enum.includes(readiness.wp_oq10), 'OQ10 status is invalid');
  assert(schema.properties.phase11_readiness.properties.wp_oq11.enum.includes(readiness.wp_oq11), 'OQ11 status is invalid');
  if(readiness.wp_oq10==='PASS'){
    const controlled=readiness.evidence_summary?.controlled_application_e2e;
    assert(controlled?.smtp_accepted===1 && controlled.inbound_messages>=2 && controlled.opt_out_suppressions>=1,
      'OQ10 PASS requires real accepted send, replies and opt-out evidence');
    assert(controlled.blocked_resend_additional_provider_calls===0, 'OQ10 PASS requires zero-call suppressed resend evidence');
    assert(readiness.evidence_summary?.application_crm_closure?.status==='PASS', 'Full OQ10 PASS requires actual shared application CRM closure, not isolated Activities alone');
  }
  if(readiness.wp_oq08==='PASS'){
    const crm=readiness.evidence_summary?.application_crm_closure;
    assert(crm?.status==='PASS'&&crm.synced_outbox>=2&&crm.opportunity_activities>=2&&crm.sales_tasks>=1&&crm.owner&&crm.historical_due_at,'OQ08 PASS requires actual shared CRM effects, owner and due evidence');
    assert(crm.prospect_crm_rows===0&&crm.worker_restart_replay_created===0,'Controlled CRM acceptance must retain prospect isolation and restart replay proof');
  }
  if(readiness.wp_oq10==='CONTROLLED_SUBSYSTEM_PASS_CRM_INCOMPLETE'){
    assert(status.current_blockers.includes('ACTUAL_APPLICATION_REPLY_TO_CRM_CLOSURE_INCOMPLETE'),'Limited controlled result requires explicit CRM blocker');
    assert(readiness.evidence_summary?.production_crm_closure?.status==='INCOMPLETE','Limited result must retain incomplete CRM evidence');
  }
  const regression=readiness.evidence_summary?.final_regression;
  assert(regression&&regression.tests_total===regression.tests_passed+regression.tests_failed+regression.tests_skipped,'Regression totals must reconcile without treating skips as passes');
  if(['PASS','REGRESSION_PASS_FAULT_FIXTURES'].includes(readiness.wp_oq14))assert(regression.provider_fault_fixture_status==='PASS'&&regression.tests_failed===0&&regression.isolated_postgres_passed===regression.isolated_postgres_checks,'OQ14 acceptance requires passing fault fixtures and isolated checks');
  if(readiness.wp_oq16==='DOCUMENTS_READY_RELEASE_NOT_EXECUTED'){
    for(const key of ['commit','push','acceptance_tag'])assert(readiness.evidence_summary?.release?.[key]==='NOT_EXECUTED',`Unreleased state must not fabricate ${key}`);
  }
  if(status.final_acceptance_state==='PASS' || phase12Active){
    const release=readiness.evidence_summary?.release;
    assert(readiness.wp_oq15==='PASS'&&readiness.wp_oq16==='PASS','Final PASS requires browser and release acceptance');
    assert(/^[0-9a-f]{40}$/.test(release?.commit)&&release.push==='VERIFIED'&&release.acceptance_tag==='phase11-oqumail-controlled-outreach-accepted'&&release.status==='VERIFIED','Final PASS requires actual release commit, verified push and acceptance tag');
    assert(status.latest_released_phase==='Phase 11 (Controlled outreach)' || (phase12Active && status.phase12_ui.full_phase_acceptance==='PASS' && status.latest_released_phase==='Phase 12 (Workspace UI)'), 'Final PASS must preserve verified Phase 11 history or the separately verified accepted Phase 12 release');
  }
  if(['SINGLE_SEND_ACCEPTED_AWAITING_REPLY','PASS'].includes(readiness.wp_oq11)){
    assert(readiness.evidence_summary?.prospect_pilot?.smtp_accepted===1, 'OQ11 sent status requires exactly one accepted pilot');
  }
  assert(/^[0-9a-f]{40}$/.test(readiness.git_baseline?.commit), 'Phase 11 starting Git commit is missing');
  assert(readiness.git_baseline?.dirty === false, 'Phase 11 must preserve the recorded clean starting baseline');
  assert(readiness.evidence_summary && typeof readiness.evidence_summary === 'object'
    && !Array.isArray(readiness.evidence_summary) && Object.keys(readiness.evidence_summary).length > 0, 'Phase 11 evidence summary is missing');
  if(readiness.wp_oq10==='REAL_E2E_PENDING')assert(status.current_blockers.some(item => /APPLICATION_OUTBOUND_E2E_NOT_YET_VERIFIED/.test(item)), 'Pending OQ10 requires its current blocker');
  for (const flag of ['gmail_api_enabled', 'gmail_inbound_sync_enabled']) {
    assert(status.effective_runtime_flags[flag] === false, `Phase 11 readiness flag must remain false: ${flag}`);
  }
  if (phase12Active) {
    assert(status.effective_runtime_flags.outbound_email_enabled===true && status.effective_runtime_flags.outreach_manual_send_only===true && status.effective_runtime_flags.outreach_worker_send_enabled===false, 'Phase 12 must preserve user-authorized manual sending with background delivery closed');
    assert(status.effective_runtime_flags.outreach_send_scope==='PROSPECT_PILOT' && status.effective_runtime_flags.live_prospect_send_approved===true, 'Phase 12 must record actual manual dashboard send scope');
  } else {
    assert(status.effective_runtime_flags.outbound_email_enabled===false && status.effective_runtime_flags.outreach_send_scope==='DISABLED'&&status.effective_runtime_flags.live_prospect_send_approved===false,'Phase 11 historical acceptance leaves prospect sending closed');
  }
  assert(status.effective_runtime_flags.controlled_test_mode===false&&status.effective_runtime_flags.controlled_test_max_messages===0,'Controlled final limit must be zero with controlled mode closed');
  assert(status.provider_configuration.outbound_email_provider === 'SMTP', 'Phase 11 must select the SMTP provider');
  assert(status.provider_configuration.inbound_email_provider === 'IMAP', 'Phase 11 must record IMAP as the inbound protocol');
  assert(status.provider_configuration.mail_provider_vendor === 'OQUMAIL', 'Phase 11 must record the selected company mailbox vendor');
  assert(status.explicit_stop_boundary.includes('WP-OQ09'), 'Phase 11 STOP must name the completed suppression boundary');
}
assert(status.explicit_stop_boundary.includes('STOP'), 'Explicit STOP boundary is missing');
assert(status.explicit_stop_boundary.includes('WP-A16'), 'STOP boundary must record completion through WP-A16');
for (const expected of [
  'Phase 1–9 complete',
  'Phase 10 code/migration/UI/automation verified',
  'Phase 10 pre-email final acceptance passed',
  'WP-U00–U14 complete',
  'WP-A05 category-driven pre-email acceptance Runner passed',
  'WP-A06 real one-action approved-category canary passed',
  'WP-A07 event scheduling, dedupe and periodic reconciliation passed',
  'WP-A08 repeated Create, execution and Provider deduplication passed',
  'WP-A09 worker restart, stale lease and S05 checkpoint recovery passed',
  'WP-A10 Provider-account-only capacity and distinct-strategy exhaustion passed',
  'WP-A11 category evidence, route readiness and Opportunity decision passed',
  'WP-A12 management UI positive and reverse browser paths passed',
  'WP-A13 acceptance XLSX generated and verified',
  'WP-A14 zero-send and reverse safety passed',
  'WP-A15 stuck-task monitoring and automatic convergence passed',
  'WP-A16 final release validation passed'
]) assert(status.phase_state.includes(expected), `Missing phase state: ${expected}`);

assert(/^## phase10\b/m.test(changelog), 'VERSION_CHANGELOG.md has no phase10 entry');
assert(!/Phase\s*6\.1\s*(?:NEXT|下一步)|(?:NEXT|下一步)[^\n]{0,40}Phase\s*6\.1/i.test(statusText), 'Current status points back to Phase 6.1');
assert(!/Work Package\s*15\s*(?:started|已开始)/i.test(statusText), 'Current status incorrectly starts Work Package 15');

const migrationMap = new Map(status.applied_migrations.map(item => [item.migration_key, item.sha256]));
for (const name of [
  '030_phase10_category_scope_and_auto_evidence.sql',
  '031_phase10_controlled_evidence_audit_hardening.sql',
  '032_phase10_category_level_product_opportunity.sql',
  '033_phase10_orchestrator_heartbeat_and_dispatch_diagnostics.sql',
  '034_phase10_research_direct_queue_outbox.sql',
  '035_phase10_provider_usage_projection.sql',
  '036_phase10_provider_usage_export_contract.sql',
  '037_phase10_auto_evidence_strategy_attempts.sql',
  '038_phase10_auto_evidence_checkpoint_replay.sql',
  '039_phase10_tavily_fair_budget.sql',
  '040_phase10_commercial_product_fit.sql',
  '041_phase10_manual_official_route_queue.sql',
  '042_phase10_gmail_api_provider.sql',
  '052_phase11_oqumail_outbound_safety.sql',
  '053_phase11_oqumail_inbound_crm.sql',
  '054_phase11_suppression_closed_loop.sql',
  '055_phase11_controlled_application_context.sql',
  '056_phase11_version_payload_guard_rowtype.sql',
  '057_phase11_controlled_shared_crm.sql'
]) {
  const path = join(root, 'database', 'migrations', name);
  assert(existsSync(path), `Migration is missing: ${name}`);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  assert(migrationMap.get(name) === digest, `Migration checksum mismatch: ${name}`);
}

const git = (...args) => execFileSync('git', [
  '-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args
], { encoding: 'utf8' }).trim();
const implementationHead = git('log', '-1', '--format=%H', '--', '.', ':(exclude)docs/**');
const dirty = git('status', '--porcelain').length > 0;
assert(status.commit === implementationHead, 'Current status commit does not match the latest implementation commit');
assert(status.dirty_at_snapshot === dirty, 'Current status dirty flag does not match the worktree');

const credentialAssignment = /(?:PASSWORD|API_KEY|CLIENT_SECRET|REFRESH_TOKEN|PRIVATE_KEY)\s*[:=]\s*["']?[^\s"'<]+/i;
assert(!credentialAssignment.test(statusText), 'Current status contains a credential-like assignment');
assert(!credentialAssignment.test(JSON.stringify(status.provider_configuration)), 'Provider status contains credential material');

console.log('Current project status verification: PASS');
