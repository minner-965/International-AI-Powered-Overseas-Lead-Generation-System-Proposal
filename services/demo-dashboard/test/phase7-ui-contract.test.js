import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { phase7FieldLabel, phase7ReasonLabel, phase7StateLabel } from '../public/phase7-ui.js';

const read = name => readFile(new URL(`../public/${name}`,import.meta.url),'utf8');

test('Phase 7 adds Data Import and Data Export to the established CRM shell', async () => {
  const [html,shell] = await Promise.all([read('index.html'),read('crm-shell.js')]);
  for (const view of ['data-import','data-export']) {
    assert.match(html,new RegExp(`data-app-nav="${view}"`));
    assert.match(html,new RegExp(`data-app-view="${view}"`));
    assert.match(shell,new RegExp(`'${view}'`));
  }
  assert.match(html,/href="\/phase7\.css"/);
  assert.match(html,/src="\/app\.js"/);
});

test('Data Import exposes the complete check, approval and commit workflow without raw records', async () => {
  const [html,ui] = await Promise.all([read('index.html'),read('phase7-ui.js')]);
  for (const id of [
    'data-import-form','data-import-type','data-import-file','data-import-dry-run','data-import-template',
    'data-import-status','data-import-summary','data-import-rows','data-import-submit','data-import-approve',
    'data-import-commit','data-import-error-report'
  ]) assert.match(html,new RegExp(`id="${id}"`));
  for (const type of ['PROSPECT_LEADS','PRODUCT_MASTER_UPDATE','CUSTOMER_DEALS','CUSTOMER_DEAL_LINES']) assert.match(html,new RegExp(type));
  for (const endpoint of [
    '/api/data-imports/dry-run','/api/data-imports/${encodeURIComponent(id)}',
    '/api/data-imports/${encodeURIComponent(id)}/rows','/api/data-imports/${encodeURIComponent(id)}/${action}',
    '/api/data-imports/${encodeURIComponent(id)}/error-report'
  ]) assert.match(ui,new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(html,/raw payload|shared.folder path|staging path|password/i);
});

test('Data Export preserves current filters and displays server-applied columns and job facts', async () => {
  const [html,ui] = await Promise.all([read('index.html'),read('phase7-ui.js')]);
  for (const id of ['data-export-form','data-export-type','data-export-mode','data-export-create','data-export-status','data-export-columns','data-export-result']) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  for (const mode of ['CURRENT_FILTER','FULL_AUTHORIZED_MASTER']) assert.match(html,new RegExp(mode));
  for (const format of ['XLSX','CSV']) assert.match(html,new RegExp(`value="${format}"`));
  assert.match(ui,/currentOpportunityFilters\(\)/);
  assert.match(ui,/request\('\/api\/data-exports'/);
  assert.match(ui,/\/api\/data-exports\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(ui,/applied_columns \|\| job\.appliedColumns/);
  assert.match(ui,/file_expires_at/);
});

test('Data Export defaults to the cumulative permitted master and does not offer an empty workbook as a successful download', async () => {
  const [html,ui] = await Promise.all([read('index.html'),read('phase7-ui.js')]);
  assert.match(html, /<option value="FULL_AUTHORIZED_MASTER">累计授权主库 \/ Cumulative permitted master<\/option><option value="CURRENT_FILTER">/);
  assert.match(ui, /const emptyReady = status === 'READY' && Number\(rowCount \|\| 0\) === 0/);
  assert.match(ui, /当前筛选没有数据/);
  assert.match(ui, /!emptyReady/);
});

test('Phase 7 management access uses a session-only token, server-bound actor/role and CSRF', async () => {
  const ui = await read('phase7-ui.js');
  assert.match(ui,/sessionStorage\.getItem\('dpvManagementToken'\)/);
  assert.match(ui,/sessionStorage\.setItem\('dpvManagementToken'/);
  assert.match(ui,/authorization:`Bearer \$\{values\.token\}`/);
  assert.match(ui,/'X-DPV-Actor':values\.actor/);
  assert.match(ui,/'X-DPV-Role':values\.role/);
  assert.match(ui,/'X-DPV-CSRF':accessState\.csrf/);
  assert.match(ui,/fetch\('\/api\/management\/session'/);
  assert.match(ui,/id = 'phase7-management-access'/);
  assert.match(ui,/data-management-close/);
  assert.match(ui,/Management Access/);
  assert.doesNotMatch(ui,/name="role"|value="MANAGEMENT"/);
  assert.match(ui,/sessionStorage\.setItem\('dpvManagementActor',session\.identity/);
  assert.match(ui,/sessionStorage\.setItem\('dpvManagementRole',session\.role/);
  assert.doesNotMatch(ui,/localStorage\.setItem\('dpvManagementToken'/);
});

test('Opportunities defaults to RECOMMENDED while keeping explicit ALL and five-state filters', async () => {
  const [html,opportunityUi]=await Promise.all([read('index.html'),read('opportunity-ui.js')]);
  assert.match(html,/id="opportunity-status"/);
  assert.match(html,/<option value="RECOMMENDED" selected>/);
  for(const status of ['MANAGEMENT_APPROVED','EVIDENCE_REQUIRED','HOLD','NOT_SUITABLE','ALL'])assert.match(html,new RegExp(`value="${status}"`));
  assert.match(opportunityUi,/'status', 'country'/);
});

test('company detail includes five-state opportunity decision UI, management actions and lazy Phase 7 tabs', async () => {
  const [app,ui] = await Promise.all([read('app.js'),read('phase7-ui.js')]);
  for (const [key,label] of [
    ['outreach-readiness','Outreach Readiness'],['outreach-drafts','Drafts'],['outreach-messages','Messages'],
    ['outreach-replies','Replies'],['data-history','Data History']
  ]) {
    assert.equal(app.includes(`['${key}'`),true);
    assert.match(app,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(app,new RegExp(`id="detail-panel-${key}"`));
  }
  assert.match(app,/data-phase7-detail-tab/);
  assert.match(app,/attachPhase7CompanyDetail/);
  assert.match(app,/display_opportunity_status/);
  assert.match(app,/Opportunity decision/);
  assert.match(ui,/\/api\/contact-queue\?\$\{query\}/);
  assert.match(ui,/\/api\/opportunities\/\$\{encodeURIComponent\(reference\)\}\/decision-history/);
  for (const endpoint of ['management-approve','hold','request-evidence','reopen']) {
    assert.match(ui,new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(ui,/\/api\/outreach\/drafts\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(ui,/\/api\/outreach\/messages\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(ui,/\/api\/outreach\/inbox\?company_id=/);
  assert.match(ui,/\/api\/contacts\/\$\{encodeURIComponent\(id\)\}\/verification-history/);
  for (const phrase of ['Loading business records','No drafts yet','No message records','No replies','No outreach data history']) assert.match(ui,new RegExp(phrase));
  for (const phrase of ['Confirm Contact','Hold','Request Evidence','Reopen','Decision History','Contact Queue Entry','messages_approved','provider_calls']) {
    assert.match(ui,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(ui,/data-phase7-detail-tab/);
});

test('Phase 7 customer-facing values use deterministic bilingual mappings', () => {
  assert.deepEqual(phase7StateLabel('MANAGEMENT_APPROVED'),['已确认进入待联系','Queued for contact']);
  assert.deepEqual(phase7StateLabel('DELIVERED'),['已送达','Delivered']);
  assert.deepEqual(phase7StateLabel('UNRECOGNIZED_VALUE'),['待确认','To confirm']);
  assert.deepEqual(phase7ReasonLabel('EXACT_VERSION_APPROVAL_REQUIRED'),['当前消息版本尚未批准','Exact message approval required']);
  assert.deepEqual(phase7ReasonLabel('INTERNAL_UNKNOWN_REASON'),['需业务复核','Business review required']);
  assert.deepEqual(phase7FieldLabel('buyer_business_model'),['客户采购模式','Buyer Model']);
  assert.deepEqual(phase7FieldLabel('unknown_column'),['业务字段','Business field']);
});

test('Phase 7 responsive CSS keeps dense data inside components and preserves practical dialog exits', async () => {
  const [html,css] = await Promise.all([read('index.html'),read('phase7.css')]);
  assert.match(css,/\.crm-data-exchange-layout\s*\{[^}]*grid-template-columns/);
  assert.match(css,/\.crm-data-row-table\s*\{[^}]*min-width/);
  assert.match(css,/\.crm-opportunity-readiness-stack\s*\{/);
  assert.match(css,/\.crm-phase7-action-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width:1023px\)[\s\S]*\.crm-data-exchange-layout\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css,/@media \(max-width:767px\)[\s\S]*\.crm-data-form\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css,/@media \(max-width:767px\)[\s\S]*\.crm-phase7-action-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css,/@media \(max-width:420px\)[\s\S]*#phase7-management-access\.crm-management-dialog\[open\]/);
  assert.match(css,/#phase7-management-access\.crm-management-dialog\s*\{[^}]*width:\s*fit-content[^}]*max-height/);
  assert.match(css,/\.crm-management-actions \.btn[\s\S]*min-height:\s*44px/);
  assert.match(css,/\.crm-phase7-inline-actions \.btn[\s\S]*min-height:\s*44px/);
  assert.match(html,/content="width=device-width,initial-scale=1"/);
  assert.doesNotMatch(html,/maximum-scale|user-scalable/i);
});
