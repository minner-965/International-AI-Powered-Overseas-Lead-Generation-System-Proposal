import { PgBoss } from 'pg-boss';

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
  RECALCULATE_COOPERATION_V3: 'recalculate-cooperation-v3'
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
      PHASE5_QUEUES.RECALCULATE_COOPERATION_V3
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

export function createPhase5Queue({
  env = process.env,
  telemetry,
  audit = () => {},
  handlers = {},
  bossFactory = options => new PgBoss(options)
} = {}) {
  const enabled = booleanEnv(env.PGBOSS_ENABLED, true);
  const processJobs = booleanEnv(env.PGBOSS_PROCESS_JOBS, true);
  const boss = enabled ? bossFactory(pgBossOptions(env)) : null;
  const workerIds = new Map();
  let started = false;
  let startupError = null;

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
        boss.on('error', error => audit('phase5_queue_error', { message: String(error?.message || error).slice(0, 240) }));
        await boss.start();
        for (const name of PHASE5_QUEUE_NAMES) await registerQueue(name);
        for (const name of PHASE5_QUEUE_NAMES) {
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
        started = true;
        startupError = null;
        audit('phase5_queue_started', { queues: PHASE5_QUEUE_NAMES.length, workers: workerIds.size, process_jobs:processJobs });
      } catch (error) {
        startupError = error;
        audit('phase5_queue_start_failed', { message: String(error?.message || error).slice(0, 240) });
        throw error;
      }
      return { enabled, started, process_jobs:processJobs, startup_error: null };
    },
    async enqueue(name, data = {}, options = {}) {
      if (!PHASE5_QUEUE_NAMES.includes(name)) throw new Error(`Unsupported Phase 5 queue: ${name}`);
      if (!enabled || !started) throw new Error('Phase 5 queue is not started');
      return boss.send(name, data, {
        singletonKey: options.singletonKey || null,
        priority: Number.isInteger(options.priority) ? options.priority : 0
      });
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
      const queues = await boss.getQueues(PHASE5_QUEUE_NAMES.flatMap(name => [name, `${name}-dead-letter`]));
      return { enabled: true, started: true, status: 'ready', queues };
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
      started = false;
    }
  });
}

export { booleanEnv, pgBossOptions, queuePolicy };
