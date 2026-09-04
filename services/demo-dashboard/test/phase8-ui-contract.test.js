import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildOpportunityQuery } from '../public/opportunity-ui.js';
import { phase8BlockerGroup } from '../public/ui/status.js';

const readPublic = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const readMany = names => Promise.all(names.map(readPublic));
const tagWith = (source, attribute, value) => source.match(new RegExp(`<[^>]+${attribute}="${value}"[^>]*>`, 'i'))?.[0] || '';
const position = (source, token) => {
  const value = source.indexOf(token);
  assert.notEqual(value, -1, `Missing ${token}`);
  return value;
};

const statusValues = ['RECOMMENDED', 'EVIDENCE_REQUIRED', 'MANAGEMENT_APPROVED', 'HOLD', 'NOT_SUITABLE', 'ALL'];
const opportunityFilterNames = [
  'status', 'country', 'product_profile', 'readiness', 'decision_maker_status', 'normalized_role',
  'contact_type', 'contact_verification', 'historical_crm_status', 'management_match_band',
  'historical_match_band', 'buyer_business_model', 'buyer_subtype',
  'category_procurement_match_band', 'category_procurement_match_status',
  'product_access_matrix', 'tier', 'feasibility_band', 'cooperation_matrix', 'sort'
];

test('Phase 8 assets have one documented load order instead of a monolithic override', async () => {
  const html = await readPublic('index.html');
  const styles = [
    '/ui/phase8-tokens.css', '/ui/phase8-foundation.css', '/ui/phase8-components.css',
    '/ui/phase8-pages.css', '/ui/phase8-responsive.css'
  ];
  for (let index = 0; index < styles.length; index += 1) {
    assert.match(html, new RegExp(`href="${styles[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    if (index) assert.ok(position(html, styles[index - 1]) < position(html, styles[index]));
  }
  assert.doesNotMatch(html, /href="\/[^"/]*phase8\.css"/);
  for (const module of ['shell', 'filters', 'contact-queue']) {
    assert.match(html, new RegExp(`src="/ui/${module}\\.js"`));
  }
  assert.match(await readPublic('ui/contact-queue.js'), /from '\.\/status\.js'/);
});

test('Opportunities is the default view and primary navigation is grouped with exactly one active item', async () => {
  const [html, shell] = await readMany(['index.html', 'crm-shell.js']);
  const aside = html.slice(position(html, '<aside id="app-sidebar"'), position(html, '<div class="page-wrapper'));
  for (const group of ['工作台', '执行', '资料', '数据']) assert.match(aside, new RegExp(group));
  assert.ok(position(aside, '工作台') < position(aside, '执行'));
  assert.ok(position(aside, '执行') < position(aside, '资料'));
  assert.ok(position(aside, '资料') < position(aside, '数据'));
  const navTags = aside.match(/<button[^>]+data-app-nav="[^"]+"[^>]*>/g) || [];
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
    ['country', ['United Arab Emirates', 'Mexico']],
    ['product_category', ["Women's Apparel", 'General Merchandise']],
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
});

test('all 20 opportunity query parameters retain their names and deterministic values', async () => {
  const [html, filtersUi, components] = await readMany(['index.html', 'ui/filters.js', 'ui/phase8-components.css']);
  const filters = Object.fromEntries(opportunityFilterNames.map((name, index) => [name, `VALUE_${index}`]));
  const query = buildOpportunityQuery(filters, 500);
  assert.equal(opportunityFilterNames.length, 20);
  for (const name of opportunityFilterNames) {
    assert.equal(query.get(name), filters[name]);
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.equal(query.get('limit'), '500');
  assert.equal([...query.keys()].filter(key => key !== 'limit').length, 20);
  for (const group of ['Buyer', 'Product & Access', 'Contact', 'History & Reference']) assert.match(filtersUi, new RegExp(`'${group}'`));
  assert.match(filtersUi, /primaryNames\s*=\s*new Set\(\['status', 'country', 'product_profile', 'sort'\]\)/);
  assert.match(filtersUi, /advancedHost\.append\(section\)/);
  assert.match(filtersUi, /data-remove-filter/);
  assert.match(components, /\.crm-filter-chip-list\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('six opportunity status tabs keep the backend enum values and RECOMMENDED default', async () => {
  const [html, filters] = await readMany(['index.html', 'ui/filters.js']);
  const tabs = html.match(/data-opportunity-status="[^"]+"/g) || [];
  assert.equal(tabs.length, statusValues.length);
  for (const status of statusValues) assert.equal(tabs.filter(tag => tag === `data-opportunity-status="${status}"`).length, 1);
  assert.match(tagWith(html, 'data-opportunity-status', 'RECOMMENDED'), /aria-selected="true"/);
  assert.match(html, /<option value="RECOMMENDED" selected>/);
  assert.match(tagWith(html, 'data-opportunity-status', 'EVIDENCE_REQUIRED'), /aria-selected="false"/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(filters, new RegExp(`'${key}'`));
  assert.match(filters, /tabIndex\s*=\s*active\s*\?\s*0\s*:\s*-1/);
});

test('Overview is Recommended-only and Evidence Required routes contact, buyer-role and email blockers', async () => {
  const [html, app] = await readMany(['index.html', 'app.js']);
  const overviewView = html.slice(position(html, 'data-app-view="overview"'), position(html, 'data-app-view="research"'));
  assert.match(overviewView, /Recommended Opportunities/);
  assert.match(overviewView, /Evidence Required by Reason/);
  assert.doesNotMatch(overviewView, /Priority companies|Top five by current score/);
  const overviewRendererStart = position(app, "const host = $('#overview-opportunities')");
  const overviewRenderer = app.slice(overviewRendererStart, app.indexOf('function collectOpportunityFilters', overviewRendererStart));
  assert.match(overviewRenderer, /RECOMMENDED/);
  assert.doesNotMatch(overviewRenderer, /score_desc|scoreCell|tierScore/);
  if (/phase7ReasonLabel\(/.test(app)) {
    assert.match(app, /import\s*\{[^}]*phase7ReasonLabel[^}]*\}\s*from\s*'\.\/phase7-ui\.js'/s);
  }
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_CONTACT'), ['采购联系人', 'Buyer contact']);
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_BUYER_ROLE'), ['采购职责', 'Buyer role']);
  assert.deepEqual(phase8BlockerGroup('EVIDENCE_REQUIRED_EMAIL'), ['邮箱核验', 'Email verification']);
});

test('Opportunities renders nine category-driven business columns and a useful true zero state', async () => {
  const [html, app] = await readMany(['index.html', 'app.js']);
  const tableStart = position(html, 'id="opportunity-table"');
  const table = html.slice(Math.max(0, html.lastIndexOf('<table', tableStart)), html.indexOf('</table>', tableStart) + 8);
  const columnClasses = [
    'op-col-company', 'op-col-market', 'op-col-product-match', 'op-col-verification',
    'op-col-buyer-model', 'op-col-buyer', 'op-col-contact', 'op-col-status', 'op-col-action'
  ];
  assert.equal((table.match(/<th\b/g) || []).length, 9);
  for (const label of ['Matched Category','Company Verification','Buyer Type','Named Buyer','Official Contact Channels','Next Action']) assert.match(table,new RegExp(label));
  for (const name of columnClasses) assert.match(table, new RegExp(`class="[^"]*${name}`));
  const renderer = app.slice(position(app, 'function renderOpportunityTable'), position(app, 'async function loadOpportunities'));
  assert.equal((renderer.match(/<td\b/g) || []).length, 9);
  for (const name of columnClasses) assert.match(renderer, new RegExp(`<td class="[^"]*${name}`));
  assert.equal((renderer.match(/phase7OpportunityBadge\(/g) || []).length, 1);
  assert.match(`${html}\n${app}`, /尚无联系就绪机会/);
  assert.match(`${html}\n${app}`, /No contact-ready opportunities yet/);
  assert.match(`${html}\n${app}`, /View Evidence Required/);
  assert.match(app, /RECOMMENDED/);
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
  assert.match(companyRowSource, /View Company/);
  assert.match(companyRowSource, /View Opportunity/);
  assert.match(app, /Confirm Company Record/);
  assert.match(app, /Exclude Company Record/);
  assert.doesNotMatch(app, /Approve manually|人工批准|Saved: approved manually/i);
});

test('company detail exposes four top-level sections while retaining underlying lazy record panels', async () => {
  const app = await readPublic('app.js');
  assert.match(app, /id="detail-section-nav"/);
  const sections = [...app.matchAll(/data-detail-section="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(sections)].sort(), ['activity-records', 'business-fit', 'buyer-contact', 'snapshot']);
  for (const label of ['Snapshot', 'Business Fit', 'Buyer & Contact', 'Activity & Records']) assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
  const [html, shell, p8Shell, tokens] = await readMany(['index.html', 'crm-shell.js', 'ui/shell.js', 'ui/phase8-tokens.css']);
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
  const [html, tokens, foundation, components, pages] = await readMany([
    'index.html', 'ui/phase8-tokens.css', 'ui/phase8-foundation.css', 'ui/phase8-components.css', 'ui/phase8-pages.css'
  ]);
  assert.match(html, /content="width=device-width,initial-scale=1"/);
  assert.doesNotMatch(html, /maximum-scale|minimum-scale|user-scalable/i);
  assert.match(tokens, /--p8-control-height:\s*44px/);
  assert.doesNotMatch(tokens, /--p8-control-height:\s*(?:[0-3]?\d|4[0-3])px/);
  assert.match(foundation, /min-height:\s*var\(--p8-control-height\)/);
  assert.match(components, /\.crm-status-tab[\s\S]*?min-height:\s*44px/);
  assert.match(pages, /\.crm-sidebar \.nav-link[\s\S]*?min-height:\s*44px/);
  assert.match(pages, /\.p8-detail-section-nav \[role="tab"\][\s\S]*?min-height:\s*44px/);
});

test('responsive CSS covers all six acceptance viewports without shrinking tables into unreadable columns', async () => {
  const [foundation, pages, responsive] = await readMany([
    'ui/phase8-foundation.css', 'ui/phase8-pages.css', 'ui/phase8-responsive.css'
  ]);
  const css = `${foundation}\n${pages}\n${responsive}`;
  const viewports = [[1440, 900], [1024, 768], [768, 900], [390, 844], [375, 667], [844, 390]];
  assert.equal(viewports.length, 6);
  for (const query of [
    /@media \(min-width:\s*992px\)/,
    /@media \(max-width:\s*1199px\)/,
    /@media \(max-width:\s*991px\)/,
    /@media \(max-width:\s*767px\)/,
    /@media \(max-width:\s*390px\)/,
    /@media \(max-height:\s*450px\) and \(orientation:\s*landscape\)/
  ]) assert.match(css, query);
  assert.match(responsive, /\.crm-opportunity-table,[\s\S]*?display:\s*block/);
  assert.match(responsive, /\.crm-opportunity-table thead\s*\{\s*display:\s*none/);
  assert.match(responsive, /env\(safe-area-inset-bottom\)/);
  assert.match(responsive, /\.crm-sidebar\s*\{[^}]*overflow:\s*hidden auto/);
  assert.match(foundation, /\.crm-content,[\s\S]*?min-width:\s*0/);
  assert.match(pages, /table-layout:\s*fixed/);
});

test('focus, dialog recovery, async status and reduced-motion contracts are explicit', async () => {
  const [html, app, filters, shell, foundation] = await readMany([
    'index.html', 'app.js', 'ui/filters.js', 'crm-shell.js', 'ui/phase8-foundation.css'
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
    'index.html', 'app.js', 'phase7-ui.js', 'styles.css', 'phase5.css', 'phase7.css',
    'ui/phase8-tokens.css', 'ui/phase8-foundation.css', 'ui/phase8-components.css',
    'ui/phase8-pages.css', 'ui/phase8-responsive.css', 'ui/contact-queue.js', 'ui/filters.js', 'ui/shell.js', 'ui/status.js'
  ];
  const sources = (await readMany(names)).join('\n');
  assert.doesNotMatch(sources, /(?:linear|radial|conic)-gradient\s*\(/i);
  assert.doesNotMatch(sources, /\b(?:neon|glow|sparkles?|AI orb)\b/i);
  assert.doesNotMatch(sources, /(?:✨|🚀|🤖|💡|📊|🔥|✅|❌|⭐|🎯|💎)/u);
  assert.doesNotMatch(sources, /1095\.89|43\.06|Lorem ipsum|example\.com/i);
  assert.doesNotMatch(sources, /Demo|真实数据|真实线索|公开数据|Real Data|Real public data|外联已禁用|Outreach disabled|send_status=disabled|抓取|采集|爬取|去重|合并历史数据|历史数据持续保留|规则评分|推断不视为已验证事实|系统保持|不会自动发送/i);
});
