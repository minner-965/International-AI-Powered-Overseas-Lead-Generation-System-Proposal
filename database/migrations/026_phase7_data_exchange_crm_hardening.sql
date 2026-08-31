BEGIN;

-- Phase 7 migration 025 has already been recorded in the checksum ledger.
-- Keep it immutable and apply release-blocking data exchange hardening additively.
ALTER TABLE leadgen.reference_data_import_rows
    DROP CONSTRAINT IF EXISTS reference_data_import_rows_row_status_check;
ALTER TABLE leadgen.reference_data_import_rows
    ADD CONSTRAINT reference_data_import_rows_row_status_check
        CHECK (row_status IN ('ACCEPTED','REVIEW','REJECTED','DUPLICATE','COMMITTED'));

CREATE TABLE IF NOT EXISTS leadgen.data_import_effect_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    effect_type text NOT NULL CHECK (effect_type IN ('REBUILD_ICP_PROFILE','RECALCULATE_CUSTOMER_MATCH')),
    effect_version text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
    effect_status text NOT NULL DEFAULT 'PENDING'
        CHECK (effect_status IN ('PENDING','DISPATCHED','RETRYABLE_ERROR','COMPLETED','CANCELLED')),
    queue_job_id text,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (import_id,effect_type,effect_version)
);
CREATE INDEX IF NOT EXISTS idx_data_import_effect_pending
    ON leadgen.data_import_effect_outbox(effect_status,updated_at)
    WHERE effect_status IN ('PENDING','RETRYABLE_ERROR');

COMMIT;
