BEGIN;

ALTER TABLE leadgen.auto_evidence_tasks
  ADD COLUMN IF NOT EXISTS strategy_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_strategy_code text,
  ADD COLUMN IF NOT EXISTS strategy_version text,
  ADD COLUMN IF NOT EXISTS current_query_fingerprint text,
  ADD COLUMN IF NOT EXISTS current_strategy_locale text,
  ADD COLUMN IF NOT EXISTS current_source_class text,
  ADD COLUMN IF NOT EXISTS provider_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strategy_state text NOT NULL DEFAULT 'READY';

ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_strategy_attempt_count_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_current_strategy_code_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_current_query_fingerprint_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_provider_retry_count_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_worker_retry_count_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_strategy_state_check;

ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_strategy_attempt_count_check
    CHECK (strategy_attempt_count BETWEEN 0 AND max_attempts),
  ADD CONSTRAINT auto_evidence_tasks_current_strategy_code_check
    CHECK (current_strategy_code IS NULL OR current_strategy_code ~ '^S(0[1-9]|10)_[A-Z0-9_]+$'),
  ADD CONSTRAINT auto_evidence_tasks_current_query_fingerprint_check
    CHECK (current_query_fingerprint IS NULL OR current_query_fingerprint ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT auto_evidence_tasks_provider_retry_count_check CHECK (provider_retry_count >= 0),
  ADD CONSTRAINT auto_evidence_tasks_worker_retry_count_check CHECK (worker_retry_count >= 0),
  ADD CONSTRAINT auto_evidence_tasks_strategy_state_check CHECK (strategy_state IN (
    'READY','STRATEGY_RUNNING','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE','TEMPORARY_ERROR',
    'BUDGET_PAUSED','RESOLVED','EXHAUSTED','HUMAN_REVIEW_REQUIRED','STOPPED_INELIGIBLE'
  ));

ALTER TABLE leadgen.auto_evidence_task_attempts
  ADD COLUMN IF NOT EXISTS strategy_code text,
  ADD COLUMN IF NOT EXISTS strategy_version text,
  ADD COLUMN IF NOT EXISTS strategy_attempt_number integer,
  ADD COLUMN IF NOT EXISTS query_fingerprint text,
  ADD COLUMN IF NOT EXISTS locale text,
  ADD COLUMN IF NOT EXISTS source_class text,
  ADD COLUMN IF NOT EXISTS new_url_count integer,
  ADD COLUMN IF NOT EXISTS usable_evidence_count integer,
  ADD COLUMN IF NOT EXISTS named_buyer_candidate_count integer,
  ADD COLUMN IF NOT EXISTS valid_contact_count integer,
  ADD COLUMN IF NOT EXISTS provider_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminal_reason text;

ALTER TABLE leadgen.auto_evidence_task_attempts
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_task_id_attempt_number_stage_ev_key,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_outcome_status_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_strategy_code_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_strategy_attempt_number_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_query_fingerprint_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_strategy_metrics_check;

ALTER TABLE leadgen.auto_evidence_task_attempts
  ADD CONSTRAINT auto_evidence_task_attempts_outcome_status_check CHECK (outcome_status IS NULL OR outcome_status IN (
    'COMPLETED','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE','TEMPORARY_ERROR','RETRYABLE_ERROR',
    'PERMANENT_ERROR','EVIDENCE_EXHAUSTED','BUDGET_PAUSED','HUMAN_REVIEW_REQUIRED'
  )),
  ADD CONSTRAINT auto_evidence_task_attempts_strategy_code_check
    CHECK (strategy_code IS NULL OR strategy_code ~ '^S(0[1-9]|10)_[A-Z0-9_]+$'),
  ADD CONSTRAINT auto_evidence_task_attempts_strategy_attempt_number_check
    CHECK (strategy_attempt_number IS NULL OR strategy_attempt_number BETWEEN 1 AND 10),
  ADD CONSTRAINT auto_evidence_task_attempts_query_fingerprint_check
    CHECK (query_fingerprint IS NULL OR query_fingerprint ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT auto_evidence_task_attempts_strategy_metrics_check CHECK (
    coalesce(new_url_count,0)>=0 AND coalesce(usable_evidence_count,0)>=0
    AND coalesce(named_buyer_candidate_count,0)>=0 AND coalesce(valid_contact_count,0)>=0
    AND provider_retry_count>=0 AND worker_retry_count>=0
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_evidence_attempts_legacy_event
  ON leadgen.auto_evidence_task_attempts(task_id,attempt_number,stage,event_type)
  WHERE strategy_attempt_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_evidence_attempts_strategy_event
  ON leadgen.auto_evidence_task_attempts(
    task_id,strategy_attempt_number,stage,provider_retry_count,worker_retry_count,event_type
  ) WHERE strategy_attempt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auto_evidence_attempts_strategy_history
  ON leadgen.auto_evidence_task_attempts(task_id,strategy_attempt_number,strategy_code,occurred_at);

WITH repairable AS (
  SELECT id,company_id,product_profile,business_blocker,evidence_revision,input_digest
  FROM leadgen.auto_evidence_tasks
  WHERE task_status='EVIDENCE_EXHAUSTED'
    AND strategy_attempt_count=0
    AND current_strategy_code IS NULL
    AND attempt_count<10
), audit AS (
  INSERT INTO leadgen.auto_evidence_schedule_events(
    schedule_source,schedule_key,task_id,company_id,product_profile,business_blocker,evidence_revision,
    outcome,input_digest,occurred_at
  ) SELECT 'RECONCILIATION','wp09:037:resume:'||id,id,company_id,product_profile,business_blocker,
    evidence_revision,'SCHEDULED',input_digest,now()
  FROM repairable ON CONFLICT (schedule_key) DO NOTHING
)
UPDATE leadgen.auto_evidence_tasks t SET
  task_status='RETRY_SCHEDULED',current_stage=NULL,technical_blocker=NULL,retry_at=now(),
  cooldown_until=NULL,completed_at=NULL,max_attempts=10,attempt_count=0,strategy_attempt_count=0,
  provider_retry_count=0,worker_retry_count=0,strategy_state='READY',budget_state='AVAILABLE',updated_at=now()
FROM repairable r WHERE t.id=r.id;

UPDATE leadgen.auto_evidence_tasks SET max_attempts=10,updated_at=now()
WHERE max_attempts<10 AND task_status<>'EVIDENCE_EXHAUSTED';

COMMIT;
