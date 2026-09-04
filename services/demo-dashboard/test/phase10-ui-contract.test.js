import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readPublic=name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8');

test('Phase 10 separates automatic enrichment and human review without a catalog-maintenance workstream',async()=>{
  const [html,opportunity,research]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/opportunity-workspace.js'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  for(const hook of [
    'opportunity-auto-evidence-list','opportunity-priority-list',
    'research-automation-monitor','research-priority-tasks','jobs-automation-monitor','settings-automation-monitor'
  ]) assert.match(html,new RegExp(`id="${hook}"`));
  for(const label of ['自动补证进度','Auto Enrichment','需人工复核','Human Review']) {
    assert.ok(html.includes(label),`missing workstream label ${label}`);
  }
  for(const removed of ['opportunity-catalog-maintenance-list','research-catalog-maintenance','内部商品待完善','Catalog Maintenance','打开商品维护','Open catalog maintenance']) {
    assert.ok(!html.includes(removed),`obsolete catalog task UI remains: ${removed}`);
  }
  assert.match(opportunity,/task_class/);
  assert.match(opportunity,/HUMAN_REVIEW/);
  assert.doesNotMatch(opportunity,/CATALOG_MAINTENANCE|catalog_enrichment_required|INTERNAL_CATALOG_UPLOAD_REQUIRED/);
  assert.match(opportunity,/return 'auto'/);
  assert.match(research,/function taskWorkstream/);
  assert.match(research,/reviewItems\.slice\(0,3\)/);
  assert.doesNotMatch(research,/CATALOG_MAINTENANCE|catalog_maintenance_count|catalog_enrichment_required|INTERNAL_CATALOG_UPLOAD_REQUIRED/);
});

test('Phase 10 automation monitor uses compatible fields and one contextual live region',async()=>{
  const [html,research]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.equal((html.match(/id="phase10-automation-live"/g)||[]).length,1);
  assert.match(html,/id="phase10-automation-live"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  for(const field of [
    'auto_evidence_enabled','auto_evidence_running','auto_evidence_retry_scheduled','provider_capacity_wait',
    'auto_evidence_human_review','last_reconciled_at','source_service_health','email_verification_health',
    'search_service','tavily_usage'
  ]) assert.ok(research.includes(field),`missing compatibility field ${field}`);
  assert.ok(!research.includes('auto_evidence_budget_paused'),'retired internal-budget field remains in the current UI projection');
  assert.match(html,/id="phase10-provider-refresh"[^>]*aria-describedby="phase10-automation-live"/);
  assert.match(research,/\/api\/research\/provider-status\/refresh/);
  assert.match(research,/aria-busy/);
  assert.match(research,/countText = value => value === null \? '-'/);
  assert.match(research,/renderAutomationMonitors\(\{ auto_evidence:\{ status:'UNAVAILABLE' \} \}\)/);
  assert.doesNotMatch(html,/API Key|raw payload|internal queue|Hunter/i);
});

test('company detail presents category-level opportunity facts without specific product candidates',async()=>{
  const app=await readPublic('app.js');
  for(const label of [
    '公司经营类目','Observed Company Categories','DPV 可供货批准类目','DPV Approved Supply Categories',
    '类目机会依据','Category opportunity basis'
  ]) assert.ok(app.includes(label),`missing detail label ${label}`);
  for(const field of ['match_basis','matched_scopes','observed_customer_categories','auto_evidence_status']) {
    assert.ok(app.includes(field),`missing Phase 10 detail projection ${field}`);
  }
  assert.doesNotMatch(app,/catalog_enrichment_required|打开商品维护|Open catalog maintenance/);
  assert.doesNotMatch(app,/共享商品资料（参考）|Shared Product Data \(Reference\)|Top Product Opportunity|Product candidates|共享商品参考/);
});

test('Commercial Product Fit remains available to the API but stays outside the main category/contact decision surface',async()=>{
  const [app,labels]=await Promise.all([readPublic('app.js'),readPublic('product-match-ui.js')]);
  for(const text of ['商业商品适配','Commercial Product Fit','有意向后沟通','Discuss after interest',
    '不触发补证','does not trigger enrichment'])assert.ok(app.includes(text));
  assert.match(app,/\/commercial-product-fit/);
  const mainCard=app.slice(app.indexOf('function productMatchResultCard'),app.indexOf('function wireProductMatchRetry'));
  assert.doesNotMatch(mainCard,/commercialProductFitView|data-commercial-product-fit/);
  assert.match(app,/does not change the category gate, contact eligibility, approval or send permission/);
  for(const dimension of ['COMMERCIAL_POSITIONING_PRICE_BAND','MOQ_ORDER_FORMAT_COMPATIBILITY',
    'RECENT_PRODUCT_BUYING_SIGNAL'])assert.ok(labels.includes(dimension));
  assert.doesNotMatch(app,/Commercial Product Fit[\s\S]{0,300}product candidate/i);
});

test('new-customer product scoring is visibly category-level in filters, tables, evidence cards and detail',async()=>{
  const [html,app,css]=await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('ui/workspace-system.css')
  ]);
  assert.match(html,/<span lang="zh-CN">匹配类目<\/span><span lang="en">Matched Category<\/span>/);
  assert.match(html,/商品类目评分 \/ Product Category Score/);
  assert.match(app,/p8-evidence-score/);
  assert.match(app,/商品类目评分','Product Category Score/);
  assert.match(app,/data-label="匹配类目 \/ Matched Category"/);
  assert.match(app,/类目供货机会','Category supply opportunity/);
  assert.match(app,/公司经营类目/);
  assert.match(app,/DPV 可供货批准类目/);
  assert.match(app,/公司类目证据','Company Category Evidence/);
  assert.match(css,/\.p8-evidence-score/);
  assert.doesNotMatch(`${html}\n${app}`,/>产品匹配<|>Product Match<|产品匹配 \/ Product Match/);
});

test('Phase 10 responsive UI uses tokens, internal scrolling and safe async controls',async()=>{
  const [html,css,research]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase10-workbench.css'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.match(html,/href="\/ui\/phase10-workbench\.css\?v=20260901"/);
  assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b/i);
  assert.match(css,/\.p10-workstream-list\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/);
  assert.match(css,/@media \(max-width: 767px\)/);
  assert.match(css,/prefers-reduced-motion: reduce/);
  assert.match(research,/event\.currentTarget\.disabled=true/);
  assert.match(research,/button\.disabled=true;[\s\S]*?Promise\.resolve\(loadSummary\(\)\)\.finally/);
  assert.doesNotMatch(html,/maximum-scale|user-scalable\s*=\s*no/i);
});
