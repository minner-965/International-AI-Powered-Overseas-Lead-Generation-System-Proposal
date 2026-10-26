BEGIN;

-- 069: merchant sending safety (optimization plan batch 1: A3, A4, A5). Additive only: no
-- applied migration is rewritten and no history row is changed.
--   A3  one buyer address gets at most one first touch per 30 days from SIM and all merchants
--       together; SIM never reserves a first touch for a company assigned to a merchant.
--   A4  a merchant's automatic first touch is off until the merchant switches it on.
--   A5  a stalled send holds only that merchant's mailbox; a connection test failure is counted
--       and verification is cleared only after repeated failures (application logic).

-- A4: merchant opt-in for automatic first touch (default off, also for existing merchants).
ALTER TABLE leadgen.merchants
  ADD COLUMN IF NOT EXISTS auto_first_touch_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_first_touch_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_first_touch_updated_by text CHECK(auto_first_touch_updated_by IS NULL OR char_length(auto_first_touch_updated_by)<=320);

-- A5: per-mailbox sending hold and consecutive connection-test failures.
ALTER TABLE leadgen.merchant_mailboxes
  ADD COLUMN IF NOT EXISTS sending_hold_reason text CHECK(sending_hold_reason IS NULL OR sending_hold_reason ~ '^[A-Z0-9_]{1,80}$'),
  ADD COLUMN IF NOT EXISTS sending_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_test_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_test_failures>=0);
ALTER TABLE leadgen.merchant_mailboxes DROP CONSTRAINT IF EXISTS merchant_mailboxes_sending_hold_pair;
ALTER TABLE leadgen.merchant_mailboxes ADD CONSTRAINT merchant_mailboxes_sending_hold_pair
  CHECK((sending_hold_reason IS NULL)=(sending_hold_at IS NULL));

-- merchants_current was created with m.* expanded at that time; list the columns so the new
-- ones are visible. Existing columns keep their names and order (CREATE OR REPLACE VIEW rule).
CREATE OR REPLACE VIEW leadgen.merchants_current AS
SELECT m.id,m.company_name,m.contact_name,m.sender_name,m.status,m.trial_ends_at,m.paid_until,m.referral_code,
  m.referred_by_merchant_id,m.monthly_search_quota,m.daily_email_quota,m.features,m.created_by,m.created_at,m.updated_at,
  CASE WHEN m.status='DISABLED' THEN 'DISABLED'
       WHEN m.status='EXPIRED' THEN 'EXPIRED'
       WHEN m.status='TRIAL' AND (m.trial_ends_at IS NULL OR m.trial_ends_at<=now()) THEN 'EXPIRED'
       WHEN m.status='ACTIVE' AND m.paid_until IS NOT NULL AND m.paid_until<=now() THEN 'EXPIRED'
       ELSE m.status END effective_status,
  m.auto_first_touch_enabled,m.auto_first_touch_updated_at,m.auto_first_touch_updated_by
FROM leadgen.merchants m;

-- A3: recipient lookups across every sender.
CREATE INDEX IF NOT EXISTS phase13_first_touch_recipient_time_idx
  ON leadgen.phase13_first_touch_reservations((lower(btrim(normalized_recipient))),reserved_at DESC);

-- Owner-aware reservation (066) plus the cross-sender rules above. Limits, prior reservations
-- and company cooldown stay per sender; the recipient cooldown and merchant assignment are
-- checked across all senders under a recipient lock taken after the per-sender locks.
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
  recipient_key text := lower(btrim(coalesce(target_normalized_recipient,'')));
  recipient_cooldown_days constant integer := 30;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:email-quota:'||owner_label,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:policy:'||target_policy_revision,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:company:'||target_company_id::text||':'||owner_label,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase13:first-touch:recipient:'||recipient_key,0));

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

  -- A4/A5: a merchant reserves only after opting in, and not while its mailbox is held.
  IF target_merchant_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM leadgen.merchants m WHERE m.id=target_merchant_id AND m.auto_first_touch_enabled)
    THEN RAISE EXCEPTION 'MERCHANT_AUTO_FIRST_TOUCH_OFF' USING ERRCODE='P0001'; END IF;
    IF EXISTS(SELECT 1 FROM leadgen.merchant_mailboxes b WHERE b.merchant_id=target_merchant_id AND b.sending_hold_at IS NOT NULL)
    THEN RAISE EXCEPTION 'MERCHANT_MAILBOX_HELD' USING ERRCODE='P0001'; END IF;
  -- A3: a company assigned to a merchant is that merchant's prospect, not SIM's.
  ELSIF EXISTS(SELECT 1 FROM leadgen.merchant_companies mc WHERE mc.company_id=target_company_id)
  THEN RAISE EXCEPTION 'COMPANY_ASSIGNED_TO_MERCHANT' USING ERRCODE='P0001';
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

  -- A3: cross-sender recipient cooldown (SIM and every merchant together).
  IF EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r
      WHERE lower(btrim(r.normalized_recipient))=recipient_key
        AND r.reserved_at>=observed_at-make_interval(days=>recipient_cooldown_days)
        AND r.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS'))
  THEN RAISE EXCEPTION 'RECIPIENT_RECENTLY_CONTACTED' USING ERRCODE='P0001'; END IF;

  INSERT INTO leadgen.phase13_first_touch_reservations
    (company_id,policy_revision,decision_maker_contact_id,normalized_recipient,market_code,template_set_key,template_key,
     sender_identity,reply_to,subject,body_text,content_hash,eligibility_snapshot,reservation_minute,reservation_day,created_at,reserved_at,reason_codes,merchant_id)
  VALUES(target_company_id,target_policy_revision,target_decision_maker_contact_id,target_normalized_recipient,target_market_code,
    target_template_set_key,target_template_key,target_sender_identity,target_reply_to,target_subject,target_body_text,
    target_content_hash,target_eligibility_snapshot,minute_bucket,local_day,
    observed_at,observed_at,coalesce(target_reason_codes,'{}'),target_merchant_id) RETURNING * INTO created;
  RETURN created;
END; $$;

COMMIT;
