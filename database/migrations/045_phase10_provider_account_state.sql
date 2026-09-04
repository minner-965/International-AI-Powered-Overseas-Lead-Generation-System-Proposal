BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.provider_account_states (
  provider_code text PRIMARY KEY CHECK (provider_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  credential_fingerprint text CHECK (credential_fingerprint IS NULL OR credential_fingerprint ~ '^[0-9A-Fa-f]{64}$'),
  status text NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN
    ('AVAILABLE','UNKNOWN','RATE_LIMITED','CREDIT_EXHAUSTED','AUTH_ERROR','DEGRADED')),
  key_usage numeric,
  key_limit numeric,
  plan_usage numeric,
  plan_limit numeric,
  paygo_usage numeric,
  paygo_limit numeric,
  remaining_credits numeric,
  checked_at timestamptz,
  retry_after_at timestamptz,
  last_provider_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.provider_account_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL CHECK (provider_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  old_status text CHECK (old_status IS NULL OR old_status IN
    ('AVAILABLE','UNKNOWN','RATE_LIMITED','CREDIT_EXHAUSTED','AUTH_ERROR','DEGRADED')),
  new_status text NOT NULL CHECK (new_status IN
    ('AVAILABLE','UNKNOWN','RATE_LIMITED','CREDIT_EXHAUSTED','AUTH_ERROR','DEGRADED')),
  source text NOT NULL CHECK (source IN ('USAGE_ENDPOINT','SEARCH_RESPONSE','ADMIN_REFRESH','STARTUP_PROBE')),
  sanitized_reason_code text,
  provider_request_id text,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_account_state_events_provider_time
  ON leadgen.provider_account_state_events(provider_code,observed_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.auto_evidence_ownership_repair_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES leadgen.auto_evidence_tasks(id) ON DELETE RESTRICT,
  old_research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  continuation_research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  resume_execution_key text NOT NULL,
  checkpoint_replay_count integer NOT NULL CHECK (checkpoint_replay_count >= 0),
  repaired_by text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,continuation_research_job_id,checkpoint_replay_count)
);

CREATE OR REPLACE FUNCTION leadgen.protect_provider_account_state_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider account state events are append-only' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_account_state_events_immutable ON leadgen.provider_account_state_events;
CREATE TRIGGER trg_provider_account_state_events_immutable
BEFORE UPDATE OR DELETE ON leadgen.provider_account_state_events
FOR EACH ROW EXECUTE FUNCTION leadgen.protect_provider_account_state_event();

DROP TRIGGER IF EXISTS trg_auto_evidence_ownership_repair_events_immutable ON leadgen.auto_evidence_ownership_repair_events;
CREATE TRIGGER trg_auto_evidence_ownership_repair_events_immutable
BEFORE UPDATE OR DELETE ON leadgen.auto_evidence_ownership_repair_events
FOR EACH ROW EXECUTE FUNCTION leadgen.protect_provider_account_state_event();

INSERT INTO leadgen.provider_account_states(provider_code,status)
VALUES ('TAVILY','UNKNOWN') ON CONFLICT(provider_code) DO NOTHING;

-- Provider-account-only policy: keep usage history, but remove the legacy local
-- credit ceiling so it can never be mistaken for an enforcement boundary.
UPDATE leadgen.provider_credit_ledger
SET credit_limit_units = NULL,
    updated_at = now()
WHERE provider = 'TAVILY'
  AND credit_limit_units IS NOT NULL;

COMMIT;
