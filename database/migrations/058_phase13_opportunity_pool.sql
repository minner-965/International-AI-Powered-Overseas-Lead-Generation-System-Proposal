BEGIN;
CREATE TABLE leadgen.opportunity_pool_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  rule_version text NOT NULL,
  input_digest text NOT NULL CHECK(length(input_digest)=64),
  opportunity_pool_band text NOT NULL CHECK(opportunity_pool_band IN ('PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE')),
  is_active_business_opportunity boolean NOT NULL,
  opportunity_pool_reason_codes text[] NOT NULL DEFAULT '{}',
  category_relation text NOT NULL,
  company_fit_relation jsonb NOT NULL,
  contact_readiness_labels text[] NOT NULL DEFAULT '{}',
  email_send_eligibility jsonb NOT NULL,
  review_flags text[] NOT NULL DEFAULT '{}',
  profile_results jsonb NOT NULL DEFAULT '[]',
  evidence_references jsonb NOT NULL DEFAULT '[]',
  change_reason text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(is_active_business_opportunity = (opportunity_pool_band IN ('PRECISION','RELEVANT','GENERAL_RELEVANT'))),
  CHECK(jsonb_typeof(email_send_eligibility)='object'),
  CHECK(email_send_eligibility @> '{"send_authorized":false}'::jsonb)
);
CREATE INDEX opportunity_pool_company_revision_idx ON leadgen.opportunity_pool_decisions(company_id,revision DESC);
CREATE INDEX opportunity_pool_job_idx ON leadgen.opportunity_pool_decisions(research_job_id) WHERE research_job_id IS NOT NULL;
CREATE FUNCTION leadgen.guard_opportunity_pool_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Opportunity pool decisions are append-only'; END; $$;
CREATE TRIGGER opportunity_pool_history_immutable BEFORE UPDATE OR DELETE ON leadgen.opportunity_pool_decisions
FOR EACH ROW EXECUTE FUNCTION leadgen.guard_opportunity_pool_history();
CREATE VIEW leadgen.opportunity_pool_current AS
SELECT DISTINCT ON (company_id) * FROM leadgen.opportunity_pool_decisions ORDER BY company_id,revision DESC;
COMMIT;
