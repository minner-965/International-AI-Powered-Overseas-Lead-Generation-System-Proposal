BEGIN;

-- 078: two-step sign-in with an authenticator app (TOTP, RFC 6238). Required for the SIM
-- administrator, optional for merchants (Simon 2026-11-11).
--   workspace_users.totp_secret_ciphertext   AES-256-GCM ciphertext of the active secret (key MERCHANT_SECRET_KEY)
--   workspace_users.totp_pending_ciphertext  secret shown during setup, active only after one correct code
--   workspace_users.totp_enabled_at          when two-step sign-in was switched on (NULL = off)
--   workspace_users.totp_last_step           last accepted 30-second step: the same code cannot be used twice
--   user_recovery_codes                      ten one-time recovery codes per enrolment (argon2 hashes)
--   two_factor_events                        every enable, disable, reset and recovery-code use (append-only)

ALTER TABLE leadgen.workspace_users
  ADD COLUMN IF NOT EXISTS totp_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS totp_pending_ciphertext text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS totp_last_step bigint;
ALTER TABLE leadgen.workspace_users DROP CONSTRAINT IF EXISTS workspace_users_totp_enabled_check;
ALTER TABLE leadgen.workspace_users ADD CONSTRAINT workspace_users_totp_enabled_check
  CHECK(totp_enabled_at IS NULL OR totp_secret_ciphertext IS NOT NULL);

CREATE TABLE IF NOT EXISTS leadgen.user_recovery_codes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES leadgen.workspace_users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL CHECK(code_hash LIKE '$argon2%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_open ON leadgen.user_recovery_codes(user_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS leadgen.two_factor_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES leadgen.workspace_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('ENABLED','DISABLED','RECOVERY_CODES_RENEWED','RECOVERY_CODE_USED','RESET_BY_ADMIN','RESET_BY_SCRIPT')),
  actor text NOT NULL CHECK(char_length(actor) BETWEEN 1 AND 320),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_two_factor_events_user ON leadgen.two_factor_events(user_id,recorded_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_two_factor_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TWO_FACTOR_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS two_factor_events_history_guard ON leadgen.two_factor_events;
CREATE TRIGGER two_factor_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.two_factor_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_two_factor_history();
-- Recovery codes are marked used or revoked, never deleted.
DROP TRIGGER IF EXISTS user_recovery_codes_delete_guard ON leadgen.user_recovery_codes;
CREATE TRIGGER user_recovery_codes_delete_guard BEFORE DELETE ON leadgen.user_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_two_factor_history();

COMMIT;
