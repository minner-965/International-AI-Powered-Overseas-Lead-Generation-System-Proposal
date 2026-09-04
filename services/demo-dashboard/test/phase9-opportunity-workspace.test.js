import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicFile = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Opportunity Workspace replaces the legacy text-first hero with real decision visuals', async () => {
  const [html, app, module, css] = await Promise.all([
    publicFile('index.html'),
    publicFile('app.js'),
    publicFile('ui/opportunity-workspace.js'),
    publicFile('ui/opportunity-workspace.css')
  ]);
  for (const hook of [
    'opportunity-workspace-summary', 'opportunity-priority-list', 'opportunity-status-chart',
    'opw-result-summary', 'opportunity-status-tabs', 'opportunity-primary-filters', 'opportunity-table'
  ]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(html, /href="\/ui\/opportunity-workspace\.css\?v=20260901"/);
  assert.equal((html.match(/class="opw-kpi is-/g) || []).length, 5);
  assert.match(module, /items\s*\.filter\(item => getStatus\(item\) === 'EVIDENCE_REQUIRED'\)/);
  assert.match(module, /opw-chart-track/);
  assert.match(module, /data-opw-status/);
  assert.match(app, /renderOpportunityWorkspace\(\{[\s\S]*items: allOpportunities[\s\S]*counts: statusCounts/);
  assert.match(app, /setOpportunityResultSummary\(items\.length,selectedStatus\)/);
  assert.match(css, /\.opw-focus-grid\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /\.opw-chart-track\s*>\s*span/);
});

test('Opportunity Workspace keeps the released decision contracts and avoids decorative fake data', async () => {
  const [html, module, css] = await Promise.all([
    publicFile('index.html'),
    publicFile('ui/opportunity-workspace.js'),
    publicFile('ui/opportunity-workspace.css')
  ]);
  const statuses = ['RECOMMENDED', 'EVIDENCE_REQUIRED', 'MANAGEMENT_APPROVED', 'HOLD', 'NOT_SUITABLE', 'ALL'];
  for (const status of statuses) assert.equal((html.match(new RegExp(`data-opportunity-status="${status}"`, 'g')) || []).length, 1);
  assert.equal((html.match(/<th class="op-col-/g) || []).length, 8);
  assert.match(html, /name="contact_verification"/);
  assert.match(html, /id="start-enrichment"/);
  assert.doesNotMatch(`${html}\n${module}\n${css}`, /linear-gradient|radial-gradient/);
  assert.doesNotMatch(module, /Math\.random|mock|demo metric|placeholder metric/i);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
