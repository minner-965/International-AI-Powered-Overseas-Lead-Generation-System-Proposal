BEGIN;

CREATE TEMP TABLE phase5_v2_018_state (
    company_needs_backfill boolean NOT NULL,
    contact_needs_backfill boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO phase5_v2_018_state VALUES (
    NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='leadgen' AND table_name='companies' AND column_name='verification_status'
    ),
    NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='leadgen' AND table_name='contacts' AND column_name='contact_verification_status'
    )
);

ALTER TABLE leadgen.companies
    ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS verification_source_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS verification_freshness text NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS explicit_exclusion_reason text,
    ADD COLUMN IF NOT EXISTS replaced_by_company_id uuid REFERENCES leadgen.companies(id) ON DELETE RESTRICT;

UPDATE leadgen.companies
SET verification_status = CASE phase4_verification_status
    WHEN 'VERIFIED_BUSINESS' THEN 'VERIFIED'
    WHEN 'REJECTED' THEN 'REJECTED'
    ELSE 'REVIEW'
END
WHERE (SELECT company_needs_backfill FROM phase5_v2_018_state);

UPDATE leadgen.companies c
SET last_verified_at = verified.last_verified_at
FROM (
    SELECT company_id, max(verified_at) AS last_verified_at
    FROM leadgen.research_candidate_verifications
    WHERE company_id IS NOT NULL
      AND verification_status = 'VERIFIED_BUSINESS'
      AND verified_at IS NOT NULL
    GROUP BY company_id
) verified
WHERE verified.company_id = c.id;

UPDATE leadgen.companies c
SET verification_source_count = source_counts.source_count
FROM (
    SELECT company_id, count(*)::integer AS source_count
    FROM leadgen.sources
    GROUP BY company_id
) source_counts
WHERE source_counts.company_id = c.id;

UPDATE leadgen.companies
SET verification_freshness = CASE
    WHEN last_verified_at IS NULL THEN 'UNKNOWN'
    WHEN last_verified_at >= now() - interval '180 days' THEN 'CURRENT'
    WHEN last_verified_at >= now() - interval '365 days' THEN 'AGING'
    ELSE 'STALE'
END;

ALTER TABLE leadgen.companies
    DROP CONSTRAINT IF EXISTS companies_verification_status_check,
    DROP CONSTRAINT IF EXISTS companies_lifecycle_status_check,
    DROP CONSTRAINT IF EXISTS companies_verification_source_count_check,
    DROP CONSTRAINT IF EXISTS companies_verification_freshness_check,
    DROP CONSTRAINT IF EXISTS companies_replacement_lifecycle_check,
    DROP CONSTRAINT IF EXISTS companies_not_self_replaced_check;

ALTER TABLE leadgen.companies
    ADD CONSTRAINT companies_verification_status_check
        CHECK (verification_status IN ('VERIFIED','REVIEW','REJECTED')),
    ADD CONSTRAINT companies_lifecycle_status_check
        CHECK (lifecycle_status IN ('ACTIVE','STALE','SUPERSEDED','DUPLICATE','INVALID','ARCHIVED')),
    ADD CONSTRAINT companies_verification_source_count_check
        CHECK (verification_source_count >= 0),
    ADD CONSTRAINT companies_verification_freshness_check
        CHECK (verification_freshness IN ('CURRENT','AGING','STALE','UNKNOWN')),
    ADD CONSTRAINT companies_replacement_lifecycle_check
        CHECK (replaced_by_company_id IS NULL OR lifecycle_status IN ('SUPERSEDED','DUPLICATE','ARCHIVED')),
    ADD CONSTRAINT companies_not_self_replaced_check
        CHECK (replaced_by_company_id IS NULL OR replaced_by_company_id <> id);

ALTER TABLE leadgen.contacts
    ADD COLUMN IF NOT EXISTS contact_verification_status text NOT NULL DEFAULT 'PUBLICLY_OBSERVED',
    ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS superseded_by_contact_id uuid REFERENCES leadgen.contacts(id) ON DELETE RESTRICT;

UPDATE leadgen.contacts
SET contact_verification_status = CASE
        WHEN lower(coalesce(email_verification_status,'')) = 'valid' THEN 'DOMAIN_MX_VERIFIED'
        WHEN lower(coalesce(email_verification_status,'')) = 'invalid' THEN 'INVALID'
        ELSE 'PUBLICLY_OBSERVED'
    END,
    lifecycle_status = CASE
        WHEN lower(coalesce(email_verification_status,'')) = 'invalid' THEN 'INVALID'
        ELSE 'ACTIVE'
    END,
    last_verified_at = coalesce(verification_checked_at, captured_at)
WHERE (SELECT contact_needs_backfill FROM phase5_v2_018_state);

ALTER TABLE leadgen.contacts
    DROP CONSTRAINT IF EXISTS contacts_contact_verification_status_check,
    DROP CONSTRAINT IF EXISTS contacts_lifecycle_status_check,
    DROP CONSTRAINT IF EXISTS contacts_replacement_lifecycle_check,
    DROP CONSTRAINT IF EXISTS contacts_not_self_superseded_check;

