import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {OrchestratorHealthService,classifyDispatchFailure,heartbeatState} from '../src/orchestration/OrchestratorHealthService.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const fakePool={query:async()=>({rows:[]})};
class Harness extends OrchestratorHealthService {
  constructor({health='ACTIVE',active=true,jobs=[]}={}){super({pool:fakePool,researchWorkflowActive:active});this.health=health;this.jobs=jobs;this.records=[];}
  async status(){return {state:this.health,observed_at:this.health==='MISSING'?null:new Date().toISOString()};}
  async claimQueued(){const rows=this.jobs;this.jobs=[];return rows;}
  async recordDispatch(jobId,state,options={}){this.records.push({jobId,state,...options});}
}

test('active workflow with fresh heartbeat dispatches the same ResearchJob',async()=>{
  const service=new Harness({jobs:[{id:'JOB-A'}]});let calls=0;
  const result=await service.watchdog({dispatch:async job=>{calls+=1;assert.equal(job.id,'JOB-A');}});
  assert.equal(calls,1);assert.equal(result.outcomes[0].dispatch_state,'DISPATCHED');
});

test('n8n unavailable makes no provider or workflow call and keeps a diagnostic state',async()=>{
  const service=new Harness({health:'STALE',jobs:[{id:'JOB-B'}]});let calls=0;
  const result=await service.watchdog({dispatch:async()=>{calls+=1;}});
  assert.equal(calls,0);assert.equal(result.outcomes[0].dispatch_state,'ORCHESTRATOR_UNAVAILABLE');
});

test('inactive workflow makes no call',async()=>{
  const service=new Harness({active:false,jobs:[{id:'JOB-C'}]});let calls=0;
  const result=await service.watchdog({dispatch:async()=>{calls+=1;}});
  assert.equal(calls,0);assert.equal(result.outcomes[0].dispatch_state,'WORKFLOW_INACTIVE');
});

test('webhook authentication failure is classified and deferred without a retry loop',async()=>{
  const service=new Harness({jobs:[{id:'JOB-D'}]});
  const result=await service.watchdog({dispatch:async()=>{throw Object.assign(new Error('request rejected'),{status:401});}});
  assert.equal(result.checked,1);assert.equal(result.outcomes[0].dispatch_state,'WEBHOOK_AUTH_FAILED');
  assert.equal(classifyDispatchFailure({status:403}),'WEBHOOK_AUTH_FAILED');
});

test('heartbeat recovery retries the original stable job identity',async()=>{
  const service=new Harness({health:'MISSING',jobs:[{id:'JOB-E',dispatch_execution_key:'research-job:JOB-E'}]});let called='';
  await service.watchdog({dispatch:async()=>assert.fail('must not dispatch while missing')});
  service.health='ACTIVE';service.jobs=[{id:'JOB-E',dispatch_execution_key:'research-job:JOB-E'}];
  await service.watchdog({dispatch:async job=>{called=job.dispatch_execution_key;}});
  assert.equal(called,'research-job:JOB-E');
});

test('two schedulers share a singleton claim and do not dispatch twice',async()=>{
  const shared={jobs:[{id:'JOB-F'}]};let calls=0;
  class SharedHarness extends Harness {async claimQueued(){return shared.jobs.splice(0,1);}}
  await Promise.all([new SharedHarness().watchdog({dispatch:async()=>{calls+=1;}}),new SharedHarness().watchdog({dispatch:async()=>{calls+=1;}})]);
  assert.equal(calls,1);
});

test('TTL is two intervals plus five minutes and UI exposes labels without sensitive internals',()=>{
  const now=new Date('2026-09-02T10:00:00Z');
  assert.equal(heartbeatState('2026-09-02T08:55:01Z',{now,intervalMinutes:30}).state,'ACTIVE');
  assert.equal(heartbeatState('2026-09-02T08:54:59Z',{now,intervalMinutes:30}).state,'STALE');
  const ui=fs.readFileSync(path.join(root,'services/demo-dashboard/public/ui/phase9-research-workbench.js'),'utf8');
  assert.match(ui,/ORCHESTRATOR_UNAVAILABLE/);assert.match(ui,/WORKFLOW_INACTIVE/);assert.match(ui,/WEBHOOK_AUTH_FAILED/);
  assert.doesNotMatch(ui,/INTERNAL_API_TOKEN|N8N_RESEARCH_WEBHOOK_URL|error\.stack/);
});

test('existing workflows are reused with heartbeat nodes and controlled activation',()=>{
  const research=JSON.parse(fs.readFileSync(path.join(root,'workflows/01-two-week-demo.json'),'utf8'));
  const reconcile=JSON.parse(fs.readFileSync(path.join(root,'workflows/03-phase10-auto-evidence-reconciliation.json'),'utf8'));
  assert.equal(research.id,'dpvPhase1TwoWeekDemo');assert.equal(research.active,true);
  assert.equal(reconcile.id,'dpvPhase10AutoEvidenceReconciliation');assert.equal(reconcile.active,false);
  const startHeartbeat=research.nodes.find(node=>node.name==='02A Record Research Start Heartbeat');
  const endHeartbeat=research.nodes.find(node=>node.name==='15A Record Research End Heartbeat');
  assert.ok(startHeartbeat);assert.ok(endHeartbeat);
  assert.equal(startHeartbeat.onError,'continueRegularOutput');
  assert.equal(endHeartbeat.onError,'continueRegularOutput');
  assert.ok(reconcile.nodes.some(node=>node.name==='08 Record End Heartbeat'));
  assert.match(JSON.stringify(reconcile),/AUTO_EVIDENCE_RECONCILE_MINUTES/);
});
