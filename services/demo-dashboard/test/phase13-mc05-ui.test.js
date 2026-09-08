import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/ui/v3/research-batch.js',import.meta.url),'utf8');
test('MC05 Research reads registries and sends one parent request rather than browser scope fan-out',()=>{
  assert.match(source,/\/api\/research\/batches\/options/);
  assert.match(source,/item.status==='ACTIVE'&&item.search_enabled===true/);
  assert.match(source,/Select all active markets/);assert.match(source,/Select all approved categories/);
  assert.match(source,/category_scope_ids/);assert.doesNotMatch(source,/product_master|\/api\/research\/jobs['"]/);
});
test('MC05 selection is persistent, scopes preview is live and in-flight Create is guarded',()=>{
  for(const value of ['sessionStorage.setItem','sessionStorage.getItem','idempotency_key','crypto.randomUUID','if(creating||','aria-atomic','market_codes','buyer_types','Languages'])assert.ok(source.includes(value),value);
  assert.match(source,/markets.length\*categories.length/);assert.match(source,/research-batch-detail/);assert.match(source,/data-batch-back/);assert.match(source,/popstate/);
});
test('MC05 city filtering is limited to single market and existing V3 business hooks remain',async()=>{
  assert.match(source,/input.disabled=markets.length!==1/);
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');assert.match(app,/dataset.researchBatch === 'true'\) return/);
  const css=await readFile(new URL('../public/ui/phase9-research-workbench.css',import.meta.url),'utf8');assert.match(css,/\.v3-registry-option\{min-height:44px/);assert.doesNotMatch(source,/smtp|\/api\/outreach\/send|BRAVE_API/);
});
