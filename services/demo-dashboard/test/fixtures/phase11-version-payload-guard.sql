BEGIN;
CREATE TEMP TABLE marketing_context_versions(version text, content jsonb, context_status text);
CREATE TRIGGER fixture_guard BEFORE UPDATE ON marketing_context_versions
  FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase7_version_payload();
INSERT INTO marketing_context_versions VALUES('fixture', '{"category":"WOMENSWEAR"}', 'PENDING_REVIEW');
UPDATE marketing_context_versions SET context_status='APPROVED';
DO $$ BEGIN
  BEGIN
    UPDATE marketing_context_versions SET content='{"changed":true}';
    RAISE EXCEPTION 'expected immutable content rejection' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%payload is immutable%' THEN RAISE; END IF;
  END;
END $$;
CREATE TEMP TABLE product_master_revisions(revision_number integer, revision_payload jsonb, review_status text);
CREATE TRIGGER fixture_guard BEFORE UPDATE ON product_master_revisions
  FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase7_version_payload();
INSERT INTO product_master_revisions VALUES(1, '{"category":"WOMENSWEAR"}', 'PENDING_REVIEW');
UPDATE product_master_revisions SET review_status='APPROVED';
DO $$ BEGIN
  BEGIN
    UPDATE product_master_revisions SET revision_payload='{"changed":true}';
    RAISE EXCEPTION 'expected immutable revision rejection' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%payload is immutable%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
