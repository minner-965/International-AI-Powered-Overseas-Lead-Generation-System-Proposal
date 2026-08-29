import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseCanonical,
  cleanupProposal,
  conservativeDuplicateDecision,
  isActiveOpportunity,
  LIFECYCLE_STATUSES,
  strongCompanySignals,
  verificationFreshness,
  VERIFICATION_STATUSES
} from '../src/lifecycle/companyLifecycleService.js';

const company = (overrides = {}) => ({
  id: crypto.randomUUID(),
  company_name: 'Atlas Retail Group LLC',
  country_code: 'AE',
  country_name: 'United Arab Emirates',
  website_url: 'https://atlas.example.com',
  official_root_domain: 'atlas.example.com',
  verification_status: 'REVIEW',
  lifecycle_status: 'ACTIVE',
  data_origin: 'osm_live',
  created_at: '2025-01-01T00:00:00.000Z',
  source_count: 1,
  contact_count: 0,
  business_evidence_count: 0,
  contacts: [],
  sources: [{ source_url: 'https://directory.example/atlas' }],
  dependencies: {
    sources: 1, contacts: 0, lead_reviews: 0, score_runs: 0, match_runs: 0,
    facts_snapshots: 0, research_jobs: 0, candidate_verifications: 0,
    verification_evidence: 0, social_accounts: 0
  },
  ...overrides
});

