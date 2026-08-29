import assert from 'node:assert/strict';

const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000';

async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${payload.detail || payload.error || response.status}`);
  return { response, payload };
}

const input = {
  country: 'United Arab Emirates',
  city: 'Dubai',
  product_category: 'Beauty & Personal Care',
  buyer_types: ['Importer', 'Wholesaler', 'Distributor'],
  max_results: 5
};

const { response, payload: created } = await request('/api/research/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input)
});
assert.equal(response.status, 202);
assert.equal(created.dispatch, 'accepted');
assert.equal(created.status, 'QUEUED');
assert.match(created.job_id, /^[0-9a-f-]{36}$/i);

const observed = new Set([created.status]);
let job;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const result = await request(`/api/research/jobs/${created.job_id}`);
  job = result.payload;
  observed.add(job.status);
  if (['COMPLETED', 'FAILED'].includes(job.status)) break;
  await new Promise(resolve => setTimeout(resolve, 250));
}

assert.equal(job.job_id, created.job_id);
assert.equal(job.status, 'COMPLETED');
assert.ok(observed.has('DISCOVERING'), 'DISCOVERING must be observable from the persisted API');
assert.ok(job.started_at);
assert.ok(job.completed_at);

for (const counter of [
  'candidates_found', 'websites_found', 'companies_crawled',
  'companies_qualified', 'companies_rejected', 'tier_a_count',
  'tier_b_count', 'tier_c_count', 'error_count'
]) assert.equal(job[counter], 0, `${counter} must remain zero in Phase 2`);

const { payload: leads } = await request('/api/leads');
assert.equal(leads.length, 93);

console.log('PASS: Phase 2 Express → n8n → ResearchJob lifecycle acceptance checks passed');
console.log(JSON.stringify({ job_id: job.job_id, observed_statuses: [...observed], company_count: leads.length }, null, 2));
