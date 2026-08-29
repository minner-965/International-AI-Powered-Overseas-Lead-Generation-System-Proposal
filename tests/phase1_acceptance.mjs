import assert from 'node:assert/strict';

const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000';

async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${payload.detail || payload.error || response.status}`);
  return { response, payload };
}

const { payload: health } = await request('/api/health');
assert.equal(health.status, 'ok');

const { payload: leads } = await request('/api/leads');
assert.equal(leads.length, 93, 'Phase 1 must preserve all 93 existing companies');

const existingOrigins = new Set([
  'fixed_public_candidate',
  'fixed_public_profile',
  'directory_live',
  'osm_live',
  'legacy_public_web'
]);
assert.ok(leads.every(lead => existingOrigins.has(lead.data_origin)), 'existing records need precise non-live provenance');
assert.ok(leads.every(lead => lead.data_origin !== 'live_discovered'), 'existing records must not be labeled live_discovered');
assert.ok(leads.every(lead => lead.data_origin !== 'public_web'), 'generic public_web provenance must be migrated');

const { payload: jobs } = await request('/api/research/jobs');
assert.ok(Array.isArray(jobs));
assert.ok(jobs.every(job => /^[0-9a-f-]{36}$/i.test(job.job_id)));

console.log('PASS: Phase 1 provenance and ResearchJob persistence invariants remain valid');
console.log(JSON.stringify({ research_job_count: jobs.length, company_count: leads.length }, null, 2));
