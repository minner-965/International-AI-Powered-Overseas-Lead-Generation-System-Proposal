// Every button, role=button control and button-like link explains itself with a data-tip
// ("中文|English") shown on hover, keyboard focus and long-press (ui/v4/tooltips.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { placeTip, parseTip, VIEW_TIPS } from '../public/ui/v4/tooltips.js';

const publicUrl = new URL('../public/', import.meta.url);
async function sourceFiles() {
  const files = ['index.html', 'login.html'];
  for (const dir of ['', 'ui/', 'ui/v3/', 'ui/v4/']) {
    for (const name of await readdir(new URL(dir, publicUrl))) if (name.endsWith('.js')) files.push(`${dir}${name}`);
  }
  const out = [];
  for (const file of files) { try { out.push([file, await readFile(new URL(file, publicUrl), 'utf8')]); } catch { /* optional page */ } }
  return out;
}

/** End of an opening tag that may contain ${…} interpolations, quotes and arrow functions. */
function tagEnd(source, start) {
  let depth = 0; let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue; }
    if (c === '$' && source[i + 1] === '{') { depth++; i++; continue; }
    if (depth > 0 && c === '{') { depth++; continue; }
    if (depth > 0 && c === '}') { depth--; continue; }
    if (depth === 0 && c === '>' && source[i - 1] !== '=') return i;
  }
  return -1;
}
function openingTags(source, name) {
  const tags = []; let from = 0;
  for (;;) {
    const start = source.indexOf(`<${name}`, from);
    if (start < 0) break;
    const after = source[start + name.length + 1];
    if (after === ' ' || after === '>' || after === '\n') tags.push(source.slice(start, tagEnd(source, start) + 1));
    from = start + 1;
  }
  return tags;
}
const explained = tag => /data-tip=|\$\{(?:tip|viewTip)\(/.test(tag);
const buttonLikeLink = tag => /class="[^"]*\b(?:btn|m-menu|lnk|kpi)\b|data-open-view=|data-quick-action=|data-m-views=/.test(tag);

test('every button, role=button control and button-like link carries an explanation', async () => {
  const missing = [];
  for (const [file, source] of await sourceFiles()) {
    if (file === 'ui/v4/tooltips.js') continue;
    for (const tag of openingTags(source, 'button')) if (!explained(tag)) missing.push(`${file}: ${tag.slice(0, 120)}`);
    for (const tag of openingTags(source, 'a')) if (buttonLikeLink(tag) && !explained(tag)) missing.push(`${file}: ${tag.slice(0, 120)}`);
    for (const match of source.matchAll(/role="button"[^>]*>/g)) if (!/data-tip=/.test(match[0])) missing.push(`${file}: ${match[0].slice(0, 120)}`);
    for (const match of source.matchAll(/createElement\('button'\)/g)) {
      const window = source.slice(match.index, match.index + 600);
      if (!/dataset\.tip\s*=|setAttribute\('data-tip'/.test(window)) missing.push(`${file}: createElement('button') without dataset.tip`);
    }
  }
  assert.deepEqual(missing, []);
});

test('literal explanations are bilingual, short and free of internal wording', async () => {
  const banned = /Demo|真实数据|抓取|采集|爬取|去重|数据库|PostgreSQL|Docker|规则评分|外联已禁用/;
  for (const [file, source] of await sourceFiles()) {
    for (const match of source.matchAll(/data-tip="([^"$]*)"/g)) {
      const { zh, en } = parseTip(match[1]);
      assert.ok(zh && en, `${file}: ${match[1]} needs "中文|English"`);
      assert.ok(zh.length <= 60, `${file}: ${zh} is too long`);
      assert.doesNotMatch(match[1], banned, `${file}: ${match[1]}`);
    }
  }
  for (const [zh, en] of Object.values(VIEW_TIPS)) assert.ok(zh && en);
});

test('the bubble is placed inside the viewport, above when there is room, else below', () => {
  const anchor = { top: 300, bottom: 336, left: 600, width: 36 };
  const above = placeTip(anchor, 200, 40, 1440, 900);
  assert.equal(above.placement, 'top'); assert.equal(above.top, 300 - 40 - 8);
  const nearTop = placeTip({ top: 10, bottom: 46, left: 600, width: 36 }, 200, 40, 1440, 900);
  assert.equal(nearTop.placement, 'bottom'); assert.equal(nearTop.top, 54);
  const nearRight = placeTip({ top: 300, bottom: 336, left: 370, width: 20 }, 260, 60, 390, 844);
  assert.ok(nearRight.left >= 8 && nearRight.left + 260 <= 390 - 8);
  const nearLeft = placeTip({ top: 300, bottom: 336, left: 0, width: 20 }, 260, 60, 390, 844);
  assert.equal(nearLeft.left, 8);
  assert.deepEqual(parseTip('改阶段|Change stage'), { zh: '改阶段', en: 'Change stage' });
});

test('tooltips load on every page, follow focus and long-press, and give phones a "?" control', async () => {
  const [html, tips, css] = await Promise.all(['index.html', 'ui/v4/tooltips.js', 'ui/v4/app.css'].map(name => readFile(new URL(name, publicUrl), 'utf8')));
  assert.match(html, /src="\/ui\/v4\/tooltips\.js"/);
  assert.match(tips, /aria-describedby/);
  assert.match(tips, /role', 'tooltip'/);
  assert.match(tips, /:focus-visible/);
  assert.match(tips, /pointerType === 'touch'/);
  assert.match(tips, /className = 'tip-q'/);
  assert.match(css, /\.v4-tip \{ position: fixed;/);
  assert.match(css, /@media \(max-width: 900px\) \{ \.tip-q \{ display: inline-flex; \} \}/);
});
