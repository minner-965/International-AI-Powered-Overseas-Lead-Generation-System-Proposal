BEGIN;

-- Phase 10.2 emits category-first terminal readiness values. Keep every
-- historical readiness value valid while admitting the new category outcomes.
ALTER TABLE leadgen.cooperation_feasibility_results
  DROP CONSTRAINT IF EXISTS cooperation_feasibility_results_opportunity_readiness_check;
ALTER TABLE leadgen.cooperation_feasibility_results
  ADD CONSTRAINT cooperation_feasibility_results_opportunity_readiness_check CHECK (opportunity_readiness IN (
    'SALES_READY','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION','HISTORICAL_REVIEW',
    'EXISTING_CUSTOMER','SUPPRESSED','HOLD','REVIEW','STRATEGIC_LONG_SHOT','INELIGIBLE_BUYER_MODEL',
    'NEEDS_INTERNAL_CATALOG_EVIDENCE','NEEDS_DPV_CATEGORY_SCOPE_APPROVAL','NEEDS_PRODUCT_EVIDENCE',
    'CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','CATEGORY_CONFIRMATION_REQUIRED','CATEGORY_MISMATCH',
    'PRODUCT_MISMATCH','WEAK_CATEGORY_MATCH'
  ));

COMMIT;
