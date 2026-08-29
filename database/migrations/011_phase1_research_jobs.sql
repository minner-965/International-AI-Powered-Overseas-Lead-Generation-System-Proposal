BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.research_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country text NOT NULL,
    city text,
    product_category text NOT NULL,
    buyer_types text[] NOT NULL DEFAULT '{}',
    max_results integer NOT NULL CHECK (max_results BETWEEN 1 AND 100),
    status text NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'DISCOVERING', 'CRAWLING', 'QUALIFYING', 'SCORING', 'COMPLETED', 'FAILED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    candidates_found integer NOT NULL DEFAULT 0 CHECK (candidates_found >= 0),
    websites_found integer NOT NULL DEFAULT 0 CHECK (websites_found >= 0),
    companies_crawled integer NOT NULL DEFAULT 0 CHECK (companies_crawled >= 0),
    companies_qualified integer NOT NULL DEFAULT 0 CHECK (companies_qualified >= 0),
    companies_rejected integer NOT NULL DEFAULT 0 CHECK (companies_rejected >= 0),
    tier_a_count integer NOT NULL DEFAULT 0 CHECK (tier_a_count >= 0),
    tier_b_count integer NOT NULL DEFAULT 0 CHECK (tier_b_count >= 0),
    tier_c_count integer NOT NULL DEFAULT 0 CHECK (tier_c_count >= 0),
    error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0)
);

ALTER TABLE leadgen.companies
    ADD COLUMN IF NOT EXISTS research_job_id uuid REFERENCES leadgen.research_jobs(id);

ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_data_origin_check;

-- Classify only from source records already attached to each company. The
-- precedence is conservative and favors the most direct legacy input type.
UPDATE leadgen.companies c
SET data_origin = CASE
    WHEN EXISTS (
        SELECT 1 FROM leadgen.sources s
        WHERE s.company_id = c.id
          AND s.provider_name = '企业官网'
          AND s.evidence_kind = 'company_claim'
    ) THEN 'fixed_public_candidate'
    WHEN EXISTS (
        SELECT 1 FROM leadgen.sources s
        WHERE s.company_id = c.id
          AND s.provider_name = 'LinkedIn 公开企业主页'
          AND s.evidence_kind = 'public_business_social_profile'
    ) THEN 'fixed_public_profile'
    WHEN EXISTS (
        SELECT 1 FROM leadgen.sources s
        WHERE s.company_id = c.id
          AND s.provider_name = 'Emirates Online 商业目录'
          AND s.evidence_kind IN ('business_directory', 'corroborating_listing')
    ) THEN 'directory_live'
    WHEN EXISTS (
        SELECT 1 FROM leadgen.sources s
        WHERE s.company_id = c.id
          AND s.provider_name = 'OpenStreetMap 公开地图'
          AND s.evidence_kind IN ('geospatial_business_listing', 'corroborating_listing')
    ) THEN 'osm_live'
    ELSE 'legacy_public_web'
END
WHERE c.data_origin = 'public_web';

ALTER TABLE leadgen.companies
    ADD CONSTRAINT companies_data_origin_check
    CHECK (data_origin IN (
        'live_discovered',
        'fixed_public_candidate',
        'fixed_public_profile',
        'directory_live',
        'osm_live',
        'legacy_public_web',
        'manual',
        'imported',
        'seed'
    ));

ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_live_discovered_job_check;
ALTER TABLE leadgen.companies
    ADD CONSTRAINT companies_live_discovered_job_check
    CHECK (data_origin <> 'live_discovered' OR research_job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_research_jobs_status_created
    ON leadgen.research_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_companies_research_job
    ON leadgen.companies (research_job_id)
    WHERE research_job_id IS NOT NULL;

COMMIT;
