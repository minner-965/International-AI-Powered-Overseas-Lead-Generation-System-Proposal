import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const publicDir=path.join(root,'services/demo-dashboard/public');
const read=name=>fs.readFileSync(path.join(publicDir,name),'utf8');
const html=read('index.html');
const app=read('app.js');
const opportunities=read('opportunity-ui.js');
const productMatch=read('product-match-ui.js');
const css=read('phase5.css');

test('desktop Opportunities exposes every V3 business decision column',()=>{
  for(const className of [
    'op-col-buyer-model','op-col-product-match','op-col-product-opportunity','op-col-supplier-access','op-col-product-access','op-col-readiness'
  ]) assert.match(html,new RegExp(`class=["'][^"']*${className}`));
  for(const label of ['Buyer Model','Product Match','Product Opportunity','Supplier Access','Product Access Matrix','Readiness']) assert.match(html,new RegExp(label,'i'));
});

test('V3 Opportunities exposes buyer/category/matrix filters with stable IDs',()=>{
  for(const id of [
    'opportunity-buyer-business-model','opportunity-buyer-subtype','opportunity-category-procurement-band',
    'opportunity-category-procurement-status','opportunity-product-access-matrix'
  ]) assert.match(html,new RegExp(`id=["']${id}["']`));
});

test('Opportunities renderer consumes V3 fields without collapsing independent scores or matrices',()=>{
  const source=`${opportunities}\n${app}\n${productMatch}`;
  for(const field of [
    'buyer_business_model','buyer_subtype','category_procurement_match_score','category_procurement_match_band',
    'category_procurement_match_status','category_procurement_coverage','observed_categories','top_product_opportunity',
    'product_opportunity_count','product_opportunity_status','supplier_access_band','product_access_matrix','readiness'
  ]) assert.match(source,new RegExp(`\\b${field}\\b`));
  for(const legacy of ['dpv_score','customer_match','historical_customer_match','cooperation_matrix']) assert.match(source,new RegExp(`\\b${legacy}\\b`));
});

test('mobile keeps Company, profile, Buyer Model, Product Match, Supplier Access and Readiness visible',()=>{
  const mobileStart=css.indexOf('@media (max-width:560px)');
  const mobileEnd=css.indexOf('@media',mobileStart+1);
  const mediaBlocks=css.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:undefined);
  assert.ok(mobileStart>=0);
  for(const className of ['op-col-company','op-col-market-product','op-col-buyer-model','op-col-product-match','op-col-supplier-access','op-col-readiness']) {
    assert.match(mediaBlocks,new RegExp(`\\.${className}\\b`));
    assert.doesNotMatch(mediaBlocks,new RegExp(`\\.${className}[^}]*display\\s*:\\s*none`,`i`));
  }
  assert.match(css,/@media\s*\([^)]*max-width\s*:\s*(?:560|480|390)px/i);
  assert.match(css,/grid-template-columns\s*:\s*repeat\(2\s*,\s*minmax\(0\s*,\s*1fr\)\)|grid-template-columns\s*:\s*1fr\s+1fr/i);
  assert.match(css,/@media \(max-width:420px\)[\s\S]*\.crm-opportunity-table tr\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(css,/@media \(max-width:420px\)[\s\S]*\.crm-opportunity-table \.data-state-badge\s*\{[^}]*max-width:\s*100%[^}]*white-space:\s*normal/);
});

test('Company Detail retains Product Match tab and renders both independent product profiles',()=>{
  const detailSource=`${productMatch}\n${app}`;
  assert.match(detailSource,/\['product-match','产品匹配','Product Match'\]/);
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
