BEGIN;

ALTER TABLE leadgen.outbound_messages
  ADD COLUMN IF NOT EXISTS send_reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_status text NOT NULL DEFAULT 'NOT_ATTEMPTED'
    CHECK(transport_status IN('NOT_ATTEMPTED','SMTP_ACCEPTED','SEND_AMBIGUOUS','SEND_FAILED')),
  ADD COLUMN IF NOT EXISTS receipt_evidence_status text NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK(receipt_evidence_status IN('UNCONFIRMED','RECEIVED_CONFIRMED','BOUNCED')),
  ADD COLUMN IF NOT EXISTS business_contact_status text NOT NULL DEFAULT 'NOT_SENT'
    CHECK(business_contact_status IN('NOT_SENT','SENT_NO_REPLY','REPLIED','OPTED_OUT','BOUNCED','SEND_AMBIGUOUS','SEND_FAILED'));

CREATE TABLE IF NOT EXISTS leadgen.outbound_ambiguous_send_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid NOT NULL REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('AMBIGUOUS','RECONCILED','NOT_FOUND','MANUAL_HOLD','SAFE_RETRY_RELEASED')),
  rfc_message_id text NOT NULL,
  provider_message_id text,
  evidence_digest text NOT NULL UNIQUE CHECK(evidence_digest~'^[0-9A-Fa-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_ambiguous_send_events_message
  ON leadgen.outbound_ambiguous_send_events(outbound_message_id,occurred_at DESC);
CREATE OR REPLACE FUNCTION leadgen.prevent_outbound_ambiguous_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbound ambiguous send events are append-only'; END; $$;
DROP TRIGGER IF EXISTS trg_outbound_ambiguous_send_events_immutable ON leadgen.outbound_ambiguous_send_events;
CREATE TRIGGER trg_outbound_ambiguous_send_events_immutable
BEFORE UPDATE OR DELETE ON leadgen.outbound_ambiguous_send_events
FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_outbound_ambiguous_event_mutation();

ALTER TABLE leadgen.outreach_recipients
  ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'NAMED_BUYER_EMAIL'
    CHECK(recipient_type IN('NAMED_BUYER_EMAIL','OFFICIAL_COMPANY_EMAIL','OFFICIAL_DEPARTMENT_EMAIL')),
  ADD COLUMN IF NOT EXISTS recipient_source_class text NOT NULL DEFAULT 'VERIFIED_DECISION_MAKER_CONTACT'
    CHECK(recipient_source_class IN('VERIFIED_DECISION_MAKER_CONTACT','OFFICIAL_COMPANY_ROUTE')),
  ADD COLUMN IF NOT EXISTS recipient_domain_verified boolean NOT NULL DEFAULT false;

ALTER TABLE leadgen.outreach_approvals
  ADD COLUMN IF NOT EXISTS opportunity_snapshot_id uuid REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS management_event_id uuid REFERENCES leadgen.business_opportunity_management_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_route_snapshot_hash text CHECK(recipient_route_snapshot_hash IS NULL OR recipient_route_snapshot_hash~'^[0-9A-Fa-f]{64}$'),
  ADD COLUMN IF NOT EXISTS provider_purpose text CHECK(provider_purpose IS NULL OR provider_purpose IN('COLD_OUTREACH','OPT_IN','TRANSACTIONAL')),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_outreach_approvals_active_binding
  ON leadgen.outreach_approvals(opportunity_snapshot_id,management_event_id,expires_at)
  WHERE decision='APPROVED';

COMMIT;
