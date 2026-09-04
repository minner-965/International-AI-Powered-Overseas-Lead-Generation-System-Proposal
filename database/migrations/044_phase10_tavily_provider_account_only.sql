BEGIN;

-- A NULL limit means that DPV does not impose an internal credit ceiling.
-- Provider usage events and reservations remain fully audited and idempotent.
ALTER TABLE leadgen.provider_credit_ledger
  ALTER COLUMN credit_limit_units DROP NOT NULL;

ALTER TABLE leadgen.provider_credit_ledger
  DROP CONSTRAINT IF EXISTS provider_credit_ledger_credit_limit_units_check;

ALTER TABLE leadgen.provider_credit_ledger
  DROP CONSTRAINT IF EXISTS provider_credit_ledger_check;

ALTER TABLE leadgen.provider_credit_ledger
  ADD CONSTRAINT provider_credit_ledger_credit_limit_units_check
    CHECK (credit_limit_units IS NULL OR credit_limit_units >= 0),
  ADD CONSTRAINT provider_credit_ledger_balance_check
    CHECK (credit_limit_units IS NULL OR reserved_units + used_units <= credit_limit_units);

COMMIT;
