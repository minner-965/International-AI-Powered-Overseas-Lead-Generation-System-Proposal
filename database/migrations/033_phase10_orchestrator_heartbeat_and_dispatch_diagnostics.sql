BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.orchestrator_heartbeats (
  id bigserial PRIMARY KEY,
  orchestrator_type text NOT NULL CHECK (orchestrator_type IN ('N8N')),
  workflow_key text NOT NULL,
  workflow_version text NOT NULL,
  instance_id_hash text NOT NULL CHECK (instance_id_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('RUNNING','HEALTHY','FAILED')),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(safe_metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS orchestrator_heartbeats_workflow_observed_idx
  ON leadgen.orchestrator_heartbeats(workflow_key, observed_at DESC, id DESC);

ALTER TABLE leadgen.research_jobs
  ADD COLUMN IF NOT EXISTS dispatch_state text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS last_dispatch_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_dispatch_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_execution_key text;

UPDATE leadgen.research_jobs
SET dispatch_execution_key = 'research-job:' || id::text
WHERE dispatch_execution_key IS NULL;

ALTER TABLE leadgen.research_jobs
  ALTER COLUMN dispatch_execution_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='leadgen.research_jobs'::regclass
      AND conname='research_jobs_dispatch_state_check'
  ) THEN
    ALTER TABLE leadgen.research_jobs ADD CONSTRAINT research_jobs_dispatch_state_check
      CHECK (dispatch_state IN ('PENDING','DISPATCHED','ORCHESTRATOR_UNAVAILABLE','WORKFLOW_INACTIVE','WEBHOOK_AUTH_FAILED','QUEUE_UNAVAILABLE'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS research_jobs_dispatch_execution_key_uidx
  ON leadgen.research_jobs(dispatch_execution_key);

CREATE INDEX IF NOT EXISTS research_jobs_queued_dispatch_watchdog_idx
  ON leadgen.research_jobs(next_dispatch_attempt_at, created_at, id)
  WHERE status='QUEUED' AND dispatch_state<>'DISPATCHED';

COMMIT;
