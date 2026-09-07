import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');

test('page headings have no redundant section kicker and retain bilingual title hooks', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<p class="crm-context bi">/);
  for (const id of ['companies-title','contact-queue-title','customer-match-title','evidence-title','data-import-title','data-export-title','settings-title']) {
    assert.match(html, new RegExp(`<h2 id="${id}" class="bi"><span lang="zh-CN">[^<]+</span><span lang="en">[^<]+</span></h2>`));
  }
});

test('overview retains actual metric scope without repeating its heading or verified label', () => {
  const source = read('ui/v3/overview.js');
  assert.doesNotMatch(source, /Prospect Development Stages|Verified and active/);
  assert.match(source, /Current companies & opportunities · Cumulative prospect mail & replies/);
  assert.match(source, /Companies represented in current opportunities/);
});

test('commercial-fit copy states evidence scope without implementation narration', () => {
  const source = read('app.js');
  assert.match(source, /Commercial reference based on available evidence/);
  assert.doesNotMatch(source, /Uses existing public facts only|does not trigger enrichment|does not change the category gate|No public data|No public facts/);
  assert.match(source, /score==null\?pairHtml\(bandLabel\)/);
  assert.match(source, /sourceLinks\.map\(item=>/);
  assert.match(source, /unknown\.map\(item=>/);
});

test('file-size and controlled single-message scope remain explicit', () => {
  const html = read('index.html');
  assert.match(html, /Maximum file size: 10 MB/);
  assert.match(html, /Single test email · Step-by-step approval/);
  for (const id of ['data-import-submit','data-import-approve','data-import-commit']) {
    assert.match(html, new RegExp(`<button id="${id}"[^>]+disabled>`));
  }
});
