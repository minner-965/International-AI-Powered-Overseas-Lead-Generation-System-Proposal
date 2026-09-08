BEGIN;
-- Adopt the existing configured/visible markets; BD remains hidden and disabled.
CREATE TABLE leadgen.research_market_registry (
  market_code text PRIMARY KEY CHECK(market_code ~ '^[A-Z]{2}$'),
  country_name text NOT NULL,
  status text NOT NULL CHECK(status IN('ACTIVE','INACTIVE','HIDDEN')),
  search_enabled boolean NOT NULL DEFAULT false,
  market_profile text NOT NULL,
  languages text[] NOT NULL CHECK(cardinality(languages)>0),
  buyer_types text[] NOT NULL CHECK(cardinality(buyer_types)>0),
  source_reference text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status='ACTIVE' OR NOT search_enabled)
);
INSERT INTO leadgen.research_market_registry
  (market_code,country_name,status,search_enabled,market_profile,languages,buyer_types,source_reference)
VALUES
 ('AE','United Arab Emirates','ACTIVE',true,'AE',ARRAY['en'],ARRAY['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'],'marketProfiles.js + market-visibility.js + existing Research buyer defaults'),
 ('MX','Mexico','ACTIVE',true,'MX',ARRAY['es','en'],ARRAY['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'],'marketProfiles.js + market-visibility.js + existing Research buyer defaults'),
 ('BD','Bangladesh','HIDDEN',false,'BD',ARRAY['en','bn'],ARRAY['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'],'marketProfiles.js + market-visibility.js; hidden market retained');

CREATE TABLE leadgen.research_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 requested_by text NOT NULL,
 requested_role text NOT NULL,
 idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 scope_digest text NOT NULL CHECK(length(scope_digest)=64),
 research_scope_snapshot jsonb NOT NULL CHECK(jsonb_typeof(research_scope_snapshot)='object'),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
 total_scopes integer NOT NULL CHECK(total_scopes>0),
 created_child_count integer NOT NULL DEFAULT 0 CHECK(created_child_count>=0),
 reused_child_count integer NOT NULL DEFAULT 0 CHECK(reused_child_count>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total_scopes=created_child_count+reused_child_count)
);
CREATE INDEX research_batches_scope_idx ON leadgen.research_batches(requested_by,scope_digest,created_at DESC);
CREATE TABLE leadgen.research_batch_requests (
 idempotency_key text PRIMARY KEY CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 requested_by text NOT NULL,
 batch_id uuid NOT NULL REFERENCES leadgen.research_batches(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE leadgen.research_job_scope_requests (
 idempotency_key text PRIMARY KEY CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
 requested_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE leadgen.research_batch_children (
 batch_id uuid NOT NULL REFERENCES leadgen.research_batches(id) ON DELETE RESTRICT,
 scope_key text NOT NULL,
 research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
 market_code text NOT NULL,
 category_scope_id uuid NOT NULL REFERENCES leadgen.dpv_product_category_scopes(id) ON DELETE RESTRICT,
 scope_snapshot jsonb NOT NULL CHECK(jsonb_typeof(scope_snapshot)='object'),
 reused boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,scope_key),
 UNIQUE(batch_id,research_job_id)
);
CREATE INDEX research_batch_children_job_idx ON leadgen.research_batch_children(research_job_id);
CREATE FUNCTION leadgen.guard_research_batch_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Research batch history is immutable'; END IF;
 IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
 THEN RAISE EXCEPTION 'Research scope snapshot is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER research_batch_snapshot_immutable BEFORE UPDATE OR DELETE ON leadgen.research_batches
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_batch_snapshot();
CREATE FUNCTION leadgen.guard_research_batch_child() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Research batch child scope is immutable'; END; $$;
CREATE TRIGGER research_batch_child_immutable BEFORE UPDATE OR DELETE ON leadgen.research_batch_children
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_batch_child();
CREATE TRIGGER research_batch_request_immutable BEFORE UPDATE OR DELETE ON leadgen.research_batch_requests
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_batch_child();
CREATE TRIGGER research_job_scope_request_immutable BEFORE UPDATE OR DELETE ON leadgen.research_job_scope_requests
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_batch_child();
CREATE FUNCTION leadgen.refresh_research_batch_status(target_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM leadgen.research_batches WHERE id=target_batch FOR UPDATE;
 UPDATE leadgen.research_batches b SET status=x.status,updated_at=now() FROM (
 SELECT CASE
   WHEN bool_and(j.status IN('COMPLETE','COMPLETED')) THEN 'COMPLETED'
   WHEN bool_and(j.status='FAILED') THEN 'FAILED'
   WHEN bool_and(j.status='CANCELLED') THEN 'CANCELLED'
   WHEN bool_and(j.status IN('COMPLETE','COMPLETED','PARTIAL','FAILED','CANCELLED')) THEN 'PARTIAL'
   WHEN bool_and(j.status='QUEUED') THEN 'QUEUED'
   ELSE 'RUNNING' END status
 FROM leadgen.research_batch_children c JOIN leadgen.research_jobs j ON j.id=c.research_job_id
 WHERE c.batch_id=target_batch HAVING count(*)>0
 ) x WHERE b.id=target_batch AND b.status IS DISTINCT FROM x.status;
END;
$$;
CREATE FUNCTION leadgen.research_job_batch_status_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 FOR parent_id IN SELECT batch_id FROM leadgen.research_batch_children WHERE research_job_id=NEW.id ORDER BY batch_id
 LOOP PERFORM leadgen.refresh_research_batch_status(parent_id); END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER research_job_batch_status AFTER UPDATE OF status ON leadgen.research_jobs
 FOR EACH ROW WHEN(NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION leadgen.research_job_batch_status_changed();
COMMIT;
