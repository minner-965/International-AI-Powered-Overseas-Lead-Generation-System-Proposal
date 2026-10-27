import { PgBoss } from 'pg-boss';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WORKER_READINESS_FILE = path.join(tmpdir(), 'dpv-phase5-worker-ready.json');

export const PHASE5_QUEUES = Object.freeze({
  SCORE_COMPANY: 'score-company',
  SCORE_ALL_ELIGIBLE: 'score-all-eligible',
  RECALCULATE_CUSTOMER_MATCH: 'recalculate-customer-match',
  REBUILD_ICP_PROFILE: 'rebuild-icp-profile',
  REPLAY_RULE_VERSION: 'replay-rule-version',
  ENRICH_DECISION_MAKERS: 'enrich-decision-makers',
  COLLECT_CATEGORY_BUYER_EVIDENCE: 'collect-category-buyer-evidence',
  CLASSIFY_BUYER_BUSINESS_MODEL: 'classify-buyer-business-model',
  CALCULATE_CATEGORY_PROCUREMENT_MATCH: 'calculate-category-procurement-match',
  CALCULATE_PRODUCT_OPPORTUNITIES: 'calculate-product-opportunities',
  RECALCULATE_COOPERATION_V3: 'recalculate-cooperation-v3',
  RECALCULATE_BUSINESS_OPPORTUNITIES: 'recalculate-business-opportunities',
  VERIFY_OUTREACH_CONTACT: 'verify-outreach-contact',
  SEND_OUTREACH_EMAIL: 'send-outreach-email',
  SEND_AUTO_FIRST_TOUCH: 'send-auto-first-touch',
  PROCESS_EMAIL_PROVIDER_EVENT: 'process-email-provider-event',
  PROCESS_INBOUND_MESSAGE: 'process-inbound-message',
  GMAIL_INBOUND_SYNC: 'gmail-inbound-sync',
  INBOUND_EMAIL_SYNC: 'inbound-email-sync',
  SEND_CONTROLLED_APPLICATION_EMAIL: 'send-controlled-application-email',
  CONTROLLED_APPLICATION_INBOUND_SYNC: 'controlled-application-inbound-sync',
  PROCESS_CONTROLLED_APPLICATION_INBOUND: 'process-controlled-application-inbound',
  RECONCILE_GMAIL_AMBIGUOUS_SEND: 'reconcile-gmail-ambiguous-send',
  CLASSIFY_INBOUND_REPLY: 'classify-inbound-reply',
  CREATE_SALES_FOLLOWUP: 'create-sales-followup',
  SYNC_OUTREACH_TO_CRM: 'sync-outreach-to-crm',
  DISCOVER_SHARED_IMPORT_FILES: 'discover-shared-import-files',
  COMMIT_REFERENCE_IMPORT: 'commit-reference-import',
  EXPORT_BUSINESS_DATA: 'export-business-data',
  RECALCULATE_AFTER_IMPORT: 'recalculate-after-import',
  SCHEDULE_AUTO_EVIDENCE: 'schedule-auto-evidence',
  DISCOVER_OPPORTUNITY_EVIDENCE: 'discover-opportunity-evidence',
  NORMALIZE_OPPORTUNITY_CATEGORY: 'normalize-opportunity-category',
  REFRESH_CATEGORY_SCOPE_MATCH: 'refresh-category-scope-match',
  FIND_PROFILE_BUYER: 'find-profile-buyer',
  VERIFY_PROFILE_BUYER_EMAIL: 'verify-profile-buyer-email',
  REFRESH_BUSINESS_OPPORTUNITY_V3: 'refresh-business-opportunity-v3',
  REFRESH_AUTO_EVIDENCE_EXCEPTION: 'refresh-auto-evidence-exception',
  EXECUTE_RESEARCH_JOB: 'execute-research-job',
  CRM_FOLLOWUP_SCAN: 'crm-followup-scan',
  CRM_FOLLOWUP_SEND: 'crm-followup-send',
  CRM_OUTBOX_DISPATCH: 'crm-outbox-dispatch'
});

export const PHASE5_QUEUE_NAMES = Object.freeze(Object.values(PHASE5_QUEUES));

