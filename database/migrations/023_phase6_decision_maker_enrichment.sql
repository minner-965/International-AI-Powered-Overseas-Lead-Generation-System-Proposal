BEGIN;

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'COMPANY_DISCOVERY',
    ADD COLUMN IF NOT EXISTS market_codes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS product_profiles text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS requested_company_ids uuid[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS companies_attempted integer NOT NULL DEFAULT 0 CHECK (companies_attempted >= 0),
    ADD COLUMN IF NOT EXISTS decision_makers_found integer NOT NULL DEFAULT 0 CHECK (decision_makers_found >= 0),
    ADD COLUMN IF NOT EXISTS verified_departments integer NOT NULL DEFAULT 0 CHECK (verified_departments >= 0),
    ADD COLUMN IF NOT EXISTS contact_routes_found integer NOT NULL DEFAULT 0 CHECK (contact_routes_found >= 0),
    ADD COLUMN IF NOT EXISTS sales_ready_count integer NOT NULL DEFAULT 0 CHECK (sales_ready_count >= 0),
    ADD COLUMN IF NOT EXISTS strategic_long_shot_count integer NOT NULL DEFAULT 0 CHECK (strategic_long_shot_count >= 0),
    ADD COLUMN IF NOT EXISTS enrichment_sources_found integer NOT NULL DEFAULT 0 CHECK (enrichment_sources_found >= 0),
    ADD COLUMN IF NOT EXISTS hunter_calls integer NOT NULL DEFAULT 0 CHECK (hunter_calls >= 0),
    ADD COLUMN IF NOT EXISTS hunter_credits_used_units integer NOT NULL DEFAULT 0 CHECK (hunter_credits_used_units >= 0),
    ADD COLUMN IF NOT EXISTS enrichment_timeouts integer NOT NULL DEFAULT 0 CHECK (enrichment_timeouts >= 0);

ALTER TABLE leadgen.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_status_check;
ALTER TABLE leadgen.research_jobs
    ADD CONSTRAINT research_jobs_status_check CHECK (status IN (
        'QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING','COMPLETED','FAILED',
        'RESOLVING','VERIFYING','PERSISTING','COMPLETE','PARTIAL'
    ));

ALTER TABLE leadgen.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_job_type_check;
ALTER TABLE leadgen.research_jobs
    ADD CONSTRAINT research_jobs_job_type_check
    CHECK (job_type IN ('COMPANY_DISCOVERY','DECISION_MAKER_ENRICHMENT'));

-- PhoneService distinguishes an explicitly permitted national-format number from
-- a local-prefix number. Keep the persisted status vocabulary aligned so MX
-- research rows are not rejected after successful normalization.
ALTER TABLE leadgen.contacts DROP CONSTRAINT IF EXISTS contacts_normalization_status_check;
ALTER TABLE leadgen.contacts ADD CONSTRAINT contacts_normalization_status_check
    CHECK (normalization_status IN (
        'INVALID','EXPLICIT_INTERNATIONAL','COUNTRY_CONTEXT_MATCH','COUNTRY_CONTEXT_LOCAL_PREFIX',
        'COUNTRY_CONTEXT_NATIONAL','AMBIGUOUS_LOCAL','NOT_APPLICABLE','LEGACY_UNSPECIFIED'
    ));
ALTER TABLE leadgen.research_candidate_contacts
    DROP CONSTRAINT IF EXISTS research_candidate_contacts_normalization_status_check;
ALTER TABLE leadgen.research_candidate_contacts
    ADD CONSTRAINT research_candidate_contacts_normalization_status_check
    CHECK (normalization_status IN (
        'INVALID','EXPLICIT_INTERNATIONAL','COUNTRY_CONTEXT_MATCH','COUNTRY_CONTEXT_LOCAL_PREFIX',
        'COUNTRY_CONTEXT_NATIONAL','AMBIGUOUS_LOCAL','NOT_APPLICABLE','LEGACY_UNSPECIFIED'
    ));

CREATE INDEX IF NOT EXISTS idx_research_jobs_type_status_created
    ON leadgen.research_jobs (job_type,status,created_at DESC);

ALTER TABLE leadgen.research_search_queries
    ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES leadgen.companies(id) ON DELETE CASCADE;
ALTER TABLE leadgen.research_search_queries
    DROP CONSTRAINT IF EXISTS research_search_queries_research_job_id_query_text_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_queries_discovery_unique
    ON leadgen.research_search_queries (research_job_id,query_text)
    WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_queries_enrichment_unique
    ON leadgen.research_search_queries (research_job_id,company_id,query_text)
    WHERE company_id IS NOT NULL;
ALTER TABLE leadgen.research_search_queries
    DROP CONSTRAINT IF EXISTS research_search_queries_query_type_check;
ALTER TABLE leadgen.research_search_queries
    ADD CONSTRAINT research_search_queries_query_type_check CHECK (query_type IN (
        'buyer_category','general_trading','domain_targeted','market_wide','sme_regional',
        'social_business','strategic_account','decision_maker_role','procurement_route',
        'supplier_access','barrier_evidence','linkedin_reference'
    ));
CREATE INDEX IF NOT EXISTS idx_research_queries_company
    ON leadgen.research_search_queries (research_job_id,company_id,query_type,status);

CREATE TABLE IF NOT EXISTS leadgen.enrichment_job_companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    market_code char(2) NOT NULL,
    product_profiles text[] NOT NULL DEFAULT '{}',
    selection_reason text NOT NULL DEFAULT 'VERIFIED_ACTIVE_ELIGIBLE',
    attempt_status text NOT NULL DEFAULT 'QUEUED'
        CHECK (attempt_status IN ('QUEUED','DISCOVERING','RESOLVING','VERIFYING','PERSISTING','COMPLETE','PARTIAL','FAILED','EXCLUDED')),
    queries_executed integer NOT NULL DEFAULT 0 CHECK (queries_executed >= 0),
    sources_found integer NOT NULL DEFAULT 0 CHECK (sources_found >= 0),
    decision_makers_found integer NOT NULL DEFAULT 0 CHECK (decision_makers_found >= 0),
    contact_routes_found integer NOT NULL DEFAULT 0 CHECK (contact_routes_found >= 0),
    provider_calls integer NOT NULL DEFAULT 0 CHECK (provider_calls >= 0),
    timeout_count integer NOT NULL DEFAULT 0 CHECK (timeout_count >= 0),
    last_error text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_job_id,company_id)
);

