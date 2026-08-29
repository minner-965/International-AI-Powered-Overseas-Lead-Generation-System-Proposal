BEGIN;

ALTER TABLE leadgen.research_candidates
    ADD COLUMN IF NOT EXISTS website_reachable boolean,
    ADD COLUMN IF NOT EXISTS http_status integer,
    ADD COLUMN IF NOT EXISTS final_url text,
    ADD COLUMN IF NOT EXISTS checked_at timestamptz,
    ADD COLUMN IF NOT EXISTS contactability_status text NOT NULL DEFAULT 'NOT_CHECKED',
    ADD COLUMN IF NOT EXISTS discovered_external_website text;

ALTER TABLE leadgen.research_candidates
    DROP CONSTRAINT IF EXISTS research_candidates_contactability_status_check;

ALTER TABLE leadgen.research_candidates
    ADD CONSTRAINT research_candidates_contactability_status_check
    CHECK (contactability_status IN (
        'NOT_CHECKED',
        'CONTACTABLE',
        'REACHABLE_NO_PUBLIC_CONTACT',
        'UNREACHABLE',
        'CHECK_FAILED'
    ));

CREATE TABLE IF NOT EXISTS leadgen.research_candidate_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_candidate_id uuid NOT NULL
        REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    contact_type text NOT NULL
        CHECK (contact_type IN ('EMAIL', 'PHONE', 'WHATSAPP', 'CONTACT_FORM')),
    contact_value text NOT NULL,
    normalized_value text NOT NULL,
    source_url text NOT NULL,
    source_page_title text,
    verification_status text NOT NULL
        CHECK (verification_status IN ('PUBLICLY_OBSERVED', 'DOMAIN_MX_VERIFIED', 'INVALID', 'UNVERIFIED')),
    verification_method text NOT NULL,
    syntax_valid boolean,
    mx_present boolean,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_candidate_id, contact_type, normalized_value, source_url)
);

CREATE TABLE IF NOT EXISTS leadgen.research_candidate_fetches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_candidate_id uuid NOT NULL
        REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    requested_url text NOT NULL,
    final_url text,
    http_status integer,
    reachable boolean NOT NULL DEFAULT false,
    content_type text,
    page_title text,
    robots_allowed boolean,
    fetch_status text NOT NULL
        CHECK (fetch_status IN ('COMPLETED', 'BLOCKED_BY_ROBOTS', 'HTTP_ERROR', 'TIMEOUT', 'TOO_LARGE', 'NON_HTML', 'INVALID_URL', 'NETWORK_ERROR')),
    error_message text,
    captured_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS candidates_checked integer NOT NULL DEFAULT 0 CHECK (candidates_checked >= 0),
    ADD COLUMN IF NOT EXISTS reachable_candidates integer NOT NULL DEFAULT 0 CHECK (reachable_candidates >= 0),
    ADD COLUMN IF NOT EXISTS contactable_candidates integer NOT NULL DEFAULT 0 CHECK (contactable_candidates >= 0),
    ADD COLUMN IF NOT EXISTS public_emails_found integer NOT NULL DEFAULT 0 CHECK (public_emails_found >= 0),
    ADD COLUMN IF NOT EXISTS public_phones_found integer NOT NULL DEFAULT 0 CHECK (public_phones_found >= 0),
    ADD COLUMN IF NOT EXISTS public_whatsapp_found integer NOT NULL DEFAULT 0 CHECK (public_whatsapp_found >= 0),
    ADD COLUMN IF NOT EXISTS contact_forms_found integer NOT NULL DEFAULT 0 CHECK (contact_forms_found >= 0);

CREATE INDEX IF NOT EXISTS idx_research_candidate_contacts_candidate
    ON leadgen.research_candidate_contacts (research_candidate_id, contact_type);

CREATE INDEX IF NOT EXISTS idx_research_candidate_fetches_candidate
    ON leadgen.research_candidate_fetches (research_candidate_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_research_candidates_contactability
    ON leadgen.research_candidates (research_job_id, contactability_status, rank);

COMMIT;
