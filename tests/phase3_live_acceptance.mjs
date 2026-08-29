import assert from 'node:assert/strict';

if (process.env.RUN_LIVE_SEARCH_ACCEPTANCE !== '1') {
  throw new Error('Set RUN_LIVE_SEARCH_ACCEPTANCE=1 only for one intentional provider acceptance run.');
}

const baseUrl = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
const maxResults = Number(process.env.PHASE3_MAX_RESULTS || 5);
const waitTimeoutMs = Number(process.env.PHASE3_WAIT_TIMEOUT_MS || 180000);

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${payload.error || payload.detail || 'request failed'}`);
  return payload;
}

const metricsBefore = await request('/api/metrics');
const created = await request('/api/research/jobs', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    country: 'United Arab Emirates',
    city: 'Dubai',
    product_category: 'Beauty & Personal Care',
    buyer_types: ['Importer', 'Wholesaler', 'Distributor'],
    max_results: maxResults
  })
});

const deadline = Date.now() + waitTimeoutMs;
let job;
do {
  await new Promise(resolve => setTimeout(resolve, 1000));
  job = await request(`/api/research/jobs/${encodeURIComponent(created.job_id)}`);
} while (!['COMPLETED', 'FAILED'].includes(job.status) && Date.now() < deadline);

assert.equal(job.status, 'COMPLETED', job.last_error || 'ResearchJob did not complete');
assert.ok(job.search_successful_requests >= 1, 'No provider query succeeded');
const queries = await request(`/api/research/jobs/${encodeURIComponent(created.job_id)}/queries`);
const candidates = await request(`/api/research/jobs/${encodeURIComponent(created.job_id)}/candidates?limit=100`);
const metricsAfter = await request('/api/metrics');

assert.ok(queries.length >= 1 && queries.length <= 5);
assert.ok(candidates.length <= maxResults);
assert.equal(candidates.length, job.candidates_found);
assert.ok(candidates.every(candidate => candidate.provider && candidate.url && candidate.title && candidate.captured_at));
assert.ok(candidates.every(candidate => candidate.provider === 'tavily'));
assert.ok(candidates.every(candidate => Array.isArray(candidate.found_by_queries) && candidate.found_by_queries.length));
assert.equal(metricsAfter.unique_companies, metricsBefore.unique_companies, 'Search discovery created a Company record');

console.log(JSON.stringify({
  job_id: created.job_id,
  status: job.status,
  max_results: maxResults,
  query_count: queries.length,
  api_requests: job.search_api_requests,
  successful_requests: job.search_successful_requests,
  failed_requests: job.search_failed_requests,
  raw_results: job.search_raw_results,
  noise_rejected: job.search_noise_rejected,
  duplicates_removed: job.search_duplicates_removed,
  candidates_found: job.candidates_found,
  unique_root_domains: new Set(candidates.map(candidate => candidate.root_domain)).size,
  runtime_ms: job.search_runtime_ms,
  credits_used: job.search_credits_used,
  companies_before: metricsBefore.unique_companies,
  companies_after: metricsAfter.unique_companies
}, null, 2));
