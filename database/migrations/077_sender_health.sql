BEGIN;

-- 077: sending health for each mailbox (optimization plan batch 4, D3/D4).
-- A mailbox (SIM's own sender, or one merchant's mailbox) is paused automatically when, among
-- its last 100 messages sent since it was last resumed, the hard-bounce rate passes 3% or a
-- complaint arrives. A person resumes it. Every pause and resume is kept (append-only), and
-- the health window restarts at the latest resume so old bounces do not pause it again.
--   sender_key   'SIM' for SIM's own sender, otherwise the merchant id as text
--   event_type   PAUSED (automatic) or RESUMED (by a person)
--   reason       BOUNCE_RATE_HIGH / COMPLAINT_RECEIVED for a pause; free text for a resume
--   metrics      the numbers the decision used (sent, hard_bounces, complaints, bounce_rate)

CREATE TABLE IF NOT EXISTS leadgen.sender_health_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_key text NOT NULL CHECK(sender_key='SIM' OR sender_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('PAUSED','RESUMED')),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 160),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL CHECK(char_length(actor) BETWEEN 1 AND 160),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK((sender_key='SIM' AND merchant_id IS NULL) OR (sender_key<>'SIM' AND merchant_id::text=sender_key))
);
CREATE INDEX IF NOT EXISTS idx_sender_health_events_sender ON leadgen.sender_health_events(sender_key,event_type,recorded_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_sender_health_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SENDER_HEALTH_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS sender_health_events_history_guard ON leadgen.sender_health_events;
CREATE TRIGGER sender_health_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.sender_health_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_sender_health_history();

-- Health and pacing read each sender's recent messages by sent time.
CREATE INDEX IF NOT EXISTS idx_outbound_messages_sim_sent ON leadgen.outbound_messages(sent_at DESC) WHERE merchant_id IS NULL AND sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbound_messages_merchant_sent ON leadgen.outbound_messages(merchant_id,sent_at DESC) WHERE merchant_id IS NOT NULL AND sent_at IS NOT NULL;

COMMIT;
