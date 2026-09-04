BEGIN;

ALTER TABLE leadgen.auto_evidence_tasks
  ADD COLUMN IF NOT EXISTS checkpoint_replay_count integer NOT NULL DEFAULT 0;
ALTER TABLE leadgen.auto_evidence_task_attempts
  ADD COLUMN IF NOT EXISTS checkpoint_replay_count integer NOT NULL DEFAULT 0;

ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_checkpoint_replay_count_check;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_checkpoint_replay_count_check CHECK (checkpoint_replay_count>=0);
ALTER TABLE leadgen.auto_evidence_task_attempts
  DROP CONSTRAINT IF EXISTS auto_evidence_task_attempts_checkpoint_replay_count_check;
ALTER TABLE leadgen.auto_evidence_task_attempts
  ADD CONSTRAINT auto_evidence_task_attempts_checkpoint_replay_count_check CHECK (checkpoint_replay_count>=0);

DROP INDEX IF EXISTS leadgen.uq_auto_evidence_attempts_strategy_event;
CREATE UNIQUE INDEX uq_auto_evidence_attempts_strategy_event
  ON leadgen.auto_evidence_task_attempts(
    task_id,strategy_attempt_number,stage,provider_retry_count,worker_retry_count,checkpoint_replay_count,event_type
  ) WHERE strategy_attempt_number IS NOT NULL;

COMMIT;
