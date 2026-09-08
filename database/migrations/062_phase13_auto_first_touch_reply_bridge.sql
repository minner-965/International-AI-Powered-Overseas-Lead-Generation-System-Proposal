BEGIN;

-- Phase 13 automated first-touch threads are sourced by an immutable reservation,
-- not by the legacy manual eligibility/approval projection.
ALTER TABLE leadgen.outreach_threads
  ALTER COLUMN recipient_id DROP NOT NULL,
  ADD COLUMN first_touch_reservation_id uuid UNIQUE,
  ADD CONSTRAINT outreach_threads_first_touch_company_fk
    FOREIGN KEY(first_touch_reservation_id,company_id)
    REFERENCES leadgen.phase13_first_touch_reservations(id,company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT outreach_threads_source_check CHECK(
    (recipient_id IS NOT NULL AND first_touch_reservation_id IS NULL)
    OR (recipient_id IS NULL AND first_touch_reservation_id IS NOT NULL)
  );

CREATE INDEX outreach_threads_first_touch_status_idx
  ON leadgen.outreach_threads(first_touch_reservation_id,thread_status)
  WHERE first_touch_reservation_id IS NOT NULL;

COMMIT;
