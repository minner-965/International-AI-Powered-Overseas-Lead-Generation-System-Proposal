BEGIN;

-- New-prospect product opportunity is a category-level qualification. Product
-- master and historical order rows continue to support ICP/scoring and remain
-- available in their independent views; legacy opportunity/candidate rows are
-- retained without rewriting.
ALTER TABLE leadgen.product_opportunity_results
  DROP CONSTRAINT IF EXISTS product_opportunity_results_recommendation_status_check;
ALTER TABLE leadgen.product_opportunity_results
  ADD CONSTRAINT product_opportunity_results_recommendation_status_check CHECK (
    recommendation_status IN (
      'READY','PARTIAL_INTERNAL_CATALOG','NO_REAL_CANDIDATE',
      'NOT_RUN_GATE_FAILED','CATEGORY_SCOPE_QUALIFIED'
    )
  );

ALTER TABLE leadgen.product_opportunity_results
  DROP CONSTRAINT IF EXISTS product_opportunity_results_phase10_category_only_check;
ALTER TABLE leadgen.product_opportunity_results
  ADD CONSTRAINT product_opportunity_results_phase10_category_only_check CHECK (
    recommendation_status <> 'CATEGORY_SCOPE_QUALIFIED'
    OR (
      candidate_count=0
      AND catalog_enrichment_required=false
      AND sku_readiness_status IN ('NO_EXACT_SKU')
      AND cardinality(missing_catalog_evidence)=0
    )
  );

COMMIT;
