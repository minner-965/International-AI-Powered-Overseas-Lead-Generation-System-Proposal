import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AutoEvidenceOrchestrator,
  AutoEvidenceRepository,
  AUTO_EVIDENCE_STAGES,
  autoEvidenceConfig
} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import { createAutoEvidenceQueueHandlers } from '../src/autoEvidence/queueHandlers.js';
import { createAutoEvidenceExecutors } from '../src/autoEvidence/executors.js';
import { PHASE5_QUEUES } from '../src/jobs/phase5Queue.js';

const companyId = '11111111-1111-4111-8111-111111111111';

function taskFixture(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    company_id: companyId,
    product_profile: 'WOMENSWEAR',
    business_blocker: 'NAMED_BUYER_EVIDENCE',
    evidence_revision: 4,
    execution_key: 'auto-evidence:v1:test',
    task_status: 'QUEUED',
    current_stage: null,
    automation_owner: 'SYSTEM',
    human_owner: null,
    technical_blocker: null,
    attempt_count: 0,
    strategy_attempt_count: 0,
    provider_retry_count:0,
    worker_retry_count:0,
    checkpoint_replay_count:0,
    max_attempts: 3,
    budget_state: 'AVAILABLE',
    input_digest: 'a'.repeat(64),
    ...overrides
  };
}

class FakeRepository {
  constructor({ candidates = [] } = {}) {
    this.task = taskFixture();
    this.candidates = candidates;
    this.attempts = [];
    this.exceptions = [];
    this.schedules = [];
    this.resolvedEventCompanyIds = null;
    this.dueFairnessRetries = [];
    this.capacityWaits = [];
    this.researchKinds = [];
  }

  async selectCandidates(options) { this.lastSelectOptions=options;return this.candidates.slice(0, options.limit); }

  async selectDueFairnessRetries(options) {
    this.lastDueRetryOptions=options;
    return this.dueFairnessRetries.slice(0,options.limit);
  }

  async selectProviderCapacityWaits(options) {
    this.lastCapacityWaitOptions=options;
    return this.capacityWaits.slice(0,options.limit);
  }

  async resumeProviderCapacityWait(taskId, options) {
    assert.equal(taskId,this.task.id);
    this.schedules.push({candidate:null,options:{...options,source:options.scheduleSource||'RECONCILIATION'}});
    this.task={...this.task,task_status:'RETRY_SCHEDULED',budget_state:'AVAILABLE',
      technical_blocker:null,checkpoint_replay_count:(this.task.checkpoint_replay_count||0)+1};
    return{task:this.task,resumed:true,schedule_event_id:'resume-event-1'};
  }

  async resolveEventCompanyIds(input) {
    this.lastResolveInput=input;
    if(this.resolvedEventCompanyIds)return this.resolvedEventCompanyIds;
    return [...new Set([...(input.company_ids||[]),...(input.company_id?[input.company_id]:[])])];
  }

  async schedule(candidate, options) {
    this.schedules.push({ candidate, options });
    this.task = { ...this.task, ...candidate };
    return { task: this.task, outcome: 'SCHEDULED', replay: false, dispatch_required: true };
  }

  async getTask() { return this.task; }

  async hasControlledOverride() {
    return this.schedules.some(item => item.options.source === 'MANUAL_RETRY');
  }

  async ensureResearchJob(_task, kind) {
    this.researchKinds.push(kind);
    const category = kind === 'CATEGORY';
    const id = category
      ? '33333333-3333-4333-8333-333333333333'
      : '44444444-4444-4444-8444-444444444444';
    this.task = {
      ...this.task,
      [category ? 'category_research_job_id' : 'contact_research_job_id']: id
    };
    return { id, job_type: category ? 'CATEGORY_PROCUREMENT_ENRICHMENT' : 'DECISION_MAKER_ENRICHMENT', replay: true };
  }

  async getSettledAttempt(_taskId, attemptNumber, stage,providerRetryCount=0,workerRetryCount=0) {
    return this.attempts.find(item => item.event_type === 'SETTLED'
      && item.attempt_number === attemptNumber && item.stage === stage
      && (item.provider_retry_count||0)===providerRetryCount&&(item.worker_retry_count||0)===workerRetryCount) || null;
  }

  async beginStage(_task, stage) {
    const strategyAttempt=Math.max(1,this.task.strategy_attempt_count||0);
    this.task = { ...this.task, task_status: 'RUNNING', current_stage: stage,
      strategy_attempt_count:strategyAttempt,attempt_count:strategyAttempt };
    this.attempts.push({ event_type: 'STARTED', attempt_number: this.task.attempt_count, stage });
    return { task: this.task, started: true };
  }

  async settleStage(task, stage, outcome, result, _inputDigest, _outputDigest, technicalBlocker, retryAt) {
    this.attempts.push({
      event_type: 'SETTLED', attempt_number: task.strategy_attempt_count||task.attempt_count, stage,
      provider_retry_count:task.provider_retry_count||0,worker_retry_count:task.worker_retry_count||0,
      outcome_status: outcome, technical_blocker: technicalBlocker, retry_at: retryAt, result
    });
  }

  async recordBundledStage(task, stage) {
    this.attempts.push({ event_type: 'STARTED', attempt_number: task.strategy_attempt_count||task.attempt_count, stage });
    this.attempts.push({ event_type: 'SETTLED', attempt_number: task.strategy_attempt_count||task.attempt_count, stage,
      provider_retry_count:task.provider_retry_count||0,worker_retry_count:task.worker_retry_count||0,outcome_status: 'COMPLETED' });
  }

  async completeTask() {
    this.task = { ...this.task, task_status: 'COMPLETED', completed_at: new Date(), cooldown_until: null };
    return this.task;
  }

  async updateTaskOutcome(_taskId, { status, technicalBlocker, retryAt, budgetState }) {
    this.task = {
      ...this.task,
      task_status: status,
      technical_blocker: technicalBlocker,
      retry_at: retryAt,
      budget_state: budgetState
    };
    return this.task;
  }

