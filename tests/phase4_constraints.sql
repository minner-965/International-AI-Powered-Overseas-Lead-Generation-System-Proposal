BEGIN;

DO $$
DECLARE
    job_id_value uuid;
    candidate_id_value uuid;
    verification_id_value uuid;
BEGIN
    SELECT id INTO job_id_value FROM leadgen.research_jobs ORDER BY created_at DESC LIMIT 1;
    SELECT id INTO candidate_id_value FROM leadgen.research_candidates WHERE research_job_id=job_id_value LIMIT 1;
    SELECT id INTO verification_id_value FROM leadgen.research_candidate_verifications LIMIT 1;

    IF job_id_value IS NULL OR verification_id_value IS NULL THEN
        RAISE EXCEPTION 'Phase 4 acceptance rows are required';
    END IF;

    BEGIN
        UPDATE leadgen.research_jobs SET country_code=NULL WHERE id=job_id_value;
        RAISE EXCEPTION 'research_jobs.country_code unexpectedly accepted NULL';
    EXCEPTION WHEN not_null_violation THEN NULL;
    END;

    BEGIN
        UPDATE leadgen.research_candidate_verifications SET importer_status='GUESSED' WHERE id=verification_id_value;
        RAISE EXCEPTION 'invalid importer status unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO leadgen.companies
            (company_name,normalized_domain,country_code,data_origin,company_size_band)
        VALUES ('Phase 4 invalid company','phase4-invalid-company','BD','live_discovered','enterprise');
        RAISE EXCEPTION 'live_discovered unexpectedly accepted without research_job_id';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO leadgen.companies
        (company_name,normalized_domain,country_code,country_name,data_origin,research_job_id,company_size_band)
    VALUES ('Phase 4 valid company','phase4-valid-company','BD','Bangladesh','live_discovered',job_id_value,'enterprise');

    IF candidate_id_value IS NOT NULL THEN
        BEGIN
            INSERT INTO leadgen.research_candidate_contacts
                (research_candidate_id,contact_type,contact_value,normalized_value,source_url,
                 verification_status,verification_method,captured_at,normalization_status)
            VALUES (candidate_id_value,'PHONE','0123456789','0123456789','https://example.test/contact',
                'PUBLICLY_OBSERVED','constraint_test',now(),'GUESSED');
            RAISE EXCEPTION 'invalid phone normalization status unexpectedly accepted';
        EXCEPTION WHEN check_violation THEN NULL;
        END;
    END IF;
END $$;

ROLLBACK;
