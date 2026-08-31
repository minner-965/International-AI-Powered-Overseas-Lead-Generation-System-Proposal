BEGIN;

-- Phase 8 Gate 0 is additive: Phase 7 snapshots stay immutable and retain a
-- NULL business_fit_status.  Every V2 assessment is a new snapshot revision.
ALTER TABLE leadgen.business_opportunity_decision_snapshots
    ADD COLUMN IF NOT EXISTS business_fit_status text;

ALTER TABLE leadgen.business_opportunity_decision_snapshots
    DROP CONSTRAINT IF EXISTS business_opportunity_decision_snapshots_business_fit_status_check;
ALTER TABLE leadgen.business_opportunity_decision_snapshots
    ADD CONSTRAINT business_opportunity_decision_snapshots_business_fit_status_check
        CHECK (business_fit_status IS NULL OR business_fit_status IN ('FIT','EVIDENCE_REQUIRED','NOT_SUITABLE'));

ALTER TABLE leadgen.business_opportunity_decision_snapshots
    DROP CONSTRAINT IF EXISTS business_opportunity_decision_snapshots_v2_contact_ready_check;
ALTER TABLE leadgen.business_opportunity_decision_snapshots
    ADD CONSTRAINT business_opportunity_decision_snapshots_v2_contact_ready_check
        CHECK (
            rule_version <> 'business-opportunity-decision-v2'
            OR (
                business_fit_status IS NOT NULL
                AND (
                    system_recommendation_status <> 'RECOMMENDED'
                    OR (business_fit_status='FIT' AND contact_readiness='READY' AND policy_contact_status='OPEN')
                )
            )
        );

-- Keep every Phase 7 view column in its original position and append the new
-- field.  CREATE OR REPLACE therefore preserves the dependent queue trigger.
CREATE OR REPLACE VIEW leadgen.business_opportunity_current AS
WITH current_snapshot AS (
  SELECT DISTINCT ON (company_id,product_profile) *
  FROM leadgen.business_opportunity_decision_snapshots
  ORDER BY company_id,product_profile,assessment_revision DESC,created_at DESC,id DESC
), current_management AS (
  SELECT DISTINCT ON (company_id,product_profile) *
  FROM leadgen.business_opportunity_management_events
  ORDER BY company_id,product_profile,created_at DESC,id DESC
)
SELECT s.id,s.company_id,s.product_profile,s.research_job_id,
       s.buyer_business_model_result_id,s.category_procurement_match_result_id,
       s.product_opportunity_result_id,s.cooperation_feasibility_result_id,
       s.system_recommendation_status,s.contact_readiness,s.policy_contact_status,
       s.relationship_status,s.reason_codes,s.rule_version,s.assessment_revision,
       s.input_digest,s.created_at,
       CASE WHEN m.decision_snapshot_id=s.id THEN m.management_contact_status ELSE 'NOT_REVIEWED' END AS management_contact_status,
       m.id AS latest_management_event_id,
       CASE
         WHEN s.policy_contact_status='HOLD' OR (m.decision_snapshot_id=s.id AND m.management_contact_status='HOLD') THEN 'HOLD'
         WHEN s.system_recommendation_status<>'RECOMMENDED' THEN s.system_recommendation_status
         WHEN m.decision_snapshot_id=s.id AND m.event_type='REQUEST_EVIDENCE' THEN 'EVIDENCE_REQUIRED'
         WHEN m.decision_snapshot_id=s.id AND m.management_contact_status='MANAGEMENT_APPROVED' THEN 'MANAGEMENT_APPROVED'
         ELSE s.system_recommendation_status
       END AS display_opportunity_status,
       s.business_fit_status
FROM current_snapshot s
LEFT JOIN current_management m USING (company_id,product_profile);

COMMENT ON COLUMN leadgen.business_opportunity_decision_snapshots.business_fit_status IS
    'Phase 8 V2 business-only fit; NULL on immutable Phase 7 snapshots.';

COMMIT;
