BEGIN;

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS country_code char(2),
    ADD COLUMN IF NOT EXISTS country_name text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS preferred_language text,
    ADD COLUMN IF NOT EXISTS market_profile text;

UPDATE leadgen.research_jobs SET
    country_name=coalesce(country_name,country),
    country_code=coalesce(country_code,CASE
        WHEN lower(country) IN ('united arab emirates','uae') THEN 'AE'
        WHEN lower(country)='bangladesh' THEN 'BD'
        ELSE 'XX'
    END),
    market_profile=coalesce(market_profile,CASE
        WHEN lower(country) IN ('united arab emirates','uae') THEN 'AE'
        WHEN lower(country)='bangladesh' THEN 'BD'
        ELSE 'GENERIC'
    END);

ALTER TABLE leadgen.research_jobs
    ALTER COLUMN country_code SET NOT NULL,
    ALTER COLUMN country_name SET NOT NULL,
    ALTER COLUMN market_profile SET NOT NULL;

ALTER TABLE leadgen.research_search_queries
    DROP CONSTRAINT IF EXISTS research_search_queries_query_type_check;
ALTER TABLE leadgen.research_search_queries
    ADD CONSTRAINT research_search_queries_query_type_check
    CHECK (query_type IN (
        'buyer_category', 'general_trading', 'domain_targeted', 'market_wide',
        'sme_regional', 'social_business', 'strategic_account'
    ));

ALTER TABLE leadgen.research_search_queries
    ADD COLUMN IF NOT EXISTS country_code char(2),
    ADD COLUMN IF NOT EXISTS country_name text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS preferred_language text,
    ADD COLUMN IF NOT EXISTS market_profile text;

UPDATE leadgen.research_search_queries q SET
    country_code=j.country_code,country_name=j.country_name,region=j.region,
    preferred_language=j.preferred_language,market_profile=j.market_profile
FROM leadgen.research_jobs j
WHERE q.research_job_id=j.id AND q.country_code IS NULL;

ALTER TABLE leadgen.companies
    DROP CONSTRAINT IF EXISTS companies_company_size_band_check;
ALTER TABLE leadgen.companies
    ADD CONSTRAINT companies_company_size_band_check
    CHECK (company_size_band IN ('micro','small','medium','large','enterprise','unknown'));

ALTER TABLE leadgen.companies
    ADD COLUMN IF NOT EXISTS official_root_domain text,
    ADD COLUMN IF NOT EXISTS country_name text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS partnership_accessibility text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS sme_relevance text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS strategic_account boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS phase4_verification_status text;

UPDATE leadgen.companies SET country_name=CASE country_code
    WHEN 'AE' THEN 'United Arab Emirates'
    WHEN 'BD' THEN 'Bangladesh'
    ELSE country_name
END WHERE country_name IS NULL;

ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_partnership_accessibility_check;
ALTER TABLE leadgen.companies ADD CONSTRAINT companies_partnership_accessibility_check
    CHECK (partnership_accessibility IN ('HIGH','MEDIUM','LOW','UNKNOWN'));
ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_sme_relevance_check;
ALTER TABLE leadgen.companies ADD CONSTRAINT companies_sme_relevance_check
    CHECK (sme_relevance IN ('HIGH','MEDIUM','LOW','UNKNOWN'));
ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_phase4_verification_status_check;
ALTER TABLE leadgen.companies ADD CONSTRAINT companies_phase4_verification_status_check
    CHECK (phase4_verification_status IS NULL OR phase4_verification_status IN ('VERIFIED_BUSINESS','REVIEW','REJECTED'));

ALTER TABLE leadgen.contacts
    ADD COLUMN IF NOT EXISTS contact_type text,
    ADD COLUMN IF NOT EXISTS contact_value text,
    ADD COLUMN IF NOT EXISTS normalized_value text,
    ADD COLUMN IF NOT EXISTS phone_country_context text,
    ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
    ADD COLUMN IF NOT EXISTS captured_at timestamptz,
    ADD COLUMN IF NOT EXISTS research_candidate_contact_id uuid
        REFERENCES leadgen.research_candidate_contacts(id) ON DELETE SET NULL;
ALTER TABLE leadgen.contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE leadgen.contacts ADD CONSTRAINT contacts_contact_type_check
    CHECK (contact_type IS NULL OR contact_type IN ('EMAIL','PHONE'));
ALTER TABLE leadgen.contacts DROP CONSTRAINT IF EXISTS contacts_normalization_status_check;
ALTER TABLE leadgen.contacts ADD CONSTRAINT contacts_normalization_status_check
    CHECK (normalization_status IN (
        'INVALID','EXPLICIT_INTERNATIONAL','COUNTRY_CONTEXT_MATCH','COUNTRY_CONTEXT_LOCAL_PREFIX',
        'AMBIGUOUS_LOCAL','NOT_APPLICABLE','LEGACY_UNSPECIFIED'
    ));

