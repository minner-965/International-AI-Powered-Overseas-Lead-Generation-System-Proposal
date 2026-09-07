import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productMatchReasonLabel, productOpportunityStatusLabel } from '../public/product-match-ui.js';

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('research modules display business labels rather than processing narration', () => {
  const source = read('ui/phase9-research-workbench.js');
  assert.doesNotMatch(source, /Provider retries|Worker recoveries|Provider calls|Auto [Ee]nrichment|自动补证|快照时间|无已报告阻断/);
  assert.match(source, /资料核验/);
  assert.match(source, /待解决事项/);
  for (const key of ['provider_retry_number','worker_retry_number','strategy_attempt_number','provider_call_count','search_raw_results']) assert.ok(source.includes(key));
});

test('older product states retain mapping without obsolete SKU workflow instructions', () => {
  assert.deepEqual(productOpportunityStatusLabel('SKU_READY'), ['类目评估待更新','Category assessment needs updating']);
  assert.deepEqual(productOpportunityStatusLabel('INTERNAL_CATALOG_UPLOAD_REQUIRED'), ['类目评估待更新','Category assessment needs updating']);
  assert.deepEqual(productMatchReasonLabel('MOQ_ORDER_FORMAT_OPTIONAL_UNTIL_INTEREST'), ['订单条件可在合作意向后商议','Discuss order terms after interest']);
  assert.doesNotMatch(read('product-match-ui.js'), /Legacy state|无需前期补充|由老板沟通/);
});

test('a removed contact row invalidates modal controls without discarding the composer', () => {
  const source = read('ui/outreach-workbench.js');
  const missing = source.slice(source.indexOf('if(!row){'), source.indexOf('const frozen='));
  for (const id of ['outreach-save','outreach-submit','outreach-approve','outreach-reject','outreach-send','outreach-contact-approve']) assert.ok(missing.includes(id));
  assert.match(missing, /\.disabled=true/);
  assert.match(missing, /\.readOnly=true/);
  assert.match(missing, /dialog\.setAttribute\('aria-busy',String\(state\.busy\)\)/);
  assert.doesNotMatch(missing, /\.value\s*=/);
  assert.match(source, /renderList\(\);controls\(\)/);
  assert.match(source, /if\(state\.busy\|\|!state\.row\|\|state\.data\?\.read_failed\)return/);
});

test('failed refresh invalidates every mutation until successful refresh', () => {
  const source = read('ui/outreach-workbench.js');
  assert.match(source, /if\(state\.data\?\.read_failed\)for\(const id of \['outreach-save','outreach-submit','outreach-approve','outreach-reject','outreach-send','outreach-contact-approve'\]\)q\(id\)\.disabled=true/);
  assert.match(source, /state\.data\.read_failed=true/);
});
