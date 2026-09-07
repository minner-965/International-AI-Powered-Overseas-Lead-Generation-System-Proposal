import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { persistedProgress, profileLabel, outreachTaskRows, outreachTaskLabel } from '../public/ui/v3/research-jobs.js';

test('V3 job progress uses persisted progress only and never infers completion from result count', () => {
  assert.equal(persistedProgress({companies_selected:9,max_results:10}),null);
  assert.equal(persistedProgress({progress_percent:0}),0);
  assert.equal(persistedProgress({progress_percent:35.7}),36);
  assert.equal(persistedProgress({progress_percent:120}),100);
  assert.equal(persistedProgress({progress_percent:'unknown'}),null);
});
test('V3 profile labels conceal internal enums without rewriting human category values', () => {
  assert.match(profileLabel('WOMENSWEAR'),/女装/);
  assert.match(profileLabel('GENERAL_MERCHANDISE'),/日用百货/);
  assert.equal(profileLabel('INTERNAL_CATEGORY_V99'),'其他类目 / Other category');
  assert.equal(profileLabel('Summer dresses'),'Summer dresses');
});
test('V3 email jobs include only persisted prospect drafts/messages', () => {
  const rows=outreachTaskRows({items:[{company_id:'a'},{draft_id:'d'},{message_id:'m'}, {message_id:'c',scope:'CONTROLLED'}]});
  assert.equal(rows.length,2);
  assert.equal(rows[0].draft_id,'d');
  assert.equal(outreachTaskRows(null).length,0);
  assert.equal(outreachTaskLabel({business_contact_status:'SENT_NO_REPLY'})[1],'Sent, no reply yet');
  assert.equal(outreachTaskLabel({business_contact_status:'OPTED_OUT'})[1],'Opted out');
  assert.equal(outreachTaskLabel({send_status:'SEND_AMBIGUOUS'})[1],'Send result needs review');
});
test('V3 Research keeps one existing form, all request fields, four native steps and read-only mail tab',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/ui/phase9-research-workbench.js',import.meta.url),'utf8');
  assert.equal((html.match(/id="research-form"/g)||[]).length,1);
  for(const hook of ['research-country','research-product-profile','research-city','research-region','research-limit','start-research']) assert.ok(html.includes(`id="${hook}"`));
  assert.equal((html.match(/data-research-step="[1-4]"/g)||[]).length,4);
  for(const tab of ['research','import','export','outreach']) assert.ok(html.includes(`data-jobs-tab="${tab}"`));
  assert.match(js,/managementRequest\('\/api\/outreach\/workbench'\)/);
  assert.match(js,/data-close-job/);
  assert.match(js,/state\.detailOpener\.focus/);
  assert.match(js,/state\.dialogOpener\.focus/);
});
test('V3 Research uses semantic layout replacement and mobile cards without old palette or document scaling',async()=>{
  const css=await readFile(new URL('../public/ui/phase9-research-workbench.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/--p8-|linear-gradient|shimmer|!important|zoom\s*:|scale\(/);
  assert.match(css,/repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/max-height:70dvh/);
  assert.match(css,/\.p9-jobs-table td:nth-child\(1\)\{grid-column:1;grid-row:1 \/ span 2\}/);
  assert.match(css,/\.p9-jobs-table td:nth-child\(7\)\{grid-column:2;grid-row:2\}/);
  assert.match(css,/min-height:110px/);
  assert.match(css,/prefers-reduced-motion/);
});
