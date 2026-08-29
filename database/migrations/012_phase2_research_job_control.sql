BEGIN;

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS last_error text;

COMMIT;
