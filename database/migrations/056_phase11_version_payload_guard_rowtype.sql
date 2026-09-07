BEGIN;

-- A shared trigger must not resolve fields belonging to the other table's
-- record type. Keep the original immutable-field allowlist with JSON projection.
CREATE OR REPLACE FUNCTION leadgen.protect_phase7_version_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  protected_fields text[];
  old_payload jsonb;
  new_payload jsonb;
BEGIN
  IF TG_TABLE_NAME='marketing_context_versions' THEN
    protected_fields := ARRAY['version','allowed_markets','allowed_product_profiles',
      'target_languages','ruleset_version','content','content_hash','created_by'];
  ELSIF TG_TABLE_NAME='product_master_revisions' THEN
    protected_fields := ARRAY['product_master_id','source_import_id','source_import_row_id',
      'supersedes_revision_id','revision_number','product_profile','category','subcategory',
      'revision_payload','catalog_status','effective_date','record_digest'];
  ELSE
    RETURN NEW;
  END IF;
  SELECT jsonb_object_agg(key,value) INTO old_payload
    FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(protected_fields);
  SELECT jsonb_object_agg(key,value) INTO new_payload
    FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(protected_fields);
  IF new_payload IS DISTINCT FROM old_payload THEN
    RAISE EXCEPTION '% version payload is immutable', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
