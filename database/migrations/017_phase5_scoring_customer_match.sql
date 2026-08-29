BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS leadgen.rule_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key text NOT NULL,
    rule_version text NOT NULL,
    engine text NOT NULL DEFAULT 'GORULES_ZEN',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
    effective_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rule_key, rule_version)
);

CREATE TABLE IF NOT EXISTS leadgen.company_facts_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id),
    research_job_id uuid REFERENCES leadgen.research_jobs(id),
    schema_version text NOT NULL,
    facts jsonb NOT NULL,
    evidence_ids uuid[] NOT NULL DEFAULT '{}',
    evidence_coverage numeric(5,2) NOT NULL
        CHECK (evidence_coverage BETWEEN 0 AND 100),
    source_digest text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.company_score_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id),
    research_job_id uuid REFERENCES leadgen.research_jobs(id),
    execution_key text,
    final_score integer NOT NULL CHECK (final_score BETWEEN 0 AND 100),
    tier char(1) NOT NULL CHECK (tier IN ('A','B','C')),
    qualification_status text NOT NULL
        CHECK (qualification_status IN ('QUALIFIED','REVIEW','REJECTED')),
    score_eligibility text NOT NULL
        CHECK (score_eligibility IN ('ELIGIBLE','PARTIAL_EVIDENCE','INSUFFICIENT_EVIDENCE')),
    evidence_coverage numeric(5,2) NOT NULL
        CHECK (evidence_coverage BETWEEN 0 AND 100),
    dimension_scores jsonb NOT NULL,
    reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    fired_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    rule_version text NOT NULL,
    facts_snapshot_id uuid NOT NULL REFERENCES leadgen.company_facts_snapshots(id),
    evidence_ids uuid[] NOT NULL DEFAULT '{}',
    trace jsonb NOT NULL DEFAULT '{}'::jsonb,
    calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.reference_data_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_type text NOT NULL CHECK (import_type IN (
        'HISTORICAL_CUSTOMERS','HISTORICAL_ORDERS',
        'HISTORICAL_LEAD_OUTCOMES','HISTORICAL_CUSTOMER_CHANNELS'
    )),
    source_filename text NOT NULL,
    content_sha256 text NOT NULL,
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    status text NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED','VALIDATED','VALIDATION_FAILED','COMMITTING','COMMITTED','FAILED')),
    row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
    duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
    error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    validated_at timestamptz,
    committed_at timestamptz,
    created_by text,
    UNIQUE (import_type, content_sha256)
);

CREATE TABLE IF NOT EXISTS leadgen.reference_data_import_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE CASCADE,
    row_number integer NOT NULL CHECK (row_number >= 2),
    raw_payload jsonb NOT NULL,
    normalized_payload jsonb,
    duplicate_key text,
    row_status text NOT NULL
        CHECK (row_status IN ('ACCEPTED','REJECTED','DUPLICATE','COMMITTED')),
    error_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (import_id, row_number)
);

CREATE TABLE IF NOT EXISTS leadgen.historical_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id),
    source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id),
    external_customer_id text NOT NULL,
    source_system text NOT NULL DEFAULT 'REFERENCE_IMPORT',
    company_name text NOT NULL,
    normalized_company_name text NOT NULL,
    country_code char(2) NOT NULL,
    buyer_type text,
    company_size text,
    address text,
    website_domain text,
    first_order_date date,
    last_order_date date,
    repeat_order_count integer CHECK (repeat_order_count IS NULL OR repeat_order_count >= 0),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_system, external_customer_id)
);

CREATE TABLE IF NOT EXISTS leadgen.historical_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id),
    source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id),
    external_order_id text NOT NULL,
    external_customer_id text NOT NULL,
    source_system text NOT NULL DEFAULT 'REFERENCE_IMPORT',
    order_date date NOT NULL,
    sku text,
    product_category text,
    quantity numeric(14,2) CHECK (quantity IS NULL OR quantity >= 0),
    moq numeric(14,2) CHECK (moq IS NULL OR moq >= 0),
    revenue numeric(16,2) CHECK (revenue IS NULL OR revenue >= 0),
    currency char(3),
    incoterm text,
    lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_system, external_order_id)
);

CREATE TABLE IF NOT EXISTS leadgen.historical_lead_outcomes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id),
    source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id),
    external_lead_id text NOT NULL,
    source_system text NOT NULL DEFAULT 'REFERENCE_IMPORT',
    company_name text NOT NULL,
    country_code char(2) NOT NULL,
    source text,
    qualification text,
    contactability text,
    outreach_status text,
    reply_status text,
    quotation_status text,
    outcome text NOT NULL CHECK (outcome IN ('WIN','LOSS','OPEN','UNKNOWN')),
    loss_reason text,
    sales_cycle_days integer CHECK (sales_cycle_days IS NULL OR sales_cycle_days >= 0),
    outcome_date date,
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_system, external_lead_id)
);

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id),
    source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id),
    external_customer_id text NOT NULL,
    channel_type text NOT NULL,
    channel_name text,
    market_code char(2),
    source_system text NOT NULL DEFAULT 'REFERENCE_IMPORT',
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_system, external_customer_id, channel_type, channel_name)
);

