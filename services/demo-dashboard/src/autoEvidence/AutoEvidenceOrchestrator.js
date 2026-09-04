import { createHash } from 'node:crypto';
import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';
import { buildStrategyQuery,eligibleStrategies,selectNextUnusedStrategy,strategyNextStage,strategyStartStage } from './strategyCatalog.js';
import { resolveTargetCategoryContext } from '../categoryProcurement/targetCategoryContext.js';

const PRODUCT_PROFILES = new Set(['WOMENSWEAR', 'GENERAL_MERCHANDISE']);
const SCHEDULE_SOURCES = new Set(['EVENT', 'RECONCILIATION', 'MANUAL_RETRY', 'IMPORT']);
const TERMINAL_TASK_STATES = new Set([
  'EVIDENCE_EXHAUSTED', 'HUMAN_REVIEW_REQUIRED', 'BUDGET_PAUSED', 'PROVIDER_CAPACITY_WAIT', 'COMPLETED', 'CANCELLED'
]);
const SETTLED_OUTCOMES = new Set([
  'COMPLETED', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'EVIDENCE_EXHAUSTED',
  'BUDGET_PAUSED', 'PROVIDER_CAPACITY_WAIT', 'HUMAN_REVIEW_REQUIRED', 'NEW_EVIDENCE_FOUND', 'NO_NEW_EVIDENCE', 'TEMPORARY_ERROR'
]);

export const AUTO_EVIDENCE_STAGES = Object.freeze([
  'DISCOVERING_SOURCES',
  'CRAWLING',
  'EXTRACTING',
  'NORMALIZING_CATEGORY',
  'VALIDATING_EVIDENCE',
  'FINDING_BUYER',
  'VERIFYING_EMAIL',
  'REFRESHING_DECISION'
]);

export const AUTO_EVIDENCE_QUEUE_STAGE = Object.freeze({
  [PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE]: 'DISCOVERING_SOURCES',
  [PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY]: 'NORMALIZING_CATEGORY',
  [PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH]: 'VALIDATING_EVIDENCE',
  [PHASE5_QUEUES.FIND_PROFILE_BUYER]: 'FINDING_BUYER',
  [PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL]: 'VERIFYING_EMAIL',
  [PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3]: 'REFRESHING_DECISION'
});

const STAGE_QUEUE = Object.freeze(Object.fromEntries(
  Object.entries(AUTO_EVIDENCE_QUEUE_STAGE).map(([queue, stage]) => [stage, queue])
));

const STAGE_EXECUTOR = Object.freeze({
  DISCOVERING_SOURCES: 'discover_opportunity_evidence',
  NORMALIZING_CATEGORY: 'normalize_opportunity_category',
  VALIDATING_EVIDENCE: 'refresh_category_scope_match',
  FINDING_BUYER: 'find_profile_buyer',
  VERIFYING_EMAIL: 'verify_profile_buyer_email',
  REFRESHING_DECISION: 'refresh_business_opportunity_v3'
});

const STAGE_NEXT = Object.freeze({
  DISCOVERING_SOURCES: 'NORMALIZING_CATEGORY',
  NORMALIZING_CATEGORY: 'VALIDATING_EVIDENCE',
  VALIDATING_EVIDENCE: 'FINDING_BUYER',
  FINDING_BUYER: 'VERIFYING_EMAIL',
  VERIFYING_EMAIL: 'REFRESHING_DECISION',
  REFRESHING_DECISION: null
});

const STAGE_RESEARCH_KIND = Object.freeze({
  DISCOVERING_SOURCES: 'CATEGORY',
  NORMALIZING_CATEGORY: 'CATEGORY',
  VALIDATING_EVIDENCE: 'CATEGORY',
  FINDING_BUYER: 'CONTACT',
  VERIFYING_EMAIL: 'CONTACT',
  REFRESHING_DECISION: 'CONTACT'
});

const REFERENCE_COLUMNS = Object.freeze([
  'provider_usage_event_id', 'prospect_category_source_id', 'prospect_category_observation_id',
  'buyer_business_model_result_id', 'category_procurement_match_result_id',
  'product_opportunity_result_id', 'cooperation_feasibility_result_id', 'decision_maker_id',
  'decision_maker_contact_id', 'contact_verification_event_id',
  'business_opportunity_decision_snapshot_id'
]);

export async function findCanonicalCheckpointContinuation(client, task) {
  const checkpointReplayCount=Number(task?.checkpoint_replay_count||0);
  const currentStage=String(task?.current_stage||'').trim();
  if(!task?.id||checkpointReplayCount<1||!currentStage)return null;
  const result=await client.query(`SELECT continuation.*
    FROM leadgen.auto_evidence_resume_outbox outbox
    JOIN leadgen.research_jobs continuation ON continuation.id=outbox.continuation_research_job_id
      AND continuation.resumed_from_research_job_id=outbox.original_research_job_id
      AND continuation.resume_execution_key=outbox.execution_key
    WHERE outbox.task_id=$1 AND outbox.checkpoint_replay_count=$2 AND outbox.resume_stage=$3
    ORDER BY outbox.created_at DESC,outbox.id DESC LIMIT 1`,[
    task.id,checkpointReplayCount,currentStage
  ]);
  return result.rows[0]||null;
}

const upper = value => String(value ?? '').trim().toUpperCase();

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function configurationError(key) {
  return Object.assign(new Error(`Invalid configuration: ${key}`), {
    code: 'INVALID_CONFIGURATION',
    configKey: key
  });
}

