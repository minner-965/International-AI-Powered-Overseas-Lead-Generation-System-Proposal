// Verification of migration 074 (batch 3 C1), for registration in phase7/migrationRunner.js.
export const SCORING_ACCURACY_MIGRATION_KEY = '074_scoring_accuracy.sql';

export async function verifyScoringAccuracyMigration(client) {
  const row = (await client.query(`SELECT
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid='leadgen.company_verification_evidence'::regclass
        AND conname='company_verification_evidence_evidence_type_check') evidence_check,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='research_candidate_verifications' AND column_name='retail_chain_status') retail_column`)).rows[0] || {};
  const check = String(row.evidence_check || '');
  if (!row.retail_column || !['RETAIL_CHAIN', 'DEPARTMENT_STORE', 'RETAILER'].every(type => check.includes(`'${type}'`))) {
    throw new Error('Scoring accuracy migration verification failed');
  }
  return { retail_chain_evidence_types: true, retail_chain_status_column: true };
}
