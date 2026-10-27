import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile} from 'node:fs/promises';
import {restrictOptionsToMerchantScope,assertWithinMerchantScope,normalizeBatchInput,ResearchBatchService} from '../src/researchBatch/ResearchBatchService.js';
import {publicJob,publicJobStatus} from '../src/research/ResearchWorkbenchService.js';
import {ResearchDirectDispatchService,ResearchJobDirectExecutor} from '../src/research/ResearchDirectDispatchService.js';
import {createResearchBatchRouter} from '../src/research/researchBatchRouter.js';
import {createResearchRouter} from '../src/research/router.js';
import {jobCategoryLabel} from '../public/ui/v3/research-jobs.js';
import {initialSelection,scopeRefusalText} from '../public/ui/v3/research-batch.js';

const CAT1='10000000-0000-4000-8000-000000000001',CAT2='10000000-0000-4000-8000-000000000002';
const JOB='20000000-0000-4000-8000-000000000001';
const options=()=>({markets:[{market_code:'AE'},{market_code:'MX'}],categories:[{id:CAT1},{id:CAT2}],buyer_types:[]});
const scope={market_codes:['AE'],category_scope_ids:[CAT1]};

test('B4 merchant scope narrows options and refuses out-of-scope choices with 422 codes',()=>{
  const narrowed=restrictOptionsToMerchantScope(options(),scope);
  assert.deepEqual(narrowed.markets.map(m=>m.market_code),['AE']);assert.deepEqual(narrowed.categories.map(c=>c.id),[CAT1]);
  assert.equal(restrictOptionsToMerchantScope(options(),null).markets.length,2);
  assert.doesNotThrow(()=>assertWithinMerchantScope(normalizeBatchInput({market_codes:['ae'],category_scope_ids:[CAT1]}),scope));
  assert.doesNotThrow(()=>assertWithinMerchantScope(normalizeBatchInput({select_all_markets:true,select_all_categories:true}),scope));
  assert.throws(()=>assertWithinMerchantScope(normalizeBatchInput({market_codes:['AE'],category_scope_ids:[CAT2]}),scope),
    error=>error.code==='MERCHANT_SCOPE_CATEGORY'&&error.status===422&&error.details.category_scope_ids[0]===CAT2);
  assert.throws(()=>assertWithinMerchantScope(normalizeBatchInput({market_codes:['MX'],category_scope_ids:[CAT1]}),scope),{code:'MERCHANT_SCOPE_MARKET',status:422});
  assert.throws(()=>assertWithinMerchantScope(normalizeBatchInput({select_all_markets:true,select_all_categories:true}),{market_codes:[],category_scope_ids:[]}),{code:'MERCHANT_SCOPE_CATEGORY'});
  assert.doesNotThrow(()=>assertWithinMerchantScope(normalizeBatchInput({market_codes:['MX'],category_scope_ids:[CAT2]}),null));
});

test('B4 options read the merchant scope only for merchant actors',async()=>{
  const queries=[];
  const pool={async query(sql){queries.push(sql);
    if(sql.includes('research_market_registry'))return{rows:[{market_code:'AE',status:'ACTIVE',search_enabled:true},{market_code:'MX',status:'ACTIVE',search_enabled:true}]};
    if(sql.includes('dpv_product_category_scope_current'))return{rows:[{id:CAT1,category_code:'DRESSES'},{id:CAT2,category_code:'TOPS'}]};
    if(sql.includes('merchant_scope'))return{rows:[scope]};
    return{rows:[]};}};
  const service=new ResearchBatchService({pool});
  const all=await service.options();
  assert.equal(all.categories.length,2);assert.equal(all.categories[0].label_zh,'连衣裙');assert.equal(all.categories[0].label_en,'Dresses');
  assert.ok(!queries.some(sql=>sql.includes('merchant_scope')));
  const mine=await service.options(undefined,{merchant_id:'m-1'});
  assert.deepEqual(mine.categories.map(c=>c.id),[CAT1]);assert.deepEqual(mine.markets.map(m=>m.market_code),['AE']);
  await assert.rejects(()=>service.preview({market_codes:['MX'],category_scope_ids:[CAT1]},{merchant_id:'m-1'}),{code:'MERCHANT_SCOPE_MARKET'});
});

