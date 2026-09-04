import assert from 'node:assert/strict';
import test from 'node:test';
import {ResearchDirectDispatchService,ResearchJobDirectExecutor} from '../src/research/ResearchDirectDispatchService.js';

function harness(){
  const state={job:{id:'JOB-1',status:'QUEUED',dispatch_execution_key:'research-job:JOB-1'},outbox:null,queries:[],queueCalls:[],tx:[]};
  const client={query:async(sql,params=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){state.tx.push(sql);return{rows:[]};}
    if(sql.includes('INSERT INTO leadgen.research_job_dispatch_outbox')){state.outbox={research_job_id:params[0],execution_key:params[1],dispatch_state:'PENDING',checkpoint:'CREATED'};return{rows:[]};}
    throw new Error(`Unexpected client SQL: ${sql}`);
  },release(){}};
  const pool={connect:async()=>client,query:async(sql,params=[])=>{
    if(sql.includes('SELECT o.*,j.status job_status'))return{rowCount:state.outbox?1:0,rows:state.outbox?[{...state.outbox,job_status:state.job.status}]:[]};
    if(sql.includes('INSERT INTO leadgen.research_job_dispatch_outbox')){state.outbox={research_job_id:params[0],execution_key:state.job.dispatch_execution_key,dispatch_state:'PENDING',checkpoint:'CREATED'};return{rows:[],rowCount:1};}
    if(sql.includes("dispatch_state='DISPATCHED'")){state.outbox.dispatch_state='DISPATCHED';state.outbox.queue_job_id=params[1];return{rows:[]};}
    if(sql.includes('UPDATE leadgen.research_jobs SET dispatch_state'))return{rows:[]};
    if(sql.includes("dispatch_state='RETRY_PENDING'")){state.outbox.dispatch_state='RETRY_PENDING';return{rows:[]};}
    throw new Error(`Unexpected pool SQL: ${sql}`);
  }};
  const queue={enqueue:async(name,data,options)=>{state.queueCalls.push({name,data,options});return 'QUEUE-1';}};
  return{state,pool,queue,service:new ResearchDirectDispatchService({pool,queue})};
}

test('n8n can be absent while enabled direct mode commits one outbox and queues the canary',async()=>{
  const h=harness();
  const result=await h.service.createAtomic(async()=>({...h.state.job,inserted:true}));
  assert.deepEqual(h.state.tx,['BEGIN','COMMIT']);assert.equal(result.dispatch.state,'DISPATCHED');
  assert.equal(h.state.queueCalls.length,1);assert.equal(h.state.queueCalls[0].data.research_job_id,'JOB-1');
  assert.equal(h.state.queueCalls[0].options.singletonKey,'research-job:JOB-1');
});

test('transaction rollback leaves no queue side effect',async()=>{
  const h=harness();
  await assert.rejects(()=>h.service.createAtomic(async()=>{throw new Error('rollback');}),/rollback/);
  assert.deepEqual(h.state.tx,['BEGIN','ROLLBACK']);assert.equal(h.state.queueCalls.length,0);assert.equal(h.state.outbox,null);
});

test('duplicate POST result returns the original job without a second outbox or queue call',async()=>{
  const h=harness();
  const result=await h.service.createAtomic(async()=>({...h.state.job,inserted:false}));
  assert.equal(result.job.id,'JOB-1');assert.equal(result.dispatch,null);assert.equal(h.state.outbox,null);assert.equal(h.state.queueCalls.length,0);
});

test('watchdog repair creates a missing outbox before direct dispatch',async()=>{
  const h=harness();const result=await h.service.dispatch('JOB-1');
  assert.equal(result.state,'DISPATCHED');assert.ok(h.state.outbox);assert.equal(h.state.queueCalls.length,1);
});

test('n8n retrigger uses the same singleton execution key',async()=>{
  const h=harness();h.state.outbox={research_job_id:'JOB-1',execution_key:'research-job:JOB-1',dispatch_state:'PENDING',checkpoint:'CREATED'};
  await h.service.dispatch('JOB-1');await h.service.dispatch('JOB-1');
  assert.equal(h.state.queueCalls.length,2);
  assert.deepEqual(new Set(h.state.queueCalls.map(call=>call.options.singletonKey)),new Set(['research-job:JOB-1']));
});

