BEGIN;

-- Phase 6.1 V3 is additive and append-only. Source product rows and all
-- Phase 5/6 results remain immutable.
CREATE TABLE IF NOT EXISTS leadgen.schema_migrations (
    migration_key text PRIMARY KEY,
    checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9A-Fa-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS leadgen.product_taxonomy_nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    taxonomy_version text NOT NULL,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    node_type text NOT NULL CHECK (node_type IN ('PRODUCT_PROFILE','CATEGORY','SUBCATEGORY')),
    canonical_code text NOT NULL CHECK (canonical_code ~ '^[A-Z0-9_]+$'),
    canonical_name text NOT NULL CHECK (btrim(canonical_name) <> ''),
    parent_id uuid REFERENCES leadgen.product_taxonomy_nodes(id) ON DELETE RESTRICT,
    attribute_set text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVIEW','RETIRED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (taxonomy_version,canonical_code),
    UNIQUE (id,taxonomy_version),
    CHECK ((node_type='PRODUCT_PROFILE' AND parent_id IS NULL) OR (node_type IN ('CATEGORY','SUBCATEGORY') AND parent_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_product_taxonomy_nodes_profile
    ON leadgen.product_taxonomy_nodes (taxonomy_version,product_profile,node_type,status);

CREATE TABLE IF NOT EXISTS leadgen.product_taxonomy_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    taxonomy_node_id uuid NOT NULL,
    taxonomy_version text NOT NULL,
    language text NOT NULL CHECK (language IN ('en','es','zh','und')),
    market_code char(2),
    raw_alias text NOT NULL CHECK (btrim(raw_alias) <> ''),
    normalized_alias text NOT NULL CHECK (btrim(normalized_alias) <> ''),
    alias_match_type text NOT NULL CHECK (alias_match_type IN ('EXACT','PARENT','ADJACENT','AMBIGUOUS')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVIEW','RETIRED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (taxonomy_node_id,taxonomy_version)
        REFERENCES leadgen.product_taxonomy_nodes(id,taxonomy_version) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_taxonomy_alias_identity
    ON leadgen.product_taxonomy_aliases (taxonomy_node_id,taxonomy_version,language,coalesce(market_code,''),normalized_alias);
CREATE INDEX IF NOT EXISTS idx_product_taxonomy_alias_lookup
    ON leadgen.product_taxonomy_aliases (taxonomy_version,normalized_alias,status);

CREATE TABLE IF NOT EXISTS leadgen.product_master_taxonomy_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_master_id uuid NOT NULL REFERENCES leadgen.product_master(id) ON DELETE RESTRICT,
    taxonomy_node_id uuid,
    taxonomy_version text NOT NULL,
    normalized_profile text NOT NULL DEFAULT 'UNKNOWN' CHECK (normalized_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    normalized_category text,
    normalized_subcategory text,
    assignment_status text NOT NULL CHECK (assignment_status IN ('CONFIRMED','SUPPORTED','REVIEW','UNKNOWN')),
    catalog_status text NOT NULL CHECK (catalog_status IN ('CURRENT_CONFIRMED','HISTORICAL_ORDER_SUPPORTED','REFERENCE_ONLY','REVIEW','EXCLUDED','UNKNOWN')),
    classification_version text NOT NULL,
    reason_codes text[] NOT NULL DEFAULT '{}',
    source_fields text[] NOT NULL DEFAULT '{}',
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS' CHECK (data_classification='INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (taxonomy_node_id,taxonomy_version)
        REFERENCES leadgen.product_taxonomy_nodes(id,taxonomy_version) ON DELETE RESTRICT,
    CHECK ((assignment_status IN ('CONFIRMED','SUPPORTED') AND taxonomy_node_id IS NOT NULL AND normalized_profile <> 'UNKNOWN' AND normalized_category IS NOT NULL)
        OR assignment_status IN ('REVIEW','UNKNOWN')),
    CHECK (normalized_profile <> 'UNKNOWN' OR normalized_category IS NULL),
    UNIQUE (product_master_id,taxonomy_version,classification_version,input_digest)
);
CREATE INDEX IF NOT EXISTS idx_product_master_taxonomy_candidate
    ON leadgen.product_master_taxonomy_assignments (taxonomy_version,normalized_profile,assignment_status,catalog_status,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.product_profile_catalog_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_version text NOT NULL,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    eligible_product_count integer NOT NULL CHECK (eligible_product_count >= 0),
    classified_product_count integer NOT NULL CHECK (classified_product_count >= 0),
    unknown_product_count integer NOT NULL CHECK (unknown_product_count >= 0),
    excluded_product_count integer NOT NULL DEFAULT 0 CHECK (excluded_product_count >= 0),
    source_digest text NOT NULL CHECK (source_digest ~ '^[0-9A-Fa-f]{64}$'),
    coverage_percent numeric(6,2) NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
    taxonomy_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (snapshot_version,product_profile,source_digest),
    UNIQUE (id,product_profile)
);
CREATE INDEX IF NOT EXISTS idx_catalog_snapshots_profile_latest
    ON leadgen.product_profile_catalog_snapshots (product_profile,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.prospect_category_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    source_url text NOT NULL CHECK (source_url ~ '^https?://'),
    source_type text NOT NULL,
    source_authority text NOT NULL CHECK (source_authority IN ('OFFICIAL','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT','APPROVED_PROVIDER','REGISTRY','INDUSTRY_SOURCE','SEARCH_DISCOVERY','OTHER_PUBLIC')),
    page_title text,
    captured_at timestamptz NOT NULL,
    published_at timestamptz,
    evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9A-Fa-f]{64}$'),
    content_fetched boolean NOT NULL DEFAULT true,
    fetch_status text NOT NULL DEFAULT 'FETCHED' CHECK (fetch_status IN ('FETCHED','PARTIAL','NOT_FETCHED','FAILED','BLOCKED')),
    verification_status text NOT NULL DEFAULT 'REVIEW' CHECK (verification_status IN ('VERIFIED','REVIEW','REJECTED')),
    data_classification text NOT NULL DEFAULT 'PUBLIC_WEB' CHECK (data_classification='PUBLIC_WEB'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (research_job_id,company_id,evidence_hash),
    UNIQUE (id,research_job_id,company_id),
    CHECK (source_authority <> 'SEARCH_DISCOVERY' OR (content_fetched=false AND verification_status <> 'VERIFIED'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_category_sources_company
    ON leadgen.prospect_category_sources (company_id,captured_at DESC,verification_status);

CREATE TABLE IF NOT EXISTS leadgen.prospect_category_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL,
    company_id uuid NOT NULL,
    source_id uuid NOT NULL,
    observation_type text NOT NULL CHECK (observation_type IN ('PRODUCT_CATEGORY','PRODUCT_ITEM','RETAIL_CHANNEL','STORE_NETWORK','IMPORT_ACTIVITY','WHOLESALE_ACTIVITY','DISTRIBUTION_NETWORK','WAREHOUSE_INVENTORY','THIRD_PARTY_BRAND_PORTFOLIO','BUYING_DEPARTMENT','INTERMEDIARY_EXCLUSION')),
    raw_category text,
    raw_product_name text,
    raw_brand_or_department text,
    normalized_profile text NOT NULL DEFAULT 'UNKNOWN' CHECK (normalized_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    normalized_category text,
    normalized_subcategory text,
    business_activity_role text NOT NULL DEFAULT 'UNKNOWN' CHECK (business_activity_role IN ('OWN_RETAIL','PROCUREMENT','IMPORT','WHOLESALE','DISTRIBUTION','WAREHOUSE','BUYING','EXCLUSION','UNKNOWN')),
    evidence_text text NOT NULL CHECK (btrim(evidence_text) <> ''),
    source_authority text NOT NULL,
    verification_status text NOT NULL DEFAULT 'REVIEW' CHECK (verification_status IN ('VERIFIED','REVIEW','REJECTED')),
    captured_at timestamptz NOT NULL,
    published_at timestamptz,
    evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9A-Fa-f]{64}$'),
    extraction_version text NOT NULL,
    data_classification text NOT NULL DEFAULT 'PUBLIC_WEB' CHECK (data_classification='PUBLIC_WEB'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (source_id,research_job_id,company_id)
        REFERENCES leadgen.prospect_category_sources(id,research_job_id,company_id) ON DELETE RESTRICT,
    CHECK (verification_status <> 'VERIFIED' OR source_authority <> 'SEARCH_DISCOVERY'),
    UNIQUE (source_id,evidence_hash),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_prospect_category_observations_match
    ON leadgen.prospect_category_observations (company_id,normalized_profile,observation_type,verification_status,captured_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.buyer_business_model_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    buyer_model text NOT NULL CHECK (buyer_model IN ('DIRECT_END_BUYER','DISTRIBUTION_BUYER','UNCLEAR_INTERMEDIARY','EXCLUDED_INTERMEDIARY','UNKNOWN')),
    buyer_subtype text NOT NULL CHECK (buyer_subtype IN ('CHAIN_RETAILER','DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET','LIFESTYLE_RETAILER','ORGANIZED_ECOM_RETAILER','IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING','SOURCING_AGENT','BROKER','OEM_ONLY','OTHER')),
    eligibility_status text NOT NULL CHECK (eligibility_status IN ('ELIGIBLE','NEEDS_EVIDENCE','INELIGIBLE')),
    priority_tier text NOT NULL CHECK (priority_tier IN ('P1_DIRECT','P2_DISTRIBUTION','REVIEW','EXCLUDED')),
    confidence_band text NOT NULL CHECK (confidence_band IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
    reason_codes text[] NOT NULL DEFAULT '{}',
    evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    calculation_version text NOT NULL,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    execution_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id,execution_key),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_buyer_business_model_latest
    ON leadgen.buyer_business_model_results (company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.buyer_business_model_evidence (
    buyer_business_model_result_id uuid NOT NULL,
    company_id uuid NOT NULL,
    prospect_category_observation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (buyer_business_model_result_id,company_id)
        REFERENCES leadgen.buyer_business_model_results(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY (prospect_category_observation_id,company_id)
        REFERENCES leadgen.prospect_category_observations(id,company_id) ON DELETE RESTRICT,
    PRIMARY KEY (buyer_business_model_result_id,prospect_category_observation_id)
);

CREATE TABLE IF NOT EXISTS leadgen.category_procurement_match_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    buyer_business_model_result_id uuid NOT NULL,
    product_profile_catalog_snapshot_id uuid NOT NULL,
    score integer CHECK (score BETWEEN 0 AND 100),
    band text NOT NULL CHECK (band IN ('VERY_HIGH','HIGH','MEDIUM','LOW','VERY_LOW','UNKNOWN')),
    match_status text NOT NULL CHECK (match_status IN ('CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','WEAK_CATEGORY_MATCH','PRODUCT_MISMATCH','NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE','INELIGIBLE_BUYER_MODEL')),
    coverage_percent integer NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
    calculation_version text NOT NULL,
    taxonomy_version text NOT NULL,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    execution_key text NOT NULL,
    reason_codes text[] NOT NULL DEFAULT '{}',
    missing_evidence text[] NOT NULL DEFAULT '{}',
    observed_categories text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (buyer_business_model_result_id,company_id)
        REFERENCES leadgen.buyer_business_model_results(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_profile_catalog_snapshot_id,product_profile)
        REFERENCES leadgen.product_profile_catalog_snapshots(id,product_profile) ON DELETE RESTRICT,
    CHECK ((score IS NULL AND band='UNKNOWN') OR (score IS NOT NULL AND band<>'UNKNOWN' AND coverage_percent>=70)),
    CHECK (match_status <> 'CATEGORY_PROCUREMENT_MATCH' OR (score >= 60 AND coverage_percent >= 70)),
    UNIQUE (company_id,product_profile,execution_key),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_category_procurement_match_latest
    ON leadgen.category_procurement_match_results (company_id,product_profile,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_category_procurement_opportunity_sort
    ON leadgen.category_procurement_match_results (match_status,band,score DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.category_procurement_match_dimensions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_procurement_match_result_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dimension text NOT NULL CHECK (dimension IN ('TARGET_CATEGORY_PROCUREMENT_EVIDENCE','BUYER_BUSINESS_MODEL_FIT','ASSORTMENT_DEPTH','EXTERNAL_SOURCING_IMPORT','RECENT_CATEGORY_ACTIVITY')),
    state text NOT NULL CHECK (state IN ('OBSERVED','UNKNOWN','NOT_APPLICABLE')),
    points integer,
    maximum integer NOT NULL CHECK (maximum IN (45,25,15,10,5)),
    reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category_procurement_match_result_id,company_id)
        REFERENCES leadgen.category_procurement_match_results(id,company_id) ON DELETE CASCADE,
    CHECK ((state='OBSERVED' AND points BETWEEN 0 AND maximum) OR (state<>'OBSERVED' AND points IS NULL)),
    UNIQUE (category_procurement_match_result_id,dimension),
    UNIQUE (id,company_id)
);

CREATE TABLE IF NOT EXISTS leadgen.category_procurement_match_evidence (
    category_procurement_match_dimension_id uuid NOT NULL,
    company_id uuid NOT NULL,
    prospect_category_observation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category_procurement_match_dimension_id,company_id)
        REFERENCES leadgen.category_procurement_match_dimensions(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY (prospect_category_observation_id,company_id)
        REFERENCES leadgen.prospect_category_observations(id,company_id) ON DELETE RESTRICT,
    PRIMARY KEY (category_procurement_match_dimension_id,prospect_category_observation_id)
);

CREATE TABLE IF NOT EXISTS leadgen.product_opportunity_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    category_procurement_match_result_id uuid NOT NULL,
    recommendation_status text NOT NULL CHECK (recommendation_status IN ('READY','PARTIAL_INTERNAL_CATALOG','NO_REAL_CANDIDATE','NOT_RUN_GATE_FAILED')),
    candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 0 AND 20),
    reason_codes text[] NOT NULL DEFAULT '{}',
    missing_catalog_evidence text[] NOT NULL DEFAULT '{}',
    calculation_version text NOT NULL,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    execution_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category_procurement_match_result_id,company_id)
        REFERENCES leadgen.category_procurement_match_results(id,company_id) ON DELETE RESTRICT,
    CHECK (recommendation_status <> 'NOT_RUN_GATE_FAILED' OR candidate_count=0),
    CHECK (recommendation_status <> 'NO_REAL_CANDIDATE' OR candidate_count=0),
    UNIQUE (company_id,product_profile,execution_key),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_product_opportunity_latest
    ON leadgen.product_opportunity_results (company_id,product_profile,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.product_opportunity_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_opportunity_result_id uuid NOT NULL REFERENCES leadgen.product_opportunity_results(id) ON DELETE CASCADE,
    product_master_id uuid NOT NULL REFERENCES leadgen.product_master(id) ON DELETE RESTRICT,
    rank integer NOT NULL CHECK (rank BETWEEN 1 AND 20),
    safe_product_name text,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    normalized_category text NOT NULL,
    normalized_subcategory text,
    catalog_status text NOT NULL CHECK (catalog_status IN ('CURRENT_CONFIRMED','HISTORICAL_ORDER_SUPPORTED','REFERENCE_ONLY')),
    reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_opportunity_result_id,product_master_id),
    UNIQUE (product_opportunity_result_id,rank)
);

CREATE TABLE IF NOT EXISTS leadgen.product_opportunity_gaps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_opportunity_result_id uuid NOT NULL REFERENCES leadgen.product_opportunity_results(id) ON DELETE CASCADE,
    gap_type text NOT NULL,
    gap_status text NOT NULL CHECK (gap_status IN ('CONFIRMED_GAP','POSSIBLE_GAP','UNKNOWN')),
    reason text NOT NULL,
    reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_opportunity_result_id,gap_type),
    UNIQUE (id,product_opportunity_result_id)
);

CREATE TABLE IF NOT EXISTS leadgen.product_opportunity_gap_evidence (
    product_opportunity_gap_id uuid NOT NULL,
    product_opportunity_result_id uuid NOT NULL,
    prospect_category_observation_id uuid NOT NULL REFERENCES leadgen.prospect_category_observations(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (product_opportunity_gap_id,product_opportunity_result_id)
        REFERENCES leadgen.product_opportunity_gaps(id,product_opportunity_result_id) ON DELETE CASCADE,
    PRIMARY KEY (product_opportunity_gap_id,prospect_category_observation_id)
);

ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS category_profiles_attempted integer NOT NULL DEFAULT 0 CHECK (category_profiles_attempted >= 0),
    ADD COLUMN IF NOT EXISTS category_sources_found integer NOT NULL DEFAULT 0 CHECK (category_sources_found >= 0),
    ADD COLUMN IF NOT EXISTS category_observations_found integer NOT NULL DEFAULT 0 CHECK (category_observations_found >= 0),
    ADD COLUMN IF NOT EXISTS buyer_models_classified integer NOT NULL DEFAULT 0 CHECK (buyer_models_classified >= 0),
    ADD COLUMN IF NOT EXISTS category_matches_passed integer NOT NULL DEFAULT 0 CHECK (category_matches_passed >= 0),
    ADD COLUMN IF NOT EXISTS category_matches_unknown integer NOT NULL DEFAULT 0 CHECK (category_matches_unknown >= 0),
    ADD COLUMN IF NOT EXISTS product_opportunities_found integer NOT NULL DEFAULT 0 CHECK (product_opportunities_found >= 0),
    ADD COLUMN IF NOT EXISTS category_procurement_errors integer NOT NULL DEFAULT 0 CHECK (category_procurement_errors >= 0);

ALTER TABLE leadgen.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_job_type_check;
ALTER TABLE leadgen.research_jobs ADD CONSTRAINT research_jobs_job_type_check
    CHECK (job_type IN ('COMPANY_DISCOVERY','DECISION_MAKER_ENRICHMENT','CATEGORY_PROCUREMENT_ENRICHMENT'));

ALTER TABLE leadgen.research_search_queries DROP CONSTRAINT IF EXISTS research_search_queries_query_type_check;
ALTER TABLE leadgen.research_search_queries ADD CONSTRAINT research_search_queries_query_type_check CHECK (query_type IN (
    'buyer_category','general_trading','domain_targeted','market_wide','sme_regional','social_business','strategic_account',
    'decision_maker_role','procurement_route','supplier_access','barrier_evidence','linkedin_reference',
    'category_assortment','retail_channel','store_network','import_activity','wholesale_activity','distribution_network','inventory_warehouse','intermediary_exclusion'
));

ALTER TABLE leadgen.cooperation_feasibility_results
    ADD COLUMN IF NOT EXISTS category_procurement_match_result_id uuid REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS cooperation_calculation_version text,
    ADD COLUMN IF NOT EXISTS supplier_access_score integer CHECK (supplier_access_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS supplier_access_band text,
    ADD COLUMN IF NOT EXISTS supplier_access_coverage integer CHECK (supplier_access_coverage BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS product_access_matrix text,
    ADD COLUMN IF NOT EXISTS readiness_blockers text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS execution_key text;

ALTER TABLE leadgen.cooperation_feasibility_results
    DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_supplier_access_band_check,
    DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_product_access_matrix_check,
    DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_opportunity_readiness_check,
    DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_phase61_v3_contract_check;
ALTER TABLE leadgen.cooperation_feasibility_results
    ADD CONSTRAINT cooperation_feasibility_results_supplier_access_band_check CHECK (supplier_access_band IS NULL OR supplier_access_band IN ('HIGH','MEDIUM','LOW_MEDIUM','LOW','UNKNOWN')),
    ADD CONSTRAINT cooperation_feasibility_results_product_access_matrix_check CHECK (product_access_matrix IS NULL OR product_access_matrix IN ('DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS','DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS','DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS','DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS','MEDIUM_PRODUCT_HIGH_ACCESS','MEDIUM_PRODUCT_MEDIUM_ACCESS','LOW_PRODUCT','UNKNOWN_PRODUCT','INELIGIBLE_BUYER_MODEL')),
    ADD CONSTRAINT cooperation_feasibility_results_opportunity_readiness_check CHECK (opportunity_readiness IN ('SALES_READY','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION','HISTORICAL_REVIEW','EXISTING_CUSTOMER','SUPPRESSED','REVIEW','STRATEGIC_LONG_SHOT','INELIGIBLE_BUYER_MODEL','NEEDS_INTERNAL_CATALOG_EVIDENCE','NEEDS_PRODUCT_EVIDENCE','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','PRODUCT_MISMATCH','WEAK_CATEGORY_MATCH')),
    ADD CONSTRAINT cooperation_feasibility_results_phase61_v3_contract_check CHECK (cooperation_calculation_version IS NULL OR cooperation_calculation_version NOT LIKE 'cooperation-feasibility-v3%' OR (category_procurement_match_result_id IS NOT NULL AND supplier_access_band IS NOT NULL AND supplier_access_coverage IS NOT NULL AND product_access_matrix IS NOT NULL AND execution_key IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_cooperation_feasibility_category_match_once
    ON leadgen.cooperation_feasibility_results (category_procurement_match_result_id)
    WHERE category_procurement_match_result_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cooperation_feasibility_v3_execution_once
    ON leadgen.cooperation_feasibility_results (company_id,product_profile,execution_key)
    WHERE category_procurement_match_result_id IS NOT NULL AND execution_key IS NOT NULL;

COMMENT ON TABLE leadgen.product_profile_catalog_snapshots IS
    'Aggregate, versioned profile availability derived from real product_master rows; contains no product prices.';
COMMENT ON TABLE leadgen.category_procurement_match_results IS
    'Append-only Phase 6.1 V3 category procurement match. It is independent of Supplier Access and customer-match scores.';
COMMENT ON TABLE leadgen.product_opportunity_candidates IS
    'Secondary recommendation layer; every candidate references a real product_master row and excludes commercial price fields.';
COMMENT ON COLUMN leadgen.cooperation_feasibility_results.product_access_matrix IS
    'Phase 6.1 V3 matrix; does not redefine historical access_opportunity_matrix or Customer Match opportunity_matrix.';

COMMIT;
