import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  activeFilterCount,
  buildVerificationQuery,
  businessStatusLabel,
  confidencePercent,
  marketSelection,
  partitionVerifications,
  presetFilters,
  researchStatusLabel,
  sizeLabel,
  verificationStatusLabel
} from '../public/verification-ui.js';
import { MARKET_VISIBILITY, filterVisibleMarkets, hiddenMarketCodes, isMarketVisible, visibleMarketCodes } from '../public/market-visibility.js';
import {
  activeOpportunityFilterCount,
  buildOpportunityQuery,
  contactVerificationLabel as opportunityContactVerificationLabel,
  cooperationMatrixLabel,
  contactTypeLabel,
  feasibilityBandLabel,
  normalizedRoleLabel,
  opportunityReadinessLabel,
  sourceTypeLabel,
  systemReasonLabel
} from '../public/opportunity-ui.js';

test('research market selection supports AE, MX and BD', () => {
  assert.deepEqual(marketSelection('United Arab Emirates'), { country_code:'AE', country_name:'United Arab Emirates' });
  assert.deepEqual(marketSelection('AE'), { country_code:'AE', country_name:'United Arab Emirates' });
  assert.deepEqual(marketSelection('Mexico'), { country_code:'MX', country_name:'Mexico' });
  assert.deepEqual(marketSelection('MX'), { country_code:'MX', country_name:'Mexico' });
  assert.deepEqual(marketSelection('Bangladesh'), { country_code:'BD', country_name:'Bangladesh' });
  assert.deepEqual(marketSelection('BD'), { country_code:'BD', country_name:'Bangladesh' });
});

test('management UI hides BD through a reversible market-visibility switch', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.deepEqual(visibleMarketCodes(), ['AE','MX']);
  assert.deepEqual(hiddenMarketCodes(), ['BD']);
  assert.equal(isMarketVisible('BD'), false);
  assert.equal(isMarketVisible('AE'), true);
  assert.equal(isMarketVisible(''), true);
  assert.equal(MARKET_VISIBILITY.BD, false);
  assert.deepEqual(filterVisibleMarkets(['AE','MX','BD']), ['AE','MX']);
  assert.match(html, /<option(?=[^>]*data-country-code="BD")(?=[^>]*hidden)(?=[^>]*disabled)[^>]*>/);
});

test('research lifecycle labels include Phase 4 crawling and qualifying states', () => {
  assert.deepEqual(researchStatusLabel('CRAWLING'), ['正在核验企业页面','Verifying company pages']);
  assert.deepEqual(researchStatusLabel('QUALIFYING'), ['正在评估企业','Assessing companies']);
  assert.deepEqual(researchStatusLabel('COMPLETED'), ['已完成','Completed']);
});

test('company size and verification labels include enterprise without Tier semantics', () => {
  assert.deepEqual(sizeLabel('enterprise'), ['企业集团','Enterprise group']);
  assert.deepEqual(sizeLabel('SMALL'), ['小型企业','Small business']);
  assert.deepEqual(verificationStatusLabel('VERIFIED_BUSINESS'), ['企业已核验','Verified business']);
  assert.equal(verificationStatusLabel('VERIFIED_BUSINESS').join(' ').includes('Tier'), false);
  assert.deepEqual(businessStatusLabel('SUPPORTED'), ['有依据支持','Supported']);
});

test('verification filter query preserves supported combined and boolean filters', () => {
  const query = buildVerificationQuery({
    company_size:'SMALL,MEDIUM', partnership_accessibility:'HIGH', strategic_account:'false',
    contactable:'true', business_type:'distributor', business_type_status:'VERIFIED', ignored:'value'
  });
  assert.equal(query.get('company_size'), 'SMALL,MEDIUM');
  assert.equal(query.get('partnership_accessibility'), 'HIGH');
  assert.equal(query.get('strategic_account'), 'false');
  assert.equal(query.get('contactable'), 'true');
  assert.equal(query.get('business_type'), 'distributor');
  assert.equal(query.get('business_type_status'), 'VERIFIED');
  assert.equal(query.get('ignored'), null);
  assert.equal(query.get('limit'), '100');
});