ALTER TABLE leadgen.research_candidate_contacts
    ADD COLUMN IF NOT EXISTS phone_country_context text,
    ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE leadgen.research_candidate_contacts
    DROP CONSTRAINT IF EXISTS research_candidate_contacts_normalization_status_check;
ALTER TABLE leadgen.research_candidate_contacts
    ADD CONSTRAINT research_candidate_contacts_normalization_status_check
    CHECK (normalization_status IN (
        'INVALID','EXPLICIT_INTERNATIONAL','COUNTRY_CONTEXT_MATCH','COUNTRY_CONTEXT_LOCAL_PREFIX',
        'AMBIGUOUS_LOCAL','NOT_APPLICABLE','LEGACY_UNSPECIFIED'
    ));

CREATE TABLE IF NOT EXISTS leadgen.research_candidate_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_candidate_id uuid NOT NULL UNIQUE
        REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid REFERENCES leadgen.companies(id) ON DELETE SET NULL,
    verification_status text NOT NULL
        CHECK (verification_status IN ('VERIFIED_BUSINESS','REVIEW','REJECTED')),
    resolved_company_name text,
    normalized_company_name text,
    official_website text,
    official_root_domain text,
    official_website_confidence numeric(4,3) NOT NULL DEFAULT 0
        CHECK (official_website_confidence BETWEEN 0 AND 1),
    country_code char(2),
    country_name text,
    market_profile text,
    city text,
    region text,
    address text,
    importer_status text NOT NULL DEFAULT 'UNKNOWN',
    wholesaler_status text NOT NULL DEFAULT 'UNKNOWN',
    distributor_status text NOT NULL DEFAULT 'UNKNOWN',
    general_trading_status text NOT NULL DEFAULT 'UNKNOWN',
    company_size text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (company_size IN ('MICRO','SMALL','MEDIUM','LARGE','ENTERPRISE','UNKNOWN')),
    company_size_confidence numeric(4,3) NOT NULL DEFAULT 0
        CHECK (company_size_confidence BETWEEN 0 AND 1),
    company_size_method text NOT NULL DEFAULT 'INSUFFICIENT_PUBLIC_EVIDENCE',
    size_evidence_ids uuid[] NOT NULL DEFAULT '{}',
    sme_relevance text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (sme_relevance IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
    sme_reason_codes text[] NOT NULL DEFAULT '{}',
    partnership_accessibility text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (partnership_accessibility IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
    partnership_accessibility_confidence numeric(4,3) NOT NULL DEFAULT 0
        CHECK (partnership_accessibility_confidence BETWEEN 0 AND 1),
    accessibility_reason_codes text[] NOT NULL DEFAULT '{}',
    accessibility_evidence_ids uuid[] NOT NULL DEFAULT '{}',
    business_type_evidence_ids uuid[] NOT NULL DEFAULT '{}',
    strategic_account boolean NOT NULL DEFAULT false,
    strategic_reason_codes text[] NOT NULL DEFAULT '{}',
    social_enrichment_status text NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (social_enrichment_status IN ('NOT_STARTED','COMPLETED','PARTIAL','NO_PUBLIC_ACCOUNT','FAILED')),
    promotion_status text NOT NULL DEFAULT 'NOT_READY'
        CHECK (promotion_status IN ('NOT_READY','READY_TO_PROMOTE','PROMOTED_NEW','ENRICHED_EXISTING','REJECTED')),
    rejection_reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz
);

ALTER TABLE leadgen.research_candidate_verifications
    DROP CONSTRAINT IF EXISTS research_candidate_verifications_importer_status_check,
    DROP CONSTRAINT IF EXISTS research_candidate_verifications_wholesaler_status_check,
    DROP CONSTRAINT IF EXISTS research_candidate_verifications_distributor_status_check,
    DROP CONSTRAINT IF EXISTS research_candidate_verifications_general_trading_status_check;
ALTER TABLE leadgen.research_candidate_verifications
    ADD CONSTRAINT research_candidate_verifications_importer_status_check
    CHECK (importer_status IN ('VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED')),
    ADD CONSTRAINT research_candidate_verifications_wholesaler_status_check
    CHECK (wholesaler_status IN ('VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED')),
    ADD CONSTRAINT research_candidate_verifications_distributor_status_check
    CHECK (distributor_status IN ('VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED')),
    ADD CONSTRAINT research_candidate_verifications_general_trading_status_check
    CHECK (general_trading_status IN ('VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED'));

CREATE TABLE IF NOT EXISTS leadgen.company_verification_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    research_candidate_id uuid NOT NULL REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    company_id uuid REFERENCES leadgen.companies(id) ON DELETE SET NULL,
    verification_id uuid REFERENCES leadgen.research_candidate_verifications(id) ON DELETE CASCADE,
    evidence_type text NOT NULL CHECK (evidence_type IN (
        'COMPANY_IDENTITY','LOCATION','IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING',
        'PRODUCT_CATEGORY','BRANDS','RETAIL_CHANNEL','REGIONAL_COVERAGE','WAREHOUSE','LOCATIONS',
        'EMPLOYEE_SIZE','COMPANY_SCALE','RECENT_ACTIVITY','PUBLIC_CONTACT','SOCIAL_ACCOUNT'
    )),
    evidence_value text,
    evidence_text text NOT NULL,
    source_type text NOT NULL,
    source_url text NOT NULL,
    source_page_title text,
    confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    verification_method text NOT NULL,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_candidate_id,evidence_type,source_url,evidence_text)
);

