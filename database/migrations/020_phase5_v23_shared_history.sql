BEGIN;

-- Phase 5 V2.3 keeps shared-folder provenance in internal-only tables.  UNC
-- paths are deliberately isolated here and must never be projected by public
-- company, evidence, opportunity or export APIs.
CREATE TABLE IF NOT EXISTS leadgen.reference_data_import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'DISCOVERED'
        CHECK (status IN (
            'DISCOVERED','STAGED','PARSED','VALIDATED','DRY_RUN_PASSED',
            'IMPORTED','PARTIAL','FAILED'
        )),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    source_file_count integer NOT NULL DEFAULT 0 CHECK (source_file_count >= 0),
    customer_count integer NOT NULL DEFAULT 0 CHECK (customer_count >= 0),
    order_count integer NOT NULL DEFAULT 0 CHECK (order_count >= 0),
    product_count integer NOT NULL DEFAULT 0 CHECK (product_count >= 0),
    followup_count integer NOT NULL DEFAULT 0 CHECK (followup_count >= 0),
    error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    safety_summary jsonb NOT NULL DEFAULT jsonb_build_object(
        'source_files_modified',0,
        'source_files_deleted',0,
        'source_files_renamed',0,
        'source_files_moved',0,
        'files_created_inside_share',0
    ),
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    imported_at timestamptz
);

CREATE TABLE IF NOT EXISTS leadgen.reference_data_source_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id uuid NOT NULL
        REFERENCES leadgen.reference_data_import_batches(id) ON DELETE RESTRICT,
    source_unc_path text NOT NULL,
    source_filename text NOT NULL,
    source_last_modified timestamptz,
    source_size bigint NOT NULL CHECK (source_size >= 0),
    source_sha256 text NOT NULL
        CHECK (source_sha256 ~ '^[0-9A-Fa-f]{64}$'),
    local_staging_path text,
    local_sha256 text
        CHECK (local_sha256 IS NULL OR local_sha256 ~ '^[0-9A-Fa-f]{64}$'),
    source_sha256_after text
        CHECK (source_sha256_after IS NULL OR source_sha256_after ~ '^[0-9A-Fa-f]{64}$'),
    copied_at timestamptz,
    hash_verified boolean NOT NULL DEFAULT false,
    source_file_status text NOT NULL DEFAULT 'DISCOVERED'
        CHECK (source_file_status IN (
            'DISCOVERED','STAGED','PARSED','SKIPPED','NEEDS_PASSWORD_OWNER','FAILED'
        )),
    file_class text,
    product_profile text
        CHECK (product_profile IS NULL OR product_profile IN (
            'WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN'
        )),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        NOT hash_verified OR (
            local_sha256 IS NOT NULL
            AND source_sha256_after IS NOT NULL
            AND lower(source_sha256) = lower(local_sha256)
            AND lower(source_sha256) = lower(source_sha256_after)
        )
    ),
    UNIQUE (id, import_batch_id)
);

COMMENT ON COLUMN leadgen.reference_data_source_files.source_unc_path IS
    'INTERNAL ONLY. Never emit through public evidence, prospect, opportunity or export APIs.';
COMMENT ON COLUMN leadgen.reference_data_source_files.local_staging_path IS
    'INTERNAL ONLY. Project-local Git-ignored staging path; never a public evidence URL.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_source_file_version
    ON leadgen.reference_data_source_files
    (import_batch_id, lower(source_unc_path), lower(source_sha256));
CREATE INDEX IF NOT EXISTS idx_reference_source_files_batch_status
    ON leadgen.reference_data_source_files (import_batch_id, source_file_status);

ALTER TABLE leadgen.reference_data_imports
    ADD COLUMN IF NOT EXISTS import_batch_id uuid,
    ADD COLUMN IF NOT EXISTS source_file_id uuid,
    ADD COLUMN IF NOT EXISTS import_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS supersedes_import_id uuid;

