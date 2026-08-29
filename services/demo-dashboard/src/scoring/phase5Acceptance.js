import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { ScoringService } from './scoringService.js';
import { CustomerMatchService } from '../matching/customerMatchService.js';

export async function runPhase5ScoreAndMatchAcceptance({ pool }) {
  const scoring = new ScoringService({ pool });
  const matching = new CustomerMatchService({ pool });
  try {
    const companies = await pool.query(`
      SELECT c.id,c.company_name,c.research_job_id,c.data_origin,r.lead_score AS old_score,r.tier AS old_tier
      FROM leadgen.companies c
      LEFT JOIN leadgen.lead_reviews r ON r.company_id=c.id
      WHERE c.phase4_verification_status='VERIFIED_BUSINESS'
      ORDER BY c.company_name`);
    const rows = [];
    for (const company of companies.rows) {
      const score = await scoring.scoreCompany({
        companyId: company.id,
        researchJobId: company.research_job_id,
        executionKey: `phase5-score-v1:${company.id}`
      });
      const match = await matching.evaluateAndPersist({
        companyId: company.id,
        researchJobId: company.research_job_id,
        dpvScore: score.final_score,
        executionKey: `phase5-baseline-match-v1:${company.id}`
      });
      rows.push({
        company_id: company.id,
        company: company.company_name,
        data_origin: company.data_origin,
        old_score: company.old_score == null ? null : Number(company.old_score),
        old_tier: company.old_tier,
        new_score: score.final_score,
        new_tier: score.tier,
        score_eligibility: score.score_eligibility,
        score_coverage: Number(score.evidence_coverage),
        customer_match: match.match_score,
        match_coverage: Number(match.coverage_percent),
        profile_type: match.reference_profile_type,
        profile_version: match.profile_version,
        score_idempotent_replay: score.idempotent_replay === true,
        match_idempotent_replay: match.idempotent_replay === true
      });
    }
    return rows;
  } finally {
    scoring.engine.dispose();
    matching.engine.dispose();
  }
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  });
  try {
    console.log(JSON.stringify(await runPhase5ScoreAndMatchAcceptance({ pool }), null, 2));
  } finally {
    await pool.end();
  }
}
