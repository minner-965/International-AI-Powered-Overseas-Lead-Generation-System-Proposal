BEGIN;

-- 070: manually added companies and contacts, human-approved first touch for them, the
-- "test company" flag and first-touch test sends (optimization plan batch 2: B1, B2).
-- Additive only: no applied migration is rewritten and no history row is changed.

-- A contact typed in by a person is marked as such (never as an observed or provider route).
ALTER TABLE leadgen.decision_maker_contacts DROP CONSTRAINT IF EXISTS decision_maker_contacts_evidence_origin_check;
ALTER TABLE leadgen.decision_maker_contacts ADD CONSTRAINT decision_maker_contacts_evidence_origin_check
  CHECK (evidence_origin IN ('OFFICIAL_SITE_OBSERVED','PROVIDER_FOUND','PATTERN_CANDIDATE','OTHER_PUBLIC_OBSERVED','MANUAL_ENTRY'));

-- A merchant that adds a company itself owns it like a research or SIM assignment.
ALTER TABLE leadgen.merchant_companies DROP CONSTRAINT IF EXISTS merchant_companies_source_check;
ALTER TABLE leadgen.merchant_companies ADD CONSTRAINT merchant_companies_source_check
  CHECK (source IN ('RESEARCH','ADMIN','MANUAL'));

-- One row per manually added company (companies.data_origin = 'manual'). Append-only.
CREATE TABLE IF NOT EXISTS leadgen.manual_company_entries(
  company_id uuid PRIMARY KEY REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  created_by_merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  category_scope_id uuid NOT NULL REFERENCES leadgen.dpv_product_category_scopes(id) ON DELETE RESTRICT,
  market_code text NOT NULL REFERENCES leadgen.research_market_registry(market_code) ON DELETE RESTRICT,
  company_type text NOT NULL CHECK (company_type IN ('IMPORTER','WHOLESALER','DISTRIBUTOR','RETAIL_CHAIN','DEPARTMENT_STORE','RETAILER','ONLINE_RETAILER','BRAND','OTHER')),
  notes text CHECK (notes IS NULL OR char_length(notes)<=2000),
  created_by text NOT NULL CHECK (btrim(created_by)<>'' AND char_length(created_by)<=320),
  created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS manual_company_entries_append_only ON leadgen.manual_company_entries;
CREATE TRIGGER manual_company_entries_append_only BEFORE UPDATE OR DELETE ON leadgen.manual_company_entries
  FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase7_audit_mutation();

-- "测试企业 / Test company": latest row per company wins. Append-only.
CREATE TABLE IF NOT EXISTS leadgen.company_test_flags(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  is_test boolean NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason)<=500),
  set_by text NOT NULL CHECK (btrim(set_by)<>'' AND char_length(set_by)<=320),
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_test_flags_current_idx ON leadgen.company_test_flags(company_id,set_at DESC,id DESC);
DROP TRIGGER IF EXISTS company_test_flags_append_only ON leadgen.company_test_flags;
CREATE TRIGGER company_test_flags_append_only BEFORE UPDATE OR DELETE ON leadgen.company_test_flags
  FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase7_audit_mutation();

