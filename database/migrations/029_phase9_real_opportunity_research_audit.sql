BEGIN;

-- Phase 9 keeps the existing mutable research job lifecycle while adding the
-- immutable request identity, bounded wave and stop audit fields needed by the
-- real-opportunity workbench.  Legacy jobs remain valid without fabricated
-- backfill values.
ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS request_digest text,
    ADD COLUMN IF NOT EXISTS created_by_identity text,
    ADD COLUMN IF NOT EXISTS created_by_role text,
    ADD COLUMN IF NOT EXISTS research_wave text,
    ADD COLUMN IF NOT EXISTS run_budget_cap_units integer,
    ADD COLUMN IF NOT EXISTS stop_reason_code text;

ALTER TABLE leadgen.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_job_type_check;
ALTER TABLE leadgen.research_jobs ADD CONSTRAINT research_jobs_job_type_check
    CHECK (job_type IN (
        'COMPANY_DISCOVERY','DECISION_MAKER_ENRICHMENT',
        'CATEGORY_PROCUREMENT_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH'
    ));

ALTER TABLE leadgen.research_jobs
    ADD CONSTRAINT research_jobs_phase9_request_digest_check
        CHECK (request_digest IS NULL OR request_digest ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT research_jobs_phase9_idempotency_key_check
        CHECK (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200)),
    ADD CONSTRAINT research_jobs_phase9_actor_identity_check
        CHECK (created_by_identity IS NULL OR (btrim(created_by_identity) <> '' AND length(created_by_identity) <= 200)),
    ADD CONSTRAINT research_jobs_phase9_actor_role_check
        CHECK (created_by_role IS NULL OR created_by_role IN ('MANAGEMENT','DATA_ADMIN','SYSTEM')),
    ADD CONSTRAINT research_jobs_phase9_wave_check
        CHECK (research_wave IS NULL OR research_wave IN ('A','B')),
    ADD CONSTRAINT research_jobs_phase9_run_budget_check
        CHECK (run_budget_cap_units IS NULL OR run_budget_cap_units >= 0),
    ADD CONSTRAINT research_jobs_phase9_stop_reason_check
        CHECK (stop_reason_code IS NULL OR (
            stop_reason_code ~ '^[A-Z][A-Z0-9_]{0,79}$'
            AND status IN ('COMPLETED','COMPLETE','PARTIAL','FAILED')
        )),
    ADD CONSTRAINT research_jobs_phase9_required_fields_check
        CHECK (job_type <> 'REAL_OPPORTUNITY_RESEARCH' OR (
            idempotency_key IS NOT NULL
            AND request_digest IS NOT NULL
            AND created_by_identity IS NOT NULL
            AND created_by_role IS NOT NULL
            AND research_wave IS NOT NULL
            AND run_budget_cap_units IS NOT NULL
            AND max_results <= CASE research_wave WHEN 'A' THEN 5 WHEN 'B' THEN 15 END
        ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_phase9_idempotency
    ON leadgen.research_jobs (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_id_wave
    ON leadgen.research_jobs (id,research_wave);

CREATE OR REPLACE FUNCTION leadgen.protect_phase9_research_job_request()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.job_type='REAL_OPPORTUNITY_RESEARCH' AND (
       NEW.job_type IS DISTINCT FROM OLD.job_type
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.created_by_identity IS DISTINCT FROM OLD.created_by_identity
    OR NEW.created_by_role IS DISTINCT FROM OLD.created_by_role
    OR NEW.research_wave IS DISTINCT FROM OLD.research_wave
    OR NEW.run_budget_cap_units IS DISTINCT FROM OLD.run_budget_cap_units
    OR NEW.max_results IS DISTINCT FROM OLD.max_results
    OR NEW.market_codes IS DISTINCT FROM OLD.market_codes
    OR NEW.product_profiles IS DISTINCT FROM OLD.product_profiles
  ) THEN
    RAISE EXCEPTION 'Phase 9 research job request and budget are immutable';
  END IF;
  IF OLD.stop_reason_code IS NOT NULL
     AND NEW.stop_reason_code IS DISTINCT FROM OLD.stop_reason_code THEN
    RAISE EXCEPTION 'Phase 9 research job stop reason is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_research_jobs_phase9_request_guard ON leadgen.research_jobs;
CREATE TRIGGER trg_research_jobs_phase9_request_guard
    BEFORE UPDATE ON leadgen.research_jobs
    FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase9_research_job_request();

CREATE TABLE IF NOT EXISTS leadgen.research_job_cohort_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL
        CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    product_profile_catalog_snapshot_id uuid NOT NULL,
    market_code char(2) NOT NULL CHECK (market_code IN ('AE','MX')),
    research_wave text NOT NULL CHECK (research_wave IN ('A','B')),
    selection_rank integer NOT NULL,
    selection_reason_code text NOT NULL
        CHECK (selection_reason_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
    company_verification_status_snapshot text NOT NULL CHECK (company_verification_status_snapshot='VERIFIED'),
    company_lifecycle_status_snapshot text NOT NULL CHECK (company_lifecycle_status_snapshot='ACTIVE'),
    relationship_status_snapshot text NOT NULL CHECK (relationship_status_snapshot='NEW_PROSPECT'),
    selection_input_digest text NOT NULL CHECK (selection_input_digest ~ '^[0-9A-Fa-f]{64}$'),
    selected_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (research_job_id,research_wave)
        REFERENCES leadgen.research_jobs(id,research_wave) ON DELETE RESTRICT,
    FOREIGN KEY (product_profile_catalog_snapshot_id,product_profile)
        REFERENCES leadgen.product_profile_catalog_snapshots(id,product_profile) ON DELETE RESTRICT,
    CHECK (selection_rank BETWEEN 1 AND CASE research_wave WHEN 'A' THEN 5 WHEN 'B' THEN 15 END),
    UNIQUE (research_job_id,company_id),
    UNIQUE (research_job_id,selection_rank),
    UNIQUE (id,research_job_id)
);

CREATE INDEX IF NOT EXISTS idx_research_job_cohort_items_job_rank
    ON leadgen.research_job_cohort_items (research_job_id,selection_rank);
CREATE INDEX IF NOT EXISTS idx_research_job_cohort_items_company
    ON leadgen.research_job_cohort_items (company_id,product_profile,selected_at DESC);

-- Each event binds the settled provider ledger row to one exact persisted
-- decision-maker contact.  Only hashes, enums and numeric results are stored;
-- no raw provider payload or plaintext email is copied into this audit table.
CREATE TABLE IF NOT EXISTS leadgen.contact_verification_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    decision_maker_contact_id uuid NOT NULL REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
    provider_usage_event_id uuid NOT NULL REFERENCES leadgen.provider_usage_events(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'HUNTER' CHECK (provider='HUNTER'),
    endpoint text NOT NULL DEFAULT 'email-verifier' CHECK (endpoint='email-verifier'),
    verification_status text NOT NULL CHECK (verification_status IN (
        'VALID','ACCEPT_ALL','UNKNOWN','INVALID','TEMPORARY_ERROR','NOT_VERIFIED'
    )),
    verification_score numeric(6,3) CHECK (verification_score BETWEEN 0 AND 100),
    verified_at timestamptz,
    captured_at timestamptz NOT NULL,
    expires_at timestamptz,
    recipient_hash text NOT NULL CHECK (recipient_hash ~ '^[0-9A-Fa-f]{64}$'),
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    idempotency_key text NOT NULL UNIQUE
        CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (verification_status <> 'VALID' OR (
        verified_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > verified_at
    ))
);

CREATE INDEX IF NOT EXISTS idx_contact_verification_events_contact_time
    ON leadgen.contact_verification_events (decision_maker_contact_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_verification_events_job_status
    ON leadgen.contact_verification_events (research_job_id,verification_status,captured_at DESC);

CREATE OR REPLACE FUNCTION leadgen.enforce_phase9_contact_verification_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact_company_id uuid;
DECLARE usage_job_id uuid;
DECLARE usage_company_id uuid;
DECLARE usage_provider text;
DECLARE usage_endpoint text;
DECLARE usage_status text;
BEGIN
  SELECT dm.company_id INTO contact_company_id
    FROM leadgen.decision_maker_contacts dmc
    JOIN leadgen.decision_makers dm ON dm.id=dmc.decision_maker_id
   WHERE dmc.id=NEW.decision_maker_contact_id;
  IF contact_company_id IS NULL OR contact_company_id<>NEW.company_id THEN
    RAISE EXCEPTION 'Phase 9 verification event contact/company mismatch';
  END IF;

  SELECT p.research_job_id,p.company_id,p.provider,p.endpoint,p.status
    INTO usage_job_id,usage_company_id,usage_provider,usage_endpoint,usage_status
    FROM leadgen.provider_usage_events p
   WHERE p.id=NEW.provider_usage_event_id;
  IF usage_job_id IS NULL
     OR usage_job_id<>NEW.research_job_id
     OR usage_company_id IS DISTINCT FROM NEW.company_id
     OR usage_provider<>NEW.provider
     OR usage_endpoint<>NEW.endpoint
     OR usage_status='RESERVED' THEN
    RAISE EXCEPTION 'Phase 9 verification event provider usage mismatch or unsettled usage';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_verification_events_exact_reference
    ON leadgen.contact_verification_events;
CREATE TRIGGER trg_contact_verification_events_exact_reference
    BEFORE INSERT ON leadgen.contact_verification_events
    FOR EACH ROW EXECUTE FUNCTION leadgen.enforce_phase9_contact_verification_event();

CREATE TABLE IF NOT EXISTS leadgen.research_job_stage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    cohort_item_id uuid NOT NULL,
    stage text NOT NULL CHECK (stage ~ '^[A-Z][A-Z0-9_]{0,79}$'),
    event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{0,79}$'),
    outcome_code text NOT NULL CHECK (outcome_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    reason_codes text[] NOT NULL DEFAULT '{}',
    retry_number integer NOT NULL DEFAULT 0 CHECK (retry_number >= 0),
    source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    idempotency_key text NOT NULL UNIQUE
        CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    buyer_business_model_result_id uuid REFERENCES leadgen.buyer_business_model_results(id) ON DELETE RESTRICT,
    category_procurement_match_result_id uuid REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    product_opportunity_result_id uuid REFERENCES leadgen.product_opportunity_results(id) ON DELETE RESTRICT,
    cooperation_feasibility_result_id uuid REFERENCES leadgen.cooperation_feasibility_results(id) ON DELETE RESTRICT,
    decision_maker_id uuid REFERENCES leadgen.decision_makers(id) ON DELETE RESTRICT,
    decision_maker_contact_id uuid REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
    contact_verification_event_id uuid REFERENCES leadgen.contact_verification_events(id) ON DELETE RESTRICT,
    business_opportunity_decision_snapshot_id uuid
        REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
    provider_usage_event_id uuid REFERENCES leadgen.provider_usage_events(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (cohort_item_id,research_job_id)
        REFERENCES leadgen.research_job_cohort_items(id,research_job_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_research_job_stage_events_timeline
    ON leadgen.research_job_stage_events (research_job_id,cohort_item_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS idx_research_job_stage_events_outcome
    ON leadgen.research_job_stage_events (research_job_id,stage,event_type,outcome_code);

CREATE OR REPLACE FUNCTION leadgen.prevent_phase9_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Phase 9 audit records are append-only';
END;
$$;

DO $$
DECLARE audit_table text;
BEGIN
  FOREACH audit_table IN ARRAY ARRAY[
    'research_job_cohort_items','research_job_stage_events','contact_verification_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON leadgen.%I',
      'trg_' || audit_table || '_immutable',audit_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON leadgen.%I FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase9_audit_mutation()',
      'trg_' || audit_table || '_immutable',audit_table);
  END LOOP;
END $$;

COMMENT ON TABLE leadgen.research_job_cohort_items IS
    'Immutable Phase 9 company-by-single-product-profile cohort selection snapshot.';
COMMENT ON TABLE leadgen.research_job_stage_events IS
    'Append-only deterministic Phase 9 per-company stage outcomes and canonical result references.';
COMMENT ON TABLE leadgen.contact_verification_events IS
    'Append-only exact contact verification facts linked to one Hunter usage ledger event; stores hashes, never plaintext email.';

COMMIT;
