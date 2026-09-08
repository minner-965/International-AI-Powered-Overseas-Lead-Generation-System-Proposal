BEGIN;
-- Planning is separate from legacy executable query rows and creates no work.
CREATE TABLE leadgen.research_query_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid REFERENCES leadgen.research_batches(id) ON DELETE RESTRICT,
 research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
 strategy_version text NOT NULL CHECK(length(strategy_version)>0),
 scope_digest text NOT NULL CHECK(scope_digest ~ '^[0-9a-f]{64}$'),
 config_digest text NOT NULL CHECK(config_digest ~ '^[0-9a-f]{64}$'),
 scope_snapshot jsonb NOT NULL CHECK(jsonb_typeof(scope_snapshot)='object'),
 config_snapshot jsonb NOT NULL CHECK(jsonb_typeof(config_snapshot)='object'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(batch_id,research_job_id)=1)
);
CREATE UNIQUE INDEX research_query_plans_batch_version ON leadgen.research_query_plans(batch_id,strategy_version) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX research_query_plans_job_version ON leadgen.research_query_plans(research_job_id,strategy_version) WHERE research_job_id IS NOT NULL;
CREATE FUNCTION leadgen.guard_research_query_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Research query plan is immutable'; END; $$;
CREATE TRIGGER research_query_plan_immutable BEFORE UPDATE OR DELETE ON leadgen.research_query_plans
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_query_plan();

-- Provenance child of existing candidates: not another company registry.
-- Existing candidate_queries cannot represent one logical query across providers.
CREATE TABLE leadgen.research_search_hit_provenance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 research_candidate_id uuid NOT NULL REFERENCES leadgen.research_candidates(id) ON DELETE RESTRICT,
 company_id uuid REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
 root_domain text NOT NULL CHECK(length(root_domain)>0),
 query_fingerprint text NOT NULL CHECK(query_fingerprint ~ '^[0-9a-f]{64}$'),
 strategy_version text NOT NULL CHECK(length(strategy_version)>0),
 strategy_id text NOT NULL CHECK(length(strategy_id)>0),
 lane text NOT NULL CHECK(lane IN('PRECISION_LANE','COVERAGE_LANE')),
 provider text NOT NULL CHECK(length(provider)>0),
 rank integer NOT NULL CHECK(rank>=1),
 market_id text NOT NULL CHECK(length(market_id)>0),
 category_id text NOT NULL CHECK(length(category_id)>0),
 language text NOT NULL CHECK(length(language)>0),
 first_seen timestamptz NOT NULL,
 last_seen timestamptz NOT NULL,
 CHECK(last_seen>=first_seen),
 UNIQUE(research_candidate_id,query_fingerprint,provider)
);
CREATE FUNCTION leadgen.guard_research_hit_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Search hit provenance cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'rank'-'first_seen'-'last_seen') IS DISTINCT FROM (to_jsonb(OLD)-'rank'-'first_seen'-'last_seen')
 THEN RAISE EXCEPTION 'Search hit provenance dimensions are immutable'; END IF;
 IF NEW.first_seen>OLD.first_seen OR NEW.last_seen<OLD.last_seen OR NEW.rank>OLD.rank
 THEN RAISE EXCEPTION 'Search hit provenance observations must be monotonic'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER research_hit_provenance_immutable BEFORE UPDATE OR DELETE ON leadgen.research_search_hit_provenance
 FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_hit_provenance();
CREATE VIEW leadgen.search_discovery_corroboration AS
 WITH resolved AS (
 SELECT h.*,coalesce(v.company_id,h.company_id) resolved_company_id,
 CASE WHEN coalesce(v.company_id,h.company_id) IS NOT NULL THEN 'COMPANY:'||coalesce(v.company_id,h.company_id)::text
      WHEN c.candidate_type='OFFICIAL_SITE_CANDIDATE' THEN 'DOMAIN:'||h.root_domain
      ELSE 'HINT:'||c.normalized_url END identity_key
 FROM leadgen.research_search_hit_provenance h
 JOIN leadgen.research_candidates c ON c.id=h.research_candidate_id
 LEFT JOIN leadgen.research_candidate_verifications v ON v.research_candidate_id=c.id AND v.verification_status='VERIFIED_BUSINESS'
 )
 SELECT identity_key,resolved_company_id company_id,
 array_agg(DISTINCT root_domain ORDER BY root_domain) root_domains,
 count(DISTINCT query_fingerprint)::int distinct_query_count,
 count(DISTINCT strategy_id)::int distinct_strategy_count,
 count(DISTINCT lane)::int distinct_lane_count,
 count(DISTINCT provider)::int provider_count,
 min(first_seen) first_seen,max(last_seen) last_seen
 FROM resolved GROUP BY identity_key,resolved_company_id;
COMMIT;
