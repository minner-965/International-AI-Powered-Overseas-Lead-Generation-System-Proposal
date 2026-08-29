BEGIN;

ALTER TABLE leadgen.companies
    ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'manual'
        CHECK (data_origin IN ('manual', 'public_web')),
    ADD COLUMN IF NOT EXISTS last_collected_at timestamptz;

ALTER TABLE leadgen.sources
    ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'directory_listing';

CREATE INDEX IF NOT EXISTS idx_companies_data_origin
    ON leadgen.companies (data_origin, updated_at DESC);

COMMIT;
