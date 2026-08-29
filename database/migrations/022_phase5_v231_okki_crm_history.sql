BEGIN;

ALTER TABLE leadgen.reference_data_imports
  DROP CONSTRAINT IF EXISTS reference_data_imports_import_type_check;
ALTER TABLE leadgen.reference_data_imports
  ADD CONSTRAINT reference_data_imports_import_type_check
  CHECK (import_type IN (
    'HISTORICAL_CUSTOMERS','HISTORICAL_ORDERS','HISTORICAL_LEAD_OUTCOMES',
    'HISTORICAL_CUSTOMER_CHANNELS','CUSTOMER_ALIASES','PRODUCT_MASTER','ORDER_LINES',
    'HISTORICAL_CONTACTS','HISTORICAL_ACTIVITIES'
  ));

ALTER TABLE leadgen.reference_data_imports
  ADD COLUMN IF NOT EXISTS dataset_role text NOT NULL DEFAULT 'CONVERTED_ORDER_HISTORY';
ALTER TABLE leadgen.reference_data_imports
  DROP CONSTRAINT IF EXISTS reference_data_imports_dataset_role_check;
ALTER TABLE leadgen.reference_data_imports
  ADD CONSTRAINT reference_data_imports_dataset_role_check CHECK (dataset_role IN (
    'CONVERTED_ORDER_HISTORY','CRM_LEAD_HISTORY','CRM_CONTACT_HISTORY',
    'CRM_ACTIVITY_HISTORY','WIN_LOSS_HISTORY','UNKNOWN'
  ));

ALTER TABLE leadgen.reference_data_import_batches
  ADD COLUMN IF NOT EXISTS contact_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activity_count integer NOT NULL DEFAULT 0;

ALTER TABLE leadgen.reference_data_import_batches
  DROP CONSTRAINT IF EXISTS reference_data_import_batches_contact_count_check,
  DROP CONSTRAINT IF EXISTS reference_data_import_batches_activity_count_check;
ALTER TABLE leadgen.reference_data_import_batches
  ADD CONSTRAINT reference_data_import_batches_contact_count_check CHECK (contact_count >= 0),
  ADD CONSTRAINT reference_data_import_batches_activity_count_check CHECK (activity_count >= 0);

ALTER TABLE leadgen.historical_customers
  ADD COLUMN IF NOT EXISTS source_customer_id_raw text,
  ADD COLUMN IF NOT EXISTS source_customer_id_type text,
  ADD COLUMN IF NOT EXISTS source_customer_id_key text,
  ADD COLUMN IF NOT EXISTS crm_status_raw text,
  ADD COLUMN IF NOT EXISTS crm_outcome_state text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS crm_stage_detail text NOT NULL DEFAULT 'NO_STATUS',
  ADD COLUMN IF NOT EXISTS crm_source_raw text,
  ADD COLUMN IF NOT EXISTS crm_source_detail_raw text,
  ADD COLUMN IF NOT EXISTS crm_owner_raw text,
  ADD COLUMN IF NOT EXISTS crm_creator_raw text,
  ADD COLUMN IF NOT EXISTS crm_last_editor_raw text,
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS crm_score_raw text,
  ADD COLUMN IF NOT EXISTS customer_segment_raw text,
  ADD COLUMN IF NOT EXISTS customer_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS purchase_intent_raw text,
  ADD COLUMN IF NOT EXISTS company_notes text,
  ADD COLUMN IF NOT EXISTS annual_purchase_raw text,
  ADD COLUMN IF NOT EXISTS first_order_amount_raw text,
  ADD COLUMN IF NOT EXISTS source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_followup_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_edm_at timestamptz,
  ADD COLUMN IF NOT EXISTS historical_contacted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latest_crm_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS win_loss_coverage text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS dataset_role text NOT NULL DEFAULT 'CRM_LEAD_HISTORY';

ALTER TABLE leadgen.historical_customers
  DROP CONSTRAINT IF EXISTS historical_customers_customer_role_check,
  DROP CONSTRAINT IF EXISTS historical_customers_source_customer_id_type_check,
  DROP CONSTRAINT IF EXISTS historical_customers_source_customer_id_contract_check,
  DROP CONSTRAINT IF EXISTS historical_customers_crm_outcome_state_check,
  DROP CONSTRAINT IF EXISTS historical_customers_crm_stage_detail_check,
  DROP CONSTRAINT IF EXISTS historical_customers_win_loss_coverage_check,
  DROP CONSTRAINT IF EXISTS historical_customers_dataset_role_check;

