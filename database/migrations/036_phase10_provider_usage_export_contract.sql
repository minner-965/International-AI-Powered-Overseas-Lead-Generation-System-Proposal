BEGIN;

ALTER TABLE leadgen.data_export_jobs
  DROP CONSTRAINT IF EXISTS data_export_jobs_export_type_check;

ALTER TABLE leadgen.data_export_jobs
  ADD CONSTRAINT data_export_jobs_export_type_check CHECK (export_type IN (
    'LEAD_MASTER_INTERNAL','SALES_OPPORTUNITY','PRODUCT_CATALOG_INTERNAL',
    'CUSTOMER_DEAL_HISTORY','IMPORT_ERROR_REPORT','RESEARCH_JOB_PROVIDER_USAGE'
  ));

COMMIT;
