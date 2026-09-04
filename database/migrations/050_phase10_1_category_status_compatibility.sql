BEGIN;

-- New category/contact language is written from Phase 10.1 onward. Historical
-- values remain valid and are projected by application compatibility helpers.
ALTER TABLE leadgen.category_procurement_match_results
  DROP CONSTRAINT IF EXISTS category_procurement_match_results_match_status_check;
ALTER TABLE leadgen.category_procurement_match_results
  ADD CONSTRAINT category_procurement_match_results_match_status_check CHECK (match_status IN (
    'CATEGORY_MATCH_CONFIRMED','CATEGORY_CONFIRMATION_REQUIRED','CATEGORY_MISMATCH',
    'CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','WEAK_CATEGORY_MATCH',
    'PRODUCT_MISMATCH','NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE',
    'NEEDS_DPV_CATEGORY_SCOPE_APPROVAL','INELIGIBLE_BUYER_MODEL'
  ));

ALTER TABLE leadgen.decision_maker_contacts
  ADD COLUMN IF NOT EXISTS canonical_route_key text
  GENERATED ALWAYS AS (contact_type||':'||lower(btrim(contact_value_normalized))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_maker_contacts_company_route
  ON leadgen.decision_maker_contacts(company_id,canonical_route_key);

COMMENT ON COLUMN leadgen.decision_maker_contacts.canonical_route_key IS
  'Company-level normalized contact identity; independent of category and decision-maker wrappers.';

COMMIT;