CREATE TABLE IF NOT EXISTS leadgen.decision_makers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE SET NULL,
    person_name text,
    person_name_normalized text,
    department_name text,
    department_name_normalized text,
    raw_title text NOT NULL DEFAULT '',
    normalized_role text NOT NULL CHECK (normalized_role IN (
        'BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT',
        'CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING','IMPORT','COMMERCIAL',
        'BUYING_DEPARTMENT','PROCUREMENT_DEPARTMENT','OTHER_RELEVANT','UNKNOWN'
    )),
    role_relevance text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (role_relevance IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
    market_code char(2) NOT NULL,
    verification_status text NOT NULL DEFAULT 'REVIEW'
        CHECK (verification_status IN ('VERIFIED','REVIEW','REJECTED')),
    lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_status IN ('ACTIVE','STALE','SUPERSEDED','DUPLICATE','INVALID','ARCHIVED')),
    evidence_strength text NOT NULL DEFAULT 'DISCOVERY_HINT'
        CHECK (evidence_strength IN ('STRONG','SUPPORTED','DISCOVERY_HINT','NONE')),
    last_verified_at timestamptz,
    source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (person_name IS NOT NULL OR department_name IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_makers_canonical
    ON leadgen.decision_makers (
        company_id,
        coalesce(person_name_normalized,''),
        coalesce(department_name_normalized,''),
        normalized_role,
        raw_title
    );
CREATE INDEX IF NOT EXISTS idx_decision_makers_company_status
    ON leadgen.decision_makers (company_id,verification_status,lifecycle_status,role_relevance);

CREATE TABLE IF NOT EXISTS leadgen.decision_maker_product_relevance (
    decision_maker_id uuid NOT NULL REFERENCES leadgen.decision_makers(id) ON DELETE CASCADE,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    relevance text NOT NULL CHECK (relevance IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (decision_maker_id,product_profile)
);

CREATE TABLE IF NOT EXISTS leadgen.decision_maker_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_maker_id uuid NOT NULL REFERENCES leadgen.decision_makers(id) ON DELETE CASCADE,
    research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE SET NULL,
    source_url text NOT NULL,
    source_type text NOT NULL,
    source_authority text NOT NULL CHECK (source_authority IN (
        'OFFICIAL','OFFICIAL_DOCUMENT','APPROVED_PROVIDER','REGISTRY','INDUSTRY_SOURCE','SEARCH_DISCOVERY','OTHER_PUBLIC'
    )),
    captured_at timestamptz NOT NULL,
    published_at timestamptz,
    evidence_text text NOT NULL,
    evidence_hash text NOT NULL,
    evidence_status text NOT NULL DEFAULT 'REVIEW'
        CHECK (evidence_status IN ('VERIFIED','REVIEW','REJECTED')),
    is_primary boolean NOT NULL DEFAULT false,
    content_fetched boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (decision_maker_id,evidence_hash)
);

CREATE INDEX IF NOT EXISTS idx_decision_maker_sources_decision
    ON leadgen.decision_maker_sources (decision_maker_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.decision_maker_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_maker_id uuid NOT NULL REFERENCES leadgen.decision_makers(id) ON DELETE CASCADE,
    research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE SET NULL,
    contact_type text NOT NULL CHECK (contact_type IN (
        'BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL','BUSINESS_PHONE',
        'BUSINESS_WHATSAPP','CONTACT_FORM','SUPPLIER_PORTAL','VENDOR_REGISTRATION',
        'PUBLIC_PROFILE_URL','OTHER_BUSINESS_ROUTE'
    )),
    contact_value_raw text NOT NULL,
    contact_value_normalized text NOT NULL,
    evidence_origin text NOT NULL DEFAULT 'OFFICIAL_SITE_OBSERVED'
        CHECK (evidence_origin IN ('OFFICIAL_SITE_OBSERVED','PROVIDER_FOUND','PATTERN_CANDIDATE','OTHER_PUBLIC_OBSERVED')),
    verification_status text NOT NULL DEFAULT 'NOT_VERIFIED'
        CHECK (verification_status IN (
            'VALID','ACCEPT_ALL','UNKNOWN','INVALID','TEMPORARY_ERROR','NOT_VERIFIED',
            'PUBLICLY_OBSERVED','FORMAT_VALID','BUSINESS_WHATSAPP_OBSERVED'
        )),
    verification_provider text,
    verification_score numeric(6,3),
    last_verified_at timestamptz,
    source_url text NOT NULL,
    is_generic boolean NOT NULL DEFAULT false,
    is_department boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (decision_maker_id,contact_type,contact_value_normalized)
);

CREATE INDEX IF NOT EXISTS idx_decision_maker_contacts_decision
    ON leadgen.decision_maker_contacts (decision_maker_id,verification_status,contact_type);

CREATE TABLE IF NOT EXISTS leadgen.company_suppressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    suppression_type text NOT NULL CHECK (suppression_type IN ('OPT_OUT','DO_NOT_CONTACT','LEGAL_RESTRICTION','OTHER_EXPLICIT')),
    reason text NOT NULL,
    evidence_source_url text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    lifted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_suppressions_active
    ON leadgen.company_suppressions (company_id,suppression_type)
    WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS leadgen.enrichment_public_references (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    platform text NOT NULL,
    profile_url text NOT NULL,
    profile_kind text NOT NULL DEFAULT 'UNKNOWN',
    title_hint text,
    snippet_hint text,
    discovered_via text NOT NULL,
    verification_status text NOT NULL DEFAULT 'REVIEW' CHECK (verification_status IN ('REVIEW','VERIFIED','REJECTED')),
    evidence_strength text NOT NULL DEFAULT 'DISCOVERY_HINT' CHECK (evidence_strength IN ('DISCOVERY_HINT','SUPPORTED','STRONG')),
    content_fetched boolean NOT NULL DEFAULT false,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_job_id,company_id,profile_url)
);

