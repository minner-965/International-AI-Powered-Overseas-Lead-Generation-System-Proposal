BEGIN;

-- 081: follow-up rules round two (2026-11-22).
--   crm_exchange_rates        manual rates per owner (NULL owner = SIM): 1 unit of currency = rate x base currency
--   crm_exchange_rate_events  every change to a rate (append-only)
--   crm_deal_profiles.won_confirmation / _note / won_confirmed_at   how the customer confirmed a won deal
--   sales_tasks.source_event_at   the event a reminder counts from (stage change, last contact, next-action date);
--                                 one reminder per rule and event, so a new quote starts a new cycle
--   sales_tasks.source_rule       adds NEXT_ACTION_DUE (the planned next contact date has passed)
CREATE TABLE IF NOT EXISTS leadgen.crm_exchange_rates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  owner_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  base_currency char(3) NOT NULL CHECK(base_currency ~ '^[A-Z]{3}$'),
  currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  rate numeric(18,8) NOT NULL CHECK(rate>0),
  updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 320),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(currency<>base_currency),
  UNIQUE(owner_key,currency)
);
CREATE TABLE IF NOT EXISTS leadgen.crm_exchange_rate_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  base_currency char(3) NOT NULL,
  rates jsonb NOT NULL,
  changed_by text NOT NULL CHECK(char_length(changed_by) BETWEEN 1 AND 320),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_exchange_rate_events_owner ON leadgen.crm_exchange_rate_events(merchant_id,changed_at DESC);

ALTER TABLE leadgen.crm_deal_profiles
  ADD COLUMN IF NOT EXISTS won_confirmation text CHECK(won_confirmation IS NULL OR won_confirmation IN('PO','DEPOSIT','CONTRACT','PAYMENT','OTHER')),
  ADD COLUMN IF NOT EXISTS won_confirmation_note text CHECK(won_confirmation_note IS NULL OR char_length(won_confirmation_note) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS won_confirmed_at timestamptz;

ALTER TABLE leadgen.sales_tasks ADD COLUMN IF NOT EXISTS source_event_at timestamptz;
ALTER TABLE leadgen.sales_tasks DROP CONSTRAINT IF EXISTS sales_tasks_source_rule_check;
ALTER TABLE leadgen.sales_tasks ADD CONSTRAINT sales_tasks_source_rule_check
  CHECK(source_rule IS NULL OR source_rule IN('NO_FOLLOW_UP','QUOTED_NO_REPLY','SAMPLE_NO_CONFIRM','NEXT_ACTION_DUE'));
CREATE INDEX IF NOT EXISTS idx_sales_tasks_reminder_event ON leadgen.sales_tasks(company_id,source_rule,source_event_at) WHERE source_rule IS NOT NULL;

CREATE OR REPLACE FUNCTION leadgen.guard_crm_exchange_rate_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM_EXCHANGE_RATE_HISTORY_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS crm_exchange_rate_events_history_guard ON leadgen.crm_exchange_rate_events;
CREATE TRIGGER crm_exchange_rate_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.crm_exchange_rate_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_crm_exchange_rate_history();

COMMIT;
