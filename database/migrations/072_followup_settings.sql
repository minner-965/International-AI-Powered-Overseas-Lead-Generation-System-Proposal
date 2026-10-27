-- 072: follow-up email settings move from the environment to the workspace (optimization plan, batch 2 D2).
--   CRM_FOLLOWUP_DRAFTS  enabled = draft follow-up emails 2 and 3 for human approval
--                        settings.daily_limit = SIM's daily cold-outreach limit (first touch + follow-ups)
-- The row starts with settings.source = 'ENVIRONMENT_DEFAULT': until someone saves the setting on the
-- settings page, the server keeps using CRM_FOLLOWUP_DRAFTS_ENABLED / CRM_FOLLOWUP_DAILY_LIMIT from the
-- environment, so applying this migration changes nothing. Every later change is an append-only
-- automation_control_events row (revision + actor + reason). Safe to re-run.
-- Also (D1): the per-market email send window becomes editable on the Markets settings tab; each change
-- is appended to research_market_registry_events with the previous and the new window.
BEGIN;

ALTER TABLE leadgen.research_market_registry_events
  ADD COLUMN IF NOT EXISTS previous_business_send_window jsonb,
  ADD COLUMN IF NOT EXISTS business_send_window jsonb;

INSERT INTO leadgen.automation_controls(control_key,enabled,revision,settings,updated_by,change_reason)
VALUES('CRM_FOLLOWUP_DRAFTS',false,1,'{"source":"ENVIRONMENT_DEFAULT","daily_limit":null}','batch2-072-migration',
  'initial state; the environment values apply until the setting is saved in the workspace')
ON CONFLICT DO NOTHING;

INSERT INTO leadgen.automation_control_events
  (control_key,revision,previous_enabled,enabled,settings_snapshot,actor,change_reason,idempotency_key)
SELECT control_key,revision,NULL,enabled,settings,updated_by,change_reason,'migration:072:'||control_key
FROM leadgen.automation_controls
WHERE control_key='CRM_FOLLOWUP_DRAFTS' AND revision=1
ON CONFLICT DO NOTHING;

COMMIT;