test('management buckets retain both SME regional and strategic visibility', () => {
  const overlap = { id:'both', sme_relevance:'HIGH', partnership_accessibility:'MEDIUM', strategic_account:true };
  const items = [
    overlap,
    { id:'sme', sme_relevance:'MEDIUM', partnership_accessibility:'HIGH', strategic_account:false },
    { id:'strategic', sme_relevance:'LOW', partnership_accessibility:'LOW', strategic_account:true },
    { id:'review', sme_relevance:'UNKNOWN', partnership_accessibility:'UNKNOWN', strategic_account:false }
  ];
  const buckets = partitionVerifications(items);
  assert.deepEqual(buckets.smeRegional.map(item => item.id), ['both','sme']);
  assert.deepEqual(buckets.strategic.map(item => item.id), ['both','strategic']);
  assert.deepEqual(buckets.other.map(item => item.id), ['review']);
});

test('common verification presets are deterministic and count active filters', () => {
  assert.deepEqual(presetFilters('verified_distributor'), { business_type:'distributor', business_type_status:'VERIFIED' });
  assert.deepEqual(presetFilters('small_medium'), { company_size:'SMALL,MEDIUM' });
  assert.deepEqual(presetFilters('all'), {});
  assert.equal(activeFilterCount({ company_size:'SMALL', contactable:'true', verification_status:'' }), 2);
  assert.equal(confidencePercent(0.754), '75%');
  assert.equal(confidencePercent(9), '100%');
});

test('research form exposes country selector and optional city and region fields', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /<select(?=[^>]*id="research-country")(?=[^>]*name="country")(?=[^>]*required)[^>]*>/);
  assert.match(html, /data-country-code="AE"/);
  assert.match(html, /data-country-code="MX"/);
  assert.match(html, /data-country-code="BD"[^>]*hidden[^>]*disabled/);
  assert.match(html, /<input(?=[^>]*id="research-city")(?=[^>]*name="city")[^>]*>/);
  assert.match(html, /<input(?=[^>]*id="research-region")(?=[^>]*name="region")[^>]*>/);
  assert.match(app, /\$\('#research-city'\)\.value = '';/);
  assert.match(app, /\$\('#research-region'\)\.value = '';/);
});

test('CRM shell presents currently visible markets without a fixed city in navigation context', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const shellContext = html.slice(html.indexOf('<aside id="app-sidebar"'), html.indexOf('<div class="page-wrapper'));
  assert.match(shellContext, /AE \/ MX/);
  assert.match(shellContext, /UAE and Mexico/);
  assert.equal(/Bangladesh|孟加拉国|AE \/ MX \/ BD/.test(shellContext), false);
  assert.equal(/Dubai|迪拜/.test(shellContext), false);
});

test('Phase 4 frontend includes both management buckets and no Phase 4 Tier output', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const phase4Start = app.indexOf('function verificationBucket');
  const phase4End = app.indexOf('function renderResearchJob');
  const phase4Source = app.slice(phase4Start, phase4End);
  assert.match(phase4Source, /SME \/ Regional Opportunities/);
  assert.match(phase4Source, /Strategic Accounts/);
  assert.equal(/Tier|lead_score/.test(phase4Source), false);
});

test('research result display removes legacy null placeholders without rewriting evidence', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /normalized\.toLowerCase\(\) === 'null'/);
  assert.match(app, /map\(item=>displayQuery\(item\.query\)\)/);
  assert.match(app, /map\(displayValue\)\.filter\(Boolean\)/);
});

test('Phase 5 uses the pinned Tabler shell with the complete CRM information architecture', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/vendor\/tabler\/css\/tabler\.min\.css"/);
  assert.match(html, /href="\/vendor\/tabler-icons\/tabler-icons\.min\.css"/);
  assert.match(html, /class="navbar navbar-vertical navbar-expand-lg crm-sidebar"/);
  for (const view of ['overview','research','companies','opportunities','customer-match','evidence','jobs','settings']) {
    assert.match(html, new RegExp(`data-app-nav="${view}"`));
    assert.match(html, new RegExp(`data-app-view="${view}"`));
  }
});

