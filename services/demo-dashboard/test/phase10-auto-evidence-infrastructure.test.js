import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.env.DPV_PROJECT_ROOT
  ? pathToFileURL(`${path.resolve(process.env.DPV_PROJECT_ROOT)}${path.sep}`)
  : new URL('../../../', import.meta.url);
const workflow = JSON.parse(await readFile(new URL('workflows/03-phase10-auto-evidence-reconciliation.json', root), 'utf8'));
const compose = await readFile(new URL('compose.yaml', root), 'utf8');
const envExample = await readFile(new URL('.env.example', root), 'utf8');
const operationsGuide = await readFile(new URL('docs/OPERATIONS_EXPAND_VERIFIED_COMPANY_POOL.md', root), 'utf8');
const queueSource = await readFile(new URL('services/demo-dashboard/src/jobs/phase5Queue.js', root), 'utf8');
const migration = await readFile(new URL('database/migrations/030_phase10_category_scope_and_auto_evidence.sql', root), 'utf8');
const serverSource = await readFile(new URL('services/demo-dashboard/src/server.js', root), 'utf8');
const autoEvidenceSource = await readFile(new URL('services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js', root), 'utf8');
const categoryServiceSource = await readFile(new URL('services/demo-dashboard/src/categoryProcurement/CategoryProcurementService.js', root), 'utf8');

test('Phase 10 reconciliation workflow is inactive-first and hard-gated by environment', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes[0].type, 'n8n-nodes-base.scheduleTrigger');
  assert.equal(workflow.nodes[0].parameters.rule.interval[0].minutesInterval, 30);
  const config = workflow.nodes.find(node => node.name === '02 Apply Activation and Bounds').parameters.jsCode;
  assert.match(config, /AUTO_EVIDENCE_ENABLED\|\|'false'/);
  assert.match(config, /Math\.max\(1,Math\.min\(100/);
  assert.match(config, /reconcile_bucket/);
  const request = workflow.nodes.find(node => node.name === '04 Reconcile Missing Evidence');
  assert.match(request.parameters.url, /\/api\/internal\/auto-evidence\/reconcile/);
  assert.match(request.parameters.headerParameters.parameters[0].value, /INTERNAL_API_TOKEN/);
  assert.doesNotMatch(JSON.stringify(workflow), /api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{16,}/i);
  for(const nodeName of ['03A Record Start Heartbeat','08 Record End Heartbeat','09 Record Failed Heartbeat']){
    const node=workflow.nodes.find(item=>item.name===nodeName);
    assert.equal(node.onError,'continueRegularOutput');
    assert.doesNotMatch(node.parameters.body,/\$execution\.id/);
  }
});

test('deployment defaults use provider-account-only Tavily usage and remain credential-free', () => {
  for (const expected of [
    'AUTO_EVIDENCE_ENABLED=false',
    'AUTO_EVIDENCE_RECONCILE_MINUTES=30',
    'TAVILY_USAGE_POLICY=PROVIDER_ACCOUNT_ONLY'
  ]) assert.match(envExample, new RegExp(expected));
  assert.doesNotMatch(envExample,/TAVILY_INTERNAL_LIMITS|MAX_TAVILY_CREDITS|AUTO_EVIDENCE_MAX_ATTEMPTS|AUTO_EVIDENCE_COMPANY_COOLDOWN/);
  assert.match(compose, /TAVILY_USAGE_POLICY:-PROVIDER_ACCOUNT_ONLY/);
  assert.doesNotMatch(compose, /MAX_TAVILY_CREDITS_PER_RUN_UNITS/);
  assert.doesNotMatch(compose, /AUTO_EVIDENCE_MAX_ATTEMPTS/);
  for (const stage of ['Discovery', 'Identity verification', 'Category evidence', 'Buyer evidence']) {
    assert.match(operationsGuide, new RegExp(stage));
  }
  assert.match(operationsGuide, /Tavily 账户自身/);
  assert.match(operationsGuide, /\/api\/research\/jobs/);
  assert.match(operationsGuide, /\/api\/category-procurement\/jobs/);
  assert.match(operationsGuide, /\/api\/auto-evidence\/controlled-batch/);
  assert.doesNotMatch(operationsGuide, /[A-Z]:\\/);
  assert.doesNotMatch(operationsGuide, /(API_KEY|PASSWORD|CLIENT_SECRET|REFRESH_TOKEN)=[^<\s][^\s]*/);
});

test('non-search workers without a Tavily credential cannot overwrite shared provider state', () => {
  assert.match(serverSource,/if\(httpListenEnabled\|\|searchConfig\.tavilyApiKey\)[\s\S]{0,300}refreshUsage\(\{source:'STARTUP_PROBE'\}\)/);
});

