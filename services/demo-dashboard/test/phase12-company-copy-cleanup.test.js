import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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

test('research and company copy uses business terms while retaining workflow identifiers', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const source of [html, app]) {
    assert.doesNotMatch(source, /自动补证|Auto [Ee]nrichment|商务联系路径|企业联系路径汇总|等待自动处理/);
    assert.doesNotMatch(source, /真实数据|真实线索|公开数据|系统保持|不会自动发送/);
  }
  assert.match(html, /value="AUTO_EVIDENCE">资料核验 \/ Evidence review/);
  assert.match(html, /name="blocker"/);
  assert.match(html, /待解决事项/);
  assert.match(app, /QUEUED:\['等待核验','Queued'\]/);
  assert.match(app, /esc\(record\.evidence_text\)/);
  assert.match(app, /esc\(contact\.contact_value\)/);
});

test('source-page checks show known business states without inventing success or exposing internal codes', () => {
  const app = read('app.js');
  const declaration = app.slice(app.indexOf('function candidatePageStatusLabel('), app.indexOf('function candidateEvidence('));
  const label = runInNewContext(`${declaration}; candidatePageStatusLabel`);
  assert.equal(label('COMPLETED')[1], 'Page reviewed');
  for (const value of ['HTTP_ERROR','NON_HTML','BLOCKED_BY_ROBOTS','ROBOTS_BLOCKED','POLICY_BLOCKED','CROSS_DOMAIN_REDIRECT','INVALID_URL','TOO_LARGE','TIMEOUT','NETWORK_ERROR','NOT_FETCHED']) {
    assert.notEqual(label(value)[1], 'Page reviewed');
    assert.notEqual(label(value)[1], 'Page status unconfirmed');
    assert.notEqual(label(value)[1], value);
  }
  for (const value of [null, undefined, '', 'UNKNOWN_NEW_STATUS', '200']) assert.equal(label(value)[1], 'Page status unconfirmed');
  const renderer = app.slice(app.indexOf('function candidateEvidence('), app.indexOf('const statusClass'));
  assert.doesNotMatch(renderer, /HTTP status|Fetch URL|esc\(primary\.fetch_status/);
  assert.match(renderer, /esc\(primary\.requested_url \|\| candidate\.url\)/);
  assert.match(renderer, /esc\(primary\.page_title \|\| '-'\)/);
  assert.match(renderer, /candidate\.checked_at \|\| primary\.captured_at/);
});
