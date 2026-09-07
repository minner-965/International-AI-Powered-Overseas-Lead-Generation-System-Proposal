import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
async function files(directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    result.push(...(entry.isDirectory() ? await files(target) : [target]));
  }
  return result;
}

test('replaced hero, shell and KPI selector families stay absent from served CSS', async () => {
  const css = (await Promise.all((await files()).filter(file => file.endsWith('.css')).map(file => readFile(file, 'utf8')))).join('\n');
  for (const family of ['hero', 'crm-sidebar', 'crm-topbar', 'crm-command-bar', 'crm-kpi-strip', 'crm-overview-grid', 'p8-overview-readiness', 'p8-overview-reason-list', 'crm-product-match-candidates']) {
    assert.doesNotMatch(css, new RegExp(`\\.${family}(?![\\w-])`), family);
  }
});

test('every retained public JS file is reachable from HTML through module imports', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const pending = [...html.matchAll(/<script[^>]*src="(\/[^"?]+\.js)(?:\?[^" ]*)?"/g)]
    .map(match => match[1]).filter(url => !url.startsWith('/vendor/')).map(url => path.join(root, url.slice(1)));
  const visited = new Set();
  while (pending.length) {
    const file = path.normalize(pending.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+\.js)['"]/g)) pending.push(path.resolve(path.dirname(file), match[1]));
  }
  const scripts = (await files()).filter(file => file.endsWith('.js')).map(file => path.normalize(file));
  assert.deepEqual(scripts.filter(file => !visited.has(file)), [], 'unreferenced scripts must be reviewed and removed');
});

test('every retained public stylesheet is linked from the application', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const linked = new Set([...html.matchAll(/href="(\/[^"?]+\.css)(?:\?[^" ]*)?"/g)].map(match => path.normalize(path.join(root, match[1].slice(1)))));
  assert.deepEqual((await files()).filter(file => file.endsWith('.css') && !linked.has(path.normalize(file))), []);
});
