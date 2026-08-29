import assert from 'node:assert/strict';

const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000';
async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${payload.detail || payload.error || response.status}`);
  return payload;
}

const run = await request('/api/live/collect', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 50 })
});
assert.equal(run.run, 'completed');
assert.ok(run.metrics.unique_companies >= 10, 'at least ten real public-source records');
assert.equal(Number(run.metrics.source_traceability_pct), 100);
assert.equal(run.metrics.send_enabled, 0);
assert.ok(run.providers.length >= 2, 'multiple live providers');
assert.ok(Number.isInteger(run.newCompanies));
assert.ok(Number.isInteger(run.updatedCompanies));

const firstTotal = run.metrics.unique_companies;
const secondRun = await request('/api/live/collect', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 50 })
});
assert.ok(secondRun.metrics.unique_companies >= firstTotal, 'a later collection must retain earlier real leads');
assert.ok(secondRun.updatedCompanies >= 1, 'existing companies are updated rather than cleared');

const leads = await request('/api/leads');
assert.equal(leads.length, secondRun.metrics.unique_companies);
const acceptedPublicOrigins = new Set([
  'live_discovered', 'fixed_public_candidate', 'fixed_public_profile',
  'directory_live', 'osm_live', 'legacy_public_web'
]);
assert.ok(leads.every(lead => acceptedPublicOrigins.has(lead.data_origin)));
assert.ok(leads.every(lead => lead.data_origin !== 'live_discovered' || lead.research_job_id));
assert.ok(leads.every(lead => !lead.normalized_domain.endsWith('.example')));
assert.ok(leads.some(lead => lead.website_url?.startsWith('http')));

const detail = await request(`/api/leads/${leads[0].id}`);
assert.ok(detail.sources.length >= 1);
assert.ok(detail.sources.every(source => source.url.startsWith('http')));
assert.ok(detail.sources.every(source => source.captured_at));
assert.equal(detail.send_status, 'disabled');
assert.match(detail.product_match, /女装/);
assert.notEqual(detail.email_verification_status, 'not_checked');

console.log('PASS: live public-data collection acceptance checks passed');
console.log(JSON.stringify({ metrics: run.metrics, providers: run.providers, sourceErrors: run.sourceErrors }, null, 2));
