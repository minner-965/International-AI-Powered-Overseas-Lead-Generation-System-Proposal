import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {aggregateProviderUsage} from '../src/research/providerUsageProjection.js';
import {publicJob} from '../src/research/ResearchWorkbenchService.js';
import {resolveExportRequest} from '../src/dataExchange/index.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const event=(id,status,extra={})=>({id,provider:'TAVILY',request_fingerprint:id,research_job_id:'job-a',company_id:'company-a',
  status,reserved_units:0,used_units:0,released_units:0,created_at:`2026-09-02T00:00:0${id.length}Z`,...extra});

test('four canonical ledger events project as four provider calls',()=>{
  const [row]=aggregateProviderUsage([event('a','COMPLETED'),event('b','NOT_FOUND'),event('c','COMPLETED'),event('d','NOT_FOUND')]);
  assert.equal(row.provider_call_count,4);assert.equal(row.provider_completed_count,2);assert.equal(row.provider_not_found_count,2);
});

test('replay with the same provider fingerprint does not double-charge or increment calls',()=>{
  const original=event('same','COMPLETED',{used_units:1});
  const [row]=aggregateProviderUsage([original,{...original,id:'replay'}]);
  assert.equal(row.provider_call_count,1);assert.equal(row.used_units,1);
});

test('reserved then released units remain separate from used units',()=>{
  const [row]=aggregateProviderUsage([event('released','TEMPORARY_ERROR',{released_units:1})]);
  assert.equal(row.reserved_units,0);assert.equal(row.used_units,0);assert.equal(row.released_units,1);
});

test('NOT_FOUND is a completed provider call and may consume its recorded unit',()=>{
  const [row]=aggregateProviderUsage([event('not-found','NOT_FOUND',{used_units:1})]);
  assert.equal(row.provider_call_count,1);assert.equal(row.provider_not_found_count,1);assert.equal(row.used_units,1);
});

test('temporary-error charging follows ledger units rather than status assumptions',()=>{
  const [row]=aggregateProviderUsage([event('temporary','TEMPORARY_ERROR',{used_units:1,released_units:2})]);
  assert.equal(row.provider_temporary_error_count,1);assert.equal(row.used_units,1);assert.equal(row.released_units,2);
});

test('job and company projections do not mix events across exact identities',()=>{
  const rows=aggregateProviderUsage([event('a1','COMPLETED'),event('a2','COMPLETED',{company_id:'company-b'}),
    event('b1','COMPLETED',{research_job_id:'job-b',company_id:'company-a'})],{byCompany:true});
  assert.equal(rows.length,3);assert.ok(rows.every(row=>row.provider_call_count===1));
});

test('ResearchJob API and Excel export expose the same canonical projection fields',()=>{
  const projected=publicJob({id:'job-a',provider_call_count:4,used_units:4,released_units:1,status:'COMPLETE'});
  assert.equal(projected.search_api_requests,4);assert.equal(projected.search_credits_used,4);
  const request=resolveExportRequest({exportType:'RESEARCH_JOB_PROVIDER_USAGE',format:'XLSX',mode:'CURRENT_FILTER',
    requesterRole:'MANAGEMENT',requesterIdentity:'manager@example.com'});
  for(const field of ['provider_call_count','used_units','released_units','projection_updated_at'])assert.ok(request.columns.includes(field));
  const service=fs.readFileSync(path.join(root,'services/demo-dashboard/src/research/ResearchWorkbenchService.js'),'utf8');
  const exportService=fs.readFileSync(path.join(root,'services/demo-dashboard/src/phase7/service.js'),'utf8');
  assert.match(service,/research_job_provider_usage_summary/);assert.match(exportService,/research_job_provider_usage_summary/);
});

test('035 creates rebuildable live projections without rewriting historical provider events',()=>{
  const sql=fs.readFileSync(path.join(root,'database/migrations/035_phase10_provider_usage_projection.sql'),'utf8');
  assert.match(sql,/CREATE OR REPLACE VIEW leadgen\.research_job_provider_usage_summary/);
  assert.match(sql,/provider_usage_projection_reconciliation_runs/);
  assert.match(sql,/ON CONFLICT \(execution_key\) DO NOTHING/);
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\.provider_usage_events/i);
});