-- Pipeline stage of a manual company (manual companies have no assessment snapshot, so the
-- snapshot-based opportunity_crm_states cannot hold them). Per owner: SIM (NULL) or a merchant.
CREATE TABLE IF NOT EXISTS leadgen.manual_company_stage_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.manual_company_entries(company_id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  merchant_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  stage text NOT NULL CHECK (stage IN ('NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON','LOST')),
  lost_reason text CHECK (lost_reason IS NULL OR char_length(lost_reason) BETWEEN 1 AND 500),
  note text CHECK (note IS NULL OR char_length(note)<=1000),
  changed_by text NOT NULL CHECK (btrim(changed_by)<>'' AND char_length(changed_by)<=320),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage<>'LOST' OR lost_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS manual_company_stage_events_current_idx ON leadgen.manual_company_stage_events(company_id,merchant_key,changed_at DESC,id DESC);
DROP TRIGGER IF EXISTS manual_company_stage_events_append_only ON leadgen.manual_company_stage_events;
CREATE TRIGGER manual_company_stage_events_append_only BEFORE UPDATE OR DELETE ON leadgen.manual_company_stage_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase7_audit_mutation();

-- First-touch drafts for manual companies: created from the approved template, sent only after a
-- person approves. Identity columns are immutable; only the status moves forward.
CREATE TABLE IF NOT EXISTS leadgen.manual_first_touch_drafts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.manual_company_entries(company_id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  merchant_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  decision_maker_contact_id uuid NOT NULL REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
  normalized_recipient text NOT NULL CHECK (normalized_recipient ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  template_set_key text NOT NULL,
  template_key text NOT NULL CHECK (template_key IN ('A_NAMED_BUYER','B_IMPORTER_WHOLESALER_DISTRIBUTOR','C_OFFICIAL_GENERIC_MAILBOX')),
  subject text NOT NULL CHECK (btrim(subject)<>''),
  body_text text NOT NULL CHECK (btrim(body_text)<>''),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  sender_identity text NOT NULL,
  reply_to text NOT NULL,
  product_profile text NOT NULL,
  is_test_company boolean NOT NULL DEFAULT false,
  draft_status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (draft_status IN ('PENDING_APPROVAL','SENDING','SENT','BLOCKED','DISCARDED','FAILED','AMBIGUOUS')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  first_touch_reservation_id uuid UNIQUE REFERENCES leadgen.phase13_first_touch_reservations(id) ON DELETE RESTRICT,
  outbound_message_id uuid UNIQUE REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one open draft per company and sender.
CREATE UNIQUE INDEX IF NOT EXISTS manual_first_touch_drafts_open_idx ON leadgen.manual_first_touch_drafts(company_id,merchant_key)
  WHERE draft_status IN ('PENDING_APPROVAL','SENDING');
CREATE OR REPLACE FUNCTION leadgen.guard_manual_first_touch_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'manual_first_touch_drafts rows are kept'; END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.decision_maker_contact_id IS DISTINCT FROM OLD.decision_maker_contact_id OR NEW.normalized_recipient IS DISTINCT FROM OLD.normalized_recipient
    OR NEW.template_key IS DISTINCT FROM OLD.template_key OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body_text IS DISTINCT FROM OLD.body_text
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.sender_identity IS DISTINCT FROM OLD.sender_identity
    OR NEW.reply_to IS DISTINCT FROM OLD.reply_to OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'Manual first-touch draft identity is immutable'; END IF;
  IF OLD.draft_status NOT IN ('PENDING_APPROVAL','SENDING') AND NEW.draft_status IS DISTINCT FROM OLD.draft_status
  THEN RAISE EXCEPTION 'A decided manual first-touch draft cannot change status'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manual_first_touch_drafts_guard ON leadgen.manual_first_touch_drafts;
CREATE TRIGGER manual_first_touch_drafts_guard BEFORE UPDATE OR DELETE ON leadgen.manual_first_touch_drafts
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_manual_first_touch_draft();

-- Manual companies never enter automatic first touch: a first-touch reservation for a manual
-- company must come from an approved manual draft (the database refuses any other source).
CREATE OR REPLACE FUNCTION leadgen.guard_manual_company_first_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM leadgen.manual_company_entries e WHERE e.company_id=NEW.company_id)
    AND NOT EXISTS(SELECT 1 FROM leadgen.manual_first_touch_drafts d
      WHERE d.id::text=coalesce(NEW.eligibility_snapshot->>'manual_first_touch_draft_id','')
        AND d.company_id=NEW.company_id AND d.merchant_id IS NOT DISTINCT FROM NEW.merchant_id AND d.draft_status='SENDING')
  THEN RAISE EXCEPTION 'MANUAL_COMPANY_REQUIRES_APPROVED_DRAFT' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase13_first_touch_manual_company_guard ON leadgen.phase13_first_touch_reservations;
CREATE TRIGGER phase13_first_touch_manual_company_guard BEFORE INSERT ON leadgen.phase13_first_touch_reservations
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_manual_company_first_touch();

-- "发测试首封 / Send test first email": never a first-touch reservation or outbound message, never
-- counted in quotas or "already contacted". Identity is immutable; only the result is filled in.
CREATE TABLE IF NOT EXISTS leadgen.first_touch_test_sends(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  merchant_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  requested_by text NOT NULL CHECK (btrim(requested_by)<>'' AND char_length(requested_by)<=320),
  recipient text NOT NULL CHECK (recipient ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  sender_identity text NOT NULL,
  company_id uuid REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  template_set_key text NOT NULL,
  template_key text NOT NULL CHECK (template_key IN ('A_NAMED_BUYER','B_IMPORTER_WHOLESALER_DISTRIBUTOR','C_OFFICIAL_GENERIC_MAILBOX')),
  variables_source text NOT NULL CHECK (variables_source IN ('COMPANY','SAMPLE','COMPANY_WITH_SAMPLE')),
  subject text NOT NULL CHECK (subject LIKE '[TEST] %'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  send_status text NOT NULL DEFAULT 'SENDING' CHECK (send_status IN ('SENDING','PROVIDER_ACCEPTED','FAILED','BLOCKED','AMBIGUOUS')),
  result_code text CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9_]{1,80}$'),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS first_touch_test_sends_sender_day_idx ON leadgen.first_touch_test_sends(merchant_key,created_at DESC);
CREATE OR REPLACE FUNCTION leadgen.guard_first_touch_test_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'first_touch_test_sends rows are kept'; END IF;
  IF OLD.send_status<>'SENDING' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.sender_identity IS DISTINCT FROM OLD.sender_identity OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.template_key IS DISTINCT FROM OLD.template_key OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'first_touch_test_sends is append-only; only a SENDING row receives its result'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS first_touch_test_sends_guard ON leadgen.first_touch_test_sends;
CREATE TRIGGER first_touch_test_sends_guard BEFORE UPDATE OR DELETE ON leadgen.first_touch_test_sends
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_first_touch_test_send();

COMMIT;