test('Phase 5 preserves stable business hooks and adds locally persisted display controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../public/crm-shell.js', import.meta.url), 'utf8');
  for (const id of ['reset','metrics','leads','tier','size','detail','research-form','research-job','verification-detail']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(shell,/localStorage\.getItem/);
  assert.match(shell,/dpv-density/);
  assert.match(shell,/dpv-theme/);
  assert.match(shell,/dataset\.bsTheme/);
});

test('company detail extends the CRM tabs for buying contacts and feasibility while keeping existing scores separate', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const tab of ['overview','buying','feasibility','evidence','contacts','social','matching','scoring','history']) assert.equal(app.includes(`['${tab}'`),true);
  assert.match(app,/\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/customer-match/);
  assert.match(app,/\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/score/);
  assert.match(app,/\/api\/leads\/\$\{encodeURIComponent\(companyId\)\}\/decision-makers/);
  assert.match(app,/\/api\/leads\/\$\{encodeURIComponent\(companyId\)\}\/contact-routes/);
  assert.match(app,/\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/cooperation-feasibility/);
  assert.match(html,/Customer Match and DPV Score remain separate/);
});

test('company detail offers explicit dismissal paths and restores focus to its opener', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app,/返回客户列表/);
  assert.match(app,/Back to customer list/);
  assert.match(app,/data-detail-close/);
  assert.match(app,/querySelectorAll\('\[data-detail-close\]'\)/);
  assert.match(app,/addEventListener\('cancel'/);
  assert.match(app,/event\.key !== 'Escape'/);
  assert.match(app,/event\.target !== detailDialog/);
  assert.match(app,/getBoundingClientRect\(\)/);
  assert.match(app,/detailTrigger/);
  assert.match(app,/originalTrigger\?\.isConnected/);
  assert.match(app,/usableReplacement/);
  assert.match(app,/usableCurrentLead/);
});

test('company approval actions expose scoped saving and failure feedback', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app,/class="crm-detail-action-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(app,/actions\?\.setAttribute\('aria-busy','true'\)/);
  assert.match(app,/buttons\.forEach\(action=>\{ action\.disabled=true;/);
  assert.match(app,/正在保存审核结果/);
  assert.match(app,/审核结果保存失败，请重试/);
  assert.match(app,/await json\(`\/api\/leads\/\$\{encodeURIComponent\(id\)\}\/approval`, \{ method:'PATCH'/);
  assert.match(app,/body:JSON\.stringify\(\{status\}\)/);
  assert.match(app,/await Promise\.allSettled\(\[showLead\(id\), loadMetrics\(\)\]\)/);
  assert.match(app,/if \(detailRefresh\.status === 'rejected'\) throw detailRefresh\.reason/);
  assert.match(app,/if \(actions\?\.isConnected\) actions\.setAttribute\('aria-busy','false'\)/);
  assert.match(app,/已保存：人工批准/);
  assert.match(app,/Saved: rejected/);
});

test('workspace navigation preserves return paths and mobile controls retain focus semantics', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../public/crm-shell.js', import.meta.url), 'utf8');
  assert.match(shell,/history\.pushState/);
  assert.match(shell,/window\.scrollTo\(\{top:0,left:0,behavior:'auto'\}\)/);
  assert.match(shell,/setAttribute\('inert',''\)/);
  assert.match(shell,/closeSidebar\(\{restoreFocus:true\}\)/);
  assert.match(shell,/切换到舒适模式 Switch to comfortable density/);
  assert.match(html,/id="density-toggle"[^>]*aria-label="切换到紧凑模式 Switch to compact density"/);
});

test('verification detail has a permanent name and backdrop dismissal', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html,/id="verification-detail"[^>]*aria-labelledby="verification-dialog-title"/);
  assert.match(html,/id="verification-dialog-title"/);
  assert.match(app,/event\.target !== dialog/);
  assert.match(app,/dialog\.getBoundingClientRect\(\)/);
});

