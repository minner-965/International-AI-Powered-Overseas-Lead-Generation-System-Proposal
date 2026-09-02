import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readPublic=name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8');

test('Research Workbench keeps four real metrics and at most three priority tasks',async()=>{
  const [html,ui]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.match(html,/id="research-workbench-summary"[\s\S]*?(?:class="p9-metric is-loading"[\s\S]*?){4}<\/section>/);
  assert.match(ui,/\/api\/research\/tasks\?limit=12&sort=priority_desc/);
  assert.match(ui,/reviewItems\.slice\(0,3\)/);
  assert.match(ui,/\/api\/research\/jobs\?view=inbox&limit=6&sort=updated_desc/);
});

test('new research job remains a native three-step dialog with explicit close and focus restoration',async()=>{
  const [html,ui]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.match(html,/<dialog id="research-job-dialog"/);
  assert.equal((html.match(/class="p9-dialog-step"/g)||[]).length,3);
  assert.match(html,/data-research-dialog-close/);
  assert.match(ui,/dialog\.showModal\(\)/);
  assert.match(ui,/dialogOpener\.focus\(\{ preventScroll:true \}\)/);
});

test('Jobs Inbox preserves three tabs, seven decision columns and seven pipeline stages',async()=>{
  const [html,ui]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase9-research-workbench.js')
  ]);
  assert.equal((html.match(/data-jobs-tab=/g)||[]).length,3);
  for(const [zh,en] of [
    ['任务 / 目标','Job / Objective'],['市场 / 产品','Market / Profile'],['阶段 / 状态','Stage / Status'],
    ['进度','Progress'],['结果','Results'],['最近阻断 / 活动','Latest Blocker / Activity'],['操作','Action']
  ]){
    assert.ok(html.includes(`>${zh}<`)&&html.includes(`>${en}<`),`missing jobs heading: ${zh} / ${en}`);
  }
  for(const stage of ['Identity','Buyer Model','Category Procurement','Supplier Access','Buyer / Role','Email verification','Status refresh']){
    assert.ok(ui.includes(`'${stage}'`),`missing pipeline stage: ${stage}`);
  }
});

test('job navigation restores the exact opener and keeps safe evidence links',async()=>{
  const ui=await readPublic('ui/phase9-research-workbench.js');
  assert.match(ui,/pendingJobFocus/);
  assert.match(ui,/detailOpenerJobId/);
  assert.match(ui,/window\.addEventListener\('popstate'/);
  assert.match(ui,/safeUrl\(/);
  assert.match(ui,/target="_blank" rel="noreferrer"/);
});

test('Phase 9 responsive surface uses internal scrolling without disabling browser zoom',async()=>{
  const [html,css]=await Promise.all([
    readPublic('index.html'),
    readPublic('ui/phase9-research-workbench.css')
  ]);
  assert.match(css,/\.p9-jobs-list-panel \.table-responsive\s*\{[\s\S]*?max-height:[\s\S]*?overflow:\s*auto/);
  assert.match(css,/100dvh/);
  assert.doesNotMatch(html,/maximum-scale|user-scalable\s*=\s*no/i);
  assert.doesNotMatch(css,/linear-gradient|radial-gradient|conic-gradient/i);
});
