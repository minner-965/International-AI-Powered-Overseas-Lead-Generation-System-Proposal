import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {publicJob} from '../src/research/ResearchWorkbenchService.js';
import {resolveExportRequest} from '../src/dataExchange/exportPolicy.js';

const source=path=>readFile(new URL(path,import.meta.url),'utf8');

test('B06 cleanup utilities preserve business data and require explicit apply mode',async()=>{
  const [routes,companies]=await Promise.all([
    source('../../../scripts/classify-and-retire-manual-route-tasks.mjs'),
    source('../../../scripts/classify-and-purge-unused-companies.mjs')
  ]);
  for(const classification of ['EMPTY_AUTO_GENERATED_NO_ACTION','DUPLICATE_COMPANY_ROUTE_TASK','HAS_REVIEW_AUDIT','AMBIGUOUS']){
    assert.match(routes,new RegExp(classification));
  }
  assert.match(routes,/BUSINESS_DATA_DELTA|Business preservation invariant/);
  assert.match(routes,/--apply/);
  assert.match(companies,/SAFE_UNUSED_TEST_OR_MERGED_DUPLICATE/);
  assert.match(companies,/refs\.count===0/);
  assert.match(companies,/--apply/);
});

test('B07 queued jobs expose honest automatic queue timing without a dispatch-pending label',async()=>{
  const projected=publicJob({id:'job-1',job_type:'CATEGORY_PROCUREMENT_ENRICHMENT',status:'QUEUED',
    dispatch_state:'PENDING',created_at:'2026-09-04T10:00:00.000Z'});
  assert.equal(projected.objective,'COMPANY_CATEGORY_EVIDENCE');
  assert.equal(projected.dispatch_state,'PENDING');
  assert.equal(projected.queued_at,'2026-09-04T10:00:00.000Z');
  assert.equal(projected.expected_worker_status,'QUEUED_OR_ACTIVE');
  const completed=publicJob({id:'job-2',job_type:'CATEGORY_PROCUREMENT_ENRICHMENT',status:'COMPLETED',
    dispatch_state:'DISPATCHED',created_at:'2026-09-04T10:00:00.000Z',completed_at:'2026-09-04T10:01:00.000Z'});
  assert.equal(completed.dispatch_state,'');
  assert.equal(completed.queued_at,null);
  assert.equal(completed.expected_worker_status,null);
  const orchestrator=await source('../src/autoEvidence/AutoEvidenceOrchestrator.js');
  assert.match(orchestrator,/markResearchJobRunning/);
  assert.match(orchestrator,/markResearchJobSettled/);
  assert.match(orchestrator,/j\.status IN\('QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING'\)/);
});

test('B08 active UI and export contract use category and contact language',async()=>{
  const [html,app,workbench]=await Promise.all([
    source('../public/index.html'),source('../public/app.js'),source('../public/ui/phase9-research-workbench.js')
  ]);
  const active=`${html}\n${workbench}`;
  for(const forbidden of ['品类采购资料','品类采购关系','Category procurement relationship','官方采购路径','开始处理','等待调度','供应商入口','供应商注册'])assert.doesNotMatch(active,new RegExp(forbidden));
  for(const current of ['公司类目资料','Company Category Evidence','更新联系人资料','Update Contact Details'])assert.match(`${active}\n${app}`,new RegExp(current));
  for(const required of ['Company Category Evidence','Automatically queued','Matched Category','Official Contact Channels']){
    assert.match(`${active}\n${app}`,new RegExp(required));
  }
  const request=resolveExportRequest({exportType:'SALES_OPPORTUNITY',format:'XLSX',mode:'CURRENT_FILTER',
    requesterRole:'MANAGEMENT',requesterIdentity:'manager@example.com'});
  for(const required of ['matched_categories','category_evidence','official_email','official_phone','official_whatsapp',
    'official_contact_page','named_buyer','opportunity_status'])assert.ok(request.columns.includes(required));
  for(const retired of ['supplier_access','supplier_vendor_route','buying_evidence','procurement_evidence']){
    assert.ok(!request.columns.includes(retired));
  }
});
