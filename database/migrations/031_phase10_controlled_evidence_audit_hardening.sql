BEGIN;

-- Persist the management boundary for controlled Phase 10 runs on the same
-- append-only event that authorizes the task. Ordinary event/reconcile/import
-- schedules keep these fields null.
ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD COLUMN IF NOT EXISTS operator_identity text,
  ADD COLUMN IF NOT EXISTS operator_role text,
  ADD COLUMN IF NOT EXISTS approval_reference text;

ALTER TABLE leadgen.auto_evidence_schedule_events
  DROP CONSTRAINT IF EXISTS auto_evidence_schedule_events_controlled_audit_check;
ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD CONSTRAINT auto_evidence_schedule_events_controlled_audit_check CHECK (
    (
      schedule_source='MANUAL_RETRY'
      AND operator_identity IS NOT NULL AND btrim(operator_identity)<>'' AND length(operator_identity)<=200
      AND operator_role IN ('MANAGEMENT','DATA_ADMIN')
      AND approval_reference IS NOT NULL AND btrim(approval_reference)<>'' AND length(approval_reference)<=160
    ) OR (
      schedule_source<>'MANUAL_RETRY'
      AND operator_identity IS NULL AND operator_role IS NULL AND approval_reference IS NULL
    )
  ) NOT VALID;

-- Existing Phase 10 validation rows predate these columns. They remain immutable
-- and explicitly unattributed; NOT VALID still enforces the constraint for every
-- new or updated row without inventing operator or approval facts.

COMMENT ON COLUMN leadgen.auto_evidence_schedule_events.operator_identity IS
  'Authenticated internal operator recorded for an explicitly controlled MANUAL_RETRY run.';
COMMENT ON COLUMN leadgen.auto_evidence_schedule_events.approval_reference IS
  'Company-controlled approval reference for the controlled evidence run; never an opportunity approval.';

-- Each product profile advances independently. A newer Womenswear revision must
-- not hide the still-effective General Merchandise baseline (or vice versa).
CREATE OR REPLACE VIEW leadgen.dpv_product_category_scope_current AS
WITH current_by_profile AS (
  SELECT DISTINCT ON (s.product_profile)
         s.product_profile,r.id revision_id
  FROM leadgen.dpv_product_category_scope_revisions r
  JOIN leadgen.dpv_product_category_scopes s ON s.scope_revision_id=r.id
  WHERE r.approval_status='APPROVED' AND r.effective_from<=now()
    AND (r.effective_to IS NULL OR r.effective_to>now())
  ORDER BY s.product_profile,r.revision DESC,r.approved_at DESC,r.id DESC
)
SELECT s.*,r.revision,r.approval_status,r.effective_from,r.effective_to,
       r.source_type,r.source_reference,r.source_digest,r.approved_by,r.approved_at
FROM leadgen.dpv_product_category_scopes s
JOIN current_by_profile c ON c.revision_id=s.scope_revision_id AND c.product_profile=s.product_profile
JOIN leadgen.dpv_product_category_scope_revisions r ON r.id=s.scope_revision_id
WHERE s.scope_status='ACTIVE';

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
    ) THEN RAISE EXCEPTION 'Phase 10 category match requires an effective approved scope revision'; END IF;
    SELECT count(*)::integer INTO scope_count
    FROM leadgen.dpv_product_category_scopes s
    WHERE s.scope_revision_id=NEW.scope_revision_id AND s.product_profile=NEW.product_profile
      AND s.scope_status='ACTIVE' AND s.id=ANY(NEW.matched_scope_ids);
    IF scope_count<>cardinality(NEW.matched_scope_ids) THEN
      RAISE EXCEPTION 'Phase 10 matched category scope IDs do not belong to the approved revision/profile';
    END IF;
    SELECT count(*)::integer INTO evidence_count
    FROM leadgen.prospect_category_observations o
    WHERE o.company_id=NEW.company_id AND o.normalized_profile=NEW.product_profile
      AND o.verification_status='VERIFIED' AND o.source_authority<>'SEARCH_DISCOVERY'
      AND o.id=ANY(NEW.observed_customer_category_ids);
    IF evidence_count<>cardinality(NEW.observed_customer_category_ids) THEN
      RAISE EXCEPTION 'Phase 10 category match requires verified profile-specific customer category observations';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_procurement_match_phase10_append_only
  ON leadgen.category_procurement_match_results;
CREATE TRIGGER trg_category_procurement_match_phase10_append_only
  BEFORE UPDATE OR DELETE ON leadgen.category_procurement_match_results
  FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase10_append_only_mutation();

COMMIT;
