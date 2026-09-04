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
assert(/^[0-9a-f]{40}$/.test(status.commit), 'Current status commit is invalid');
assert(status.latest_released_phase === 'Phase 9', 'Latest released phase must be Phase 9');
assert(status.current_active_phase === 'Phase 10', 'Current active phase must be Phase 10');
assert(status.final_acceptance_state === 'INCOMPLETE', 'Phase 10 final acceptance must remain incomplete');
assert(status.business_result_state === 'NO', 'Business result state must remain NO');
assert(status.next_allowed_work_package === 'Gmail controlled acceptance', 'Next boundary must be Gmail controlled acceptance');
assert(status.explicit_stop_boundary.includes('STOP'), 'Explicit STOP boundary is missing');
assert(status.explicit_stop_boundary.includes('Gmail'), 'STOP boundary must record the Gmail acceptance boundary');
for (const expected of [
  'Phase 1–9 complete',
  'Phase 10 code/migration/UI/automation verified',
  'Phase 10 final acceptance incomplete',
  'WP-U00–U14 complete'
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
  '042_phase10_gmail_api_provider.sql'
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
