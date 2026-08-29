BEGIN;

-- One observation belongs to one import batch. Exact source replays in a later
-- batch get their own audit record and point to the earlier observation; they
-- must not borrow an import row owned by another batch.
ALTER TABLE leadgen.reference_data_imports
  DROP CONSTRAINT IF EXISTS reference_data_imports_import_type_content_sha256_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_import_batch_content_once
  ON leadgen.reference_data_imports(import_batch_id, import_type, content_sha256)
  WHERE import_batch_id IS NOT NULL;

-- Preserve the pre-V2.3 CSV import idempotency contract for imports that do not
-- belong to a shared-history batch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_import_unbatched_content_once
  ON leadgen.reference_data_imports(import_type, content_sha256)
  WHERE import_batch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_reference_import_source_versions
  ON leadgen.reference_data_imports(import_type, lower(source_filename), import_version DESC, uploaded_at DESC);

ALTER TABLE leadgen.reference_data_import_rows
  ADD COLUMN IF NOT EXISTS replays_import_row_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='reference_data_import_rows_replays_import_row_id_fkey'
      AND conrelid='leadgen.reference_data_import_rows'::regclass
  ) THEN
    ALTER TABLE leadgen.reference_data_import_rows
      ADD CONSTRAINT reference_data_import_rows_replays_import_row_id_fkey
      FOREIGN KEY (replays_import_row_id)
      REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT;
  END IF;
END $$;

DROP INDEX IF EXISTS leadgen.idx_reference_import_row_source_identity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_import_row_identity_per_import
  ON leadgen.reference_data_import_rows(import_id, source_identity_key)
  WHERE source_identity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reference_import_row_source_identity_global
  ON leadgen.reference_data_import_rows(source_identity_key, created_at DESC)
  WHERE source_identity_key IS NOT NULL;

-- Phase 5 V2.3 originally copied source order/follow-up quantities into MOQ.
-- Keep the quantity on order lines and remove only the unsupported derived MOQ.
UPDATE leadgen.product_master
SET moq=NULL, updated_at=now()
WHERE source_system IN ('SHARED_TF1','SHARED_CAVANNA_PO')
  AND moq IS NOT NULL;

COMMENT ON COLUMN leadgen.product_master.moq IS
  'Minimum order quantity only when explicitly identified as MOQ in source evidence; never derived from order quantity.';
COMMENT ON COLUMN leadgen.reference_data_import_rows.replays_import_row_id IS
  'Earlier source observation with the exact deterministic identity; canonical business rows remain globally idempotent.';

COMMIT;
