BEGIN;

ALTER TABLE leadgen.provider_usage_events
  ADD COLUMN IF NOT EXISTS budget_pool text NOT NULL DEFAULT 'EVIDENCE',
  ADD COLUMN IF NOT EXISTS product_profile text;
ALTER TABLE leadgen.provider_usage_events
  DROP CONSTRAINT IF EXISTS provider_usage_events_budget_pool_check,
  DROP CONSTRAINT IF EXISTS provider_usage_events_product_profile_check;
ALTER TABLE leadgen.provider_usage_events
  ADD CONSTRAINT provider_usage_events_budget_pool_check CHECK (budget_pool IN ('DISCOVERY','EVIDENCE')),
  ADD CONSTRAINT provider_usage_events_product_profile_check
    CHECK (product_profile IS NULL OR product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE'));
CREATE INDEX IF NOT EXISTS idx_provider_usage_tavily_daily_pool
  ON leadgen.provider_usage_events(provider,budget_pool,created_at,company_id,product_profile)
  WHERE provider='TAVILY';

ALTER TABLE leadgen.auto_evidence_tasks
  ADD COLUMN IF NOT EXISTS fairness_round_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_strategy_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS strategy_duplicate_prevented_count integer NOT NULL DEFAULT 0;
ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_fairness_round_check,
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_duplicate_prevented_check;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_fairness_round_check CHECK (fairness_round_number>=0),
  ADD CONSTRAINT auto_evidence_tasks_duplicate_prevented_check CHECK (strategy_duplicate_prevented_count>=0);
CREATE INDEX IF NOT EXISTS idx_auto_evidence_fair_dispatch
  ON leadgen.auto_evidence_tasks(last_strategy_started_at,company_id,product_profile)
  WHERE task_status IN ('QUEUED','RETRY_SCHEDULED');

COMMIT;
