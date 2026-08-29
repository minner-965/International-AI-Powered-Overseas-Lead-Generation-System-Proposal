import { buildCompanyFactsSnapshot } from './factsSnapshotBuilder.js';
import { createFactsSnapshot } from './evidenceContract.js';
import { DpvScoringEngine } from './zenRulesAdapter.js';

export class ScoringService {
  constructor({ pool, engine = new DpvScoringEngine() }) {
    if (!pool) throw new Error('ScoringService requires a PostgreSQL pool');
    this.pool = pool;
    this.engine = engine;
  }

  async loadCompanyFacts(companyId) {
    const [companyResult, verificationResult, evidenceResult, contactResult, sourceResult] = await Promise.all([
      this.pool.query('SELECT * FROM leadgen.companies WHERE id=$1', [companyId]),
      this.pool.query(`SELECT * FROM leadgen.research_candidate_verifications
        WHERE company_id=$1 ORDER BY verified_at DESC NULLS LAST, updated_at DESC LIMIT 1`, [companyId]),
      this.pool.query(`SELECT * FROM leadgen.company_verification_evidence
        WHERE company_id=$1 ORDER BY captured_at DESC`, [companyId]),
      this.pool.query(`SELECT id,contact_type,business_email,business_phone,email_verification_status,
          verification_checked_at,captured_at FROM leadgen.contacts WHERE company_id=$1`, [companyId]),
      this.pool.query('SELECT * FROM leadgen.sources WHERE company_id=$1 ORDER BY captured_at DESC', [companyId])
    ]);
    if (!companyResult.rowCount) {
      const error = new Error('Company not found');
      error.code = 'COMPANY_NOT_FOUND';
      throw error;
    }
    return buildCompanyFactsSnapshot({
      company: companyResult.rows[0],
      verification: verificationResult.rows[0] || {},
      evidence: evidenceResult.rows,
      contacts: contactResult.rows,
      sources: sourceResult.rows
    });
  }

  async evaluate(factsSnapshot) {
    const snapshot = factsSnapshot?.schema_version ? factsSnapshot : createFactsSnapshot(factsSnapshot);
    return this.engine.evaluate(snapshot);
  }

  async scoreCompany({ companyId, researchJobId = null, factsSnapshot = null, executionKey = null }) {
    const snapshot = factsSnapshot || await this.loadCompanyFacts(companyId);
    const result = await this.evaluate(snapshot);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (executionKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`score:${companyId}:${executionKey}`]);
        const existing = await client.query(`SELECT * FROM leadgen.company_score_runs
          WHERE company_id=$1 AND execution_key=$2`, [companyId, executionKey]);
        if (existing.rowCount) {
          const savedFacts = await client.query('SELECT * FROM leadgen.company_facts_snapshots WHERE id=$1', [existing.rows[0].facts_snapshot_id]);
          await client.query('COMMIT');
          return { ...existing.rows[0], facts_snapshot: savedFacts.rows[0], idempotent_replay: true };
        }
      }
      const savedSnapshot = await client.query(`
        INSERT INTO leadgen.company_facts_snapshots
          (company_id,research_job_id,schema_version,facts,evidence_ids,evidence_coverage,source_digest)
        VALUES ($1,$2,$3,$4::jsonb,$5::uuid[],$6,$7) RETURNING *`, [
        companyId, researchJobId, snapshot.schema_version, JSON.stringify(snapshot),
        snapshot.evidence_ids, result.evidence_coverage, snapshot.source_digest
      ]);
      const savedRun = await client.query(`
        INSERT INTO leadgen.company_score_runs
          (company_id,research_job_id,execution_key,final_score,tier,qualification_status,score_eligibility,
           evidence_coverage,dimension_scores,reason_codes,fired_rules,rule_version,
           facts_snapshot_id,evidence_ids,trace)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14::uuid[],$15::jsonb)
        RETURNING *`, [
        companyId, researchJobId, executionKey, result.final_score, result.tier, result.qualification_status,
        result.score_eligibility, result.evidence_coverage, JSON.stringify(result.dimension_scores),
        JSON.stringify(result.reason_codes), JSON.stringify(result.fired_rules), result.rule_version,
        savedSnapshot.rows[0].id, result.evidence_ids, JSON.stringify({
          zen: result.zen_trace, qualification: result.qualification_trace,
          performance: result.zen_performance
        })
      ]);
      await client.query('COMMIT');
      return { ...savedRun.rows[0], facts_snapshot: savedSnapshot.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatest(companyId) {
    const result = await this.pool.query(`SELECT * FROM leadgen.company_score_runs
      WHERE company_id=$1 ORDER BY calculated_at DESC,id DESC LIMIT 1`, [companyId]);
    return result.rows[0] || null;
  }

  async getHistory(companyId, { limit = 50 } = {}) {
    const result = await this.pool.query(`SELECT * FROM leadgen.company_score_runs
      WHERE company_id=$1 ORDER BY calculated_at DESC,id DESC LIMIT $2`, [companyId, Math.max(1, Math.min(200, limit))]);
    return result.rows;
  }
}

export async function compareLegacyAndVersionedScores({ pool, scoringService, companyIds = null }) {
  const params = [];
  const where = companyIds?.length ? `WHERE c.id = ANY($1::uuid[])` : '';
  if (companyIds?.length) params.push(companyIds);
  const rows = await pool.query(`
    SELECT c.id,c.company_name,r.lead_score AS old_score,r.tier AS old_tier
    FROM leadgen.companies c
    JOIN leadgen.lead_reviews r ON r.company_id=c.id
    ${where}
    ORDER BY c.company_name`, params);
  const comparisons = [];
  for (const row of rows.rows) {
    const snapshot = await scoringService.loadCompanyFacts(row.id);
    const next = await scoringService.evaluate(snapshot);
    comparisons.push({
      company_id: row.id,
      company: row.company_name,
      old_score: Number(row.old_score),
      new_score: next.final_score,
      old_tier: row.old_tier,
      new_tier: next.tier,
      difference: next.final_score - Number(row.old_score),
      score_eligibility: next.score_eligibility,
      evidence_coverage: next.evidence_coverage,
      evidence_gap_reason_codes: next.reason_codes.filter(code => /MISSING|UNKNOWN|NOT_YET|PARTIAL|INSUFFICIENT/.test(code))
    });
  }
  return comparisons;
}
