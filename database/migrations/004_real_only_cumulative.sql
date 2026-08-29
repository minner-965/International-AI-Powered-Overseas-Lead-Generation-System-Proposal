BEGIN;

DELETE FROM leadgen.companies WHERE data_origin = 'synthetic';
DROP TABLE IF EXISTS leadgen.demo_runs;

ALTER TABLE leadgen.companies DROP COLUMN IF EXISTS is_demo;
ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_data_origin_check;
ALTER TABLE leadgen.companies
    ADD CONSTRAINT companies_data_origin_check
    CHECK (data_origin IN ('manual', 'public_web'));

ALTER TABLE leadgen.contacts
    ADD COLUMN IF NOT EXISTS verification_method text,
    ADD COLUMN IF NOT EXISTS verification_detail text,
    ADD COLUMN IF NOT EXISTS verification_checked_at timestamptz;

UPDATE leadgen.contacts SET email_verification_status='unknown'
WHERE email_verification_status='not_checked';
ALTER TABLE leadgen.contacts ALTER COLUMN email_verification_status SET DEFAULT 'unknown';

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_lead_review_per_company
    ON leadgen.lead_reviews (company_id);

CREATE TABLE IF NOT EXISTS leadgen.collection_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_product text NOT NULL,
    providers text[] NOT NULL DEFAULT '{}',
    fetched_records integer NOT NULL DEFAULT 0,
    new_companies integer NOT NULL DEFAULT 0,
    updated_companies integer NOT NULL DEFAULT 0,
    source_errors text[] NOT NULL DEFAULT '{}',
    completed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
