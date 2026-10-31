BEGIN;

-- 076: reply correlation when the mail server rewrites the Message-ID (acceptance test 2026-10-27, bug 1).
-- Some providers (seen with mail.oqumail.com on 587) replace the Message-ID SIM sets and drop the
-- X-DPV-Message-Key header. A reply then quotes the server's ID in In-Reply-To/References and no
-- outbound row matched it. Additive only; every new table is append-only (no UPDATE, no DELETE):
--   outbound_message_id_aliases     the Message-ID actually stored in the sender's Sent folder (one row
--                                   per alias; an alias belongs to exactly one outbound message)
--   outbound_sent_lookup_attempts   each Sent-folder lookup and its outcome (retry/backoff ledger)
--   inbound_correlation_events      every later correlation change of an inbound reply (who, how, from/to)
-- inbound_messages.correlation_method gains IN_REPLY_TO_ALIAS, REFERENCES_ALIAS and SUBJECT_FALLBACK;
-- inbound_messages.correlation_confidence marks SUBJECT_FALLBACK matches LOW (header matches HIGH).

CREATE TABLE IF NOT EXISTS leadgen.outbound_message_id_aliases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid NOT NULL REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  alias_message_id text NOT NULL CHECK(alias_message_id ~ '^<[^<>\s]+>$' AND char_length(alias_message_id)<=500),
  alias_source text NOT NULL CHECK(alias_source IN('SENT_FOLDER_LOOKUP')),
  match_method text NOT NULL CHECK(match_method IN('MESSAGE_KEY_HEADER','ENVELOPE_SUBJECT_TIME_BODY','ENVELOPE_SUBJECT_TIME_BODY_PREFIX')),
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash ~ '^[0-9a-f]{64}$'),
  folder_path text NOT NULL,
  imap_uidvalidity bigint,
  imap_uid bigint,
  body_sha256 text CHECK(body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alias_message_id),
  UNIQUE(outbound_message_id,alias_message_id)
);
CREATE INDEX IF NOT EXISTS idx_outbound_message_id_aliases_outbound ON leadgen.outbound_message_id_aliases(outbound_message_id);

CREATE TABLE IF NOT EXISTS leadgen.outbound_sent_lookup_attempts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid NOT NULL REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash ~ '^[0-9a-f]{64}$'),
  lookup_status text NOT NULL CHECK(lookup_status IN('MATCHED','SAME_ID','NO_MATCH','MULTIPLE_MATCHES','LOOKUP_FAILED')),
  folder_path text,
  code text,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_sent_lookup_attempts_outbound ON leadgen.outbound_sent_lookup_attempts(outbound_message_id,attempted_at DESC);

ALTER TABLE leadgen.inbound_messages DROP CONSTRAINT IF EXISTS inbound_messages_correlation_method_check;
ALTER TABLE leadgen.inbound_messages ADD CONSTRAINT inbound_messages_correlation_method_check
  CHECK(correlation_method IS NULL OR correlation_method IN('IN_REPLY_TO','REFERENCES','MESSAGE_KEY','PROVIDER_THREAD',
    'IN_REPLY_TO_ALIAS','REFERENCES_ALIAS','SUBJECT_FALLBACK','REVIEW'));
ALTER TABLE leadgen.inbound_messages ADD COLUMN IF NOT EXISTS correlation_confidence text
  CHECK(correlation_confidence IS NULL OR correlation_confidence IN('HIGH','LOW'));

CREATE TABLE IF NOT EXISTS leadgen.inbound_correlation_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id uuid NOT NULL REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
  previous_status text NOT NULL,
  correlation_status text NOT NULL CHECK(correlation_status IN('MATCHED','REVIEW','UNMATCHED')),
  correlation_method text NOT NULL,
  correlation_confidence text CHECK(correlation_confidence IS NULL OR correlation_confidence IN('HIGH','LOW')),
  outbound_message_id uuid REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  thread_id uuid REFERENCES leadgen.outreach_threads(id) ON DELETE RESTRICT,
  recorded_by text NOT NULL CHECK(char_length(recorded_by) BETWEEN 1 AND 120),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[0-9a-f]{64}$'),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(inbound_message_id,correlation_status,outbound_message_id)
);

CREATE OR REPLACE FUNCTION leadgen.guard_reply_correlation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REPLY_CORRELATION_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS outbound_message_id_aliases_history_guard ON leadgen.outbound_message_id_aliases;
CREATE TRIGGER outbound_message_id_aliases_history_guard BEFORE UPDATE OR DELETE ON leadgen.outbound_message_id_aliases
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_reply_correlation_history();
DROP TRIGGER IF EXISTS outbound_sent_lookup_attempts_history_guard ON leadgen.outbound_sent_lookup_attempts;
CREATE TRIGGER outbound_sent_lookup_attempts_history_guard BEFORE UPDATE OR DELETE ON leadgen.outbound_sent_lookup_attempts
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_reply_correlation_history();
DROP TRIGGER IF EXISTS inbound_correlation_events_history_guard ON leadgen.inbound_correlation_events;
CREATE TRIGGER inbound_correlation_events_history_guard BEFORE UPDATE OR DELETE ON leadgen.inbound_correlation_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_reply_correlation_history();

COMMIT;
