import assert from 'node:assert/strict';
import test from 'node:test';
import { createFactsSnapshot, SCORE_DIMENSIONS } from '../src/scoring/evidenceContract.js';
import { DpvScoringEngine } from '../src/scoring/zenRulesAdapter.js';

const captured = '2026-08-28T00:00:00.000Z';
let sequence = 1;
const evidenceId = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

function fact(value, { observed_at } = {}) {
  return { value, confidence: 0.9, evidence_ids: [evidenceId()], captured_at: captured, ...(observed_at ? { observed_at } : {}) };
}

function unknown() {
  return { value: 'UNKNOWN', confidence: 0, evidence_ids: [], captured_at: null };
}

function snapshot(overrides = {}, verification_status = 'VERIFIED_BUSINESS') {
  const facts = Object.fromEntries(Object.keys(SCORE_DIMENSIONS).map(key => [key, unknown()]));
  return createFactsSnapshot({ facts: { ...facts, ...overrides }, verification_status, as_of: captured });
}

async function score(input) {
  const engine = new DpvScoringEngine();
  try { return await engine.evaluate(input); } finally { engine.dispose(); }
}

test('DPV score preserves the exact eight dimensions, weights, 100 total and Tier A threshold', async () => {
  assert.deepEqual(SCORE_DIMENSIONS, {
    product_fit: 20, market_fit: 15, importer_wholesaler_fit: 15, chain_supply_evidence: 15,
    distribution_scale: 10, recent_buying_signal: 10, decision_maker_quality: 10, contact_validity: 5
  });
  const result = await score(snapshot({
    product_fit: fact('VERIFIED'), market_fit: fact('TARGET'), importer_wholesaler_fit: fact('VERIFIED'),
    chain_supply_evidence: fact('VERIFIED'), distribution_scale: fact('STRONG'),
    recent_buying_signal: fact('VERIFIED_RECENT', { observed_at: '2026-08-01T00:00:00.000Z' }),
    decision_maker_quality: fact('VERIFIED'), contact_validity: fact('DOMAIN_MX_VERIFIED')
  }));
  assert.equal(result.final_score, 100);
  assert.equal(result.tier, 'A');
  assert.equal(result.evidence_coverage, 100);
  assert.equal(result.score_eligibility, 'ELIGIBLE');
  assert.equal(result.qualification_status, 'QUALIFIED');
  assert.equal(result.rule_version, 'dpv-score-v1');
  assert.equal(Object.keys(result.dimension_scores).length, 8);
  assert.equal(result.fired_rules.length, 8);
});

test('medium evidence is deterministic Tier B and unsupported decision maker remains zero', async () => {
  const result = await score(snapshot({
    product_fit: fact('SUPPORTED'), market_fit: fact('SUPPORTED'), importer_wholesaler_fit: fact('SUPPORTED'),
    chain_supply_evidence: fact('SUPPORTED'), distribution_scale: fact('MEDIUM'),
    recent_buying_signal: fact('SUPPORTED_RECENT', { observed_at: '2026-08-10T00:00:00.000Z' }),
    contact_validity: fact('PUBLICLY_OBSERVED')
  }));
  assert.equal(result.final_score, 57);
  assert.equal(result.tier, 'B');
  assert.equal(result.dimension_scores.decision_maker_quality.points, 0);
  assert.ok(result.reason_codes.includes('DECISION_MAKER_NOT_YET_ENRICHED'));
  assert.equal(result.evidence_coverage, 90);
});

test('contact-only and insufficient fixtures are not presented as fully eligible scores', async () => {
  const contactOnly = await score(snapshot({ contact_validity: fact('DOMAIN_MX_VERIFIED') }, 'REVIEW'));
  assert.equal(contactOnly.final_score, 5);
  assert.equal(contactOnly.tier, 'C');
  assert.equal(contactOnly.score_eligibility, 'PARTIAL_EVIDENCE');
  assert.equal(contactOnly.qualification_status, 'REVIEW');

  const insufficient = await score(snapshot({}, 'UNKNOWN'));
  assert.equal(insufficient.final_score, 0);
  assert.equal(insufficient.evidence_coverage, 0);
  assert.equal(insufficient.score_eligibility, 'INSUFFICIENT_EVIDENCE');
});

test('enterprise scale and SME scale are evidence-scored without changing tier semantics', async () => {
  const common = {
    product_fit: fact('VERIFIED'), market_fit: fact('TARGET'), importer_wholesaler_fit: fact('VERIFIED'),
    chain_supply_evidence: fact('SUPPORTED'), contact_validity: fact('PUBLICLY_OBSERVED')
  };
  const enterprise = await score(snapshot({ ...common, distribution_scale: fact('STRONG') }));
  const sme = await score(snapshot({ ...common, distribution_scale: fact('SMALL') }));
  assert.equal(enterprise.dimension_scores.distribution_scale.points, 10);
  assert.equal(sme.dimension_scores.distribution_scale.points, 3);
  assert.equal(enterprise.final_score - sme.final_score, 7);
});

test('recent signal receives zero when the event date is absent', async () => {
  const result = await score(snapshot({ recent_buying_signal: fact('VERIFIED_RECENT') }));
  assert.equal(result.dimension_scores.recent_buying_signal.points, 0);
  assert.ok(result.reason_codes.includes('RECENT_SIGNAL_DATE_MISSING'));
  assert.equal(result.fired_rules.includes('recent_buying_signal:VERIFIED_RECENT'), false);
});

test('facts snapshot rejects any claimed contribution without evidence and remains replayable', () => {
  assert.throws(() => snapshot({
    product_fit: { value: 'VERIFIED', confidence: 1, evidence_ids: [], captured_at: null }
  }), error => error.code === 'INVALID_EVIDENCE_SNAPSHOT' && error.details.includes('product_fit:CONTRIBUTION_REQUIRES_EVIDENCE'));
  const first = snapshot({ product_fit: fact('VERIFIED') });
  const second = createFactsSnapshot({ facts: first.facts, verification_status: first.verification_status, as_of: first.as_of });
  assert.equal(first.source_digest, second.source_digest);
});
