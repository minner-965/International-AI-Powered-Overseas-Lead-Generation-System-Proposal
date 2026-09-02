BEGIN;

-- Phase 10 is additive.  This migration intentionally creates no approved
-- category scope: the candidate view below exposes existing management/profile,
-- taxonomy and product facts, while an explicit approved revision remains the
-- boundary for any new category-procurement PASS.
CREATE TABLE IF NOT EXISTS leadgen.dpv_product_category_scope_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    revision integer NOT NULL UNIQUE CHECK (revision >= 1),
    approval_status text NOT NULL CHECK (approval_status IN ('DRAFT','APPROVED','RETIRED')),
    effective_from timestamptz,
    effective_to timestamptz,
    source_type text NOT NULL CHECK (source_type IN ('MANAGEMENT_APPROVED','PRODUCT_IMPORT','TAXONOMY')),
    source_reference text NOT NULL CHECK (btrim(source_reference) <> ''),
    source_digest text NOT NULL CHECK (source_digest ~ '^[0-9A-Fa-f]{64}$'),
    supersedes_revision_id uuid REFERENCES leadgen.dpv_product_category_scope_revisions(id) ON DELETE RESTRICT,
    approved_by text,
    approved_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR (effective_from IS NOT NULL AND effective_to > effective_from)),
    CHECK (supersedes_revision_id IS NULL OR supersedes_revision_id <> id),
    CHECK (
      (approval_status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL)
      OR (approval_status='DRAFT' AND approved_by IS NULL AND approved_at IS NULL)
      OR (approval_status='RETIRED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS leadgen.dpv_product_category_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_revision_id uuid NOT NULL REFERENCES leadgen.dpv_product_category_scope_revisions(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    normalized_category text NOT NULL CHECK (
      btrim(normalized_category) <> '' AND normalized_category ~ '^[A-Z0-9][A-Z0-9_]{0,99}$'
    ),
    parent_scope_id uuid,
    scope_status text NOT NULL CHECK (scope_status IN ('ACTIVE','INACTIVE','REVIEW')),
    taxonomy_node_id uuid REFERENCES leadgen.product_taxonomy_nodes(id) ON DELETE RESTRICT,
    source_fact_digest text NOT NULL CHECK (source_fact_digest ~ '^[0-9A-Fa-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_revision_id,product_profile,normalized_category),
    UNIQUE (id,scope_revision_id),
    UNIQUE (id,scope_revision_id,product_profile),
    FOREIGN KEY (parent_scope_id,scope_revision_id,product_profile)
      REFERENCES leadgen.dpv_product_category_scopes(id,scope_revision_id,product_profile) ON DELETE RESTRICT,
    CHECK (parent_scope_id IS NULL OR parent_scope_id <> id)
);

CREATE TABLE IF NOT EXISTS leadgen.dpv_product_category_scope_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_revision_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    normalized_alias text NOT NULL CHECK (btrim(normalized_alias) <> ''),
    raw_alias text NOT NULL CHECK (btrim(raw_alias) <> ''),
    alias_type text NOT NULL CHECK (alias_type IN ('EXACT','SYNONYM','PARENT','CHILD','SIMILAR')),
    language text NOT NULL DEFAULT 'und' CHECK (language IN ('en','es','zh','und')),
    market_code char(2),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','REVIEW')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (scope_id,scope_revision_id)
      REFERENCES leadgen.dpv_product_category_scopes(id,scope_revision_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dpv_category_scope_current
  ON leadgen.dpv_product_category_scopes(scope_revision_id,product_profile,scope_status,normalized_category);
CREATE INDEX IF NOT EXISTS idx_dpv_category_scope_alias_lookup
  ON leadgen.dpv_product_category_scope_aliases(scope_revision_id,lower(normalized_alias),status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpv_category_scope_alias_identity
  ON leadgen.dpv_product_category_scope_aliases(
    scope_revision_id,scope_id,language,coalesce(market_code,''),normalized_alias,alias_type
  );

CREATE OR REPLACE VIEW leadgen.dpv_product_category_scope_current AS
WITH current_revision AS (
  SELECT * FROM leadgen.dpv_product_category_scope_revisions
  WHERE approval_status='APPROVED' AND effective_from<=now()
    AND (effective_to IS NULL OR effective_to>now())
  ORDER BY revision DESC,approved_at DESC,id DESC LIMIT 1
)
SELECT s.*,r.revision,r.approval_status,r.effective_from,r.effective_to,
       r.source_type,r.source_reference,r.source_digest,r.approved_by,r.approved_at
FROM leadgen.dpv_product_category_scopes s
JOIN current_revision r ON r.id=s.scope_revision_id
WHERE s.scope_status='ACTIVE';

-- Read-only candidates only.  Rows in this view are not an approval and are
-- deliberately excluded from dpv_product_category_scope_current.
CREATE OR REPLACE VIEW leadgen.dpv_product_category_scope_candidates AS
WITH management_candidates AS (
  SELECT p.product_scope[1] product_profile,
         upper(regexp_replace(v.value,'[^A-Za-z0-9]+','_','g')) normalized_category,
         'MANAGEMENT_PROFILE' candidate_source,
         'icp_profile:'||p.id::text||':feature:'||f.id::text source_reference,
         encode(sha256(convert_to(p.id::text||'|'||f.id::text||'|'||v.value,'UTF8')),'hex') source_fact_digest
  FROM leadgen.icp_profiles p
  JOIN leadgen.icp_profile_features f ON f.profile_id=p.id AND f.feature_key='product_categories'
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(f.feature_value->'values','[]'::jsonb)) v(value)
  WHERE p.profile_type='MANAGEMENT_BASELINE' AND p.status='ACTIVE'
    AND cardinality(p.product_scope)=1
    AND p.product_scope[1] IN ('WOMENSWEAR','GENERAL_MERCHANDISE')
), product_fact_candidates AS (
  SELECT a.normalized_profile product_profile,a.normalized_category,
         'PRODUCT_FACT' candidate_source,
         'taxonomy_assignment:'||a.id::text source_reference,
         lower(a.input_digest) source_fact_digest
  FROM leadgen.product_master_taxonomy_assignments a
  WHERE a.assignment_status IN ('CONFIRMED','SUPPORTED')
    AND a.catalog_status IN ('CURRENT_CONFIRMED','HISTORICAL_ORDER_SUPPORTED')
    AND a.normalized_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')
    AND a.normalized_category IS NOT NULL
), candidates AS (
  SELECT * FROM management_candidates
  UNION ALL
  SELECT * FROM product_fact_candidates
)
SELECT product_profile,normalized_category,candidate_source,source_reference,
       source_fact_digest,'DRAFT'::text approval_boundary
FROM candidates
WHERE normalized_category ~ '^[A-Z0-9][A-Z0-9_]{0,99}$';

ALTER TABLE leadgen.category_procurement_match_results
  ADD COLUMN IF NOT EXISTS scope_revision_id uuid
    REFERENCES leadgen.dpv_product_category_scope_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS match_basis text,
  ADD COLUMN IF NOT EXISTS matched_scope_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS observed_customer_category_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS similarity_rule text,
  ADD COLUMN IF NOT EXISTS catalog_completeness_non_blocking boolean NOT NULL DEFAULT false;

ALTER TABLE leadgen.category_procurement_match_results
  DROP CONSTRAINT IF EXISTS category_procurement_match_results_match_status_check;
ALTER TABLE leadgen.category_procurement_match_results
  ADD CONSTRAINT category_procurement_match_results_match_status_check CHECK (match_status IN (
    'CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','WEAK_CATEGORY_MATCH',
    'PRODUCT_MISMATCH','NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE',
    'NEEDS_DPV_CATEGORY_SCOPE_APPROVAL','INELIGIBLE_BUYER_MODEL'
  ));

ALTER TABLE leadgen.category_procurement_match_results
  DROP CONSTRAINT IF EXISTS category_procurement_match_results_phase10_basis_check,
  DROP CONSTRAINT IF EXISTS category_procurement_match_results_phase10_v2_contract_check;
ALTER TABLE leadgen.category_procurement_match_results
  ADD CONSTRAINT category_procurement_match_results_phase10_basis_check
    CHECK (match_basis IS NULL OR match_basis IN (
      'EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE','AMBIGUOUS_SCOPE','OUT_OF_SCOPE'
    )),
  ADD CONSTRAINT category_procurement_match_results_phase10_v2_contract_check
    CHECK (
      calculation_version <> 'category-procurement-match-v2'
      OR (
        catalog_completeness_non_blocking=true
        AND (
          (match_status='CATEGORY_PROCUREMENT_MATCH'
            AND match_basis IN ('EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE')
            AND scope_revision_id IS NOT NULL
            AND cardinality(matched_scope_ids)>0
            AND cardinality(observed_customer_category_ids)>0)
          OR (match_status='PRODUCT_MISMATCH' AND match_basis='OUT_OF_SCOPE')
          OR (match_status<>'CATEGORY_PROCUREMENT_MATCH' AND match_status<>'PRODUCT_MISMATCH')
        )
      )
    );

CREATE TABLE IF NOT EXISTS leadgen.category_procurement_match_scope_links (
    category_procurement_match_result_id uuid NOT NULL
      REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    scope_revision_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    prospect_category_observation_id uuid NOT NULL
      REFERENCES leadgen.prospect_category_observations(id) ON DELETE RESTRICT,
    match_basis text NOT NULL CHECK (match_basis IN ('EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE')),
    similarity_rule text NOT NULL CHECK (btrim(similarity_rule) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (scope_id,scope_revision_id)
      REFERENCES leadgen.dpv_product_category_scopes(id,scope_revision_id) ON DELETE RESTRICT,
    PRIMARY KEY (category_procurement_match_result_id,scope_id,prospect_category_observation_id)
);

CREATE OR REPLACE FUNCTION leadgen.enforce_phase10_approved_category_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_count integer;
DECLARE evidence_count integer;
BEGIN
  IF NEW.calculation_version='category-procurement-match-v2'
     AND NEW.match_status='CATEGORY_PROCUREMENT_MATCH' THEN
    IF NOT EXISTS (
      SELECT 1 FROM leadgen.dpv_product_category_scope_revisions r
      WHERE r.id=NEW.scope_revision_id AND r.approval_status='APPROVED'
        AND r.effective_from<=NEW.created_at
        AND (r.effective_to IS NULL OR r.effective_to>NEW.created_at)
    ) THEN
      RAISE EXCEPTION 'Phase 10 category match requires an effective approved scope revision';
    END IF;
    SELECT count(*)::integer INTO scope_count
    FROM leadgen.dpv_product_category_scopes s
    WHERE s.scope_revision_id=NEW.scope_revision_id AND s.product_profile=NEW.product_profile
      AND s.scope_status='ACTIVE' AND s.id=ANY(NEW.matched_scope_ids);
    IF scope_count<>cardinality(NEW.matched_scope_ids) THEN
      RAISE EXCEPTION 'Phase 10 matched category scope IDs do not belong to the approved revision/profile';
    END IF;
    SELECT count(*)::integer INTO evidence_count
    FROM leadgen.prospect_category_observations o
    WHERE o.company_id=NEW.company_id AND o.verification_status='VERIFIED'
      AND o.source_authority<>'SEARCH_DISCOVERY'
      AND o.id=ANY(NEW.observed_customer_category_ids);
    IF evidence_count<>cardinality(NEW.observed_customer_category_ids) THEN
      RAISE EXCEPTION 'Phase 10 category match requires verified customer category observations';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_procurement_match_phase10_scope_gate
  ON leadgen.category_procurement_match_results;
CREATE TRIGGER trg_category_procurement_match_phase10_scope_gate
  BEFORE INSERT ON leadgen.category_procurement_match_results
  FOR EACH ROW EXECUTE FUNCTION leadgen.enforce_phase10_approved_category_scope();

ALTER TABLE leadgen.product_opportunity_results
  ADD COLUMN IF NOT EXISTS sku_readiness_status text,
  ADD COLUMN IF NOT EXISTS catalog_enrichment_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category_scope_match_result_id uuid
    REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT;

ALTER TABLE leadgen.product_opportunity_results
  DROP CONSTRAINT IF EXISTS product_opportunity_results_phase10_sku_readiness_check,
  DROP CONSTRAINT IF EXISTS product_opportunity_results_phase10_v2_contract_check;
ALTER TABLE leadgen.product_opportunity_results
  ADD CONSTRAINT product_opportunity_results_phase10_sku_readiness_check
    CHECK (sku_readiness_status IS NULL OR sku_readiness_status IN (
      'SKU_READY','SKU_PARTIAL','NO_EXACT_SKU','INTERNAL_CATALOG_UPLOAD_REQUIRED','OUT_OF_SCOPE'
    )),
  ADD CONSTRAINT product_opportunity_results_phase10_v2_contract_check
    CHECK (
      calculation_version <> 'product-opportunity-v2'
      OR (
        sku_readiness_status IS NOT NULL
        AND category_scope_match_result_id IS NOT NULL
        AND category_scope_match_result_id=category_procurement_match_result_id
        AND (candidate_count>0 OR sku_readiness_status IN ('NO_EXACT_SKU','INTERNAL_CATALOG_UPLOAD_REQUIRED','OUT_OF_SCOPE'))
        AND (candidate_count=0 OR sku_readiness_status IN ('SKU_READY','SKU_PARTIAL'))
      )
    );

ALTER TABLE leadgen.cooperation_feasibility_results
  ADD COLUMN IF NOT EXISTS supplier_route_status text;
ALTER TABLE leadgen.cooperation_feasibility_results
  DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_phase10_supplier_route_check;
ALTER TABLE leadgen.cooperation_feasibility_results
  ADD CONSTRAINT cooperation_feasibility_results_phase10_supplier_route_check
    CHECK (supplier_route_status IS NULL OR supplier_route_status IN ('SUPPORTED','UNKNOWN','CLOSED'));

ALTER TABLE leadgen.cooperation_feasibility_results
  DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_opportunity_readiness_check;
ALTER TABLE leadgen.cooperation_feasibility_results
  ADD CONSTRAINT cooperation_feasibility_results_opportunity_readiness_check CHECK (opportunity_readiness IN (
    'SALES_READY','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION','HISTORICAL_REVIEW',
    'EXISTING_CUSTOMER','SUPPRESSED','HOLD','REVIEW','STRATEGIC_LONG_SHOT','INELIGIBLE_BUYER_MODEL',
    'NEEDS_INTERNAL_CATALOG_EVIDENCE','NEEDS_DPV_CATEGORY_SCOPE_APPROVAL','NEEDS_PRODUCT_EVIDENCE','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE',
    'PRODUCT_MISMATCH','WEAK_CATEGORY_MATCH'
  ));

ALTER TABLE leadgen.business_opportunity_decision_snapshots
  DROP CONSTRAINT IF EXISTS business_opportunity_decision_snapshots_v3_contact_ready_check;
ALTER TABLE leadgen.business_opportunity_decision_snapshots
  ADD CONSTRAINT business_opportunity_decision_snapshots_v3_contact_ready_check
    CHECK (
      rule_version <> 'business-opportunity-decision-v3'
      OR (
        business_fit_status IS NOT NULL
        AND (
          system_recommendation_status <> 'RECOMMENDED'
          OR (business_fit_status='FIT' AND contact_readiness='READY'
              AND policy_contact_status='OPEN' AND relationship_status='NEW_PROSPECT')
        )
      )
    );

CREATE TABLE IF NOT EXISTS leadgen.auto_evidence_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    category_research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    contact_research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    business_blocker text NOT NULL CHECK (business_blocker ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    evidence_revision integer NOT NULL CHECK (evidence_revision >= 0),
    execution_key text NOT NULL UNIQUE CHECK (btrim(execution_key) <> '' AND length(execution_key) <= 240),
    task_status text NOT NULL DEFAULT 'QUEUED' CHECK (task_status IN (
      'QUEUED','RUNNING','RETRY_SCHEDULED','EVIDENCE_EXHAUSTED','TEMPORARY_PROVIDER_ERROR',
      'HUMAN_REVIEW_REQUIRED','BUDGET_PAUSED','COMPLETED','CANCELLED'
    )),
    current_stage text CHECK (current_stage IS NULL OR current_stage IN (
      'DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE',
      'FINDING_BUYER','VERIFYING_EMAIL','REFRESHING_DECISION'
    )),
    automation_owner text NOT NULL DEFAULT 'SYSTEM' CHECK (automation_owner='SYSTEM'),
    human_owner text,
    technical_blocker text,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
    budget_state text NOT NULL DEFAULT 'AVAILABLE' CHECK (budget_state IN ('AVAILABLE','PAUSED','EXHAUSTED','NOT_REQUIRED')),
    retry_at timestamptz,
    cooldown_until timestamptz,
    last_evidence_revision integer NOT NULL DEFAULT 0 CHECK (last_evidence_revision >= 0),
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (company_id,product_profile,business_blocker,evidence_revision),
    UNIQUE (id,company_id),
    CHECK (attempt_count <= max_attempts),
    CHECK ((task_status='COMPLETED' AND completed_at IS NOT NULL) OR task_status<>'COMPLETED'),
    CHECK (task_status<>'RETRY_SCHEDULED' OR retry_at IS NOT NULL),
    CHECK (task_status<>'BUDGET_PAUSED' OR budget_state IN ('PAUSED','EXHAUSTED'))
);

CREATE INDEX IF NOT EXISTS idx_auto_evidence_tasks_runnable
  ON leadgen.auto_evidence_tasks(task_status,retry_at,cooldown_until,created_at)
  WHERE task_status IN ('QUEUED','RETRY_SCHEDULED','TEMPORARY_PROVIDER_ERROR');
CREATE INDEX IF NOT EXISTS idx_auto_evidence_tasks_company_profile
  ON leadgen.auto_evidence_tasks(company_id,product_profile,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.auto_evidence_task_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL,
    company_id uuid NOT NULL,
    research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    stage text NOT NULL CHECK (stage IN (
      'DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE',
      'FINDING_BUYER','VERIFYING_EMAIL','REFRESHING_DECISION'
    )),
    event_type text NOT NULL CHECK (event_type IN ('STARTED','SETTLED')),
    outcome_status text CHECK (outcome_status IS NULL OR outcome_status IN (
      'COMPLETED','RETRYABLE_ERROR','PERMANENT_ERROR','EVIDENCE_EXHAUSTED','BUDGET_PAUSED','HUMAN_REVIEW_REQUIRED'
    )),
    provider_usage_event_id uuid REFERENCES leadgen.provider_usage_events(id) ON DELETE RESTRICT,
    prospect_category_source_id uuid REFERENCES leadgen.prospect_category_sources(id) ON DELETE RESTRICT,
    prospect_category_observation_id uuid REFERENCES leadgen.prospect_category_observations(id) ON DELETE RESTRICT,
    buyer_business_model_result_id uuid REFERENCES leadgen.buyer_business_model_results(id) ON DELETE RESTRICT,
    category_procurement_match_result_id uuid REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    product_opportunity_result_id uuid REFERENCES leadgen.product_opportunity_results(id) ON DELETE RESTRICT,
    cooperation_feasibility_result_id uuid REFERENCES leadgen.cooperation_feasibility_results(id) ON DELETE RESTRICT,
    decision_maker_id uuid REFERENCES leadgen.decision_makers(id) ON DELETE RESTRICT,
    decision_maker_contact_id uuid REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
    contact_verification_event_id uuid REFERENCES leadgen.contact_verification_events(id) ON DELETE RESTRICT,
    business_opportunity_decision_snapshot_id uuid
      REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
    technical_blocker text,
    retry_at timestamptz,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    output_digest text CHECK (output_digest IS NULL OR output_digest ~ '^[0-9A-Fa-f]{64}$'),
    idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 240),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (task_id,company_id) REFERENCES leadgen.auto_evidence_tasks(id,company_id) ON DELETE RESTRICT,
    CHECK ((event_type='STARTED' AND outcome_status IS NULL) OR (event_type='SETTLED' AND outcome_status IS NOT NULL)),
    UNIQUE (task_id,attempt_number,stage,event_type)
);

CREATE INDEX IF NOT EXISTS idx_auto_evidence_attempts_timeline
  ON leadgen.auto_evidence_task_attempts(task_id,attempt_number,occurred_at,id);

CREATE TABLE IF NOT EXISTS leadgen.auto_evidence_schedule_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_source text NOT NULL CHECK (schedule_source IN ('EVENT','RECONCILIATION','MANUAL_RETRY','IMPORT')),
    schedule_key text NOT NULL UNIQUE CHECK (btrim(schedule_key) <> '' AND length(schedule_key) <= 240),
    task_id uuid REFERENCES leadgen.auto_evidence_tasks(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    business_blocker text NOT NULL CHECK (business_blocker ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    evidence_revision integer NOT NULL CHECK (evidence_revision >= 0),
    outcome text NOT NULL CHECK (outcome IN (
      'SCHEDULED','DEDUPLICATED','SKIPPED_COOLDOWN','BUDGET_PAUSED','HUMAN_REVIEW_REQUIRED'
    )),
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_evidence_schedule_company
  ON leadgen.auto_evidence_schedule_events(company_id,product_profile,occurred_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.human_evidence_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL,
    company_id uuid NOT NULL,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    exception_key text NOT NULL CHECK (btrim(exception_key) <> '' AND length(exception_key) <= 240),
    event_type text NOT NULL CHECK (event_type IN ('OPENED','CLAIMED','RESOLVED','DISMISSED')),
    exception_type text NOT NULL CHECK (exception_type ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    business_blocker text NOT NULL CHECK (business_blocker ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    human_owner text,
    resolution_code text,
    notes text,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 240),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (task_id,company_id) REFERENCES leadgen.auto_evidence_tasks(id,company_id) ON DELETE RESTRICT,
    CHECK (event_type<>'CLAIMED' OR human_owner IS NOT NULL),
    CHECK (event_type NOT IN ('RESOLVED','DISMISSED') OR resolution_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_human_evidence_exception_timeline
  ON leadgen.human_evidence_exceptions(exception_key,occurred_at DESC,id DESC);

CREATE OR REPLACE VIEW leadgen.human_evidence_exceptions_current AS
SELECT DISTINCT ON (exception_key) *
FROM leadgen.human_evidence_exceptions
ORDER BY exception_key,occurred_at DESC,id DESC;

CREATE OR REPLACE FUNCTION leadgen.prevent_phase10_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Phase 10 scope and evidence audit records are append-only';
END;
$$;

DO $$
DECLARE audit_table text;
BEGIN
  FOREACH audit_table IN ARRAY ARRAY[
    'dpv_product_category_scope_revisions','dpv_product_category_scopes',
    'dpv_product_category_scope_aliases','category_procurement_match_scope_links',
    'auto_evidence_task_attempts','auto_evidence_schedule_events','human_evidence_exceptions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON leadgen.%I',
      'trg_'||audit_table||'_immutable',audit_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON leadgen.%I FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase10_append_only_mutation()',
      'trg_'||audit_table||'_immutable',audit_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION leadgen.protect_phase10_auto_evidence_task_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.product_profile IS DISTINCT FROM OLD.product_profile
     OR NEW.business_blocker IS DISTINCT FROM OLD.business_blocker
     OR NEW.evidence_revision IS DISTINCT FROM OLD.evidence_revision
     OR NEW.execution_key IS DISTINCT FROM OLD.execution_key
     OR NEW.automation_owner IS DISTINCT FROM OLD.automation_owner
     OR NEW.input_digest IS DISTINCT FROM OLD.input_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Phase 10 auto-evidence task identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_evidence_tasks_identity_guard ON leadgen.auto_evidence_tasks;
CREATE TRIGGER trg_auto_evidence_tasks_identity_guard
  BEFORE UPDATE ON leadgen.auto_evidence_tasks
  FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase10_auto_evidence_task_identity();

CREATE OR REPLACE FUNCTION leadgen.enforce_phase10_auto_evidence_job_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category_type text;
DECLARE contact_type text;
BEGIN
  IF NEW.category_research_job_id IS NOT NULL THEN
    SELECT job_type INTO category_type FROM leadgen.research_jobs WHERE id=NEW.category_research_job_id;
    IF category_type<>'CATEGORY_PROCUREMENT_ENRICHMENT' THEN
      RAISE EXCEPTION 'Phase 10 category research job type mismatch';
    END IF;
  END IF;
  IF NEW.contact_research_job_id IS NOT NULL THEN
    SELECT job_type INTO contact_type FROM leadgen.research_jobs WHERE id=NEW.contact_research_job_id;
    IF contact_type NOT IN ('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH') THEN
      RAISE EXCEPTION 'Phase 10 contact research job type mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_evidence_tasks_job_lineage ON leadgen.auto_evidence_tasks;
CREATE TRIGGER trg_auto_evidence_tasks_job_lineage
  BEFORE INSERT OR UPDATE OF category_research_job_id,contact_research_job_id
  ON leadgen.auto_evidence_tasks
  FOR EACH ROW EXECUTE FUNCTION leadgen.enforce_phase10_auto_evidence_job_lineage();

COMMENT ON VIEW leadgen.dpv_product_category_scope_candidates IS
  'Read-only candidates derived from existing management profiles and real classified product facts; never an approval baseline.';
COMMENT ON VIEW leadgen.dpv_product_category_scope_current IS
  'Only effective APPROVED revisions and ACTIVE scopes; the deterministic Phase 10 business-match baseline.';
COMMENT ON COLUMN leadgen.category_procurement_match_results.catalog_completeness_non_blocking IS
  'Phase 10: internal SKU/catalog completeness is recorded but never used as the customer category-match gate.';
COMMENT ON TABLE leadgen.auto_evidence_tasks IS
  'Mutable lifecycle row keyed by company/profile/blocker/evidence revision; immutable identity, append-only attempts and schedule audit.';

COMMIT;