test('opportunity table uses the combined endpoint and retains the lead-directory fallback', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app,/buildOpportunityQuery\(collectOpportunityFilters\(\),100\)/);
  assert.match(app,/json\(`\/api\/opportunities\?\$\{query\}`\)/);
  assert.match(app,/state\.opportunities = \[\.\.\.state\.leads\]/);
  assert.match(app,/managementMatchScoreValue/);
  assert.match(app,/customer_match_score \?\? lead\?\.customer_match \?\? lead\?\.match_score/);
});

test('Phase 6 opportunity labels and filter query remain deterministic and bilingual', () => {
  assert.deepEqual(opportunityReadinessLabel('SALES_READY'), ['可安排销售跟进','Sales ready']);
  assert.deepEqual(opportunityReadinessLabel('STRATEGIC_LONG_SHOT'), ['战略长期机会','Strategic long shot']);
  assert.deepEqual(feasibilityBandLabel('LOW_MEDIUM'), ['中低可行性','Low-medium feasibility']);
  assert.deepEqual(cooperationMatrixLabel('HIGH_FIT_LOW_ACCESS'), ['高匹配但较难进入','High fit, low access']);
  assert.deepEqual(normalizedRoleLabel('PROCUREMENT_DEPARTMENT'), ['采购部门','Procurement Department']);
  assert.deepEqual(opportunityContactVerificationLabel('ACCEPT_ALL'), ['全域接收','Accept-all']);
  assert.deepEqual(systemReasonLabel('Supplier registration route'), ['企业公开的供应商注册路径','Supplier registration route published by the business']);
  assert.deepEqual(contactTypeLabel('UNRECOGNIZED_ROUTE'), ['待确认','To confirm']);
  assert.deepEqual(sourceTypeLabel('UNRECOGNIZED_SOURCE'), ['资料来源','Source reference']);
  const query = buildOpportunityQuery({ country:'MX',product_profile:'WOMENSWEAR',readiness:'SALES_READY',cooperation_matrix:'HIGH_FIT_HIGH_ACCESS',sort:'' },100);
  assert.equal(query.get('country'),'MX');
  assert.equal(query.get('product_profile'),'WOMENSWEAR');
  assert.equal(query.get('readiness'),'SALES_READY');
  assert.equal(query.get('cooperation_matrix'),'HIGH_FIT_HIGH_ACCESS');
  assert.equal(query.get('sort'),'feasibility_desc');
  assert.equal(query.get('limit'),'100');
  assert.equal(activeOpportunityFilterCount({ country:'MX',sort:'feasibility_desc',tier:'' }),1);
});

