ALTER TABLE leadgen.companies
  ADD COLUMN IF NOT EXISTS company_size_band text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS procurement_access_fit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS size_evidence text,
  ADD COLUMN IF NOT EXISTS social_profiles jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE leadgen.companies DROP CONSTRAINT IF EXISTS companies_company_size_band_check;
ALTER TABLE leadgen.companies
  ADD CONSTRAINT companies_company_size_band_check
  CHECK (company_size_band IN ('micro','small','medium','large','unknown'));

CREATE INDEX IF NOT EXISTS idx_companies_size_access
  ON leadgen.companies (company_size_band, procurement_access_fit)
  WHERE data_origin = 'public_web';
