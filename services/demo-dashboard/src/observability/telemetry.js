import { SpanStatusCode } from '@opentelemetry/api';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BasicTracerProvider,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base';

const safeAttributeNames = new Set([
  'research_job_id', 'company_id', 'candidate_id', 'market', 'provider',
  'rule_version', 'icp_profile_version', 'operation', 'status', 'credits',
  'queue', 'job_id', 'result_count'
]);

function safeAttributes(attributes = {}) {
  return Object.fromEntries(Object.entries(attributes)
    .filter(([key, value]) => safeAttributeNames.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));
}

class BoundedSummaryExporter {
  constructor(limit = 250) {
    this.limit = limit;
    this.records = [];
  }

  export(spans, callback) {
    for (const span of spans) {
      this.records.push({
        name: span.name,
        started_at: new Date(Number(span.startTime[0]) * 1000 + Number(span.startTime[1]) / 1e6).toISOString(),
        duration_ms: Number(span.duration[0]) * 1000 + Number(span.duration[1]) / 1e6,
        status: span.status?.code || 0,
        attributes: safeAttributes(span.attributes)
      });
    }
    if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit);
    callback({ code: 0 });
  }

  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
  snapshot() { return this.records.map(record => ({ ...record, attributes: { ...record.attributes } })); }
}

export function createTelemetryService({ enabled = false, serviceName = 'dpv-leadgen' } = {}) {
  const exporter = new BoundedSummaryExporter();
  const provider = new BasicTracerProvider({
    sampler: enabled ? new AlwaysOnSampler() : new AlwaysOffSampler(),
    spanProcessors: enabled ? [new SimpleSpanProcessor(exporter)] : []
  });
  const tracer = provider.getTracer(serviceName, 'phase5');

  return Object.freeze({
    enabled,
    async withSpan(name, attributes, operation) {
      const span = tracer.startSpan(name, { attributes: safeAttributes(attributes) });
      const started = performance.now();
      try {
        const result = await operation(span);
        span.setAttribute('status', 'ok');
        span.setAttribute('duration_ms', Math.round(performance.now() - started));
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute('status', 'error');
        span.setAttribute('duration_ms', Math.round(performance.now() - started));
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.code || error?.name || 'operation_error').slice(0, 80) });
        throw error;
      } finally {
        span.end();
      }
    },
    snapshot() { return exporter.snapshot(); },
    async shutdown() { await provider.shutdown(); }
  });
}

function databaseOperation(query) {
  const text = typeof query === 'string' ? query : query?.text;
  return String(text || 'query').trim().split(/\s+/, 1)[0].toUpperCase().replace(/[^A-Z]/g, '') || 'QUERY';
}

const instrumentedClient = Symbol('phase5InstrumentedClient');

export function instrumentPgPool(pool, telemetry) {
  if (!pool || !telemetry || pool[instrumentedClient]) return pool;
  const originalPoolQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  const patchClient = client => {
    if (!client || client[instrumentedClient]) return client;
    const originalClientQuery = client.query.bind(client);
    client.query = (query, values, callback) => {
      let queryValues = values;
      let queryCallback = callback;
      if (typeof values === 'function') {
        queryCallback = values;
        queryValues = undefined;
      }
      const operation = () => queryCallback
        ? new Promise((resolve, reject) => originalClientQuery(query, queryValues, (error, result) => error ? reject(error) : resolve(result)))
        : originalClientQuery(query, queryValues);
      const traced = telemetry.withSpan('phase5.database.query', { operation: databaseOperation(query) }, operation);
      if (queryCallback) {
        traced.then(result => queryCallback(undefined, result), error => queryCallback(error));
      }
      return traced;
    };
    client[instrumentedClient] = true;
    return client;
  };

  pool.query = (query, values) => telemetry.withSpan('phase5.database.query', {
    operation: databaseOperation(query)
  }, () => originalPoolQuery(query, values));

  pool.connect = callback => {
    if (typeof callback === 'function') {
      return originalConnect((error, client, release) => callback(error, patchClient(client), release));
    }
    return originalConnect().then(patchClient);
  };
  pool[instrumentedClient] = true;
  return pool;
}

export { databaseOperation, safeAttributes };
