-- 073: supplementary contact verification for exploratory ("待研究") companies (Simon's decision 2026-10-27 #2).
--   lead_enrichment_attempts  one row per real automatic contact search of one company (a provider call was made:
--                             a search query executed or a Hunter call). Paused/blocked runs are not recorded.
--   lead_usability_events     UNUSABLE (5 real attempts without any usable business email) / RESTORED (admin).
--   lead_usability_current    latest status per company; lead_enrichment_attempt_current = per-company counts.
-- Both tables are append-only (UPDATE/DELETE raise). Nothing is backfilled: applying this changes no behaviour
-- until the contact-research path writes its first attempt. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.lead_enrichment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  attempt_source text NOT NULL CHECK (attempt_source IN ('CONTACT_RESEARCH','AUTO_EVIDENCE','SYSTEM_RECOVERY','OPERATOR')),
  opportunity_pool_band text CHECK (opportunity_pool_band IS NULL OR opportunity_pool_band IN
    ('PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE')),
  outcome text NOT NULL CHECK (outcome IN ('USABLE_EMAIL_FOUND','NO_USABLE_EMAIL','FAILED')),
  search_queries_executed integer NOT NULL DEFAULT 0 CHECK (search_queries_executed >= 0),
  hunter_calls integer NOT NULL DEFAULT 0 CHECK (hunter_calls >= 0),
  usable_email_count integer NOT NULL DEFAULT 0 CHECK (usable_email_count >= 0),
  decision_makers_found integer NOT NULL DEFAULT 0 CHECK (decision_makers_found >= 0),
  enrichment_status text,
  stop_reason text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (search_queries_executed > 0 OR hunter_calls > 0),
  CHECK ((outcome = 'USABLE_EMAIL_FOUND') = (usable_email_count > 0))
);
CREATE INDEX IF NOT EXISTS lead_enrichment_attempts_company_idx ON leadgen.lead_enrichment_attempts(company_id, revision DESC);

CREATE TABLE IF NOT EXISTS leadgen.lead_usability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('UNUSABLE','RESTORED')),
  reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_id uuid REFERENCES leadgen.lead_enrichment_attempts(id) ON DELETE RESTRICT,
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_usability_events_company_idx ON leadgen.lead_usability_events(company_id, revision DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_lead_enrichment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Lead enrichment attempts and usability events are append-only'; END; $$;
DROP TRIGGER IF EXISTS lead_enrichment_attempts_history_guard ON leadgen.lead_enrichment_attempts;
CREATE TRIGGER lead_enrichment_attempts_history_guard BEFORE UPDATE OR DELETE ON leadgen.lead_enrichment_attempts
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_lead_enrichment_history();
DROP TRIGGER IF EXISTS lead_usability_events_history_guard ON leadgen.lead_usability_events;
CREATE TRIGGER lead_usability_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.lead_usability_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_lead_enrichment_history();

CREATE OR REPLACE VIEW leadgen.lead_usability_current AS
SELECT DISTINCT ON (company_id) * FROM leadgen.lead_usability_events ORDER BY company_id, revision DESC;

-- Counts since the latest RESTORED event: a restored lead starts a fresh budget of 5 attempts.
CREATE OR REPLACE VIEW leadgen.lead_enrichment_attempt_current AS
SELECT a.company_id,
  count(*)::int AS total_attempts,
  count(*) FILTER (WHERE r.restored_revision IS NULL OR a.revision > r.restored_attempt_revision)::int AS attempts_since_restore,
  count(*) FILTER (WHERE (r.restored_revision IS NULL OR a.revision > r.restored_attempt_revision)
    AND a.outcome = 'USABLE_EMAIL_FOUND')::int AS usable_attempts_since_restore,
  max(a.created_at) AS last_attempt_at,
  (array_agg(a.id ORDER BY a.revision DESC))[1] AS last_attempt_id,
  (array_agg(a.outcome ORDER BY a.revision DESC))[1] AS last_outcome
FROM leadgen.lead_enrichment_attempts a
LEFT JOIN LATERAL (
  SELECT e.revision AS restored_revision,
    coalesce((SELECT max(x.revision) FROM leadgen.lead_enrichment_attempts x
      WHERE x.company_id = e.company_id AND x.created_at <= e.created_at), 0) AS restored_attempt_revision
  FROM leadgen.lead_usability_events e
  WHERE e.company_id = a.company_id AND e.status = 'RESTORED'
  ORDER BY e.revision DESC LIMIT 1
) r ON true
GROUP BY a.company_id;

COMMIT;