  async incrementProviderRetry(){
    this.task={...this.task,provider_retry_count:(this.task.provider_retry_count||0)+1};return this.task;
  }

  async openException(_task, input) {
    const row = { id: `exception-${this.exceptions.length + 1}`, ...input };
    this.exceptions.push(row);
    this.task = { ...this.task, task_status: 'HUMAN_REVIEW_REQUIRED', technical_blocker: input.technicalBlocker };
    return row;
  }

  async summary() { return { task_statuses: [], active_stages: [], latest_schedule: null }; }
  async listTasks() { return [this.task]; }
  async listExceptions() { return this.exceptions; }
}

function queueFixture() {
  const calls = [];
  return {
    calls,
    async enqueue(name, data, options) {
      calls.push({ name, data, options });
      return `job-${calls.length}`;
    }
  };
}

test('Phase 10 automatic evidence is inactive-first and defaults to provider-account-only Tavily usage', () => {
  const config = autoEvidenceConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.reconcileMinutes, 30);
  assert.equal(config.batchSize, 10);
  assert.equal(config.sourceTtlDays, 90);
  assert.equal('cooldownHours' in config,false);
  assert.equal('maxAttempts' in config,false);
  assert.equal(AUTO_EVIDENCE_STAGES.length, 8);
});

test('Phase 10 deployment configuration fails closed with key-only errors', () => {
  const invalid = [
    ['AUTO_EVIDENCE_ENABLED', 'sometimes'],
    ['AUTO_EVIDENCE_RECONCILE_MINUTES', '4'],
    ['TAVILY_USAGE_POLICY', 'LOCAL_BOUNDED']
  ];
  for (const [key, value] of invalid) {
    assert.throws(() => autoEvidenceConfig({[key]:value}), error => {
      assert.equal(error.code, 'INVALID_CONFIGURATION');
      assert.equal(error.message, `Invalid configuration: ${key}`);
      assert.equal(error.message.includes(value), false);
      return true;
    });
  }
  const ignored=autoEvidenceConfig({AUTO_EVIDENCE_MAX_ATTEMPTS:'1',AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS:'8760',
    MAX_TAVILY_CREDITS_PER_DAY_UNITS:'0'});
  assert.equal('maxAttempts' in ignored,false);assert.equal('cooldownHours' in ignored,false);
});

test('Phase 10 settings status exposes effective values without provider credentials', () => {
  const service = new AutoEvidenceOrchestrator({
    repository: new FakeRepository(),
    queue: queueFixture(),
    env: {
      AUTO_EVIDENCE_ENABLED: 'false',
      TAVILY_API_KEY: 'must-not-be-projected'
    }
  });
  const status = service.status();
  assert.equal(status.enabled, false);
  assert.equal(status.tavilyUsagePolicy,'PROVIDER_ACCOUNT_ONLY');
  assert.equal(Object.keys(status).some(key=>/tavily.*(?:cap|budget)|maxAttempts|cooldown/i.test(key)),false);
  assert.equal(JSON.stringify(status).includes('must-not-be-projected'), false);
  assert.equal(Object.keys(status).some(key => /api.?key|secret|token/i.test(key)), false);
});

test('disabled event and reconciliation create no database or queue activity', async () => {
  const repository = new FakeRepository({ candidates: [{ company_id: companyId }] });
  const queue = queueFixture();
  const service = new AutoEvidenceOrchestrator({ repository, queue, env: {} });
  assert.equal((await service.scheduleEvent({ company_id: companyId, product_profile: 'WOMENSWEAR' })).status, 'DISABLED');
  assert.equal((await service.reconcile()).status, 'DISABLED');
  assert.equal(repository.schedules.length, 0);
  assert.equal(queue.calls.length, 0);
});

test('event scheduling uses the stable execution unit and dispatches source discovery once', async () => {
  const repository = new FakeRepository();
  const queue = queueFixture();
  const service = new AutoEvidenceOrchestrator({ repository, queue, env: { AUTO_EVIDENCE_ENABLED: 'true' } });
  const result = await service.scheduleEvent({
    company_id: companyId,
    product_profile: 'womenswear',
    business_blocker: 'named buyer evidence',
    evidence_revision: 4,
    event_id: 'source-event-1'
  });
  assert.equal(result.status, 'SCHEDULED');
  assert.equal(repository.schedules[0].candidate.business_blocker, 'NAMED_BUYER_EVIDENCE');
  assert.equal(repository.schedules[0].candidate.evidence_revision, 4);
  assert.equal(repository.schedules[0].options.source, 'EVENT');
  assert.match(repository.schedules[0].options.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(queue.calls[0].name, PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE);
  assert.equal(queue.calls[0].data.attempt_number, 1);
  assert.match(queue.calls[0].options.singletonKey, /^auto-evidence:/);
});

test('reconciliation respects the configured batch cap and records no duplicate provider work itself', async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    company_id: `${index + 1}`.padStart(8, '0') + '-1111-4111-8111-111111111111',
    product_profile: 'WOMENSWEAR', business_blocker: 'CATEGORY_EVIDENCE', evidence_revision: index
  }));
  const repository = new FakeRepository({ candidates });
  const queue = queueFixture();
  const service = new AutoEvidenceOrchestrator({
    repository, queue,
    env: { AUTO_EVIDENCE_ENABLED: 'true', AUTO_EVIDENCE_BATCH_SIZE: '2' }
  });
  const result = await service.reconcile({ batch_size: 99, reconcile_bucket: 'fixed-window' });
  assert.equal(result.selected, 2);
  assert.equal(result.scheduled, 2);
  assert.equal(repository.schedules.length, 2);
  assert.equal(queue.calls.length, 2);
});

