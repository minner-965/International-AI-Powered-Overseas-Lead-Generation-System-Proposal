import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cssSection, tokenCss } from './v4-css.js';

const readPublic = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('V3 workspace assets replace the old global layer and retain every application view', async () => {
  const [html, module, css] = await Promise.all([
    readPublic('index.html'),
    readPublic('crm-shell.js'),
    readPublic('ui/v4/app.css')
  ]);
  assert.doesNotMatch(html, /(?:href|src)="\/ui\/workspace-system\.(?:css|js)/);
  assert.match(html, /href="\/ui\/v4\/app\.css"/);
  for (const section of ['components', 'opportunities', 'shared-components', 'overview', 'v4-base', 'shell']) assert.match(css, new RegExp(`/\\* ==== section: ${section} ==== \\*/`));
  assert.equal((html.match(/data-app-view="/g) || []).length, 16);
  for (const view of ['tasks', 'followups', 'me']) assert.match(html, new RegExp(`data-app-view="${view}"`));
  assert.match(html,/data-app-nav="replies"/);
  assert.match(html,/data-app-nav="contact-ready"/);
  assert.match(module,/views\['contact-ready'\]/);
  assert.match(module, /querySelectorAll\('\[data-app-view\]'\)/);
  assert.match(module, /crm:viewchange/);
  for (const view of ['overview', 'companies', 'contact-queue', 'customer-match', 'evidence', 'jobs', 'data-import', 'data-export', 'settings']) {
    assert.match(module, new RegExp(`(?:'${view}'|${view}):`));
  }
  assert.match(css, /\.crm-panel,[\s\S]*?border-radius:\s*var\(--dpv-radius-panel\)/);
  assert.match(css, /background:\s*var\(--dpv-surface\)/);
});

test('opportunity status navigation uses stacked bilingual labels and compact phone scrolling', async () => {
  const css = await readPublic('ui/v4/app.css');
  assert.match(css, /\.opw-workspace \.crm-status-tabs\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.opw-workspace \.crm-status-tabs\s*\{[^}]*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(await readPublic('ui/v4/app.css'), /\.bi\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.opw-workspace \.crm-status-tab\s*\{[^}]*min-height:\s*52px/);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.crm-opportunity-table tbody/);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.crm-status-tabs[^}]*overflow-x:auto/);
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
  assert.match(html, /业务机会/);
  assert.match(html, /已授权邮件联系/);
  assert.match(phase7, /Eligibility status/);
  assert.match(phase7, /Status History/);
});

test('record-heavy views use structured adaptive components instead of legacy wide text layouts', async () => {
  const [html, app, research, css] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('ui/phase9-research-workbench.js'),
    readPublic('ui/v4/app.css')
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
  const opportunityCss=await readPublic('ui/v4/app.css');
  assert.match(opportunityCss, /\.opw-workspace \.crm-opportunity-table\s*\{[^}]*min-width:\s*1180px/);
  assert.match(opportunityCss, /@media \(max-width: 767px\)[\s\S]*?\.crm-opportunity-table tbody\s*\{[^}]*min-width:0/);
  const companyCss = await readPublic('ui/v4/app.css');
  assert.match(companyCss, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.crm-company-table tbody[\s\S]*?display:grid/);
  assert.match(css, /\.p8-evidence-row\s*\{[^}]*grid-template-columns/);
  assert.match(companyCss, /\.v3-company-detail \.crm-detail-header\s*\{[^}]*display:flex/);
  assert.match(css, /\.p9-inline-state:not\(:empty\)/);
  assert.match(companyCss, /\.crm-company-table \.company-col-action\s*\{[^}]*display:block/);
  assert.match(companyCss, /\.crm-detail-action-buttons\s*\{[^}]*display:flex[^}]*flex-wrap:wrap/);
  assert.match(research, /listPanel\.hidden = true/);
  assert.match(research, /host\.classList\.add\('p9-inline-state'\)/);
  assert.match(research, /host\.classList\.remove\('p9-inline-state','is-error'\)/);
  assert.match(html, /class="table table-vcenter card-table crm-table crm-company-table"/);
});

test('V4 reference colors, bilingual hierarchy and overview proportions replace old visual conventions', async () => {
  const tokens = tokenCss(); const foundation = cssSection('v4-base'); const overview = cssSection('overview');
  for (const [name, value] of [['canvas', '#f3f5f8'], ['surface', '#ffffff'], ['sidebar', '#1b2230'], ['primary', '#2563eb']]) {
    assert.match(tokens, new RegExp(`--dpv-${name}:\\s*${value}`, 'i'));
  }
  assert.match(foundation, /\.bi > \[lang="en"\]\s*\{[^}]*color: var\(--text-3\)[^}]*font-size: \.86em; font-weight: 400/);
  assert.match(cssSection('shell'), /\.nav \.nav-link \.bi\s*\{[^}]*flex-direction:\s*column/);
  assert.match(overview, /grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(overview, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(overview, /v3-overview-analysis>section:first-child\{grid-column:span 2\}/);
  assert.match(overview, /@media\s*\(max-width:\s*700px\)/);
  assert.doesNotMatch(`${tokens}\n${foundation}\n${overview}`, /#5146e5|#4338ca|linear-gradient|shimmer/i);
});
