BEGIN;

-- Merchant accounts (round 4). One database serves SIM and every merchant; a business
-- row with merchant_id NULL belongs to SIM, otherwise to that merchant. Existing rows
-- are SIM's and are not changed. No history is rewritten.

CREATE TABLE leadgen.merchants(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK(char_length(btrim(company_name)) BETWEEN 1 AND 200),
  contact_name text CHECK(contact_name IS NULL OR char_length(contact_name)<=200),
  -- Name used in email signatures and the self-introduction ("I'm <sender_name> from <company_name>").
  sender_name text CHECK(sender_name IS NULL OR char_length(btrim(sender_name)) BETWEEN 1 AND 120),
  -- Stored status; EXPIRED is also derived from the dates (see merchants_current).
  status text NOT NULL DEFAULT 'TRIAL' CHECK(status IN('TRIAL','ACTIVE','EXPIRED','DISABLED')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  referral_code text NOT NULL UNIQUE CHECK(referral_code ~ '^[A-Z0-9]{6,16}$'),
  referred_by_merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  monthly_search_quota integer NOT NULL DEFAULT 300 CHECK(monthly_search_quota>=0),
  daily_email_quota integer NOT NULL DEFAULT 30 CHECK(daily_email_quota>=0),
  features jsonb NOT NULL DEFAULT '{"research":true,"email":true,"crm_sync":false}'::jsonb CHECK(jsonb_typeof(features)='object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(referred_by_merchant_id IS DISTINCT FROM id)
);

-- Effective status: a lapsed trial or paid period is EXPIRED (read-only) until SIM extends it.
CREATE VIEW leadgen.merchants_current AS
SELECT m.*,
  CASE WHEN m.status='DISABLED' THEN 'DISABLED'
       WHEN m.status='EXPIRED' THEN 'EXPIRED'
       WHEN m.status='TRIAL' AND (m.trial_ends_at IS NULL OR m.trial_ends_at<=now()) THEN 'EXPIRED'
       WHEN m.status='ACTIVE' AND m.paid_until IS NOT NULL AND m.paid_until<=now() THEN 'EXPIRED'
       ELSE m.status END effective_status
FROM leadgen.merchants m;

CREATE TABLE leadgen.workspace_users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK(email ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$' AND char_length(email)<=320),
  display_name text CHECK(display_name IS NULL OR char_length(display_name)<=200),
  password_hash text NOT NULL CHECK(password_hash LIKE '$argon2%'),
  role text NOT NULL CHECK(role IN('ADMIN','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  must_change_password boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((role='ADMIN' AND merchant_id IS NULL) OR (role='MERCHANT' AND merchant_id IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_users_email_uq ON leadgen.workspace_users(lower(email));
CREATE INDEX workspace_users_merchant_idx ON leadgen.workspace_users(merchant_id) WHERE merchant_id IS NOT NULL;

-- Sending mailbox bound by the merchant. The password is AES-256-GCM ciphertext; the key
-- (MERCHANT_SECRET_KEY) exists only in the application environment.
CREATE TABLE leadgen.merchant_mailboxes(
  merchant_id uuid PRIMARY KEY REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  preset_key text CHECK(preset_key IS NULL OR preset_key ~ '^[a-z0-9_]{1,40}$'),
  smtp_host text NOT NULL CHECK(char_length(btrim(smtp_host)) BETWEEN 1 AND 255),
  smtp_port integer NOT NULL CHECK(smtp_port BETWEEN 1 AND 65535),
  imap_host text NOT NULL CHECK(char_length(btrim(imap_host)) BETWEEN 1 AND 255),
  imap_port integer NOT NULL CHECK(imap_port BETWEEN 1 AND 65535),
  username text NOT NULL CHECK(char_length(btrim(username)) BETWEEN 1 AND 320),
  password_ciphertext text CHECK(password_ciphertext IS NULL OR password_ciphertext LIKE 'v1:%'),
  from_email text NOT NULL CHECK(from_email ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  from_name text CHECK(from_name IS NULL OR char_length(from_name)<=120),
  reply_to text NOT NULL CHECK(reply_to ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  verified_at timestamptz,
  last_test jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(last_test)='object'),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Categories (SIM-approved category scopes) and markets the merchant works on.
CREATE TABLE leadgen.merchant_scope(
  merchant_id uuid PRIMARY KEY REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  category_scope_ids uuid[] NOT NULL DEFAULT '{}',
  market_codes text[] NOT NULL DEFAULT '{}',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leadgen.merchant_feedback(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES leadgen.workspace_users(id) ON DELETE RESTRICT,
  user_email text,
  page text CHECK(page IS NULL OR char_length(page)<=500),
  message text NOT NULL CHECK(char_length(btrim(message)) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','DONE')),
  handled_by text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_feedback_status_idx ON leadgen.merchant_feedback(status,created_at DESC);

-- connect-pg-simple session store (its documented table layout).
CREATE TABLE leadgen.workspace_sessions(
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX workspace_sessions_expire_idx ON leadgen.workspace_sessions(expire);

-- A company can be assigned to several merchants (found by each one's search, or assigned by SIM).
CREATE TABLE leadgen.merchant_companies(
  merchant_id uuid NOT NULL REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK(source IN('RESEARCH','ADMIN')),
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(merchant_id,company_id)
);
CREATE INDEX merchant_companies_company_idx ON leadgen.merchant_companies(company_id);

CREATE VIEW leadgen.merchant_opportunities AS
SELECT mc.merchant_id,mc.source assignment_source,mc.assigned_at,o.*
FROM leadgen.merchant_companies mc
JOIN leadgen.business_opportunity_current o ON o.company_id=mc.company_id;

-- Ownership columns. NULL = SIM.
ALTER TABLE leadgen.research_batches ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.research_jobs ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.phase13_first_touch_reservations ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.outbound_messages ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.outreach_threads ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.inbound_messages ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.crm_followup_drafts ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.sales_tasks ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.opportunity_activities ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.opportunity_stage_history ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
ALTER TABLE leadgen.crm_sync_outbox ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT;
CREATE INDEX research_batches_merchant_idx ON leadgen.research_batches(merchant_id,created_at DESC) WHERE merchant_id IS NOT NULL;
CREATE INDEX research_jobs_merchant_idx ON leadgen.research_jobs(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX outbound_messages_merchant_idx ON leadgen.outbound_messages(merchant_id,queued_at) WHERE merchant_id IS NOT NULL;
CREATE INDEX outreach_threads_merchant_idx ON leadgen.outreach_threads(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX inbound_messages_merchant_idx ON leadgen.inbound_messages(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX crm_followup_drafts_merchant_idx ON leadgen.crm_followup_drafts(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX sales_tasks_merchant_idx ON leadgen.sales_tasks(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX opportunity_activities_merchant_idx ON leadgen.opportunity_activities(merchant_id) WHERE merchant_id IS NOT NULL;

-- Per-merchant CRM state: a merchant's pipeline stage is never shared with SIM or another
-- merchant. merchant_key folds NULL (SIM) into one value so (snapshot, owner) is unique.
ALTER TABLE leadgen.opportunity_crm_states
  ADD COLUMN merchant_id uuid REFERENCES leadgen.merchants(id) ON DELETE RESTRICT,
  ADD COLUMN merchant_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE leadgen.opportunity_crm_states DROP CONSTRAINT opportunity_crm_states_pkey;
ALTER TABLE leadgen.opportunity_crm_states ADD CONSTRAINT opportunity_crm_states_pkey PRIMARY KEY(id);
ALTER TABLE leadgen.opportunity_crm_states ADD CONSTRAINT opportunity_crm_states_owner_key UNIQUE(opportunity_snapshot_id,merchant_key);
CREATE INDEX opportunity_crm_states_company_owner_idx ON leadgen.opportunity_crm_states(company_id,merchant_key,updated_at DESC);

-- First touch: one reservation per company and policy per sender (SIM or a merchant).
ALTER TABLE leadgen.phase13_first_touch_reservations
  ADD COLUMN merchant_key uuid GENERATED ALWAYS AS (coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED;
ALTER TABLE leadgen.phase13_first_touch_reservations DROP CONSTRAINT phase13_first_touch_reservations_company_id_policy_revision_key;
ALTER TABLE leadgen.phase13_first_touch_reservations
  ADD CONSTRAINT phase13_first_touch_reservations_company_policy_owner_key UNIQUE(company_id,policy_revision,merchant_key);
CREATE INDEX phase13_first_touch_owner_day_idx ON leadgen.phase13_first_touch_reservations(merchant_key,reservation_day,status);

CREATE OR REPLACE FUNCTION leadgen.guard_phase13_first_touch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.policy_revision IS DISTINCT FROM OLD.policy_revision
   OR NEW.decision_maker_contact_id IS DISTINCT FROM OLD.decision_maker_contact_id
   OR NEW.normalized_recipient IS DISTINCT FROM OLD.normalized_recipient
   OR NEW.template_set_key IS DISTINCT FROM OLD.template_set_key OR NEW.template_key IS DISTINCT FROM OLD.template_key
   OR NEW.sender_identity IS DISTINCT FROM OLD.sender_identity OR NEW.reply_to IS DISTINCT FROM OLD.reply_to
   OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body_text IS DISTINCT FROM OLD.body_text
   OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.eligibility_snapshot IS DISTINCT FROM OLD.eligibility_snapshot
   OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
 THEN RAISE EXCEPTION 'First-touch reservation identity is immutable'; END IF;
 RETURN NEW;
END; $$;

-- Owner-aware reservation. Limits, prior reservations and company cooldown are counted per
-- sender: SIM's mailbox (target_merchant_id NULL, policy per-day limit) or one merchant's
-- mailbox (target_daily_limit = the merchant's daily email quota, follow-ups included).
CREATE FUNCTION leadgen.reserve_phase13_first_touch(
  target_company_id uuid,
  target_policy_revision text,
  target_decision_maker_contact_id uuid,
  target_normalized_recipient text,
  target_market_code text,
  target_template_set_key text,
  target_template_key text,
  target_sender_identity text,
  target_reply_to text,
  target_subject text,
  target_body_text text,
  target_content_hash text,
  target_eligibility_snapshot jsonb,
  target_reason_codes text[],
  target_merchant_id uuid,
  target_daily_limit integer
) RETURNS leadgen.phase13_first_touch_reservations LANGUAGE plpgsql AS $$
DECLARE
  policy leadgen.phase13_first_touch_controls%ROWTYPE;
  market leadgen.research_market_registry%ROWTYPE;
  prior leadgen.phase13_first_touch_reservations%ROWTYPE;
  created leadgen.phase13_first_touch_reservations%ROWTYPE;
  observed_at timestamptz := clock_timestamp();
  local_observed timestamp;
  minute_bucket timestamptz;
  local_day date;
  active_count integer;
  weekday_allowed boolean;
  owner_label text := coalesce(target_merchant_id::text,'sim');
  day_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:email-quota:'||owner_label,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:policy:'||target_policy_revision,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:company:'||target_company_id::text||':'||owner_label,0));

  SELECT * INTO policy FROM leadgen.phase13_first_touch_controls WHERE policy_revision=target_policy_revision FOR SHARE;
  IF NOT FOUND OR NOT policy.enabled THEN RAISE EXCEPTION 'FIRST_TOUCH_POLICY_DISABLED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM leadgen.automation_controls WHERE control_key='PHASE13_AUTO_FIRST_TOUCH' AND enabled)
  THEN RAISE EXCEPTION 'FIRST_TOUCH_AUTOMATION_DISABLED' USING ERRCODE='P0001'; END IF;
  IF policy.template_set_key<>target_template_set_key THEN RAISE EXCEPTION 'FIRST_TOUCH_TEMPLATE_SET_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF target_merchant_id IS NOT NULL AND (target_daily_limit IS NULL OR target_daily_limit<0)
  THEN RAISE EXCEPTION 'FIRST_TOUCH_MERCHANT_LIMIT_REQUIRED' USING ERRCODE='P0001'; END IF;
  day_limit := CASE WHEN target_merchant_id IS NULL THEN policy.per_day_limit ELSE target_daily_limit END;

  SELECT * INTO prior FROM leadgen.phase13_first_touch_reservations
    WHERE company_id=target_company_id AND policy_revision=target_policy_revision
      AND merchant_id IS NOT DISTINCT FROM target_merchant_id;
  IF FOUND THEN
    IF prior.decision_maker_contact_id IS NOT DISTINCT FROM target_decision_maker_contact_id
      AND prior.normalized_recipient=target_normalized_recipient
      AND prior.template_set_key=target_template_set_key AND prior.template_key=target_template_key
      AND prior.content_hash=target_content_hash THEN RETURN prior; END IF;
    RAISE EXCEPTION 'FIRST_TOUCH_RESERVATION_CONFLICT' USING ERRCODE='23505';
  END IF;

  SELECT * INTO market FROM leadgen.research_market_registry WHERE market_code=target_market_code FOR SHARE;
  IF NOT FOUND OR market.status<>'ACTIVE' THEN RAISE EXCEPTION 'FIRST_TOUCH_MARKET_INACTIVE' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=market.timezone)
  THEN RAISE EXCEPTION 'FIRST_TOUCH_TIMEZONE_INVALID' USING ERRCODE='P0001'; END IF;
  local_observed:=observed_at AT TIME ZONE market.timezone;
  local_day:=local_observed::date;
  minute_bucket:=date_trunc('minute',observed_at);
  SELECT extract(isodow FROM local_observed)::int IN
    (SELECT value::int FROM jsonb_array_elements_text(market.business_send_window->'days')) INTO weekday_allowed;
  IF NOT weekday_allowed OR local_observed::time < (market.business_send_window->>'start')::time
    OR local_observed::time >= (market.business_send_window->>'end')::time
  THEN RAISE EXCEPTION 'FIRST_TOUCH_OUTSIDE_BUSINESS_WINDOW' USING ERRCODE='P0001'; END IF;

  SELECT
    (SELECT count(*) FROM leadgen.phase13_first_touch_reservations r
      WHERE r.reservation_minute=minute_bucket AND r.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages linked WHERE linked.first_touch_reservation_id=r.id))
    +(SELECT count(*) FROM leadgen.outbound_messages o
      WHERE o.queued_at>=minute_bucket AND o.queued_at<minute_bucket+interval '1 minute'
        AND o.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED')) INTO active_count;
  IF active_count>=policy.per_minute_limit THEN RAISE EXCEPTION 'FIRST_TOUCH_MINUTE_LIMIT' USING ERRCODE='P0001'; END IF;

  SELECT
    (SELECT count(*) FROM leadgen.phase13_first_touch_reservations r
      WHERE r.reservation_day=local_day AND r.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages linked WHERE linked.first_touch_reservation_id=r.id))
    +(SELECT count(*) FROM leadgen.outbound_messages o
      WHERE (o.queued_at AT TIME ZONE market.timezone)::date=local_day
        AND o.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED')) INTO active_count;
  IF active_count>=day_limit THEN
    RAISE EXCEPTION '%',CASE WHEN target_merchant_id IS NULL THEN 'FIRST_TOUCH_DAY_LIMIT' ELSE 'MERCHANT_EMAIL_QUOTA_EXCEEDED' END USING ERRCODE='P0001';
  END IF;

  IF EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r
      WHERE r.company_id=target_company_id AND r.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND r.reserved_at>=observed_at-make_interval(days=>policy.company_cooldown_days)
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS'))
    OR EXISTS(SELECT 1 FROM leadgen.outbound_messages o
      WHERE o.company_id=target_company_id AND o.merchant_id IS NOT DISTINCT FROM target_merchant_id
        AND o.queued_at>=observed_at-make_interval(days=>policy.company_cooldown_days)
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED'))
  THEN RAISE EXCEPTION 'FIRST_TOUCH_COMPANY_COOLDOWN' USING ERRCODE='P0001'; END IF;

  INSERT INTO leadgen.phase13_first_touch_reservations
    (company_id,policy_revision,decision_maker_contact_id,normalized_recipient,market_code,template_set_key,template_key,
     sender_identity,reply_to,subject,body_text,content_hash,eligibility_snapshot,reservation_minute,reservation_day,created_at,reserved_at,reason_codes,merchant_id)
  VALUES(target_company_id,target_policy_revision,target_decision_maker_contact_id,target_normalized_recipient,target_market_code,
    target_template_set_key,target_template_key,target_sender_identity,target_reply_to,target_subject,target_body_text,
    target_content_hash,target_eligibility_snapshot,minute_bucket,local_day,
    observed_at,observed_at,coalesce(target_reason_codes,'{}'),target_merchant_id) RETURNING * INTO created;
  RETURN created;
END; $$;

-- The original 14-argument entry point now reserves for SIM's own mailbox only.
CREATE OR REPLACE FUNCTION leadgen.reserve_phase13_first_touch(
  target_company_id uuid,
  target_policy_revision text,
  target_decision_maker_contact_id uuid,
  target_normalized_recipient text,
  target_market_code text,
  target_template_set_key text,
  target_template_key text,
  target_sender_identity text,
  target_reply_to text,
  target_subject text,
  target_body_text text,
  target_content_hash text,
  target_eligibility_snapshot jsonb,
  target_reason_codes text[] DEFAULT '{}'
) RETURNS leadgen.phase13_first_touch_reservations LANGUAGE sql AS $$
  SELECT * FROM leadgen.reserve_phase13_first_touch(target_company_id,target_policy_revision,target_decision_maker_contact_id,
    target_normalized_recipient,target_market_code,target_template_set_key,target_template_key,target_sender_identity,target_reply_to,
    target_subject,target_body_text,target_content_hash,target_eligibility_snapshot,target_reason_codes,NULL::uuid,NULL::integer);
$$;

-- Stage history carries the owner of the CRM state.
CREATE OR REPLACE FUNCTION leadgen.derive_pipeline_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text:=nullif(current_setting('leadgen.stage_actor',true),'');
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.pipeline_stage IS NULL THEN
      NEW.pipeline_stage:=CASE NEW.funnel_status
        WHEN 'REPLIED' THEN 'REPLIED' WHEN 'OPTED_OUT' THEN 'LOST'
        WHEN 'CONTACTED' THEN 'CONTACTED' ELSE 'NEW' END;
      IF NEW.funnel_status='OPTED_OUT' THEN NEW.lost_reason:=coalesce(NEW.lost_reason,'OPTED_OUT'); END IF;
    END IF;
  ELSIF NEW.pipeline_stage IS NOT DISTINCT FROM OLD.pipeline_stage AND NEW.funnel_status IS DISTINCT FROM OLD.funnel_status THEN
    IF NEW.funnel_status='REPLIED' AND OLD.pipeline_stage IN('NEW','CONTACTED') THEN NEW.pipeline_stage:='REPLIED';
    ELSIF NEW.funnel_status='CONTACTED' AND OLD.pipeline_stage='NEW' THEN NEW.pipeline_stage:='CONTACTED';
    ELSIF NEW.funnel_status='OPTED_OUT' AND OLD.pipeline_stage<>'WON' THEN NEW.pipeline_stage:='LOST';NEW.lost_reason:='OPTED_OUT';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    IF actor IS NULL THEN NEW.stage_changed_by:='system';NEW.stage_note:=NULL;
    ELSE NEW.stage_changed_by:=actor; END IF;
    IF TG_OP='UPDATE' AND NEW.pipeline_stage<>'LOST' THEN NEW.lost_reason:=NULL; END IF;
    NEW.stage_changed_at:=now();
    INSERT INTO leadgen.opportunity_stage_history(opportunity_snapshot_id,company_id,from_stage,to_stage,lost_reason,note,changed_by,merchant_id)
    VALUES(NEW.opportunity_snapshot_id,NEW.company_id,CASE WHEN TG_OP='UPDATE' THEN OLD.pipeline_stage END,NEW.pipeline_stage,
      NEW.lost_reason,NEW.stage_note,NEW.stage_changed_by,NEW.merchant_id);
  END IF;
  RETURN NEW;
END $$;

-- Ownership follows the source record when a writer does not state it: reservation ->
-- outbound/thread -> inbound reply -> task/activity/CRM state/outbox. Rows that have no
-- merchant source stay SIM's.
CREATE FUNCTION leadgen.derive_merchant_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref text;
BEGIN
  IF NEW.merchant_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='outbound_messages' THEN
    IF NEW.first_touch_reservation_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.phase13_first_touch_reservations WHERE id=NEW.first_touch_reservation_id;
    ELSIF NEW.followup_draft_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.crm_followup_drafts WHERE id=NEW.followup_draft_id;
    END IF;
  ELSIF TG_TABLE_NAME='outreach_threads' THEN
    IF NEW.first_touch_reservation_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.phase13_first_touch_reservations WHERE id=NEW.first_touch_reservation_id;
    END IF;
  ELSIF TG_TABLE_NAME='crm_followup_drafts' THEN
    SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outreach_threads WHERE id=NEW.thread_id;
  ELSIF TG_TABLE_NAME='inbound_messages' THEN
    IF NEW.thread_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outreach_threads WHERE id=NEW.thread_id;
    END IF;
    IF NEW.merchant_id IS NULL AND NEW.correlation_outbound_message_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outbound_messages WHERE id=NEW.correlation_outbound_message_id;
    END IF;
  ELSIF TG_TABLE_NAME='sales_tasks' THEN
    IF NEW.inbound_message_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.inbound_messages WHERE id=NEW.inbound_message_id;
    END IF;
    IF NEW.merchant_id IS NULL AND NEW.thread_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outreach_threads WHERE id=NEW.thread_id;
    END IF;
  ELSIF TG_TABLE_NAME='opportunity_activities' THEN
    IF NEW.inbound_message_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.inbound_messages WHERE id=NEW.inbound_message_id;
    END IF;
    IF NEW.merchant_id IS NULL AND (NEW.details->>'outbound_message_id') ~ '^[0-9a-f-]{36}$' THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outbound_messages WHERE id=(NEW.details->>'outbound_message_id')::uuid;
    END IF;
  ELSIF TG_TABLE_NAME='opportunity_crm_states' THEN
    IF NEW.source_inbound_message_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.inbound_messages WHERE id=NEW.source_inbound_message_id;
    END IF;
  ELSIF TG_TABLE_NAME='crm_sync_outbox' THEN
    IF NEW.task_id IS NOT NULL THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.sales_tasks WHERE id=NEW.task_id;
    END IF;
    ref:=coalesce(NEW.payload->>'source_reference','');
    IF NEW.merchant_id IS NULL AND ref ~ 'activity=[0-9a-f-]{36}' THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.opportunity_activities WHERE id=substring(ref FROM 'activity=([0-9a-f-]{36})')::uuid;
    END IF;
    IF NEW.merchant_id IS NULL AND ref ~ 'inbound=[0-9a-f-]{36}' THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.inbound_messages WHERE id=substring(ref FROM 'inbound=([0-9a-f-]{36})')::uuid;
    END IF;
    IF NEW.merchant_id IS NULL AND ref ~ 'outbound=[0-9a-f-]{36}' THEN
      SELECT merchant_id INTO NEW.merchant_id FROM leadgen.outbound_messages WHERE id=substring(ref FROM 'outbound=([0-9a-f-]{36})')::uuid;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outbound_messages_merchant_owner BEFORE INSERT ON leadgen.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER outreach_threads_merchant_owner BEFORE INSERT ON leadgen.outreach_threads
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER crm_followup_drafts_merchant_owner BEFORE INSERT ON leadgen.crm_followup_drafts
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER inbound_messages_merchant_owner BEFORE INSERT ON leadgen.inbound_messages
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER sales_tasks_merchant_owner BEFORE INSERT ON leadgen.sales_tasks
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER opportunity_activities_merchant_owner BEFORE INSERT ON leadgen.opportunity_activities
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER opportunity_crm_states_merchant_owner BEFORE INSERT ON leadgen.opportunity_crm_states
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();
CREATE TRIGGER crm_sync_outbox_merchant_owner BEFORE INSERT ON leadgen.crm_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION leadgen.derive_merchant_owner();

-- SIM's external CRM (Feishu/HTTP) receives SIM's records only. A merchant's outbox row is
-- kept as the audit record and closed instead of being pushed into SIM's CRM.
CREATE FUNCTION leadgen.hold_merchant_crm_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_id IS NOT NULL AND NEW.sync_status='PENDING' THEN
    NEW.sync_status:='CANCELLED';NEW.last_error:='MERCHANT_CRM_SYNC_NOT_CONFIGURED';NEW.next_attempt_at:=NULL;
  END IF;
  RETURN NEW;
END $$;
-- Runs after the owner trigger (trigger names fire in alphabetical order).
CREATE TRIGGER crm_sync_outbox_zz_merchant_hold BEFORE INSERT ON leadgen.crm_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION leadgen.hold_merchant_crm_outbox();

-- Companies found by a merchant's research batch are assigned to that merchant, including
-- companies of a reused child job that existed before the merchant's batch.
CREATE FUNCTION leadgen.assign_merchant_companies_for_job(target_job_id uuid) RETURNS integer LANGUAGE sql AS $$
  WITH owners AS(
    SELECT DISTINCT b.merchant_id FROM leadgen.research_batch_children ch
    JOIN leadgen.research_batches b ON b.id=ch.batch_id
    WHERE ch.research_job_id=target_job_id AND b.merchant_id IS NOT NULL
    UNION SELECT j.merchant_id FROM leadgen.research_jobs j WHERE j.id=target_job_id AND j.merchant_id IS NOT NULL
  ), found AS(
    SELECT id company_id FROM leadgen.companies WHERE research_job_id=target_job_id
    UNION SELECT company_id FROM leadgen.research_candidate_verifications WHERE research_job_id=target_job_id AND company_id IS NOT NULL
  ), inserted AS(
    INSERT INTO leadgen.merchant_companies(merchant_id,company_id,source,assigned_by)
    SELECT o.merchant_id,f.company_id,'RESEARCH','research-batch' FROM owners o CROSS JOIN found f
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*)::int FROM inserted;
$$;
CREATE FUNCTION leadgen.assign_merchant_companies_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Nested IFs: a record field is only read on the table that has it.
  IF TG_TABLE_NAME='research_batch_children' THEN PERFORM leadgen.assign_merchant_companies_for_job(NEW.research_job_id);
  ELSIF TG_TABLE_NAME='companies' THEN
    IF NEW.research_job_id IS NOT NULL THEN PERFORM leadgen.assign_merchant_companies_for_job(NEW.research_job_id); END IF;
  ELSIF TG_TABLE_NAME='research_candidate_verifications' THEN
    IF NEW.company_id IS NOT NULL THEN PERFORM leadgen.assign_merchant_companies_for_job(NEW.research_job_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER research_batch_children_assign_merchant AFTER INSERT ON leadgen.research_batch_children
  FOR EACH ROW EXECUTE FUNCTION leadgen.assign_merchant_companies_trigger();
CREATE TRIGGER companies_assign_merchant AFTER INSERT OR UPDATE OF research_job_id ON leadgen.companies
  FOR EACH ROW EXECUTE FUNCTION leadgen.assign_merchant_companies_trigger();
CREATE TRIGGER research_candidate_verifications_assign_merchant AFTER INSERT OR UPDATE OF company_id ON leadgen.research_candidate_verifications
  FOR EACH ROW EXECUTE FUNCTION leadgen.assign_merchant_companies_trigger();

COMMIT;