CREATE TABLE IF NOT EXISTS leadgen.cooperation_feasibility_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE CASCADE,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    cooperation_feasibility_score integer NOT NULL CHECK (cooperation_feasibility_score BETWEEN 0 AND 100),
    feasibility_band text NOT NULL CHECK (feasibility_band IN ('HIGH','MEDIUM','LOW_MEDIUM','LOW')),
    access_opportunity_matrix text NOT NULL CHECK (access_opportunity_matrix IN (
        'HIGH_FIT_HIGH_ACCESS','HIGH_FIT_MEDIUM_ACCESS','HIGH_FIT_LOW_ACCESS',
        'MEDIUM_FIT_HIGH_ACCESS','MEDIUM_FIT_MEDIUM_ACCESS','LOW_PRIORITY'
    )),
    opportunity_readiness text NOT NULL CHECK (opportunity_readiness IN (
        'SALES_READY','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION',
        'HISTORICAL_REVIEW','EXISTING_CUSTOMER','SUPPRESSED','REVIEW','STRATEGIC_LONG_SHOT'
    )),
    relationship_status text NOT NULL CHECK (relationship_status IN (
        'NEW_PROSPECT','HISTORICAL_CRM_LEAD','HISTORICAL_CONTACTED_LEAD',
        'INTERNAL_EXISTING_CUSTOMER','SUPPRESSED','REVIEW'
    )),
    management_match numeric(6,2),
    mexico_historical_match numeric(6,2),
    dpv_score numeric(6,2),
    dimension_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason_codes text[] NOT NULL DEFAULT '{}',
    barrier_signals text[] NOT NULL DEFAULT '{}',
    missing_evidence text[] NOT NULL DEFAULT '{}',
    supplier_route_count integer NOT NULL DEFAULT 0 CHECK (supplier_route_count >= 0),
    verified_decision_maker_count integer NOT NULL DEFAULT 0 CHECK (verified_decision_maker_count >= 0),
    usable_contact_route_count integer NOT NULL DEFAULT 0 CHECK (usable_contact_route_count >= 0),
    evidence_source_count integer NOT NULL DEFAULT 0 CHECK (evidence_source_count >= 0),
    rule_version text NOT NULL DEFAULT 'cooperation-feasibility-v1',
    calculated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_job_id,company_id,product_profile)
);

