BEGIN;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY company_id, lower(business_email)
      ORDER BY verification_checked_at DESC NULLS LAST, updated_at DESC, created_at DESC
    ) AS row_rank
  FROM leadgen.contacts
  WHERE business_email IS NOT NULL
)
DELETE FROM leadgen.contacts c
USING ranked r
WHERE c.id = r.id AND r.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_company_business_email
  ON leadgen.contacts (company_id, lower(business_email))
  WHERE business_email IS NOT NULL;

COMMIT;