ALTER TABLE leadgen.reference_data_imports
    DROP CONSTRAINT IF EXISTS reference_data_imports_import_batch_id_fkey,
    DROP CONSTRAINT IF EXISTS reference_data_imports_source_file_batch_fkey,
    DROP CONSTRAINT IF EXISTS reference_data_imports_supersedes_import_id_fkey,
    DROP CONSTRAINT IF EXISTS reference_data_imports_batch_source_pair_check,
    DROP CONSTRAINT IF EXISTS reference_data_imports_import_version_check,
    DROP CONSTRAINT IF EXISTS reference_data_imports_not_self_superseded_check,
    DROP CONSTRAINT IF EXISTS reference_data_imports_import_type_check;

ALTER TABLE leadgen.reference_data_imports
    ADD CONSTRAINT reference_data_imports_import_batch_id_fkey
        FOREIGN KEY (import_batch_id)
        REFERENCES leadgen.reference_data_import_batches(id) ON DELETE RESTRICT,
    ADD CONSTRAINT reference_data_imports_source_file_batch_fkey
        FOREIGN KEY (source_file_id, import_batch_id)
        REFERENCES leadgen.reference_data_source_files(id, import_batch_id) ON DELETE RESTRICT,
    ADD CONSTRAINT reference_data_imports_supersedes_import_id_fkey
        FOREIGN KEY (supersedes_import_id)
        REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    ADD CONSTRAINT reference_data_imports_batch_source_pair_check
        CHECK ((import_batch_id IS NULL) = (source_file_id IS NULL)),
    ADD CONSTRAINT reference_data_imports_import_version_check
        CHECK (import_version >= 1),
    ADD CONSTRAINT reference_data_imports_not_self_superseded_check
        CHECK (supersedes_import_id IS NULL OR supersedes_import_id <> id),
    ADD CONSTRAINT reference_data_imports_import_type_check
        CHECK (import_type IN (
            'HISTORICAL_CUSTOMERS','HISTORICAL_ORDERS',
            'HISTORICAL_LEAD_OUTCOMES','HISTORICAL_CUSTOMER_CHANNELS',
            'CUSTOMER_ALIASES','PRODUCT_MASTER','ORDER_LINES'
        ));

CREATE INDEX IF NOT EXISTS idx_reference_imports_batch_status
    ON leadgen.reference_data_imports (import_batch_id, status, uploaded_at);

ALTER TABLE leadgen.reference_data_import_rows
    ADD COLUMN IF NOT EXISTS source_sheet text,
    ADD COLUMN IF NOT EXISTS source_row integer,
    ADD COLUMN IF NOT EXISTS source_hash text,
    ADD COLUMN IF NOT EXISTS source_identity_key text,
    ADD COLUMN IF NOT EXISTS captured_at timestamptz,
    ADD COLUMN IF NOT EXISTS canonical_entity_type text,
    ADD COLUMN IF NOT EXISTS canonical_entity_id uuid,
    ADD COLUMN IF NOT EXISTS supersedes_import_row_id uuid;

ALTER TABLE leadgen.reference_data_import_rows
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_row_status_check,
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_source_row_check,
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_source_hash_check,
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_source_identity_key_check,
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_supersedes_import_row_id_fkey,
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_not_self_superseded_check;