CREATE INDEX IF NOT EXISTS idx_cooperation_opportunity_sort
    ON leadgen.cooperation_feasibility_results (
        feasibility_band,access_opportunity_matrix,opportunity_readiness,calculated_at DESC
    );
CREATE INDEX IF NOT EXISTS idx_cooperation_company_latest
    ON leadgen.cooperation_feasibility_results (company_id,product_profile,calculated_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.cooperation_feasibility_sources (
    feasibility_result_id uuid NOT NULL REFERENCES leadgen.cooperation_feasibility_results(id) ON DELETE CASCADE,
    decision_maker_source_id uuid NOT NULL REFERENCES leadgen.decision_maker_sources(id) ON DELETE CASCADE,
    dimension text NOT NULL CHECK (dimension IN (
        'external_supplier_openness','supplier_onboarding_accessibility','buying_procurement_accessibility',
        'product_category_buying_fit','commercial_operational_feasibility','supplier_lock_in_barrier'
    )),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (feasibility_result_id,decision_maker_source_id,dimension)
);

CREATE TABLE IF NOT EXISTS leadgen.provider_credit_ledger (
    provider text NOT NULL,
    billing_period text NOT NULL,
    credit_limit_units integer NOT NULL CHECK (credit_limit_units >= 0),
    reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
    used_units integer NOT NULL DEFAULT 0 CHECK (used_units >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider,billing_period),
    CHECK (reserved_units + used_units <= credit_limit_units)
);

CREATE TABLE IF NOT EXISTS leadgen.provider_usage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid REFERENCES leadgen.companies(id) ON DELETE SET NULL,
    provider text NOT NULL,
    billing_period text NOT NULL,
    endpoint text NOT NULL,
    request_fingerprint text NOT NULL,
    status text NOT NULL CHECK (status IN ('RESERVED','COMPLETED','NOT_FOUND','FAILED','TEMPORARY_ERROR','SKIPPED')),
    reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
    used_units integer NOT NULL DEFAULT 0 CHECK (used_units >= 0),
    credits_before_units integer,
    credits_after_units integer,
    provider_request_id text,
    error_code text,
    result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (provider,request_fingerprint)
);

