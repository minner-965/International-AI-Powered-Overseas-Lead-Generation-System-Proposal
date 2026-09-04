import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {OrchestratorHealthService,heartbeatState} from '../src/orchestration/OrchestratorHealthService.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const fakePool={query:async()=>({rows:[]})};
class Harness extends OrchestratorHealthService {
  constructor({jobs=[]}={}){super({pool:fakePool});this.jobs=jobs;this.records=[];}
  async claimQueued(){const rows=this.jobs;this.jobs=[];return rows;}
  async recordDispatch(jobId,state,options={}){this.records.push({jobId,state,...options});}
}

test('watchdog dispatches queued ResearchJobs directly without n8n health dependency',async()=>{
  const service=new Harness({jobs:[{id:'JOB-A'}]});let calls=0;
  const result=await service.watchdog({dispatch:async job=>{calls+=1;assert.equal(job.id,'JOB-A');}});
  assert.equal(calls,1);assert.equal(result.dispatch.state,'DIRECT_PG_BOSS');
  assert.equal(result.outcomes[0].dispatch_state,'DISPATCHED');
});

test('direct queue failure is retryable queue unavailability',async()=>{
  const service=new Harness({jobs:[{id:'JOB-B'}]});
  const result=await service.watchdog({dispatch:async()=>{throw new Error('queue offline');}});
  assert.equal(result.outcomes[0].dispatch_state,'QUEUE_UNAVAILABLE');
  assert.equal(service.records[0].reason,'DIRECT_QUEUE_RETRY_PENDING');
});

test('retry preserves the stable ResearchJob execution identity',async()=>{
  const service=new Harness({jobs:[{id:'JOB-C',dispatch_execution_key:'research-job:JOB-C'}]});let identity='';
  await service.watchdog({dispatch:async job=>{identity=job.dispatch_execution_key;}});
  assert.equal(identity,'research-job:JOB-C');
});

test('two schedulers share a singleton claim and do not dispatch twice',async()=>{
  const shared={jobs:[{id:'JOB-D'}]};let calls=0;
  class SharedHarness extends Harness {async claimQueued(){return shared.jobs.splice(0,1);}}
  await Promise.all([new SharedHarness().watchdog({dispatch:async()=>{calls+=1;}}),new SharedHarness().watchdog({dispatch:async()=>{calls+=1;}})]);
  assert.equal(calls,1);
});

test('reconciliation heartbeat TTL remains observable without controlling dispatch',()=>{
  const now=new Date('2026-09-02T10:00:00Z');
  assert.equal(heartbeatState('2026-09-02T08:55:01Z',{now,intervalMinutes:30}).state,'ACTIVE');
  assert.equal(heartbeatState('2026-09-02T08:54:59Z',{now,intervalMinutes:30}).state,'STALE');
});

test('only periodic reconciliation remains as the n8n ResearchJob-related workflow',()=>{
  assert.equal(fs.existsSync(path.join(root,'workflows/01-two-week-demo.json')),false);
  const reconcile=JSON.parse(fs.readFileSync(path.join(root,'workflows/03-phase10-auto-evidence-reconciliation.json'),'utf8'));
  assert.equal(reconcile.id,'dpvPhase10AutoEvidenceReconciliation');
  assert.ok(reconcile.nodes.some(node=>node.name==='08 Record End Heartbeat'));
  assert.match(JSON.stringify(reconcile),/AUTO_EVIDENCE_RECONCILE_MINUTES/);
});

test('public UI does not expose tokens, webhook URLs, or error stacks',()=>{
  const ui=fs.readFileSync(path.join(root,'services/demo-dashboard/public/ui/phase9-research-workbench.js'),'utf8');
  assert.doesNotMatch(ui,/INTERNAL_API_TOKEN|N8N_RESEARCH_WEBHOOK_URL|error\.stack/);
});