function strictBooleanEnv(env, key, fallback) {
  const value = env[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  throw configurationError(key);
}

function strictIntEnv(env, key, { min, max = Number.MAX_SAFE_INTEGER, fallback }) {
  const value = env[key];
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw configurationError(key);
  return parsed;
}

function boundedInt(value, { min = 0, max = 100, fallback = 0 } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function cleanCode(value, fallback = 'EVIDENCE_REQUIRED') {
  const normalized = upper(value).replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return normalized && /^[A-Z]/.test(normalized) ? normalized : fallback;
}

function safeTechnicalBlocker(error) {
  const code = cleanCode(error?.code || 'AUTO_EVIDENCE_STAGE_FAILED', 'AUTO_EVIDENCE_STAGE_FAILED');
  return code.slice(0, 100);
}

function retryableError(error) {
  if (error?.retryable === true) return true;
  const code = upper(error?.code || error?.message);
  return /(TIMEOUT|TEMPORARY|NETWORK|FETCH|RATE_LIMIT|429|5\d\d|ECONN|ENOTFOUND|EAI_AGAIN)/.test(code);
}

function referenceValues(result = {}) {
  return Object.fromEntries(REFERENCE_COLUMNS.map(column => [column, result[column] || null]));
}

export function autoEvidenceConfig(env = process.env) {
  const tavilyUsagePolicy=upper(env.TAVILY_USAGE_POLICY||'PROVIDER_ACCOUNT_ONLY');
  if(tavilyUsagePolicy!=='PROVIDER_ACCOUNT_ONLY')throw configurationError('TAVILY_USAGE_POLICY');
  return Object.freeze({
    enabled: strictBooleanEnv(env, 'AUTO_EVIDENCE_ENABLED', false),
    reconcileMinutes: strictIntEnv(env, 'AUTO_EVIDENCE_RECONCILE_MINUTES', { min: 5, max: 1440, fallback: 30 }),
    batchSize: boundedInt(env.AUTO_EVIDENCE_BATCH_SIZE, { min: 1, max: 100, fallback: 10 }),
    sourceTtlDays: boundedInt(env.AUTO_EVIDENCE_SOURCE_TTL_DAYS, { min: 1, max: 3650, fallback: 90 }),
    stageLeaseMinutes: boundedInt(env.AUTO_EVIDENCE_STAGE_LEASE_MINUTES, { min: 1, max: 1440, fallback: 15 }),
    retryBaseSeconds: boundedInt(env.AUTO_EVIDENCE_RETRY_BASE_SECONDS, { min: 5, max: 86400, fallback: 300 }),
    runBudgetCapUnits: boundedInt(env.MAX_HUNTER_CREDITS_PER_RUN_UNITS, { min: 0, max: 1000000000, fallback: 20000 }),
    hunterEnabled: booleanEnv(env.AUTO_EVIDENCE_HUNTER_ENABLED, true),
    tavilyEnabled: booleanEnv(env.AUTO_EVIDENCE_TAVILY_ENABLED, true),
    tavilyUsagePolicy,
    operatorOverrideEnabled: booleanEnv(env.AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED, false),
  });
}

export class AutoEvidenceRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new TypeError('AutoEvidenceRepository requires a PostgreSQL pool');
    this.pool = pool;
  }

  async selectCandidates({ limit, marketCodes = [], productProfiles = [], companyIds = [], sourceTtlDays = 90 } = {}) {
    const markets = [...new Set(marketCodes.map(upper).filter(value => ['AE', 'MX'].includes(value)))];
    const profiles = [...new Set(productProfiles.map(upper).filter(value => PRODUCT_PROFILES.has(value)))];
    const companies=[...new Set(companyIds.map(value=>String(value||'').trim())
      .filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
    const result = await this.pool.query(`WITH candidates AS (
      SELECT o.company_id,o.product_profile,c.country_code,('PROFILE:'||o.product_profile) target_category_scope_key,
        o.product_profile target_category_code,
        CASE
          WHEN cpm.match_status NOT IN ('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE')
            OR cpm.scope_revision_id IS NULL OR cpm.match_basis NOT IN('EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE') THEN 'CATEGORY_EVIDENCE'
          WHEN coalesce(dm.named_relevant_buyers,0)=0 AND coalesce(dm.company_contact_routes,0)=0 THEN 'NAMED_BUYER_EVIDENCE'
          WHEN coalesce(dm.company_contact_routes,0)=0 THEN 'VERIFIED_EMAIL_EVIDENCE'
          ELSE 'DECISION_REFRESH'
        END business_blocker,
        (coalesce(src.source_count,0)+coalesce(dm.evidence_count,0))::int evidence_revision,
        CASE
          WHEN cpm.match_status IN('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE') AND coalesce(dm.named_relevant_buyers,0)=0
            AND coalesce(dm.company_contact_routes,0)=0 THEN 1
          WHEN coalesce(dm.company_contact_routes,0)=0 THEN 2
          WHEN cpm.match_status NOT IN ('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE') THEN 3
          ELSE 4
        END priority
      FROM leadgen.business_opportunity_current o
      JOIN leadgen.companies c ON c.id=o.company_id
      LEFT JOIN leadgen.buyer_business_model_results bbm ON bbm.id=o.buyer_business_model_result_id
      LEFT JOIN leadgen.category_procurement_match_results cpm ON cpm.id=o.category_procurement_match_result_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT d.id) FILTER (
            WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND d.lifecycle_status='ACTIVE'
              AND pr.relevance IN ('HIGH','MEDIUM'))::int named_relevant_buyers,
          count(DISTINCT dc.id) FILTER (
            WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND d.lifecycle_status='ACTIVE'
              AND pr.relevance IN ('HIGH','MEDIUM') AND dc.verification_status='VALID')::int valid_email_routes,
          count(DISTINCT dc.id) FILTER (WHERE d.lifecycle_status='ACTIVE' AND dc.source_url IS NOT NULL
            AND dc.last_verified_at>=now()-($4::int*interval '1 day')
            AND ((dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
                  AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED'))
              OR (dc.contact_type='BUSINESS_PHONE' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','FORMAT_VALID'))
              OR (dc.contact_type='BUSINESS_WHATSAPP' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','BUSINESS_WHATSAPP_OBSERVED'))
              OR (dc.contact_type='CONTACT_FORM' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED')
                AND dc.contact_value_normalized~*'/(contact([-_]?us)?|support|enquiry|inquiry)(/|[?#]|$)')))::int company_contact_routes,
          (count(DISTINCT d.id)+count(DISTINCT dc.id)+count(DISTINCT cv.id))::int evidence_count
        FROM leadgen.decision_makers d
        LEFT JOIN leadgen.decision_maker_product_relevance pr
          ON pr.decision_maker_id=d.id AND pr.product_profile=o.product_profile
        LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=d.id
        LEFT JOIN leadgen.contact_verification_events cv ON cv.decision_maker_contact_id=dc.id
        WHERE d.company_id=o.company_id
      ) dm ON true
      LEFT JOIN LATERAL (
        SELECT (count(DISTINCT s.id)+count(DISTINCT obs.id))::int source_count
        FROM leadgen.prospect_category_sources s
        LEFT JOIN leadgen.prospect_category_observations obs
          ON obs.source_id=s.id AND obs.normalized_profile=o.product_profile
        WHERE s.company_id=o.company_id
          AND s.captured_at>=now()-($4::int*interval '1 day')
      ) src ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int snapshot_count
        FROM leadgen.business_opportunity_decision_snapshots ds
        WHERE ds.company_id=o.company_id AND ds.product_profile=o.product_profile
      ) decision_count ON true
      WHERE c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND c.explicit_exclusion_reason IS NULL
        AND o.relationship_status='NEW_PROSPECT'
        AND o.display_opportunity_status='EVIDENCE_REQUIRED'
        AND ($2::text[]='{}' OR c.country_code=ANY($2::text[]))
        AND ($3::text[]='{}' OR o.product_profile=ANY($3::text[]))
        AND ($5::uuid[]='{}' OR o.company_id=ANY($5::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM leadgen.historical_customer_company_links l
          JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
          WHERE l.company_id=c.id AND l.link_status='CONFIRMED'
            AND h.customer_role='INTERNAL_EXISTING_CUSTOMER')
        AND NOT EXISTS (
          SELECT 1 FROM leadgen.auto_evidence_tasks prior
          WHERE prior.company_id=o.company_id
            AND prior.target_category_scope_key=('PROFILE:'||o.product_profile)
            AND prior.business_blocker=(CASE
              WHEN cpm.match_status NOT IN ('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE')
                OR cpm.scope_revision_id IS NULL OR cpm.match_basis NOT IN('EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE') THEN 'CATEGORY_EVIDENCE'
              WHEN coalesce(dm.named_relevant_buyers,0)=0 AND coalesce(dm.company_contact_routes,0)=0 THEN 'NAMED_BUYER_EVIDENCE'
              WHEN coalesce(dm.company_contact_routes,0)=0 THEN 'VERIFIED_EMAIL_EVIDENCE'
              ELSE 'DECISION_REFRESH' END)
            AND (
              prior.task_status IN ('QUEUED','RUNNING','IN_PROGRESS','RETRY_SCHEDULED')
              OR prior.task_status IN ('HUMAN_REVIEW_REQUIRED','BUDGET_PAUSED','PROVIDER_CAPACITY_WAIT')
              OR (
                prior.task_status IN ('EVIDENCE_EXHAUSTED','COMPLETED','CANCELLED')
                AND NOT EXISTS (SELECT 1 FROM leadgen.prospect_category_sources fresh
                  JOIN leadgen.research_jobs source_job ON source_job.id=fresh.research_job_id
                  WHERE fresh.company_id=o.company_id AND source_job.product_profile=o.product_profile
                    AND fresh.captured_at>coalesce(prior.completed_at,prior.updated_at))
                AND NOT EXISTS (SELECT 1 FROM leadgen.prospect_category_observations fresh
                  WHERE fresh.company_id=o.company_id AND fresh.normalized_profile=o.product_profile
                    AND fresh.captured_at>coalesce(prior.completed_at,prior.updated_at))
                AND (prior.business_blocker='CATEGORY_EVIDENCE' OR (
                  NOT EXISTS (SELECT 1 FROM leadgen.decision_makers fresh
                    WHERE fresh.company_id=o.company_id AND fresh.updated_at>coalesce(prior.completed_at,prior.updated_at))
                  AND NOT EXISTS (SELECT 1 FROM leadgen.decision_maker_contacts fresh
                    JOIN leadgen.decision_makers owner ON owner.id=fresh.decision_maker_id
                    WHERE owner.company_id=o.company_id AND fresh.updated_at>coalesce(prior.completed_at,prior.updated_at))
                ))
              )
            )
        )
    )
    SELECT candidates.* FROM candidates
    LEFT JOIN LATERAL (
      SELECT last_strategy_started_at FROM leadgen.auto_evidence_tasks t
      WHERE t.company_id=candidates.company_id
        AND t.target_category_scope_key=candidates.target_category_scope_key
      ORDER BY t.created_at DESC,t.id DESC LIMIT 1
    ) fairness ON true
    ORDER BY priority,fairness.last_strategy_started_at NULLS FIRST,company_id,target_category_code LIMIT $1`, [
      limit, markets, profiles, boundedInt(sourceTtlDays,{min:1,max:3650,fallback:90}),companies
    ]);
    return result.rows;
  }

  async selectDueFairnessRetries({ limit, marketCodes = [], productProfiles = [], companyIds = [] } = {}) {
    const markets = [...new Set(marketCodes.map(upper).filter(value => ['AE', 'MX'].includes(value)))];
    const profiles = [...new Set(productProfiles.map(upper).filter(value => PRODUCT_PROFILES.has(value)))];
    const companies=[...new Set(companyIds.map(value=>String(value||'').trim())
      .filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
    const result=await this.pool.query(`SELECT t.*,c.company_name,c.country_code,c.official_root_domain,c.normalized_domain
      FROM leadgen.auto_evidence_tasks t
      JOIN leadgen.companies c ON c.id=t.company_id
      WHERE t.task_status='RETRY_SCHEDULED' AND t.retry_at<=now()
        AND t.current_stage IS NULL AND t.current_strategy_code IS NULL
        AND t.strategy_state IN ('READY','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE')
        AND ($2::text[]='{}' OR c.country_code=ANY($2::text[]))
        AND ($3::text[]='{}' OR t.product_profile IS NULL OR t.product_profile=ANY($3::text[]))
        AND ($4::uuid[]='{}' OR t.company_id=ANY($4::uuid[]))
      ORDER BY t.retry_at,t.last_strategy_started_at NULLS FIRST,t.created_at,t.id
      LIMIT $1`,[limit,markets,profiles,companies]);
    return result.rows;
  }

  async selectStaleRunningTasks({ limit, marketCodes = [], productProfiles = [], companyIds = [], leaseMinutes = 15 } = {}) {
    const markets = [...new Set(marketCodes.map(upper).filter(value => ['AE', 'MX'].includes(value)))];
    const profiles = [...new Set(productProfiles.map(upper).filter(value => PRODUCT_PROFILES.has(value)))];
    const companies=[...new Set(companyIds.map(value=>String(value||'').trim())
      .filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
    const lease=Math.max(1,Math.min(1440,Number(leaseMinutes)||15));
    const result=await this.pool.query(`SELECT t.*,c.company_name,c.country_code,c.official_root_domain,c.normalized_domain
      FROM leadgen.auto_evidence_tasks t
      JOIN leadgen.companies c ON c.id=t.company_id
      WHERE t.task_status='RUNNING' AND t.current_stage IS NOT NULL AND t.current_strategy_code IS NOT NULL
        AND t.updated_at<now()-($5::int*interval '1 minute')
        AND ($2::text[]='{}' OR c.country_code=ANY($2::text[]))
        AND ($3::text[]='{}' OR t.product_profile IS NULL OR t.product_profile=ANY($3::text[]))
        AND ($4::uuid[]='{}' OR t.company_id=ANY($4::uuid[]))
      ORDER BY t.updated_at,t.created_at,t.id LIMIT $1`,[limit,markets,profiles,companies,lease]);
    return result.rows;
  }

  async reconcileStaleResearchJobProjections({limit=25,leaseMinutes=15}={}){
    const boundedLimit=Math.max(1,Math.min(100,Number(limit)||25));
    const lease=Math.max(1,Math.min(1440,Number(leaseMinutes)||15));
    const result=await this.pool.query(`WITH candidates AS (
      SELECT j.id,t.task_status
      FROM leadgen.research_jobs j
      LEFT JOIN LATERAL (
        SELECT task.task_status,task.id
        FROM leadgen.auto_evidence_tasks task
        LEFT JOIN leadgen.auto_evidence_task_attempts attempt ON attempt.task_id=task.id
        WHERE task.category_research_job_id=j.id OR task.contact_research_job_id=j.id OR attempt.research_job_id=j.id
        ORDER BY task.updated_at DESC,task.id DESC LIMIT 1
      ) t ON true
      WHERE j.job_type IN('CATEGORY_PROCUREMENT_ENRICHMENT','DECISION_MAKER_ENRICHMENT')
        AND j.created_by_identity='phase10-auto-evidence'
        AND j.status IN('QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING')
        AND (t.task_status IN('COMPLETED','CANCELLED','EVIDENCE_EXHAUSTED','HUMAN_REVIEW_REQUIRED')
          OR coalesce(j.started_at,j.created_at)<now()-($1::int*interval '1 minute'))
        AND NOT EXISTS (
          SELECT 1 FROM pgboss.job queue_job
          WHERE queue_job.state::text IN('created','retry','active')
            AND (queue_job.data->>'research_job_id'=j.id::text
              OR (t.id IS NOT NULL AND queue_job.data->>'task_id'=t.id::text))
        )
        AND (
          t.task_status IN('COMPLETED','CANCELLED','EVIDENCE_EXHAUSTED','HUMAN_REVIEW_REQUIRED')
          OR (t.id IS NULL AND j.last_error IS NOT NULL
            AND (j.category_sources_found>0 OR j.category_observations_found>0 OR j.category_procurement_errors>0))
        )
      ORDER BY coalesce(j.started_at,j.created_at),j.id
      FOR UPDATE OF j SKIP LOCKED LIMIT $2
    )
    UPDATE leadgen.research_jobs j SET
      status=CASE WHEN candidates.task_status='HUMAN_REVIEW_REQUIRED' THEN 'PARTIAL' ELSE 'COMPLETED' END,
      started_at=coalesce(j.started_at,j.created_at),completed_at=coalesce(j.completed_at,now()),
      dispatch_state='DISPATCHED',blocked_reason=NULL,next_dispatch_attempt_at=NULL,
      stop_reason_code=CASE candidates.task_status
        WHEN 'EVIDENCE_EXHAUSTED' THEN 'EVIDENCE_EXHAUSTED'
        WHEN 'CANCELLED' THEN 'DUPLICATE_TASK_PROJECTION_RECONCILED'
        ELSE 'STALE_JOB_PROJECTION_RECONCILED' END,
      last_error=coalesce(j.last_error,'Terminal task state reconciled into ResearchJob projection')
    FROM candidates WHERE j.id=candidates.id
    RETURNING j.id,j.status,j.stop_reason_code`,[lease,boundedLimit]);
    return result.rows;
  }

  async selectProviderCapacityWaits({ limit, marketCodes = [], productProfiles = [], companyIds = [] } = {}) {
    const markets = [...new Set(marketCodes.map(upper).filter(value => ['AE', 'MX'].includes(value)))];
    const profiles = [...new Set(productProfiles.map(upper).filter(value => PRODUCT_PROFILES.has(value)))];
    const companies=[...new Set(companyIds.map(value=>String(value||'').trim())
      .filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
    const result=await this.pool.query(`SELECT t.*,c.company_name,c.country_code,c.official_root_domain,c.normalized_domain
      FROM leadgen.auto_evidence_tasks t
      JOIN leadgen.companies c ON c.id=t.company_id
      WHERE t.task_status='PROVIDER_CAPACITY_WAIT'
        AND t.current_stage IS NOT NULL AND t.current_strategy_code IS NOT NULL
        AND ($2::text[]='{}' OR c.country_code=ANY($2::text[]))
        AND ($3::text[]='{}' OR t.product_profile IS NULL OR t.product_profile=ANY($3::text[]))
        AND ($4::uuid[]='{}' OR t.company_id=ANY($4::uuid[]))
      ORDER BY t.updated_at,t.created_at,t.id LIMIT $1`,[limit,markets,profiles,companies]);
    return result.rows;
  }

  async resolveResearchJobCompanyIds(researchJobId) {
    const id=String(researchJobId||'').trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return[];
    const result=await this.pool.query(`SELECT DISTINCT company_id FROM (
      SELECT unnest(coalesce(requested_company_ids,'{}'::uuid[])) company_id
      FROM leadgen.research_jobs WHERE id=$1
      UNION ALL
      SELECT company_id FROM leadgen.research_job_cohort_items WHERE research_job_id=$1
      UNION ALL
      SELECT company_id FROM leadgen.enrichment_job_companies WHERE research_job_id=$1
      UNION ALL
      SELECT id company_id FROM leadgen.companies WHERE research_job_id=$1
      UNION ALL
      SELECT company_id FROM leadgen.research_candidate_verifications
      WHERE research_job_id=$1 AND company_id IS NOT NULL
    ) affected WHERE company_id IS NOT NULL ORDER BY company_id`,[id]);
    return result.rows.map(row=>row.company_id);
  }

  async resolveImportCompanyIds(importId) {
    const id=String(importId||'').trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return[];
    const result=await this.pool.query(`SELECT DISTINCT company_id FROM (
      SELECT canonical_entity_id company_id
      FROM leadgen.reference_data_import_rows
      WHERE import_id=$1 AND canonical_entity_type='COMPANY' AND canonical_entity_id IS NOT NULL
      UNION ALL
      SELECT value::uuid company_id
      FROM leadgen.data_import_effect_outbox e
      CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(e.payload->'company_ids','[]'::jsonb)) value
      WHERE e.import_id=$1
        AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      UNION ALL
      SELECT l.company_id
      FROM leadgen.historical_customers h
      JOIN leadgen.historical_customer_company_links l ON l.historical_customer_id=h.id
      WHERE h.source_import_id=$1 AND l.link_status='CONFIRMED'
    ) affected WHERE company_id IS NOT NULL ORDER BY company_id`,[id]);
    return result.rows.map(row=>row.company_id);
  }

  async resolveCategoryScopeRevisionCompanyIds(revisionId) {
    const id=String(revisionId||'').trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return[];
    const result=await this.pool.query(`SELECT DISTINCT o.company_id
      FROM leadgen.business_opportunity_current o
      JOIN (
        SELECT DISTINCT product_profile FROM leadgen.dpv_product_category_scopes
        WHERE scope_revision_id=$1 AND scope_status='ACTIVE'
      ) scope ON scope.product_profile=o.product_profile
      ORDER BY o.company_id`,[id]);
    return result.rows.map(row=>row.company_id);
  }

  async resolveEventCompanyIds(input={}) {
    const valid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value||'').trim());
    const companyIds=new Set([
      ...(Array.isArray(input.company_ids)?input.company_ids:[]),
      ...(input.company_id?[input.company_id]:[])
    ].map(value=>String(value||'').trim()).filter(valid));
    const resolved=await Promise.all([
      input.research_job_id?this.resolveResearchJobCompanyIds(input.research_job_id):[],
      input.import_id?this.resolveImportCompanyIds(input.import_id):[],
      input.category_scope_revision_id?this.resolveCategoryScopeRevisionCompanyIds(input.category_scope_revision_id):[]
    ]);
    for(const id of resolved.flat())if(valid(id))companyIds.add(String(id));
    return [...companyIds].sort();
  }

  async schedule(candidate, { source, scheduleKey, inputDigest,
    operatorIdentity = null, operatorRole = null, approvalReference = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const categoryInput=candidate.target_category_scope_key?{
        ...candidate,target_category:undefined,product_category:undefined,
        current_target_category:candidate.target_category_code||candidate.target_category
      }:candidate;
      const categoryContext=resolveTargetCategoryContext(categoryInput);
      const executionKey = `auto-evidence:v2:${digest({
        company_id: candidate.company_id,
        target_category_scope_key: categoryContext.targetCategoryScopeKey,
        business_blocker: candidate.business_blocker,
        evidence_revision: candidate.evidence_revision
      })}`;
      const inserted = await client.query(`INSERT INTO leadgen.auto_evidence_tasks
        (company_id,target_category_scope_key,target_category_code,product_profile,business_blocker,evidence_revision,execution_key,task_status,
         automation_owner,max_attempts,budget_state,last_evidence_revision,input_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'QUEUED','SYSTEM',$8,'AVAILABLE',$6,$9)
        ON CONFLICT (company_id,target_category_scope_key,business_blocker,evidence_revision) DO NOTHING RETURNING *`, [
        candidate.company_id,categoryContext.targetCategoryScopeKey,categoryContext.targetCategoryCode,
        categoryContext.productProfile,candidate.business_blocker,candidate.evidence_revision,executionKey,
        Math.max(1,eligibleStrategies({...candidate,target_category_code:categoryContext.targetCategoryCode,
          product_profile:categoryContext.productProfile}).length),inputDigest
      ]);
      const task = inserted.rows[0] || (await client.query(`SELECT * FROM leadgen.auto_evidence_tasks
        WHERE company_id=$1 AND target_category_scope_key=$2 AND business_blocker=$3 AND evidence_revision=$4`, [
        candidate.company_id, categoryContext.targetCategoryScopeKey, candidate.business_blocker, candidate.evidence_revision
      ])).rows[0];
      let outcome = inserted.rowCount ? 'SCHEDULED' : 'DEDUPLICATED';
      if (task?.task_status === 'PROVIDER_CAPACITY_WAIT') outcome = 'PROVIDER_CAPACITY_WAIT';
      else if (task?.task_status === 'HUMAN_REVIEW_REQUIRED') outcome = 'HUMAN_REVIEW_REQUIRED';
      const event = await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
        (schedule_source,schedule_key,task_id,company_id,target_category_scope_key,target_category_code,product_profile,business_blocker,evidence_revision,
         outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
        ON CONFLICT (schedule_key) DO NOTHING RETURNING id`, [source, scheduleKey, task?.id || null,
        candidate.company_id,categoryContext.targetCategoryScopeKey,categoryContext.targetCategoryCode,
        categoryContext.productProfile,candidate.business_blocker,candidate.evidence_revision,outcome,inputDigest,
        operatorIdentity,operatorRole,approvalReference]);
      await client.query('COMMIT');
      return {
        task,
        outcome,
        replay: !event.rowCount,
        dispatch_required: outcome === 'SCHEDULED'
          || (outcome === 'DEDUPLICATED' && ['QUEUED','RETRY_SCHEDULED'].includes(task?.task_status))
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(taskId) {
    const result = await this.pool.query(`SELECT t.*,c.company_name,c.country_code,c.official_root_domain,c.normalized_domain,
      coalesce(dm.named_buyer_candidate_count,0)::int named_buyer_candidate_count,
      coalesce(dm.named_relevant_buyer_count,0)::int named_relevant_buyer_count,
      coalesce(dm.valid_contact_count,0)::int valid_contact_count,dm.candidate_buyer_name
      FROM leadgen.auto_evidence_tasks t JOIN leadgen.companies c ON c.id=t.company_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE') named_buyer_candidate_count,
          count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE'
            AND d.verification_status='VERIFIED'
            AND (t.product_profile IS NULL OR pr.relevance IN ('HIGH','MEDIUM'))) named_relevant_buyer_count,
          count(DISTINCT dc.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE'
            AND d.verification_status='VERIFIED'
            AND (t.product_profile IS NULL OR pr.relevance IN ('HIGH','MEDIUM'))
            AND dc.verification_status='VALID') valid_contact_count,
          max(d.person_name) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE') candidate_buyer_name
        FROM leadgen.decision_makers d
        LEFT JOIN leadgen.decision_maker_product_relevance pr
          ON pr.decision_maker_id=d.id AND pr.product_profile=t.product_profile
        LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=d.id
        WHERE d.company_id=t.company_id
      ) dm ON true WHERE t.id=$1`, [taskId]);
    return result.rows[0] || null;
  }

  async blockerState(taskId) {
    const result=await this.pool.query(`SELECT t.id,t.business_blocker,o.display_opportunity_status,
      bbm.buyer_model,cpm.match_status,
      coalesce(dm.candidates,0)::int named_buyer_candidate_count,
      coalesce(dm.relevant,0)::int named_relevant_buyer_count,
      coalesce(dm.valid_contacts,0)::int valid_contact_count,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=t.company_id AND s.lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=t.company_id AND s.lifted_at IS NULL) suppressed,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
        JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
        WHERE l.company_id=t.company_id AND l.link_status='CONFIRMED'
          AND h.customer_role='INTERNAL_EXISTING_CUSTOMER') historical_customer
      FROM leadgen.auto_evidence_tasks t
      JOIN leadgen.companies c ON c.id=t.company_id
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=t.company_id AND o.product_profile=t.product_profile
      LEFT JOIN leadgen.buyer_business_model_results bbm ON bbm.id=o.buyer_business_model_result_id
      LEFT JOIN leadgen.category_procurement_match_results cpm ON cpm.id=o.category_procurement_match_result_id
      LEFT JOIN LATERAL (SELECT
        count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE') candidates,
        count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE'
          AND d.verification_status='VERIFIED'
          AND (t.product_profile IS NULL OR pr.relevance IN ('HIGH','MEDIUM'))) relevant,
        count(DISTINCT dc.id) FILTER (WHERE d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE'
          AND d.verification_status='VERIFIED'
          AND (t.product_profile IS NULL OR pr.relevance IN ('HIGH','MEDIUM'))
          AND dc.verification_status='VALID') valid_contacts
        FROM leadgen.decision_makers d
        LEFT JOIN leadgen.decision_maker_product_relevance pr
          ON pr.decision_maker_id=d.id AND pr.product_profile=t.product_profile
        LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=d.id
        WHERE d.company_id=t.company_id) dm ON true
      WHERE t.id=$1`,[taskId]);
    const row=result.rows[0];
    if(!row)return {hard_stop:true,reason:'TASK_NOT_FOUND'};
    if(row.suppressed)return {...row,hard_stop:true,reason:'SUPPRESSED'};
    if(row.historical_customer)return {...row,hard_stop:true,reason:'HISTORICAL_CUSTOMER'};
    const blocker=upper(row.business_blocker);
    const resolved=blocker==='CATEGORY_EVIDENCE'?['CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'].includes(row.match_status)
      :['BUYER_MODEL_EVIDENCE','SUPPLIER_ACCESS_REQUIRED','PROCUREMENT_EVIDENCE_REQUIRED','BUYING_EVIDENCE_REQUIRED'].includes(blocker)?true
        :blocker==='NAMED_BUYER_EVIDENCE'?Number(row.named_relevant_buyer_count)>0
          :blocker==='VERIFIED_EMAIL_EVIDENCE'?Number(row.valid_contact_count)>0
            :blocker==='DECISION_REFRESH'?row.display_opportunity_status!=='EVIDENCE_REQUIRED':false;
    const responsibilityConflict=['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE'].includes(blocker)
      && Number(row.named_buyer_candidate_count)>0 && Number(row.named_relevant_buyer_count)===0;
    return {...row,resolved,responsibility_conflict:responsibilityConflict,hard_stop:false};
  }

  async prepareNextStrategy(taskId) {
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const locked=await client.query('SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE',[taskId]);
      const base=locked.rows[0];
      if(!base){await client.query('COMMIT');return null;}
      const meta=(await client.query(`SELECT c.company_name,c.country_code,c.official_root_domain,c.normalized_domain,
        coalesce(dm.candidates,0)::int named_buyer_candidate_count,dm.candidate_buyer_name
        FROM leadgen.companies c
        LEFT JOIN LATERAL (SELECT count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL
          AND d.lifecycle_status='ACTIVE') candidates,max(d.person_name) FILTER (WHERE d.person_name IS NOT NULL
          AND d.lifecycle_status='ACTIVE') candidate_buyer_name FROM leadgen.decision_makers d WHERE d.company_id=c.id) dm ON true
        WHERE c.id=$1`,[base.company_id])).rows[0]||{};
      const task={...base,...meta};
      if(task.current_strategy_code){
        const query=buildStrategyQuery(task.current_strategy_code,task);
        await client.query('COMMIT');
        return query?{...task,strategy:query}:task;
      }
      const history=await client.query(`SELECT DISTINCT strategy_code,query_fingerprint
        FROM leadgen.auto_evidence_task_attempts WHERE task_id=$1 AND strategy_attempt_number IS NOT NULL`,[taskId]);
      const oldQueries=await client.query(`SELECT DISTINCT q.query_text FROM leadgen.research_search_queries q
        WHERE q.company_id=$1 AND q.research_job_id IN ($2,$3)`,[
        task.company_id,task.category_research_job_id,task.contact_research_job_id
      ]);
      const usedCodes=history.rows.map(row=>row.strategy_code).filter(Boolean);
      const usedFingerprints=[...history.rows.map(row=>row.query_fingerprint).filter(Boolean),
        ...oldQueries.rows.map(row=>createHash('sha256').update(String(row.query_text||'').trim().toLowerCase()).digest('hex'))];
      const selection=selectNextUnusedStrategy(task,usedCodes,usedFingerprints);
      const strategy=selection.strategy;
      const nextNumber=Number(task.strategy_attempt_count||0)+1;
      if(!strategy){
        if(selection.duplicate_prevented_count)await client.query(`UPDATE leadgen.auto_evidence_tasks SET
          strategy_duplicate_prevented_count=strategy_duplicate_prevented_count+$2,updated_at=now() WHERE id=$1`,
          [taskId,selection.duplicate_prevented_count]);
        await client.query('COMMIT');
        return {...task,strategy:null,strategies_exhausted:true};
      }
      const startStage=strategyStartStage(strategy,task);
      const updated=(await client.query(`UPDATE leadgen.auto_evidence_tasks SET
        strategy_attempt_count=$2,attempt_count=$2,current_strategy_code=$3,strategy_version=$4,
        current_query_fingerprint=$5,current_strategy_locale=$6,current_source_class=$7,
        provider_retry_count=0,worker_retry_count=0,checkpoint_replay_count=0,strategy_state='STRATEGY_RUNNING',
        fairness_round_number=fairness_round_number+1,last_strategy_started_at=now(),
        strategy_duplicate_prevented_count=strategy_duplicate_prevented_count+$9,
        task_status='RUNNING',current_stage=$8,retry_at=NULL,technical_blocker=NULL,updated_at=now()
        WHERE id=$1 RETURNING *`,[taskId,nextNumber,strategy.code,strategy.version,strategy.query_fingerprint,
        strategy.locale,strategy.source_class,startStage,selection.duplicate_prevented_count])).rows[0];
      await client.query('COMMIT');
      return {...updated,...meta,strategy};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async closeCurrentStrategy(taskId,{state='NO_NEW_EVIDENCE'}={}) {
    const result=await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET strategy_state=$2,
      current_strategy_code=NULL,strategy_version=NULL,current_query_fingerprint=NULL,
      current_strategy_locale=NULL,current_source_class=NULL,provider_retry_count=0,worker_retry_count=0,
      checkpoint_replay_count=0,
      current_stage=NULL,task_status='RETRY_SCHEDULED',retry_at=now(),updated_at=now()
      WHERE id=$1 RETURNING *`,[taskId,state]);
    return result.rows[0]||null;
  }

  async advanceToNextStrategy(taskId,{state='NO_NEW_EVIDENCE'}={}) {
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const base=(await client.query('SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];
      if(!base){await client.query('COMMIT');return null;}
      const meta=(await client.query(`SELECT c.company_name,c.country_code,c.official_root_domain,c.normalized_domain,
        coalesce(dm.candidates,0)::int named_buyer_candidate_count,dm.candidate_buyer_name
        FROM leadgen.companies c
        LEFT JOIN LATERAL (SELECT count(DISTINCT d.id) FILTER (WHERE d.person_name IS NOT NULL
          AND d.lifecycle_status='ACTIVE') candidates,max(d.person_name) FILTER (WHERE d.person_name IS NOT NULL
          AND d.lifecycle_status='ACTIVE') candidate_buyer_name FROM leadgen.decision_makers d WHERE d.company_id=c.id) dm ON true
        WHERE c.id=$1`,[base.company_id])).rows[0]||{};
      const closed=(await client.query(`UPDATE leadgen.auto_evidence_tasks SET strategy_state=$2,
        current_strategy_code=NULL,strategy_version=NULL,current_query_fingerprint=NULL,
        current_strategy_locale=NULL,current_source_class=NULL,provider_retry_count=0,worker_retry_count=0,
        checkpoint_replay_count=0,current_stage=NULL,task_status='RETRY_SCHEDULED',retry_at=now(),
        technical_blocker=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[taskId,state])).rows[0];
      const history=await client.query(`SELECT DISTINCT strategy_code,query_fingerprint
        FROM leadgen.auto_evidence_task_attempts WHERE task_id=$1 AND strategy_attempt_number IS NOT NULL`,[taskId]);
      const oldQueries=await client.query(`SELECT DISTINCT q.query_text FROM leadgen.research_search_queries q
        WHERE q.company_id=$1 AND q.research_job_id IN ($2,$3)`,[
        closed.company_id,closed.category_research_job_id,closed.contact_research_job_id
      ]);
      const selection=selectNextUnusedStrategy({...closed,...meta},history.rows.map(row=>row.strategy_code).filter(Boolean),[
        ...history.rows.map(row=>row.query_fingerprint).filter(Boolean),
        ...oldQueries.rows.map(row=>createHash('sha256').update(String(row.query_text||'').trim().toLowerCase()).digest('hex'))
      ]);
      if(!selection.strategy){
        if(selection.duplicate_prevented_count)await client.query(`UPDATE leadgen.auto_evidence_tasks SET
          strategy_duplicate_prevented_count=strategy_duplicate_prevented_count+$2,updated_at=now() WHERE id=$1`,
          [taskId,selection.duplicate_prevented_count]);
        await client.query('COMMIT');
        return{...closed,...meta,strategy:null,strategies_exhausted:true};
      }
      const strategy=selection.strategy;
      const nextNumber=Number(closed.strategy_attempt_count||0)+1;
      const startStage=strategyStartStage(strategy,{...closed,...meta});
      const updated=(await client.query(`UPDATE leadgen.auto_evidence_tasks SET
        strategy_attempt_count=$2,attempt_count=$2,current_strategy_code=$3,strategy_version=$4,
        current_query_fingerprint=$5,current_strategy_locale=$6,current_source_class=$7,
        provider_retry_count=0,worker_retry_count=0,checkpoint_replay_count=0,strategy_state='STRATEGY_RUNNING',
        fairness_round_number=fairness_round_number+1,last_strategy_started_at=now(),
        strategy_duplicate_prevented_count=strategy_duplicate_prevented_count+$9,
        task_status='RUNNING',current_stage=$8,retry_at=NULL,technical_blocker=NULL,updated_at=now()
        WHERE id=$1 RETURNING *`,[taskId,nextNumber,strategy.code,strategy.version,strategy.query_fingerprint,
        strategy.locale,strategy.source_class,startStage,selection.duplicate_prevented_count])).rows[0];
      await client.query('COMMIT');
      return{...updated,...meta,strategy,queued_at:new Date()};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async incrementProviderRetry(taskId) {
    return (await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET provider_retry_count=provider_retry_count+1,
      strategy_state='TEMPORARY_ERROR',updated_at=now() WHERE id=$1 RETURNING *`,[taskId])).rows[0]||null;
  }

  async markExhausted(taskId) {
    return (await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='EVIDENCE_EXHAUSTED',
      strategy_state='EXHAUSTED',current_stage='REFRESHING_DECISION',technical_blocker='NO_REMAINING_DISTINCT_STRATEGY',retry_at=NULL,
      budget_state='NOT_REQUIRED',cooldown_until=NULL,completed_at=now(),updated_at=now()
      WHERE id=$1 RETURNING *`,[taskId])).rows[0]||null;
  }

  async stopIneligible(taskId,reason) {
    return (await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='CANCELLED',
      strategy_state='STOPPED_INELIGIBLE',technical_blocker=$2,retry_at=NULL,completed_at=now(),updated_at=now()
      WHERE id=$1 RETURNING *`,[taskId,cleanCode(reason,'INELIGIBLE')])).rows[0]||null;
  }

  async hasControlledOverride(taskId) {
    const result = await this.pool.query(`SELECT EXISTS (
      SELECT 1 FROM leadgen.auto_evidence_schedule_events
      WHERE task_id=$1 AND schedule_source='MANUAL_RETRY'
        AND outcome IN ('SCHEDULED','DEDUPLICATED')
        AND operator_identity IS NOT NULL AND operator_role IN ('MANAGEMENT','DATA_ADMIN')
        AND approval_reference IS NOT NULL
    ) allowed`, [taskId]);
    return result.rows[0]?.allowed === true;
  }

  async createProviderCapacityContinuation(client,resumedTask,originalTask=resumedTask){
    const categoryStage=['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE']
      .includes(resumedTask.current_stage);
    const column=categoryStage?'category_research_job_id':'contact_research_job_id';
    const originalResearchJobId=resumedTask[column];
    if(!originalResearchJobId)throw Object.assign(new Error('Provider capacity recovery requires a persisted ResearchJob checkpoint'),{
      code:'AUTO_EVIDENCE_RESUME_RESEARCH_JOB_REQUIRED',status:409
    });
    const original=(await client.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1 FOR SHARE`,[
      originalResearchJobId
    ])).rows[0];
    const providerStop=/(?:CREDIT.*(?:EXHAUSTED|CAP)|TAVILY.*LIMIT)/i.test(original?.stop_reason_code||'');
    const capacityCheckpoint=originalTask?.task_status==='PROVIDER_CAPACITY_WAIT'
      &&originalTask?.technical_blocker==='PROVIDER_CREDIT_EXHAUSTED';
    if(!providerStop&&!capacityCheckpoint){
      throw Object.assign(new Error('Provider capacity recovery requires a provider credit checkpoint'),{
        code:'AUTO_EVIDENCE_RESUME_STOP_REASON_REQUIRED',status:409
      });
    }
    const resumeExecutionKey=`auto-evidence-resume:${original.id}:${resumedTask.current_stage}:r${resumedTask.checkpoint_replay_count}`;
    const requestDigest=digest({resume_execution_key:resumeExecutionKey,task_id:resumedTask.id,
      company_id:resumedTask.company_id,product_profile:resumedTask.product_profile,
      strategy_attempt_number:resumedTask.strategy_attempt_count,stage:resumedTask.current_stage});
    const continuation=(await client.query(`INSERT INTO leadgen.research_jobs
      (country,city,product_category,buyer_types,max_results,country_code,country_name,region,
       preferred_language,market_profile,product_profile,job_type,market_codes,product_profiles,
       requested_company_ids,idempotency_key,request_digest,created_by_identity,created_by_role,
       research_wave,run_budget_cap_units,resumed_from_research_job_id,resume_execution_key,
       resume_checkpoint_replay_count,resume_stage)
      SELECT country,city,product_category,buyer_types,max_results,country_code,country_name,region,
       preferred_language,market_profile,product_profile,job_type,market_codes,product_profiles,
       requested_company_ids,$2,$3,'phase10-provider-capacity-recovery','SYSTEM',research_wave,run_budget_cap_units,
       id,$2,$4,$5 FROM leadgen.research_jobs WHERE id=$1
      ON CONFLICT (resume_execution_key) WHERE resume_execution_key IS NOT NULL
      DO UPDATE SET resume_execution_key=EXCLUDED.resume_execution_key RETURNING *`,[
      original.id,resumeExecutionKey,requestDigest,resumedTask.checkpoint_replay_count,resumedTask.current_stage
    ])).rows[0];
    const linked=(await client.query(`UPDATE leadgen.auto_evidence_tasks SET ${column}=$2,updated_at=now()
      WHERE id=$1 RETURNING *`,[resumedTask.id,continuation.id])).rows[0];
    const outbox=(await client.query(`INSERT INTO leadgen.auto_evidence_resume_outbox
      (task_id,original_research_job_id,continuation_research_job_id,execution_key,
       checkpoint_replay_count,resume_stage)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(execution_key) DO UPDATE SET execution_key=EXCLUDED.execution_key RETURNING *`,[
      resumedTask.id,original.id,continuation.id,resumeExecutionKey,
      resumedTask.checkpoint_replay_count,resumedTask.current_stage
    ])).rows[0];
    return{task:linked,original_research_job_id:original.id,continuation_research_job_id:continuation.id,
      resume_execution_key:resumeExecutionKey,resume_outbox_id:outbox.id};
  }

  async findReusableProviderContinuation(client,task){
    const categoryStage=['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE']
      .includes(task.current_stage);
    const researchJobId=task[categoryStage?'category_research_job_id':'contact_research_job_id'];
    if(!researchJobId)return null;
    const continuation=(await client.query(`SELECT * FROM leadgen.research_jobs
      WHERE id=$1 AND resumed_from_research_job_id IS NOT NULL AND resume_execution_key IS NOT NULL
        AND resume_stage=$2
        AND status IN ('QUEUED','CRAWLING','QUALIFYING','SCORING') FOR SHARE`,[
      researchJobId,task.current_stage
    ])).rows[0];
    if(!continuation)return null;
    const outbox=(await client.query(`INSERT INTO leadgen.auto_evidence_resume_outbox
      (task_id,original_research_job_id,continuation_research_job_id,execution_key,
       checkpoint_replay_count,resume_stage)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(execution_key) DO UPDATE SET execution_key=EXCLUDED.execution_key RETURNING *`,[
      task.id,continuation.resumed_from_research_job_id,continuation.id,continuation.resume_execution_key,
      continuation.resume_checkpoint_replay_count,continuation.resume_stage
    ])).rows[0];
    return{task,original_research_job_id:continuation.resumed_from_research_job_id,
      continuation_research_job_id:continuation.id,resume_execution_key:continuation.resume_execution_key,
      resume_outbox_id:outbox.id,reused_continuation:true};
  }

  async providerCapacityEligibility(client,task){
    const categoryStage=['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE']
      .includes(task.current_stage);
    const researchJobId=categoryStage?task.category_research_job_id:task.contact_research_job_id;
    if(!researchJobId)return{eligible:false,reason:'CHECKPOINT_RESEARCH_JOB_MISSING'};
    const gate=(await client.query(`SELECT
      EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=$1 AND s.lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=$1 AND s.lifted_at IS NULL) suppressed,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
        JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
        WHERE l.company_id=$1 AND l.link_status='CONFIRMED'
          AND h.customer_role='INTERNAL_EXISTING_CUSTOMER') historical_customer`,[task.company_id])).rows[0];
    if(gate?.suppressed)return{eligible:false,reason:'SUPPRESSED'};
    if(gate?.historical_customer)return{eligible:false,reason:'HISTORICAL_CUSTOMER'};
    const state=(await client.query(`SELECT status,retry_after_at FROM leadgen.provider_account_states
      WHERE provider_code='TAVILY'`)).rows[0];
    if(state?.status==='CREDIT_EXHAUSTED')return{eligible:false,reason:'PROVIDER_CREDIT_EXHAUSTED',provider:'TAVILY'};
    if(state?.status==='AUTH_ERROR')return{eligible:false,reason:'PROVIDER_AUTH_ERROR',provider:'TAVILY'};
    if(state?.status==='RATE_LIMITED'&&state.retry_after_at&&new Date(state.retry_after_at)>new Date())
      return{eligible:false,reason:'PROVIDER_RATE_LIMITED',provider:'TAVILY'};
    return{eligible:state?.status==='AVAILABLE',reason:state?.status==='AVAILABLE'?null:'PROVIDER_STATE_NOT_AVAILABLE',provider:'TAVILY'};
  }

  async claimPendingResumeDispatches(limit=10){
    const result=await this.pool.query(`WITH selected AS (
      SELECT id FROM leadgen.auto_evidence_resume_outbox
      WHERE dispatch_state IN ('PENDING','RETRY_PENDING') AND (next_attempt_at IS NULL OR next_attempt_at<=now())
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE leadgen.auto_evidence_resume_outbox o SET dispatch_state='PROCESSING',
      dispatch_attempt_count=dispatch_attempt_count+1,next_attempt_at=now()+interval '2 minutes',updated_at=now()
      FROM selected s WHERE o.id=s.id RETURNING o.*`,[Math.max(1,Math.min(100,Number(limit)||10))]);
    const rows=[];
    for(const outbox of result.rows){
      const task=await this.getTask(outbox.task_id);
      rows.push({...outbox,task});
    }
    return rows;
  }

  async markResumeDispatched(outboxId,queueJobId){
    await this.pool.query(`UPDATE leadgen.auto_evidence_resume_outbox SET dispatch_state='DISPATCHED',
      queue_job_id=$2,next_attempt_at=NULL,last_error_code=NULL,dispatched_at=coalesce(dispatched_at,now()),updated_at=now()
      WHERE id=$1`,[outboxId,String(queueJobId||'')||null]);
  }

  async markResumeDispatchRetry(outboxId,errorCode){
    await this.pool.query(`UPDATE leadgen.auto_evidence_resume_outbox SET dispatch_state='RETRY_PENDING',
      last_error_code=$2,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1`,[
      outboxId,cleanCode(errorCode||'QUEUE_UNAVAILABLE')
    ]);
  }

  async resumeProviderCapacityWait(taskId,{scheduleKey,operatorIdentity,operatorRole,approvalReference,scheduleSource='RECONCILIATION'}={}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE`, [taskId]);
      const task = locked.rows[0];
      if (!task) throw Object.assign(new Error('Auto-evidence task not found'), { code: 'AUTO_EVIDENCE_TASK_NOT_FOUND' });
      if (task.task_status !== 'PROVIDER_CAPACITY_WAIT') {
        await client.query('COMMIT');
        return { task, resumed: false };
      }
      const eligibility=await this.providerCapacityEligibility(client,task);
      if(!eligibility.eligible){
        await client.query('COMMIT');
        return{task,resumed:false,provider_capacity_wait:true,
          blocked_by_business_gate:['SUPPRESSED','HISTORICAL_CUSTOMER'].includes(eligibility.reason),
          reason:eligibility.reason};
      }
      const reusable=await this.findReusableProviderContinuation(client,task);
      const updated = await client.query(`UPDATE leadgen.auto_evidence_tasks
        SET task_status='RETRY_SCHEDULED',budget_state='AVAILABLE',technical_blocker=NULL,retry_at=now(),
          strategy_state='STRATEGY_RUNNING',checkpoint_replay_count=greatest(checkpoint_replay_count+1,
            coalesce((SELECT max(a.checkpoint_replay_count)+1 FROM leadgen.auto_evidence_task_attempts a
              WHERE a.task_id=leadgen.auto_evidence_tasks.id),1)),updated_at=now()
        WHERE id=$1 RETURNING *`, [taskId]);
      let resumedTask=updated.rows[0];
      const event=await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
        (schedule_source,schedule_key,task_id,company_id,target_category_scope_key,target_category_code,product_profile,
         business_blocker,evidence_revision,outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
        VALUES ($13,$1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED',$9,$10,$11,$12,now())
        ON CONFLICT (schedule_key) DO NOTHING RETURNING id`,[
        scheduleKey,resumedTask.id,resumedTask.company_id,resumedTask.target_category_scope_key,
        resumedTask.target_category_code,resumedTask.product_profile,resumedTask.business_blocker,
        resumedTask.evidence_revision,resumedTask.input_digest,operatorIdentity,operatorRole,approvalReference,scheduleSource
      ]);
      if(!event.rowCount)throw Object.assign(new Error('Provider capacity recovery audit was not appended'),{
        code:'AUTO_EVIDENCE_CONTROLLED_AUDIT_REQUIRED',status:409
      });
      const continuation=reusable?{...reusable,task:resumedTask}
        :await this.createProviderCapacityContinuation(client,resumedTask,task);
      resumedTask=continuation.task;
      await client.query('COMMIT');
      return { task: resumedTask, resumed: true, schedule_event_id:event.rows[0].id,...continuation };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureResearchJob(task, kind) {
    const normalizedKind = upper(kind);
    const column = normalizedKind === 'CATEGORY' ? 'category_research_job_id' : 'contact_research_job_id';
    const jobType = normalizedKind === 'CATEGORY' ? 'CATEGORY_PROCUREMENT_ENRICHMENT' : 'DECISION_MAKER_ENRICHMENT';
    const transactional=typeof this.pool.connect==='function';
    const client=transactional?await this.pool.connect():this.pool;
    try{
      if(transactional)await client.query('BEGIN');
      const locked=transactional
        ?await client.query(`SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE`,[task.id])
        :{rows:[]};
      const currentTask=locked.rows[0]||task;
      const strategyAttempt=Math.max(1,Number(currentTask.strategy_attempt_count??currentTask.attempt_count??0));
      const finish=async value=>{
        if(transactional)await client.query('COMMIT');
        return value;
      };
      if(currentTask[column]){
        const currentJobResult=await client.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1`,[currentTask[column]]);
        const currentJob=currentJobResult.rows[0]||null;
        if(currentJob?.resumed_from_research_job_id&&(
          ['QUEUED','RUNNING','DISCOVERING','CRAWLING','EXTRACTING','QUALIFYING','SCORING'].includes(currentJob.status)
          || (['COMPLETED','EVIDENCE_EXHAUSTED'].includes(currentTask.task_status)&&currentJob.status==='COMPLETED')
        ))return finish({...currentJob,job_type:jobType,replay:true,checkpoint_continuation:true});
        if(Number(currentTask.checkpoint_replay_count||0)>0){
          const linkedContinuation=await client.query(`SELECT * FROM leadgen.research_jobs
            WHERE id=$1 AND resume_checkpoint_replay_count=$2 AND resume_stage=$3
              AND resumed_from_research_job_id IS NOT NULL`,[
            currentTask[column],Number(currentTask.checkpoint_replay_count),currentTask.current_stage
          ]);
          if(linkedContinuation.rowCount)return finish({...linkedContinuation.rows[0],job_type:jobType,
            replay:true,checkpoint_continuation:true});
        }
      }
      if(Number(currentTask.checkpoint_replay_count||0)>0&&currentTask.current_stage){
        const canonicalJob=await findCanonicalCheckpointContinuation(client,currentTask);
        if(canonicalJob){
          if(currentTask[column]!==canonicalJob.id)await client.query(`UPDATE leadgen.auto_evidence_tasks
            SET ${column}=$2,updated_at=now() WHERE id=$1`,[currentTask.id,canonicalJob.id]);
          return finish({...canonicalJob,job_type:jobType,replay:true,checkpoint_continuation:true});
        }
      }
      if(currentTask[column]){
        const settled=await client.query(`SELECT 1 FROM leadgen.auto_evidence_task_attempts
          WHERE task_id=$1 AND strategy_attempt_number=$2 AND research_job_id=$3
            AND event_type='SETTLED' LIMIT 1`,[currentTask.id,strategyAttempt,currentTask[column]]);
        if(settled.rowCount)return finish({id:currentTask[column],job_type:jobType,replay:true});
      }
      const idempotencyKey = `auto-evidence:${currentTask.execution_key}:${normalizedKind.toLowerCase()}:strategy:${strategyAttempt}`.slice(0, 200);
      const requestDigest = digest({
        task_id: currentTask.id,
        company_id: currentTask.company_id,
        target_category_code:currentTask.target_category_code,
        target_category_scope_key:currentTask.target_category_scope_key,
        product_profile: currentTask.product_profile,
        evidence_revision: currentTask.evidence_revision,
        strategy_attempt_number:strategyAttempt,
        strategy_code:currentTask.current_strategy_code||null,
        job_type: jobType
      });
      const result = await client.query(`INSERT INTO leadgen.research_jobs
        (country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
         buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,
         idempotency_key,request_digest,created_by_identity,created_by_role)
        SELECT c.country_code,c.country_code,c.country_code,'en','AUTO_EVIDENCE',
          t.target_category_code,t.product_profile,
          ARRAY['Buyer','Procurement','Purchasing','Category','Merchandising','Sourcing']::text[],
          1,'QUEUED',$2,ARRAY[c.country_code]::text[],array_remove(ARRAY[t.product_profile]::text[],NULL),ARRAY[t.company_id]::uuid[],
          $3,$4,'phase10-auto-evidence','SYSTEM'
        FROM leadgen.auto_evidence_tasks t JOIN leadgen.companies c ON c.id=t.company_id
        WHERE t.id=$1
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
        DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [
        currentTask.id, jobType, idempotencyKey, requestDigest
      ]);
      const job = result.rows[0];
      if (!job) throw Object.assign(new Error('Auto-evidence research job could not be created'), { code: 'AUTO_EVIDENCE_RESEARCH_JOB_CREATE_FAILED' });
      await client.query(`UPDATE leadgen.auto_evidence_tasks SET ${column}=$2,updated_at=now()
        WHERE id=$1`, [currentTask.id, job.id]);
      return finish({ ...job, replay: false });
    }catch(error){
      if(transactional)await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{
      if(transactional)client.release();
    }
  }

  async markResearchJobRunning(researchJobId,stage){
    const status=({DISCOVERING_SOURCES:'DISCOVERING',CRAWLING:'CRAWLING',EXTRACTING:'QUALIFYING',
      NORMALIZING_CATEGORY:'QUALIFYING',VALIDATING_EVIDENCE:'SCORING',FINDING_BUYER:'DISCOVERING',
      VERIFYING_EMAIL:'QUALIFYING',REFRESHING_DECISION:'SCORING'})[stage]||'DISCOVERING';
    await this.pool.query(`UPDATE leadgen.research_jobs SET status=$2,started_at=coalesce(started_at,now()),
      completed_at=NULL,dispatch_state='DISPATCHED',blocked_reason=NULL,
      last_dispatch_attempt_at=coalesce(last_dispatch_attempt_at,now()),next_dispatch_attempt_at=NULL
      WHERE id=$1 AND created_by_identity='phase10-auto-evidence'`,[researchJobId,status]);
  }

  async markResearchJobSettled(researchJobId,outcome,technicalBlocker=null){
    const failed=outcome==='PERMANENT_ERROR';
    const partial=['PROVIDER_CAPACITY_WAIT','HUMAN_REVIEW_REQUIRED','TEMPORARY_ERROR','RETRYABLE_ERROR'].includes(outcome);
    await this.pool.query(`UPDATE leadgen.research_jobs SET status=$2,started_at=coalesce(started_at,created_at),
      completed_at=now(),dispatch_state='DISPATCHED',blocked_reason=NULL,next_dispatch_attempt_at=NULL,
      last_error=CASE WHEN $2='FAILED' THEN left(coalesce($3,'AUTO_EVIDENCE_STAGE_FAILED'),500) ELSE NULL END
      WHERE id=$1 AND created_by_identity='phase10-auto-evidence'`,[
      researchJobId,failed?'FAILED':partial?'PARTIAL':'COMPLETED',technicalBlocker
    ]);
  }

  async getSettledAttempt(taskId,attemptNumber,stage,providerRetryCount=0,workerRetryCount=0,checkpointReplayCount=0) {
    const result = await this.pool.query(`SELECT * FROM leadgen.auto_evidence_task_attempts
      WHERE task_id=$1 AND strategy_attempt_number=$2 AND stage=$3 AND provider_retry_count=$4
        AND worker_retry_count=$5 AND checkpoint_replay_count=$6 AND event_type='SETTLED'`,
      [taskId,attemptNumber,stage,providerRetryCount,workerRetryCount,checkpointReplayCount]);
    return result.rows[0] || null;
  }

  async beginStage(task, stage, inputDigest, { leaseMinutes = 15 } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE`, [task.id]);
      let current = locked.rows[0] || null;
      if (!current || !['QUEUED','RUNNING','RETRY_SCHEDULED','TEMPORARY_PROVIDER_ERROR'].includes(current.task_status)
          || (current.retry_at && new Date(current.retry_at) > new Date())) {
        await client.query('COMMIT');
        return { task: current, started: false };
      }
      const attemptNumber = Math.max(1, Number(current.strategy_attempt_count || 0));
      let providerRetry=Number(current.provider_retry_count||0);
      let workerRetry=Number(current.worker_retry_count||0);
      const checkpointReplay=Number(current.checkpoint_replay_count||0);
      const events = await client.query(`SELECT event_type,occurred_at FROM leadgen.auto_evidence_task_attempts
        WHERE task_id=$1 AND strategy_attempt_number=$2 AND stage=$3 AND provider_retry_count=$4
          AND worker_retry_count=$5 AND checkpoint_replay_count=$6
          AND event_type IN ('STARTED','SETTLED') ORDER BY occurred_at DESC`,
        [current.id,attemptNumber,stage,providerRetry,workerRetry,checkpointReplay]);
      if (events.rows.some(row => row.event_type === 'SETTLED')) {
        await client.query('COMMIT');
        return { task: current, started: false, settled: true };
      }
      const started = events.rows.find(row => row.event_type === 'STARTED');
      const leaseUntil = started
        ? new Date(new Date(started.occurred_at).getTime() + Math.max(1, Number(leaseMinutes || 15)) * 60000)
        : null;
      if (started && leaseUntil > new Date()) {
        await client.query('COMMIT');
        return { task: current, started: false, retryAt: leaseUntil };
      }
      if(started){
        workerRetry+=1;
        current=(await client.query(`UPDATE leadgen.auto_evidence_tasks SET worker_retry_count=$2,
          updated_at=now() WHERE id=$1 RETURNING *`,[current.id,workerRetry])).rows[0];
      }
      await client.query(`INSERT INTO leadgen.auto_evidence_task_attempts
        (task_id,company_id,attempt_number,strategy_code,strategy_version,strategy_attempt_number,
         query_fingerprint,locale,source_class,provider_retry_count,worker_retry_count,checkpoint_replay_count,stage,event_type,
         outcome_status,input_digest,idempotency_key,started_at,occurred_at)
        VALUES ($1,$2,$3,$4,$5,$3,$6,$7,$8,$9,$10,$11,$12,'STARTED',NULL,$13,$14,now(),now())`, [
        current.id,current.company_id,attemptNumber,current.current_strategy_code,current.strategy_version,
        current.current_query_fingerprint,current.current_strategy_locale,current.current_source_class,
        providerRetry,workerRetry,checkpointReplay,stage,inputDigest,
        `auto-evidence:${current.id}:${attemptNumber}:${current.current_strategy_code}:${stage}:p${providerRetry}:w${workerRetry}:r${checkpointReplay}:started`
      ]);
      const updated = await client.query(`UPDATE leadgen.auto_evidence_tasks SET
        task_status='RUNNING',current_stage=$2,attempt_count=strategy_attempt_count,
        technical_blocker=NULL,retry_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [current.id, stage]);
      current = updated.rows[0];
      await client.query('COMMIT');
      return { task: current, started: true, recovered: Boolean(started) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async settleStage(task, stage, outcome, result, inputDigest, outputDigest, technicalBlocker = null, retryAt = null) {
    const refs = referenceValues(result);
    await this.pool.query(`INSERT INTO leadgen.auto_evidence_task_attempts
      (task_id,company_id,attempt_number,stage,event_type,outcome_status,research_job_id,provider_usage_event_id,
       prospect_category_source_id,prospect_category_observation_id,buyer_business_model_result_id,
       category_procurement_match_result_id,product_opportunity_result_id,cooperation_feasibility_result_id,
       decision_maker_id,decision_maker_contact_id,contact_verification_event_id,
       business_opportunity_decision_snapshot_id,technical_blocker,retry_at,input_digest,output_digest,
       idempotency_key,strategy_code,strategy_version,strategy_attempt_number,query_fingerprint,locale,source_class,
       new_url_count,usable_evidence_count,named_buyer_candidate_count,valid_contact_count,provider_retry_count,
       worker_retry_count,checkpoint_replay_count,started_at,finished_at,terminal_reason,occurred_at)
      VALUES ($1,$2,$3,$4,'SETTLED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
        $23,$24,$3,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,now(),now(),$35,now())
      ON CONFLICT (idempotency_key) DO NOTHING`, [
      task.id,task.company_id,task.strategy_attempt_count,stage,outcome,result.research_job_id||null,
      refs.provider_usage_event_id, refs.prospect_category_source_id, refs.prospect_category_observation_id,
      refs.buyer_business_model_result_id, refs.category_procurement_match_result_id,
      refs.product_opportunity_result_id, refs.cooperation_feasibility_result_id,
      refs.decision_maker_id, refs.decision_maker_contact_id, refs.contact_verification_event_id,
      refs.business_opportunity_decision_snapshot_id, technicalBlocker, retryAt, inputDigest, outputDigest,
      `auto-evidence:${task.id}:${task.strategy_attempt_count}:${task.current_strategy_code}:${stage}:p${task.provider_retry_count||0}:w${task.worker_retry_count||0}:r${task.checkpoint_replay_count||0}:settled`,
      task.current_strategy_code,task.strategy_version,task.current_query_fingerprint,task.current_strategy_locale,
      task.current_source_class,Number(result.new_url_count||0),Number(result.usable_evidence_count||0),
      Number(result.named_buyer_candidate_count||0),Number(result.valid_contact_count||0),
      Number(task.provider_retry_count||0),Number(task.worker_retry_count||0),Number(task.checkpoint_replay_count||0),
      technicalBlocker||outcome
    ]);
  }

  async recordBundledStage(task, stage, result, inputDigest, outputDigest) {
    const startedKey = `auto-evidence:${task.id}:${task.strategy_attempt_count}:${task.current_strategy_code}:${stage}:p${task.provider_retry_count||0}:w${task.worker_retry_count||0}:r${task.checkpoint_replay_count||0}:started`;
    await this.pool.query(`INSERT INTO leadgen.auto_evidence_task_attempts
      (task_id,company_id,attempt_number,strategy_code,strategy_version,strategy_attempt_number,query_fingerprint,
       locale,source_class,provider_retry_count,worker_retry_count,checkpoint_replay_count,stage,event_type,outcome_status,input_digest,
       idempotency_key,started_at,occurred_at)
      VALUES ($1,$2,$3,$4,$5,$3,$6,$7,$8,$9,$10,$11,$12,'STARTED',NULL,$13,$14,now(),now())
      ON CONFLICT (idempotency_key) DO NOTHING`, [
      task.id,task.company_id,task.strategy_attempt_count,task.current_strategy_code,task.strategy_version,
      task.current_query_fingerprint,task.current_strategy_locale,task.current_source_class,
      Number(task.provider_retry_count||0),Number(task.worker_retry_count||0),Number(task.checkpoint_replay_count||0),
      stage,inputDigest,startedKey
    ]);
    await this.settleStage(task, stage, 'COMPLETED', result, inputDigest, outputDigest);
  }

  async completeTask(taskId) {
    const result = await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='COMPLETED',
      current_stage='REFRESHING_DECISION',technical_blocker=NULL,retry_at=NULL,cooldown_until=NULL,
      strategy_state='RESOLVED',completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [taskId]);
    return result.rows[0];
  }

  async updateTaskOutcome(taskId, { status, technicalBlocker = null, retryAt = null,
    budgetState = 'NOT_REQUIRED', completed = false } = {}) {
    const result = await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status=$2,
      technical_blocker=$3,retry_at=$4,budget_state=$5,
      attempt_count=strategy_attempt_count,
      strategy_state=CASE WHEN $2='PROVIDER_CAPACITY_WAIT' THEN 'PROVIDER_CAPACITY_WAIT'
        WHEN $2='RETRY_SCHEDULED' AND $3='TEMPORARY_PROVIDER_ERROR' THEN 'TEMPORARY_ERROR'
        ELSE strategy_state END,
      cooldown_until=NULL,completed_at=CASE WHEN $6 THEN now() ELSE NULL END,updated_at=now()
      WHERE id=$1 RETURNING *`, [
      taskId, status, technicalBlocker, retryAt, budgetState, completed
    ]);
    return result.rows[0];
  }

  async openException(task, { exceptionType, technicalBlocker, inputDigest } = {}) {
    const exceptionKey = `auto-evidence:exception:${task.id}:${exceptionType}`;
    const idempotencyKey = `${exceptionKey}:opened:${task.strategy_attempt_count??task.attempt_count}`;
    const result = await this.pool.query(`INSERT INTO leadgen.human_evidence_exceptions
      (task_id,company_id,product_profile,exception_key,event_type,exception_type,business_blocker,
       input_digest,idempotency_key,occurred_at)
      VALUES ($1,$2,$3,$4,'OPENED',$5,$6,$7,$8,now()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`, [
      task.id, task.company_id, task.product_profile, exceptionKey, exceptionType,
      task.business_blocker, inputDigest, idempotencyKey
    ]);
    await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='HUMAN_REVIEW_REQUIRED',
      strategy_state='HUMAN_REVIEW_REQUIRED',technical_blocker=$2,retry_at=NULL,updated_at=now() WHERE id=$1`, [task.id, technicalBlocker]);
    return result.rows[0] || null;
  }

  async summary() {
    const [tasks, stages, schedule] = await Promise.all([
      this.pool.query(`SELECT task_status,count(*)::int count FROM leadgen.auto_evidence_tasks GROUP BY task_status`),
      this.pool.query(`SELECT current_stage,count(*)::int count FROM leadgen.auto_evidence_tasks
        WHERE task_status='RUNNING' GROUP BY current_stage`),
      this.pool.query(`SELECT schedule_source,outcome,occurred_at FROM leadgen.auto_evidence_schedule_events
        ORDER BY occurred_at DESC,id DESC LIMIT 1`)
    ]);
    return { task_statuses: tasks.rows, active_stages: stages.rows, latest_schedule: schedule.rows[0] || null };
  }

  async tavilyMetrics() {
    const result=await this.pool.query(`WITH day_events AS (
      SELECT * FROM leadgen.provider_usage_events WHERE provider='TAVILY'
        AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ), attempt_metrics AS (
      SELECT coalesce(sum(usable_evidence_count),0)::int usable,
        coalesce(sum(named_buyer_candidate_count),0)::int buyers,
        coalesce(sum(valid_contact_count),0)::int contacts
      FROM leadgen.auto_evidence_task_attempts WHERE event_type='SETTLED'
        AND occurred_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ) SELECT coalesce(sum(e.used_units),0)::int units_used_today,
      coalesce(sum(e.used_units) FILTER(WHERE e.budget_pool='DISCOVERY'),0)::int discovery_units_used_today,
      coalesce(sum(e.used_units) FILTER(WHERE e.budget_pool='EVIDENCE'),0)::int evidence_units_used_today,
      count(DISTINCT e.company_id)::int companies_attempted_today,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts a WHERE a.event_type='STARTED'
        AND a.strategy_attempt_number IS NOT NULL
        AND a.occurred_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') strategies_attempted_today,
      (SELECT usable FROM attempt_metrics) new_usable_evidence_today,
      (SELECT buyers FROM attempt_metrics) named_buyer_candidates_today,
      (SELECT contacts FROM attempt_metrics) valid_contacts_today,
      (SELECT count(*)::int FROM leadgen.auto_evidence_tasks t WHERE t.task_status='EVIDENCE_EXHAUSTED'
        AND t.completed_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') companies_exhausted,
      (SELECT coalesce(sum(strategy_duplicate_prevented_count),0)::int FROM leadgen.auto_evidence_tasks)
        strategy_duplicate_prevented_count
    FROM day_events e`);
    const row=result.rows[0]||{};
    const evidenceUnits=Number(row.evidence_units_used_today||0);
    const ratio=value=>Number(value)>0?Number((evidenceUnits/Number(value)).toFixed(2)):null;
    return {...row,units_per_usable_evidence:ratio(row.new_usable_evidence_today),
      units_per_named_buyer_candidate:ratio(row.named_buyer_candidates_today),
      units_per_valid_contact:ratio(row.valid_contacts_today)};
  }

  async listTasks({ limit = 50 } = {}) {
    const result = await this.pool.query(`SELECT t.id,t.company_id,c.company_name,c.country_code market,t.product_profile,
      t.business_blocker,t.evidence_revision,t.task_status,t.current_stage,t.automation_owner,t.human_owner,
      t.technical_blocker,t.attempt_count,t.strategy_attempt_count,t.max_attempts,t.current_strategy_code,
      t.strategy_version,t.strategy_state,t.provider_retry_count,t.worker_retry_count,t.checkpoint_replay_count,
      t.budget_state,t.retry_at,t.cooldown_until,
      t.category_research_job_id,t.contact_research_job_id,t.created_at,t.updated_at,t.completed_at,
      CASE WHEN t.task_status='HUMAN_REVIEW_REQUIRED' THEN 'HUMAN_REVIEW' ELSE 'AUTO_ENRICHMENT' END task_class,
      (t.task_status='HUMAN_REVIEW_REQUIRED') human_review_required
      FROM leadgen.auto_evidence_tasks t JOIN leadgen.companies c ON c.id=t.company_id
      ORDER BY t.created_at DESC,t.id DESC LIMIT $1`, [
      boundedInt(limit, { min: 1, max: 100, fallback: 50 })
    ]);
    return result.rows;
  }

  async listExceptions({ limit = 50 } = {}) {
    const result = await this.pool.query(`SELECT id,task_id,company_id,product_profile,exception_key,event_type,
      exception_type,business_blocker,human_owner,resolution_code,notes,occurred_at
      FROM leadgen.human_evidence_exceptions_current
      WHERE event_type IN ('OPENED','CLAIMED') ORDER BY occurred_at DESC,id DESC LIMIT $1`, [
      boundedInt(limit, { min: 1, max: 100, fallback: 50 })
    ]);
    return result.rows;
  }
}

export class AutoEvidenceOrchestrator {
  constructor({ pool, queue, repository = null, executors = {}, providerAccountState=null,
    env = process.env, audit = () => {}, now = () => new Date() } = {}) {
    if (!queue?.enqueue) throw new TypeError('AutoEvidenceOrchestrator requires a queue');
    this.repository = repository || new AutoEvidenceRepository({ pool });
    this.queue = queue;
    this.executors = executors;
    this.providerAccountState=providerAccountState;
    this.config = autoEvidenceConfig(env);
    this.audit = audit;
    this.now = now;
  }

  status() {
    return { enabled: this.config.enabled, activation_required: !this.config.enabled, outbound_allowed: false, ...this.config };
  }

  async dispatchCapacityRecovery(resume){
    try{
      const dispatch=await this.dispatchTask(resume.task,resume.task.current_stage);
      if(typeof this.repository.markResumeDispatched==='function')
        await this.repository.markResumeDispatched(resume.resume_outbox_id||resume.id,dispatch.queue_job_id);
      return{dispatch,error:null};
    }catch(error){
      if(typeof this.repository.markResumeDispatchRetry==='function')
        await this.repository.markResumeDispatchRetry(resume.resume_outbox_id||resume.id,error?.code||'QUEUE_UNAVAILABLE');
      return{dispatch:null,error:{code:cleanCode(error?.code||'QUEUE_UNAVAILABLE')}};
    }
  }

  async dispatchTask(task, stage = 'DISCOVERING_SOURCES', {
    startAfter = null, singletonSuffix = '', attemptNumberOverride = null
  } = {}) {
    const queueName = STAGE_QUEUE[stage];
    if (!queueName) throw Object.assign(new Error(`No auto-evidence queue for stage ${stage}`), { code: 'AUTO_EVIDENCE_STAGE_INVALID' });
    const attemptNumber = attemptNumberOverride == null
      ?Math.max(1,Number(task.strategy_attempt_count??task.attempt_count??0))
      :Math.max(1,Number(attemptNumberOverride));
    const providerRetry=Number(task.provider_retry_count||0);
    const workerRetry=Number(task.worker_retry_count||0);
    const checkpointReplay=Number(task.checkpoint_replay_count||0);
    const singletonKey = `auto-evidence:${task.execution_key}:${attemptNumber}:${task.current_strategy_code||'ready'}:${stage}:p${providerRetry}:w${workerRetry}:r${checkpointReplay}${singletonSuffix?`:${singletonSuffix}`:''}`;
    const queueJobId = await this.queue.enqueue(queueName, {
      task_id: task.id,
      execution_key: task.execution_key,
      attempt_number: attemptNumber,
      strategy_attempt_number:attemptNumber,
      strategy_code:task.current_strategy_code||null,
      provider_retry_number:providerRetry,
      worker_retry_number:workerRetry,
      checkpoint_replay_number:checkpointReplay,
      stage
    }, { singletonKey, startAfter });
    return { queue: queueName, queue_job_id: queueJobId };
  }

  async scheduleEvent(input = {}) {
    if (!this.config.enabled) return { status: 'DISABLED', enabled: false, scheduled: 0 };
    const source = upper(input.schedule_source || 'EVENT');
    if (!SCHEDULE_SOURCES.has(source)) throw Object.assign(new Error('Invalid auto-evidence schedule source'), { code: 'AUTO_EVIDENCE_SOURCE_INVALID' });
    const categoryContext=resolveTargetCategoryContext(input);
    const candidate = {
      company_id: String(input.company_id || '').trim(),
      target_category_scope_key:categoryContext.targetCategoryScopeKey,
      target_category_code:categoryContext.targetCategoryCode,
      target_category:categoryContext.targetCategory,
      product_profile:categoryContext.productProfile,
      business_blocker: cleanCode(input.business_blocker),
      evidence_revision: boundedInt(input.evidence_revision, { min: 0, max: 2147483647, fallback: 0 })
    };
    if (!candidate.company_id) throw Object.assign(new Error('Auto-evidence company is required'), { code: 'AUTO_EVIDENCE_COMPANY_REQUIRED' });
    const inputDigest = digest(candidate);
    const scheduleKey = String(input.schedule_key || `auto-evidence:schedule:${digest({ source, event: input.event_id || input.reconcile_bucket || '', ...candidate })}`).slice(0, 240);
    const scheduled = await this.repository.schedule(candidate, {
      source,
      scheduleKey,
      inputDigest
    });
    let dispatch = null;
    if (scheduled.dispatch_required) {
      const retryAttemptNumber=scheduled.task?.task_status==='RETRY_SCHEDULED'
        ?Number(scheduled.task.strategy_attempt_count||0)+1
        :undefined;
      dispatch = await this.dispatchTask(scheduled.task,'DISCOVERING_SOURCES',{
        attemptNumberOverride:retryAttemptNumber
      });
    }
    this.audit('AUTO_EVIDENCE_SCHEDULED', {
      task_id: scheduled.task?.id || null,
      company_id: candidate.company_id,
      product_profile: candidate.product_profile,
      target_category_scope_key:candidate.target_category_scope_key,
      outcome: scheduled.outcome,
      schedule_source: source
    });
    return { status: scheduled.outcome, enabled: true, task_id: scheduled.task?.id || null, dispatch };
  }

  async scheduleControlledCandidate(candidate, { source, bucket, operatorIdentity, operatorRole, approvalReference }) {
    const inputDigest = digest(candidate);
    const scheduleKey = `auto-evidence:schedule:${digest({ source, bucket, ...candidate })}`.slice(0, 240);
    const scheduled = await this.repository.schedule(candidate, {
      source,
      scheduleKey,
      inputDigest,
      operatorIdentity,
      operatorRole,
      approvalReference
    });
    let dispatch = null;
    if (scheduled.dispatch_required) dispatch = await this.dispatchTask(scheduled.task);
    return { status: scheduled.outcome, task_id: scheduled.task?.id || null, dispatch };
  }

  async reconcile(input = {}) {
    if (!this.config.enabled) return { status: 'DISABLED', enabled: false, selected: 0, scheduled: 0 };
    const limit = boundedInt(input.batch_size, { min: 1, max: this.config.batchSize, fallback: this.config.batchSize });
    const targetedEvent=Boolean(input.company_id||(Array.isArray(input.company_ids)&&input.company_ids.length)
      ||input.research_job_id||input.import_id||input.category_scope_revision_id);
    const requestedCompanyIds=Array.isArray(input.company_ids)&&input.company_ids.length
      ?input.company_ids:(input.company_id?[input.company_id]:[]);
    const companyIds=typeof this.repository.resolveEventCompanyIds==='function'
      ?await this.repository.resolveEventCompanyIds(input)
      :requestedCompanyIds.length?requestedCompanyIds
        :typeof this.repository.resolveResearchJobCompanyIds==='function'
          ?await this.repository.resolveResearchJobCompanyIds(input.research_job_id):[];
    if(targetedEvent&&!companyIds.length){
      return {status:'COMPLETED',enabled:true,scanned:0,repaired:0,resumed:0,errors:0,
        selected:0,targeted_companies:0,scheduled:0,deduplicated:0,target_resolution:'EMPTY',results:[]};
    }
    const selectionOptions={
      marketCodes: Array.isArray(input.market_codes) ? input.market_codes : [],
      productProfiles: Array.isArray(input.product_profiles) ? input.product_profiles : [],
      companyIds,
      sourceTtlDays:this.config.sourceTtlDays
    };
    const bucket = String(input.reconcile_bucket || Math.floor(this.now().getTime() / (this.config.reconcileMinutes * 60000)));
    const projectionRepairs=typeof this.repository.reconcileStaleResearchJobProjections==='function'
      ?await this.repository.reconcileStaleResearchJobProjections({limit,leaseMinutes:this.config.stageLeaseMinutes}):[];
    const pendingResumeDispatches=typeof this.repository.claimPendingResumeDispatches==='function'
      ?await this.repository.claimPendingResumeDispatches(limit):[];
    const results = [];
    for(const pending of pendingResumeDispatches){
      const outcome=await this.dispatchCapacityRecovery({...pending,resume_outbox_id:pending.id});
      results.push({status:outcome.dispatch?'CAPACITY_RECOVERY_REDISPATCHED':'CAPACITY_RECOVERY_DISPATCH_RETRY',
        task_id:pending.task_id,dispatch:outcome.dispatch,error:outcome.error});
    }
    const remainingAfterOutbox=Math.max(0,limit-pendingResumeDispatches.length);
    let providerState=this.providerAccountState?await this.providerAccountState.refreshUsage().catch(()=>null):null;
    const capacityWaits=providerState?.status==='AVAILABLE'&&typeof this.repository.selectProviderCapacityWaits==='function'
      ?await this.repository.selectProviderCapacityWaits({...selectionOptions,limit:remainingAfterOutbox}):[];
    for(const task of capacityWaits){
      try{
        const resumed=await this.repository.resumeProviderCapacityWait(task.id,{
          scheduleKey:`auto-evidence:provider-capacity-recovery:${task.id}:${bucket}`,
          scheduleSource:'RECONCILIATION'
        });
        const outcome=resumed.resumed?await this.dispatchCapacityRecovery(resumed):{dispatch:null,error:null};
        this.audit('AUTO_EVIDENCE_PROVIDER_CAPACITY_RECOVERED',{
          task_id:task.id,company_id:task.company_id,product_profile:task.product_profile,resumed:resumed.resumed
        });
        results.push({status:outcome.dispatch?'CAPACITY_RECOVERED':outcome.error?'CAPACITY_RECOVERY_DISPATCH_RETRY':resumed.task.task_status,
          task_id:task.id,continuation_research_job_id:resumed.continuation_research_job_id||null,
          resume_outbox_id:resumed.resume_outbox_id||null,dispatch:outcome.dispatch,error:outcome.error});
      }catch(error){
        results.push({status:'CAPACITY_RECOVERY_ERROR',task_id:task.id,
          error:{code:cleanCode(error?.code||'AUTO_EVIDENCE_CAPACITY_RECOVERY_FAILED')}});
      }
    }
    const remainingAfterCapacity=Math.max(0,remainingAfterOutbox-capacityWaits.length);
    const staleRunning=typeof this.repository.selectStaleRunningTasks==='function'
      ?await this.repository.selectStaleRunningTasks({...selectionOptions,limit:remainingAfterCapacity,
        leaseMinutes:this.config.stageLeaseMinutes}):[];
    for(const task of staleRunning){
      const dispatch=await this.dispatchTask(task,task.current_stage,{singletonSuffix:`stale-recovery:${bucket}`});
      this.audit('AUTO_EVIDENCE_STALE_STAGE_REDISPATCHED',{
        task_id:task.id,company_id:task.company_id,product_profile:task.product_profile,
        stage:task.current_stage,strategy_attempt_number:task.strategy_attempt_count
      });
      results.push({status:'STALE_STAGE_REDISPATCHED',task_id:task.id,dispatch});
    }
    const remainingAfterStale=Math.max(0,remainingAfterCapacity-staleRunning.length);
    const dueRetries=typeof this.repository.selectDueFairnessRetries==='function'
      ?await this.repository.selectDueFairnessRetries({...selectionOptions,limit:remainingAfterStale}):[];
    for(const task of dueRetries){
      const nextAttemptNumber=Number(task.strategy_attempt_count||0)+1;
      const dispatch=await this.dispatchTask(task,'DISCOVERING_SOURCES',{
        singletonSuffix:`fairness:${bucket}`,attemptNumberOverride:nextAttemptNumber
      });
      this.audit('AUTO_EVIDENCE_FAIRNESS_RESUMED',{
        task_id:task.id,company_id:task.company_id,product_profile:task.product_profile,
        strategy_attempt_number:nextAttemptNumber
      });
      results.push({status:'FAIRNESS_RESUMED',task_id:task.id,dispatch});
    }
    const candidates = await this.repository.selectCandidates({
      ...selectionOptions,limit:Math.max(0,remainingAfterStale-dueRetries.length)
    });
    for (const candidate of candidates) {
      results.push(await this.scheduleEvent({
        ...candidate,
        schedule_source: upper(input.schedule_source || 'RECONCILIATION'),
        reconcile_bucket: bucket
      }));
    }
    return {
      status: results.some(item=>item.status==='CAPACITY_RECOVERY_ERROR')?'PARTIAL':'COMPLETED', enabled: true,
      scanned:candidates.length+dueRetries.length+staleRunning.length+capacityWaits.length+pendingResumeDispatches.length,
      repaired:pendingResumeDispatches.length,resumed:results.filter(item=>item.status==='CAPACITY_RECOVERED').length,
      errors:results.filter(item=>item.status==='CAPACITY_RECOVERY_ERROR').length,
      selected: candidates.length+dueRetries.length+staleRunning.length+capacityWaits.length+pendingResumeDispatches.length,
      targeted_companies:companyIds.length,
      scheduled: results.filter(item => item.status === 'SCHEDULED').length,
      provider_capacity_resumed:results.filter(item=>item.status==='CAPACITY_RECOVERED').length,
      capacity_recovery_redispatched:results.filter(item=>item.status==='CAPACITY_RECOVERY_REDISPATCHED').length,
      capacity_recovery_errors:results.filter(item=>item.status==='CAPACITY_RECOVERY_ERROR').length,
      fairness_resumed:results.filter(item=>item.status==='FAIRNESS_RESUMED').length,
      stale_stage_redispatched:results.filter(item=>item.status==='STALE_STAGE_REDISPATCHED').length,
      projection_rebuilt:projectionRepairs.length,
      projection_repairs:projectionRepairs,
      deduplicated: results.filter(item => item.status === 'DEDUPLICATED').length,
      results
    };
  }

  async runControlledBatch(input = {}, context = {}) {
    const trustedManagement = context.trusted_management === true;
    const operatorRole = upper(context.operator_role);
    const operatorIdentity = String(context.operator_identity || '').trim();
    const approvalReference = String(context.approval_reference || '').trim().slice(0, 160);
    if (!this.config.operatorOverrideEnabled || !trustedManagement
      || !['MANAGEMENT', 'DATA_ADMIN'].includes(operatorRole) || !operatorIdentity || !approvalReference) {
      const error = new Error('Controlled auto-evidence batch gate is closed');
      error.code = 'AUTO_EVIDENCE_CONTROLLED_BATCH_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    if (input.resume_task_id) {
      const resumeDigest=digest({task_id:String(input.resume_task_id),operator_identity:operatorIdentity,
        operator_role:operatorRole,approval_reference:approvalReference});
      const resumed = await this.repository.resumeProviderCapacityWait(input.resume_task_id,{
        scheduleKey:`auto-evidence:provider-capacity-recovery:${resumeDigest}`,
        operatorIdentity,operatorRole,approvalReference,scheduleSource:'MANUAL_RETRY'
      });
      const persistedOverride=resumed.resumed||await this.repository.hasControlledOverride(resumed.task.id);
      const outcome = persistedOverride&&resumed.task.task_status==='RETRY_SCHEDULED'
        ? await this.dispatchCapacityRecovery(resumed)
        : {dispatch:null,error:null};
      const dispatch=outcome.dispatch;
      this.audit('AUTO_EVIDENCE_PROVIDER_CAPACITY_RECOVERY', {
        operator_identity: operatorIdentity, operator_role: operatorRole,
        approval_reference: approvalReference, task_id: resumed.task.id, resumed: resumed.resumed
      });
      return {
        status: dispatch ? 'PROVIDER_CAPACITY_RECOVERY_QUEUED' : resumed.task.task_status,
        enabled: this.config.enabled, operator_override: true,
        task_id: resumed.task.id, stage: resumed.task.current_stage,
        attempt_number: resumed.task.strategy_attempt_count??resumed.task.attempt_count,
        schedule_event_id:resumed.schedule_event_id||null,
        continuation_research_job_id:resumed.continuation_research_job_id||null,
        resume_outbox_id:resumed.resume_outbox_id||null,dispatch,error:outcome.error
      };
    }
    const limit = boundedInt(input.batch_size, { min: 1, max: this.config.batchSize, fallback: this.config.batchSize });
    const candidates = await this.repository.selectCandidates({
      limit,
      marketCodes: Array.isArray(input.market_codes) ? input.market_codes : [],
      productProfiles: Array.isArray(input.product_profiles) ? input.product_profiles : [],
      companyIds: Array.isArray(input.company_ids) ? input.company_ids : [],
      sourceTtlDays:this.config.sourceTtlDays
    });
    const bucket = digest({ approval_reference: approvalReference, operator_identity: operatorIdentity,
      requested_at: input.requested_at || this.now().toISOString() });
    const results = [];
    for (const candidate of candidates) {
      results.push(await this.scheduleControlledCandidate(candidate, { source: 'MANUAL_RETRY', bucket,
        operatorIdentity,operatorRole,approvalReference }));
    }
    this.audit('AUTO_EVIDENCE_CONTROLLED_BATCH', {
      operator_identity: operatorIdentity,
      operator_role: operatorRole,
      approval_reference: approvalReference,
      selected: candidates.length,
      scheduled: results.filter(item => item.status === 'SCHEDULED').length
    });
    return {
      status: 'CONTROLLED_BATCH_QUEUED', enabled: this.config.enabled,
      operator_override: true, selected: candidates.length,
      scheduled: results.filter(item => item.status === 'SCHEDULED').length,
      results
    };
  }

  async advance(task, stage, outcome, { retryAt = null } = {}) {
    if (['COMPLETED','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE','EVIDENCE_EXHAUSTED'].includes(outcome)) {
      const nextStage=task.current_strategy_code?strategyNextStage(task.current_strategy_code,stage,task):STAGE_NEXT[stage];
      if(nextStage)return {status:'RUNNING',task,dispatch:await this.dispatchTask(task,nextStage)};
      if(typeof this.repository.blockerState!=='function'){
        const completed=await this.repository.completeTask(task.id,null);
        return {status:'COMPLETED',task:completed,dispatch:null};
      }
      const blocker=await this.repository.blockerState(task.id);
      if(blocker.hard_stop){
        const stopped=await this.repository.stopIneligible(task.id,blocker.reason);
        return {status:'CANCELLED',task:stopped,dispatch:null};
      }
      if(blocker.responsibility_conflict){
        await this.repository.openException(task,{exceptionType:'BUYER_RESPONSIBILITY_CONFLICT',
          technicalBlocker:'BUYER_RESPONSIBILITY_CONFLICT',inputDigest:task.input_digest});
        return {status:'HUMAN_REVIEW_REQUIRED',task:await this.repository.getTask(task.id),dispatch:null};
      }
      if(blocker.resolved){
        const completed=await this.repository.completeTask(task.id,null);
        return {status:'COMPLETED',task:completed,dispatch:null};
      }
      const state=outcome==='NEW_EVIDENCE_FOUND'?'NEW_EVIDENCE_FOUND':'NO_NEW_EVIDENCE';
      let nextTask;
      if(typeof this.repository.advanceToNextStrategy==='function'){
        nextTask=await this.repository.advanceToNextStrategy(task.id,{state});
      }else{
        await this.repository.closeCurrentStrategy(task.id,{state});
        nextTask=await this.repository.prepareNextStrategy(task.id);
      }
      if(nextTask?.strategies_exhausted){
        const exhausted=await this.repository.markExhausted(task.id);
        return {status:'EVIDENCE_EXHAUSTED',task:exhausted,dispatch:null};
      }
      const nextStartStage=strategyStartStage(nextTask?.strategy||nextTask?.current_strategy_code,nextTask);
      if(!nextTask||!nextStartStage){
        return {status:'DISPATCH_ERROR',task:nextTask||task,dispatch:null,technical_blocker:'NEXT_STRATEGY_MISSING'};
      }
      try{
        const dispatch=await this.dispatchTask(nextTask,nextStartStage);
        return {status:'AUTOMATICALLY_QUEUED',task:nextTask,dispatch,
          queued_at:nextTask.queued_at||this.now(),expected_worker_status:'QUEUED_OR_ACTIVE'};
      }catch(error){
        const due=new Date(this.now().getTime()+Math.min(60,this.config.retryBaseSeconds)*1000);
        const waiting=await this.repository.updateTaskOutcome(task.id,{status:'RETRY_SCHEDULED',
          technicalBlocker:'QUEUE_DISPATCH_FAILED',retryAt:due,budgetState:task.budget_state});
        return {status:'DISPATCH_ERROR',task:waiting,dispatch:null,retry_at:due,
          technical_blocker:cleanCode(error?.code||'QUEUE_DISPATCH_FAILED')};
      }
    }
    if (outcome === 'PROVIDER_CAPACITY_WAIT' || outcome === 'BUDGET_PAUSED') {
      return { status: 'PROVIDER_CAPACITY_WAIT', task: await this.repository.updateTaskOutcome(task.id, {
        status: 'PROVIDER_CAPACITY_WAIT', technicalBlocker: 'PROVIDER_CREDIT_EXHAUSTED', budgetState: 'NOT_REQUIRED'
      }), dispatch: null };
    }
    if (outcome === 'HUMAN_REVIEW_REQUIRED' || outcome === 'PERMANENT_ERROR') {
      const technicalBlocker = outcome === 'PERMANENT_ERROR' ? 'AUTO_EVIDENCE_PERMANENT_ERROR' : 'EVIDENCE_CONFLICT';
      await this.repository.openException(task, {
        exceptionType: technicalBlocker,
        technicalBlocker,
        inputDigest: task.input_digest
      });
      return { status: 'HUMAN_REVIEW_REQUIRED', task: await this.repository.getTask(task.id), dispatch: null };
    }
    const providerRetry=Number(task.provider_retry_count||0)+1;
    const delaySeconds = Math.min(86400, this.config.retryBaseSeconds * (2 ** Math.max(0, providerRetry - 1)));
    const due = retryAt || new Date(this.now().getTime() + delaySeconds * 1000);
    if(typeof this.repository.incrementProviderRetry==='function')await this.repository.incrementProviderRetry(task.id);
    const updated = await this.repository.updateTaskOutcome(task.id, {
      status: 'RETRY_SCHEDULED', technicalBlocker: 'TEMPORARY_PROVIDER_ERROR', retryAt: due, budgetState: task.budget_state
    });
    return { status: 'RETRY_SCHEDULED', task: updated, dispatch: await this.dispatchTask(updated, stage, { startAfter: due }) };
  }

  async runStage(stage, payload = {}) {
    if (!AUTO_EVIDENCE_STAGES.includes(stage) || !STAGE_EXECUTOR[stage]) {
      throw Object.assign(new Error('Invalid auto-evidence stage'), { code: 'AUTO_EVIDENCE_STAGE_INVALID' });
    }
    let task = await this.repository.getTask(payload.task_id);
    if (!task) throw Object.assign(new Error('Auto-evidence task not found'), { code: 'AUTO_EVIDENCE_TASK_NOT_FOUND' });
    if (!this.config.enabled && !(await this.repository.hasControlledOverride(task.id))) {
      return { status: 'DISABLED', enabled: false };
    }
    if (payload.execution_key && payload.execution_key !== task.execution_key) {
      throw Object.assign(new Error('Auto-evidence execution key mismatch'), { code: 'AUTO_EVIDENCE_EXECUTION_MISMATCH' });
    }
    if (TERMINAL_TASK_STATES.has(task.task_status)) return { status: task.task_status, idempotent_replay: true, task_id: task.id };
    if(this.providerAccountState&&['DISCOVERING_SOURCES','FINDING_BUYER'].includes(stage)){
      try{await this.providerAccountState.ensureCanCreate();}
      catch(error){
        if(error?.code!=='TAVILY_ACCOUNT_CREDITS_EXHAUSTED')throw error;
        const waiting=await this.repository.updateTaskOutcome(task.id,{status:'PROVIDER_CAPACITY_WAIT',
          technicalBlocker:'PROVIDER_CREDIT_EXHAUSTED',budgetState:'NOT_REQUIRED'});
        return{status:'PROVIDER_CAPACITY_WAIT',task:waiting,task_id:task.id,dispatch:null};
      }
    }
    if(typeof this.repository.blockerState==='function'){
      const blocker=await this.repository.blockerState(task.id);
      if(blocker.hard_stop){
        const stopped=await this.repository.stopIneligible(task.id,blocker.reason);
        return {status:'CANCELLED',task:stopped,task_id:task.id};
      }
      if(blocker.resolved){
        const completed=await this.repository.completeTask(task.id,null);
        return {status:'COMPLETED',task:completed,task_id:task.id};
      }
      if(blocker.responsibility_conflict){
        await this.repository.openException(task,{exceptionType:'BUYER_RESPONSIBILITY_CONFLICT',
          technicalBlocker:'BUYER_RESPONSIBILITY_CONFLICT',inputDigest:task.input_digest});
        return {status:'HUMAN_REVIEW_REQUIRED',task_id:task.id};
      }
    }
    if(typeof this.repository.prepareNextStrategy==='function'){
      task=await this.repository.prepareNextStrategy(task.id);
      if(task?.strategies_exhausted){
        const exhausted=await this.repository.markExhausted(task.id);
        return {status:'EVIDENCE_EXHAUSTED',task:exhausted,task_id:task.id};
      }
      const expectedStage=strategyStartStage(task.strategy||task.current_strategy_code,task);
      if(expectedStage&&task.current_stage===expectedStage&&stage!==expectedStage){
        const expectedSettled=await this.repository.getSettledAttempt(task.id,
          Math.max(1,Number(task.strategy_attempt_count??task.attempt_count??0)),expectedStage,
          Number(task.provider_retry_count||0),Number(task.worker_retry_count||0),
          Number(task.checkpoint_replay_count||0));
        if(!expectedSettled)return {status:'STRATEGY_REDIRECTED',task_id:task.id,deferred:true,
          dispatch:await this.dispatchTask(task,expectedStage)};
      }
    }
    const attemptNumber = Math.max(1, Number(task.strategy_attempt_count ?? task.attempt_count ?? 0));
    const dispatchedAttempt = payload.attempt_number == null
      ? attemptNumber
      : Math.max(1, Number(payload.attempt_number || 0));
    if (dispatchedAttempt < attemptNumber) {
      return { status: 'STALE_ATTEMPT', idempotent_replay: true, task_id: task.id };
    }
    if (dispatchedAttempt > attemptNumber) {
      return { status: task.task_status, task_id: task.id, deferred: true };
    }
    if(payload.strategy_code&&task.current_strategy_code&&payload.strategy_code!==task.current_strategy_code){
      return {status:'STALE_STRATEGY',idempotent_replay:true,task_id:task.id};
    }
    const settled = await this.repository.getSettledAttempt(task.id,attemptNumber,stage,
      Number(task.provider_retry_count||0),Number(task.worker_retry_count||0),Number(task.checkpoint_replay_count||0));
    if (settled) {
      const advanced = await this.advance(task, stage, settled.outcome_status, { retryAt: settled.retry_at });
      return { ...advanced, idempotent_replay: true, task_id: task.id };
    }
    const inputDigest = digest({
      task_id: task.id, execution_key: task.execution_key, strategy_attempt_number: attemptNumber,
      strategy_code:task.current_strategy_code,query_fingerprint:task.current_query_fingerprint,
      provider_retry_number:Number(task.provider_retry_count||0),worker_retry_number:Number(task.worker_retry_count||0),
      checkpoint_replay_number:Number(task.checkpoint_replay_count||0),
      stage, evidence_revision: task.evidence_revision
    });
    const begun = await this.repository.beginStage(task, stage, inputDigest, { leaseMinutes:this.config.stageLeaseMinutes });
    if (!begun.started) {
      if (begun.retryAt) {
        const recovery=await this.dispatchTask(begun.task||task,stage,{
          startAfter:begun.retryAt,singletonSuffix:'lease-recovery'
        });
        return {status:'STAGE_LEASED',task_id:task.id,deferred:true,retry_at:begun.retryAt,recovery_dispatch:recovery};
      }
      return { status: begun.task?.task_status || 'NOT_RUNNABLE', task_id: task.id, deferred: true };
    }
    const current = begun.task;
    const strategyStart=task.current_strategy_code?strategyStartStage(task.current_strategy_code,task):null;
    const researchKind=stage==='REFRESHING_DECISION'&&strategyStart
      ?(strategyStart==='DISCOVERING_SOURCES'?'CATEGORY':'CONTACT')
      :STAGE_RESEARCH_KIND[stage];
    const researchJob = await this.repository.ensureResearchJob(current, researchKind);
    if(typeof this.repository.markResearchJobRunning==='function')
      await this.repository.markResearchJobRunning(researchJob.id,stage);
    const taskWithLineage = {
      ...current,
      [researchKind === 'CATEGORY' ? 'category_research_job_id' : 'contact_research_job_id']: researchJob.id
    };
    let result = {};
    let outcome = 'COMPLETED';
    let blocker = null;
    try {
      const executor = this.executors[STAGE_EXECUTOR[stage]];
      if (typeof executor !== 'function') {
        const error = new Error(`Auto-evidence executor is not configured for ${stage}`);
        error.code = 'AUTO_EVIDENCE_EXECUTOR_MISSING';
        throw error;
      }
      result = await executor({
        task: taskWithLineage,
        stage,
        attempt_number: taskWithLineage.strategy_attempt_count??taskWithLineage.attempt_count,
        strategy:buildStrategyQuery(taskWithLineage.current_strategy_code,taskWithLineage),
        research_job_id: researchJob.id,
        research_job_type: researchJob.job_type,
        config: this.config
      });
      result = { ...result, research_job_id: result?.research_job_id || researchJob.id };
      outcome = upper(result?.outcome_status || 'COMPLETED');
      if (!SETTLED_OUTCOMES.has(outcome)) throw Object.assign(new Error('Invalid auto-evidence executor outcome'), { code: 'AUTO_EVIDENCE_OUTCOME_INVALID' });
      blocker = result?.technical_blocker ? cleanCode(result.technical_blocker, 'AUTO_EVIDENCE_STAGE_FAILED') : null;
    } catch (error) {
      result = { error_code: safeTechnicalBlocker(error), research_job_id: researchJob.id };
      blocker = safeTechnicalBlocker(error);
      if(error?.code==='PROVIDER_CREDIT_EXHAUSTED')outcome='PROVIDER_CAPACITY_WAIT';
      else outcome = retryableError(error) ? 'TEMPORARY_ERROR' : 'PERMANENT_ERROR';
      if(error?.retryAfterAt)result.retry_at=error.retryAfterAt;
    }
    const outputDigest = digest({ outcome, blocker, research_job_id: result.research_job_id || null, ...referenceValues(result) });
    if (!result.research_job_id) {
      outcome = 'PERMANENT_ERROR';
      blocker = 'RESEARCH_JOB_LINEAGE_REQUIRED';
    }
    await this.repository.settleStage(taskWithLineage, stage, outcome, result, inputDigest, outputDigest, blocker, result?.retry_at || null);
    if(typeof this.repository.markResearchJobSettled==='function')
      await this.repository.markResearchJobSettled(researchJob.id,outcome,blocker);
    if (stage === 'DISCOVERING_SOURCES' && ['COMPLETED','NEW_EVIDENCE_FOUND','NO_NEW_EVIDENCE'].includes(outcome)) {
      await this.repository.recordBundledStage(taskWithLineage, 'CRAWLING', result, inputDigest, outputDigest);
      await this.repository.recordBundledStage(taskWithLineage, 'EXTRACTING', result, inputDigest, outputDigest);
    }
    const advanced = await this.advance(taskWithLineage, stage, outcome, { retryAt: result?.retry_at || null });
    this.audit('AUTO_EVIDENCE_STAGE_SETTLED', {
      task_id: current.id,
      company_id: current.company_id,
      product_profile: current.product_profile,
      stage,
      outcome,
      strategy_attempt_number: current.strategy_attempt_count??current.attempt_count,
      provider_retry_number:current.provider_retry_count||0,
      worker_retry_number:current.worker_retry_count||0,
      strategy_code:current.current_strategy_code||null
    });
    return { ...advanced, task_id: current.id, stage, outcome };
  }

  async refreshException(payload = {}) {
    if (!this.config.enabled) return { status: 'DISABLED', enabled: false };
    const task = await this.repository.getTask(payload.task_id);
    if (!task) throw Object.assign(new Error('Auto-evidence task not found'), { code: 'AUTO_EVIDENCE_TASK_NOT_FOUND' });
    if (task.task_status !== 'HUMAN_REVIEW_REQUIRED') return { status: task.task_status, idempotent_replay: true };
    const exception = await this.repository.openException(task, {
      exceptionType: cleanCode(payload.exception_type || task.technical_blocker || 'EVIDENCE_CONFLICT'),
      technicalBlocker: task.technical_blocker,
      inputDigest: task.input_digest
    });
    return { status: 'HUMAN_REVIEW_REQUIRED', exception_id: exception?.id || null };
  }

  async summary() {
    const [summary,tavily_metrics]=await Promise.all([
      this.repository.summary(),this.repository.tavilyMetrics?.()||Promise.resolve(null)
    ]);
    return { ...this.status(), ...summary,tavily_metrics };
  }
  async listTasks(query = {}) { return this.repository.listTasks(query); }
  async listExceptions(query = {}) { return this.repository.listExceptions(query); }
}

export { booleanEnv, boundedInt, digest, cleanCode, retryableError, STAGE_NEXT, STAGE_EXECUTOR };