ALTER TABLE leadgen.historical_customers
  ADD CONSTRAINT historical_customers_customer_role_check CHECK (customer_role IN (
    'INTERNAL_EXISTING_CUSTOMER','HISTORICAL_CRM_LEAD','HISTORICAL_CONTACTED_LEAD',
    'HISTORICAL_OPEN_LEAD','REVIEW'
  )),
  ADD CONSTRAINT historical_customers_source_customer_id_type_check
    CHECK (source_customer_id_type IS NULL OR source_customer_id_type IN ('int','text')),
  ADD CONSTRAINT historical_customers_source_customer_id_contract_check CHECK (
    source_system <> 'OKKI' OR (
      source_customer_id_raw IS NOT NULL AND source_customer_id_type IS NOT NULL
      AND source_customer_id_key IS NOT NULL
    )
  ),
  ADD CONSTRAINT historical_customers_crm_outcome_state_check
    CHECK (crm_outcome_state IN ('OPEN','UNKNOWN','WON','LOST')),
  ADD CONSTRAINT historical_customers_crm_stage_detail_check
    CHECK (crm_stage_detail IN ('IN_PROGRESS','PENDING','NO_STATUS')),
  ADD CONSTRAINT historical_customers_win_loss_coverage_check
    CHECK (win_loss_coverage IN ('FULL','LIMITED','NONE','UNKNOWN')),
  ADD CONSTRAINT historical_customers_dataset_role_check
    CHECK (dataset_role IN ('CONVERTED_ORDER_HISTORY','CRM_LEAD_HISTORY','CRM_CONTACT_HISTORY','CRM_ACTIVITY_HISTORY','WIN_LOSS_HISTORY'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_customers_okki_source_key
  ON leadgen.historical_customers(source_customer_id_key)
  WHERE source_system='OKKI';
CREATE INDEX IF NOT EXISTS idx_historical_customers_crm_history
  ON leadgen.historical_customers(source_system,customer_role,last_contact_at DESC)
  WHERE source_system='OKKI';

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  historical_customer_id uuid NOT NULL REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
  source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
  source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
  source_system text NOT NULL DEFAULT 'OKKI',
  source_customer_id_raw text NOT NULL,
  source_customer_id_type text NOT NULL CHECK (source_customer_id_type IN ('int','text')),
  source_customer_id_key text NOT NULL,
  contact_name text,
  job_title text,
  job_level text,
  business_email text,
  business_phone text,
  landline text,
  contact_notes text,
  is_primary boolean,
  is_generic_mailbox boolean NOT NULL DEFAULT false,
  social_profiles jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
  record_digest text NOT NULL CHECK (record_digest ~ '^[0-9A-Fa-f]{64}$'),
  data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS' CHECK (data_classification='INTERNAL_BUSINESS'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_customer_contacts_customer
  ON leadgen.historical_customer_contacts(historical_customer_id);
CREATE INDEX IF NOT EXISTS idx_historical_customer_contacts_email
  ON leadgen.historical_customer_contacts(lower(business_email))
  WHERE business_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  historical_customer_id uuid NOT NULL REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
  source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
  source_import_row_id uuid NOT NULL UNIQUE REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
  source_system text NOT NULL DEFAULT 'OKKI',
  source_customer_id_raw text NOT NULL,
  source_customer_id_type text NOT NULL CHECK (source_customer_id_type IN ('int','text')),
  source_customer_id_key text NOT NULL,
  company_name_raw text,
  source_contact_name text,
  source_contact_email text,
  activity_type_raw text,
  activity_title_raw text,
  activity_content_raw text,
  activity_type text NOT NULL CHECK (activity_type IN ('OUTBOUND_MARKETING_EMAIL_SENT','MANUAL_FOLLOW_UP')),
  activity_topic text,
  channel text,
  owner_raw text,
  activity_at timestamptz NOT NULL,
  source_created_at timestamptz,
  internal_related_link text,
  internal_attachment_reference text,
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[0-9A-Fa-f]{64}$'),
  record_digest text NOT NULL CHECK (record_digest ~ '^[0-9A-Fa-f]{64}$'),
  data_classification text NOT NULL DEFAULT 'INTERNAL_BUSINESS' CHECK (data_classification='INTERNAL_BUSINESS'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_customer_activities_customer_date
  ON leadgen.historical_customer_activities(historical_customer_id,activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_customer_activities_type
  ON leadgen.historical_customer_activities(activity_type,activity_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.historical_customer_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_historical_customer_id uuid NOT NULL REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
  target_historical_customer_id uuid NOT NULL REFERENCES leadgen.historical_customers(id) ON DELETE RESTRICT,
  import_batch_id uuid NOT NULL REFERENCES leadgen.reference_data_import_batches(id) ON DELETE RESTRICT,
  link_status text NOT NULL CHECK (link_status IN ('CONFIRMED','REVIEW','REJECTED')),
  match_method text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_historical_customer_id <> target_historical_customer_id),
  UNIQUE (source_historical_customer_id,target_historical_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_customer_reconciliations_source
  ON leadgen.historical_customer_reconciliations(source_historical_customer_id,link_status);

COMMENT ON TABLE leadgen.historical_customer_contacts IS
  'Internal OKKI CRM contacts. These records are not public-source contact evidence.';
COMMENT ON TABLE leadgen.historical_customer_activities IS
  'Internal OKKI activity ledger. Internal links and attachment references are never exposed by public APIs.';
COMMENT ON TABLE leadgen.historical_customer_reconciliations IS
  'Conservative internal crosswalk between OKKI CRM history and converted-order history.';
COMMENT ON COLUMN leadgen.historical_customers.first_order_amount_raw IS
  'Raw CRM export value only. It does not establish a converted order or win outcome.';

COMMIT;
