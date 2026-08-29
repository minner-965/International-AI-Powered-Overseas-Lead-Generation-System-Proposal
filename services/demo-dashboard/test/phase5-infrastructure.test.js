import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryService, databaseOperation, instrumentPgPool, safeAttributes } from '../src/observability/telemetry.js';
import { createPhase5Queue, PHASE5_QUEUES, PHASE5_QUEUE_NAMES, queuePolicy } from '../src/jobs/phase5Queue.js';

test('telemetry keeps only bounded non-sensitive dimensions', async () => {
  const telemetry = createTelemetryService({ enabled: true });
  await telemetry.withSpan('phase5.score', {
    company_id: 'company-1',
    rule_version: 'dpv-v1',
    email: 'private@example.test',
    page_text: 'not allowed'
  }, async () => 42);
  await new Promise(resolve => setTimeout(resolve, 10));
  const [span] = telemetry.snapshot();
  assert.equal(span.name, 'phase5.score');
  assert.equal(span.attributes.company_id, 'company-1');
  assert.equal(span.attributes.rule_version, 'dpv-v1');
  assert.equal(span.attributes.email, undefined);
  assert.equal(span.attributes.page_text, undefined);
  await telemetry.shutdown();
});

test('safeAttributes truncates strings and rejects nested payloads', () => {
  const attrs = safeAttributes({
    company_id: 'a'.repeat(200),
    market: 'UAE',
    result_count: 3,
    nested: { email: 'hidden@example.test' }
  });
  assert.equal(attrs.company_id.length, 160);
  assert.equal(attrs.market, 'UAE');
  assert.equal(attrs.result_count, 3);
  assert.equal(attrs.nested, undefined);
});

test('database instrumentation records operation only and never SQL or values', async () => {
  const telemetry = createTelemetryService({ enabled: true });
  const fakeClient = { async query() { return { rows: [{ email: 'hidden@example.test' }] }; }, release() {} };
  const fakePool = {
    async query() { return { rows: [] }; },
    async connect() { return fakeClient; }
  };
  instrumentPgPool(fakePool, telemetry);
  await fakePool.query('SELECT * FROM internal_customers WHERE email=$1', ['hidden@example.test']);
  const client = await fakePool.connect();
  await client.query({ text: 'UPDATE internal_customers SET revenue=$1' }, [999]);
  await new Promise(resolve => setTimeout(resolve, 10));
  const spans = telemetry.snapshot();
  assert.deepEqual(spans.map(span => span.attributes.operation), ['SELECT', 'UPDATE']);
  assert.equal(JSON.stringify(spans).includes('hidden@example.test'), false);
  assert.equal(JSON.stringify(spans).includes('internal_customers'), false);
  assert.equal(databaseOperation(' insert into leadgen.x values ($1)'), 'INSERT');
  await telemetry.shutdown();
});

test('database instrumentation preserves pg callback-style connect used by Pool.query', async () => {
  const telemetry = createTelemetryService({ enabled: false });
  const fakeClient = { async query() { return { rows: [] }; } };
  const fakePool = {
    async query() { return { rows: [] }; },
    connect(callback) {
      if (callback) { callback(null, fakeClient, () => {}); return undefined; }
      return Promise.resolve(fakeClient);
    }
  };
  instrumentPgPool(fakePool, telemetry);
  await new Promise((resolve, reject) => fakePool.connect((error, client, release) => {
    if (error) return reject(error);
    assert.equal(client, fakeClient);
    assert.equal(typeof release, 'function');
    resolve();
  }));
  await telemetry.shutdown();
});

test('queue adapter registers bounded retry and dead-letter policies', async () => {
  const calls = [];
  const workers = [];
  const fakeBoss = {
    on() {},
    async start() { calls.push(['start']); },
    async createQueue(name, options) { calls.push(['createQueue', name, options]); },
    async work(name, options) { workers.push([name, options]); return `worker-${name}`; },
    async send(name, data, options) { calls.push(['send', name, data, options]); return 'job-1'; },
    async flow(steps) { calls.push(['flow', steps]); return Object.fromEntries(steps.map(step => [step.ref, `job-${step.ref}`])); },
    async getQueues(names) { return names.map(name => ({ name })); },
    async findJobs(_name, options) { return [{ id: options.id, state: 'completed', output: { ok: true } }]; },
    async stop() { calls.push(['stop']); }
  };
  const queue = createPhase5Queue({
    env: { PGBOSS_ENABLED: 'true' },
    bossFactory: () => fakeBoss,
    handlers: { [PHASE5_QUEUES.SCORE_COMPANY]: async () => ({ ok: true }) }
  });
  await queue.start();
  assert.equal(calls.filter(call => call[0] === 'createQueue').length, PHASE5_QUEUE_NAMES.length * 2);
  assert.equal(workers.length, 1);
  assert.equal(workers[0][1].batchSize, 1);
  assert.equal(workers[0][1].localConcurrency, 1);
  const policy = queuePolicy(PHASE5_QUEUES.SCORE_COMPANY);
  assert.equal(policy.retryLimit, 3);
  assert.equal(policy.deadLetter, 'score-company-dead-letter');
  assert.equal(await queue.enqueue(PHASE5_QUEUES.SCORE_COMPANY, { company_id: 'company-1' }), 'job-1');
  assert.deepEqual(await queue.enqueueFlow([
    { ref: 'score', name: PHASE5_QUEUES.SCORE_COMPANY, data: { company_id: 'company-1' } },
    { ref: 'match', name: PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH, data: { company_id: 'company-1' }, dependsOn: ['score'] }
  ]), { score: 'job-score', match: 'job-match' });
  assert.equal((await queue.waitFor(PHASE5_QUEUES.SCORE_COMPANY, 'job-1')).state, 'completed');
  await queue.stop();
});

test('queue adapter can be explicitly disabled', async () => {
  const queue = createPhase5Queue({ env: { PGBOSS_ENABLED: 'false' } });
  assert.deepEqual(await queue.start(), { enabled: false, started: false, startup_error: null });
  assert.equal((await queue.health()).status, 'disabled');
});
