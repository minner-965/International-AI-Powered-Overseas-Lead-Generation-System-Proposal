BEGIN;

ALTER TABLE leadgen.auto_evidence_tasks
  ADD COLUMN IF NOT EXISTS target_category_scope_key text,
  ADD COLUMN IF NOT EXISTS target_category_code text;

UPDATE leadgen.auto_evidence_tasks
SET target_category_scope_key=coalesce(target_category_scope_key,'PROFILE:'||product_profile),
    target_category_code=coalesce(target_category_code,product_profile)
WHERE target_category_scope_key IS NULL OR target_category_code IS NULL;

ALTER TABLE leadgen.auto_evidence_tasks
  ALTER COLUMN target_category_scope_key SET NOT NULL,
  ALTER COLUMN target_category_code SET NOT NULL,
  ALTER COLUMN product_profile DROP NOT NULL;

ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_product_profile_check;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_product_profile_check
  CHECK (product_profile IS NULL OR product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE'));

ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_company_id_product_profile_business_blo_key;
ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_category_scope_identity_key;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_category_scope_identity_key
  UNIQUE (company_id,target_category_scope_key,business_blocker,evidence_revision);
ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_target_category_scope_key_check;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_target_category_scope_key_check
  CHECK (btrim(target_category_scope_key)<>'' AND length(target_category_scope_key)<=240);
ALTER TABLE leadgen.auto_evidence_tasks
  DROP CONSTRAINT IF EXISTS auto_evidence_tasks_target_category_code_check;
ALTER TABLE leadgen.auto_evidence_tasks
  ADD CONSTRAINT auto_evidence_tasks_target_category_code_check
  CHECK (target_category_code~'^[A-Z0-9][A-Z0-9_]{0,99}$');

DROP INDEX IF EXISTS leadgen.idx_auto_evidence_tasks_company_profile;
CREATE INDEX IF NOT EXISTS idx_auto_evidence_tasks_company_category_scope
  ON leadgen.auto_evidence_tasks(company_id,target_category_scope_key,created_at DESC);

ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD COLUMN IF NOT EXISTS target_category_scope_key text,
  ADD COLUMN IF NOT EXISTS target_category_code text,
  ALTER COLUMN product_profile DROP NOT NULL;
ALTER TABLE leadgen.auto_evidence_schedule_events
  DROP CONSTRAINT IF EXISTS auto_evidence_schedule_events_product_profile_check;
ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD CONSTRAINT auto_evidence_schedule_events_product_profile_check
  CHECK (product_profile IS NULL OR product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE'));
ALTER TABLE leadgen.auto_evidence_schedule_events
  DROP CONSTRAINT IF EXISTS auto_evidence_schedule_events_target_category_scope_key_check;
ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD CONSTRAINT auto_evidence_schedule_events_target_category_scope_key_check
  CHECK (target_category_scope_key IS NULL OR (btrim(target_category_scope_key)<>'' AND length(target_category_scope_key)<=240));
ALTER TABLE leadgen.auto_evidence_schedule_events
  DROP CONSTRAINT IF EXISTS auto_evidence_schedule_events_target_category_code_check;
ALTER TABLE leadgen.auto_evidence_schedule_events
  ADD CONSTRAINT auto_evidence_schedule_events_target_category_code_check
  CHECK (target_category_code IS NULL OR target_category_code~'^[A-Z0-9][A-Z0-9_]{0,99}$');

CREATE OR REPLACE FUNCTION leadgen.protect_phase10_auto_evidence_task_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.target_category_scope_key IS DISTINCT FROM OLD.target_category_scope_key
     OR NEW.target_category_code IS DISTINCT FROM OLD.target_category_code
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

COMMENT ON COLUMN leadgen.auto_evidence_tasks.target_category_scope_key IS
  'Canonical category-driven identity. Product profile is optional compatibility metadata.';
COMMENT ON COLUMN leadgen.auto_evidence_tasks.target_category_code IS
  'Normalized target category used throughout discovery, verification, and contact research.';
COMMENT ON COLUMN leadgen.auto_evidence_schedule_events.target_category_scope_key IS
  'Canonical category-driven identity for new schedule events; historical events may be NULL.';

COMMIT;
