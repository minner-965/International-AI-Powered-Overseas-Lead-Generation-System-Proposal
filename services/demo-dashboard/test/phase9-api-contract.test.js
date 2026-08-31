import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=name=>readFile(new URL(`../src/${name}`,import.meta.url),'utf8');

test('workbench read routes are management-authenticated and expose the five bounded read models',async()=>{
  const router=await read('research/router.js');
  assert.match(router,/router\.use\(managementAuth\.authenticate,readRoles\)/);
  for(const route of ['/workbench-summary','/tasks','/jobs','/jobs/:id','/jobs/:id/results']){
    assert.match(router,new RegExp(`router\\.get\\('${route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  }
  assert.match(router,/requireRoles\('MANAGEMENT','DATA_ADMIN','SALES'\)/);
});

test('Phase 9 mutation paths persist identity, digest, budget and bounded wave before dispatch',async()=>{
  const server=await read('server.js');
  for(const field of ['idempotency_key','request_digest','created_by_identity','created_by_role','research_wave','run_budget_cap_units']){
    assert.match(server,new RegExp(field));
  }
  assert.match(server,/researchWave==='A'\?5:researchWave==='B'\?15:100/);
  assert.match(server,/freezeCohort\(\{jobId:job\.id,wave:researchWave,items:selectedCohort\}\)/);
  assert.match(server,/assertWaveBGate\(waveAJobId\)/);
  assert.match(server,/randomUUID\(\)/);
});

test('research projections never return provider payloads, credentials or stored error text',async()=>{
  const service=await read('research/ResearchWorkbenchService.js');
  const publicJobBlock=service.slice(service.indexOf('function publicJob('),service.indexOf('export class ResearchWorkbenchService'));
  for(const forbidden of ['result_payload','api_key','request_digest','idempotency_key','last_error:']){
    assert.equal(publicJobBlock.includes(forbidden),false,`public job exposed ${forbidden}`);
  }
  assert.match(service,/boundedInt\(query\.limit,\{min:1,max:100/);
  assert.match(service,/decodeCursor\(query\.cursor\)/);
});

test('enrichment and category result readers now share the management read boundary',async()=>{
  const server=await read('server.js');
  for(const prefix of [
    "app.get('/api/enrichment/jobs', managementAuth.authenticate",
    "app.get('/api/enrichment/jobs/:id', managementAuth.authenticate",
    "app.get('/api/enrichment/jobs/:id/results', managementAuth.authenticate",
    "app.get('/api/category-procurement/jobs/:id', managementAuth.authenticate",
    "app.get('/api/category-procurement/jobs/:id/results', managementAuth.authenticate"
  ])assert.ok(server.includes(prefix),`missing read boundary: ${prefix}`);
});

test('manual email verification is restricted to data or management roles',async()=>{
  const router=await read('phase7/router.js');
  assert.match(router,/const DATA_ROLES = Object\.freeze\(\['DATA_ADMIN','MANAGEMENT'\]\)/);
  assert.match(router,/router\.post\('\/api\/contacts\/:id\/hunter-verify', \.\.\.dataWrite/);
});
