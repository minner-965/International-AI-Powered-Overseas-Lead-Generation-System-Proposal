BEGIN;

-- 082: merchant self-service application and payment records (2026-11-22).
--   merchant_applications  a company asks for a trial on the public apply page; SIM approves (creates the
--                          merchant with the usual trial) or rejects with a reason. Never deleted.
--   merchant_payments      every payment SIM records for a merchant (append-only); recording one marks the
--                          merchant paid until paid_until. provider = MANUAL until an online provider is connected.
CREATE TABLE IF NOT EXISTS leadgen.merchant_applications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK(char_length(company_name) BETWEEN 1 AND 200),
  contact_name text NOT NULL CHECK(char_length(contact_name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 320),
  phone text CHECK(phone IS NULL OR char_length(phone) BETWEEN 3 AND 40),
  country text CHECK(country IS NULL OR char_length(country) BETWEEN 1 AND 80),
  referrer text CHECK(referrer IS NULL OR char_length(referrer) BETWEEN 1 AND 200),
  message text CHECK(message IS NULL OR char_length(message) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),
  decision_reason text CHECK(decision_reason IS NULL OR char_length(decision_reason) BETWEEN 1 AND 500),
  decided_by text,
  decided_at timestamptz,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  source_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='PENDING')=(decided_at IS NULL)),
  CHECK(status<>'REJECTED' OR decision_reason IS NOT NULL),
  CHECK(status<>'APPROVED' OR merchant_id IS NOT NULL)
);
-- One open application per email address.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_applications_pending_email_uq ON leadgen.merchant_applications(lower(email)) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_merchant_applications_status ON leadgen.merchant_applications(status,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.merchant_payments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK(amount>0),
  currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK(method IN('MANUAL','BANK','ALIPAY','WECHAT','STRIPE','OTHER')),
  provider text NOT NULL DEFAULT 'MANUAL',
  external_reference text CHECK(external_reference IS NULL OR char_length(external_reference) BETWEEN 1 AND 200),
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_until timestamptz NOT NULL,
  note text CHECK(note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  recorded_by text NOT NULL CHECK(char_length(recorded_by) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchant_payments_merchant ON leadgen.merchant_payments(merchant_id,paid_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_payments_external_uq ON leadgen.merchant_payments(provider,external_reference) WHERE external_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION leadgen.guard_merchant_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MERCHANT_PAYMENT_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS merchant_payments_history_guard ON leadgen.merchant_payments;
CREATE TRIGGER merchant_payments_history_guard BEFORE UPDATE OR DELETE ON leadgen.merchant_payments
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_merchant_payment_history();
-- Applications are decided once and never deleted.
CREATE OR REPLACE FUNCTION leadgen.guard_merchant_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MERCHANT_APPLICATION_KEPT: applications cannot be deleted'; END IF;
  IF OLD.status<>'PENDING' THEN RAISE EXCEPTION 'MERCHANT_APPLICATION_DECIDED: a decided application cannot change'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS merchant_applications_guard ON leadgen.merchant_applications;
CREATE TRIGGER merchant_applications_guard BEFORE UPDATE OR DELETE ON leadgen.merchant_applications
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_merchant_application();

COMMIT;
