-- Catalog imports are supplemental context, not a prerequisite for research.
-- Existing snapshots, cohort rows and their composite foreign key are preserved.
ALTER TABLE leadgen.research_job_cohort_items
  ALTER COLUMN product_profile_catalog_snapshot_id DROP NOT NULL;