test('Phase 6 opportunity UI adds foldable filters, semantic columns and the Express enrichment trigger', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/phase5.css', import.meta.url), 'utf8');
  assert.match(html,/id="opportunity-filter-disclosure"[^>]*verification-filter-disclosure/);
  for (const id of ['opportunity-filters','opportunity-market','opportunity-product-profile','opportunity-readiness','opportunity-feasibility-band','opportunity-cooperation-matrix','opportunity-decision-maker-status','opportunity-role','opportunity-contact-type','opportunity-contact-verification','opportunity-historical-status','opportunity-management-match','opportunity-historical-match','opportunity-tier','opportunity-sort','opportunity-clear-filters']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/id="opportunity-sort"[\s\S]*<option value="feasibility_desc" selected>/);
  for (const column of ['op-col-company','op-col-market-product','op-col-feasibility','op-col-readiness','op-col-secondary','op-col-contact']) assert.match(html,new RegExp(column));
  assert.match(html,/id="start-enrichment"/);
  assert.match(html,/id="enrichment-job-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app,/json\('\/api\/enrichment\/jobs',\{ method:'POST'/);
  assert.match(app,/json\(`\/api\/enrichment\/jobs\/\$\{encodeURIComponent\(jobId\)\}`\)/);
  assert.match(app,/function setEnrichmentButtonBusy\(isBusy\)/);
  assert.match(app,/async function pollEnrichmentJob\(jobId\)[\s\S]*setEnrichmentButtonBusy\(true\)[\s\S]*setEnrichmentButtonBusy\(false\)/);
  const pollSegment = app.slice(app.indexOf('async function pollEnrichmentJob(jobId)'),app.indexOf('async function loadLatestEnrichmentJob()'));
  const pollCatch = pollSegment.slice(pollSegment.indexOf('} catch {'));
  assert.match(pollCatch,/enrichmentPollFailures/);
  assert.match(pollCatch,/setTimeout\(\(\)=>pollEnrichmentJob\(jobId\),retryMs\)/);
  assert.doesNotMatch(pollCatch,/setEnrichmentButtonBusy\(false\)/);
  const startJobSegment = app.slice(app.indexOf('async function startEnrichmentJob()'),app.indexOf('const detailDialog'));
  assert.doesNotMatch(startJobSegment,/finally\s*\{/);
  assert.match(css,/@media \(max-width:560px\)[\s\S]*\.crm-opportunity-table \.op-col-secondary, \.crm-opportunity-table \.op-col-contact\s*\{[^}]*display:\s*none/);
  assert.match(css,/\.crm-opportunity-table \.op-col-company/);
  assert.match(css,/\.crm-opportunity-table \.op-col-market-product/);
  assert.match(css,/\.crm-opportunity-table \.op-col-feasibility, \.crm-opportunity-table \.op-col-readiness/);
  assert.match(css,/\.crm-opportunity-table :is\(\.op-col-feasibility,\.op-col-readiness\)::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  assert.match(css,/#opportunity-table td\[colspan\]\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(css,/\.crm-opportunity-table \.lead-select-action\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(`${html}\n${app}`,/source_hash|evidence_hash|source_unc_path|local_staging_path|raw_payload|raw_row/i);
});

test('Phase 6 detail keeps internal versions hidden and protects approval work from accidental dismissal', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const historySegment = app.slice(app.indexOf('function historyTable(items, type)'),app.indexOf('function lifecycleHistoryView(payload)'));
  assert.doesNotMatch(historySegment,/profile_version|rule_version/i);
  const approvalSegment = app.slice(app.indexOf('async function approve(id, status, button)'),app.indexOf('function renderEnrichmentStatus(job)'));
  assert.match(approvalSegment,/detail\.dataset\.unsaved='true'/);
  assert.match(approvalSegment,/delete detail\.dataset\.unsaved/);
  assert.match(app,/return detail\.dataset\.unsaved !== 'true'/);
});

test('ICP view loads all active product-profile details and identifies the management baseline', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html,/id="icp-profile-content"/);
  assert.match(app,/json\('\/api\/icp\/profiles'\)/);
  assert.match(app,/profiles\.filter\(profile=>profile\.active/);
  assert.match(app,/Promise\.all\(selected\.map\(async profile=>profile\?\.id \? await optionalJson\(`\/api\/icp\/profiles\/\$\{encodeURIComponent\(profile\.id\)\}`\)/);
  assert.match(app,/MANAGEMENT_BASELINE/);
  assert.match(app,/Historical data/);
});

test('Phase 5 V2.3 reuses Jobs for a sanitized import-batch summary', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const jobsStart = html.indexOf('id="view-jobs"');
  const jobsEnd = html.indexOf('id="view-settings"');
  const jobsView = html.slice(jobsStart,jobsEnd);
  assert.match(jobsView,/id="import-batches"/);
  assert.match(jobsView,/id="import-batches-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  for (const label of ['Import Batch','Status','Source Files','Customers','Orders','Products','Follow-up Rows','Errors','Warnings','Imported At']) {
    assert.match(jobsView,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(app,/json\('\/api\/import-batches'\)/);
  assert.match(app,/renderImportBatches/);
  assert.match(app,/batch\.import_batch_key/);
  assert.match(app,/batchCount\(batch,'follow_up_rows','followup_rows','follow_up_count','followup_count'\)/);
  assert.match(app,/safeItems\.length === 1 \? 'batch' : 'batches'/);
  assert.doesNotMatch(`${jobsView}\n${app}`,/raw_payload|source_unc_path|local_staging_path|DPV_SHARED_FOLDER_PATH/i);
});

test('Phase 5 V2.3 presents Mexico historical ICP coverage without exposing internal paths', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const label of ['Mexico Historical Customer ICP','Application markets','Profile basis','Sample customers','Product-profile coverage','Repeat-order coverage','Channel coverage','Follow-up / win-loss coverage','Last rebuilt','Internal historical business data']) {
    assert.match(app,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(app,/filterVisibleMarkets\(profile\?\.market_scope/);
  assert.match(app,/profile\?\.sample_size_customers/);
  assert.match(app,/profile\?\.profile_basis/);
  assert.match(app,/filterVisibleMarkets\(profile\?\.application_markets/);
  assert.match(app,/FULL:\['完整','Full'\]/);
  assert.match(app,/UNKNOWN:\['待确认','Unknown'\]/);
  assert.doesNotMatch(app,/source_unc_path|local_staging_path|DPV_SHARED_FOLDER_PATH/i);
});

test('Phase 5 V2.3 keeps management and Mexico historical matches separate', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html,/Management Baseline Match/);
  assert.match(html,/Mexico Historical Reference Match/);
  assert.match(html,/id="opportunity-table"[\s\S]*colspan="14"/);
  assert.match(app,/matchRecord\(payload, 'management_baseline'\)/);
  assert.match(app,/matchRecord\(payload, 'mx_historical_reference'\)/);
  assert.match(app,/matchReferencePanel\(managementMatch,'management_baseline'\)/);
  assert.match(app,/matchReferencePanel\(mexicoHistoricalMatch,'mx_historical_reference'\)/);
  assert.match(app,/Review the two match results separately for commercial decisions/);
});

test('Phase 5 V2.3 renders dynamic ICP and match codes as equal bilingual lines', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app,/CONVERTED_ORDER_HISTORY:\['已成交客户与订单记录','Converted customer and order history'\]/);
  assert.match(app,/UNAVAILABLE:\['暂无资料','Unavailable'\]/);
  assert.match(app,/WOMENSWEAR:\['全品类女装',"Full-category Women's Apparel"\]/);
  assert.match(app,/buyer_business_model_fit:\['采购业务模式匹配','Buyer business model fit'\]/);
  assert.match(app,/BUYER_MODEL:\['采购业务模式','Buyer business model'\]/);
  assert.match(app,/BUSINESS_VERIFICATION_NOT_COMPLETE:\['企业核验尚未完成','Business verification incomplete'\]/);
  assert.match(app,/profileValueHtml\(value\)/);
  assert.match(app,/if \(!text\) return \['-','-'\]/);
  assert.match(app,/\.\.\.dimensionPair\(name\)/);
  assert.match(app,/pairedValueHtml\(reasonCodePair\(reason\)\)/);
  assert.match(app,/pairedValueHtml\(reasonCodePair\(typeof item === 'string'/);
  assert.doesNotMatch(app,/\[humanizeCode\(name\),humanizeCode\(name\)/);
});

test('Phase 5 V2.3.1 presents sanitized OKKI history in Jobs and the reusable detail dialog', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/phase5.css', import.meta.url), 'utf8');
  for (const endpoint of [
    "/api/crm-history?limit=200",
    "/api/crm-history/import-summary",
    "/api/crm-history/${encodeURIComponent(id)}",
    "/api/companies/${encodeURIComponent(companyId)}/crm-history"
  ]) assert.match(app,new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for (const label of [
    'Historical CRM Records','Country or region','Prior CRM status','Historical classification',
    'Marketing emails','CRM owner','Historical CRM detail','Contact summary','Activity history'
  ]) assert.match(app,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(app,/function ensureCrmHistoryPanel\(\)/);
  assert.match(app,/id = 'crm-history-panel'/);
  assert.match(app,/className = 'card crm-panel crm-history-panel'/);
  assert.match(app,/crmHistoryClassificationBadge/);
  assert.match(app,/OUTBOUND_MARKETING_EMAIL_SENT:\['营销邮件已发送','Marketing email sent'\]/);
  assert.match(app,/MANUAL_FOLLOW_UP:\['人工跟进','Manual follow-up'\]/);
  assert.match(app,/crmBusinessText[\s\S]*replace\(\/https\?:\\\/\\\/\\S\+\/gi,''\)/);
  const detailStart = app.indexOf('async function showCrmHistory');
  const detailEnd = app.indexOf('async function showLead',detailStart);
  const crmDetail = app.slice(detailStart,detailEnd);
  assert.match(crmDetail,/wireDetailTabs\(detail\)/);
  assert.match(crmDetail,/wireDetailCloseButtons\(detail\)/);
  assert.doesNotMatch(crmDetail,/data-status=|crm-detail-actions|<a\b/);
  assert.doesNotMatch(app,/internal_related_link|internal_attachment_reference|source_filename|staging_path|raw_payload|raw_row/);
  assert.match(css,/\.crm-history-panel\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/);
  assert.match(css,/\.crm-history-directory-table\s*\{[^}]*min-width/);
  assert.match(css,/@media \(max-width:560px\)[\s\S]*\.crm-history-directory-table tr > :is\(:nth-child\(2\),:nth-child\(5\),:nth-child\(7\),:nth-child\(8\),:nth-child\(9\)\)\s*\{[^}]*display:\s*none/);
  assert.match(css,/@media \(max-width:560px\)[\s\S]*\.crm-history-directory-table \.crm-history-open\s*\{[^}]*min-height:\s*44px/);
  assert.match(css,/\.crm-activity-item details p\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('responsive table and content-sized detail dialog preserve native browser zoom', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/phase5.css', import.meta.url), 'utf8');
  assert.match(html, /content="width=device-width,initial-scale=1"/);
  assert.doesNotMatch(html,/maximum-scale|user-scalable/i);
  assert.match(css,/\.table-responsive[\s\S]*overflow:\s*auto/);
  assert.match(css,/@media \(max-width:560px\)/);
  assert.match(css,/#detail\.crm-detail-drawer\s*\{[^}]*width:\s*fit-content/);
  assert.match(css,/#detail\.crm-detail-drawer\s*\{[^}]*min-width:\s*min\(42rem/);
  assert.match(css,/#detail\.crm-detail-drawer\s*\{[^}]*max-height:\s*min\(86dvh,54rem\)/);
  assert.match(css,/#detail\.crm-detail-drawer\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css,/\.crm-detail-body\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow:\s*auto/);
  assert.match(css,/\.crm-detail-toolbar\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css,/\.crm-detail-actions\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css,/@media \(max-width:767px\)[\s\S]*#detail\.crm-detail-drawer\[open\]\.has-detail\s*\{[^}]*safe-area-inset-top[^}]*safe-area-inset-bottom[^}]*padding:\s*0[^}]*transform:\s*none/);
  assert.match(css,/\.crm-import-table\s*\{[^}]*min-width/);
  assert.match(css,/\.crm-match-reference-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css,/@media \(max-width:767px\)[\s\S]*\.crm-match-reference-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css,/body\s*\{[^}]*transform:\s*scale\(/);
});

test('company-facing frontend copy passes repository wording audit', async () => {
  const files = await Promise.all(['index.html','app.js','crm-shell.js','opportunity-ui.js'].map(name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8')));
  const source = files.join('\n');
  const prohibited = [/Demo/i,/真实数据/,/真实线索/,/公开数据/,/Real Data/i,/Real public data/i,/外联已禁用/,/Outreach disabled/i,/抓取/,/采集/,/爬取/,/去重/,/合并历史数据/,/历史数据持续保留/,/—|–/];
  for (const pattern of prohibited) assert.doesNotMatch(source,pattern);
});