ALTER TABLE leadgen.provider_usage_events
    ADD COLUMN IF NOT EXISTS billing_period text;
UPDATE leadgen.provider_usage_events
SET billing_period=to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
WHERE billing_period IS NULL;
ALTER TABLE leadgen.provider_usage_events
    ALTER COLUMN billing_period SET NOT NULL;
ALTER TABLE leadgen.provider_usage_events
    ADD COLUMN IF NOT EXISTS result_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_provider_usage_job
    ON leadgen.provider_usage_events (research_job_id,provider,created_at DESC);

-- Phase 6 live-acceptance identity reconciliation.  These updates preserve all
-- company/source rows while replacing SEO page titles with names explicitly
-- stated on the same public company websites and excluding records whose own
-- evidence shows they are not eligible target organizations in the selected
-- market/product scope.
UPDATE leadgen.companies
SET company_name = CASE official_root_domain
        WHEN 'alanic.clothing' THEN 'Alanic Clothing'
        WHEN 'rightfaceuae.com' THEN 'Right Face General Trading LLC'
        WHEN 'apparelgroup.com' THEN 'Apparel Group'
        WHEN 'ftinternational.ae' THEN 'Fair Trading International'
        ELSE company_name
    END,
    updated_at = now()
WHERE official_root_domain IN (
    'alanic.clothing','rightfaceuae.com','apparelgroup.com','ftinternational.ae'
);

UPDATE leadgen.companies
SET verification_status = 'REJECTED',
    phase4_verification_status = 'REJECTED',
    qualification_status = 'rejected',
    explicit_exclusion_reason = CASE official_root_domain
        WHEN 'trade.gov' THEN 'NOT_A_TARGET_COMPANY_PUBLIC_GUIDE'
        WHEN '2gis.ae' THEN 'DIRECTORY_PAGE_NOT_OFFICIAL_DOMAIN'
        WHEN 'apparelnbags.com' THEN 'MARKET_MISMATCH_US_COMPANY'
        WHEN 'axe-online.com' THEN 'OEM_ONLY_FINISHED_GOODS_SUPPLIER'
        WHEN 'alanic.clothing' THEN 'OEM_ONLY_FINISHED_GOODS_SUPPLIER'
        ELSE explicit_exclusion_reason
    END,
    lifecycle_status = CASE
        WHEN official_root_domain IN ('trade.gov','2gis.ae') THEN 'INVALID'
        ELSE lifecycle_status
    END,
    updated_at = now()
WHERE official_root_domain IN (
    'trade.gov','2gis.ae','apparelnbags.com','axe-online.com','alanic.clothing'
);

-- The current Apparel Group official profile publishes a 28,000+ workforce;
-- reconcile the earlier employee-range parser result without changing any
-- score or Customer Match calculation.
UPDATE leadgen.companies
SET company_size_band='enterprise',sme_relevance='LOW',strategic_account=true,updated_at=now()
WHERE official_root_domain='apparelgroup.com';

UPDATE leadgen.research_candidate_verifications
SET company_size='ENTERPRISE',company_size_confidence=0.99,
    company_size_method='EXPLICIT_EMPLOYEE_COUNT_RECONCILED',sme_relevance='LOW',
    sme_reason_codes=ARRAY['ENTERPRISE_SCALE','OFFICIAL_EMPLOYEE_COUNT'],strategic_account=true,
    strategic_reason_codes=ARRAY['ENTERPRISE_SCALE','HIGH_PURCHASING_CAPACITY_SIGNAL'],updated_at=now()
WHERE company_id IN (SELECT id FROM leadgen.companies WHERE official_root_domain='apparelgroup.com');

COMMIT;
