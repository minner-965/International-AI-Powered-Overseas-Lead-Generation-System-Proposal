import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const compose = await readFile(new URL('../../../compose.yaml', import.meta.url), 'utf8');
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

test('Phase 5 read APIs keep DPV score and Customer Match separate', () => {
  for (const route of [
    '/api/companies/:id/score',
    '/api/companies/:id/score-history',
    '/api/companies/:id/customer-match',
    '/api/companies/:id/customer-match-history',
    '/api/companies/:id/lifecycle-history',
    '/api/icp/profiles',
    '/api/icp/profiles/:id',
    '/api/opportunities'
  ]) assert.match(server, new RegExp(route.replaceAll('/', '\\/').replace(':id', ':id')));
  assert.match(server, /dpv_score/);
  assert.match(server, /customer_match/);
});

test('management mutations use the internal-token boundary', () => {
  for (const route of [
    '/api/internal/scoring/recalculate',
    '/api/internal/customer-match/recalculate',
    '/api/internal/scoring/replay',
    '/api/internal/icp/rebuild',
    '/api/reference-data/imports/dry-run',
    '/api/reference-data/imports/:id/commit',
    '/api/reference-data/imports/:id',
    '/api/internal/data-cleanup/dry-run',
    '/api/internal/data-cleanup/batches/:batchId'
  ]) {
    const escaped = route.replaceAll('/', '\\/').replace(':id', ':id');
    assert.match(server, new RegExp(`app\\.(?:get|post)\\('${escaped}', requireInternalToken`));
  }
});

test('active opportunity contract requires verified active companies and exposes lifecycle facts', () => {
  assert.match(server, /c\.verification_status='VERIFIED'/);
  assert.match(server, /c\.lifecycle_status='ACTIVE'/);
  assert.match(server, /c\.explicit_exclusion_reason IS NULL/);
  for (const field of [
    'verification_status','lifecycle_status','last_verified_at','verification_source_count',
    'verification_freshness','explicit_exclusion_reason','product_profiles'
  ]) assert.match(server, new RegExp(field));
});

test('management metrics distinguish quality and lifecycle populations', () => {
  for (const field of [
    'verified_active','review','rejected','stale','superseded','duplicate','archived','legacy_pending_review'
  ]) assert.match(server, new RegExp(`AS ${field}`));
});

test('transactional outbox and direct pg-boss are the only ResearchJob dispatch path', () => {
  assert.doesNotMatch(server, /N8N_RESEARCH_WEBHOOK_URL|triggerResearchWorkflow|RESEARCH_DIRECT_QUEUE_DISPATCH/);
  assert.match(server, /researchDirectDispatchService\.createAtomic/);
  assert.match(server, /phase5Queue\.enqueueFlow/);
  assert.match(server, /QUALIFYING: new Set\(\['SCORING',\s*'COMPLETED',\s*'FAILED'\]\)/);
  assert.match(server, /SCORING: new Set\(\['COMPLETED',\s*'FAILED'\]\)/);
});

test('direct research scoring carries the selected product profile into Customer Match', () => {
  assert.match(server, /SELECT product_profile FROM leadgen\.research_jobs WHERE id=\$1/);
  assert.match(server, /matchCompanySet\(\{research_job_id:jobId,product_scope:productScope\}/);
});

test('completed category procurement refreshes decisions before scheduling auto evidence', () => {
  assert.match(server, /refreshOpportunityDecisions[\s\S]+category-procurement-completed:/);
});

test('container build includes pinned application dependencies and externalized rules', () => {
  assert.match(compose, /context: \./);
  assert.match(compose, /dockerfile: services\/demo-dashboard\/Dockerfile/);
  assert.match(dockerfile, /COPY rules \.\/rules/);
  assert.match(dockerfile, /DPV_RULES_DIR=\/app\/rules/);
});

test('management responses and frontend API requests do not reuse stale scoring state', () => {
  assert.match(server, /Cache-Control', 'no-store'/);
  assert.match(frontend, /fetch\(url, \{ cache: 'no-store', \.\.\.options,/);
});