function queuePolicy(name) {
  return Object.freeze({
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: [
      PHASE5_QUEUES.ENRICH_DECISION_MAKERS,
      PHASE5_QUEUES.COLLECT_CATEGORY_BUYER_EVIDENCE,
      PHASE5_QUEUES.CLASSIFY_BUYER_BUSINESS_MODEL,
      PHASE5_QUEUES.CALCULATE_CATEGORY_PROCUREMENT_MATCH,
      PHASE5_QUEUES.CALCULATE_PRODUCT_OPPORTUNITIES,
      PHASE5_QUEUES.RECALCULATE_COOPERATION_V3,
      PHASE5_QUEUES.RECALCULATE_BUSINESS_OPPORTUNITIES,
      PHASE5_QUEUES.VERIFY_OUTREACH_CONTACT,
      PHASE5_QUEUES.SEND_OUTREACH_EMAIL,
      PHASE5_QUEUES.SEND_AUTO_FIRST_TOUCH,
      PHASE5_QUEUES.CRM_FOLLOWUP_SEND,
      PHASE5_QUEUES.PROCESS_EMAIL_PROVIDER_EVENT,
      PHASE5_QUEUES.PROCESS_INBOUND_MESSAGE,
      PHASE5_QUEUES.GMAIL_INBOUND_SYNC,
      PHASE5_QUEUES.INBOUND_EMAIL_SYNC,
      PHASE5_QUEUES.SEND_CONTROLLED_APPLICATION_EMAIL,
      PHASE5_QUEUES.CONTROLLED_APPLICATION_INBOUND_SYNC,
      PHASE5_QUEUES.PROCESS_CONTROLLED_APPLICATION_INBOUND,
      PHASE5_QUEUES.RECONCILE_GMAIL_AMBIGUOUS_SEND,
      PHASE5_QUEUES.COMMIT_REFERENCE_IMPORT,
      PHASE5_QUEUES.EXPORT_BUSINESS_DATA,
      PHASE5_QUEUES.RECALCULATE_AFTER_IMPORT,
      PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE,
      PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE,
      PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY,
      PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH,
      PHASE5_QUEUES.FIND_PROFILE_BUYER,
      PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL,
      PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3,
      PHASE5_QUEUES.REFRESH_AUTO_EVIDENCE_EXCEPTION,
      PHASE5_QUEUES.EXECUTE_RESEARCH_JOB
    ].includes(name) ? 900 : 300,
    heartbeatSeconds: 60,
    deleteAfterSeconds: 86400,
    retentionSeconds: 604800,
    deadLetter: `${name}-dead-letter`
  });
}

function pgBossOptions(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  return {
    host: env.POSTGRES_HOST || 'postgres',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'leadgen',
    user: env.POSTGRES_USER || 'leadgen',
    password: env.POSTGRES_PASSWORD,
    application_name: 'dpv-phase5-jobs'
  };
}

