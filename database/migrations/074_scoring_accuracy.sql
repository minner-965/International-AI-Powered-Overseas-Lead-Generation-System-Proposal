-- 074: scoring accuracy (optimization plan, batch 3 C1).
--   Retail chains and department stores can be verified buyers: company verification records their
--   own store-network evidence as RETAIL_CHAIN / DEPARTMENT_STORE (RETAILER reserved for single
--   retailers), and each candidate verification keeps the retail-chain buyer status next to the
--   importer / wholesaler / distributor / general-trading statuses.
-- Additive only: no existing row changes; old evidence and verification history stay as they are.
-- Safe to re-run.
BEGIN;

ALTER TABLE leadgen.company_verification_evidence
  DROP CONSTRAINT IF EXISTS company_verification_evidence_evidence_type_check;
ALTER TABLE leadgen.company_verification_evidence
  ADD CONSTRAINT company_verification_evidence_evidence_type_check CHECK (evidence_type IN (
    'COMPANY_IDENTITY','LOCATION','IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING',
    'PRODUCT_CATEGORY','BRANDS','RETAIL_CHANNEL','REGIONAL_COVERAGE','WAREHOUSE','LOCATIONS',
    'EMPLOYEE_SIZE','COMPANY_SCALE','RECENT_ACTIVITY','PUBLIC_CONTACT','SOCIAL_ACCOUNT',
    'RETAIL_CHAIN','DEPARTMENT_STORE','RETAILER'
  ));

ALTER TABLE leadgen.research_candidate_verifications
  ADD COLUMN IF NOT EXISTS retail_chain_status text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE leadgen.research_candidate_verifications
  DROP CONSTRAINT IF EXISTS research_candidate_verifications_retail_chain_status_check;
ALTER TABLE leadgen.research_candidate_verifications
  ADD CONSTRAINT research_candidate_verifications_retail_chain_status_check
  CHECK (retail_chain_status IN ('VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED'));

COMMENT ON COLUMN leadgen.research_candidate_verifications.retail_chain_status IS
  'C1: VERIFIED when the company''s own store network and the approved product category are both evidenced on its official pages.';

COMMIT;
