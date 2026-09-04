BEGIN;

CREATE TABLE IF NOT EXISTS leadgen.commercial_product_fit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
  product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
  category_procurement_match_result_id uuid NOT NULL,
  commercial_fit_score integer CHECK (commercial_fit_score BETWEEN 0 AND 100),
  commercial_fit_band text NOT NULL CHECK (commercial_fit_band IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  coverage_percent integer NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
  calculation_version text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
  execution_key text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  unknown_dimensions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_procurement_match_result_id,company_id)
    REFERENCES leadgen.category_procurement_match_results(id,company_id) ON DELETE RESTRICT,
  CHECK ((coverage_percent=0 AND commercial_fit_score IS NULL AND commercial_fit_band='UNKNOWN') OR
         (coverage_percent>0 AND commercial_fit_score IS NOT NULL AND commercial_fit_band<>'UNKNOWN')),
  UNIQUE (company_id,product_profile,execution_key),
  UNIQUE (id,company_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_product_fit_latest
  ON leadgen.commercial_product_fit_results(company_id,product_profile,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_product_fit_ranking
  ON leadgen.commercial_product_fit_results(commercial_fit_band,commercial_fit_score DESC,coverage_percent DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.commercial_product_fit_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_product_fit_result_id uuid NOT NULL,
  company_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN (
    'ASSORTMENT_RELEVANCE','COMMERCIAL_POSITIONING_PRICE_BAND','ATTRIBUTE_SPECIFICATION_FIT',
    'MOQ_ORDER_FORMAT_COMPATIBILITY','IMPORT_SOURCING_MODEL_FIT','RECENT_PRODUCT_BUYING_SIGNAL')),
  state text NOT NULL CHECK (state IN ('OBSERVED','UNKNOWN')),
  points integer,
  maximum integer NOT NULL CHECK (maximum IN (10,15,20,25)),
  reason_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (commercial_product_fit_result_id,company_id)
    REFERENCES leadgen.commercial_product_fit_results(id,company_id) ON DELETE RESTRICT,
  CHECK ((state='OBSERVED' AND points BETWEEN 0 AND maximum) OR (state='UNKNOWN' AND points IS NULL)),
  UNIQUE (commercial_product_fit_result_id,dimension),
  UNIQUE (id,company_id)
);

CREATE TABLE IF NOT EXISTS leadgen.commercial_product_fit_evidence (
  commercial_product_fit_dimension_id uuid NOT NULL,
  company_id uuid NOT NULL,
  prospect_category_observation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (commercial_product_fit_dimension_id,company_id)
    REFERENCES leadgen.commercial_product_fit_dimensions(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY (prospect_category_observation_id,company_id)
    REFERENCES leadgen.prospect_category_observations(id,company_id) ON DELETE RESTRICT,
  PRIMARY KEY (commercial_product_fit_dimension_id,prospect_category_observation_id)
);

CREATE OR REPLACE VIEW leadgen.commercial_product_fit_current AS
SELECT DISTINCT ON (company_id,product_profile) *
FROM leadgen.commercial_product_fit_results
ORDER BY company_id,product_profile,created_at DESC,id DESC;

DO $$
DECLARE audit_table text;
BEGIN
  FOREACH audit_table IN ARRAY ARRAY[
    'commercial_product_fit_results','commercial_product_fit_dimensions','commercial_product_fit_evidence'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON leadgen.%I','trg_'||audit_table||'_immutable',audit_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON leadgen.%I FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase10_append_only_mutation()',
      'trg_'||audit_table||'_immutable',audit_table);
  END LOOP;
END $$;

COMMENT ON TABLE leadgen.commercial_product_fit_results IS
  'Append-only non-blocking commercial ranking. It never changes identity, Buyer/contact validity, management approval or send permission.';
COMMENT ON COLUMN leadgen.commercial_product_fit_results.coverage_percent IS
  'Sum of dimension weights backed by verified evidence; UNKNOWN dimensions are excluded rather than scored as zero.';

COMMIT;