function booleanEnv(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function queueAllowlist(value) {
  if (!value || !String(value).trim()) return PHASE5_QUEUE_NAMES;
  const requested = [...new Set(String(value).split(',').map(item => item.trim()).filter(Boolean))];
  const unsupported = requested.filter(name => !PHASE5_QUEUE_NAMES.includes(name));
  if (unsupported.length) throw new Error(`Unsupported queue allowlist: ${unsupported.join(', ')}`);
  return Object.freeze(requested);
}

export function createPhase5Queue({
  env = process.env,
  telemetry,
  audit = () => {},
  handlers = {},
  bossFactory = options => new PgBoss(options)
} = {}) {
  const enabled = booleanEnv(env.PGBOSS_ENABLED, true);
  const processJobs = booleanEnv(env.PGBOSS_PROCESS_JOBS, true);
  const strictWorkerAllowlist = Boolean(String(env.PGBOSS_QUEUE_ALLOWLIST || '').trim());
  const workerQueueNames = queueAllowlist(env.PGBOSS_QUEUE_ALLOWLIST);
  const boss = enabled ? bossFactory(pgBossOptions(env)) : null;
  const workerIds = new Map();
  let started = false;
  let startupError = null;

  async function clearReadinessFile() {
    if (!processJobs) return;
    try { await unlink(WORKER_READINESS_FILE); } catch (error) {
      if (error?.code !== 'ENOENT') audit('phase5_queue_readiness_cleanup_failed', { code: error?.code || 'UNKNOWN' });
    }
  }

  async function publishReadinessFile() {
    if (!processJobs) return;
    const registered = [...workerIds.keys()];
    const missingHandlers = strictWorkerAllowlist ? workerQueueNames.filter(name => !handlers[name]) : [];
    if (!registered.length || missingHandlers.length) {
      const error = new Error(missingHandlers.length
        ? `Worker queue allowlist has no handler for: ${missingHandlers.join(', ')}`
        : 'Worker queue allowlist has no registered handlers');
      error.code = 'PHASE5_WORKER_HANDLER_MISSING';
      throw error;
    }
    await writeFile(WORKER_READINESS_FILE, JSON.stringify({
      pid: process.pid,
      ready: true,
      queues: registered,
      started_at: new Date().toISOString()
    }), { encoding: 'utf8', mode: 0o600 });
  }

  async function registerQueue(name) {
    await boss.createQueue(`${name}-dead-letter`, {
      retryLimit: 0,
      deleteAfterSeconds: 604800,
      retentionSeconds: 2592000
    });
    await boss.createQueue(name, queuePolicy(name));
  }

  async function runHandler(queue, jobs) {
    const handler = handlers[queue];
    if (!handler) return { skipped: true, reason: 'handler_not_registered' };
    const operation = async () => handler(jobs[0]?.data || {}, jobs[0] || null);
    if (!telemetry) return operation();
    return telemetry.withSpan('phase5.queue.process', {
      queue,
      job_id: jobs[0]?.id || '',
      research_job_id: jobs[0]?.data?.research_job_id || '',
      company_id: jobs[0]?.data?.company_id || '',
      rule_version: jobs[0]?.data?.rule_version || '',
      icp_profile_version: jobs[0]?.data?.icp_profile_version || '',
      product_profile: jobs[0]?.data?.product_profile || '',
      calculation_version: jobs[0]?.data?.calculation_version || ''
    }, operation);
  }

  return Object.freeze({
    enabled,
    async start() {
      if (!enabled || started) return { enabled, started, startup_error: startupError?.message || null };
      try {
        await clearReadinessFile();
        boss.on('error', error => audit('phase5_queue_error', { message: String(error?.message || error).slice(0, 240) }));
        await boss.start();
        for (const name of PHASE5_QUEUE_NAMES) await registerQueue(name);
        const inboundProvider=String(env.INBOUND_EMAIL_PROVIDER||'').trim().toUpperCase();
        const inboundEnabled=booleanEnv(env.MERCHANT_INBOUND_SYNC_ENABLED,true)||(inboundProvider==='IMAP'?booleanEnv(env.SMTP_IMAP_INBOUND_SYNC_ENABLED,false):inboundProvider==='GMAIL_API'&&booleanEnv(env.GMAIL_INBOUND_SYNC_ENABLED,false));
        // Merchant mailboxes are synced by the same job (MERCHANT_INBOUND_SYNC_ENABLED, default on).
        if (inboundEnabled && typeof boss.schedule === 'function') {
          const minutes=Math.max(1,Math.min(59,Number(env.INBOUND_EMAIL_SYNC_INTERVAL_MINUTES||env.GMAIL_INBOUND_SYNC_INTERVAL_MINUTES)||5));
          await boss.schedule(PHASE5_QUEUES.INBOUND_EMAIL_SYNC,`*/${minutes} * * * *`,{}, { tz:'UTC' });
        }
        // The scan only drafts follow-ups for human approval; it never sends. Whether it drafts anything is the
        // follow-up switch on the settings page (migration 072; CRM_FOLLOWUP_DRAFTS_ENABLED is its initial value),
        // so the hourly scan is scheduled unless CRM_FOLLOWUP_SCAN_SCHEDULE_ENABLED=false.
        if (booleanEnv(env.CRM_FOLLOWUP_SCAN_SCHEDULE_ENABLED,true) && typeof boss.schedule === 'function')
          await boss.schedule(PHASE5_QUEUES.CRM_FOLLOWUP_SCAN,'17 * * * *',{}, { tz:'UTC' });
        if (String(env.CRM_PROVIDER || env.CRM_BASE_URL || '').trim() && typeof boss.schedule === 'function')
          await boss.schedule(PHASE5_QUEUES.CRM_OUTBOX_DISPATCH,'*/10 * * * *',{}, { tz:'UTC' });
        for (const name of workerQueueNames) {
          if (!processJobs) continue;
          if (!handlers[name]) continue;
          const workerId = await boss.work(name, {
            batchSize: 1,
            localConcurrency: 1,
            pollingIntervalSeconds: 2,
            heartbeatRefreshSeconds: 30
          }, jobs => runHandler(name, jobs));
          workerIds.set(name, workerId);
        }
        await publishReadinessFile();
        started = true;
        startupError = null;
        audit('phase5_queue_started', {
          queues: PHASE5_QUEUE_NAMES.length,
          worker_queues: workerQueueNames.length,
          workers: workerIds.size,
          process_jobs:processJobs
        });
      } catch (error) {
        await clearReadinessFile();
        startupError = error;
        audit('phase5_queue_start_failed', { message: String(error?.message || error).slice(0, 240) });
        throw error;
      }
      return { enabled, started, process_jobs:processJobs, startup_error: null };
    },
    async enqueue(name, data = {}, options = {}) {
      if (!PHASE5_QUEUE_NAMES.includes(name)) throw new Error(`Unsupported Phase 5 queue: ${name}`);
      if (!enabled || !started) throw new Error('Phase 5 queue is not started');
      const sendOptions = {
        singletonKey: options.singletonKey || null,
        priority: Number.isInteger(options.priority) ? options.priority : 0
      };
      if (options.startAfter) sendOptions.startAfter = options.startAfter;
      return boss.send(name, data, sendOptions);
    },
    async enqueueFlow(steps) {
      if (!enabled || !started) throw new Error('Phase 5 queue is not started');
      if (!Array.isArray(steps) || !steps.length) throw new Error('Phase 5 flow requires at least one step');
      for (const step of steps) {
        if (!PHASE5_QUEUE_NAMES.includes(step.name)) throw new Error(`Unsupported Phase 5 queue: ${step.name}`);
      }
      return boss.flow(steps);
    },
    async health() {
      if (!enabled) return { enabled: false, started: false, status: 'disabled', queues: [] };
      if (!started) return {
        enabled: true,
        started: false,
        status: startupError ? 'degraded' : 'starting',
        startup_error: startupError?.message || null,
        queues: []
      };
      const queues = await boss.getQueues(workerQueueNames.flatMap(name => [name, `${name}-dead-letter`]));
      const expectedWorkerCount = strictWorkerAllowlist
        ? workerQueueNames.length
        : workerQueueNames.filter(name => Boolean(handlers[name])).length;
      const workerReady = !processJobs || workerIds.size === expectedWorkerCount;
      return {
        enabled: true,
        started: true,
        process_jobs: processJobs,
        status: workerReady ? 'ready' : 'degraded',
        worker_count: workerIds.size,
        worker_queues: [...workerIds.keys()],
        queues
      };
    },
    async find(name, options = {}) {
      if (!enabled || !started) return [];
      return boss.findJobs(name, options);
    },
    async waitFor(name, id, { timeoutMs = 30000, intervalMs = 150 } = {}) {
      if (!enabled || !started) throw new Error('Phase 5 queue is not started');
      const deadline = Date.now() + Math.max(1000, timeoutMs);
      while (Date.now() < deadline) {
        const [job] = await boss.findJobs(name, { id });
        if (!job) throw new Error(`Phase 5 job not found: ${id}`);
        if (['completed', 'failed', 'cancelled'].includes(job.state)) return job;
        await new Promise(resolve => setTimeout(resolve, Math.max(50, intervalMs)));
      }
      const error = new Error(`Phase 5 job wait timed out: ${id}`);
      error.code = 'PHASE5_JOB_TIMEOUT';
      throw error;
    },
    async stop() {
      if (boss && started) await boss.stop({ graceful: true, timeout: 30000 });
      await clearReadinessFile();
      started = false;
    }
  });
}

export { booleanEnv, pgBossOptions, queueAllowlist, queuePolicy, WORKER_READINESS_FILE };