test('B3/B5 job projection: cancelled status, category label and cancel permission',()=>{
  assert.equal(publicJobStatus({status:'FAILED',stop_reason_code:'OPERATOR_CANCELLED'}),'CANCELLED');
  assert.equal(publicJobStatus({status:'FAILED',stop_reason_code:'HUNTER_AUTHENTICATION_FAILED'}),'FAILED_FINAL');
  const cancelled=publicJob({id:JOB,status:'FAILED',stop_reason_code:'OPERATOR_CANCELLED',product_category:'DRESSES',product_profile:'WOMENSWEAR'});
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.blocker,null);assert.equal(cancelled.can_cancel,false);
  assert.equal(cancelled.category_label_zh,'连衣裙');assert.equal(cancelled.category_label_en,'Dresses');
  assert.equal(publicJob({id:JOB,status:'QUEUED',product_category:'Opportunity evidence'}).category_label_zh,null);
  const queued={id:JOB,status:'DISCOVERING',merchant_id:'m-1'};
  assert.equal(publicJob(queued).can_cancel,true);
  assert.equal(publicJob(queued,{restrict:true,admin:false,merchantId:'m-1'}).can_cancel,true);
  assert.equal(publicJob(queued,{restrict:true,admin:false,merchantId:'m-2'}).can_cancel,false);
  assert.equal(publicJob(queued,{restrict:true,admin:true,merchantId:'m-2'}).can_cancel,true);
});

test('B3 dispatcher never enqueues a cancelled job and closes its open outbox',async()=>{
  const sql=[];const queue={calls:0,async enqueue(){this.calls+=1;return 'q';}};
  const pool={async query(text){sql.push(text);
    if(text.includes('SELECT o.*,j.status job_status'))return{rowCount:1,rows:[{research_job_id:JOB,dispatch_state:'RETRY_PENDING',job_status:'FAILED',job_stop_reason:'OPERATOR_CANCELLED'}]};
    return{rowCount:1,rows:[]};}};
  const result=await new ResearchDirectDispatchService({pool,queue}).dispatch(JOB);
  assert.equal(result.state,'CANCELLED');assert.equal(queue.calls,0);
  assert.ok(sql.some(text=>text.includes("dispatch_state='FAILED',last_error_code='OPERATOR_CANCELLED'")));
  const reconcileSql=[];
  await new ResearchDirectDispatchService({pool:{async query(text){reconcileSql.push(text);return{rowCount:0,rows:[]};}},queue}).reconcile();
  assert.match(reconcileSql[0],/stop_reason_code='OPERATOR_CANCELLED'/);
});

test('B3 executor skips a cancelled job and stops a running one at the next checkpoint',async()=>{
  const closed=[];
  const replayPool={async query(text){
    if(text.includes("dispatch_state='PROCESSING'"))return{rowCount:0,rows:[]};
    if(text.includes('SELECT dispatch_state,checkpoint,last_error_code'))return{rowCount:1,rows:[{dispatch_state:'RETRY_PENDING',checkpoint:'QUERIES_GENERATED',job_stop_reason:'OPERATOR_CANCELLED'}]};
    if(text.includes("last_error_code='OPERATOR_CANCELLED'")){closed.push(text);return{rowCount:1,rows:[]};}
    throw new Error(`unexpected ${text}`);}};
  const replay=await new ResearchJobDirectExecutor({pool:replayPool}).execute({research_job_id:JOB,execution_key:'k'});
  assert.deepEqual({status:replay.status,idempotent:replay.idempotent_replay},{status:'CANCELLED',idempotent:true});assert.equal(closed.length,1);
  let cancelled=false;const stages=[];
  const runPool={async query(text){
    if(text.includes("dispatch_state='PROCESSING'"))return{rowCount:1,rows:[{checkpoint:'CREATED'}]};
    if(text.includes('UPDATE leadgen.research_jobs SET status'))return{rowCount:cancelled?0:1,rows:[]};
    if(text.includes('SET checkpoint=$2'))return{rowCount:cancelled?0:1,rows:[]};
    if(text.includes("last_error_code='OPERATOR_CANCELLED'"))return{rowCount:1,rows:[]};
    throw new Error(`unexpected ${text}`);}};
  const executor=new ResearchJobDirectExecutor({pool:runPool,stages:{generateQueries:async()=>{stages.push('generate');cancelled=true;},discover:async()=>stages.push('discover')}});
  const result=await executor.execute({research_job_id:JOB,execution_key:'k'});
  assert.equal(result.status,'CANCELLED');assert.deepEqual(stages,['generate']);
});

