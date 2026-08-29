BEGIN;

ALTER TABLE leadgen.research_candidates
    ADD COLUMN IF NOT EXISTS provider_score numeric(10,8),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE leadgen.research_candidates
    DROP CONSTRAINT IF EXISTS research_candidates_candidate_type_check;

ALTER TABLE leadgen.research_candidates
    ADD CONSTRAINT research_candidates_candidate_type_check
    CHECK (candidate_type IN (
        'POSSIBLE_COMPANY_SITE',
        'OFFICIAL_SITE_CANDIDATE',
        'DIRECTORY_PROFILE',
        'TRADE_SHOW_PROFILE',
        'SOCIAL_PROFILE',
        'ARTICLE',
        'MARKETPLACE',
        'OTHER'
    ));

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS search_credits_used numeric(10,2) NOT NULL DEFAULT 0
        CHECK (search_credits_used >= 0);

COMMIT;
