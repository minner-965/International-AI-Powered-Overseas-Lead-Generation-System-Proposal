BEGIN;

CREATE OR REPLACE FUNCTION leadgen.ensure_research_job_dispatch_execution_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dispatch_execution_key IS NULL OR btrim(NEW.dispatch_execution_key)='' THEN
    NEW.dispatch_execution_key := 'research-job:' || NEW.id::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_research_jobs_dispatch_execution_key ON leadgen.research_jobs;
CREATE TRIGGER trg_research_jobs_dispatch_execution_key
BEFORE INSERT ON leadgen.research_jobs FOR EACH ROW
EXECUTE FUNCTION leadgen.ensure_research_job_dispatch_execution_key();

CREATE TABLE IF NOT EXISTS leadgen.research_job_dispatch_outbox (
  id bigserial PRIMARY KEY,
  research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  execution_key text NOT NULL,
  dispatch_state text NOT NULL DEFAULT 'PENDING'
    CHECK (dispatch_state IN ('PENDING','DISPATCHED','PROCESSING','RETRY_PENDING','COMPLETED','FAILED')),
  checkpoint text NOT NULL DEFAULT 'CREATED'
    CHECK (checkpoint IN ('CREATED','QUERIES_GENERATED','DISCOVERY_COMPLETED','CONTACTS_CHECKED','COMPANIES_VERIFIED','SCORING_COMPLETED','COMPLETED')),
  queue_job_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  next_attempt_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_job_id),
  UNIQUE (execution_key)
);

CREATE INDEX IF NOT EXISTS research_job_dispatch_outbox_reconcile_idx
  ON leadgen.research_job_dispatch_outbox(next_attempt_at,created_at,id)
  WHERE dispatch_state IN ('PENDING','RETRY_PENDING');

COMMIT;
