import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recordViews, evidenceUrl, evidenceRecords, renderEvidenceRecords, discloseOriginal, coveragePercent } from '../public/ui/v3/records.js';
import { cssSection } from './v4-css.js';

test('records package covers all five authorized surfaces',()=>{
  assert.deepEqual(recordViews,['evidence','customer-match','data-import','data-export','settings']);
});
test('profile coverage bars use exact numeric percentages, never absent coverage',()=>{
  assert.equal(coveragePercent('45.6%'),45.6);
  assert.equal(coveragePercent('0%'),0);
  for(const value of ['—','Limited','130%','-1%','']) assert.equal(coveragePercent(value),null);
});
test('evidence preserves actual source metadata and does not invent missing title/finding/time',()=>{
  assert.deepEqual(evidenceRecords({sources:[{url:'https://example.test',captured_at:'2026-09-07T00:00:00Z',evidence_kind:'COMPANY_CLAIM'}]}),[{url:'https://example.test/',captured:'2026-09-07T00:00:00Z',kind:'COMPANY_CLAIM',title:'',finding:''}]);
  const html=renderEvidenceRecords({sources:[{url:'https://example.test'}]});
  assert.match(html,/Time not recorded/);
  assert.doesNotMatch(html,/<time|<blockquote/);
});
test('evidence rejects script links and escapes returned evidence',()=>{
  assert.equal(evidenceUrl('javascript:alert(1)'),'');
  assert.equal(evidenceUrl('file:///secret'),'');
  const html=renderEvidenceRecords({sources:[{source_url:'javascript:alert(1)',page_title:'<script>x</script>',evidence_text:'<b>Original</b>'}]});
  assert.doesNotMatch(html,/<script|href="javascript/);
  assert.match(html,/&lt;b&gt;Original&lt;\/b&gt;/);
  assert.match(html,/No source link available/);
});
test('empty evidence remains a true empty state',()=>{
  assert.match(renderEvidenceRecords({}),/No source references/);
  assert.doesNotMatch(renderEvidenceRecords({}),/<li>/);
});
test('disclosure moves original node and is idempotent',()=>{
  const children=[];
  const document={createElement(tag){return {tag,className:'',append(...nodes){children.push(...nodes);for(const node of nodes)node.parentElement={classList:{contains:name=>name==='v3-record-disclosure'}};}};}};
  const node={ownerDocument:document,before(parent){this.insertedBefore=parent;}};
  const wrapper=discloseOriginal(node,'范围','Scope');
  assert.equal(wrapper.tag,'details');
  assert.equal(children[1],node);
  assert.equal(discloseOriginal(node,'范围','Scope'),null);
});
test('records adapter uses existing read endpoints without business submission',async()=>{
  const source=await readFile(new URL('../public/ui/v3/records.js',import.meta.url),'utf8');
  assert.match(source,/request\('\/api\/leads'\)/);
  assert.match(source,/request\(`\/api\/leads\/\$\{encodeURIComponent\(select.value\)\}`\)/);
  assert.doesNotMatch(source,/method\s*:\s*['"](?:POST|PATCH|DELETE|PUT)/);
  assert.doesNotMatch(source,/cloneNode|localStorage|\.submit\(/);
});
test('record styles keep compact mobile, scrollable stepper and visible native focus',async()=>{
  const css=cssSection('records');
  assert.match(css,/max-width:600px/);
  assert.match(css,/font-size:18px/);
  assert.match(css,/summary:focus-visible/);
  assert.match(css,/overflow-x:auto/);
  assert.doesNotMatch(css,/#[0-9a-fA-F]{3,8}\b|shimmer|linear-gradient/);
});
test('mobile ICP retains four primary facts and moves remaining original rows into disclosure',async()=>{
  const source=await readFile(new URL('../public/ui/v3/records.js',import.meta.url),'utf8');
  assert.match(source,/Array\.from\(facts.children\)\.slice\(4\)/);
  assert.match(source,/remainder\.append\(row\)/);
  assert.match(source,/More profile information/);
  assert.match(source,/disclosure.open=!mobile.matches/);
  assert.doesNotMatch(source,/facts\.innerHTML\s*=/);
});
