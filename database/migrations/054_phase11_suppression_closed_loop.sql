BEGIN;

ALTER TABLE leadgen.outreach_drafts DROP CONSTRAINT IF EXISTS outreach_drafts_draft_status_check;
ALTER TABLE leadgen.outreach_drafts ADD CONSTRAINT outreach_drafts_draft_status_check CHECK(draft_status IN('DRAFT','INVALID_DRAFT','PENDING_REVIEW','NEEDS_CHANGES','APPROVED','REJECTED','SUPERSEDED','EXPIRED','CANCELLED'));

ALTER TABLE leadgen.outreach_recipients DROP CONSTRAINT IF EXISTS outreach_recipients_lifecycle_status_check;
ALTER TABLE leadgen.outreach_recipients ADD CONSTRAINT outreach_recipients_lifecycle_status_check CHECK(lifecycle_status IN('ACTIVE','STALE','SUPERSEDED','INVALID','ARCHIVED','SUPPRESSED'));

CREATE TABLE IF NOT EXISTS leadgen.outreach_recipient_suppressions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  normalized_recipient_hash text NOT NULL CHECK(normalized_recipient_hash~'^[0-9A-Fa-f]{64}$'),
  suppression_type text NOT NULL CHECK(suppression_type IN('OPT_OUT','HARD_BOUNCE','COMPLAINT','MANUAL')),
  source_inbound_message_id uuid REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_recipient_suppressions_active
  ON leadgen.outreach_recipient_suppressions(company_id,normalized_recipient_hash,suppression_type) WHERE lifted_at IS NULL;

COMMIT;
