BEGIN;

ALTER TABLE leadgen.outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_provider_check,
  DROP CONSTRAINT IF EXISTS outbound_messages_send_status_check;
ALTER TABLE leadgen.outbound_messages
  ADD CONSTRAINT outbound_messages_provider_check CHECK(provider IN('NONE','SMTP','RESEND','GMAIL_API')),
  ADD CONSTRAINT outbound_messages_send_status_check CHECK(send_status IN(
    'QUEUED','BLOCKED','SENDING','AMBIGUOUS','PROVIDER_ACCEPTED','DELIVERED','SOFT_BOUNCED','HARD_BOUNCED','FAILED','CANCELLED')),
  ADD COLUMN IF NOT EXISTS send_execution_key text,
  ADD COLUMN IF NOT EXISTS rfc_message_id text,
  ADD COLUMN IF NOT EXISTS provider_thread_id text,
  ADD COLUMN IF NOT EXISTS provider_draft_id text,
  ADD COLUMN IF NOT EXISTS ambiguous_since timestamptz;

UPDATE leadgen.outbound_messages SET send_execution_key=idempotency_key WHERE send_execution_key IS NULL;
ALTER TABLE leadgen.outbound_messages ALTER COLUMN send_execution_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_send_execution_key
  ON leadgen.outbound_messages(send_execution_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_rfc_message_id
  ON leadgen.outbound_messages(rfc_message_id) WHERE rfc_message_id IS NOT NULL;

ALTER TABLE leadgen.outbound_message_attempts
  DROP CONSTRAINT IF EXISTS outbound_message_attempts_attempt_status_check;
ALTER TABLE leadgen.outbound_message_attempts
  ADD CONSTRAINT outbound_message_attempts_attempt_status_check CHECK(attempt_status IN(
    'STARTED','BLOCKED','AMBIGUOUS','RETRYABLE_ERROR','PERMANENT_ERROR','ACCEPTED'));

ALTER TABLE leadgen.email_message_events
  DROP CONSTRAINT IF EXISTS email_message_events_event_type_check;
ALTER TABLE leadgen.email_message_events
  ADD CONSTRAINT email_message_events_event_type_check CHECK(event_type IN(
    'QUEUED','PROVIDER_ACCEPTED','RECIPIENT_OBSERVED_RECEIVED','PROVIDER_DELIVERED','DELIVERED',
    'DELIVERY_DELAYED','SOFT_BOUNCED','HARD_BOUNCED','COMPLAINED','OPTED_OUT','OPENED','CLICKED','REPLIED','FAILED','BLOCKED'));

CREATE TABLE IF NOT EXISTS leadgen.gmail_mailbox_checkpoints(
  mailbox_email_hash text PRIMARY KEY CHECK(mailbox_email_hash~'^[0-9A-Fa-f]{64}$'),
  history_id text,
  last_success_at timestamptz,
  last_status text NOT NULL DEFAULT 'PENDING' CHECK(last_status IN('PENDING','COMPLETED','FAILED','DISABLED')),
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.gmail_ambiguous_send_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid NOT NULL REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('AMBIGUOUS','RECONCILED','NOT_FOUND','RETRY_RELEASED')),
  rfc_message_id text NOT NULL,
  provider_message_id text,
  provider_thread_id text,
  event_digest text NOT NULL UNIQUE CHECK(event_digest~'^[0-9A-Fa-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gmail_ambiguous_send_events_message
  ON leadgen.gmail_ambiguous_send_events(outbound_message_id,occurred_at DESC);

CREATE OR REPLACE FUNCTION leadgen.prevent_gmail_ambiguous_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gmail ambiguous send events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_gmail_ambiguous_send_events_immutable ON leadgen.gmail_ambiguous_send_events;
CREATE TRIGGER trg_gmail_ambiguous_send_events_immutable
BEFORE UPDATE OR DELETE ON leadgen.gmail_ambiguous_send_events
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_gmail_ambiguous_event_mutation();

COMMIT;
