#!/usr/bin/env node
// Approves the supply categories a new installation searches for, through the
// running application's category-scope API (no database credentials needed).
//
//   node scripts/setup-supply-categories.mjs --list
//   node scripts/setup-supply-categories.mjs --categories WOMENSWEAR:DRESSES,WOMENSWEAR:TOPS
//   node scripts/setup-supply-categories.mjs --all
//   option: --base http://127.0.0.1:3100 (default: DASHBOARD_PORT from .env, else 3100; inside the container use http://127.0.0.1:3000)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
function dashboardPort() {
  try { return readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^DASHBOARD_PORT=(\d+)\s*$/m)?.[1] || '3100'; }
  catch { return '3100'; }
}
const base = (option('--base') || process.env.APP_BASE_URL || `http://127.0.0.1:${dashboardPort()}`).replace(/\/$/, '');

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${response.status} ${body.code || ''} ${body.error || ''}`.trim());
  return body;
}

const candidates = (await request('/api/category-scopes/candidates')).items;
const byKey = new Map();
for (const item of candidates) {
  const key = `${item.product_profile}:${item.normalized_category}`;
  if (!byKey.has(key)) byKey.set(key, item);
}
const current = (await request('/api/category-scopes/current')).items;

if (args.includes('--list') || (!args.includes('--all') && !option('--categories'))) {
  console.log('Candidate supply categories (profile:category):');
  for (const key of byKey.keys()) console.log(`  ${key}`);
  console.log(`Currently approved: ${current.length ? current.map(row => `${row.product_profile}:${row.normalized_category}`).join(', ') : 'none'}`);
  console.log('Approve with --categories A:B,C:D or --all');
  process.exit(0);
}

const wanted = args.includes('--all') ? [...byKey.keys()] : option('--categories').split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
const unknown = wanted.filter(key => !byKey.has(key));
if (unknown.length) { console.error(`Unknown categories: ${unknown.join(', ')}`); process.exit(1); }

const scopes = wanted.map((key, index) => {
  const item = byKey.get(key);
  return { client_key: `scope-${index + 1}`, product_profile: item.product_profile, normalized_category: item.normalized_category,
    scope_status: 'ACTIVE', source_fact_digest: item.source_fact_digest };
});
const sourceDigest = createHash('sha256').update(JSON.stringify(wanted.slice().sort())).digest('hex');
const revisions = (await request('/api/category-scopes/revisions')).items || [];
const revision = Math.max(0, ...revisions.map(row => Number(row.revision) || 0)) + 1;
const sourceReference = `setup-supply-categories:${new Date().toISOString().slice(0, 10)}`;

const draft = await request('/api/category-scopes/revisions', { method: 'POST',
  body: JSON.stringify({ revision, source_type: 'MANAGEMENT_APPROVED', source_reference: sourceReference, source_digest: sourceDigest, scopes }) });
const approved = await request(`/api/category-scopes/revisions/${draft.id}/approve`, { method: 'POST',
  body: JSON.stringify({ revision: revision + 1, source_reference: sourceReference, source_digest: sourceDigest }) });
console.log(`Approved revision ${approved.revision}: ${approved.scope_count} categories (${wanted.join(', ')})`);