async function serve(t,app){
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return (path,method='GET',role='MANAGEMENT')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json','x-role':role},body:method==='GET'?undefined:'{}'});
}
const auth={authenticate:(req,_res,next)=>{req.managementUser={identity:'tester',role:req.get('x-role'),merchant_id:null};next();},
  requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.sendStatus(403)};

test('B3/B4 routes: cancel endpoints, refusal codes and merchant-scope 422 responses',async t=>{
  const calls=[];
  const cancellation={async cancelBatch(id,actor){calls.push(['batch',id,actor.identity]);return{batch_id:id,status:'CANCELLED'};},
    async cancelJob(id){if(id===JOB)throw Object.assign(new Error('shared'),{code:'RESEARCH_JOB_SHARED',status:409});return{job_id:id};}};
  const batchService={options:async(_q,actor)=>({actor}),preview:async()=>{throw Object.assign(new Error('MERCHANT_SCOPE_MARKET'),{code:'MERCHANT_SCOPE_MARKET',status:422,details:{market_codes:['MX']}});},
    list:async()=>({items:[]}),get:async id=>({id}),create:async()=>({})};
  const app=express();app.use(express.json());
  app.use('/api/research',createResearchRouter({service:{assertReadRole(){},pool:null},managementAuth:auth,cancellation}));
  app.use('/api/research/batches',createResearchBatchRouter({service:batchService,managementAuth:auth,cancellation}));
  const request=await serve(t,app);
  assert.equal((await (await request(`/api/research/batches/${JOB}/cancel`,'POST')).json()).status,'CANCELLED');
  assert.equal((await request(`/api/research/batches/${JOB}/cancel`,'POST','SALES')).status,403);
  const shared=await request(`/api/research/jobs/${JOB}/cancel`,'POST');
  assert.equal(shared.status,409);assert.equal((await shared.json()).code,'RESEARCH_JOB_SHARED');
  assert.equal((await request('/api/research/jobs/not-a-uuid/cancel','POST')).status,400);
  const refused=await request('/api/research/batches/preview','POST');
  assert.equal(refused.status,422);assert.deepEqual(await refused.json(),{error:'MERCHANT_SCOPE_MARKET',code:'MERCHANT_SCOPE_MARKET',details:{market_codes:['MX']}});
  assert.equal((await (await request('/api/research/batches/options')).json()).actor.identity,'tester');
  assert.deepEqual(calls,[['batch',JOB,'tester']]);
});

test('B4/B5 front end: category labels, merchant scope preselection and cancel controls',async()=>{
  assert.deepEqual(jobCategoryLabel({category_label_zh:'连衣裙',category_label_en:'Dresses'}),['连衣裙','Dresses']);
  assert.equal(jobCategoryLabel({product_category:'DRESSES'}),null);
  const opts={markets:[{market_code:'AE'},{market_code:'MX'}],categories:[{id:CAT1},{id:CAT2}]};
  assert.deepEqual(initialSelection({},opts,scope),{market_codes:['AE'],category_scope_ids:[CAT1]});
  assert.deepEqual(initialSelection({},opts,null),{market_codes:['AE'],category_scope_ids:[CAT1]});
  assert.deepEqual(initialSelection({market_codes:['MX'],category_scope_ids:[CAT2]},opts,scope),{market_codes:['MX'],category_scope_ids:[CAT2]});
  assert.deepEqual(initialSelection({},opts,{market_codes:['MX'],category_scope_ids:[CAT1,CAT2]}),{market_codes:['MX'],category_scope_ids:[CAT1,CAT2]});
  assert.match(scopeRefusalText('MERCHANT_SCOPE_CATEGORY')[0],/业务范围/);assert.equal(scopeRefusalText('OTHER'),null);
  const workbench=await readFile(new URL('../public/ui/phase9-research-workbench.js',import.meta.url),'utf8');
  assert.match(workbench,/data-cancel-job/);assert.match(workbench,/\/cancel`/);assert.match(workbench,/jobCategoryLabel\(job\)/);
  assert.match(workbench,/'已取消 \/ Cancelled','CANCELLED'/);
  const batch=await readFile(new URL('../public/ui/v3/research-batch.js',import.meta.url),'utf8');
  assert.match(batch,/\/api\/merchant\/scope/);assert.match(batch,/data-cancel-batch|cancelBatch/);
});