test('provider-only policy accepts one hundred unique tasks without a local daily quota gate', async () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    company_id: `${index + 1}`.padStart(8, '0') + '-1111-4111-8111-111111111111',
    product_profile: 'WOMENSWEAR', business_blocker: 'CATEGORY_EVIDENCE', evidence_revision: index + 1
  }));
  const repository = new FakeRepository({ candidates });
  const queue = queueFixture();
  const service = new AutoEvidenceOrchestrator({ repository, queue,
    env: { AUTO_EVIDENCE_ENABLED: 'true', AUTO_EVIDENCE_BATCH_SIZE: '100',
      TAVILY_USAGE_POLICY: 'PROVIDER_ACCOUNT_ONLY', MAX_TAVILY_CREDITS_PER_DAY_UNITS: '1',
      MAX_TAVILY_CREDITS_PER_RUN_UNITS: '1' } });
  const result = await service.reconcile({ batch_size: 100, reconcile_bucket: 'stub-unlimited-queue' });
  assert.equal(result.selected, 100);
  assert.equal(result.scheduled, 100);
  assert.equal(repository.schedules.length, 100);
  assert.equal(queue.calls.length, 100);
  assert.equal(result.results.some(item => /BUDGET|QUOTA|LIMIT/.test(item.status)), false);
});

test('reconciliation resumes due legacy-ready and fairness rounds before selecting new company-profile work', async () => {
  const repository = new FakeRepository({ candidates: [{
    company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    product_profile: 'WOMENSWEAR', business_blocker: 'CATEGORY_EVIDENCE', evidence_revision: 1
  }] });
  repository.dueFairnessRetries=[taskFixture({
    task_status:'RETRY_SCHEDULED',strategy_state:'READY',retry_at:new Date(0),
    attempt_count:1,strategy_attempt_count:1,current_stage:null,current_strategy_code:null
  })];
  const queue=queueFixture();
  const service=new AutoEvidenceOrchestrator({repository,queue,
    env:{AUTO_EVIDENCE_ENABLED:'true',AUTO_EVIDENCE_BATCH_SIZE:'1'}});
  const result=await service.reconcile({batch_size:1,reconcile_bucket:'fairness-window'});
  assert.equal(result.selected,1);
  assert.equal(result.fairness_resumed,1);
  assert.equal(result.scheduled,0);
  assert.equal(repository.schedules.length,0);
  assert.equal(queue.calls.length,1);
  assert.equal(queue.calls[0].name,PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE);
  assert.equal(queue.calls[0].data.strategy_attempt_number,2);
  assert.match(queue.calls[0].options.singletonKey,/fairness:fairness-window/);
});

test('reconciliation resumes provider-capacity waits only after provider recovery', async () => {
  const repository=new FakeRepository({candidates:[{
    company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',product_profile:'WOMENSWEAR',
    business_blocker:'CATEGORY_EVIDENCE',evidence_revision:1
  }]});
  repository.task=taskFixture({task_status:'PROVIDER_CAPACITY_WAIT',budget_state:'NOT_REQUIRED',
    current_stage:'VERIFYING_EMAIL',current_strategy_code:'S08'});
  repository.capacityWaits=[repository.task];
  const queue=queueFixture();
  const service=new AutoEvidenceOrchestrator({repository,queue,providerAccountState:{async refreshUsage(){return{status:'AVAILABLE'};}},
    env:{AUTO_EVIDENCE_ENABLED:'true',AUTO_EVIDENCE_BATCH_SIZE:'1'}});
  const result=await service.reconcile({batch_size:1,reconcile_bucket:'provider-recovered'});
  assert.equal(result.selected,1);
  assert.equal(result.provider_capacity_resumed,1);
  assert.equal(result.scheduled,0);
  assert.equal(queue.calls.length,1);
  assert.equal(queue.calls[0].data.stage,'VERIFYING_EMAIL');
  assert.equal(queue.calls[0].data.checkpoint_replay_number,1);
  assert.match(repository.schedules[0].options.scheduleKey,/provider-capacity-recovery/);
});

test('event reconciliation targets a singular company id instead of scanning the global queue', async () => {
  const repository=new FakeRepository();
  const service=new AutoEvidenceOrchestrator({repository,queue:queueFixture(),env:{AUTO_EVIDENCE_ENABLED:'true'}});
  await service.reconcile({company_id:companyId,batch_size:10});
  assert.deepEqual(repository.lastSelectOptions.companyIds,[companyId]);
});

test('research, import and category-scope events resolve exact affected companies before candidate selection', async () => {
  const affected=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  for(const reference of [
    {research_job_id:'33333333-3333-4333-8333-333333333333'},
    {import_id:'44444444-4444-4444-8444-444444444444'},
    {category_scope_revision_id:'55555555-5555-4555-8555-555555555555'}
  ]){
    const repository=new FakeRepository();repository.resolvedEventCompanyIds=affected;
    const service=new AutoEvidenceOrchestrator({repository,queue:queueFixture(),env:{AUTO_EVIDENCE_ENABLED:'true'}});
    const result=await service.reconcile({...reference,batch_size:10});
    assert.deepEqual(repository.lastResolveInput,{...reference,batch_size:10});
    assert.deepEqual(repository.lastSelectOptions.companyIds,affected);
    assert.equal(result.targeted_companies,2);
  }
});

