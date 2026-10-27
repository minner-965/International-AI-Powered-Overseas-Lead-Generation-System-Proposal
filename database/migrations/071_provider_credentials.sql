BEGIN;

-- 071: provider credentials (optimization plan batch 2: B9). Additive only.
-- System (SIM) and merchant-owned API keys for search, email verification, Feishu, translation
-- and the low-cost model. Values are AES-256-GCM ciphertext produced by the application
-- (src/merchant/secretBox.js, key MERCHANT_SECRET_KEY, which never reaches the database).
-- History is append-only: replacing a key revokes the active row and inserts a new one;
-- rows are never deleted and only revoked_at / revoked_by may be set, once.

CREATE TABLE IF NOT EXISTS leadgen.provider_credentials(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope text NOT NULL CHECK(owner_scope IN ('SIM','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id),
  provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  field text NOT NULL CHECK(field ~ '^[a-z][a-z0-9_]{1,39}$'),
  ciphertext text NOT NULL CHECK(ciphertext ~ '^v1:' AND char_length(ciphertext)<=16384),
  last4 text CHECK(last4 IS NULL OR char_length(last4)<=4),
  set_by text NOT NULL CHECK(char_length(set_by) BETWEEN 1 AND 320),
  set_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text CHECK(revoked_by IS NULL OR char_length(revoked_by)<=320),
  CONSTRAINT provider_credentials_owner_pair CHECK((owner_scope='SIM')=(merchant_id IS NULL)),
  CONSTRAINT provider_credentials_revoke_pair CHECK((revoked_at IS NULL)=(revoked_by IS NULL))
);

-- One active row per owner / provider / field.
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_active_sim_idx
  ON leadgen.provider_credentials(provider,field) WHERE revoked_at IS NULL AND owner_scope='SIM';
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_active_merchant_idx
  ON leadgen.provider_credentials(merchant_id,provider,field) WHERE revoked_at IS NULL AND owner_scope='MERCHANT';
CREATE INDEX IF NOT EXISTS provider_credentials_history_idx
  ON leadgen.provider_credentials(owner_scope,merchant_id,provider,set_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_provider_credentials_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'PROVIDER_CREDENTIALS_APPEND_ONLY: credential history cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL
     OR (NEW.id,NEW.owner_scope,NEW.merchant_id,NEW.provider,NEW.field,NEW.ciphertext,NEW.last4,NEW.set_by,NEW.set_at)
        IS DISTINCT FROM (OLD.id,OLD.owner_scope,OLD.merchant_id,OLD.provider,OLD.field,OLD.ciphertext,OLD.last4,OLD.set_by,OLD.set_at) THEN
    RAISE EXCEPTION 'PROVIDER_CREDENTIALS_APPEND_ONLY: only an active credential can be revoked';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS provider_credentials_history_guard ON leadgen.provider_credentials;
CREATE TRIGGER provider_credentials_history_guard BEFORE UPDATE OR DELETE ON leadgen.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_provider_credentials_history();

-- Result of each "test" button press (append-only; no secret material).
CREATE TABLE IF NOT EXISTS leadgen.provider_credential_tests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope text NOT NULL CHECK(owner_scope IN ('SIM','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id),
  provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  credential_source text NOT NULL CHECK(credential_source IN ('MERCHANT','SIM','ENV','NONE')),
  ok boolean NOT NULL,
  result_code text NOT NULL CHECK(result_code ~ '^[A-Z0-9_]{1,80}$'),
  tested_by text NOT NULL CHECK(char_length(tested_by) BETWEEN 1 AND 320),
  tested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_credential_tests_owner_pair CHECK((owner_scope='SIM')=(merchant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS provider_credential_tests_latest_idx
  ON leadgen.provider_credential_tests(owner_scope,merchant_id,provider,tested_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_provider_credential_tests_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PROVIDER_CREDENTIAL_TESTS_APPEND_ONLY: test history cannot be changed';
END $$;
DROP TRIGGER IF EXISTS provider_credential_tests_history_guard ON leadgen.provider_credential_tests;
CREATE TRIGGER provider_credential_tests_history_guard BEFORE UPDATE OR DELETE ON leadgen.provider_credential_tests
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_provider_credential_tests_history();

COMMIT;