CREATE TABLE IF NOT EXISTS leadgen.icp_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    profile_type text NOT NULL
        CHECK (profile_type IN ('MANAGEMENT_BASELINE','HISTORICAL_CUSTOMER_ICP')),
    version text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
    market_scope text[] NOT NULL DEFAULT '{}',
    product_scope text[] NOT NULL DEFAULT '{}',
    source_import_ids uuid[] NOT NULL DEFAULT '{}',
    sample_size_wins integer NOT NULL DEFAULT 0 CHECK (sample_size_wins >= 0),
    sample_size_losses integer NOT NULL DEFAULT 0 CHECK (sample_size_losses >= 0),
    sample_size_orders integer NOT NULL DEFAULT 0 CHECK (sample_size_orders >= 0),
    feature_coverage numeric(5,2) NOT NULL DEFAULT 0
        CHECK (feature_coverage BETWEEN 0 AND 100),
    calculation_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    retired_at timestamptz,
    UNIQUE (profile_type, version, market_scope, product_scope)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_icp_one_active_per_scope_type
    ON leadgen.icp_profiles (profile_type, market_scope, product_scope)
    WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS leadgen.icp_profile_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES leadgen.icp_profiles(id) ON DELETE CASCADE,
    feature_key text NOT NULL,
    feature_value jsonb NOT NULL,
    coverage numeric(5,2) NOT NULL CHECK (coverage BETWEEN 0 AND 100),
    sample_size integer NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
    calculation_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, feature_key)
);

