BEGIN;

-- WP-OQ10 is deliberately isolated from Company, Opportunity and production CRM.
-- The recipient is represented only by a SHA-256 digest; its address remains in
-- the ignored runtime allowlist.
CREATE TABLE IF NOT EXISTS leadgen.controlled_application_contexts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_label text NOT NULL CHECK(char_length(context_label) BETWEEN 1 AND 120),
  recipient_hash text NOT NULL CHECK(recipient_hash~'^[0-9A-Fa-f]{64}$'),
  provider text NOT NULL DEFAULT 'SMTP' CHECK(provider='SMTP'),
  provider_purpose text NOT NULL CHECK(provider_purpose IN('COLD_OUTREACH','OPT_IN','TRANSACTIONAL')),
  sender_identity text NOT NULL,
  reply_to text NOT NULL,
  max_messages integer NOT NULL CHECK(max_messages BETWEEN 1 AND 2),
  context_status text NOT NULL DEFAULT 'PENDING_MANAGEMENT_APPROVAL' CHECK(context_status IN(
    'PENDING_MANAGEMENT_APPROVAL','MANAGEMENT_APPROVED','DRAFT_PENDING','DRAFT_APPROVED',
    'SEND_QUEUED','SENDING','SENT','AWAITING_REPLY','REPLIED','OPTED_OUT','SEND_AMBIGUOUS','FAILED','CLOSED')),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[0-9A-Fa-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE(recipient_hash,snapshot_hash)
);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_approvals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  draft_id uuid,
  approval_stage text NOT NULL CHECK(approval_stage IN('MANAGEMENT','DRAFT')),
  draft_version integer,
  binding_digest text NOT NULL CHECK(binding_digest~'^[0-9A-Fa-f]{64}$'),
  decision text NOT NULL CHECK(decision IN('APPROVED','REJECTED','REVOKED')),
  approver_identity text NOT NULL,
  approver_role text NOT NULL,
  reason text,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK((approval_stage='MANAGEMENT' AND draft_id IS NULL AND draft_version IS NULL)
     OR (approval_stage='DRAFT' AND draft_id IS NOT NULL AND draft_version>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_controlled_application_approval_exact
  ON leadgen.controlled_application_approvals(context_id,approval_stage,coalesce(draft_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(draft_version,0),binding_digest,decision);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_drafts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK(version>0),
  subject text NOT NULL CHECK(char_length(subject) BETWEEN 1 AND 240),
  body_text text NOT NULL CHECK(char_length(body_text) BETWEEN 1 AND 12000),
  content_hash text NOT NULL CHECK(content_hash~'^[0-9A-Fa-f]{64}$'),
  draft_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(draft_status IN('PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(context_id,version),
  UNIQUE(context_id,content_hash)
);
ALTER TABLE leadgen.controlled_application_approvals DROP CONSTRAINT IF EXISTS controlled_application_approvals_draft_id_fkey;
ALTER TABLE leadgen.controlled_application_approvals ADD CONSTRAINT controlled_application_approvals_draft_id_fkey
  FOREIGN KEY(draft_id) REFERENCES leadgen.controlled_application_drafts(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL REFERENCES leadgen.controlled_application_drafts(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'SMTP' CHECK(provider='SMTP'),
  provider_purpose text NOT NULL CHECK(provider_purpose IN('COLD_OUTREACH','OPT_IN','TRANSACTIONAL')),
  idempotency_key text NOT NULL UNIQUE CHECK(idempotency_key~'^[0-9A-Fa-f]{64}$'),
  rfc_message_id text NOT NULL UNIQUE,
  message_key_header text NOT NULL UNIQUE,
  send_status text NOT NULL DEFAULT 'QUEUED' CHECK(send_status IN('QUEUED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS','FAILED','BLOCKED','CANCELLED')),
  provider_message_id text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(context_id,draft_id)
);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_attempts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES leadgen.controlled_application_messages(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  attempt_status text NOT NULL CHECK(attempt_status IN('STARTED','ACCEPTED','AMBIGUOUS','FAILED','BLOCKED')),
  provider_call_started_at timestamptz,
  completed_at timestamptz,
  response_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id,attempt_number)
);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_inbound_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  outbound_message_id uuid NOT NULL REFERENCES leadgen.controlled_application_messages(id) ON DELETE RESTRICT,
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash~'^[0-9A-Fa-f]{64}$'),
  folder_path text NOT NULL,
  imap_uidvalidity bigint NOT NULL,
  imap_uid bigint NOT NULL,
  internet_message_id text,
  from_address_hash text NOT NULL CHECK(from_address_hash~'^[0-9A-Fa-f]{64}$'),
  dsn_recipient_hash text CHECK(dsn_recipient_hash IS NULL OR dsn_recipient_hash~'^[0-9A-Fa-f]{64}$'),
  subject_sanitized text,
  body_text_sanitized text,
  classification_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(classification_input)='object'),
  reply_category text,
  classification_revision integer,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid)
);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_activities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  inbound_message_id uuid NOT NULL REFERENCES leadgen.controlled_application_inbound_messages(id) ON DELETE RESTRICT,
  activity_type text NOT NULL CHECK(activity_type IN('HUMAN_REPLY','OPT_OUT','AUTO_REPLY','OUT_OF_OFFICE','BOUNCE_DSN','REVIEW')),
  idempotency_key text NOT NULL UNIQUE CHECK(idempotency_key~'^[0-9A-Fa-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(inbound_message_id,activity_type)
);

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_suppressions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  recipient_hash text NOT NULL CHECK(recipient_hash~'^[0-9A-Fa-f]{64}$'),
  suppression_type text NOT NULL CHECK(suppression_type IN('OPT_OUT','HARD_BOUNCE')),
  source_inbound_message_id uuid NOT NULL REFERENCES leadgen.controlled_application_inbound_messages(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_controlled_application_suppression_active
  ON leadgen.controlled_application_suppressions(recipient_hash) WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS leadgen.controlled_application_imap_checkpoints(
  mailbox_identity_hash text NOT NULL CHECK(mailbox_identity_hash~'^[0-9A-Fa-f]{64}$'),
  folder_path text NOT NULL,
  uidvalidity bigint,
  last_processed_uid bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(mailbox_identity_hash,folder_path)
);

COMMIT;