test('verification and lifecycle status domains are explicit and independent', () => {
  assert.deepEqual(VERIFICATION_STATUSES, ['VERIFIED', 'REVIEW', 'REJECTED']);
  assert.deepEqual(LIFECYCLE_STATUSES, ['ACTIVE', 'STALE', 'SUPERSEDED', 'DUPLICATE', 'INVALID', 'ARCHIVED']);
  assert.equal(isActiveOpportunity({ verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' }), true);
  for (const verification_status of ['REVIEW', 'REJECTED']) {
    assert.equal(isActiveOpportunity({ verification_status, lifecycle_status: 'ACTIVE' }), false);
  }
  for (const lifecycle_status of LIFECYCLE_STATUSES.filter(value => value !== 'ACTIVE')) {
    assert.equal(isActiveOpportunity({ verification_status: 'VERIFIED', lifecycle_status }), false);
  }
  assert.equal(isActiveOpportunity({ verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE', explicit_exclusion_reason: 'OEM_ONLY' }), false);
});

test('verification freshness uses documented current, aging, stale and unknown bands', () => {
  const now = new Date('2026-08-28T00:00:00.000Z');
  assert.equal(verificationFreshness(null, now), 'UNKNOWN');
  assert.equal(verificationFreshness('2026-04-01T00:00:00.000Z', now), 'CURRENT');
  assert.equal(verificationFreshness('2025-12-01T00:00:00.000Z', now), 'AGING');
  assert.equal(verificationFreshness('2025-01-01T00:00:00.000Z', now), 'STALE');
});

test('same registrable domain is a strong duplicate signal', () => {
  const left = company({ company_name: 'Atlas Retail Group', website_url: 'https://www.atlas.com/about', official_root_domain: null });
  const right = company({ company_name: 'Atlas Group UAE', website_url: 'https://shop.atlas.com', official_root_domain: null });
  const decision = conservativeDuplicateDecision(left, right);
  assert.equal(decision.duplicate, true);
  assert.ok(decision.signals.includes('EXACT_REGISTRABLE_DOMAIN'));
});

test('same name in different countries and fuzzy name only are not auto-merged', () => {
  const ae = company({ website_url: null, official_root_domain: null, company_name: 'Atlas Retail Group', country_code: 'AE' });
  const mx = company({ website_url: null, official_root_domain: null, company_name: 'Atlas Retail Group', country_code: 'MX' });
  assert.equal(conservativeDuplicateDecision(ae, mx).duplicate, false);
  const fuzzy = company({ website_url: null, official_root_domain: null, company_name: 'Atlas Retail Holdings', country_code: 'AE' });
  assert.equal(conservativeDuplicateDecision(ae, fuzzy).duplicate, false);
  assert.deepEqual(strongCompanySignals(ae, fuzzy), []);
});

test('name and country need another exact signal when no official domain exists', () => {
  const left = company({ website_url: null, official_root_domain: null, contacts: [{ business_phone: '+971 4 555 0100' }] });
  const right = company({ website_url: null, official_root_domain: null, contacts: [{ business_phone: '+97145550100' }] });
  const decision = conservativeDuplicateDecision(left, right);
  assert.equal(decision.duplicate, true);
  assert.deepEqual(new Set(decision.signals), new Set(['EXACT_NORMALIZED_NAME_AND_COUNTRY', 'SAME_PUBLIC_PHONE']));
});

test('new verified official-domain record becomes canonical without rewriting history', () => {
  const old = company({ id: '00000000-0000-4000-8000-000000000001', verification_status: 'REVIEW', created_at: '2024-01-01T00:00:00Z' });
  const current = company({
    id: '00000000-0000-4000-8000-000000000002', verification_status: 'VERIFIED',
    last_verified_at: '2026-08-28T00:00:00Z', source_count: 4, contact_count: 2,
    business_evidence_count: 3, created_at: '2026-08-28T00:00:00Z'
  });
  assert.equal(chooseCanonical([old, current]).id, current.id);
});

test('replacement preserves unique contacts, sources, and score/match history', () => {
  const canonical = company({
    id: '00000000-0000-4000-8000-000000000010', verification_status: 'VERIFIED',
    contacts: [{ business_email: 'buyer@atlas.test' }],
    sources: [{ source_url: 'https://atlas.test/about' }]
  });
  const old = company({
    contacts: [{ business_email: 'sales@atlas.test' }],
    sources: [{ source_url: 'https://directory.example/atlas' }],
    dependencies: { lead_reviews: 1, score_runs: 2, match_runs: 2, facts_snapshots: 2, research_jobs: 1,
      candidate_verifications: 1, verification_evidence: 4, social_accounts: 0, sources: 1, contacts: 1 }
  });
  const proposal = cleanupProposal(old, canonical, ['EXACT_REGISTRABLE_DOMAIN']);
  assert.equal(proposal.proposed_action, 'SUPERSEDED');
  assert.equal(proposal.safe_for_hard_delete, false);
  assert.equal(proposal.dependency_counts.unique_sources, 1);
  assert.equal(proposal.dependency_counts.unique_contacts, 1);
  assert.equal(proposal.dependency_counts.score_runs, 2);
  assert.equal(proposal.dependency_counts.match_runs, 2);
});

test('only a dependency-free duplicate is surfaced as a safe hard-delete candidate', () => {
  const sharedSource = { source_url: 'https://atlas.com/about' };
  const canonical = company({ id: '00000000-0000-4000-8000-000000000020', sources: [sharedSource] });
  const duplicate = company({ sources: [sharedSource], dependencies: {
    sources: 1, contacts: 0, lead_reviews: 0, score_runs: 0, match_runs: 0,
    facts_snapshots: 0, research_jobs: 0, candidate_verifications: 0,
    verification_evidence: 0, social_accounts: 0
  } });
  const proposal = cleanupProposal(duplicate, canonical, ['EXACT_REGISTRABLE_DOMAIN']);
  assert.equal(proposal.proposed_action, 'DELETED');
  assert.equal(proposal.safe_for_hard_delete, true);
});

test('record with score history is superseded, not a hard-delete candidate', () => {
  const canonical = company({ id: '00000000-0000-4000-8000-000000000030' });
  const old = company({ dependencies: { score_runs: 1 } });
  const proposal = cleanupProposal(old, canonical, ['EXACT_REGISTRABLE_DOMAIN']);
  assert.equal(proposal.proposed_action, 'SUPERSEDED');
  assert.equal(proposal.safe_for_hard_delete, false);
});
