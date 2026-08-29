BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.research_search_queries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    query_text text NOT NULL,
    query_type text NOT NULL
        CHECK (query_type IN ('buyer_category', 'general_trading', 'domain_targeted', 'market_wide')),
    country text NOT NULL,
    city text,
    product_category text NOT NULL,
    buyer_type text,
    provider text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    executed_at timestamptz,
    UNIQUE (research_job_id, query_text)
);

CREATE TABLE IF NOT EXISTS leadgen.research_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    search_query_id uuid NOT NULL REFERENCES leadgen.research_search_queries(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    normalized_url text NOT NULL,
    root_domain text NOT NULL,
    snippet text,
    rank integer NOT NULL CHECK (rank >= 1),
    candidate_type text NOT NULL
        CHECK (candidate_type IN ('OFFICIAL_SITE_CANDIDATE', 'DIRECTORY_PROFILE', 'TRADE_SHOW_PROFILE', 'SOCIAL_PROFILE', 'ARTICLE', 'MARKETPLACE', 'OTHER')),
    candidate_status text NOT NULL DEFAULT 'NEW'
        CHECK (candidate_status IN ('NEW', 'ACCEPTED', 'REJECTED', 'REVIEW')),
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_job_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS leadgen.research_candidate_queries (
    research_candidate_id uuid NOT NULL REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    research_search_query_id uuid NOT NULL REFERENCES leadgen.research_search_queries(id) ON DELETE CASCADE,
    rank integer NOT NULL CHECK (rank >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (research_candidate_id, research_search_query_id)
);

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS companies_review integer NOT NULL DEFAULT 0 CHECK (companies_review >= 0),
    ADD COLUMN IF NOT EXISTS search_api_requests integer NOT NULL DEFAULT 0 CHECK (search_api_requests >= 0),
    ADD COLUMN IF NOT EXISTS search_successful_requests integer NOT NULL DEFAULT 0 CHECK (search_successful_requests >= 0),
    ADD COLUMN IF NOT EXISTS search_failed_requests integer NOT NULL DEFAULT 0 CHECK (search_failed_requests >= 0),
    ADD COLUMN IF NOT EXISTS search_raw_results integer NOT NULL DEFAULT 0 CHECK (search_raw_results >= 0),
    ADD COLUMN IF NOT EXISTS search_noise_rejected integer NOT NULL DEFAULT 0 CHECK (search_noise_rejected >= 0),
    ADD COLUMN IF NOT EXISTS search_duplicates_removed integer NOT NULL DEFAULT 0 CHECK (search_duplicates_removed >= 0),
    ADD COLUMN IF NOT EXISTS search_runtime_ms integer NOT NULL DEFAULT 0 CHECK (search_runtime_ms >= 0);

CREATE INDEX IF NOT EXISTS idx_research_queries_job_status
    ON leadgen.research_search_queries (research_job_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_research_candidates_job_status
    ON leadgen.research_candidates (research_job_id, candidate_status, rank);

CREATE INDEX IF NOT EXISTS idx_research_candidates_root_domain
    ON leadgen.research_candidates (research_job_id, root_domain);

COMMIT;
