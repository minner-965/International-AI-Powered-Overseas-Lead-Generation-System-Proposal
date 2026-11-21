BEGIN;

-- 080: one row per spreadsheet import of companies (2026-11-21). Append-only.
--   merchant_id   the owner the companies were imported for (NULL = SIM)
--   mapping       which file column fed which field
--   results       per row: status (CREATED / SKIPPED / FAILED) and a reason code
CREATE TABLE IF NOT EXISTS leadgen.company_import_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 255),
  row_count integer NOT NULL CHECK(row_count>=0),
  created_count integer NOT NULL CHECK(created_count>=0),
  skipped_count integer NOT NULL CHECK(skipped_count>=0),
  failed_count integer NOT NULL CHECK(failed_count>=0),
  mapping jsonb NOT NULL,
  results jsonb NOT NULL,
  created_by text NOT NULL CHECK(char_length(created_by) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_import_runs_owner ON leadgen.company_import_runs(merchant_id,created_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_company_import_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'COMPANY_IMPORT_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS company_import_runs_history_guard ON leadgen.company_import_runs;
CREATE TRIGGER company_import_runs_history_guard BEFORE UPDATE OR DELETE ON leadgen.company_import_runs
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_company_import_history();

COMMIT;
