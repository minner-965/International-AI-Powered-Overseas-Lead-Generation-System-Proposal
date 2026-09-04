BEGIN;

ALTER TABLE leadgen.research_jobs
  ADD COLUMN IF NOT EXISTS resumed_from_research_job_id uuid,
  ADD COLUMN IF NOT EXISTS resume_execution_key text,
  ADD COLUMN IF NOT EXISTS resume_checkpoint_replay_count integer,
  ADD COLUMN IF NOT EXISTS resume_stage text;

ALTER TABLE leadgen.research_jobs
  DROP CONSTRAINT IF EXISTS research_jobs_resumed_from_research_job_id_fkey,
  DROP CONSTRAINT IF EXISTS research_jobs_resume_execution_key_check,
  DROP CONSTRAINT IF EXISTS research_jobs_resume_checkpoint_replay_count_check,
  DROP CONSTRAINT IF EXISTS research_jobs_resume_stage_check,
  DROP CONSTRAINT IF EXISTS research_jobs_resume_lineage_complete_check,
  ADD CONSTRAINT research_jobs_resumed_from_research_job_id_fkey
    FOREIGN KEY (resumed_from_research_job_id) REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT research_jobs_resume_execution_key_check
    CHECK (resume_execution_key IS NULL OR (btrim(resume_execution_key)<>'' AND length(resume_execution_key)<=240)),
  ADD CONSTRAINT research_jobs_resume_checkpoint_replay_count_check
    CHECK (resume_checkpoint_replay_count IS NULL OR resume_checkpoint_replay_count>=1),
  ADD CONSTRAINT research_jobs_resume_stage_check CHECK (resume_stage IS NULL OR resume_stage IN (
    'DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE',
    'FINDING_BUYER','VERIFYING_EMAIL','REFRESHING_DECISION'
  )),
  ADD CONSTRAINT research_jobs_resume_lineage_complete_check CHECK (
    (resumed_from_research_job_id IS NULL AND resume_execution_key IS NULL
      AND resume_checkpoint_replay_count IS NULL AND resume_stage IS NULL)
    OR
    (resumed_from_research_job_id IS NOT NULL AND resume_execution_key IS NOT NULL
      AND resume_checkpoint_replay_count IS NOT NULL AND resume_stage IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS research_jobs_resume_execution_key_uidx
  ON leadgen.research_jobs(resume_execution_key)
  WHERE resume_execution_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadgen.auto_evidence_resume_outbox (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES leadgen.auto_evidence_tasks(id) ON DELETE RESTRICT,
  original_research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  continuation_research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  execution_key text NOT NULL UNIQUE CHECK (btrim(execution_key)<>'' AND length(execution_key)<=240),
  checkpoint_replay_count integer NOT NULL CHECK (checkpoint_replay_count>=1),
  resume_stage text NOT NULL CHECK (resume_stage IN (
    'DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE',
    'FINDING_BUYER','VERIFYING_EMAIL','REFRESHING_DECISION'
  )),
  dispatch_state text NOT NULL DEFAULT 'PENDING'
    CHECK (dispatch_state IN ('PENDING','PROCESSING','DISPATCHED','RETRY_PENDING','COMPLETED')),
  queue_job_id text,
  dispatch_attempt_count integer NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count>=0),
  last_error_code text,
  next_attempt_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (continuation_research_job_id),
  UNIQUE (task_id,checkpoint_replay_count)
);

CREATE INDEX IF NOT EXISTS idx_auto_evidence_resume_outbox_pending
  ON leadgen.auto_evidence_resume_outbox(next_attempt_at,created_at,id)
  WHERE dispatch_state IN ('PENDING','RETRY_PENDING');

COMMENT ON COLUMN leadgen.research_jobs.resumed_from_research_job_id IS
  'Immutable historical lineage for a budget-window continuation; the original job is never reopened.';
COMMENT ON TABLE leadgen.auto_evidence_resume_outbox IS
  'Transactional outbox for checkpoint-preserving auto-evidence budget continuations.';

COMMIT;
