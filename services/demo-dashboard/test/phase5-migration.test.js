import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/017_phase5_scoring_customer_match.sql'), 'utf8');

test('Phase 5 migration enables pg_trgm only for recall and retains conservative country filtering', () => {
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(sql, /gin_trgm_ops/);
  assert.match(sql, /recall_company_name_candidates/);
  assert.match(sql, /c\.country_code = upper\(p_country_code\)/);
  assert.doesNotMatch(sql, /UPDATE\s+leadgen\.companies\s+SET\s+normalized_domain/i);
});

test('score, facts and match histories are append-only and historical rows stay internal', () => {
  assert.match(sql, /trg_company_facts_immutable/);
  assert.match(sql, /trg_company_score_runs_immutable/);
  assert.match(sql, /trg_customer_match_results_immutable/);
  assert.match(sql, /data_classification\s+text\s+NOT NULL DEFAULT 'INTERNAL_BUSINESS'/);
  assert.match(sql, /idx_company_score_execution_once/);
  assert.match(sql, /idx_customer_match_execution_once/);
  assert.match(sql, /WHERE execution_key IS NOT NULL/g);
});

test('production migration activates management baseline only and inserts no historical fixture rows', () => {
  assert.match(sql, /'MANAGEMENT_BASELINE','baseline-v1','ACTIVE'/);
  assert.doesNotMatch(sql, /INSERT INTO leadgen\.historical_(customers|orders|lead_outcomes|customer_channels)/);
  assert.doesNotMatch(sql, /'HISTORICAL_CUSTOMER_ICP','[^']+','ACTIVE'/);
});