CREATE TABLE IF NOT EXISTS leadgen.company_social_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    research_candidate_id uuid REFERENCES leadgen.research_candidates(id) ON DELETE CASCADE,
    platform text NOT NULL CHECK (platform IN ('LINKEDIN','INSTAGRAM','FACEBOOK','TIKTOK','YOUTUBE','WHATSAPP','OTHER')),
    profile_url text NOT NULL,
    normalized_profile_url text NOT NULL,
    account_type text NOT NULL CHECK (account_type IN ('BUSINESS','UNKNOWN','PERSONAL_REJECTED')),
    verification_status text NOT NULL CHECK (verification_status IN ('OFFICIAL_SITE_LINKED','PUBLIC_SEARCH_MATCH','UNCONFIRMED','REJECTED')),
    source_url text NOT NULL,
    source_type text NOT NULL,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (company_id IS NOT NULL OR research_candidate_id IS NOT NULL),
    UNIQUE (research_candidate_id,normalized_profile_url),
    UNIQUE (company_id,normalized_profile_url)
);

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS candidates_verified integer NOT NULL DEFAULT 0 CHECK (candidates_verified >= 0),
    ADD COLUMN IF NOT EXISTS candidates_in_review integer NOT NULL DEFAULT 0 CHECK (candidates_in_review >= 0),
    ADD COLUMN IF NOT EXISTS candidates_rejected_phase4 integer NOT NULL DEFAULT 0 CHECK (candidates_rejected_phase4 >= 0),
    ADD COLUMN IF NOT EXISTS strategic_accounts_found integer NOT NULL DEFAULT 0 CHECK (strategic_accounts_found >= 0),
    ADD COLUMN IF NOT EXISTS sme_opportunities_found integer NOT NULL DEFAULT 0 CHECK (sme_opportunities_found >= 0),
    ADD COLUMN IF NOT EXISTS verification_pages_fetched integer NOT NULL DEFAULT 0 CHECK (verification_pages_fetched >= 0),
    ADD COLUMN IF NOT EXISTS social_accounts_found integer NOT NULL DEFAULT 0 CHECK (social_accounts_found >= 0),
    ADD COLUMN IF NOT EXISTS social_search_api_requests integer NOT NULL DEFAULT 0 CHECK (social_search_api_requests >= 0),
    ADD COLUMN IF NOT EXISTS social_search_credits_used numeric(10,2) NOT NULL DEFAULT 0 CHECK (social_search_credits_used >= 0),
    ADD COLUMN IF NOT EXISTS companies_promoted_new integer NOT NULL DEFAULT 0 CHECK (companies_promoted_new >= 0),
    ADD COLUMN IF NOT EXISTS companies_enriched_existing integer NOT NULL DEFAULT 0 CHECK (companies_enriched_existing >= 0);

CREATE INDEX IF NOT EXISTS idx_candidate_verifications_job_status
    ON leadgen.research_candidate_verifications (research_job_id,verification_status,promotion_status);
CREATE INDEX IF NOT EXISTS idx_candidate_verifications_management
    ON leadgen.research_candidate_verifications (sme_relevance,partnership_accessibility,strategic_account);
CREATE INDEX IF NOT EXISTS idx_verification_evidence_candidate
    ON leadgen.company_verification_evidence (research_candidate_id,evidence_type,captured_at);
CREATE INDEX IF NOT EXISTS idx_social_accounts_candidate
    ON leadgen.company_social_accounts (research_candidate_id,platform);
CREATE INDEX IF NOT EXISTS idx_companies_official_root_domain
    ON leadgen.companies (official_root_domain)
    WHERE official_root_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_promoted_candidate_contact
    ON leadgen.contacts (research_candidate_contact_id)
    WHERE research_candidate_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_company_typed_value
    ON leadgen.contacts (company_id,contact_type,normalized_value)
    WHERE contact_type IS NOT NULL AND normalized_value IS NOT NULL;

COMMIT;
