BEGIN;

CREATE SCHEMA IF NOT EXISTS leadgen;

CREATE TABLE IF NOT EXISTS leadgen.companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name text NOT NULL,
    normalized_domain text NOT NULL UNIQUE,
    country_code char(2) NOT NULL,
    city text,
    service_region text,
    website_url text,
    company_type text,
    company_description text,
    product_categories text[] NOT NULL DEFAULT '{}',
    brand_portfolio text[] NOT NULL DEFAULT '{}',
    importer_wholesaler_evidence text,
    chain_store_supply_evidence text,
    qualification_status text NOT NULL DEFAULT 'pending'
        CHECK (qualification_status IN ('pending', 'qualified', 'rejected', 'needs_review')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    provider_name text NOT NULL,
    source_url text NOT NULL,
    provider_reference text,
    captured_at timestamptz NOT NULL DEFAULT now(),
    raw_payload jsonb,
    UNIQUE (company_id, provider_name, source_url)
);

CREATE TABLE IF NOT EXISTS leadgen.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    full_name text,
    job_title text,
    department text,
    business_email text,
    email_verification_status text NOT NULL DEFAULT 'unknown'
        CHECK (email_verification_status IN ('valid', 'invalid', 'risky', 'unknown')),
    business_phone text,
    profile_url text,
    source_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.lead_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    product_match text,
    lead_score numeric(5,2) CHECK (lead_score BETWEEN 0 AND 100),
    tier char(1) CHECK (tier IN ('A', 'B', 'C')),
    score_explanation text,
    approval_status text NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_changes')),
    outreach_draft text,
    send_status text NOT NULL DEFAULT 'disabled'
        CHECK (send_status IN ('disabled', 'draft', 'approved', 'sent', 'stopped')),
    opt_out boolean NOT NULL DEFAULT false,
    reply_intent text,
    owner text,
    next_action text,
    n8n_execution_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_country_status
    ON leadgen.companies (country_code, qualification_status);
CREATE INDEX IF NOT EXISTS idx_sources_company_id
    ON leadgen.sources (company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id
    ON leadgen.contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_reviews_company_approval
    ON leadgen.lead_reviews (company_id, approval_status);

COMMIT;