ALTER TABLE leadgen.contacts
    ADD CONSTRAINT contacts_contact_verification_status_check
        CHECK (contact_verification_status IN (
            'PUBLICLY_OBSERVED','VALID_FORMAT','DOMAIN_MX_VERIFIED','STALE','INVALID','SUPERSEDED'
        )),
    ADD CONSTRAINT contacts_lifecycle_status_check
        CHECK (lifecycle_status IN ('ACTIVE','STALE','SUPERSEDED','INVALID','ARCHIVED')),
    ADD CONSTRAINT contacts_replacement_lifecycle_check
        CHECK (superseded_by_contact_id IS NULL OR lifecycle_status IN ('SUPERSEDED','ARCHIVED')),
    ADD CONSTRAINT contacts_not_self_superseded_check
        CHECK (superseded_by_contact_id IS NULL OR superseded_by_contact_id <> id);

CREATE TABLE IF NOT EXISTS leadgen.data_cleanup_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cleanup_batch_id text NOT NULL UNIQUE,
    scope text NOT NULL DEFAULT 'DPV_DATABASE_ONLY'
        CHECK (scope = 'DPV_DATABASE_ONLY'),
    status text NOT NULL DEFAULT 'DRY_RUN'
        CHECK (status IN ('DRY_RUN','REVIEWED','APPROVED','EXECUTING','COMPLETED','CANCELLED')),
    backup_reference text NOT NULL,
    reviewed_count integer NOT NULL DEFAULT 0 CHECK (reviewed_count >= 0),
    proposed_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    dependency_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS leadgen.data_cleanup_plan_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cleanup_batch_id text NOT NULL REFERENCES leadgen.data_cleanup_batches(cleanup_batch_id) ON DELETE RESTRICT,
    entity_type text NOT NULL DEFAULT 'COMPANY' CHECK (entity_type = 'COMPANY'),
    old_entity_id uuid NOT NULL,
    canonical_entity_id uuid,
    proposed_action text NOT NULL CHECK (proposed_action IN (
        'RETAINED','REVIEW','MERGED','SUPERSEDED','ARCHIVED','DELETED'
    )),
    reason_code text NOT NULL,
    reason_text text NOT NULL,
    old_data_origin text,
    new_data_origin text,
    strong_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
    dependency_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    safe_for_hard_delete boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cleanup_batch_id, entity_type, old_entity_id)
);

CREATE TABLE IF NOT EXISTS leadgen.data_cleanup_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL,
    old_entity_id uuid NOT NULL,
    canonical_entity_id uuid,
    action text NOT NULL CHECK (action IN ('MERGED','SUPERSEDED','ARCHIVED','DELETED','RETAINED')),
    reason_code text NOT NULL,
    reason_text text NOT NULL,
    old_data_origin text,
    new_data_origin text,
    performed_at timestamptz NOT NULL DEFAULT now(),
    performed_by text NOT NULL,
    cleanup_batch_id text NOT NULL REFERENCES leadgen.data_cleanup_batches(cleanup_batch_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_companies_opportunity_gate
    ON leadgen.companies (verification_status, lifecycle_status, country_code)
    WHERE verification_status = 'VERIFIED' AND lifecycle_status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_companies_replacement
    ON leadgen.companies (replaced_by_company_id)
    WHERE replaced_by_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle
    ON leadgen.contacts (company_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cleanup_plan_batch_action
    ON leadgen.data_cleanup_plan_items (cleanup_batch_id, proposed_action);
CREATE INDEX IF NOT EXISTS idx_cleanup_audit_entity
    ON leadgen.data_cleanup_audit (entity_type, old_entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cleanup_audit_canonical
    ON leadgen.data_cleanup_audit (canonical_entity_id, performed_at DESC)
    WHERE canonical_entity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION leadgen.guard_company_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    batch_id text;
BEGIN
    batch_id := current_setting('leadgen.cleanup_batch_id', true);
    IF batch_id IS NULL OR batch_id = '' THEN
        RAISE EXCEPTION 'company hard deletion requires an approved cleanup batch and prior audit row';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM leadgen.data_cleanup_batches b
        WHERE b.cleanup_batch_id = batch_id AND b.status IN ('APPROVED','EXECUTING')
    ) THEN
        RAISE EXCEPTION 'cleanup batch % is not approved', batch_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM leadgen.data_cleanup_audit a
        WHERE a.cleanup_batch_id = batch_id
          AND a.entity_type = 'COMPANY'
          AND a.old_entity_id = OLD.id
          AND a.action = 'DELETED'
    ) THEN
        RAISE EXCEPTION 'company % has no prior deletion audit row for batch %', OLD.id, batch_id;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_company_hard_delete ON leadgen.companies;
CREATE TRIGGER trg_guard_company_hard_delete
    BEFORE DELETE ON leadgen.companies
    FOR EACH ROW EXECUTE FUNCTION leadgen.guard_company_hard_delete();

COMMIT;
