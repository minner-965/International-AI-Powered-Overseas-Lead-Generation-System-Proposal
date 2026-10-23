import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildOpportunityQuery } from '../public/opportunity-ui.js';
import { phase8BlockerGroup } from '../public/ui/status.js';
import { overviewModel } from '../public/ui/v3/overview.js';

const readPublic = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const readMany = names => Promise.all(names.map(readPublic));
const tagWith = (source, attribute, value) => source.match(new RegExp(`<[^>]+${attribute}="${value}"[^>]*>`, 'i'))?.[0] || '';
const position = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `Missing ${token}`);
  return value;
};

const statusValues = ['ACTIVE', 'PRECISION', 'RELEVANT', 'GENERAL_RELEVANT', 'EXPLORATORY', 'MANAGEMENT_APPROVED', 'HOLD', 'NOT_SUITABLE', 'ALL'];
const opportunityFilterNames = [
  'status', 'country', 'product_profile', 'decision_maker_status', 'normalized_role',
  'contact_type', 'contact_verification', 'historical_crm_status', 'management_match_band',
  'historical_match_band', 'buyer_business_model', 'buyer_subtype',
  'category_procurement_match_band', 'category_procurement_match_status',
  'tier', 'feasibility_band', 'sort'
];

test('V4 workspace loads one stylesheet whose tokens precede every component section', async () => {
  const [html, css] = await readMany(['index.html', 'ui/v4/app.css']);
  assert.equal((html.match(/rel="stylesheet"/g) || []).length, 2);
  assert.match(html, /href="\/ui\/v4\/app\.css"/);
  assert.doesNotMatch(html, /href="\/(?:styles|phase5|phase7|bilingual|contact-results)\.css"|href="\/ui\/(?:v3|phase8-|phase9-|phase10-|opportunity-workspace)/);
  assert.ok(position(css, '/* ==== V4 design tokens') < position(css, '/* ==== section: components ==== */'));
  assert.ok(position(css, '/* ==== section: components ==== */') < position(css, '/* ==== section: v4-base ==== */'));
  assert.ok(position(css, '/* ==== section: v4-base ==== */') < position(css, '/* ==== section: shell ==== */'));
  for (const module of ['shell', 'filters', 'contact-queue']) {
    assert.match(html, new RegExp(`src="/ui/${module}\\.js"`));
  }
  assert.match(await readPublic('ui/contact-queue.js'), /from '\.\/status\.js'/);
});

test('Opportunities is the default view and primary navigation is grouped with exactly one active item', async () => {
  const [html, shell] = await readMany(['index.html', 'crm-shell.js']);
  const aside = html.slice(position(html, '<aside id="app-sidebar"'), position(html, '</aside>'));
  const navTags = aside.match(/<button[^>]+data-app-nav="[^"]+"[^>]*>/g) || [];
  const groups = ['工作台', '获客', '跟进', '我的账户', '管理', '数据'].map(group => `<span lang="zh-CN">${group}</span><span lang="en">`);
  for (let index = 1; index < groups.length; index += 1) assert.ok(position(aside, groups[index - 1]) < position(aside, groups[index]));
  assert.equal(navTags.length, 14, 'fourteen primary navigation items in six groups (管理 and 数据 are SIM-only)');
  assert.equal(navTags.filter(tag => /\bactive\b/.test(tag)).length, 1);
  assert.equal(navTags.filter(tag => /aria-current="page"/.test(tag)).length, 1);
  assert.match(tagWith(aside, 'data-app-nav', 'opportunities'), /\bactive\b/);
  assert.match(tagWith(aside, 'data-app-nav', 'opportunities'), /aria-current="page"/);
  assert.doesNotMatch(tagWith(html, 'data-app-view', 'opportunities'), /\shidden(?:\s|>)/);
  assert.match(tagWith(html, 'data-app-view', 'overview'), /\shidden(?:\s|>)/);
  assert.match(shell, /location\.hash\.slice\(1\)\|\|'opportunities'/);
});

test('Contact Queue is a standalone execution view with stable hooks and its existing API', async () => {
  const [html, queue] = await readMany(['index.html', 'ui/contact-queue.js']);
  assert.match(html, /data-app-nav="contact-queue"/);
  assert.match(html, /data-app-view="contact-queue"/);
  assert.match(html, /id="contact-queue-list"/);
  assert.match(queue, /querySelector\('#contact-queue-list'\)/);
  assert.match(queue, /workspaceRequest\('\/api\/workspace\/contact-queue'\)/);
  assert.doesNotMatch(queue, /managementRequest\('\/api\/contact-queue'\)/);
  assert.match(queue, /crm:viewchange/);
  assert.match(queue, /view === 'contact-queue'/);
});

test('Phase 8 preserves stable DOM hooks, form names and API enum values', async () => {
  const [html, app, phase7] = await readMany(['index.html', 'app.js', 'phase7-ui.js']);
  for (const hook of [
    'sidebar-toggle', 'opportunity-table', 'opportunity-sort', 'opportunity-filters', 'start-enrichment',
    'leads', 'detail', 'research-form', 'research-job', 'data-import-form', 'data-export-form'
  ]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of [
    'opportunity-status-tabs', 'opportunity-primary-filters', 'opportunity-advanced-filter-drawer',
    'evidence-required-list', 'contact-queue-list'
  ]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(`${html}\n${app}`, /id="detail-section-nav"/);

  for (const [name, values] of [
    ['country', []],
    ['buyer_type', ['Importer', 'Wholesaler', 'Distributor', 'Department Store', 'Large Retail Group', 'Regional Retail Chain', 'Supermarket']],
    ['import_type', ['PROSPECT_LEADS', 'PRODUCT_MASTER_UPDATE', 'CUSTOMER_DEALS', 'CUSTOMER_DEAL_LINES']],
    ['export_type', ['LEAD_MASTER_INTERNAL', 'SALES_OPPORTUNITY', 'PRODUCT_CATALOG_INTERNAL', 'CUSTOMER_DEAL_HISTORY', 'RESEARCH_JOB_PROVIDER_USAGE', 'IMPORT_ERROR_REPORT']],
    ['mode', ['CURRENT_FILTER', 'FULL_AUTHORIZED_MASTER']],
    ['format', ['XLSX', 'CSV']]
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
    for (const value of values) assert.match(html, new RegExp(`value="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  for (const endpoint of ['/api/research/jobs', '/api/data-imports/dry-run', '/api/data-exports']) {
    assert.ok(`${app}\n${phase7}`.includes(endpoint), `Missing preserved endpoint ${endpoint}`);
  }
  const [batchUi]=await readMany(['ui/v3/research-batch.js']);
  assert.match(batchUi,/id="research-category-all"[^>]*type="checkbox"/);
  assert.match(batchUi,/category_scope_ids/);
  assert.equal((html.match(/name="product_category"/g)||[]).length,0);
  assert.match(app,/querySelectorAll\('input\[name="product_category"\]:checked'\)/);
  assert.match(app,/Promise\.allSettled\(requests\.map/);
});

test('CL03 current opportunity query parameters retain deterministic values after retiring access gates', async () => {
  const [html, filtersUi, components] = await readMany(['index.html', 'ui/filters.js', 'ui/v4/app.css']);
  const filters = Object.fromEntries(opportunityFilterNames.map((name, index) => [name, `VALUE_${index}`]));
  const query = buildOpportunityQuery(filters, 500);
  assert.equal(opportunityFilterNames.length, 17);
  for (const name of opportunityFilterNames) {
    assert.equal(query.get(name), filters[name]);
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.equal(query.get('limit'), '500');
  assert.equal([...query.keys()].filter(key => key !== 'limit').length, 17);
  for (const group of ['Buyer', 'Category match', 'Contact', 'History & reference']) assert.match(filtersUi, new RegExp(`'${group}'`));
  assert.match(filtersUi, /primaryNames\s*=\s*new Set\(\['status', 'country', 'product_profile', 'sort'\]\)/);
  assert.match(filtersUi, /advancedHost\.append\(section\)/);
  assert.match(filtersUi, /data-remove-filter/);
  assert.match(components, /\.crm-filter-chip-list\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('CL03 five bands and independent communication views preserve keyboard filters', async () => {
  const [html, filters, app] = await readMany(['index.html', 'ui/filters.js','app.js']);
  const tabs = html.match(/data-opportunity-status="[^"]+"/g) || [];
  assert.equal(tabs.length, statusValues.length + 2);
  for (const status of ['SENT_NO_REPLY','REPLIED']) assert.equal(tabs.filter(tag => tag === `data-opportunity-status="${status}"`).length,1);
  assert.match(app,/status:presentationView \? 'ALL' : filters.status/);
  for (const status of statusValues) assert.equal(tabs.filter(tag => tag === `data-opportunity-status="${status}"`).length, 1);
  assert.match(tagWith(html, 'data-opportunity-status', 'ACTIVE'), /aria-selected="true"/);
  assert.match(html, /<option value="ACTIVE" selected>/);
  assert.match(tagWith(html, 'data-opportunity-status', 'EXPLORATORY'), /aria-selected="false"/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(filters, new RegExp(`'${key}'`));
  assert.match(filters, /tabIndex\s*=\s*active\s*\?\s*0\s*:\s*-1/);
});

test('V3 Overview preserves Recommended classification and Evidence Required blocker meanings', async () => {
  const [html, app, overview] = await readMany(['index.html', 'app.js', 'ui/v3/overview.js']);
  assert.match(html, /data-app-view="overview"/);
  assert.match(app, /import \{ mountOverview, renderOverview, markOverviewLoading \} from '\.\/ui\/v3\/overview\.js'/);
  const getStatus = row => row.status;
  assert.equal(overviewModel({ opportunities: null, getStatus }).recommended, null);
  assert.equal(overviewModel({ opportunities: [], getStatus }).recommended, 0);
  assert.equal(overviewModel({ opportunities: [{ status: 'RECOMMENDED' }, { status: 'EVIDENCE_REQUIRED' }, { status: 'MANAGEMENT_APPROVED' }], getStatus }).recommended, 1);
  assert.doesNotMatch(overview, /score_desc|scoreCell|tierScore|Top five by current score/);
  if (/phase7ReasonLabel\(/.test(app)) {
    assert.match(app, /import\s*\{[^}]*phase7ReasonLabel[^}]*\}\s*from\s*'\.\/phase7-ui\.js'/s);
  }
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_CONTACT'), ['采购联系人', 'Buyer contact']);
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_BUYER_ROLE'), ['采购职责', 'Buyer role']);
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_EMAIL'), ['邮箱核验', 'Email verification']);
});

test('Opportunities renders eight compact business columns with category score retained and a useful true zero state', async () => {
  const [html, app] = await readMany(['index.html', 'app.js']);
  const tableStart = position(html, 'id="opportunity-table"');
  const table = html.slice(Math.max(0, html.lastIndexOf('<table', tableStart)), html.indexOf('</table>', tableStart) + 8);
  const columnClasses = [
    'op-col-company', 'op-col-market', 'op-col-product-match',
    'op-col-contact', 'op-col-status', 'op-col-activity', 'op-col-owner', 'op-col-action'
  ];
  assert.equal((table.match(/<th\b/g) || []).length, 8);
  for (const label of ['Matched Category','Latest Activity','Owner','Official Contact Channels','Next Action']) assert.match(table,new RegExp(label));
  for (const name of columnClasses) assert.match(table, new RegExp(`class="[^"]*${name}`));
  const renderer = app.slice(position(app, 'function renderOpportunityTable'), position(app, 'async function loadOpportunities'));
  assert.equal((renderer.match(/<td\b/g) || []).length, 8);
  for (const name of columnClasses) assert.match(renderer, new RegExp(`<td class="[^"]*${name}`));
  assert.equal((renderer.match(/opportunityDisplayBadge\(/g) || []).length, 1);
  assert.match(`${html}\n${app}`, /暂无当前业务机会/);
  assert.match(`${html}\n${app}`, /No active business opportunities/);
  assert.match(`${html}\n${app}`, /View exploratory companies/);
  assert.match(app, /EXPLORATORY/);
  assert.match(app, /opportunity-table/);
  assert.match(app, /hidden/);
});

test('opportunity zero and error states never fall back to Company-directory records', async () => {
  const app = await readPublic('app.js');
  const renderStart = position(app, 'function renderOpportunityTable');
  const loadStart = position(app, 'async function loadOpportunities');
  const renderSource = app.slice(renderStart, loadStart);
  const operationSource = app.slice(renderStart, position(app, 'const importStatusLabels'));
  const loadSource = operationSource.slice(operationSource.indexOf('async function loadOpportunities'));
  assert.doesNotMatch(renderSource, /state\.opportunities\.length\s*\?\s*state\.opportunities\s*:\s*state\.leads/);
  assert.doesNotMatch(loadSource, /state\.opportunities\s*=\s*\[\.\.\.state\.leads\]/);
  assert.match(operationSource, /Retry|重试|重新读取/);
  assert.match(loadSource, /opportunity-table/);
});

test('Companies is a master directory without a contact-confirmation bypass or management-approval wording', async () => {
  const [html, app] = await readMany(['index.html', 'app.js']);
  const companyView = html.slice(position(html, 'data-app-view="companies"'), position(html, 'data-app-view="opportunities"'));
  const companyRenderer = app.slice(position(app, 'function renderCompanyTable'), position(app, 'function renderOpportunityTable'));
  const companyRowSource = app.slice(position(app, 'function companyRow'), position(app, 'function bindLeadRows'));
  const companyTableStart = position(companyView, 'class="table table-vcenter card-table crm-table crm-company-table"');
  const companyTable = companyView.slice(companyView.lastIndexOf('<table', companyTableStart), companyView.indexOf('</table>', companyTableStart) + 8);
  assert.equal((companyTable.match(/<th\b/g) || []).length, 8);
  assert.equal((companyRowSource.match(/<td\b/g) || []).length, 8);
  assert.doesNotMatch(companyRowSource, /size-tag|tier-score|scoreCell|tierScore|matchCell/);
  assert.doesNotMatch(`${companyView}\n${companyRenderer}`, /Confirm Contact|确认进入待联系|management-approve/i);
  assert.match(companyRowSource, /View details/);
  assert.match(companyRowSource, /data-lead-id=/);
  assert.match(app, /Confirm Company Record/);
  assert.match(app, /Exclude Company Record/);
  assert.doesNotMatch(app, /Approve manually|人工批准|Saved: approved manually/i);
});

test('company detail exposes eight V3 sections while retaining underlying lazy record panels', async () => {
  const app = await readPublic('app.js');
  assert.match(app, /id="detail-section-nav"/);
  const { companySections } = await import('../public/ui/v3/companies.js');
  assert.deepEqual(companySections.map(section=>section[0]),['snapshot','category-fit','contacts','opportunity','communication','evidence','activity','records']);
  assert.match(app,/upgradeCompanyDetail\(detail\)/);
  for (const legacyPanel of ['product-match', 'outreach-readiness', 'outreach-drafts', 'outreach-messages', 'outreach-replies', 'data-history']) {
    assert.match(app, new RegExp(`id="detail-panel-${legacyPanel}"`));
  }
});

test('Data Import and Data Export communicate explicit step progression without changing contracts', async () => {
  const [html, ui] = await readMany(['index.html', 'phase7-ui.js']);
  const importView = html.slice(position(html, 'data-app-view="data-import"'), position(html, 'data-app-view="data-export"'));
  const exportView = html.slice(position(html, 'data-app-view="data-export"'), position(html, 'data-app-view="settings"'));
  assert.match(importView, /class="[^"]*p8-stepper/);
  assert.equal((importView.match(/<li\b/g) || []).length, 6);
  assert.match(importView, /Select Type (?:&|&amp;) File/);
  for (const label of ['Check', 'Review Rows', 'Submit Approval', 'Approve Version', 'Commit']) assert.match(importView, new RegExp(label));
  assert.match(exportView, /class="[^"]*p8-stepper/);
  assert.equal((exportView.match(/<li\b/g) || []).length, 6);
  for (const label of ['Dataset', 'Scope', 'Format', 'Column permission', 'Generate', 'Download']) assert.match(exportView, new RegExp(label, 'i'));
  for (const id of ['data-import-dry-run', 'data-import-submit', 'data-import-approve', 'data-import-commit', 'data-export-create']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(ui, /\/api\/data-imports/);
  assert.match(ui, /\/api\/data-exports/);
});

test('theme, density and bilingual display preferences preserve light, dark, system, comfortable and compact modes', async () => {
  const [html, shell, p8Shell, tokens] = await readMany(['index.html', 'crm-shell.js', 'ui/shell.js', 'ui/v4/app.css']);
  for (const mode of ['auto', 'light', 'dark']) assert.match(html, new RegExp(`<option value="${mode}"`));
  assert.match(html, /跟随系统 \/ System/);
  for (const density of ['comfortable', 'compact']) assert.match(html, new RegExp(`<option value="${density}"`));
  for (const detail of ['standard', 'compact']) assert.match(html, new RegExp(`<option value="${detail}"`));
  assert.match(shell, /prefers-color-scheme:\s*dark/);
  assert.match(shell, /dpv-theme/);
  assert.match(shell, /dpv-density/);
  assert.match(p8Shell, /dpv-bilingual-detail/);
  assert.match(tokens, /\[data-bs-theme="dark"\]/);
  assert.match(tokens, /\[data-density="compact"\]/);
});

test('all interaction modes retain a 44px target and native zoom', async () => {
  const [html, tokens, foundation, components, shell] = await readMany([
    'index.html', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css'
  ]);
  assert.match(html, /content="width=device-width,initial-scale=1"/);
  assert.doesNotMatch(html, /maximum-scale|minimum-scale|user-scalable/i);
  assert.match(tokens, /--dpv-control-height:\s*44px/);
  assert.match(tokens, /--p8-control-height:\s*var\(--dpv-control-height\)/);
  assert.doesNotMatch(tokens, /--(?:p8|dpv)-control-height:\s*(?:[0-3]?\d|4[0-3])px/);
  assert.match(foundation, /min-height:\s*44px/);
  assert.match(components, /\.crm-status-tab[\s\S]*?min-height:\s*44px/);
  assert.match(shell, /\.v3-nav \.nav-link\s*\{[^}]*min-height:\s*44px/);
  assert.match(shell, /\.m-tab a\s*\{[^}]*min-height:\s*56px/);
  const [companyCss] = await readMany(['ui/v4/app.css']);
  assert.match(companyCss, /\.v3-company-detail-nav button[\s\S]*?min-height:\s*44px/);
});

test('responsive CSS covers all six acceptance viewports without shrinking tables into unreadable columns', async () => {
  const [foundation, pages, responsive] = await readMany([
    'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css'
  ]);
  const v3Shell = await readPublic('ui/v4/app.css');
  const css = `${foundation}\n${pages}\n${responsive}\n${v3Shell}`;
  const viewports = [[1440, 900], [1024, 768], [768, 900], [390, 844], [375, 667], [844, 390]];
  assert.equal(viewports.length, 6);
  for (const query of [
    /@media \(max-width:\s*1100px\)/,
    /@media \(max-width:\s*900px\)/,
    /@media \(max-width:\s*767px\)/,
    /@media \(max-width:\s*390px\)/,
    /@media \(max-height:\s*450px\) and \(orientation:\s*landscape\)/
  ]) assert.match(css, query);
  const opportunityCss = await readPublic('ui/v4/app.css');
  assert.match(opportunityCss, /\.crm-opportunity-table,[\s\S]*?display:\s*grid/);
  assert.match(opportunityCss, /\.crm-opportunity-table thead\s*\{\s*display:\s*none/);
  assert.match(responsive, /env\(safe-area-inset-bottom\)/);
  assert.match(v3Shell, /\.v3-nav\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(v3Shell, /\.m-tab\s*\{[^}]*position:\s*fixed[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(foundation, /\.crm-content,[\s\S]*?min-width:\s*0/);
  assert.match(opportunityCss, /table-layout:\s*fixed/);
});

test('focus, dialog recovery, async status and reduced-motion contracts are explicit', async () => {
  const [html, app, filters, shell, foundation] = await readMany([
    'index.html', 'app.js', 'ui/filters.js', 'crm-shell.js', 'ui/v4/app.css'
  ]);
  assert.match(foundation, /:focus-visible/);
  assert.match(foundation, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(filters, /showModal\(\)/);
  assert.match(filters, /event\.key === 'Escape'|addEventListener\('cancel'/);
  assert.match(filters, /opener\?\.focus/);
  assert.match(`${app}\n${shell}`, /event\.key\s*===\s*'Tab'/);
  assert.match(`${app}\n${shell}`, /restoreFocus|focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy=/);
  for (const tag of html.match(/<button[^>]*class="[^"]*btn-icon[^"]*"[^>]*>/g) || []) assert.match(tag, /aria-label="[^"]+"/);
});

test('Phase 8 company-facing sources contain no gradient, glow, emoji structure, fake metrics or internal narration', async () => {
  const names = [
    'index.html', 'app.js', 'phase7-ui.js', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css',
    'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css', 'ui/v4/app.css',
    'ui/v4/app.css', 'ui/v4/app.css', 'ui/contact-queue.js', 'ui/filters.js', 'ui/shell.js', 'ui/status.js'
  ];
  const sources = (await readMany(names)).join('\n');
  assert.doesNotMatch(sources, /(?:linear|radial|conic)-gradient\s*\(/i);
  assert.doesNotMatch(sources, /\b(?:neon|glow|sparkles?|AI orb)\b/i);
  assert.doesNotMatch(sources, /(?:✨|🚀|🤖|💡|📊|🔥|✅|❌|⭐|🎯|💎)/u);
  assert.doesNotMatch(sources, /1095\.89|43\.06|Lorem ipsum|example\.com/i);
  assert.doesNotMatch(sources, /Demo|真实数据|真实线索|公开数据|Real Data|Real public data|外联已禁用|Outreach disabled|send_status=disabled|抓取|采集|爬取|去重|合并历史数据|历史数据持续保留|规则评分|推断不视为已验证事实|系统保持|不会自动发送/i);
});
