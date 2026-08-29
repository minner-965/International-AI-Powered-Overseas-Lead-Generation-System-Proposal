BEGIN;

ALTER TABLE leadgen.companies
    ADD COLUMN IF NOT EXISTS is_b2b boolean,
    ADD COLUMN IF NOT EXISTS importer_wholesaler_fit boolean,
    ADD COLUMN IF NOT EXISTS chain_supply_fit boolean,
    ADD COLUMN IF NOT EXISTS source_record_count integer NOT NULL DEFAULT 1;

ALTER TABLE leadgen.lead_reviews
    ADD COLUMN IF NOT EXISTS product_fit_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_fit_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS importer_fit_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS evidence_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scale_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS buying_signal_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS decision_maker_score integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS contact_validity_score integer NOT NULL DEFAULT 0;

COMMIT;
