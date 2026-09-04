BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.research_job_purge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL CHECK (btrim(actor) <> '' AND length(actor) <= 200),
  reason text NOT NULL CHECK (reason ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.research_job_purge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purge_run_id uuid NOT NULL REFERENCES leadgen.research_job_purge_runs(id) ON DELETE RESTRICT,
  deleted_research_job_id uuid NOT NULL,
  deleted_task_id uuid,
  classification text NOT NULL CHECK (classification IN (
    'EMPTY_NEVER_STARTED',
    'EMPTY_FAILED_BEFORE_SIDE_EFFECT',
    'DUPLICATE_EMPTY_TASK'
  )),
  deleted_child_counts jsonb NOT NULL CHECK (jsonb_typeof(deleted_child_counts) = 'object'),
  eligibility_snapshot_hash text NOT NULL CHECK (eligibility_snapshot_hash ~ '^[0-9A-Fa-f]{64}$'),
  actor text NOT NULL CHECK (btrim(actor) <> '' AND length(actor) <= 200),
  reason text NOT NULL CHECK (reason ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  executed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deleted_research_job_id)
);

CREATE INDEX IF NOT EXISTS idx_research_job_purge_items_run
  ON leadgen.research_job_purge_items(purge_run_id,executed_at);

CREATE OR REPLACE FUNCTION leadgen.prevent_research_job_purge_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research job purge audit is append-only' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_research_job_purge_runs_immutable ON leadgen.research_job_purge_runs;
CREATE TRIGGER trg_research_job_purge_runs_immutable
BEFORE UPDATE OR DELETE ON leadgen.research_job_purge_runs
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_research_job_purge_audit_mutation();

DROP TRIGGER IF EXISTS trg_research_job_purge_items_immutable ON leadgen.research_job_purge_items;
CREATE TRIGGER trg_research_job_purge_items_immutable
BEFORE UPDATE OR DELETE ON leadgen.research_job_purge_items
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_research_job_purge_audit_mutation();

COMMIT;
