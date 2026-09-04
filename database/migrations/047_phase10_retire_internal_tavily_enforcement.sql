BEGIN;

-- Historical budget columns and rows remain available for audit.  Current
-- execution no longer uses them as a Tavily admission or scheduling gate.
UPDATE leadgen.provider_credit_ledger
SET credit_limit_units=NULL,updated_at=now()
WHERE provider='TAVILY' AND credit_limit_units IS NOT NULL;

ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_task_status_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_max_attempts_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_strategy_attempt_count_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_strategy_state_check;

ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_task_status_check CHECK (task_status IN (
    'QUEUED','RUNNING','RETRY_SCHEDULED','EVIDENCE_EXHAUSTED','TEMPORARY_PROVIDER_ERROR',
    'HUMAN_REVIEW_REQUIRED','BUDGET_PAUSED','PROVIDER_CAPACITY_WAIT','COMPLETED','CANCELLED'
  )),
  ADD CONSTRAINT auto_evidence_tasks_max_attempts_check CHECK (max_attempts >= 1),
  ADD CONSTRAINT auto_evidence_tasks_strategy_attempt_count_check CHECK (strategy_attempt_count >= 0),
  ADD CONSTRAINT auto_evidence_tasks_strategy_state_check CHECK (strategy_state IN (
    'READY','STRATEGY_RUNNING','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE','TEMPORARY_ERROR',
    'BUDGET_PAUSED','PROVIDER_CAPACITY_WAIT','RESOLVED','EXHAUSTED','HUMAN_REVIEW_REQUIRED','STOPPED_INELIGIBLE'
  ));

ALTER TABLE leadgen.auto_evidence_task_attempts
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_outcome_status_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_strategy_attempt_number_check;

ALTER TABLE leadgen.auto_evidence_task_attempts
  ADD CONSTRAINT auto_evidence_task_attempts_outcome_status_check CHECK (outcome_status IS NULL OR outcome_status IN (
    'COMPLETED','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE','TEMPORARY_ERROR','RETRYABLE_ERROR',
    'PERMANENT_ERROR','EVIDENCE_EXHAUSTED','BUDGET_PAUSED','PROVIDER_CAPACITY_WAIT','HUMAN_REVIEW_REQUIRED'
  )),
  ADD CONSTRAINT auto_evidence_task_attempts_strategy_attempt_number_check
    CHECK (strategy_attempt_number IS NULL OR strategy_attempt_number >= 1);

ALTER TABLE leadgen.auto_evidence_schedule_events
  DROP CONSTRAINT IF EXISTS auto_evidence_schedule_events_outcome_check;

ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD CONSTRAINT auto_evidence_schedule_events_outcome_check CHECK (outcome IN (
    'SCHEDULED','DEDUPLICATED','SKIPPED_COOLDOWN','BUDGET_PAUSED','PROVIDER_CAPACITY_WAIT','HUMAN_REVIEW_REQUIRED'
  ));

UPDATE leadgen.auto_evidence_tasks
SET max_attempts=greatest(max_attempts,attempt_count,strategy_attempt_count,1),
    cooldown_until=NULL,
    budget_state=CASE WHEN task_status='BUDGET_PAUSED' THEN budget_state ELSE 'NOT_REQUIRED' END,
    updated_at=now()
WHERE max_attempts<greatest(attempt_count,strategy_attempt_count,1)
   OR cooldown_until IS NOT NULL
   OR (task_status<>'BUDGET_PAUSED' AND budget_state<>'NOT_REQUIRED');

COMMIT;
