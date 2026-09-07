BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.imap_mailbox_checkpoints(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'SMTP',
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash~'^[0-9A-Fa-f]{64}$'),
  folder_path text NOT NULL,
  uidvalidity bigint NOT NULL CHECK(uidvalidity>0),
  last_processed_uid bigint NOT NULL DEFAULT 0 CHECK(last_processed_uid>=0),
  highest_modseq numeric,
  checkpoint_status text NOT NULL DEFAULT 'ACTIVE' CHECK(checkpoint_status IN('ACTIVE','RESET_RESCAN','ERROR')),
  reset_count integer NOT NULL DEFAULT 0 CHECK(reset_count>=0),
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,mailbox_identity_hash,folder_path)
);

CREATE TABLE IF NOT EXISTS leadgen.imap_checkpoint_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL REFERENCES leadgen.imap_mailbox_checkpoints(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('CREATED','ADVANCED','UIDVALIDITY_RESET','SYNC_FAILED')),
  prior_uidvalidity bigint,
  current_uidvalidity bigint NOT NULL,
  prior_uid bigint,
  current_uid bigint NOT NULL,
  event_digest text NOT NULL UNIQUE CHECK(event_digest~'^[0-9A-Fa-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leadgen.imap_message_receipts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash~'^[0-9A-Fa-f]{64}$'),
  folder_path text NOT NULL,
  uidvalidity bigint NOT NULL,
  imap_uid bigint NOT NULL,
  internet_message_id text,
  webhook_inbox_id uuid REFERENCES leadgen.email_webhook_inbox(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(mailbox_identity_hash,folder_path,uidvalidity,imap_uid)
);
CREATE INDEX IF NOT EXISTS idx_imap_message_receipts_message_id ON leadgen.imap_message_receipts(internet_message_id) WHERE internet_message_id IS NOT NULL;
CREATE OR REPLACE FUNCTION leadgen.prevent_imap_checkpoint_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'imap checkpoint events are append-only'; END; $$;
DROP TRIGGER IF EXISTS trg_imap_checkpoint_events_immutable ON leadgen.imap_checkpoint_events;
CREATE TRIGGER trg_imap_checkpoint_events_immutable BEFORE UPDATE OR DELETE ON leadgen.imap_checkpoint_events
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_imap_checkpoint_event_mutation();

ALTER TABLE leadgen.inbound_messages
  ADD COLUMN IF NOT EXISTS mailbox_identity_hash text CHECK(mailbox_identity_hash IS NULL OR mailbox_identity_hash~'^[0-9A-Fa-f]{64}$'),
  ADD COLUMN IF NOT EXISTS folder_path text,
  ADD COLUMN IF NOT EXISTS imap_uidvalidity bigint,
  ADD COLUMN IF NOT EXISTS imap_uid bigint,
  ADD COLUMN IF NOT EXISTS internet_message_id text,
  ADD COLUMN IF NOT EXISTS correlation_outbound_message_id uuid REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS correlation_method text CHECK(correlation_method IS NULL OR correlation_method IN('IN_REPLY_TO','REFERENCES','MESSAGE_KEY','PROVIDER_THREAD','REVIEW')),
  ADD COLUMN IF NOT EXISTS correlation_evidence_digest text CHECK(correlation_evidence_digest IS NULL OR correlation_evidence_digest~'^[0-9A-Fa-f]{64}$'),
  ADD COLUMN IF NOT EXISTS header_classification jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_messages_imap_identity ON leadgen.inbound_messages
  (provider,mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid)
  WHERE mailbox_identity_hash IS NOT NULL AND folder_path IS NOT NULL AND imap_uidvalidity IS NOT NULL AND imap_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_messages_internet_message_id ON leadgen.inbound_messages(provider,internet_message_id)
  WHERE internet_message_id IS NOT NULL;

ALTER TABLE leadgen.outbound_messages ADD COLUMN IF NOT EXISTS message_key_header text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_message_key_header ON leadgen.outbound_messages(message_key_header)
  WHERE message_key_header IS NOT NULL;

ALTER TABLE leadgen.reply_classifications
  ADD COLUMN IF NOT EXISTS reply_category text NOT NULL DEFAULT 'UNKNOWN_REVIEW'
    CHECK(reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE','OPT_OUT','AUTO_REPLY','OUT_OF_OFFICE','BOUNCE_DSN','UNKNOWN_REVIEW')),
  ADD COLUMN IF NOT EXISTS classification_revision integer NOT NULL DEFAULT 1 CHECK(classification_revision>0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_classifications_stable_revision
  ON leadgen.reply_classifications(inbound_message_id,classifier_version,classification_revision);

CREATE TABLE IF NOT EXISTS leadgen.opportunity_activities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  opportunity_snapshot_id uuid REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
  inbound_message_id uuid REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
  classification_id uuid REFERENCES leadgen.reply_classifications(id) ON DELETE RESTRICT,
  activity_type text NOT NULL CHECK(activity_type IN('CONTACTED','REPLIED','AUTO_REPLY','OPTED_OUT','BOUNCED','FOLLOW_UP_REQUIRED')),
  owner_identity text,
  due_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.opportunity_crm_states(
  opportunity_snapshot_id uuid PRIMARY KEY REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  funnel_status text NOT NULL CHECK(funnel_status IN('CONTACTED','REPLIED','OPTED_OUT','BOUNCED')),
  owner_identity text,
  next_action text,
  next_action_due_at timestamptz,
  source_inbound_message_id uuid REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leadgen.sales_tasks
  ADD COLUMN IF NOT EXISTS opportunity_snapshot_id uuid REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS classification_id uuid REFERENCES leadgen.reply_classifications(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS effect_key text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tasks_effect_key ON leadgen.sales_tasks(effect_key) WHERE effect_key IS NOT NULL;

COMMIT;
