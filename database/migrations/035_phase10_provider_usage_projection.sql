BEGIN;

ALTER TABLE leadgen.provider_usage_events
  ADD COLUMN IF NOT EXISTS released_units integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='leadgen.provider_usage_events'::regclass
      AND conname='provider_usage_events_released_units_check'
  ) THEN
    ALTER TABLE leadgen.provider_usage_events
      ADD CONSTRAINT provider_usage_events_released_units_check CHECK (released_units >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_usage_events_job_company_provider
  ON leadgen.provider_usage_events(research_job_id,company_id,provider,created_at,id);

CREATE OR REPLACE VIEW leadgen.research_job_provider_usage_summary AS
SELECT j.id research_job_id,
  count(e.id) FILTER (WHERE e.status <> 'SKIPPED')::integer provider_call_count,
  count(e.id) FILTER (WHERE e.status = 'COMPLETED')::integer provider_completed_count,
  count(e.id) FILTER (WHERE e.status = 'NOT_FOUND')::integer provider_not_found_count,
  count(e.id) FILTER (WHERE e.status = 'TEMPORARY_ERROR')::integer provider_temporary_error_count,
  count(e.id) FILTER (WHERE e.status = 'FAILED')::integer provider_failed_count,
  coalesce(sum(e.reserved_units),0)::integer reserved_units,
  coalesce(sum(e.used_units),0)::integer used_units,
  coalesce(sum(e.released_units),0)::integer released_units,
  max(coalesce(e.completed_at,e.created_at)) last_provider_event_at,
  max(coalesce(e.completed_at,e.created_at)) projection_updated_at
FROM leadgen.research_jobs j
LEFT JOIN leadgen.provider_usage_events e ON e.research_job_id=j.id
GROUP BY j.id;

CREATE OR REPLACE VIEW leadgen.research_job_company_provider_usage_summary AS
SELECT e.research_job_id,e.company_id,
  count(*) FILTER (WHERE e.status <> 'SKIPPED')::integer provider_call_count,
  count(*) FILTER (WHERE e.status = 'COMPLETED')::integer provider_completed_count,
  count(*) FILTER (WHERE e.status = 'NOT_FOUND')::integer provider_not_found_count,
  count(*) FILTER (WHERE e.status = 'TEMPORARY_ERROR')::integer provider_temporary_error_count,
  count(*) FILTER (WHERE e.status = 'FAILED')::integer provider_failed_count,
  coalesce(sum(e.reserved_units),0)::integer reserved_units,
  coalesce(sum(e.used_units),0)::integer used_units,
  coalesce(sum(e.released_units),0)::integer released_units,
  max(coalesce(e.completed_at,e.created_at)) last_provider_event_at,
  max(coalesce(e.completed_at,e.created_at)) projection_updated_at
FROM leadgen.provider_usage_events e
WHERE e.company_id IS NOT NULL
GROUP BY e.research_job_id,e.company_id;

CREATE TABLE IF NOT EXISTS leadgen.provider_usage_projection_reconciliation_runs (
  id bigserial PRIMARY KEY,
  execution_key text NOT NULL UNIQUE,
  projection_name text NOT NULL,
  source_event_count bigint NOT NULL CHECK (source_event_count >= 0),
  projected_job_count bigint NOT NULL CHECK (projected_job_count >= 0),
  projected_used_units bigint NOT NULL CHECK (projected_used_units >= 0),
  reconciled_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO leadgen.provider_usage_projection_reconciliation_runs(
  execution_key,projection_name,source_event_count,projected_job_count,projected_used_units
)
SELECT 'wp08:035:initial-live-projection','research_job_provider_usage_summary',
  (SELECT count(*) FROM leadgen.provider_usage_events),
  (SELECT count(*) FROM leadgen.research_job_provider_usage_summary WHERE provider_call_count > 0),
  (SELECT coalesce(sum(used_units),0) FROM leadgen.provider_usage_events)
ON CONFLICT (execution_key) DO NOTHING;

COMMIT;
