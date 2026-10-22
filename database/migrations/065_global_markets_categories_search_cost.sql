BEGIN;

-- 065: search cost control, global market registry and data-driven categories.
-- Additive only: no applied migration is rewritten and no history row is changed.

-- Search cost control -------------------------------------------------------
-- The estimate frozen with each new research batch (configured unit prices, not invoices).
CREATE TABLE leadgen.research_batch_cost_estimates (
  batch_id uuid PRIMARY KEY REFERENCES leadgen.research_batches(id) ON DELETE RESTRICT,
  estimated_queries integer NOT NULL CHECK(estimated_queries>=0),
  estimated_cost_usd numeric(12,4) CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd>=0),
  estimate jsonb NOT NULL CHECK(jsonb_typeof(estimate)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION leadgen.guard_research_batch_cost_estimate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Research batch cost estimates are append-only'; END; $$;
CREATE TRIGGER research_batch_cost_estimate_immutable BEFORE UPDATE OR DELETE ON leadgen.research_batch_cost_estimates
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_research_batch_cost_estimate();

-- Cross-run reuse lookup: same provider + query text, most recent completed execution first.
CREATE INDEX research_query_executions_reuse_idx
  ON leadgen.research_query_executions(provider,lower(request_snapshot->>'query'),provider_completed_at DESC)
  WHERE status IN('PERSISTED','NOT_FOUND') AND response_snapshot IS NOT NULL;
-- Month-to-date spend per provider.
CREATE INDEX provider_usage_events_billing_period_idx
  ON leadgen.provider_usage_events(billing_period,provider);

COMMIT;
