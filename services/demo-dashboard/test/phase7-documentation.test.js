import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function read(relative) {
  return fs.readFile(path.join(projectRoot, relative), 'utf8');
}

test('Phase 7 workflow is credential-free and delegates only to the Express internal orchestrator', async () => {
  const text = await read('workflows/04-phase7-controlled-outreach-and-data-exchange.json');
  const workflow = JSON.parse(text);

  assert.equal(workflow.active, false);
  assert.equal(workflow.name, 'DPV Phase 7 Controlled Outreach and Data Exchange');
  assert.deepEqual(
    [...new Set(workflow.nodes.map(node => node.type))].sort(),
    ['n8n-nodes-base.code', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.webhook']
  );
  assert.equal(workflow.nodes.some(node => Object.hasOwn(node, 'credentials')), false);

  const dispatch = workflow.nodes.find(node => node.name === '03 Dispatch to Express');
  assert.ok(dispatch);
  assert.match(dispatch.parameters.url, /\/api\/internal\/phase7\/orchestrate/);
  assert.match(JSON.stringify(dispatch.parameters.headerParameters), /INTERNAL_API_TOKEN/);

  const validate = workflow.nodes.find(node => node.name === '02 Validate Orchestration Request');
  assert.ok(validate);
  for (const action of ['OUTREACH_RECHECK', 'IMPORT_DISCOVER', 'EXPORT_PROCESS', 'CRM_SYNC']) {
    assert.match(validate.parameters.jsCode, new RegExp(action));
  }
  for(const field of ['sourceSha256Before','localSha256','sourceSha256After','sourceMutations','import_type'])assert.match(validate.parameters.jsCode,new RegExp(field));
  assert.match(dispatch.parameters.body,/JSON\.stringify\(\$json\)/);

  assert.doesNotMatch(text, /n8n-nodes-base\.(emailSend|smtp|postgres|readWriteFile|ftp|sftp)/i);
  assert.doesNotMatch(text, /api\.resend\.com|smtp\.|\\\\[^\s"']+/i);
});

test('Phase 7 contracts and final result record the verified release boundary', async () => {
  const required = [
    'docs/PHASE7_REUSE_RESEARCH.md',
    'docs/PHASE7_OUTREACH_POLICY.md',
    'docs/PHASE7_MANAGEMENT_AUTH_CONTRACT.md',
    'docs/PHASE7_OPPORTUNITIES_DECISION_CONTRACT.md',
    'docs/PHASE7_OUTREACH_DATA_CONTRACT.md',
    'docs/PHASE7_DATA_EXCHANGE_CONTRACT.md',
    'docs/PHASE7_RESULT.md',
    'docs/VERSION_CHANGELOG.md',
    'docs/COMPANY_PC_SETUP.md'
  ];

  for (const relative of required) {
    const contents = await read(relative);
    assert.ok(contents.trim().length > 200, `${relative} must contain a substantive contract`);
  }

  const result = await read('docs/PHASE7_RESULT.md');
  assert.match(result, /^状态：`PASS`/m);
  assert.match(result, /LIVE PILOT: NOT STARTED/);
  assert.match(result, /REAL PROSPECT SENDS: 0/);
  assert.match(result, /Provider calls = 0/);
  assert.match(result, /annotated tag `phase7`/);

  const changelog = await read('docs/VERSION_CHANGELOG.md');
  assert.match(changelog, /phase7[^\n]*released/);
  assert.match(changelog, /annotated tag `phase7` were pushed and verified/);
});

test('Phase 6.1 V2 and V3 plans remain restored as historical inputs', async () => {
  for (const filename of [
    'DPV_PHASE6_1_PRODUCT_MATCH_CODEX_PLAN_V2.md',
    'DPV_PHASE6_1_PRODUCT_MATCH_CODEX_PLAN_V3.md'
  ]) {
    const stat = await fs.stat(path.join(projectRoot, filename));
    assert.equal(stat.isFile(), true);
    assert.ok(stat.size > 30_000);
  }
});
