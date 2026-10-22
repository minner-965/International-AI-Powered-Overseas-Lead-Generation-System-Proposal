import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssSection } from './v4-css.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const publicDir=path.join(root,'services/demo-dashboard/public');
const read=name=>fs.readFileSync(path.join(publicDir,name),'utf8');
const html=read('index.html');
const app=read('app.js');
const opportunities=read('opportunity-ui.js');
const productMatch=read('product-match-ui.js');
const css=read('ui/v4/app.css');

test('desktop Opportunities exposes eight compact decision columns and preserves V3 detail capabilities',()=>{
  for(const className of [
    'op-col-company','op-col-market','op-col-product-match','op-col-contact','op-col-status','op-col-activity','op-col-owner','op-col-action'
  ]) assert.match(html,new RegExp(`class=["'][^"']*${className}`));
  for(const label of ['Matched Category','Latest Activity','Owner','Official Contact Channels','Status','Next Action']) assert.match(html,new RegExp(label,'i'));
  for(const preserved of ['opportunityProductSummaryCell','opportunitySupplierAccessCell','opportunitySecondaryScores','detail-panel-product-match']) assert.match(app,new RegExp(preserved));
  assert.match(html,/id=["']opportunity-table["'][\s\S]*colspan=["']8["']/);
});

test('V3 Opportunities retains buyer/category filters and retires access-gate filters',()=>{
  for(const id of [
    'opportunity-buyer-business-model','opportunity-buyer-subtype','opportunity-category-procurement-band',
    'opportunity-category-procurement-status'
  ]) assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.doesNotMatch(html,/name="(?:product_access_matrix|cooperation_matrix|readiness)"/);
});

test('Opportunities renderer preserves category and score fields with access matrices in historical mapper only',()=>{
  const source=`${opportunities}\n${app}\n${productMatch}`;
  for(const field of [
    'buyer_business_model','buyer_subtype','category_procurement_match_score','category_procurement_match_band',
    'category_procurement_match_status','category_procurement_coverage','observed_categories','matched_scopes',
    'match_basis','observed_customer_categories','supplier_access_band','readiness'
  ]) assert.match(source,new RegExp(`\\b${field}\\b`));
  for(const removed of ['top_product_opportunity','product_opportunity_count','product_opportunity_status']){
    assert.doesNotMatch(source,new RegExp(`\\b${removed}\\b`));
  }
  for(const score of ['dpv_score','customer_match','historical_customer_match']) assert.match(source,new RegExp(`\\b${score}\\b`));
  const history = read('phase7-ui.js');
  assert.match(history,/product_access_matrix/);
  assert.match(opportunities,/cooperationMatrixLabel/);
  assert.doesNotMatch(opportunities,/'product_access_matrix'|'cooperation_matrix'/);
});

test('mobile prioritizes company/category/status/action and retains secondary facts in detail',()=>{
  const opportunityCss=cssSection('opportunities');
  const mobileStart=opportunityCss.indexOf('@media (max-width: 767px)');
  const mobileEnd=opportunityCss.indexOf('@media',mobileStart+1);
  const mediaBlocks=opportunityCss.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:undefined);
  assert.ok(mobileStart>=0);
  const renderer=app.slice(app.indexOf('function renderOpportunityTable'),app.indexOf('async function loadOpportunities'));
  for(const className of ['op-col-company','op-col-market','op-col-product-match','op-col-contact','op-col-status','op-col-activity','op-col-owner','op-col-action']) {
    assert.match(renderer,new RegExp(`class="${className}"`));
  }
  for(const field of ['op-col-company','op-col-product-match','op-col-status','op-col-action']) assert.match(mediaBlocks,new RegExp(`\\.${field} \\{[^}]*grid-`));
  assert.match(mediaBlocks,/\.crm-opportunity-table tbody\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(mediaBlocks,/\.crm-opportunity-table td::before\s*\{[^}]*content:none/);
  for(const preserved of ['opportunityBuyerModelCell','opportunitySupplierAccessCell','opportunityReadinessLabel','detail-panel-product-match'])assert.match(app,new RegExp(preserved));
  assert.match(app,/function opportunityCategorySummary[\s\S]*Product Category Score/);
  assert.match(read('ui/v4/app.css'),/\.dpv-badge, \.data-state-badge, \.p8-status[^{]*\{[^}]*white-space:\s*normal[^}]*word-break:\s*normal/);
});

test('Company Detail retains the category-score tab and renders both independent product profiles',()=>{
  const detailSource=`${productMatch}\n${app}`;
  assert.match(detailSource,/\['product-match','商品类目评分','Product Category Score'\]/);
  assert.match(detailSource,/id="detail-tab-\$\{key\}"/);
  for(const id of ['detail-panel-product-match','product-match-panel']) assert.match(detailSource,new RegExp(`id=["']${id}["']`));
  assert.match(detailSource,/crm-product-profile-card/);
  assert.match(detailSource,/data-product-profile/);
  assert.match(detailSource,/WOMENSWEAR/);
  assert.match(detailSource,/GENERAL_MERCHANDISE/);
  for(const endpoint of ['category-procurement-matches','buyer-business-model','product-opportunities']) assert.match(detailSource,new RegExp(endpoint));
});

test('error, unknown, weak, mismatch and excluded are distinct states with retry support',()=>{
  const source=`${productMatch}\n${app}\n${css}`;
  for(const stateClass of ['is-error','is-unknown','is-weak','is-mismatch','is-excluded']) assert.match(source,new RegExp(`\\.${stateClass}|${stateClass}`));
  assert.match(source,/crm-product-match-retry/);
  assert.match(source,/data-company-id/);
});

test('V3 UI includes bilingual Buyer Model labels and never calls company demand a named Buyer',()=>{
  for(const value of ['DIRECT_END_BUYER','DISTRIBUTION_BUYER','UNCLEAR_INTERMEDIARY','EXCLUDED_INTERMEDIARY']) assert.match(productMatch,new RegExp(value));
  for(const label of ['终端零售买家','Direct end buyer','渠道采购客户','Distribution buyer','渠道模式待确认','Channel model to confirm','已排除中间人','Excluded intermediary']) assert.match(productMatch,new RegExp(label,'i'));
  assert.doesNotMatch(productMatch,/具名买手已验证|Named buyer verified/i);
});

test('static UI preserves keyboard focus, reduced motion, compact mode, theme states and overflow controls',()=>{
  assert.match(css,/:focus-visible/);
  assert.match(css,/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  assert.match(css,/data-density|compact/i);
  assert.match(css,/data-theme|prefers-color-scheme|dark/i);
  assert.match(css,/overflow-x\s*:\s*(?:auto|hidden|clip)/i);
  assert.match(`${app}\n${productMatch}`,/loading/i);
  assert.match(`${app}\n${productMatch}`,/empty|no results|暂无|无结果/i);
});

test('Bangladesh remains hidden in the V3 frontend market surface',()=>{
  const visibility=read('market-visibility.js');
  assert.match(visibility,/\bBD\b/);
  assert.match(visibility,/hidden/i);
});
