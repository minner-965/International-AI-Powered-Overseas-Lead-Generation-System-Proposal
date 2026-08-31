BEGIN;

-- Migrations 025 and 026 are checksum-ledger entries and remain immutable.
-- Preserve the server-bound role used for the exact management decision event.
ALTER TABLE leadgen.business_opportunity_management_events
    DROP CONSTRAINT IF EXISTS business_opportunity_management_events_actor_role_check;
ALTER TABLE leadgen.business_opportunity_management_events
    ADD CONSTRAINT business_opportunity_management_events_actor_role_check
        CHECK (actor_role IN ('MANAGEMENT','SALES','MANAGEMENT_APPROVER'));

COMMIT;
