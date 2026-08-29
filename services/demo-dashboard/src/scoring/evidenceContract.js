import { createHash } from 'node:crypto';

export const SCORE_FACT_SCHEMA_VERSION = 'dpv-score-facts-v1';

export const SCORE_DIMENSIONS = Object.freeze({
  product_fit: 20,
  market_fit: 15,
  importer_wholesaler_fit: 15,
  chain_supply_evidence: 15,
  distribution_scale: 10,
  recent_buying_signal: 10,
  decision_maker_quality: 10,
  contact_validity: 5
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function normalizeEvidenceFact(fact = {}) {
  const confidence = Number(fact.confidence ?? 0);
  const evidenceIds = [...new Set((fact.evidence_ids || []).filter(Boolean).map(String))];
  const normalized = {
    value: fact.value ?? 'UNKNOWN',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    evidence_ids: evidenceIds,
    captured_at: fact.captured_at || null
  };
  if (fact.observed_at) normalized.observed_at = fact.observed_at;
  return normalized;
}

export function validateEvidenceFact(name, fact) {
  const errors = [];
  if (!fact || typeof fact !== 'object') errors.push(`${name}:FACT_REQUIRED`);
  else {
    if (!Object.hasOwn(fact, 'value')) errors.push(`${name}:VALUE_REQUIRED`);
    if (!Number.isFinite(Number(fact.confidence)) || Number(fact.confidence) < 0 || Number(fact.confidence) > 1) {
      errors.push(`${name}:CONFIDENCE_OUT_OF_RANGE`);
    }
    if (!Array.isArray(fact.evidence_ids)) errors.push(`${name}:EVIDENCE_IDS_REQUIRED`);
    if (!Object.hasOwn(fact, 'captured_at')) errors.push(`${name}:CAPTURED_AT_REQUIRED`);
    const givesContribution = String(fact.value || 'UNKNOWN').toUpperCase() !== 'UNKNOWN';
    if (givesContribution && (!fact.evidence_ids?.length || !fact.captured_at)) {
      errors.push(`${name}:CONTRIBUTION_REQUIRES_EVIDENCE`);
    }
  }
  return errors;
}

export function createFactsSnapshot({ facts = {}, verification_status = 'UNKNOWN', as_of = new Date().toISOString() } = {}) {
  const normalizedFacts = {};
  const errors = [];
  for (const name of Object.keys(SCORE_DIMENSIONS)) {
    normalizedFacts[name] = normalizeEvidenceFact(facts[name]);
    errors.push(...validateEvidenceFact(name, normalizedFacts[name]));
  }
  if (errors.length) {
    const error = new Error(`Invalid DPV evidence snapshot: ${errors.join(', ')}`);
    error.code = 'INVALID_EVIDENCE_SNAPSHOT';
    error.details = errors;
    throw error;
  }
  const evidenceIds = [...new Set(Object.values(normalizedFacts).flatMap(fact => fact.evidence_ids))];
  const snapshot = {
    schema_version: SCORE_FACT_SCHEMA_VERSION,
    verification_status: String(verification_status || 'UNKNOWN').toUpperCase(),
    as_of,
    facts: normalizedFacts,
    evidence_ids: evidenceIds
  };
  return { ...snapshot, source_digest: stableDigest(snapshot) };
}
