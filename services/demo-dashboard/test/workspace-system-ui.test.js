import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readPublic = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('unified workspace assets load last and cover every application view', async () => {
  const [html, module, css] = await Promise.all([
    readPublic('index.html'),
    readPublic('ui/workspace-system.js'),
    readPublic('ui/workspace-system.css')
  ]);
  assert.match(html, /href="\/ui\/workspace-system\.css\?v=20260901-r6"/);
  assert.match(html, /src="\/ui\/workspace-system\.js\?v=20260901"/);
  assert.ok(html.indexOf('/ui/workspace-system.css') > html.indexOf('/ui/opportunity-workspace.css'));
  assert.equal((html.match(/data-app-view="/g) || []).length, 11);
  assert.match(module, /querySelectorAll\('\[data-app-view\]'\)\.forEach\(decoratePageHeader\)/);
  for (const view of ['overview', 'companies', 'contact-queue', 'customer-match', 'evidence', 'jobs', 'data-import', 'data-export', 'settings']) {
    assert.match(module, new RegExp(`(?:'${view}'|${view}):`));
  }
  assert.match(css, /\.crm-panel,[\s\S]*?border-radius:\s*var\(--ws-radius\)/);
  assert.match(css, /#view-settings \.crm-settings-grid/);
  assert.match(css, /#view-companies \.ws-page-head > \.filters/);
});

test('opportunity status navigation uses stacked bilingual labels and responsive rows', async () => {
  const css = await readPublic('ui/workspace-system.css');
  assert.match(css, /\.opw-workspace \.crm-status-tabs\s*\{[^}]*display:\s*grid/);
  assert.match(css, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.crm-status-tab \.bi\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /@media \(max-width:\s*1300px\)[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*?grid-template-columns:\s*1fr/);
});

test('released interface removes narrative and AI-style decision copy while preserving business status hooks', async () => {
  const [html, app, phase7, shell, research] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('phase7-ui.js'),
    readPublic('crm-shell.js'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.doesNotMatch(html, /crm-description|决策工作台|Decision workspace|客户开发决策总览|Priority work/);
  assert.doesNotMatch(`${app}\n${phase7}\n${shell}\n${research}`, /机会判断|Opportunity Decision|系统建议|System recommendation|Decision History|可能合作的原因|Why this company may cooperate|进入难点|Why it may be difficult/);
  assert.doesNotMatch(app, /已核验采购人员或部门|邮箱核验有效/);
  for (const hook of ['opportunity-status-tabs', 'opportunity-filters', 'contact-queue-list', 'data-import-form', 'data-export-form']) {
    assert.match(html, new RegExp(`id="${hook}"`));
  }
  assert.match(html, /建议联系/);
  assert.match(html, /已确认待联系/);
  assert.match(phase7, /Eligibility status/);
  assert.match(phase7, /Status History/);
});

test('record-heavy views use structured adaptive components instead of legacy wide text layouts', async () => {
  const [html, app, research, css] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('ui/phase9-research-workbench.js'),
    readPublic('ui/workspace-system.css')
  ]);
  assert.match(app, /class="crm-op-cell"/);
  assert.match(app, /class="crm-op-cell-details"/);
  assert.match(app, /class="crm-op-coverage-track"/);
  assert.match(app, /class="p8-evidence-row"/);
  assert.match(app, /class="p8-evidence-blocker"/);
  assert.match(app, /class="crm-detail-identity"/);
  assert.match(app, /function detailMetric\(/);
  assert.match(app, /company-col-company/);
  assert.match(app, /data-label="相关机会 \/ Related opportunity"/);
  assert.match(css, /\.opw-workspace \.crm-opportunity-table\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /@media \(max-width:\s*1450px\)[\s\S]*?#view-companies \.crm-company-table tbody[\s\S]*?grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.p8-evidence-row\s*\{[^}]*grid-template-columns/);
  assert.match(css, /#detail \.crm-detail-header\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.p9-inline-state:not\(:empty\)/);
  assert.match(css, /#view-companies \.crm-company-table \.company-col-action\s*\{[\s\S]*?display:\s*grid\s*!important/);
  assert.match(css, /\.crm-detail-action-buttons\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(research, /listPanel\.hidden = true/);
  assert.match(research, /host\.classList\.add\('p9-inline-state'\)/);
  assert.match(research, /host\.classList\.remove\('p9-inline-state','is-error'\)/);
  assert.match(html, /class="table table-vcenter card-table crm-table crm-company-table"/);
});

test('classic data dashboard language is shared by every operational module', async () => {
  const css = await readPublic('ui/workspace-system.css');
  assert.match(css, /Classic data dashboard refinement/);
  assert.match(css, /\.ws-page-icon\s*\{\s*display:\s*none/);
  assert.match(css, /\.opw-page-icon\s*\{\s*display:\s*none/);
  assert.match(css, /border-top:\s*4px solid var\(--metric-accent/);
  assert.match(css, /\.opw-priority-panel\s*\{[^}]*color:\s*var\(--ws-ink\)[^}]*background:\s*var\(--ws-surface\)/);
  assert.match(css, /\.crm-table thead\s*\{\s*background:\s*#f8fafc/);
  assert.match(css, /\.p9-command-header,[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*?\.p9-metric-strip\s*\{\s*grid-template-columns:\s*1fr/);
});