CREATE TABLE IF NOT EXISTS leadgen.customer_match_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id),
    research_job_id uuid REFERENCES leadgen.research_jobs(id),
    execution_key text,
    reference_profile_id uuid NOT NULL REFERENCES leadgen.icp_profiles(id),
    reference_profile_type text NOT NULL
        CHECK (reference_profile_type IN ('MANAGEMENT_BASELINE','HISTORICAL_CUSTOMER_ICP')),
    profile_version text NOT NULL,
    match_score integer CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
    coverage_percent numeric(5,2) NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
    display_status text NOT NULL CHECK (display_status IN (
        'BASELINE_ICP','HISTORICAL_ICP','INSUFFICIENT_PROFILE_DATA'
    )),
    opportunity_matrix text NOT NULL CHECK (opportunity_matrix IN (
        'PRIORITY_OPPORTUNITY','STRATEGIC_MANUAL_REVIEW','EVIDENCE_GAP_REVIEW','LOWER_PRIORITY'
    )),
    dimension_scores jsonb NOT NULL,
    reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_ids uuid[] NOT NULL DEFAULT '{}',
    trace jsonb NOT NULL DEFAULT '{}'::jsonb,
    calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.phase5_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL CHECK (event_type IN (
        'REFERENCE_IMPORT_VALIDATED','REFERENCE_IMPORT_COMMITTED','ICP_PROFILE_CREATED',
        'ICP_PROFILE_ACTIVATED','RULE_VERSION_ACTIVATED','BATCH_RESCORE','BATCH_REMATCH'
    )),
    entity_type text NOT NULL,
    entity_id uuid,
    actor text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_facts_history
    ON leadgen.company_facts_snapshots (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_score_history
    ON leadgen.company_score_runs (company_id, calculated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_score_execution_once
    ON leadgen.company_score_runs (company_id, execution_key)
    WHERE execution_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_match_history
    ON leadgen.customer_match_results (company_id, calculated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_match_execution_once
    ON leadgen.customer_match_results (company_id, execution_key)
    WHERE execution_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reference_import_rows_status
    ON leadgen.reference_data_import_rows (import_id, row_status, row_number);
CREATE INDEX IF NOT EXISTS idx_historical_orders_customer_date
    ON leadgen.historical_orders (external_customer_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_outcomes_country_outcome
    ON leadgen.historical_lead_outcomes (country_code, outcome);

CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
    ON leadgen.companies USING gin (lower(company_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_verification_address_trgm
    ON leadgen.research_candidate_verifications USING gin (lower(address) gin_trgm_ops)
    WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_historical_customers_name_trgm
    ON leadgen.historical_customers USING gin (lower(company_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_historical_customers_address_trgm
    ON leadgen.historical_customers USING gin (lower(address) gin_trgm_ops)
    WHERE address IS NOT NULL;

CREATE OR REPLACE FUNCTION leadgen.recall_company_name_candidates(
    p_company_name text,
    p_country_code char(2),
    p_limit integer DEFAULT 20,
    p_threshold real DEFAULT 0.35
)
RETURNS TABLE (company_id uuid, company_name text, country_code char(2), similarity_score real)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.company_name, c.country_code,
           similarity(lower(c.company_name), lower(p_company_name))::real
    FROM leadgen.companies c
    WHERE p_company_name IS NOT NULL
      AND p_country_code IS NOT NULL
      AND c.country_code = upper(p_country_code)
      AND similarity(lower(c.company_name), lower(p_company_name)) >= greatest(0.20, least(0.90, p_threshold))
    ORDER BY similarity(lower(c.company_name), lower(p_company_name)) DESC, c.company_name
    LIMIT greatest(1, least(100, p_limit));
$$;

CREATE OR REPLACE FUNCTION leadgen.recall_historical_customer_candidates(
    p_company_name text,
    p_country_code char(2),
    p_limit integer DEFAULT 20,
    p_threshold real DEFAULT 0.35
)
RETURNS TABLE (historical_customer_id uuid, company_name text, country_code char(2), similarity_score real)
LANGUAGE sql STABLE AS $$
    SELECT h.id, h.company_name, h.country_code,
           similarity(lower(h.company_name), lower(p_company_name))::real
    FROM leadgen.historical_customers h
    WHERE p_company_name IS NOT NULL
      AND p_country_code IS NOT NULL
      AND h.country_code = upper(p_country_code)
      AND similarity(lower(h.company_name), lower(p_company_name)) >= greatest(0.20, least(0.90, p_threshold))
    ORDER BY similarity(lower(h.company_name), lower(p_company_name)) DESC, h.company_name
    LIMIT greatest(1, least(100, p_limit));
$$;

CREATE OR REPLACE FUNCTION leadgen.prevent_phase5_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a new version/run instead', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_facts_immutable ON leadgen.company_facts_snapshots;
CREATE TRIGGER trg_company_facts_immutable
    BEFORE UPDATE OR DELETE ON leadgen.company_facts_snapshots
    FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase5_history_mutation();

DROP TRIGGER IF EXISTS trg_company_score_runs_immutable ON leadgen.company_score_runs;
CREATE TRIGGER trg_company_score_runs_immutable
    BEFORE UPDATE OR DELETE ON leadgen.company_score_runs
    FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase5_history_mutation();

DROP TRIGGER IF EXISTS trg_customer_match_results_immutable ON leadgen.customer_match_results;
CREATE TRIGGER trg_customer_match_results_immutable
    BEFORE UPDATE OR DELETE ON leadgen.customer_match_results
    FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase5_history_mutation();

INSERT INTO leadgen.rule_versions (rule_key, rule_version, metadata)
VALUES
    ('dpv-score','dpv-score-v1','{"total":100,"tier_thresholds":{"A":75,"B":55,"C":0}}'::jsonb),
    ('qualification','qualification-v1','{"eligible_min_coverage":60,"partial_min_coverage":25}'::jsonb),
    ('customer-match','baseline-v1','{"historical_numeric_min_coverage":60}'::jsonb)
ON CONFLICT (rule_key, rule_version) DO NOTHING;

INSERT INTO leadgen.icp_profiles (
    id,name,profile_type,version,status,market_scope,product_scope,
    feature_coverage,calculation_version,activated_at
)
VALUES (
    '00000000-0000-5000-8000-000000000001',
    'DPV Management Baseline ICP','MANAGEMENT_BASELINE','baseline-v1','ACTIVE',
    ARRAY['AE','BD','GENERIC'],
    ARRAY['WOMENSWEAR'],75,'baseline-calculation-v1',now()
)
ON CONFLICT (profile_type, version, market_scope, product_scope) DO NOTHING;

INSERT INTO leadgen.icp_profile_features (
    profile_id,feature_key,feature_value,coverage,sample_size,calculation_version
)
VALUES
    ('00000000-0000-5000-8000-000000000001','buyer_types',
     '{"values":["IMPORTER","WHOLESALER","DISTRIBUTOR","GENERAL_TRADING"]}',100,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','product_categories',
     '{"values":["WOMENSWEAR","DRESSES","TOPS","SKIRTS","TROUSERS","OUTERWEAR","KNITWEAR"]}',100,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','markets',
     '{"values":["AE","BD","GENERIC"]}',100,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','company_sizes',
     '{"values":["MICRO","SMALL","MEDIUM"]}',100,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','distribution_patterns',
     '{"values":["REGIONAL_DISTRIBUTION","WHOLESALE_NETWORK","MULTI_STORE","B2B_SUPPLY"]}',100,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','commercial_moq',
     '{"status":"NOT_CONFIGURED"}',0,0,'baseline-calculation-v1'),
    ('00000000-0000-5000-8000-000000000001','historical_win_similarity',
     '{"status":"HISTORICAL_DATA_PENDING"}',0,0,'baseline-calculation-v1')
ON CONFLICT (profile_id, feature_key) DO NOTHING;

COMMIT;
