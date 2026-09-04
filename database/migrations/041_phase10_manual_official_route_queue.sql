BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.official_route_manual_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL DEFAULT 'MANUAL_OFFICIAL_ROUTE_READY'
    CHECK (task_type='MANUAL_OFFICIAL_ROUTE_READY'),
  task_key text NOT NULL CHECK (task_key~'^[0-9a-f]{64}$'),
  revision integer NOT NULL CHECK (revision>0),
  previous_revision_id uuid REFERENCES leadgen.official_route_manual_tasks(id),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id),
  product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
  route_type text NOT NULL CHECK (route_type IN (
    'SUPPLIER_PORTAL','VENDOR_REGISTRATION','CONTACT_FORM',
    'PROCUREMENT_DEPARTMENT_EMAIL','PROCUREMENT_DEPARTMENT_PHONE'
  )),
  official_url text NOT NULL CHECK (official_url~'^https?://'),
  official_contact text,
  source_id uuid NOT NULL REFERENCES leadgen.sources(id),
  verified_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  owner_identity text,
  manual_action_status text NOT NULL DEFAULT 'READY'
    CHECK (manual_action_status IN ('READY','IN_PROGRESS','COMPLETED','DISMISSED')),
  outcome text,
  qualification_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_key,revision),
  UNIQUE(idempotency_key),
  CHECK ((manual_action_status IN ('COMPLETED','DISMISSED'))=(outcome IS NOT NULL AND btrim(outcome)<>''))
);

CREATE OR REPLACE FUNCTION leadgen.prevent_official_route_manual_task_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'official route manual task history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_official_route_manual_tasks_immutable ON leadgen.official_route_manual_tasks;
CREATE TRIGGER trg_official_route_manual_tasks_immutable
BEFORE UPDATE OR DELETE ON leadgen.official_route_manual_tasks
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_official_route_manual_task_mutation();

CREATE INDEX IF NOT EXISTS idx_official_route_manual_tasks_task_revision
  ON leadgen.official_route_manual_tasks(task_key,revision DESC);

CREATE INDEX IF NOT EXISTS idx_official_route_manual_tasks_queue
  ON leadgen.official_route_manual_tasks(manual_action_status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_official_route_manual_tasks_company_profile
  ON leadgen.official_route_manual_tasks(company_id,product_profile,created_at DESC);

CREATE OR REPLACE VIEW leadgen.official_route_manual_task_current AS
SELECT DISTINCT ON (task_key)
  id,task_type,task_key,revision,previous_revision_id,company_id,product_profile,
  route_type,official_url,official_contact,source_id,verified_at,captured_at,
  owner_identity,manual_action_status,outcome,qualification_basis,created_by,created_at
FROM leadgen.official_route_manual_tasks
ORDER BY task_key,revision DESC,created_at DESC,id DESC;

COMMENT ON TABLE leadgen.official_route_manual_tasks IS
  'Append-only manual queue for verified official supplier, vendor, procurement and contact routes; never grants outreach or management approval.';

COMMIT;
