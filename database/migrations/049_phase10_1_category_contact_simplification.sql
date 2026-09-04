BEGIN;

-- Keep the original decision-maker-scoped contact history while adding a
-- company-level identity that can be indexed and projected without duplicating
-- one public route for every category or person record.
ALTER TABLE leadgen.decision_maker_contacts
  ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE leadgen.decision_maker_contacts contact
SET company_id=maker.company_id
FROM leadgen.decision_makers maker
WHERE maker.id=contact.decision_maker_id
  AND contact.company_id IS DISTINCT FROM maker.company_id;

ALTER TABLE leadgen.decision_maker_contacts
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='leadgen.decision_maker_contacts'::regclass
      AND conname='decision_maker_contacts_company_id_fkey'
  ) THEN
    ALTER TABLE leadgen.decision_maker_contacts
      ADD CONSTRAINT decision_maker_contacts_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES leadgen.companies(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION leadgen.sync_decision_maker_contact_company()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_company_id uuid;
BEGIN
  SELECT company_id INTO expected_company_id
  FROM leadgen.decision_makers
  WHERE id=NEW.decision_maker_id;

  IF expected_company_id IS NULL THEN
    RAISE EXCEPTION 'decision maker does not resolve to a company';
  END IF;
  NEW.company_id := expected_company_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decision_maker_contacts_company ON leadgen.decision_maker_contacts;
CREATE TRIGGER trg_decision_maker_contacts_company
BEFORE INSERT OR UPDATE OF decision_maker_id,company_id
ON leadgen.decision_maker_contacts
FOR EACH ROW EXECUTE FUNCTION leadgen.sync_decision_maker_contact_company();

CREATE INDEX IF NOT EXISTS idx_decision_maker_contacts_company_canonical
  ON leadgen.decision_maker_contacts
  (company_id,contact_type,lower(contact_value_normalized),updated_at DESC,id DESC);

CREATE OR REPLACE VIEW leadgen.company_contact_route_current AS
SELECT DISTINCT ON (contact.company_id,contact.contact_type,lower(contact.contact_value_normalized))
  contact.id,
  contact.company_id,
  contact.decision_maker_id,
  contact.research_job_id,
  contact.contact_type,
  contact.contact_value_raw,
  contact.contact_value_normalized,
  contact.evidence_origin,
  contact.verification_status,
  contact.verification_provider,
  contact.verification_score,
  contact.last_verified_at,
  contact.source_url,
  contact.is_generic,
  contact.is_department,
  contact.created_at,
  contact.updated_at
FROM leadgen.decision_maker_contacts contact
ORDER BY
  contact.company_id,
  contact.contact_type,
  lower(contact.contact_value_normalized),
  CASE contact.verification_status
    WHEN 'VALID' THEN 1
    WHEN 'BUSINESS_WHATSAPP_OBSERVED' THEN 2
    WHEN 'PUBLICLY_OBSERVED' THEN 3
    WHEN 'FORMAT_VALID' THEN 4
    WHEN 'ACCEPT_ALL' THEN 5
    WHEN 'UNKNOWN' THEN 6
    WHEN 'NOT_VERIFIED' THEN 7
    WHEN 'TEMPORARY_ERROR' THEN 8
    ELSE 9
  END,
  contact.last_verified_at DESC NULLS LAST,
  contact.updated_at DESC,
  contact.id DESC;

COMMENT ON VIEW leadgen.company_contact_route_current IS
  'Current company-level canonical public contact routes. Person/category-specific records remain immutable history.';

-- The retired manual route queue remains queryable for audit but cannot accept
-- new workflow rows. The marker is derived so existing append-only rows are not
-- rewritten.
ALTER TABLE leadgen.official_route_manual_tasks
  ADD COLUMN IF NOT EXISTS retired_policy boolean
  GENERATED ALWAYS AS (outcome='RETIRED_POLICY') STORED;

CREATE OR REPLACE FUNCTION leadgen.prevent_new_official_route_manual_task()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'official route manual task policy is retired; history is read-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_official_route_manual_tasks_no_new ON leadgen.official_route_manual_tasks;
CREATE TRIGGER trg_official_route_manual_tasks_no_new
BEFORE INSERT ON leadgen.official_route_manual_tasks
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_new_official_route_manual_task();

CREATE OR REPLACE VIEW leadgen.official_route_manual_task_current AS
SELECT DISTINCT ON (task_key)
  id,task_type,task_key,revision,previous_revision_id,company_id,product_profile,
  route_type,official_url,official_contact,source_id,verified_at,captured_at,
  owner_identity,manual_action_status,outcome,qualification_basis,created_by,
  created_at,retired_policy
FROM leadgen.official_route_manual_tasks
ORDER BY task_key,revision DESC,created_at DESC,id DESC;

COMMENT ON TABLE leadgen.official_route_manual_tasks IS
  'Read-only historical audit for the retired manual official-route workflow. New workflow writes are prohibited.';
COMMENT ON COLUMN leadgen.official_route_manual_tasks.retired_policy IS
  'Derived marker for history closed under the Phase 10.1 retired policy.';

COMMIT;