test('worker image uses complete built source instead of two-file bind mount drift', () => {
  assert.doesNotMatch(compose, /\.\/services\/demo-dashboard\/src\/server\.js:\/app\/src\/server\.js/);
  assert.doesNotMatch(compose, /\.\/services\/demo-dashboard\/src\/jobs\/phase5Queue\.js:\/app\/src\/jobs\/phase5Queue\.js/);
  assert.match(compose, /phase7_runtime:\/app\/runtime\/phase7/);
  assert.equal((compose.match(/dpv-phase5-worker-ready\.json/g) || []).length, 3);
});

test('queue topology includes all bounded Phase 10 queues and delayed retry support', () => {
  for (const queue of [
    'schedule-auto-evidence', 'discover-opportunity-evidence', 'normalize-opportunity-category',
    'refresh-category-scope-match', 'find-profile-buyer', 'verify-profile-buyer-email',
    'refresh-business-opportunity-v3', 'refresh-auto-evidence-exception'
  ]) assert.match(queueSource, new RegExp(queue));
  assert.match(queueSource, /options\.startAfter/);
  assert.match(queueSource, /PHASE5_WORKER_HANDLER_MISSING/);
  const categoryAllowlist = compose.match(/category-worker:[\s\S]*?PGBOSS_QUEUE_ALLOWLIST:\s*"([^"]+)"/)?.[1] || '';
  for (const queue of [
    'schedule-auto-evidence', 'discover-opportunity-evidence', 'normalize-opportunity-category',
    'refresh-category-scope-match', 'find-profile-buyer', 'verify-profile-buyer-email',
    'refresh-business-opportunity-v3', 'refresh-auto-evidence-exception'
  ]) assert.ok(categoryAllowlist.split(',').includes(queue), `${queue} missing from category worker allowlist`);
});

test('controlled batches keep role attribution without a browser token challenge', () => {
  assert.match(serverSource,/app\.post\('\/api\/auto-evidence\/controlled-batch',managementAuth\.authenticate/);
  assert.doesNotMatch(serverSource,/controlled-batch',managementAuth\.authenticate,managementAuth\.requireCsrf/);
  assert.match(serverSource,/managementAuth\.requireRoles\('MANAGEMENT','DATA_ADMIN'\)/);
  assert.match(serverSource,/trusted_management:true/);
  assert.match(serverSource,/operator_identity:req\.managementUser\.identity/);
  assert.match(serverSource,/operator_role:req\.managementUser\.role/);
  assert.match(serverSource,/AUTO_EVIDENCE_CONTROLLED_BATCH_AUTH_REQUIRED/);
  assert.doesNotMatch(serverSource,/trusted_internal:true/);
});

test('completion and category approval events carry resolvable lineage instead of anonymous global scans',()=>{
  assert.match(serverSource,/research_job_id:job\.id,batch_size:10/);
  assert.match(serverSource,/category-scope-approved:\$\{result\.id\}[\s\S]{0,180}category_scope_revision_id:result\.id/);
  assert.doesNotMatch(serverSource,/research-job-completed:\$\{job\.id\}`,batch_size:10\s*\}/);
});

test('post-discovery automation is idempotent and terminal provider failures cannot leave a category job running',()=>{
  assert.match(serverSource,/post-discovery-category:\$\{jobId\}/);
  assert.match(serverSource,/route:'CATEGORY_GATE_FIRST'/);
  assert.doesNotMatch(serverSource,/post-discovery-enrichment:\$\{jobId\}/);
  assert.match(serverSource,/idempotencyKey:categoryIdempotencyKey,productProfiles/);
  assert.match(serverSource,/cardinality\(requested_company_ids\)\*cardinality\(product_profiles\) expected/);
  assert.match(serverSource,/POST_DISCOVERY_AUTOMATION_SCHEDULED/);
  assert.match(serverSource,/const terminal=complete\|\|Boolean\(error\)/);
  assert.match(serverSource,/category-procurement-completed:\$\{payload\.job_id\}/);
});

test('an active company-profile task blocks duplicate event scheduling',()=>{
  assert.match(autoEvidenceSource,/prior\.task_status IN \('QUEUED','RUNNING','IN_PROGRESS','RETRY_SCHEDULED'\)/);
});

test('new category calculations return the persisted match id, not a spread buyer id', () => {
  assert.match(categoryServiceSource,/category_procurement_match_result_id:matchRow\.id,buyer_business_model_result_id:buyerRow\.id/);
});

test('migration and orchestrator share exact lifecycle and dual ResearchJob lineage', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS leadgen\.auto_evidence_tasks/);
  assert.match(migration, /category_research_job_id uuid/);
  assert.match(migration, /contact_research_job_id uuid/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS leadgen\.auto_evidence_task_attempts/);
  assert.match(migration, /research_job_id uuid REFERENCES leadgen\.research_jobs/);
  assert.match(migration, /automation_owner text NOT NULL DEFAULT 'SYSTEM'/);
  assert.match(migration, /'BUDGET_PAUSED','COMPLETED','CANCELLED'/);
  assert.match(migration, /'DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE'/);
  assert.match(migration, /prevent_phase10_append_only_mutation/);
});
