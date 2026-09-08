import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PHASE5_QUEUE_NAMES, createPhase5Queue, queueAllowlist } from '../src/jobs/phase5Queue.js';
import { createPhase7QueueHandlers } from '../src/phase7/queueHandlers.js';

const root = new URL('../../../', import.meta.url);
const retired = ['generate-outreach-draft', 'validate-outreach-draft', 'parse-reference-import', 'refresh-opportunity-exception-queue'];

test('CL08 orphan placeholder queues are absent and rejected without dispatch', async () => {
  const handlers = createPhase7QueueHandlers({ service: {} });
  const queue = createPhase5Queue({ env: { PGBOSS_ENABLED: 'false' } });
  for (const name of retired) {
    assert.equal(PHASE5_QUEUE_NAMES.includes(name), false);
    assert.equal(handlers[name], undefined);
    assert.throws(() => queueAllowlist(name), /Unsupported queue allowlist/);
    await assert.rejects(queue.enqueue(name, {}), /Unsupported Phase 5 queue/);
  }
});

test('CL08 current recheck dispatches evidence immediately, not after reconciliation interval', async () => {
  const dispatched = [];
  const handlers = createPhase7QueueHandlers({ service: {
    env: {}, repository: { async refreshOpportunityDecisions() { return { refreshed: 1 }; } },
    queue: { async enqueue(...args) { dispatched.push(args); return 'fixture-job'; } }
  } });
  const result = await handlers['recalculate-business-opportunities']({ company_id: 'fixture-company' });
  assert.equal(result.refreshed, 1);
  assert.equal(dispatched[0][0], 'schedule-auto-evidence');
  assert.equal(dispatched[0][1].schedule_source, 'EVENT');
  assert.equal(dispatched[0][2].startAfter, undefined);
});

test('CL08 retained workflows have intact graph and category identity after display rename', () => {
  const dir = new URL('workflows/', root);
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 4);
  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'));
    const names = new Set(workflow.nodes.map(node => node.name));
    assert.equal(names.size, workflow.nodes.length);
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source), `${file}: ${source}`);
      for (const output of Object.values(outputs).flat(2)) assert.ok(names.has(output.node), `${file}: ${output.node}`);
    }
  }
  const category = JSON.parse(fs.readFileSync(new URL('03-phase6_1-category-procurement-match.json', dir), 'utf8'));
  assert.equal(category.name, 'DPV Target Category Validation');
  assert.equal(category.active, false);
  assert.equal(category.id, 'dpvPhase61CategoryProcurement');
  assert.equal(category.versionId, 'b9524a29-cbe6-48dc-8649-658697e7f37a');
  assert.equal(category.nodes[0].parameters.path, 'dpv-phase6-1-category-procurement-match');
  assert.equal(category.nodes[0].webhookId, 'a4f21375-992d-4bf4-952b-a55734439d73');
});

test('CL08 draft creation and import parsing retain actual synchronous/first-touch paths', () => {
  const service = fs.readFileSync(new URL('services/demo-dashboard/src/phase7/service.js', root), 'utf8');
  const router = fs.readFileSync(new URL('services/demo-dashboard/src/phase7/router.js', root), 'utf8');
  assert.match(service, /await parseXlsxImportBuffer\(buffer,/);
  assert.match(router, /service\.createDraft/);
  assert.match(router, /OUTREACH_RECHECK:PHASE5_QUEUES\.RECALCULATE_BUSINESS_OPPORTUNITIES/);
  assert.equal(PHASE5_QUEUE_NAMES.includes('send-auto-first-touch'), true);
  assert.equal(PHASE5_QUEUE_NAMES.includes('refresh-auto-evidence-exception'), true);
});
