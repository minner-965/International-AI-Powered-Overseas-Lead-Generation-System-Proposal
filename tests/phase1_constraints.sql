BEGIN;

DO $$
DECLARE
    queued_job_id uuid;
BEGIN
    SELECT id INTO queued_job_id
    FROM leadgen.research_jobs
    WHERE status = 'QUEUED'
    ORDER BY created_at DESC
    LIMIT 1;

    IF queued_job_id IS NULL THEN
        RAISE EXCEPTION 'A queued research job is required for this constraint test';
    END IF;

    BEGIN
        INSERT INTO leadgen.companies
            (company_name, normalized_domain, country_code, data_origin)
        VALUES
            ('Phase 1 Invalid Constraint Test', 'phase1-invalid-constraint-test', 'AE', 'live_discovered');
        RAISE EXCEPTION 'live_discovered unexpectedly accepted without research_job_id';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    INSERT INTO leadgen.companies
        (company_name, normalized_domain, country_code, data_origin, research_job_id)
    VALUES
        ('Phase 1 Valid Constraint Test', 'phase1-valid-constraint-test', 'AE', 'live_discovered', queued_job_id);
END $$;

ROLLBACK;