ALTER TABLE leadgen.reference_data_import_rows
    ADD CONSTRAINT reference_data_import_rows_row_status_check
        CHECK (row_status IN ('ACCEPTED','REVIEW','REJECTED','DUPLICATE','COMMITTED')),
    ADD CONSTRAINT reference_data_import_rows_source_row_check
        CHECK (source_row IS NULL OR source_row >= 1),
    ADD CONSTRAINT reference_data_import_rows_source_hash_check
        CHECK (source_hash IS NULL OR source_hash ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT reference_data_import_rows_source_identity_key_check
        CHECK (source_identity_key IS NULL OR source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT reference_data_import_rows_supersedes_import_row_id_fkey
        FOREIGN KEY (supersedes_import_row_id)
        REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
    ADD CONSTRAINT reference_data_import_rows_not_self_superseded_check
        CHECK (supersedes_import_row_id IS NULL OR supersedes_import_row_id <> id);

COMMENT ON COLUMN leadgen.reference_data_import_rows.source_identity_key IS
    'SHA-256 of entity type + source file hash + sheet + normalized row key. Container sequence is not a customer or order identity.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_import_row_source_identity
    ON leadgen.reference_data_import_rows (source_identity_key)
    WHERE source_identity_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reference_import_rows_canonical_entity
    ON leadgen.reference_data_import_rows (canonical_entity_type, canonical_entity_id)
    WHERE canonical_entity_id IS NOT NULL;

ALTER TABLE leadgen.historical_customers
    ADD COLUMN IF NOT EXISTS market_code char(2),
    ADD COLUMN IF NOT EXISTS customer_role text NOT NULL DEFAULT 'INTERNAL_EXISTING_CUSTOMER',
    ADD COLUMN IF NOT EXISTS customer_type text,
    ADD COLUMN IF NOT EXISTS channel_type text,
    ADD COLUMN IF NOT EXISTS product_profiles text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS identity_resolution_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS source_identity_key text,
    ADD COLUMN IF NOT EXISTS record_digest text,
    ADD COLUMN IF NOT EXISTS latest_source_import_row_id uuid,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE leadgen.historical_customers
    DROP CONSTRAINT IF EXISTS historical_customers_market_code_check,
    DROP CONSTRAINT IF EXISTS historical_customers_customer_role_check,
    DROP CONSTRAINT IF EXISTS historical_customers_identity_resolution_status_check,
    DROP CONSTRAINT IF EXISTS historical_customers_source_identity_key_check,
    DROP CONSTRAINT IF EXISTS historical_customers_record_digest_check,
    DROP CONSTRAINT IF EXISTS historical_customers_latest_source_import_row_id_fkey;

ALTER TABLE leadgen.historical_customers
    ADD CONSTRAINT historical_customers_market_code_check
        CHECK (market_code IS NULL OR market_code::text ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT historical_customers_customer_role_check
        CHECK (customer_role IN ('INTERNAL_EXISTING_CUSTOMER','REVIEW')),
    ADD CONSTRAINT historical_customers_identity_resolution_status_check
        CHECK (identity_resolution_status IN ('CONFIRMED','REVIEW','UNKNOWN')),
    ADD CONSTRAINT historical_customers_source_identity_key_check
        CHECK (source_identity_key IS NULL OR source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT historical_customers_record_digest_check
        CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT historical_customers_latest_source_import_row_id_fkey
        FOREIGN KEY (latest_source_import_row_id)
        REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_customers_source_identity
    ON leadgen.historical_customers (source_identity_key)
    WHERE source_identity_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_historical_customers_market_role
    ON leadgen.historical_customers (market_code, customer_role, identity_resolution_status);

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    historical_customer_id uuid NOT NULL
        REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
    source_import_id uuid
        REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    source_import_row_id uuid
        REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
    raw_name text NOT NULL CHECK (btrim(raw_name) <> ''),
    normalized_name text NOT NULL CHECK (btrim(normalized_name) <> ''),
    confidence numeric(4,3) NOT NULL DEFAULT 0
        CHECK (confidence BETWEEN 0 AND 1),
    resolution_status text NOT NULL DEFAULT 'REVIEW'
        CHECK (resolution_status IN ('CONFIRMED','REVIEW','REJECTED')),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_customer_alias_identity
    ON leadgen.historical_customer_aliases
    (historical_customer_id, normalized_name, coalesce(source_import_row_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_historical_customer_alias_lookup
    ON leadgen.historical_customer_aliases USING gin (lower(normalized_name) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS leadgen.product_master (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_import_id uuid NOT NULL
        REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    source_import_row_id uuid NOT NULL
        REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
    source_system text NOT NULL DEFAULT 'REFERENCE_IMPORT',
    source_product_id text,
    source_identity_key text NOT NULL UNIQUE
        CHECK (source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
    sku text,
    style_number text,
    model text,
    product_name text,
    product_profile text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    category text,
    material text,
    size_spec text,
    color text,
    moq numeric(14,2) CHECK (moq IS NULL OR moq >= 0),
    customer_sales_price numeric(16,4)
        CHECK (customer_sales_price IS NULL OR customer_sales_price >= 0),
    customer_sales_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (customer_sales_currency = 'UNKNOWN' OR customer_sales_currency ~ '^[A-Z]{3}$'),
    supplier_price numeric(16,4)
        CHECK (supplier_price IS NULL OR supplier_price >= 0),
    supplier_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (supplier_currency = 'UNKNOWN' OR supplier_currency ~ '^[A-Z]{3}$'),
    downstream_retail_price numeric(16,4)
        CHECK (downstream_retail_price IS NULL OR downstream_retail_price >= 0),
    downstream_retail_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (downstream_retail_currency = 'UNKNOWN' OR downstream_retail_currency ~ '^[A-Z]{3}$'),
    unclassified_price numeric(16,4)
        CHECK (unclassified_price IS NULL OR unclassified_price >= 0),
    unclassified_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (unclassified_currency = 'UNKNOWN' OR unclassified_currency ~ '^[A-Z]{3}$'),
    price_type text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (price_type IN (
            'CUSTOMER_SALES_PRICE','SUPPLIER_PRICE','DOWNSTREAM_RETAIL_PRICE',
            'BOTH_EXPLICIT','MULTIPLE_EXPLICIT','UNKNOWN'
        )),
    currency char(3),
    incoterm text,
    sample_status text,
    lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    packing text,
    net_weight numeric(14,3) CHECK (net_weight IS NULL OR net_weight >= 0),
    gross_weight numeric(14,3) CHECK (gross_weight IS NULL OR gross_weight >= 0),
    volume_cbm numeric(14,4) CHECK (volume_cbm IS NULL OR volume_cbm >= 0),
    certification text,
    asset_reference text,
    record_digest text CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$'),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(source_product_id,sku,style_number,model,product_name) > 0),
    CHECK (price_type <> 'CUSTOMER_SALES_PRICE' OR customer_sales_price IS NOT NULL),
    CHECK (price_type <> 'SUPPLIER_PRICE' OR supplier_price IS NOT NULL),
    CHECK (price_type <> 'DOWNSTREAM_RETAIL_PRICE' OR downstream_retail_price IS NOT NULL),
    CHECK (price_type <> 'BOTH_EXPLICIT' OR (customer_sales_price IS NOT NULL AND supplier_price IS NOT NULL)),
    CHECK (price_type <> 'MULTIPLE_EXPLICIT' OR num_nonnulls(
        customer_sales_price,supplier_price,downstream_retail_price
    ) >= 2),
    UNIQUE (source_import_row_id)
);

COMMENT ON COLUMN leadgen.product_master.asset_reference IS
    'INTERNAL ONLY. Source asset reference; never a public evidence URL.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_master_external_identity
    ON leadgen.product_master (source_system, source_product_id)
    WHERE source_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_master_profile_category
    ON leadgen.product_master (product_profile, category);

ALTER TABLE leadgen.historical_orders
    ALTER COLUMN order_date DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS historical_customer_id uuid,
    ADD COLUMN IF NOT EXISTS customer_resolution_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS order_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS delivery_date date,
    ADD COLUMN IF NOT EXISTS order_date_source text,
    ADD COLUMN IF NOT EXISTS unit text,
    ADD COLUMN IF NOT EXISTS unit_price numeric(16,4),
    ADD COLUMN IF NOT EXISTS order_value numeric(16,2),
    ADD COLUMN IF NOT EXISTS commercial_value_type text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS container_sequence text,
    ADD COLUMN IF NOT EXISTS shipment_reference text,
    ADD COLUMN IF NOT EXISTS product_profile text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS source_identity_key text,
    ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS supersedes_historical_order_id uuid,
    ADD COLUMN IF NOT EXISTS record_digest text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE leadgen.historical_orders
    DROP CONSTRAINT IF EXISTS historical_orders_historical_customer_id_fkey,
    DROP CONSTRAINT IF EXISTS historical_orders_source_system_external_order_id_key,
    DROP CONSTRAINT IF EXISTS historical_orders_customer_resolution_status_check,
    DROP CONSTRAINT IF EXISTS historical_orders_order_status_check,
    DROP CONSTRAINT IF EXISTS historical_orders_unit_price_check,
    DROP CONSTRAINT IF EXISTS historical_orders_order_value_check,
    DROP CONSTRAINT IF EXISTS historical_orders_commercial_value_type_check,
    DROP CONSTRAINT IF EXISTS historical_orders_order_value_semantics_check,
    DROP CONSTRAINT IF EXISTS historical_orders_product_profile_check,
    DROP CONSTRAINT IF EXISTS historical_orders_source_identity_key_check,
    DROP CONSTRAINT IF EXISTS historical_orders_source_version_check,
    DROP CONSTRAINT IF EXISTS historical_orders_supersedes_historical_order_id_fkey,
    DROP CONSTRAINT IF EXISTS historical_orders_not_self_superseded_check,
    DROP CONSTRAINT IF EXISTS historical_orders_source_version_contract_check,
    DROP CONSTRAINT IF EXISTS historical_orders_record_digest_check;

ALTER TABLE leadgen.historical_orders
    ADD CONSTRAINT historical_orders_historical_customer_id_fkey
        FOREIGN KEY (historical_customer_id)
        REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
    ADD CONSTRAINT historical_orders_customer_resolution_status_check
        CHECK (customer_resolution_status IN ('RESOLVED','REVIEW','UNRESOLVED')),
    ADD CONSTRAINT historical_orders_order_status_check
        CHECK (order_status IN ('CONFIRMED','CANCELLED','REVIEW','UNKNOWN')),
    ADD CONSTRAINT historical_orders_unit_price_check
        CHECK (unit_price IS NULL OR unit_price >= 0),
    ADD CONSTRAINT historical_orders_order_value_check
        CHECK (order_value IS NULL OR order_value >= 0),
    ADD CONSTRAINT historical_orders_commercial_value_type_check
        CHECK (commercial_value_type IN (
            'CUSTOMER_SALES_REVENUE','SUPPLIER_COST','FACTORY_QUOTE','UNKNOWN'
        )),
    ADD CONSTRAINT historical_orders_order_value_semantics_check
        CHECK (order_value IS NULL OR commercial_value_type <> 'UNKNOWN'),
    ADD CONSTRAINT historical_orders_product_profile_check
        CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    ADD CONSTRAINT historical_orders_source_identity_key_check
        CHECK (source_identity_key IS NULL OR source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT historical_orders_source_version_check
        CHECK (source_version >= 1),
    ADD CONSTRAINT historical_orders_supersedes_historical_order_id_fkey
        FOREIGN KEY (supersedes_historical_order_id)
        REFERENCES leadgen.historical_orders(id) ON DELETE RESTRICT,
    ADD CONSTRAINT historical_orders_not_self_superseded_check
        CHECK (supersedes_historical_order_id IS NULL OR supersedes_historical_order_id <> id),
    ADD CONSTRAINT historical_orders_source_version_contract_check
        CHECK (
            source_version = 1 OR (
                source_identity_key IS NOT NULL
                AND supersedes_historical_order_id IS NOT NULL
            )
        ),
    ADD CONSTRAINT historical_orders_record_digest_check
        CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$');

COMMENT ON COLUMN leadgen.historical_orders.revenue IS
    'Legacy field. V2.3 readers must use order_value only when commercial_value_type confirms customer sales revenue.';
COMMENT ON COLUMN leadgen.historical_orders.container_sequence IS
    'Shipment/container label only; never a customer or order identity.';
COMMENT ON COLUMN leadgen.historical_orders.order_status IS
    'Cancelled orders remain auditable; historical ICP readers include only explicitly supported order states.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_orders_source_identity
    ON leadgen.historical_orders (source_identity_key)
    WHERE source_identity_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_orders_source_version_once
    ON leadgen.historical_orders (source_system, external_order_id, source_version);
CREATE INDEX IF NOT EXISTS idx_historical_orders_external_lookup
    ON leadgen.historical_orders (source_system, external_order_id);
CREATE INDEX IF NOT EXISTS idx_historical_orders_customer_resolved
    ON leadgen.historical_orders (historical_customer_id, order_status, order_date DESC)
    WHERE historical_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadgen.historical_order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    historical_order_id uuid NOT NULL
        REFERENCES leadgen.historical_orders(id) ON DELETE RESTRICT,
    product_id uuid
        REFERENCES leadgen.product_master(id) ON DELETE RESTRICT,
    source_import_id uuid NOT NULL
        REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    source_import_row_id uuid NOT NULL
        REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
    source_identity_key text NOT NULL UNIQUE
        CHECK (source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
    line_number integer CHECK (line_number IS NULL OR line_number >= 1),
    external_line_id text,
    sku text,
    style_number text,
    model text,
    product_name text,
    product_profile text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    product_category text,
    quantity numeric(14,2) CHECK (quantity IS NULL OR quantity >= 0),
    unit text,
    customer_unit_price numeric(16,4)
        CHECK (customer_unit_price IS NULL OR customer_unit_price >= 0),
    customer_sales_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (customer_sales_currency = 'UNKNOWN' OR customer_sales_currency ~ '^[A-Z]{3}$'),
    supplier_unit_price numeric(16,4)
        CHECK (supplier_unit_price IS NULL OR supplier_unit_price >= 0),
    supplier_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (supplier_currency = 'UNKNOWN' OR supplier_currency ~ '^[A-Z]{3}$'),
    downstream_retail_price numeric(16,4)
        CHECK (downstream_retail_price IS NULL OR downstream_retail_price >= 0),
    downstream_retail_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (downstream_retail_currency = 'UNKNOWN' OR downstream_retail_currency ~ '^[A-Z]{3}$'),
    unclassified_unit_price numeric(16,4)
        CHECK (unclassified_unit_price IS NULL OR unclassified_unit_price >= 0),
    unclassified_currency text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (unclassified_currency = 'UNKNOWN' OR unclassified_currency ~ '^[A-Z]{3}$'),
    customer_sales_value numeric(16,2)
        CHECK (customer_sales_value IS NULL OR customer_sales_value >= 0),
    supplier_cost_value numeric(16,2)
        CHECK (supplier_cost_value IS NULL OR supplier_cost_value >= 0),
    price_type text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (price_type IN (
            'CUSTOMER_SALES_PRICE','SUPPLIER_PRICE','DOWNSTREAM_RETAIL_PRICE',
            'BOTH_EXPLICIT','MULTIPLE_EXPLICIT','UNKNOWN'
        )),
    currency char(3),
    incoterm text,
    record_digest text CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$'),
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (price_type <> 'CUSTOMER_SALES_PRICE' OR customer_unit_price IS NOT NULL),
    CHECK (price_type <> 'SUPPLIER_PRICE' OR supplier_unit_price IS NOT NULL),
    CHECK (price_type <> 'DOWNSTREAM_RETAIL_PRICE' OR downstream_retail_price IS NOT NULL),
    CHECK (price_type <> 'BOTH_EXPLICIT' OR (customer_unit_price IS NOT NULL AND supplier_unit_price IS NOT NULL)),
    CHECK (price_type <> 'MULTIPLE_EXPLICIT' OR num_nonnulls(
        customer_unit_price,supplier_unit_price,downstream_retail_price
    ) >= 2),
    UNIQUE (source_import_row_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_order_lines_order
    ON leadgen.historical_order_lines (historical_order_id, line_number);
CREATE INDEX IF NOT EXISTS idx_historical_order_lines_product
    ON leadgen.historical_order_lines (product_id)
    WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_company_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    historical_customer_id uuid NOT NULL
        REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL
        REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    import_batch_id uuid
        REFERENCES leadgen.reference_data_import_batches(id) ON DELETE RESTRICT,
    link_status text NOT NULL DEFAULT 'REVIEW'
        CHECK (link_status IN ('CONFIRMED','REVIEW','REJECTED')),
    match_method text NOT NULL,
    confidence numeric(4,3) NOT NULL DEFAULT 0
        CHECK (confidence BETWEEN 0 AND 1),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    confirmed_by text,
    confirmed_at timestamptz,
    data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS'
        CHECK (data_classification = 'INTERNAL_BUSINESS'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (link_status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
    UNIQUE (historical_customer_id, company_id)
);

COMMENT ON TABLE leadgen.historical_customer_company_links IS
    'Internal crosswalk. CONFIRMED links exclude the public company from the new-prospect pool without exposing order history.';

CREATE INDEX IF NOT EXISTS idx_existing_customer_company_confirmed
    ON leadgen.historical_customer_company_links (company_id)
    WHERE link_status = 'CONFIRMED';

ALTER TABLE leadgen.historical_lead_outcomes
    ADD COLUMN IF NOT EXISTS historical_customer_id uuid,
    ADD COLUMN IF NOT EXISTS customer_resolution_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS record_digest text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE leadgen.historical_lead_outcomes
    DROP CONSTRAINT IF EXISTS historical_lead_outcomes_historical_customer_id_fkey,
    DROP CONSTRAINT IF EXISTS historical_lead_outcomes_customer_resolution_status_check,
    DROP CONSTRAINT IF EXISTS historical_lead_outcomes_record_digest_check;

ALTER TABLE leadgen.historical_lead_outcomes
    ADD CONSTRAINT historical_lead_outcomes_historical_customer_id_fkey
        FOREIGN KEY (historical_customer_id)
        REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
    ADD CONSTRAINT historical_lead_outcomes_customer_resolution_status_check
        CHECK (customer_resolution_status IN ('RESOLVED','REVIEW','UNRESOLVED')),
    ADD CONSTRAINT historical_lead_outcomes_record_digest_check
        CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_historical_outcomes_customer
    ON leadgen.historical_lead_outcomes (historical_customer_id, outcome_date DESC)
    WHERE historical_customer_id IS NOT NULL;

ALTER TABLE leadgen.historical_customer_channels
    ADD COLUMN IF NOT EXISTS historical_customer_id uuid,
    ADD COLUMN IF NOT EXISTS customer_resolution_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS record_digest text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE leadgen.historical_customer_channels
    DROP CONSTRAINT IF EXISTS historical_customer_channels_historical_customer_id_fkey,
    DROP CONSTRAINT IF EXISTS historical_customer_channels_customer_resolution_status_check,
    DROP CONSTRAINT IF EXISTS historical_customer_channels_record_digest_check;

ALTER TABLE leadgen.historical_customer_channels
    ADD CONSTRAINT historical_customer_channels_historical_customer_id_fkey
        FOREIGN KEY (historical_customer_id)
        REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
    ADD CONSTRAINT historical_customer_channels_customer_resolution_status_check
        CHECK (customer_resolution_status IN ('RESOLVED','REVIEW','UNRESOLVED')),
    ADD CONSTRAINT historical_customer_channels_record_digest_check
        CHECK (record_digest IS NULL OR record_digest ~ '^[0-9A-Fa-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_channels_null_safe_identity
    ON leadgen.historical_customer_channels
    (source_system, external_customer_id, channel_type, coalesce(channel_name,''));
CREATE INDEX IF NOT EXISTS idx_historical_channels_customer
    ON leadgen.historical_customer_channels (historical_customer_id, channel_type)
    WHERE historical_customer_id IS NOT NULL;

ALTER TABLE leadgen.icp_profiles
    ADD COLUMN IF NOT EXISTS reference_market char(2),
    ADD COLUMN IF NOT EXISTS application_markets text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS profile_basis text,
    ADD COLUMN IF NOT EXISTS source_classification text,
    ADD COLUMN IF NOT EXISTS sample_size_customers integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS win_loss_coverage_status text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS rebuilt_at timestamptz,
    ADD COLUMN IF NOT EXISTS build_key text;

UPDATE leadgen.icp_profiles
SET application_markets = CASE
        WHEN cardinality(application_markets) = 0 THEN market_scope
        ELSE application_markets
    END,
    profile_basis = coalesce(profile_basis,'MANAGEMENT_DEFINED'),
    source_classification = coalesce(source_classification,'MANAGEMENT_DEFINED'),
    rebuilt_at = coalesce(rebuilt_at,activated_at,created_at)
WHERE profile_type = 'MANAGEMENT_BASELINE';

ALTER TABLE leadgen.icp_profiles
    DROP CONSTRAINT IF EXISTS icp_profiles_reference_market_check,
    DROP CONSTRAINT IF EXISTS icp_profiles_profile_basis_check,
    DROP CONSTRAINT IF EXISTS icp_profiles_source_classification_check,
    DROP CONSTRAINT IF EXISTS icp_profiles_sample_size_customers_check,
    DROP CONSTRAINT IF EXISTS icp_profiles_win_loss_coverage_status_check,
    DROP CONSTRAINT IF EXISTS icp_profiles_historical_activation_contract_check;

ALTER TABLE leadgen.icp_profiles
    ADD CONSTRAINT icp_profiles_reference_market_check
        CHECK (reference_market IS NULL OR reference_market::text ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT icp_profiles_profile_basis_check
        CHECK (profile_basis IS NULL OR profile_basis IN (
            'MANAGEMENT_DEFINED','CONVERTED_ORDER_HISTORY'
        )),
    ADD CONSTRAINT icp_profiles_source_classification_check
        CHECK (source_classification IS NULL OR source_classification IN (
            'MANAGEMENT_DEFINED','INTERNAL_BUSINESS'
        )),
    ADD CONSTRAINT icp_profiles_sample_size_customers_check
        CHECK (sample_size_customers >= 0),
    ADD CONSTRAINT icp_profiles_win_loss_coverage_status_check
        CHECK (win_loss_coverage_status IN ('FULL','LIMITED','NONE','UNKNOWN')),
    ADD CONSTRAINT icp_profiles_historical_activation_contract_check
        CHECK (
            profile_type <> 'HISTORICAL_CUSTOMER_ICP'
            OR status <> 'ACTIVE'
            OR (
                reference_market IS NOT NULL
                AND cardinality(application_markets) > 0
                AND profile_basis = 'CONVERTED_ORDER_HISTORY'
                AND source_classification = 'INTERNAL_BUSINESS'
                AND build_key IS NOT NULL
            )
        );

COMMENT ON COLUMN leadgen.icp_profiles.reference_market IS
    'Market whose internal history was used to build the profile, e.g. MX.';
COMMENT ON COLUMN leadgen.icp_profiles.application_markets IS
    'Markets where the profile may be applied, e.g. MX and AE; distinct from reference_market.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_icp_profile_build_once
    ON leadgen.icp_profiles (build_key)
    WHERE build_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_icp_historical_reference_application
    ON leadgen.icp_profiles (reference_market, status)
    WHERE profile_type = 'HISTORICAL_CUSTOMER_ICP';

-- One queue execution can now persist both the management baseline result and
-- the Mexico historical-reference result without combining their scores.
DROP INDEX IF EXISTS leadgen.idx_customer_match_execution_once;
CREATE UNIQUE INDEX idx_customer_match_execution_once
    ON leadgen.customer_match_results
    (company_id, reference_profile_id, execution_key)
    WHERE execution_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_match_latest_by_profile_type
    ON leadgen.customer_match_results
    (company_id, reference_profile_type, calculated_at DESC);

ALTER TABLE leadgen.phase5_audit_events
    DROP CONSTRAINT IF EXISTS phase5_audit_events_event_type_check;
ALTER TABLE leadgen.phase5_audit_events
    ADD CONSTRAINT phase5_audit_events_event_type_check
    CHECK (event_type IN (
        'REFERENCE_IMPORT_VALIDATED','REFERENCE_IMPORT_COMMITTED','ICP_PROFILE_CREATED',
        'ICP_PROFILE_ACTIVATED','RULE_VERSION_ACTIVATED','BATCH_RESCORE','BATCH_REMATCH',
        'IMPORT_BATCH_CREATED','IMPORT_BATCH_STATUS_CHANGED','SOURCE_FILE_STAGED',
        'HISTORICAL_ENTITY_VERSIONED','EXISTING_CUSTOMER_LINK_CONFIRMED',
        'MX_HISTORICAL_ICP_BUILT'
    ));

COMMIT;
