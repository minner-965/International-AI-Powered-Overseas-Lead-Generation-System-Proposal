-- 068: split the automation master switch into three independent subsystems.
--   RESEARCH_PROVIDER_EXECUTION  research search (existing, 061)
--   PHASE13_AUTO_FIRST_TOUCH     auto first-touch email (existing, 061, with phase13_first_touch_controls)
--   CONTACT_RESEARCH_EXECUTION   contact research: decision-maker search + Hunter checks (new)
-- Contact research was hard-coded on and ran every 30 s regardless of the master switch. It now has
-- its own control row, fail-closed (disabled) until management turns it on. Append-only: one control
-- row and its initial audit event; existing rows and events are untouched. Safe to re-run.
BEGIN;

INSERT INTO leadgen.automation_controls(control_key,enabled,revision,settings,updated_by,change_reason)
VALUES('CONTACT_RESEARCH_EXECUTION',false,1,'{}','batch1-068-migration','fail-closed initial state; contact research split from the master switch')
ON CONFLICT DO NOTHING;

INSERT INTO leadgen.automation_control_events
  (control_key,revision,previous_enabled,enabled,settings_snapshot,actor,change_reason,idempotency_key)
SELECT control_key,revision,NULL,enabled,settings,updated_by,change_reason,'migration:068:'||control_key
FROM leadgen.automation_controls
WHERE control_key='CONTACT_RESEARCH_EXECUTION' AND revision=1
ON CONFLICT DO NOTHING;

COMMIT;
