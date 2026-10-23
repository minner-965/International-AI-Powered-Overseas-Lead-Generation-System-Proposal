BEGIN;

-- 067: login hardening. Durable sign-in failure counters so the sign-in rate
-- limiter survives restarts and is shared across worker processes, instead of
-- the previous per-process in-memory map. Additive only: no applied migration is
-- rewritten and no history row is changed.
--
-- One row per (kind, identifier). `kind` is 'email' (the submitted login address)
-- or 'ip' (the client address). `attempts` counts recent consecutive failures and
-- `locked_until` is set once the threshold is reached; a successful sign-in clears
-- the email's row. Rows are disposable operational counters, not business history.
CREATE TABLE IF NOT EXISTS leadgen.login_attempts (
  identifier text NOT NULL,
  kind text NOT NULL CHECK(kind IN('email','ip')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind, identifier)
);

-- Cleanup scan for expired/stale counters.
CREATE INDEX IF NOT EXISTS idx_login_attempts_updated_at ON leadgen.login_attempts(updated_at);

COMMIT;