test('worker restart resumes from checkpoint and provider ledger prevents another network charge',async()=>{
  const state={checkpoint:'CREATED',status:'QUEUED'};let generateCalls=0;let providerNetworkCalls=0;let discoverInvocations=0;
  let completionClearsError=false;
  const pool={query:async(sql,params=[])=>{
    if(sql.includes("dispatch_state='PROCESSING'"))return{rowCount:1,rows:[{checkpoint:state.checkpoint}]};
    if(sql.includes('SET checkpoint=$2')){state.checkpoint=params[1];return{rows:[]};}
    if(sql.includes('UPDATE leadgen.research_jobs SET status')){state.status=params[1];return{rows:[]};}
    if(sql.includes("dispatch_state='COMPLETED'")){completionClearsError=sql.includes('last_error_code=NULL')&&sql.includes('next_attempt_at=NULL');return{rows:[]};}
    if(sql.includes("dispatch_state='RETRY_PENDING'")){return{rows:[]};}
    throw new Error(`Unexpected executor SQL: ${sql}`);
  }};
  const settled=new Set();let failOnce=true;
  const executor=new ResearchJobDirectExecutor({pool,stages:{
    generateQueries:async()=>{generateCalls+=1;},
    discover:async()=>{discoverInvocations+=1;if(!settled.has('JOB-1')){providerNetworkCalls+=1;settled.add('JOB-1');}if(failOnce){failOnce=false;throw new Error('worker restart');}},
    checkContacts:async()=>{},verify:async()=>{},score:async()=>{},completed:async()=>{}
  }});
  await assert.rejects(()=>executor.execute({research_job_id:'JOB-1',execution_key:'research-job:JOB-1'}),/worker restart/);
  const result=await executor.execute({research_job_id:'JOB-1',execution_key:'research-job:JOB-1'});
  assert.equal(result.status,'COMPLETED');assert.equal(generateCalls,1);assert.equal(discoverInvocations,2);assert.equal(providerNetworkCalls,1);
  assert.equal(completionClearsError,true);
});

test('direct outbox dispatch is mandatory and has no legacy feature flag',async()=>{
  const h=harness();const result=await h.service.createAtomic(async()=>({...h.state.job,inserted:true}));
  assert.equal(result.dispatch.state,'DISPATCHED');assert.ok(h.state.outbox);assert.equal(h.state.queueCalls.length,1);
});

test('target-category input errors terminate the outbox and replay without retrying',async()=>{
  const state={dispatch:'DISPATCHED',checkpoint:'CREATED',attempts:0,stageCalls:0};
  const pool={query:async(sql,params=[])=>{
    if(sql.includes("dispatch_state='PROCESSING'")){
      if(['COMPLETED','FAILED'].includes(state.dispatch))return{rowCount:0,rows:[]};
      state.dispatch='PROCESSING';state.attempts+=1;return{rowCount:1,rows:[{checkpoint:state.checkpoint}]};
    }
    if(sql.includes('SELECT dispatch_state,checkpoint,last_error_code'))return{rowCount:1,rows:[{
      dispatch_state:state.dispatch,checkpoint:state.checkpoint,last_error_code:'TARGET_CATEGORY_REQUIRED'
    }]};
    if(sql.includes("dispatch_state='FAILED'")){state.dispatch='FAILED';return{rows:[]};}
    if(sql.includes("status='FAILED'"))return{rows:[]};
    if(sql.includes('UPDATE leadgen.research_jobs SET status'))return{rows:[]};
    throw new Error(`Unexpected non-retryable SQL: ${sql} ${params.length}`);
  }};
  const executor=new ResearchJobDirectExecutor({pool,stages:{generateQueries:async()=>{
    state.stageCalls+=1;throw Object.assign(new Error('category required'),{
      code:'TARGET_CATEGORY_REQUIRED',retryable:false,classification:'NON_RETRYABLE_INPUT_ERROR'
    });
  }}});
  const first=await executor.execute({research_job_id:'JOB-INPUT',execution_key:'research-job:JOB-INPUT'});
  const replay=await executor.execute({research_job_id:'JOB-INPUT',execution_key:'research-job:JOB-INPUT'});
  assert.deepEqual({status:first.status,retryable:first.retryable},{status:'FAILED',retryable:false});
  assert.deepEqual({status:replay.status,idempotent:replay.idempotent_replay},{status:'FAILED',idempotent:true});
  assert.equal(state.attempts,1);assert.equal(state.stageCalls,1);
});
