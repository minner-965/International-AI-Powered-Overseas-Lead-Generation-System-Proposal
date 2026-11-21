BEGIN;

-- 079: deal value, customer grade, reminder rules and task priority (2026-11-21).
-- Additive only. One deal profile per company and owner (SIM = merchant_id NULL, or one merchant),
-- so it covers assessed opportunities and manually added companies alike.
--   crm_deal_profiles        amount, currency, expected close date, win probability (NULL = the
--                            stage default), customer grade A-D (NULL = not graded)
--   crm_deal_profile_events  every change to a deal profile (append-only)
--   crm_reminder_rules       per owner: days without follow-up / after a quote / after samples
--                            before a reminder task is created; NULL owner row = SIM
--   sales_tasks.priority     LOW / NORMAL / HIGH
--   sales_tasks.source_rule  the reminder rule that created the task; one open task per rule and company

CREATE TABLE IF NOT EXISTS leadgen.crm_deal_profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  owner_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  deal_amount numeric(14,2) CHECK(deal_amount IS NULL OR deal_amount>=0),
  deal_currency char(3) CHECK(deal_currency IS NULL OR deal_currency ~ '^[A-Z]{3}$'),
  expected_close_date date,
  win_probability smallint CHECK(win_probability IS NULL OR win_probability BETWEEN 0 AND 100),
  customer_grade text CHECK(customer_grade IS NULL OR customer_grade IN('A','B','C','D')),
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,owner_key),
  CHECK(deal_amount IS NULL OR deal_currency IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_profiles_owner ON leadgen.crm_deal_profiles(owner_key,company_id);

CREATE TABLE IF NOT EXISTS leadgen.crm_deal_profile_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_profile_id uuid NOT NULL REFERENCES leadgen.crm_deal_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  changes jsonb NOT NULL,
  changed_by text NOT NULL CHECK(char_length(changed_by) BETWEEN 1 AND 320),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_profile_events_company ON leadgen.crm_deal_profile_events(company_id,changed_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.crm_reminder_rules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  owner_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  no_follow_up_days smallint NOT NULL DEFAULT 7 CHECK(no_follow_up_days BETWEEN 1 AND 90),
  quoted_no_reply_days smallint NOT NULL DEFAULT 3 CHECK(quoted_no_reply_days BETWEEN 1 AND 90),
  sample_no_confirm_days smallint NOT NULL DEFAULT 7 CHECK(sample_no_confirm_days BETWEEN 1 AND 90),
  updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 320),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leadgen.sales_tasks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS source_rule text;
ALTER TABLE leadgen.sales_tasks DROP CONSTRAINT IF EXISTS sales_tasks_priority_check;
ALTER TABLE leadgen.sales_tasks ADD CONSTRAINT sales_tasks_priority_check CHECK(priority IN('LOW','NORMAL','HIGH'));
ALTER TABLE leadgen.sales_tasks DROP CONSTRAINT IF EXISTS sales_tasks_source_rule_check;
ALTER TABLE leadgen.sales_tasks ADD CONSTRAINT sales_tasks_source_rule_check
  CHECK(source_rule IS NULL OR source_rule IN('NO_FOLLOW_UP','QUOTED_NO_REPLY','SAMPLE_NO_CONFIRM'));
-- A reminder rule keeps at most one open task per company and owner.
CREATE UNIQUE INDEX IF NOT EXISTS sales_tasks_open_reminder_uq ON leadgen.sales_tasks
  (company_id,coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid),source_rule)
  WHERE source_rule IS NOT NULL AND task_status IN('OPEN','IN_PROGRESS');

CREATE OR REPLACE FUNCTION leadgen.guard_crm_deal_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM_DEAL_HISTORY_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS crm_deal_profile_events_history_guard ON leadgen.crm_deal_profile_events;
CREATE TRIGGER crm_deal_profile_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.crm_deal_profile_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_crm_deal_history();

COMMIT;
