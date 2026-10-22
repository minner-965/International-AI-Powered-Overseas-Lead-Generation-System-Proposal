BEGIN;

-- Sales pipeline on top of the Phase 11 email funnel. funnel_status keeps its
-- email meaning; pipeline_stage is the sales stage people work with. Existing
-- rows receive a stage derived from their funnel status; no history is changed.
ALTER TABLE leadgen.opportunity_crm_states
  DROP CONSTRAINT IF EXISTS opportunity_crm_states_funnel_status_check,
  ADD CONSTRAINT opportunity_crm_states_funnel_status_check
    CHECK(funnel_status IN('NOT_CONTACTED','CONTACTED','REPLIED','OPTED_OUT','BOUNCED')),
  ADD COLUMN IF NOT EXISTS pipeline_stage text
    CHECK(pipeline_stage IN('NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON','LOST')),
  ADD COLUMN IF NOT EXISTS lost_reason text CHECK(lost_reason IS NULL OR char_length(lost_reason) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_changed_by text,
  ADD COLUMN IF NOT EXISTS stage_note text CHECK(stage_note IS NULL OR char_length(stage_note)<=1000);

CREATE TABLE IF NOT EXISTS leadgen.opportunity_stage_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_snapshot_id uuid NOT NULL REFERENCES leadgen.business_opportunity_decision_snapshots(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  from_stage text,
  to_stage text NOT NULL,
  lost_reason text,
  note text,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_stage_history_company ON leadgen.opportunity_stage_history(company_id,changed_at DESC);

CREATE OR REPLACE FUNCTION leadgen.derive_pipeline_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.pipeline_stage IS NULL THEN
      NEW.pipeline_stage:=CASE NEW.funnel_status
        WHEN 'REPLIED' THEN 'REPLIED' WHEN 'OPTED_OUT' THEN 'LOST'
        WHEN 'CONTACTED' THEN 'CONTACTED' ELSE 'NEW' END;
      IF NEW.funnel_status='OPTED_OUT' THEN NEW.lost_reason:=coalesce(NEW.lost_reason,'OPTED_OUT'); END IF;
    END IF;
  ELSIF NEW.pipeline_stage IS NOT DISTINCT FROM OLD.pipeline_stage AND NEW.funnel_status IS DISTINCT FROM OLD.funnel_status THEN
    -- Email events advance early stages only; a stage set by a person is kept.
    IF NEW.funnel_status='REPLIED' AND OLD.pipeline_stage IN('NEW','CONTACTED') THEN NEW.pipeline_stage:='REPLIED';
    ELSIF NEW.funnel_status='CONTACTED' AND OLD.pipeline_stage='NEW' THEN NEW.pipeline_stage:='CONTACTED';
    ELSIF NEW.funnel_status='OPTED_OUT' AND OLD.pipeline_stage<>'WON' THEN NEW.pipeline_stage:='LOST';NEW.lost_reason:='OPTED_OUT';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    -- A change without a new actor/note was made by the email funnel, not a person.
    IF TG_OP='UPDATE' AND NEW.stage_changed_by IS NOT DISTINCT FROM OLD.stage_changed_by THEN
      NEW.stage_changed_by:='system';NEW.stage_note:=NULL;
    END IF;
    IF TG_OP='UPDATE' AND NEW.pipeline_stage<>'LOST' THEN NEW.lost_reason:=NULL; END IF;
    NEW.stage_changed_at:=now();
    NEW.stage_changed_by:=coalesce(NEW.stage_changed_by,NEW.owner_identity,'system');
    INSERT INTO leadgen.opportunity_stage_history(opportunity_snapshot_id,company_id,from_stage,to_stage,lost_reason,note,changed_by)
    VALUES(NEW.opportunity_snapshot_id,NEW.company_id,CASE WHEN TG_OP='UPDATE' THEN OLD.pipeline_stage END,NEW.pipeline_stage,
      NEW.lost_reason,NEW.stage_note,NEW.stage_changed_by);
  END IF;
  RETURN NEW;
END $$;

UPDATE leadgen.opportunity_crm_states SET
  pipeline_stage=CASE funnel_status WHEN 'REPLIED' THEN 'REPLIED' WHEN 'OPTED_OUT' THEN 'LOST' WHEN 'CONTACTED' THEN 'CONTACTED' ELSE 'NEW' END,
  lost_reason=CASE WHEN funnel_status='OPTED_OUT' THEN 'OPTED_OUT' END,
  stage_changed_at=updated_at,stage_changed_by='crm-pipeline-backfill'
WHERE pipeline_stage IS NULL;
ALTER TABLE leadgen.opportunity_crm_states ALTER COLUMN pipeline_stage SET NOT NULL;

DROP TRIGGER IF EXISTS opportunity_crm_states_pipeline_stage ON leadgen.opportunity_crm_states;
CREATE TRIGGER opportunity_crm_states_pipeline_stage BEFORE INSERT OR UPDATE ON leadgen.opportunity_crm_states
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_pipeline_stage();

-- Activities recorded by people (calls, WhatsApp, meetings, notes, manual email).
ALTER TABLE leadgen.opportunity_activities
  DROP CONSTRAINT IF EXISTS opportunity_activities_activity_type_check,
  ADD CONSTRAINT opportunity_activities_activity_type_check
    CHECK(activity_type IN('CONTACTED','REPLIED','AUTO_REPLY','OPTED_OUT','BOUNCED','FOLLOW_UP_REQUIRED',
      'CALL','WHATSAPP','MEETING','NOTE','EMAIL_MANUAL')),
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS recorded_by text;
CREATE INDEX IF NOT EXISTS idx_opportunity_activities_company ON leadgen.opportunity_activities(company_id,created_at DESC);

ALTER TABLE leadgen.sales_tasks ADD COLUMN IF NOT EXISTS updated_by text;
CREATE INDEX IF NOT EXISTS idx_sales_tasks_open_due ON leadgen.sales_tasks(task_status,due_at) WHERE task_status IN('OPEN','IN_PROGRESS');

-- Follow-up emails after a first touch. Drafts wait for a person to approve;
-- only APPROVED drafts may be sent, through the existing outbound ledger.
CREATE TABLE IF NOT EXISTS leadgen.crm_followup_drafts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL REFERENCES leadgen.outreach_threads(id) ON DELETE RESTRICT,
  first_touch_reservation_id uuid REFERENCES leadgen.phase13_first_touch_reservations(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK(sequence_no BETWEEN 2 AND 4),
  due_at timestamptz NOT NULL,
  language text NOT NULL DEFAULT 'en' CHECK(language IN('en','es')),
  subject text NOT NULL CHECK(char_length(subject) BETWEEN 1 AND 240),
  body_text text NOT NULL CHECK(char_length(body_text) BETWEEN 1 AND 12000),
  template_key text NOT NULL,
  draft_status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK(draft_status IN('PENDING_APPROVAL','APPROVED','SENDING','SENT','DISCARDED','BLOCKED','SUPERSEDED')),
  approved_by text,
  approved_at timestamptz,
  discarded_by text,
  discard_reason text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id,sequence_no),
  CHECK(draft_status NOT IN('APPROVED','SENDING','SENT') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_crm_followup_drafts_status_due ON leadgen.crm_followup_drafts(draft_status,due_at);

-- Record identifier returned by the external CRM (for example a Feishu Bitable record_id).
ALTER TABLE leadgen.crm_sync_outbox
  ADD COLUMN IF NOT EXISTS external_record_id text CHECK(external_record_id IS NULL OR char_length(external_record_id)<=200);

-- An approved follow-up draft is the third authorization source for an outbound message.
ALTER TABLE leadgen.outbound_messages
  ADD COLUMN IF NOT EXISTS followup_draft_id uuid UNIQUE REFERENCES leadgen.crm_followup_drafts(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS outbound_messages_authorization_source_check,
  ADD CONSTRAINT outbound_messages_authorization_source_check CHECK(
    (approval_id IS NOT NULL AND first_touch_reservation_id IS NULL AND followup_draft_id IS NULL AND recipient_id IS NOT NULL)
    OR (approval_id IS NULL AND first_touch_reservation_id IS NOT NULL AND followup_draft_id IS NULL)
    OR (approval_id IS NULL AND first_touch_reservation_id IS NULL AND followup_draft_id IS NOT NULL)
  );

COMMIT;