test('an unresolved targeted event is a bounded no-op and never falls back to the global first ten', async () => {
  const repository=new FakeRepository({candidates:[{company_id:companyId}]});
  repository.resolvedEventCompanyIds=[];
  const service=new AutoEvidenceOrchestrator({repository,queue:queueFixture(),env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const result=await service.reconcile({import_id:'44444444-4444-4444-8444-444444444444',batch_size:10});
  assert.equal(result.target_resolution,'EMPTY');
  assert.equal(result.selected,0);
  assert.equal(repository.lastSelectOptions,undefined);
});

test('repository event resolvers use direct job cohort, import and approved-scope lineage', async () => {
  const queries=[];
  const pool={query:async(sql,params)=>{
    queries.push({sql:String(sql),params});
    if(String(sql).includes('research_job_cohort_items'))return{rows:[{company_id:companyId}],rowCount:1};
    if(String(sql).includes('reference_data_import_rows'))return{rows:[{company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}],rowCount:1};
    if(String(sql).includes('dpv_product_category_scopes'))return{rows:[{company_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}],rowCount:1};
    return{rows:[],rowCount:0};
  }};
  const repository=new AutoEvidenceRepository({pool});
  assert.deepEqual(await repository.resolveEventCompanyIds({
    research_job_id:'33333333-3333-4333-8333-333333333333',
    import_id:'44444444-4444-4444-8444-444444444444',
    category_scope_revision_id:'55555555-5555-4555-8555-555555555555'
  }),[companyId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'].sort());
  assert.ok(queries.some(item=>item.sql.includes('enrichment_job_companies')));
  assert.ok(queries.some(item=>item.sql.includes('research_candidate_verifications')));
  assert.ok(queries.some(item=>item.sql.includes('leadgen.companies WHERE research_job_id')));
  assert.ok(queries.some(item=>item.sql.includes('data_import_effect_outbox')));
  assert.ok(queries.some(item=>item.sql.includes('business_opportunity_current')));
});

test('historical cooldown never blocks a new evidence revision while exact execution remains deduplicated', async () => {
  const statements = [];
  const coolingTask = taskFixture({
    task_status: 'COMPLETED',
    cooldown_until: new Date('2026-09-08T00:00:00.000Z')
  });
  const client = {
    async query(sql) {
      statements.push(sql);
      if (/INSERT INTO leadgen\.auto_evidence_tasks/.test(sql))return{rows:[{...coolingTask,id:'new-task',task_status:'QUEUED',cooldown_until:null}],rowCount:1};
      if (/INSERT INTO leadgen\.auto_evidence_schedule_events/.test(sql)) {
        return { rows: [{ id: 'event-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const repository = new AutoEvidenceRepository({ pool: { async connect() { return client; } } });
  const result = await repository.schedule({
    company_id: companyId,
    product_profile: 'WOMENSWEAR',
    business_blocker: 'VERIFIED_EMAIL_EVIDENCE',
    evidence_revision: 99
  }, {
    source: 'RECONCILIATION',
    scheduleKey: 'schedule-99',
    maxAttempts: 3,
    inputDigest: 'a'.repeat(64)
  });
  assert.equal(result.outcome, 'SCHEDULED');
  assert.equal(result.dispatch_required, true);
  assert.equal(statements.some(sql => /cooldown_until>now/.test(sql)), false);
  assert.equal(statements.some(sql => /INSERT INTO leadgen\.auto_evidence_tasks/.test(sql)), true);
});

test('each strategy gets a distinct ResearchJob while retries within that strategy reuse it', async () => {
  const oldJob='33333333-3333-4333-8333-333333333333';
  const newJob='55555555-5555-4555-8555-555555555555';
  const calls=[];
  let linked=false;
  const pool={async query(sql,params=[]){
    calls.push({sql:String(sql),params});
    if(String(sql).includes('FROM leadgen.auto_evidence_task_attempts'))return{rows:linked?[{exists:1}]:[],rowCount:linked?1:0};
    if(String(sql).startsWith('INSERT INTO leadgen.research_jobs'))return{rows:[{id:newJob,job_type:'CATEGORY_PROCUREMENT_ENRICHMENT'}],rowCount:1};
    if(String(sql).startsWith('UPDATE leadgen.auto_evidence_tasks'))return{rows:[],rowCount:1};
    return{rows:[],rowCount:0};
  }};
  const repository=new AutoEvidenceRepository({pool});
  const task=taskFixture({task_status:'RUNNING',attempt_count:2,strategy_attempt_count:2,
    current_strategy_code:'S02_OFFICIAL_ASSORTMENT',category_research_job_id:oldJob});
  const created=await repository.ensureResearchJob(task,'CATEGORY',{runBudgetCapUnits:5});
  assert.equal(created.id,newJob);
  assert.equal(created.replay,false);
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO leadgen.research_jobs'));
  assert.match(insert.params[2],/:category:strategy:2$/);
  assert.ok(calls.some(call=>call.sql.startsWith('UPDATE leadgen.auto_evidence_tasks')&&call.params[1]===newJob));
  linked=true;
  const replay=await repository.ensureResearchJob({...task,category_research_job_id:newJob},'CATEGORY',{runBudgetCapUnits:5});
  assert.deepEqual(replay,{id:newJob,job_type:'CATEGORY_PROCUREMENT_ENRICHMENT',replay:true});
  assert.equal(calls.filter(call=>call.sql.startsWith('INSERT INTO leadgen.research_jobs')).length,1);
});

test('successful stage chain records crawler/extractor audit and completes without a cooldown gate', async () => {
  const repository = new FakeRepository();
  const queue = queueFixture();
  const names = [
    'discover_opportunity_evidence', 'normalize_opportunity_category', 'refresh_category_scope_match',
    'find_profile_buyer', 'verify_profile_buyer_email', 'refresh_business_opportunity_v3'
  ];
  const executors = Object.fromEntries(names.map(name => [name, async () => ({ outcome_status: 'COMPLETED' })]));
  const now = new Date('2026-09-01T00:00:00.000Z');
  const service = new AutoEvidenceOrchestrator({
    repository, queue, executors,
    env: { AUTO_EVIDENCE_ENABLED: 'true', AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS: '168' },
    now: () => now
  });
  for (const stage of ['DISCOVERING_SOURCES', 'NORMALIZING_CATEGORY', 'VALIDATING_EVIDENCE', 'FINDING_BUYER', 'VERIFYING_EMAIL', 'REFRESHING_DECISION']) {
    await service.runStage(stage, { task_id: repository.task.id, execution_key: repository.task.execution_key });
  }
  assert.equal(repository.task.task_status, 'COMPLETED');
  assert.equal(repository.task.cooldown_until, null);
  assert.ok(repository.attempts.some(item => item.stage === 'CRAWLING' && item.event_type === 'SETTLED'));
  assert.ok(repository.attempts.some(item => item.stage === 'EXTRACTING' && item.event_type === 'SETTLED'));
  assert.ok(repository.attempts.filter(item => item.event_type === 'SETTLED')
    .every(item => item.result?.research_job_id || ['CRAWLING', 'EXTRACTING'].includes(item.stage)));
  assert.ok(repository.task.category_research_job_id);
  assert.ok(repository.task.contact_research_job_id);
  assert.equal(repository.exceptions.length, 0);
});

test('temporary provider failure schedules exponential retry without changing business evidence', async () => {
  const repository = new FakeRepository();
  const queue = queueFixture();
  const error = Object.assign(new Error('temporary network timeout'), { code: 'PROVIDER_TIMEOUT', retryable: true });
  const service = new AutoEvidenceOrchestrator({
    repository, queue,
    executors: { discover_opportunity_evidence: async () => { throw error; } },
    env: { AUTO_EVIDENCE_ENABLED: 'true', AUTO_EVIDENCE_RETRY_BASE_SECONDS: '60' },
    now: () => new Date('2026-09-01T00:00:00.000Z')
  });
  const result = await service.runStage('DISCOVERING_SOURCES', {
    task_id: repository.task.id, execution_key: repository.task.execution_key
  });
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.equal(repository.task.strategy_attempt_count, 1);
  assert.equal(repository.task.provider_retry_count,1);
  assert.equal(repository.task.technical_blocker, 'TEMPORARY_PROVIDER_ERROR');
  assert.equal(queue.calls.at(-1).options.startAfter.toISOString(), '2026-09-01T00:01:00.000Z');
  assert.equal(repository.exceptions.length, 0);
});

test('provider retries progress independently while the strategy attempt stays fixed', async () => {
  const repository = new FakeRepository();
  const queue = queueFixture();
  const failure = Object.assign(new Error('temporary provider timeout'), { code: 'PROVIDER_TIMEOUT', retryable: true });
  const service = new AutoEvidenceOrchestrator({
    repository, queue,
    executors: { discover_opportunity_evidence: async () => { throw failure; } },
    env: { AUTO_EVIDENCE_ENABLED: 'true', AUTO_EVIDENCE_MAX_ATTEMPTS: '3' },
    now: () => new Date('2026-09-01T00:00:00.000Z')
  });
  const payload = { task_id: repository.task.id, execution_key: repository.task.execution_key };
  assert.equal((await service.runStage('DISCOVERING_SOURCES', payload)).status, 'RETRY_SCHEDULED');
  assert.equal(repository.task.strategy_attempt_count,1);
  assert.equal(repository.task.provider_retry_count,1);
  assert.equal((await service.runStage('DISCOVERING_SOURCES', payload)).status, 'RETRY_SCHEDULED');
  assert.equal(repository.task.strategy_attempt_count,1);
  assert.equal(repository.task.provider_retry_count,2);
  assert.equal((await service.runStage('DISCOVERING_SOURCES', payload)).status,'RETRY_SCHEDULED');
  assert.equal(repository.task.strategy_attempt_count,1);assert.equal(repository.task.provider_retry_count,3);
  assert.equal(repository.exceptions.length,0);
  assert.deepEqual(queue.calls.map(call=>call.data.strategy_attempt_number),[1,1,1]);
});

test('a delayed message from an older attempt never repeats provider work', async () => {
  const repository = new FakeRepository();
  repository.task = taskFixture({ task_status: 'RETRY_SCHEDULED',attempt_count:2,strategy_attempt_count:2 });
  const queue = queueFixture();
  let providerCalls = 0;
  const service = new AutoEvidenceOrchestrator({
    repository,
    queue,
    executors: {
      discover_opportunity_evidence: async () => {
        providerCalls += 1;
        return { outcome_status: 'COMPLETED' };
      }
    },
    env: { AUTO_EVIDENCE_ENABLED: 'true' }
  });
  const result = await service.runStage('DISCOVERING_SOURCES', {
    task_id: repository.task.id,
    execution_key: repository.task.execution_key,
    attempt_number: 1
  });
  assert.equal(result.status, 'STALE_ATTEMPT');
  assert.equal(result.idempotent_replay, true);
  assert.equal(providerCalls, 0);
  assert.equal(repository.attempts.length, 0);
  assert.equal(queue.calls.length, 0);
});

test('a settled strategy start stage advances instead of redirecting the next stage forever', async () => {
  const repository = new FakeRepository();
  repository.task = taskFixture({
    task_status: 'RUNNING',
    attempt_count: 1,
    strategy_attempt_count: 1,
    current_strategy_code: 'S01_OFFICIAL_CATEGORY',
    current_stage: 'DISCOVERING_SOURCES'
  });
  repository.attempts.push({
    event_type: 'SETTLED',
    attempt_number: 1,
    stage: 'DISCOVERING_SOURCES',
    provider_retry_count: 0,
    worker_retry_count: 0,
    outcome_status: 'COMPLETED'
  });
  repository.blockerState = async () => ({ hard_stop: false, resolved: false, responsibility_conflict: false });
  repository.prepareNextStrategy = async () => ({
    ...repository.task,
    strategy: { code: 'S01_OFFICIAL_CATEGORY' }
  });
  const queue = queueFixture();
  let normalizeCalls = 0;
  const service = new AutoEvidenceOrchestrator({
    repository,
    queue,
    executors: {
      normalize_opportunity_category: async () => {
        normalizeCalls += 1;
        return { outcome_status: 'COMPLETED' };
      }
    },
    env: { AUTO_EVIDENCE_ENABLED: 'true' }
  });
  const result = await service.runStage('NORMALIZING_CATEGORY', {
    task_id: repository.task.id,
    execution_key: repository.task.execution_key,
    strategy_code: 'S01_OFFICIAL_CATEGORY',
    attempt_number: 1
  });
  assert.equal(result.status, 'RUNNING');
  assert.notEqual(result.status, 'STRATEGY_REDIRECTED');
  assert.equal(normalizeCalls, 1);
  assert.ok(repository.attempts.some(item => item.event_type === 'SETTLED' && item.stage === 'NORMALIZING_CATEGORY'));
  assert.equal(queue.calls.at(-1).name, PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH);
});

test('decision refresh preserves the strategy ResearchJob lineage instead of creating the opposite kind', async () => {
  for(const [strategyCode,currentStage,expectedKind] of [
    ['S01_OFFICIAL_CATEGORY','REFRESHING_DECISION','CATEGORY'],
    ['S04_OFFICIAL_LEADERSHIP','REFRESHING_DECISION','CONTACT']
  ]){
    const repository=new FakeRepository();
    repository.task=taskFixture({task_status:'RUNNING',attempt_count:1,strategy_attempt_count:1,
      current_strategy_code:strategyCode,current_stage:currentStage});
    const service=new AutoEvidenceOrchestrator({repository,queue:queueFixture(),
      executors:{refresh_business_opportunity_v3:async()=>({outcome_status:'COMPLETED'})},
      env:{AUTO_EVIDENCE_ENABLED:'true'}});
    await service.runStage('REFRESHING_DECISION',{
      task_id:repository.task.id,execution_key:repository.task.execution_key,
      strategy_code:strategyCode,attempt_number:1
    });
    assert.equal(repository.researchKinds.at(-1),expectedKind);
  }
});

test('budget exhaustion and evidence conflicts are separated from automatic retry', async () => {
  const budgetRepository = new FakeRepository();
  const budgetService = new AutoEvidenceOrchestrator({
    repository: budgetRepository, queue: queueFixture(),
    executors: { verify_profile_buyer_email: async () => ({ outcome_status: 'PROVIDER_CAPACITY_WAIT' }) },
    env: { AUTO_EVIDENCE_ENABLED: 'true' }
  });
  const budget = await budgetService.runStage('VERIFYING_EMAIL', {
    task_id: budgetRepository.task.id, execution_key: budgetRepository.task.execution_key
  });
  assert.equal(budget.status, 'PROVIDER_CAPACITY_WAIT');
  assert.equal(budgetRepository.task.budget_state, 'NOT_REQUIRED');

  const reviewRepository = new FakeRepository();
  const reviewService = new AutoEvidenceOrchestrator({
    repository: reviewRepository, queue: queueFixture(),
    executors: { refresh_category_scope_match: async () => ({ outcome_status: 'HUMAN_REVIEW_REQUIRED' }) },
    env: { AUTO_EVIDENCE_ENABLED: 'true' }
  });
  const review = await reviewService.runStage('VALIDATING_EVIDENCE', {
    task_id: reviewRepository.task.id, execution_key: reviewRepository.task.execution_key
  });
  assert.equal(review.status, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(reviewRepository.exceptions.length, 1);
});

test('confirmed Tavily exhaustion blocks auto-evidence ResearchJob creation before insert',async()=>{
  const repository=new FakeRepository();
  const service=new AutoEvidenceOrchestrator({repository,queue:queueFixture(),
    providerAccountState:{async ensureCanCreate(){throw Object.assign(new Error('exhausted'),{
      code:'TAVILY_ACCOUNT_CREDITS_EXHAUSTED'});}},env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const result=await service.runStage('FINDING_BUYER',{task_id:repository.task.id,execution_key:repository.task.execution_key});
  assert.equal(result.status,'PROVIDER_CAPACITY_WAIT');assert.equal(repository.researchKinds.length,0);
});

test('queue handler registry exposes every bounded Phase 10 queue', () => {
  const handlers = createAutoEvidenceQueueHandlers({
    service: { reconcile() {}, runStage() {}, refreshException() {} }
  });
  const expected = [
    PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE,
    PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE,
    PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY,
    PHASE5_QUEUES.REFRESH_CATEGORY_SCOPE_MATCH,
    PHASE5_QUEUES.FIND_PROFILE_BUYER,
    PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL,
    PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3,
    PHASE5_QUEUES.REFRESH_AUTO_EVIDENCE_EXCEPTION
  ];
  assert.deepEqual(Object.keys(handlers).sort(), expected.sort());
});

test('stage claim is transactional and an active lease blocks duplicate provider work', async () => {
  const task=taskFixture({task_status:'RUNNING',attempt_count:1,strategy_attempt_count:1,current_stage:'DISCOVERING_SOURCES'});
  const queries=[];
  let released=false;
  const client={
    async query(sql){
      queries.push(sql);
      if(String(sql).includes('FOR UPDATE'))return{rows:[task],rowCount:1};
      if(String(sql).includes("event_type IN ('STARTED','SETTLED')"))return{rows:[{event_type:'STARTED',occurred_at:new Date()}],rowCount:1};
      return{rows:[],rowCount:0};
    },
    release(){released=true;}
  };
  const repository=new AutoEvidenceRepository({pool:{connect:async()=>client}});
  const claimed=await repository.beginStage(task,'DISCOVERING_SOURCES','b'.repeat(64));
  assert.equal(claimed.started,false);
  assert.ok(claimed.retryAt instanceof Date);
  assert.ok(queries.some(sql=>String(sql)==='BEGIN'));
  assert.ok(queries.some(sql=>String(sql).includes('FOR UPDATE')));
  assert.ok(queries.some(sql=>String(sql)==='COMMIT'));
  assert.ok(!queries.some(sql=>String(sql).startsWith('INSERT INTO leadgen.auto_evidence_task_attempts')));
  assert.equal(released,true);
});

test('a stale stage lease records a worker recovery without consuming a provider retry', async () => {
  const task=taskFixture({task_status:'RUNNING',attempt_count:1,strategy_attempt_count:1,current_stage:'DISCOVERING_SOURCES'});
  const queries=[];
  const client={
    async query(sql){
      queries.push(sql);
      if(String(sql).includes('FOR UPDATE'))return{rows:[task],rowCount:1};
      if(String(sql).includes("event_type IN ('STARTED','SETTLED')"))return{rows:[{event_type:'STARTED',occurred_at:new Date(0)}],rowCount:1};
      if(String(sql).startsWith('UPDATE leadgen.auto_evidence_tasks SET'))return{rows:[task],rowCount:1};
      return{rows:[],rowCount:0};
    },release(){}
  };
  const repository=new AutoEvidenceRepository({pool:{connect:async()=>client}});
  const claimed=await repository.beginStage(task,'DISCOVERING_SOURCES','b'.repeat(64));
  assert.equal(claimed.started,true);
  assert.equal(claimed.recovered,true);
  assert.ok(queries.some(sql=>String(sql).startsWith('INSERT INTO leadgen.auto_evidence_task_attempts')));
  assert.ok(queries.some(sql=>String(sql).includes('worker_retry_count=$2')));
  assert.ok(!queries.some(sql=>String(sql).includes('provider_retry_count=provider_retry_count+1')));
});

test('controlled batch override is independent, internal-only and append-audited as MANUAL_RETRY', async () => {
  const candidate = {
    company_id: companyId, product_profile: 'WOMENSWEAR',
    business_blocker: 'NAMED_BUYER_EVIDENCE', evidence_revision: 4
  };
  const repository = new FakeRepository({ candidates: [candidate] });
  const queue = queueFixture();
  const closed = new AutoEvidenceOrchestrator({ repository, queue, env: {} });
  await assert.rejects(() => closed.runControlledBatch({}, { trusted_management: true }), {
    code: 'AUTO_EVIDENCE_CONTROLLED_BATCH_FORBIDDEN'
  });
  const service = new AutoEvidenceOrchestrator({
    repository, queue,
    executors: { discover_opportunity_evidence: async () => ({ outcome_status: 'COMPLETED' }) },
    env: { AUTO_EVIDENCE_ENABLED: 'false', AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED: 'true' }
  });
  await assert.rejects(() => service.runControlledBatch({}, {
    trusted_management: false, operator_identity: 'operator-1', operator_role: 'DATA_ADMIN', approval_reference: 'pilot-1'
  }), { code: 'AUTO_EVIDENCE_CONTROLLED_BATCH_FORBIDDEN' });
  const result = await service.runControlledBatch({}, {
    trusted_management: true, operator_identity: 'operator-1', operator_role: 'DATA_ADMIN', approval_reference: 'pilot-1'
  });
  assert.equal(result.status, 'CONTROLLED_BATCH_QUEUED');
  assert.equal(result.enabled, false);
  assert.equal(repository.schedules.at(-1).options.source, 'MANUAL_RETRY');
  assert.equal(queue.calls.at(-1).name, PHASE5_QUEUES.DISCOVER_OPPORTUNITY_EVIDENCE);
  const stage = await service.runStage('DISCOVERING_SOURCES', {
    task_id: repository.task.id,
    execution_key: repository.task.execution_key
  });
  assert.equal(stage.status, 'RUNNING');
  assert.equal(stage.outcome, 'COMPLETED');
  assert.equal(queue.calls.at(-1).name, PHASE5_QUEUES.NORMALIZE_OPPORTUNITY_CATEGORY);
});

test('provider capacity recovery appends an attributed MANUAL_RETRY event in the same transaction',async()=>{
  const paused=taskFixture({task_status:'PROVIDER_CAPACITY_WAIT',current_stage:'VERIFYING_EMAIL',attempt_count:1,strategy_attempt_count:1,
    max_attempts:3,budget_state:'NOT_REQUIRED',technical_blocker:'PROVIDER_CREDIT_EXHAUSTED',contact_research_job_id:'44444444-4444-4444-8444-444444444444'});
  const resumed={...paused,task_status:'RETRY_SCHEDULED',attempt_count:2,budget_state:'AVAILABLE',technical_blocker:null};
  const linked={...resumed,contact_research_job_id:'55555555-5555-4555-8555-555555555555'};
  const queries=[];
  const client={async query(sql,params=[]){queries.push({sql:String(sql),params});
    if(String(sql).includes('FROM leadgen.auto_evidence_tasks WHERE id=$1 FOR UPDATE'))return{rows:[paused],rowCount:1};
    if(String(sql).includes('historical_customer_company_links'))return{rows:[{suppressed:false,historical_customer:false}],rowCount:1};
    if(String(sql).includes('provider_account_states'))return{rows:[{status:'AVAILABLE'}],rowCount:1};
    if(String(sql).includes('FROM leadgen.research_jobs WHERE id=$1 FOR SHARE'))
      return{rows:[{id:paused.contact_research_job_id,stop_reason_code:'TAVILY_CREDIT_CAP'}],rowCount:1};
    if(String(sql).startsWith('SELECT stop_reason_code FROM leadgen.research_jobs'))
      return{rows:[{stop_reason_code:'TAVILY_CREDIT_CAP'}],rowCount:1};
    if(String(sql).startsWith('UPDATE leadgen.auto_evidence_tasks'))return{rows:[resumed],rowCount:1};
    if(String(sql).startsWith('INSERT INTO leadgen.auto_evidence_schedule_events'))return{rows:[{id:'resume-event'}],rowCount:1};
    if(String(sql).startsWith('INSERT INTO leadgen.research_jobs'))
      return{rows:[{id:linked.contact_research_job_id}],rowCount:1};
    if(String(sql).includes('SET contact_research_job_id=$2'))return{rows:[linked],rowCount:1};
    if(String(sql).startsWith('INSERT INTO leadgen.auto_evidence_resume_outbox'))return{rows:[{id:7}],rowCount:1};
    return{rows:[],rowCount:1};
  },release(){}};
  const repository=new AutoEvidenceRepository({pool:{connect:async()=>client}});
  const result=await repository.resumeProviderCapacityWait(paused.id,{
    scheduleKey:'auto-evidence:provider-capacity-recovery:fixture',operatorIdentity:'owner.fixture',
    operatorRole:'MANAGEMENT',approvalReference:'provider-restored-fixture',scheduleSource:'MANUAL_RETRY'
  });
  assert.equal(result.resumed,true);assert.equal(result.schedule_event_id,'resume-event');
  assert.ok(queries.some(item=>item.sql.startsWith('UPDATE leadgen.auto_evidence_tasks')&&/retry_at=now\(\)/.test(item.sql)));
  assert.ok(queries.some(item=>/checkpoint_replay_count=greatest\(checkpoint_replay_count\+1/.test(item.sql)));
  const auditInsert=queries.find(item=>item.sql.startsWith('INSERT INTO leadgen.auto_evidence_schedule_events'));
  assert.ok(auditInsert);assert.match(auditInsert.sql,/VALUES \(\$11/);
  assert.deepEqual(auditInsert.params.slice(-4),['owner.fixture','MANAGEMENT','provider-restored-fixture','MANUAL_RETRY']);
  assert.ok(queries.some(item=>item.sql==='COMMIT'));
});

test('persisted controlled provider recovery runs its checkpoint while global automation is disabled',async()=>{
  const repository=new FakeRepository();
  repository.task=taskFixture({task_status:'PROVIDER_CAPACITY_WAIT',current_stage:'VERIFYING_EMAIL',attempt_count:1,strategy_attempt_count:1,
    max_attempts:3,budget_state:'NOT_REQUIRED'});
  const queue=queueFixture();
  const service=new AutoEvidenceOrchestrator({repository,queue,
    env:{AUTO_EVIDENCE_ENABLED:'false',AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED:'true'}});
  const resumed=await service.runControlledBatch({resume_task_id:repository.task.id},{
    trusted_management:true,operator_identity:'owner.fixture',operator_role:'MANAGEMENT',approval_reference:'budget-restored-fixture'
  });
  assert.equal(resumed.status,'PROVIDER_CAPACITY_RECOVERY_QUEUED');
  assert.equal(resumed.schedule_event_id,'resume-event-1');
  const audit=repository.schedules.at(-1).options;
  assert.equal(audit.operatorIdentity,'owner.fixture');assert.equal(audit.operatorRole,'MANAGEMENT');
  assert.equal(audit.approvalReference,'budget-restored-fixture');
  assert.equal(queue.calls.at(-1).name,PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL);
  const worker=new AutoEvidenceOrchestrator({repository,queue,
    executors:{verify_profile_buyer_email:async()=>({outcome_status:'COMPLETED'})},
    env:{AUTO_EVIDENCE_ENABLED:'false',AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED:'false'}});
  const stage=await worker.runStage('VERIFYING_EMAIL',{
    task_id:repository.task.id,execution_key:repository.task.execution_key,attempt_number:1
  });
  assert.equal(stage.status,'RUNNING');assert.equal(stage.outcome,'COMPLETED');
  assert.equal(queue.calls.at(-1).name,PHASE5_QUEUES.REFRESH_BUSINESS_OPPORTUNITY_V3);
});

test('operator override does not run a queued task without a persisted MANUAL_RETRY schedule event', async () => {
  const repository = new FakeRepository();
  const queue = queueFixture();
  const service = new AutoEvidenceOrchestrator({
    repository,
    queue,
    executors: { discover_opportunity_evidence: async () => ({ outcome_status: 'COMPLETED' }) },
    env: { AUTO_EVIDENCE_ENABLED: 'false', AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED: 'true' }
  });
  const result = await service.runStage('DISCOVERING_SOURCES', {
    task_id: repository.task.id,
    execution_key: repository.task.execution_key
  });
  assert.deepEqual(result, { status: 'DISABLED', enabled: false });
  assert.equal(repository.attempts.length, 0);
  assert.equal(queue.calls.length, 0);
});

test('real executor accepts CategoryEvidenceService sources field when search has partial failures', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{}], rowCount: 1 };
    }
  };
  const executors = createAutoEvidenceExecutors({
    pool,
    categoryEvidenceService: {
      async collect() { return { search_failures: 1, sources: 2, observations: 3 }; }
    },
    categoryProcurementService: {},
    enrichmentService: {},
    phase7Repository: {}
  });
  const result = await executors.discover_opportunity_evidence({
    task: taskFixture(),
    research_job_id: '33333333-3333-4333-8333-333333333333'
  });
  assert.equal(result.outcome_status, 'COMPLETED');
  assert.ok(queries.some(item => /prospect_category_sources/.test(item.sql)));
});

test('real executor resets a temporary contact ResearchJob to FAILED so the scheduled retry can reclaim it', async () => {
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (/FROM leadgen\.category_procurement_match_results/.test(sql)) {
        return { rows: [{ id: '55555555-5555-4555-8555-555555555555', match_status: 'CATEGORY_PROCUREMENT_MATCH' }], rowCount: 1 };
      }
      updates.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
  };
  const executors = createAutoEvidenceExecutors({
    pool,
    categoryEvidenceService: {},
    categoryProcurementService: {},
    enrichmentService: {
      async runJob() {
        return { status: 'PARTIAL', stop_reason: 'PROVIDER_TEMPORARY_ERROR_THRESHOLD' };
      }
    },
    phase7Repository: {}
  });
  const result = await executors.find_profile_buyer({
    task: taskFixture(),
    research_job_id: '44444444-4444-4444-8444-444444444444'
  });
  assert.equal(result.outcome_status, 'TEMPORARY_ERROR');
  const reset = updates.find(item => /SET status='FAILED'/.test(item.sql));
  assert.ok(reset);
  assert.equal(reset.params[1], 'PROVIDER_TEMPORARY_ERROR_THRESHOLD');
});
