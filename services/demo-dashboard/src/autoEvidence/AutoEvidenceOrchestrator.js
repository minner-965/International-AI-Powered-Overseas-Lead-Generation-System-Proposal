import { createHash } from 'node:crypto';
import { PHASE5_QUEUES } from '../jobs/phase5Queue.js';

const PRODUCT_PROFILES = new Set(['WOMENSWEAR', 'GENERAL_MERCHANDISE']);
const SCHEDULE_SOURCES = new Set(['EVENT', 'RECONCILIATION', 'MANUAL_RETRY', 'IMPORT']);
const TERMINAL_TASK_STATES = new Set([
  'EVIDENCE_EXHAUSTED', 'HUMAN_REVIEW_REQUIRED', 'BUDGET_PAUSED', 'COMPLETED', 'CANCELLED'
]);
const SETTLED_OUTCOMES = new Set([
  'COMPLETED', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'EVIDENCE_EXHAUSTED',
  'BUDGET_PAUSED', 'HUMAN_REVIEW_REQUIRED'
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

const upper = value => String(value ?? '').trim().toUpperCase();

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
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
  return Object.freeze({
    enabled: booleanEnv(env.AUTO_EVIDENCE_ENABLED, false),
    reconcileMinutes: boundedInt(env.AUTO_EVIDENCE_RECONCILE_MINUTES, { min: 5, max: 1440, fallback: 30 }),
    batchSize: boundedInt(env.AUTO_EVIDENCE_BATCH_SIZE, { min: 1, max: 100, fallback: 10 }),
    cooldownHours: boundedInt(env.AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS, { min: 1, max: 8760, fallback: 168 }),
    maxAttempts: boundedInt(env.AUTO_EVIDENCE_MAX_ATTEMPTS, { min: 1, max: 20, fallback: 3 }),
    sourceTtlDays: boundedInt(env.AUTO_EVIDENCE_SOURCE_TTL_DAYS, { min: 1, max: 3650, fallback: 90 }),
    stageLeaseMinutes: boundedInt(env.AUTO_EVIDENCE_STAGE_LEASE_MINUTES, { min: 1, max: 1440, fallback: 15 }),
    retryBaseSeconds: boundedInt(env.AUTO_EVIDENCE_RETRY_BASE_SECONDS, { min: 5, max: 86400, fallback: 300 }),
    runBudgetCapUnits: boundedInt(env.MAX_HUNTER_CREDITS_PER_RUN_UNITS, { min: 0, max: 1000000000, fallback: 20000 }),
    hunterEnabled: booleanEnv(env.AUTO_EVIDENCE_HUNTER_ENABLED, true),
    tavilyEnabled: booleanEnv(env.AUTO_EVIDENCE_TAVILY_ENABLED, true),
    operatorOverrideEnabled: booleanEnv(env.AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED, false)
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
      SELECT o.company_id,o.product_profile,c.country_code,
        CASE
          WHEN cpm.match_status IS DISTINCT FROM 'CATEGORY_PROCUREMENT_MATCH' THEN 'CATEGORY_EVIDENCE'
          WHEN bbm.buyer_model NOT IN ('DIRECT_END_BUYER','DISTRIBUTION_BUYER') THEN 'BUYER_MODEL_EVIDENCE'
          WHEN coalesce(dm.named_relevant_buyers,0)=0 THEN 'NAMED_BUYER_EVIDENCE'
          WHEN coalesce(dm.valid_email_routes,0)=0 THEN 'VERIFIED_EMAIL_EVIDENCE'
          ELSE 'DECISION_REFRESH'
        END business_blocker,
        (coalesce(src.source_count,0)+coalesce(dm.evidence_count,0)+coalesce(decision_count.snapshot_count,0))::int evidence_revision,
        CASE
          WHEN cpm.match_status='CATEGORY_PROCUREMENT_MATCH' AND coalesce(dm.named_relevant_buyers,0)=0 THEN 1
          WHEN coalesce(dm.named_relevant_buyers,0)>0 AND coalesce(dm.valid_email_routes,0)=0 THEN 2
          WHEN bbm.buyer_model NOT IN ('DIRECT_END_BUYER','DISTRIBUTION_BUYER') THEN 3
          WHEN cpm.match_status IS DISTINCT FROM 'CATEGORY_PROCUREMENT_MATCH' THEN 4
          ELSE 5
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
            AND prior.product_profile=o.product_profile
            AND prior.business_blocker=(CASE
              WHEN cpm.match_status IS DISTINCT FROM 'CATEGORY_PROCUREMENT_MATCH' THEN 'CATEGORY_EVIDENCE'
              WHEN bbm.buyer_model NOT IN ('DIRECT_END_BUYER','DISTRIBUTION_BUYER') THEN 'BUYER_MODEL_EVIDENCE'
              WHEN coalesce(dm.named_relevant_buyers,0)=0 THEN 'NAMED_BUYER_EVIDENCE'
              WHEN coalesce(dm.valid_email_routes,0)=0 THEN 'VERIFIED_EMAIL_EVIDENCE'
              ELSE 'DECISION_REFRESH' END)
            AND (
              prior.cooldown_until>now()
              OR prior.task_status IN ('HUMAN_REVIEW_REQUIRED','BUDGET_PAUSED')
              OR (
                prior.evidence_revision=(coalesce(src.source_count,0)+coalesce(dm.evidence_count,0)+coalesce(decision_count.snapshot_count,0))::int
                AND prior.task_status IN ('EVIDENCE_EXHAUSTED','COMPLETED','CANCELLED')
              )
            )
        )
    )
    SELECT * FROM candidates ORDER BY priority,company_id,product_profile LIMIT $1`, [
      limit, markets, profiles, boundedInt(sourceTtlDays,{min:1,max:3650,fallback:90}),companies
    ]);
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

  async schedule(candidate, { source, scheduleKey, maxAttempts, inputDigest,
    operatorIdentity = null, operatorRole = null, approvalReference = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cooling = await client.query(`SELECT * FROM leadgen.auto_evidence_tasks
        WHERE company_id=$1 AND product_profile=$2 AND cooldown_until>now()
        ORDER BY cooldown_until DESC,created_at DESC,id DESC LIMIT 1 FOR SHARE`, [
        candidate.company_id, candidate.product_profile
      ]);
      if (cooling.rowCount) {
        const task = cooling.rows[0];
        const event = await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
          (schedule_source,schedule_key,task_id,company_id,product_profile,business_blocker,evidence_revision,
           outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'SKIPPED_COOLDOWN',$8,$9,$10,$11,now())
          ON CONFLICT (schedule_key) DO NOTHING RETURNING id`, [source, scheduleKey, task.id,
          candidate.company_id, candidate.product_profile, candidate.business_blocker,
          candidate.evidence_revision, inputDigest,operatorIdentity,operatorRole,approvalReference]);
        await client.query('COMMIT');
        return { task, outcome: 'SKIPPED_COOLDOWN', replay: !event.rowCount, dispatch_required: false };
      }
      const executionKey = `auto-evidence:v1:${digest({
        company_id: candidate.company_id,
        product_profile: candidate.product_profile,
        business_blocker: candidate.business_blocker,
        evidence_revision: candidate.evidence_revision
      })}`;
      const inserted = await client.query(`INSERT INTO leadgen.auto_evidence_tasks
        (company_id,product_profile,business_blocker,evidence_revision,execution_key,task_status,
         automation_owner,max_attempts,budget_state,last_evidence_revision,input_digest)
        VALUES ($1,$2,$3,$4,$5,'QUEUED','SYSTEM',$6,'AVAILABLE',$4,$7)
        ON CONFLICT (company_id,product_profile,business_blocker,evidence_revision) DO NOTHING RETURNING *`, [
        candidate.company_id, candidate.product_profile, candidate.business_blocker,
        candidate.evidence_revision, executionKey, maxAttempts, inputDigest
      ]);
      const task = inserted.rows[0] || (await client.query(`SELECT * FROM leadgen.auto_evidence_tasks
        WHERE company_id=$1 AND product_profile=$2 AND business_blocker=$3 AND evidence_revision=$4`, [
        candidate.company_id, candidate.product_profile, candidate.business_blocker, candidate.evidence_revision
      ])).rows[0];
      let outcome = inserted.rowCount ? 'SCHEDULED' : 'DEDUPLICATED';
      if (!inserted.rowCount && task?.cooldown_until && new Date(task.cooldown_until) > new Date()) outcome = 'SKIPPED_COOLDOWN';
      else if (task?.task_status === 'BUDGET_PAUSED') outcome = 'BUDGET_PAUSED';
      else if (task?.task_status === 'HUMAN_REVIEW_REQUIRED') outcome = 'HUMAN_REVIEW_REQUIRED';
      const event = await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
        (schedule_source,schedule_key,task_id,company_id,product_profile,business_blocker,evidence_revision,
         outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (schedule_key) DO NOTHING RETURNING id`, [source, scheduleKey, task?.id || null,
        candidate.company_id, candidate.product_profile, candidate.business_blocker,
        candidate.evidence_revision, outcome, inputDigest,operatorIdentity,operatorRole,approvalReference]);
      await client.query('COMMIT');
      return {
        task,
        outcome,
        replay: !event.rowCount,
        dispatch_required: outcome === 'SCHEDULED'
          || (outcome === 'DEDUPLICATED' && task?.task_status === 'QUEUED' && Number(task?.attempt_count || 0) === 0)
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(taskId) {
    const result = await this.pool.query('SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1', [taskId]);
    return result.rows[0] || null;
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

  async resumeBudgetPaused(taskId,{scheduleKey,operatorIdentity,operatorRole,approvalReference}={}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE`, [taskId]);
      const task = locked.rows[0];
      if (!task) throw Object.assign(new Error('Auto-evidence task not found'), { code: 'AUTO_EVIDENCE_TASK_NOT_FOUND' });
      if (task.task_status !== 'BUDGET_PAUSED') {
        await client.query('COMMIT');
        return { task, resumed: false };
      }
      if (Number(task.attempt_count || 0) >= Number(task.max_attempts || 0)) {
        const error = new Error('Auto-evidence attempts are exhausted');
        error.code = 'AUTO_EVIDENCE_ATTEMPTS_EXHAUSTED';
        error.status = 409;
        throw error;
      }
      const updated = await client.query(`UPDATE leadgen.auto_evidence_tasks
        SET task_status='RETRY_SCHEDULED',budget_state='AVAILABLE',technical_blocker=NULL,retry_at=now(),
          attempt_count=attempt_count+1,updated_at=now()
        WHERE id=$1 RETURNING *`, [taskId]);
      const resumedTask=updated.rows[0];
      const event=await client.query(`INSERT INTO leadgen.auto_evidence_schedule_events
        (schedule_source,schedule_key,task_id,company_id,product_profile,business_blocker,evidence_revision,
         outcome,input_digest,operator_identity,operator_role,approval_reference,occurred_at)
        VALUES ('MANUAL_RETRY',$1,$2,$3,$4,$5,$6,'SCHEDULED',$7,$8,$9,$10,now())
        ON CONFLICT (schedule_key) DO NOTHING RETURNING id`,[
        scheduleKey,resumedTask.id,resumedTask.company_id,resumedTask.product_profile,resumedTask.business_blocker,
        resumedTask.evidence_revision,resumedTask.input_digest,operatorIdentity,operatorRole,approvalReference
      ]);
      if(!event.rowCount)throw Object.assign(new Error('Controlled budget resume audit was not appended'),{
        code:'AUTO_EVIDENCE_CONTROLLED_AUDIT_REQUIRED',status:409
      });
      const researchJobId=['DISCOVERING_SOURCES','CRAWLING','EXTRACTING','NORMALIZING_CATEGORY','VALIDATING_EVIDENCE']
        .includes(resumedTask.current_stage) ? resumedTask.category_research_job_id : resumedTask.contact_research_job_id;
      if(researchJobId){
        await client.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),
          last_error='Budget resume requested from the persisted auto-evidence checkpoint',stop_reason_code=NULL
          WHERE id=$1 AND status IN ('PARTIAL','COMPLETE','COMPLETED','PERSISTING','FAILED')`,[researchJobId]);
      }
      await client.query('COMMIT');
      return { task: resumedTask, resumed: true, schedule_event_id:event.rows[0].id };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureResearchJob(task, kind, { runBudgetCapUnits = 0 } = {}) {
    const normalizedKind = upper(kind);
    const column = normalizedKind === 'CATEGORY' ? 'category_research_job_id' : 'contact_research_job_id';
    const jobType = normalizedKind === 'CATEGORY' ? 'CATEGORY_PROCUREMENT_ENRICHMENT' : 'DECISION_MAKER_ENRICHMENT';
    if (task[column]) return { id: task[column], job_type: jobType, replay: true };
    const idempotencyKey = `auto-evidence:${task.execution_key}:${normalizedKind.toLowerCase()}`.slice(0, 200);
    const requestDigest = digest({
      task_id: task.id,
      company_id: task.company_id,
      product_profile: task.product_profile,
      evidence_revision: task.evidence_revision,
      job_type: jobType
    });
    const result = await this.pool.query(`INSERT INTO leadgen.research_jobs
      (country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
       buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,
       idempotency_key,request_digest,created_by_identity,created_by_role,run_budget_cap_units)
      SELECT c.country_code,c.country_code,c.country_code,'en','AUTO_EVIDENCE',
        'Opportunity evidence',t.product_profile,
        ARRAY['Buyer','Procurement','Purchasing','Category','Merchandising','Sourcing']::text[],
        1,'QUEUED',$2,ARRAY[c.country_code]::text[],ARRAY[t.product_profile]::text[],ARRAY[t.company_id]::uuid[],
        $3,$4,'phase10-auto-evidence','SYSTEM',$5
      FROM leadgen.auto_evidence_tasks t JOIN leadgen.companies c ON c.id=t.company_id
      WHERE t.id=$1
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [
      task.id, jobType, idempotencyKey, requestDigest, runBudgetCapUnits
    ]);
    const job = result.rows[0];
    if (!job) throw Object.assign(new Error('Auto-evidence research job could not be created'), { code: 'AUTO_EVIDENCE_RESEARCH_JOB_CREATE_FAILED' });
    await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET ${column}=$2,updated_at=now()
      WHERE id=$1 AND (${column} IS NULL OR ${column}=$2)`, [task.id, job.id]);
    return { ...job, replay: false };
  }

  async getSettledAttempt(taskId, attemptNumber, stage) {
    const result = await this.pool.query(`SELECT * FROM leadgen.auto_evidence_task_attempts
      WHERE task_id=$1 AND attempt_number=$2 AND stage=$3 AND event_type='SETTLED'`, [taskId, attemptNumber, stage]);
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
      const attemptNumber = Math.max(1, Number(current.attempt_count || 0));
      const events = await client.query(`SELECT event_type,occurred_at FROM leadgen.auto_evidence_task_attempts
        WHERE task_id=$1 AND attempt_number=$2 AND stage=$3 AND event_type IN ('STARTED','SETTLED')
        ORDER BY occurred_at DESC`, [current.id, attemptNumber, stage]);
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
      if (!started) {
        await client.query(`INSERT INTO leadgen.auto_evidence_task_attempts
          (task_id,company_id,attempt_number,stage,event_type,outcome_status,input_digest,idempotency_key,occurred_at)
          VALUES ($1,$2,$3,$4,'STARTED',NULL,$5,$6,now())`, [
          current.id, current.company_id, attemptNumber, stage, inputDigest,
          `auto-evidence:${current.id}:${attemptNumber}:${stage}:started`
        ]);
      }
      const updated = await client.query(`UPDATE leadgen.auto_evidence_tasks SET
        task_status='RUNNING',current_stage=$2,attempt_count=greatest(attempt_count,1),
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
       idempotency_key,occurred_at)
      VALUES ($1,$2,$3,$4,'SETTLED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
      ON CONFLICT (idempotency_key) DO NOTHING`, [
      task.id, task.company_id, task.attempt_count, stage, outcome, result.research_job_id || null,
      refs.provider_usage_event_id, refs.prospect_category_source_id, refs.prospect_category_observation_id,
      refs.buyer_business_model_result_id, refs.category_procurement_match_result_id,
      refs.product_opportunity_result_id, refs.cooperation_feasibility_result_id,
      refs.decision_maker_id, refs.decision_maker_contact_id, refs.contact_verification_event_id,
      refs.business_opportunity_decision_snapshot_id, technicalBlocker, retryAt, inputDigest, outputDigest,
      `auto-evidence:${task.id}:${task.attempt_count}:${stage}:settled`
    ]);
  }

  async recordBundledStage(task, stage, result, inputDigest, outputDigest) {
    const startedKey = `auto-evidence:${task.id}:${task.attempt_count}:${stage}:started`;
    await this.pool.query(`INSERT INTO leadgen.auto_evidence_task_attempts
      (task_id,company_id,attempt_number,stage,event_type,outcome_status,input_digest,idempotency_key,occurred_at)
      VALUES ($1,$2,$3,$4,'STARTED',NULL,$5,$6,now()) ON CONFLICT (idempotency_key) DO NOTHING`, [
      task.id, task.company_id, task.attempt_count, stage, inputDigest, startedKey
    ]);
    await this.settleStage(task, stage, 'COMPLETED', result, inputDigest, outputDigest);
  }

  async completeTask(taskId, cooldownUntil) {
    const result = await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='COMPLETED',
      current_stage='REFRESHING_DECISION',technical_blocker=NULL,retry_at=NULL,cooldown_until=$2,
      completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [taskId, cooldownUntil]);
    return result.rows[0];
  }

  async updateTaskOutcome(taskId, { status, technicalBlocker = null, retryAt = null,
    budgetState = 'AVAILABLE', cooldownUntil = null, completed = false } = {}) {
    const result = await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status=$2,
      technical_blocker=$3,retry_at=$4,budget_state=$5,
      attempt_count=CASE WHEN $2='RETRY_SCHEDULED' THEN least(max_attempts,attempt_count+1) ELSE attempt_count END,
      cooldown_until=coalesce($6,cooldown_until),completed_at=CASE WHEN $7 THEN now() ELSE NULL END,updated_at=now()
      WHERE id=$1 RETURNING *`, [
      taskId, status, technicalBlocker, retryAt, budgetState, cooldownUntil, completed
    ]);
    return result.rows[0];
  }

  async openException(task, { exceptionType, technicalBlocker, inputDigest } = {}) {
    const exceptionKey = `auto-evidence:exception:${task.id}:${exceptionType}`;
    const idempotencyKey = `${exceptionKey}:opened:${task.attempt_count}`;
    const result = await this.pool.query(`INSERT INTO leadgen.human_evidence_exceptions
      (task_id,company_id,product_profile,exception_key,event_type,exception_type,business_blocker,
       input_digest,idempotency_key,occurred_at)
      VALUES ($1,$2,$3,$4,'OPENED',$5,$6,$7,$8,now()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`, [
      task.id, task.company_id, task.product_profile, exceptionKey, exceptionType,
      task.business_blocker, inputDigest, idempotencyKey
    ]);
    await this.pool.query(`UPDATE leadgen.auto_evidence_tasks SET task_status='HUMAN_REVIEW_REQUIRED',
      technical_blocker=$2,retry_at=NULL,updated_at=now() WHERE id=$1`, [task.id, technicalBlocker]);
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

  async listTasks({ limit = 50 } = {}) {
    const result = await this.pool.query(`SELECT t.id,t.company_id,c.company_name,c.country_code market,t.product_profile,
      t.business_blocker,t.evidence_revision,t.task_status,t.current_stage,t.automation_owner,t.human_owner,
      t.technical_blocker,t.attempt_count,t.max_attempts,t.budget_state,t.retry_at,t.cooldown_until,
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
  constructor({ pool, queue, repository = null, executors = {}, env = process.env, audit = () => {}, now = () => new Date() } = {}) {
    if (!queue?.enqueue) throw new TypeError('AutoEvidenceOrchestrator requires a queue');
    this.repository = repository || new AutoEvidenceRepository({ pool });
    this.queue = queue;
    this.executors = executors;
    this.config = autoEvidenceConfig(env);
    this.audit = audit;
    this.now = now;
  }

  status() {
    return { enabled: this.config.enabled, activation_required: !this.config.enabled, outbound_allowed: false, ...this.config };
  }

  async dispatchTask(task, stage = 'DISCOVERING_SOURCES', { startAfter = null, singletonSuffix = '' } = {}) {
    const queueName = STAGE_QUEUE[stage];
    if (!queueName) throw Object.assign(new Error(`No auto-evidence queue for stage ${stage}`), { code: 'AUTO_EVIDENCE_STAGE_INVALID' });
    const attemptNumber = Math.max(1, Number(task.attempt_count || 0));
    const singletonKey = `auto-evidence:${task.execution_key}:${attemptNumber}:${stage}${singletonSuffix?`:${singletonSuffix}`:''}`;
    const queueJobId = await this.queue.enqueue(queueName, {
      task_id: task.id,
      execution_key: task.execution_key,
      attempt_number: attemptNumber,
      stage
    }, { singletonKey, startAfter });
    return { queue: queueName, queue_job_id: queueJobId };
  }

  async scheduleEvent(input = {}) {
    if (!this.config.enabled) return { status: 'DISABLED', enabled: false, scheduled: 0 };
    const source = upper(input.schedule_source || 'EVENT');
    if (!SCHEDULE_SOURCES.has(source)) throw Object.assign(new Error('Invalid auto-evidence schedule source'), { code: 'AUTO_EVIDENCE_SOURCE_INVALID' });
    const productProfile = upper(input.product_profile);
    if (!PRODUCT_PROFILES.has(productProfile)) throw Object.assign(new Error('Invalid auto-evidence product profile'), { code: 'AUTO_EVIDENCE_PROFILE_INVALID' });
    const candidate = {
      company_id: String(input.company_id || '').trim(),
      product_profile: productProfile,
      business_blocker: cleanCode(input.business_blocker),
      evidence_revision: boundedInt(input.evidence_revision, { min: 0, max: 2147483647, fallback: 0 })
    };
    if (!candidate.company_id) throw Object.assign(new Error('Auto-evidence company is required'), { code: 'AUTO_EVIDENCE_COMPANY_REQUIRED' });
    const inputDigest = digest(candidate);
    const scheduleKey = String(input.schedule_key || `auto-evidence:schedule:${digest({ source, event: input.event_id || input.reconcile_bucket || '', ...candidate })}`).slice(0, 240);
    const scheduled = await this.repository.schedule(candidate, {
      source,
      scheduleKey,
      maxAttempts: this.config.maxAttempts,
      inputDigest
    });
    let dispatch = null;
    if (scheduled.dispatch_required) dispatch = await this.dispatchTask(scheduled.task);
    this.audit('AUTO_EVIDENCE_SCHEDULED', {
      task_id: scheduled.task?.id || null,
      company_id: candidate.company_id,
      product_profile: candidate.product_profile,
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
      maxAttempts: this.config.maxAttempts,
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
      return {status:'RECONCILED',enabled:true,selected:0,targeted_companies:0,scheduled:0,
        deduplicated:0,skipped_cooldown:0,target_resolution:'EMPTY',results:[]};
    }
    const candidates = await this.repository.selectCandidates({
      limit,
      marketCodes: Array.isArray(input.market_codes) ? input.market_codes : [],
      productProfiles: Array.isArray(input.product_profiles) ? input.product_profiles : [],
      companyIds,
      sourceTtlDays:this.config.sourceTtlDays
    });
    const bucket = String(input.reconcile_bucket || Math.floor(this.now().getTime() / (this.config.reconcileMinutes * 60000)));
    const results = [];
    for (const candidate of candidates) {
      results.push(await this.scheduleEvent({
        ...candidate,
        schedule_source: upper(input.schedule_source || 'RECONCILIATION'),
        reconcile_bucket: bucket
      }));
    }
    return {
      status: 'RECONCILED', enabled: true, selected: candidates.length,
      targeted_companies:companyIds.length,
      scheduled: results.filter(item => item.status === 'SCHEDULED').length,
      deduplicated: results.filter(item => item.status === 'DEDUPLICATED').length,
      skipped_cooldown: results.filter(item => item.status === 'SKIPPED_COOLDOWN').length,
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
      const resumed = await this.repository.resumeBudgetPaused(input.resume_task_id,{
        scheduleKey:`auto-evidence:budget-resume:${resumeDigest}`,
        operatorIdentity,operatorRole,approvalReference
      });
      const persistedOverride=resumed.resumed||await this.repository.hasControlledOverride(resumed.task.id);
      const dispatch = persistedOverride&&resumed.task.task_status==='RETRY_SCHEDULED'
        ? await this.dispatchTask(resumed.task, resumed.task.current_stage)
        : null;
      this.audit('AUTO_EVIDENCE_BUDGET_RESUME', {
        operator_identity: operatorIdentity, operator_role: operatorRole,
        approval_reference: approvalReference, task_id: resumed.task.id, resumed: resumed.resumed
      });
      return {
        status: dispatch ? 'BUDGET_RESUME_QUEUED' : resumed.task.task_status,
        enabled: this.config.enabled, operator_override: true,
        task_id: resumed.task.id, stage: resumed.task.current_stage, attempt_number: resumed.task.attempt_count,
        schedule_event_id:resumed.schedule_event_id||null,
        dispatch
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
    if (outcome === 'COMPLETED') {
      const nextStage = STAGE_NEXT[stage];
      if (!nextStage) {
        const cooldownUntil = new Date(this.now().getTime() + this.config.cooldownHours * 3600000);
        const completed = await this.repository.completeTask(task.id, cooldownUntil);
        return { status: 'COMPLETED', task: completed, dispatch: null };
      }
      return { status: 'RUNNING', task, dispatch: await this.dispatchTask(task, nextStage) };
    }
    if (outcome === 'BUDGET_PAUSED') {
      return { status: 'BUDGET_PAUSED', task: await this.repository.updateTaskOutcome(task.id, {
        status: 'BUDGET_PAUSED', technicalBlocker: 'PROVIDER_BUDGET_PAUSED', budgetState: 'PAUSED'
      }), dispatch: null };
    }
    if (outcome === 'EVIDENCE_EXHAUSTED') {
      const cooldownUntil = new Date(this.now().getTime() + this.config.cooldownHours * 3600000);
      return { status: 'EVIDENCE_EXHAUSTED', task: await this.repository.updateTaskOutcome(task.id, {
        status: 'EVIDENCE_EXHAUSTED', technicalBlocker: null, budgetState: 'NOT_REQUIRED',
        cooldownUntil, completed: true
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
    const nextAttempt = Number(task.attempt_count || 1) + 1;
    if (nextAttempt > Number(task.max_attempts || this.config.maxAttempts)) {
      await this.repository.openException(task, {
        exceptionType: 'AUTOMATIC_RETRIES_EXHAUSTED',
        technicalBlocker: 'AUTOMATIC_RETRIES_EXHAUSTED',
        inputDigest: task.input_digest
      });
      return { status: 'HUMAN_REVIEW_REQUIRED', task: await this.repository.getTask(task.id), dispatch: null };
    }
    const delaySeconds = Math.min(86400, this.config.retryBaseSeconds * (2 ** Math.max(0, nextAttempt - 2)));
    const due = retryAt || new Date(this.now().getTime() + delaySeconds * 1000);
    const updated = await this.repository.updateTaskOutcome(task.id, {
      status: 'RETRY_SCHEDULED', technicalBlocker: 'TEMPORARY_PROVIDER_ERROR', retryAt: due, budgetState: task.budget_state
    });
    return { status: 'RETRY_SCHEDULED', task: updated, dispatch: await this.dispatchTask(updated, stage, { startAfter: due }) };
  }

  async runStage(stage, payload = {}) {
    if (!AUTO_EVIDENCE_STAGES.includes(stage) || !STAGE_EXECUTOR[stage]) {
      throw Object.assign(new Error('Invalid auto-evidence stage'), { code: 'AUTO_EVIDENCE_STAGE_INVALID' });
    }
    const task = await this.repository.getTask(payload.task_id);
    if (!task) throw Object.assign(new Error('Auto-evidence task not found'), { code: 'AUTO_EVIDENCE_TASK_NOT_FOUND' });
    if (!this.config.enabled && !(await this.repository.hasControlledOverride(task.id))) {
      return { status: 'DISABLED', enabled: false };
    }
    if (payload.execution_key && payload.execution_key !== task.execution_key) {
      throw Object.assign(new Error('Auto-evidence execution key mismatch'), { code: 'AUTO_EVIDENCE_EXECUTION_MISMATCH' });
    }
    if (TERMINAL_TASK_STATES.has(task.task_status)) return { status: task.task_status, idempotent_replay: true, task_id: task.id };
    const attemptNumber = Math.max(1, Number(task.attempt_count || 0));
    const dispatchedAttempt = payload.attempt_number == null
      ? attemptNumber
      : Math.max(1, Number(payload.attempt_number || 0));
    if (dispatchedAttempt < attemptNumber) {
      return { status: 'STALE_ATTEMPT', idempotent_replay: true, task_id: task.id };
    }
    if (dispatchedAttempt > attemptNumber) {
      return { status: task.task_status, task_id: task.id, deferred: true };
    }
    const settled = await this.repository.getSettledAttempt(task.id, attemptNumber, stage);
    if (settled) {
      const advanced = await this.advance(task, stage, settled.outcome_status, { retryAt: settled.retry_at });
      return { ...advanced, idempotent_replay: true, task_id: task.id };
    }
    const inputDigest = digest({
      task_id: task.id, execution_key: task.execution_key, attempt_number: attemptNumber,
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
    const researchKind = STAGE_RESEARCH_KIND[stage];
    const researchJob = await this.repository.ensureResearchJob(current, researchKind, {
      runBudgetCapUnits: this.config.runBudgetCapUnits
    });
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
        attempt_number: taskWithLineage.attempt_count,
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
      outcome = retryableError(error) ? 'RETRYABLE_ERROR' : 'PERMANENT_ERROR';
    }
    const outputDigest = digest({ outcome, blocker, research_job_id: result.research_job_id || null, ...referenceValues(result) });
    if (!result.research_job_id) {
      outcome = 'PERMANENT_ERROR';
      blocker = 'RESEARCH_JOB_LINEAGE_REQUIRED';
    }
    await this.repository.settleStage(taskWithLineage, stage, outcome, result, inputDigest, outputDigest, blocker, result?.retry_at || null);
    if (stage === 'DISCOVERING_SOURCES' && outcome === 'COMPLETED') {
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
      attempt_number: current.attempt_count
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

  async summary() { return { ...this.status(), ...(await this.repository.summary()) }; }
  async listTasks(query = {}) { return this.repository.listTasks(query); }
  async listExceptions(query = {}) { return this.repository.listExceptions(query); }
}

export { booleanEnv, boundedInt, digest, cleanCode, retryableError, STAGE_NEXT, STAGE_EXECUTOR };
