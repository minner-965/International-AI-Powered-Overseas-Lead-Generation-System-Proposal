BEGIN;

-- 075: low-cost model assist (optimization plan E1, Simon's decision 2026-10-27 item 4). Additive only.
-- Model assist is OFF by default. It follows docs/llm/LOW_COST_MODEL_EXECUTION_STANDARD.md
-- (llm-exec-standard-v1): the model only extracts quoted evidence; server rules keep every decision.
-- Every table here is append-only (no UPDATE, no DELETE):
--   llm_assist_settings      switch history (SIM master switch, merchant switches; latest row wins)
--   llm_merchant_allowances  administrator decision whether a merchant may use SIM's model key
--   llm_calls                one row per model request (tokens, cost, outcome) = cost ledger
--   llm_evidence             validated items (or the empty outcome) of each task run
--   llm_review_decisions     human decisions on 0.50-0.79 items (the review queue)
-- No key, password or other secret is stored in any of these tables.

CREATE TABLE IF NOT EXISTS leadgen.llm_assist_settings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope text NOT NULL CHECK(owner_scope IN ('SIM','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'SHADOW' CHECK(mode IN ('SHADOW','ASSIST')),
  tasks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(tasks)='object'),
  monthly_budget_usd numeric(10,2) CHECK(monthly_budget_usd IS NULL OR monthly_budget_usd>=0),
  set_by text NOT NULL CHECK(char_length(set_by) BETWEEN 1 AND 320),
  set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change_reason text CHECK(change_reason IS NULL OR char_length(change_reason)<=500),
  CONSTRAINT llm_assist_settings_owner_pair CHECK((owner_scope='SIM')=(merchant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS llm_assist_settings_latest_idx ON leadgen.llm_assist_settings(owner_scope,merchant_id,set_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS leadgen.llm_merchant_allowances(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES leadgen.merchants(id),
  sim_key_allowed boolean NOT NULL,
  set_by text NOT NULL CHECK(char_length(set_by) BETWEEN 1 AND 320),
  set_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS llm_merchant_allowances_latest_idx ON leadgen.llm_merchant_allowances(merchant_id,set_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS leadgen.llm_calls(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  owner_scope text NOT NULL CHECK(owner_scope IN ('SIM','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id),
  billed_to text NOT NULL CHECK(billed_to IN ('SIM','MERCHANT','LOCAL')),
  credential_source text NOT NULL CHECK(credential_source IN ('MERCHANT','SIM','ENV','NONE')),
  provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  model text NOT NULL CHECK(char_length(model) BETWEEN 1 AND 200),
  task text NOT NULL CHECK(task IN ('T1_CATEGORY_EVIDENCE','T2_BUYER_TYPE','T3_ATTRIBUTION','T4_RULE_CHECKLIST','T5_REPLY_INTENT','CONNECTION_TEST')),
  standard_version text NOT NULL CHECK(char_length(standard_version) BETWEEN 1 AND 80),
  prompt_version text NOT NULL CHECK(char_length(prompt_version) BETWEEN 1 AND 120),
  input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('OK','INVALID_OUTPUT','HTTP_ERROR','TIMEOUT','UNREACHABLE','REFUSED','CACHED')),
  error_code text CHECK(error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 0 AND 10),
  input_tokens integer CHECK(input_tokens IS NULL OR input_tokens>=0),
  output_tokens integer CHECK(output_tokens IS NULL OR output_tokens>=0),
  cost_amount numeric(14,8) CHECK(cost_amount IS NULL OR cost_amount>=0),
  cost_currency text CHECK(cost_currency IS NULL OR cost_currency IN ('USD','CNY')),
  latency_ms integer CHECK(latency_ms IS NULL OR latency_ms>=0),
  output jsonb,
  cached_from uuid REFERENCES leadgen.llm_calls(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT llm_calls_owner_pair CHECK((owner_scope='SIM')=(merchant_id IS NULL)),
  CONSTRAINT llm_calls_cost_pair CHECK((cost_amount IS NULL)=(cost_currency IS NULL))
);
CREATE INDEX IF NOT EXISTS llm_calls_month_idx ON leadgen.llm_calls(owner_scope,merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_reuse_idx ON leadgen.llm_calls(input_digest,prompt_version,provider,model,created_at DESC) WHERE status='OK';

CREATE TABLE IF NOT EXISTS leadgen.llm_evidence(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES leadgen.llm_calls(id),
  request_id uuid NOT NULL,
  owner_scope text NOT NULL CHECK(owner_scope IN ('SIM','MERCHANT')),
  merchant_id uuid REFERENCES leadgen.merchants(id),
  task text NOT NULL CHECK(task IN ('T1_CATEGORY_EVIDENCE','T2_BUYER_TYPE','T3_ATTRIBUTION','T4_RULE_CHECKLIST','T5_REPLY_INTENT')),
  mode text NOT NULL CHECK(mode IN ('SHADOW','ASSIST')),
  subject_type text NOT NULL CHECK(subject_type IN ('COMPANY_PAGE','COMPANY','EVIDENCE','REPLY')),
  company_id uuid,
  subject_ref text CHECK(subject_ref IS NULL OR char_length(subject_ref)<=500),
  provider text NOT NULL,
  model text NOT NULL,
  standard_version text NOT NULL,
  prompt_version text NOT NULL,
  extraction_version text NOT NULL CHECK(char_length(extraction_version) BETWEEN 1 AND 200),
  input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
  response_status text NOT NULL CHECK(response_status IN ('OK','INSUFFICIENT_EVIDENCE','REFUSED_OUT_OF_SCOPE','INVALID_OUTPUT')),
  item_index integer CHECK(item_index IS NULL OR item_index>=0),
  item jsonb,
  quote text CHECK(quote IS NULL OR char_length(quote)<=300),
  confidence numeric(3,2) CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status text NOT NULL CHECK(status IN ('ACCEPTED','REVIEW','DISCARDED','REJECTED','NO_ITEMS')),
  reject_reason text CHECK(reject_reason IS NULL OR reject_reason ~ '^[A-Z0-9_]{1,80}$'),
  notes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(notes)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT llm_evidence_owner_pair CHECK((owner_scope='SIM')=(merchant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS llm_evidence_review_idx ON leadgen.llm_evidence(owner_scope,merchant_id,created_at DESC) WHERE status='REVIEW';
CREATE INDEX IF NOT EXISTS llm_evidence_company_idx ON leadgen.llm_evidence(company_id,task,created_at DESC);
CREATE INDEX IF NOT EXISTS llm_evidence_call_idx ON leadgen.llm_evidence(call_id);

CREATE TABLE IF NOT EXISTS leadgen.llm_review_decisions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES leadgen.llm_evidence(id),
  decision text NOT NULL CHECK(decision IN ('CONFIRMED','REJECTED')),
  note text CHECK(note IS NULL OR char_length(note)<=1000),
  decided_by text NOT NULL CHECK(char_length(decided_by) BETWEEN 1 AND 320),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS llm_review_decisions_evidence_idx ON leadgen.llm_review_decisions(evidence_id,decided_at DESC);

CREATE OR REPLACE FUNCTION leadgen.guard_llm_assist_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LLM_ASSIST_APPEND_ONLY: % history cannot be changed or deleted',TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS llm_assist_settings_history_guard ON leadgen.llm_assist_settings;
CREATE TRIGGER llm_assist_settings_history_guard BEFORE UPDATE OR DELETE ON leadgen.llm_assist_settings
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_llm_assist_history();
DROP TRIGGER IF EXISTS llm_merchant_allowances_history_guard ON leadgen.llm_merchant_allowances;
CREATE TRIGGER llm_merchant_allowances_history_guard BEFORE UPDATE OR DELETE ON leadgen.llm_merchant_allowances
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_llm_assist_history();
DROP TRIGGER IF EXISTS llm_calls_history_guard ON leadgen.llm_calls;
CREATE TRIGGER llm_calls_history_guard BEFORE UPDATE OR DELETE ON leadgen.llm_calls
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_llm_assist_history();
DROP TRIGGER IF EXISTS llm_evidence_history_guard ON leadgen.llm_evidence;
CREATE TRIGGER llm_evidence_history_guard BEFORE UPDATE OR DELETE ON leadgen.llm_evidence
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_llm_assist_history();
DROP TRIGGER IF EXISTS llm_review_decisions_history_guard ON leadgen.llm_review_decisions;
CREATE TRIGGER llm_review_decisions_history_guard BEFORE UPDATE OR DELETE ON leadgen.llm_review_decisions
  FOR EACH ROW EXECUTE FUNCTION leadgen.guard_llm_assist_history();

-- Fail-closed initial state: model assist off, record-only mode, every task toggle off.
INSERT INTO leadgen.llm_assist_settings(owner_scope,merchant_id,enabled,mode,tasks,monthly_budget_usd,set_by,change_reason)
SELECT 'SIM',NULL,false,'SHADOW',
  '{"T1_CATEGORY_EVIDENCE":false,"T2_BUYER_TYPE":false,"T3_ATTRIBUTION":false,"T4_RULE_CHECKLIST":false,"T5_REPLY_INTENT":false}'::jsonb,
  20,'migration-075','fail-closed initial state: model assist off by default'
WHERE NOT EXISTS (SELECT 1 FROM leadgen.llm_assist_settings WHERE owner_scope='SIM');

COMMIT;
