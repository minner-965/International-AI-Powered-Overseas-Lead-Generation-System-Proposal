BEGIN;

CREATE TABLE leadgen.automation_controls (
  control_key text PRIMARY KEY CHECK(control_key ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object'),
  updated_by text NOT NULL,
  change_reason text NOT NULL CHECK(btrim(change_reason)<>''),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leadgen.automation_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_key text NOT NULL REFERENCES leadgen.automation_controls(control_key) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK(revision > 0),
  previous_enabled boolean,
  enabled boolean NOT NULL,
  settings_snapshot jsonb NOT NULL CHECK(jsonb_typeof(settings_snapshot)='object'),
  actor text NOT NULL CHECK(btrim(actor)<>''),
  change_reason text NOT NULL CHECK(btrim(change_reason)<>''),
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(control_key,revision)
);

CREATE FUNCTION leadgen.guard_automation_control_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Automation control events are append-only'; END; $$;
CREATE TRIGGER automation_control_event_immutable BEFORE UPDATE OR DELETE ON leadgen.automation_control_events
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_automation_control_event();

INSERT INTO leadgen.automation_controls(control_key,enabled,revision,settings,updated_by,change_reason)
VALUES
 ('RESEARCH_PROVIDER_EXECUTION',false,1,'{}','phase13-mc07-migration','fail-closed initial state'),
 ('PHASE13_AUTO_FIRST_TOUCH',false,1,'{}','phase13-mc07-migration','fail-closed initial state');
INSERT INTO leadgen.automation_control_events
  (control_key,revision,previous_enabled,enabled,settings_snapshot,actor,change_reason,idempotency_key)
SELECT control_key,revision,NULL,enabled,settings,updated_by,change_reason,'migration:061:'||control_key
FROM leadgen.automation_controls;

CREATE TABLE leadgen.research_query_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_query_plan_id uuid NOT NULL REFERENCES leadgen.research_query_plans(id) ON DELETE RESTRICT,
  research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  query_fingerprint text NOT NULL CHECK(query_fingerprint ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK(provider ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  purpose text NOT NULL CHECK(purpose IN('COMPANY_DISCOVERY','COMPANY_VERIFICATION','CATEGORY_EVIDENCE','CONTACT_DISCOVERY','OFFICIAL_CONTACT_VERIFICATION','SHADOW_BENCHMARK')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN(
    'PENDING','CLAIMED','PROVIDER_COMPLETED','PERSISTED','NOT_FOUND','RATE_LIMITED',
    'TEMPORARY_ERROR','AUTH_ERROR','FAILED','REVIEW_REQUIRED')),
  selection_reason text NOT NULL CHECK(btrim(selection_reason)<>''),
  request_snapshot jsonb NOT NULL CHECK(jsonb_typeof(request_snapshot)='object'),
  response_snapshot jsonb CHECK(response_snapshot IS NULL OR jsonb_typeof(response_snapshot)='object'),
  provider_usage_event_id uuid REFERENCES leadgen.provider_usage_events(id) ON DELETE RESTRICT,
  claim_token uuid,
  claimed_by text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  result_count integer CHECK(result_count IS NULL OR result_count>=0),
  reference_ids text[] NOT NULL DEFAULT '{}',
  last_error_code text,
  retry_after_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  provider_completed_at timestamptz,
  persisted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(research_query_plan_id,query_fingerprint,provider),
  CHECK(status<>'CLAIMED' OR (claim_token IS NOT NULL AND claimed_by IS NOT NULL AND btrim(claimed_by)<>'' AND started_at IS NOT NULL AND lease_expires_at>started_at)),
  CHECK(provider_usage_event_id IS NULL OR status IN('PROVIDER_COMPLETED','PERSISTED','NOT_FOUND','RATE_LIMITED','TEMPORARY_ERROR','AUTH_ERROR','FAILED','REVIEW_REQUIRED')),
  CHECK(response_snapshot IS NULL OR status IN('PROVIDER_COMPLETED','PERSISTED','NOT_FOUND','REVIEW_REQUIRED')),
  CHECK(status<>'PROVIDER_COMPLETED' OR (provider_usage_event_id IS NOT NULL AND provider_completed_at IS NOT NULL AND response_snapshot IS NOT NULL)),
  CHECK(status<>'PERSISTED' OR (provider_usage_event_id IS NOT NULL AND response_snapshot IS NOT NULL AND result_count>0 AND persisted_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK(status<>'NOT_FOUND' OR (provider_usage_event_id IS NOT NULL AND result_count=0 AND completed_at IS NOT NULL)),
  CHECK(status NOT IN('RATE_LIMITED','TEMPORARY_ERROR','AUTH_ERROR','FAILED','REVIEW_REQUIRED') OR completed_at IS NOT NULL)
);
CREATE INDEX research_query_executions_pending_idx
  ON leadgen.research_query_executions(status,retry_after_at,created_at,id)
  WHERE status IN('PENDING','RATE_LIMITED','TEMPORARY_ERROR');
CREATE INDEX research_query_executions_lease_idx
  ON leadgen.research_query_executions(lease_expires_at,id) WHERE status='CLAIMED';
CREATE INDEX research_query_executions_usage_event_idx
  ON leadgen.research_query_executions(provider_usage_event_id) WHERE provider_usage_event_id IS NOT NULL;

ALTER TABLE leadgen.research_market_registry
  ADD COLUMN timezone text,
  ADD COLUMN business_send_window jsonb;
UPDATE leadgen.research_market_registry SET
  timezone=CASE market_code WHEN 'AE' THEN 'Asia/Dubai' WHEN 'MX' THEN 'America/Mexico_City' WHEN 'BD' THEN 'Asia/Dhaka' ELSE 'UTC' END,
  business_send_window='{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}'::jsonb;
ALTER TABLE leadgen.research_market_registry
  ALTER COLUMN timezone SET NOT NULL,
  ALTER COLUMN business_send_window SET NOT NULL,
  ADD CONSTRAINT research_market_business_window_check CHECK(
    jsonb_typeof(business_send_window)='object'
    AND jsonb_typeof(business_send_window->'days')='array'
    AND jsonb_array_length(business_send_window->'days')>0
    AND NOT jsonb_path_exists(business_send_window,'$.days[*] ? (@ < 1 || @ > 7)')
    AND business_send_window->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND business_send_window->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (business_send_window->>'start')::time < (business_send_window->>'end')::time
  );

CREATE TABLE leadgen.phase13_first_touch_controls (
  policy_revision text PRIMARY KEY CHECK(btrim(policy_revision)<>''),
  enabled boolean NOT NULL DEFAULT false,
  template_set_key text NOT NULL CHECK(btrim(template_set_key)<>''),
  per_minute_limit integer NOT NULL CHECK(per_minute_limit>0),
  per_day_limit integer NOT NULL CHECK(per_day_limit>0),
  company_cooldown_days integer NOT NULL DEFAULT 30 CHECK(company_cooldown_days>=30),
  updated_by text NOT NULL CHECK(btrim(updated_by)<>''),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO leadgen.phase13_first_touch_controls
  (policy_revision,enabled,template_set_key,per_minute_limit,per_day_limit,company_cooldown_days,updated_by)
VALUES('MC07_DPV_FIRST_TOUCH_V1',false,'DPV_FIRST_TOUCH_V1',1,50,30,'phase13-mc07-migration');

CREATE TABLE leadgen.phase13_first_touch_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  policy_revision text NOT NULL REFERENCES leadgen.phase13_first_touch_controls(policy_revision) ON DELETE RESTRICT,
  decision_maker_contact_id uuid REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
  normalized_recipient text NOT NULL CHECK(btrim(normalized_recipient)<>''),
  market_code text NOT NULL REFERENCES leadgen.research_market_registry(market_code) ON DELETE RESTRICT,
  template_set_key text NOT NULL CHECK(btrim(template_set_key)<>''),
  template_key text NOT NULL CHECK(btrim(template_key)<>''),
  sender_identity text NOT NULL CHECK(btrim(sender_identity)<>''),
  reply_to text NOT NULL CHECK(btrim(reply_to)<>''),
  subject text NOT NULL CHECK(btrim(subject)<>''),
  body_text text NOT NULL CHECK(btrim(body_text)<>''),
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  eligibility_snapshot jsonb NOT NULL CHECK(jsonb_typeof(eligibility_snapshot)='object'),
  status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS','BLOCKED','CANCELLED','FAILED')),
  reservation_minute timestamptz NOT NULL,
  reservation_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  provider_call_started_at timestamptz,
  completed_at timestamptz,
  reason_codes text[] NOT NULL DEFAULT '{}',
  rfc_message_id text,
  UNIQUE(company_id,policy_revision),
  UNIQUE(id,company_id)
);
CREATE INDEX phase13_first_touch_minute_idx ON leadgen.phase13_first_touch_reservations(policy_revision,reservation_minute,status);
CREATE INDEX phase13_first_touch_day_idx ON leadgen.phase13_first_touch_reservations(policy_revision,reservation_day,status);
CREATE INDEX phase13_first_touch_company_time_idx ON leadgen.phase13_first_touch_reservations(company_id,reserved_at DESC);

ALTER TABLE leadgen.outbound_messages
  ALTER COLUMN approval_id DROP NOT NULL,
  ALTER COLUMN recipient_id DROP NOT NULL,
  ADD COLUMN first_touch_reservation_id uuid UNIQUE,
  ADD CONSTRAINT outbound_messages_first_touch_company_fk
    FOREIGN KEY(first_touch_reservation_id,company_id)
    REFERENCES leadgen.phase13_first_touch_reservations(id,company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT outbound_messages_authorization_source_check CHECK(
    (approval_id IS NOT NULL AND first_touch_reservation_id IS NULL AND recipient_id IS NOT NULL)
    OR (approval_id IS NULL AND first_touch_reservation_id IS NOT NULL)
  );

CREATE FUNCTION leadgen.guard_phase13_first_touch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.policy_revision IS DISTINCT FROM OLD.policy_revision
   OR NEW.decision_maker_contact_id IS DISTINCT FROM OLD.decision_maker_contact_id
   OR NEW.normalized_recipient IS DISTINCT FROM OLD.normalized_recipient
   OR NEW.template_set_key IS DISTINCT FROM OLD.template_set_key OR NEW.template_key IS DISTINCT FROM OLD.template_key
   OR NEW.sender_identity IS DISTINCT FROM OLD.sender_identity OR NEW.reply_to IS DISTINCT FROM OLD.reply_to
   OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body_text IS DISTINCT FROM OLD.body_text
   OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.eligibility_snapshot IS DISTINCT FROM OLD.eligibility_snapshot
 THEN RAISE EXCEPTION 'First-touch reservation identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase13_first_touch_identity_immutable BEFORE UPDATE ON leadgen.phase13_first_touch_reservations
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_phase13_first_touch_identity();

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
  target_reason_codes text[] DEFAULT '{}'
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:global-email-quota',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:policy:'||target_policy_revision,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:company:'||target_company_id::text,0));

  SELECT * INTO policy FROM leadgen.phase13_first_touch_controls WHERE policy_revision=target_policy_revision FOR SHARE;
  IF NOT FOUND OR NOT policy.enabled THEN RAISE EXCEPTION 'FIRST_TOUCH_POLICY_DISABLED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM leadgen.automation_controls WHERE control_key='PHASE13_AUTO_FIRST_TOUCH' AND enabled)
  THEN RAISE EXCEPTION 'FIRST_TOUCH_AUTOMATION_DISABLED' USING ERRCODE='P0001'; END IF;
  IF policy.template_set_key<>target_template_set_key THEN RAISE EXCEPTION 'FIRST_TOUCH_TEMPLATE_SET_MISMATCH' USING ERRCODE='P0001'; END IF;

  SELECT * INTO prior FROM leadgen.phase13_first_touch_reservations
    WHERE company_id=target_company_id AND policy_revision=target_policy_revision;
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
      WHERE r.reservation_minute=minute_bucket
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages linked WHERE linked.first_touch_reservation_id=r.id))
    +(SELECT count(*) FROM leadgen.outbound_messages o
      WHERE o.queued_at>=minute_bucket AND o.queued_at<minute_bucket+interval '1 minute'
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED')) INTO active_count;
  IF active_count>=policy.per_minute_limit THEN RAISE EXCEPTION 'FIRST_TOUCH_MINUTE_LIMIT' USING ERRCODE='P0001'; END IF;

  SELECT
    (SELECT count(*) FROM leadgen.phase13_first_touch_reservations r
      WHERE r.reservation_day=local_day
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages linked WHERE linked.first_touch_reservation_id=r.id))
    +(SELECT count(*) FROM leadgen.outbound_messages o
      WHERE (o.queued_at AT TIME ZONE market.timezone)::date=local_day
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED')) INTO active_count;
  IF active_count>=policy.per_day_limit THEN RAISE EXCEPTION 'FIRST_TOUCH_DAY_LIMIT' USING ERRCODE='P0001'; END IF;

  IF EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r
      WHERE r.company_id=target_company_id AND r.reserved_at>=observed_at-make_interval(days=>policy.company_cooldown_days)
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS'))
    OR EXISTS(SELECT 1 FROM leadgen.outbound_messages o
      WHERE o.company_id=target_company_id AND o.queued_at>=observed_at-make_interval(days=>policy.company_cooldown_days)
        AND o.send_status NOT IN('BLOCKED','FAILED','CANCELLED'))
  THEN RAISE EXCEPTION 'FIRST_TOUCH_COMPANY_COOLDOWN' USING ERRCODE='P0001'; END IF;

  INSERT INTO leadgen.phase13_first_touch_reservations
    (company_id,policy_revision,decision_maker_contact_id,normalized_recipient,market_code,template_set_key,template_key,
     sender_identity,reply_to,subject,body_text,content_hash,eligibility_snapshot,reservation_minute,reservation_day,created_at,reserved_at,reason_codes)
  VALUES(target_company_id,target_policy_revision,target_decision_maker_contact_id,target_normalized_recipient,target_market_code,
    target_template_set_key,target_template_key,target_sender_identity,target_reply_to,target_subject,target_body_text,
    target_content_hash,target_eligibility_snapshot,minute_bucket,local_day,
    observed_at,observed_at,target_reason_codes) RETURNING * INTO created;
  RETURN created;
END; $$;

COMMIT;
