import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {existsSync} from 'node:fs';
import test from 'node:test';
import pg from 'pg';

const moduleUrl=existsSync(new URL('../../../scripts/classify-and-purge-empty-research-jobs.mjs',import.meta.url))
  ?new URL('../../../scripts/classify-and-purge-empty-research-jobs.mjs',import.meta.url)
  :new URL('../project-scripts/classify-and-purge-empty-research-jobs.mjs',import.meta.url);
const {ResearchJobPurgeClassifier}=await import(moduleUrl);
const database=process.env.PHASE10_EMPTY_PURGE_TEST_DATABASE||'';
const connectionString=database
  ?`postgresql://${encodeURIComponent(process.env.POSTGRES_USER||'leadgen')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD||'')}@${process.env.POSTGRES_HOST||'postgres'}:${process.env.POSTGRES_PORT||'5432'}/${database}`:'';
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const pool=connectionString?new pg.Pool({connectionString,max:8}):null;

async function transaction(run){
  const client=await pool.connect();await client.query('BEGIN');
  try{return await run(client);}finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
}
async function job(client,{status='FAILED',started=false,digestKey=crypto.randomUUID(),jobType='COMPANY_DISCOVERY'}={}){
  return(await client.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,market_profile,product_category,buyer_types,max_results,status,job_type,
     idempotency_key,request_digest,dispatch_execution_key,created_by_identity,created_by_role,started_at,completed_at)
    VALUES('AE','AE','United Arab Emirates','TEST','Empty purge fixture',ARRAY['Buyer'],1,$1,$2,$3,$4,$5,
      'phase10-empty-purge-test','SYSTEM',$6,CASE WHEN $1 IN('FAILED','COMPLETED','COMPLETE','PARTIAL') THEN now() END)
    RETURNING *`,[status,jobType,`purge-${crypto.randomUUID()}`,digest(digestKey),`dispatch-${crypto.randomUUID()}`,started?new Date():null])).rows[0];
}
async function classify(client,row){return new ResearchJobPurgeClassifier({pool}).classifyJob(row,{client,unknownColumns:[]});}
async function company(client,researchJobId=null){return(await client.query(`INSERT INTO leadgen.companies
  (company_name,normalized_domain,country_code,research_job_id) VALUES($1,$2,'AE',$3) RETURNING *`,[
  `Purge Fixture ${crypto.randomUUID()}`,`purge-${crypto.randomUUID()}.invalid`,researchJobId])).rows[0];}
async function taskFor(client,row,{status='CANCELLED',stage=null,replay=0}={}){
  const c=await company(client);
  return(await client.query(`INSERT INTO leadgen.auto_evidence_tasks
    (company_id,product_profile,contact_research_job_id,business_blocker,evidence_revision,execution_key,
     task_status,current_stage,automation_owner,attempt_count,max_attempts,budget_state,input_digest,
     strategy_attempt_count,checkpoint_replay_count,retry_at)
    VALUES($1,'WOMENSWEAR',$2,'NEEDS_BUYER_CONTACT',1,$3,$4,$5,'SYSTEM',0,10,'NOT_REQUIRED',$6,0,$7,
      CASE WHEN $4='RETRY_SCHEDULED' THEN now()+interval '5 minutes' END)
    RETURNING *`,[c.id,row.id,`purge-task-${crypto.randomUUID()}`,status,stage,digest(crypto.randomUUID()),replay])).rows[0];
}
async function providerEvent(client,row,{used=0,requestId=null}={}){await client.query(`INSERT INTO leadgen.provider_usage_events
  (research_job_id,provider,endpoint,request_fingerprint,status,billing_period,used_units,provider_request_id,completed_at)
  VALUES($1,'TAVILY','search',$2,'COMPLETED','2026-09',$3,$4,now())`,[row.id,digest(crypto.randomUUID()),used,requestId]);}
async function pendingOutbox(client,row){await client.query(`INSERT INTO leadgen.research_job_dispatch_outbox
  (research_job_id,execution_key,dispatch_state) VALUES($1,$2,'PENDING')`,[row.id,`purge-outbox-${crypto.randomUUID()}`]);}
async function candidate(client,row){
  const query=(await client.query(`INSERT INTO leadgen.research_search_queries
    (research_job_id,query_text,query_type,country,product_category,provider)
    VALUES($1,'fixture','buyer_category','AE','Womenswear','TAVILY') RETURNING id`,[row.id])).rows[0];
  await client.query(`INSERT INTO leadgen.research_candidates
    (research_job_id,search_query_id,provider,title,url,normalized_url,root_domain,rank,candidate_type,captured_at)
    VALUES($1,$2,'TAVILY','Fixture','https://fixture.invalid','https://fixture.invalid','fixture.invalid',1,'POSSIBLE_COMPANY_SITE',now())`,[row.id,query.id]);
}
async function decision(client,row,status){
  const c=await company(client);
  await client.query('ALTER TABLE leadgen.business_opportunity_decision_snapshots DISABLE TRIGGER ALL');
  try{await client.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots
    (research_job_id,company_id,product_profile,buyer_business_model_result_id,category_procurement_match_result_id,
     cooperation_feasibility_result_id,system_recommendation_status,relationship_status,rule_version,assessment_revision,input_digest)
    VALUES($1,$2,'WOMENSWEAR',$3,$4,$5,$6,'NEW_PROSPECT','purge-test',1,$7)`,[
    row.id,c.id,crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),status,digest(crypto.randomUUID())]);}
  finally{await client.query('ALTER TABLE leadgen.business_opportunity_decision_snapshots ENABLE TRIGGER ALL');}
}

test('01 never dispatched empty job is hard-delete eligible',{skip:!pool},()=>transaction(async client=>{
  const result=await classify(client,await job(client));assert.equal(result.classification,'EMPTY_NEVER_STARTED');assert.equal(result.hard_delete_eligible,true);
}));
test('02 dispatch failure before queue is eligible',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await client.query(`INSERT INTO leadgen.research_job_dispatch_outbox(research_job_id,execution_key,dispatch_state,last_error_code)
    VALUES($1,$2,'COMPLETED','DISPATCH_FAILED_BEFORE_QUEUE')`,[row.id,`purge-${crypto.randomUUID()}`]);assert.equal((await classify(client,row)).hard_delete_eligible,true);
}));
test('03 worker start before provider side effect is eligible',{skip:!pool},()=>transaction(async client=>{
  const result=await classify(client,await job(client,{started:true}));assert.equal(result.classification,'EMPTY_FAILED_BEFORE_SIDE_EFFECT');assert.equal(result.hard_delete_eligible,true);
}));
test('04 duplicate empty job is identified',{skip:!pool},()=>transaction(async client=>{
  const key=crypto.randomUUID();await job(client,{digestKey:key});const duplicate=await job(client,{digestKey:key});assert.equal((await classify(client,duplicate)).classification,'DUPLICATE_EMPTY_TASK');
}));
test('04a stale queued orphan without output or live execution is hard-delete eligible',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client,{status:'QUEUED'});
  const stale=(await client.query(`UPDATE leadgen.research_jobs SET created_at=now()-interval '2 hours' WHERE id=$1 RETURNING *`,[row.id])).rows[0];
  const result=await classify(client,stale);
  assert.equal(result.classification,'EMPTY_STALE_ORPHAN');
  assert.equal(result.hard_delete_eligible,true);
}));
test('05 provider usage event blocks hard delete',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await providerEvent(client,row);const result=await classify(client,row);assert.equal(result.classification,'PROVIDER_USED_NO_BUSINESS_RESULT');assert.equal(result.hard_delete_eligible,false);
}));
test('06 used units block hard delete',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await providerEvent(client,row,{used:2,requestId:'fixture-request'});const result=await classify(client,row);assert.equal(result.provider_used_units,2);assert.equal(result.hard_delete_eligible,false);
}));
test('07 recoverable checkpoint blocks hard delete',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client,{jobType:'DECISION_MAKER_ENRICHMENT'});await taskFor(client,row,{status:'RETRY_SCHEDULED',stage:'VERIFYING_EMAIL',replay:1});const result=await classify(client,row);assert.equal(result.checkpoint_count,1);assert.equal(result.classification,'ACTIVE_OR_RECOVERABLE');
}));
test('08 continuation lineage blocks hard delete',{skip:!pool},()=>transaction(async client=>{
  const original=await job(client);await client.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,market_profile,product_category,buyer_types,max_results,status,job_type,
     dispatch_execution_key,resumed_from_research_job_id,resume_execution_key,resume_checkpoint_replay_count,resume_stage)
     VALUES('AE','AE','United Arab Emirates','TEST','Fixture',ARRAY['Buyer'],1,'FAILED','COMPANY_DISCOVERY',$1,$2,$3,1,'VERIFYING_EMAIL')`,[
    `dispatch-${crypto.randomUUID()}`,original.id,`resume-${crypto.randomUUID()}`]);assert.ok((await classify(client,original)).continuation_count>0);
}));
test('09 newly discovered company preserves the job',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await company(client,row.id);assert.equal((await classify(client,row)).classification,'BUSINESS_OUTPUT_PRESENT');
}));
test('10 saved candidate/source evidence preserves the job',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await candidate(client,row);assert.ok((await classify(client,row)).business_output_reference_count>0);
}));
test('11 NOT_SUITABLE decision preserves the job',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await decision(client,row,'NOT_SUITABLE');assert.equal((await classify(client,row)).classification,'BUSINESS_OUTPUT_PRESENT');
}));
test('12 EVIDENCE_REQUIRED decision preserves the job',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await decision(client,row,'EVIDENCE_REQUIRED');assert.equal((await classify(client,row)).classification,'BUSINESS_OUTPUT_PRESENT');
}));
test('13 pending outbox blocks hard delete',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await pendingOutbox(client,row);const result=await classify(client,row);assert.equal(result.pending_outbox_count,1);assert.equal(result.hard_delete_eligible,false);
}));
test('14 live pg-boss job blocks hard delete',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await client.query(`INSERT INTO pgboss.job(name,data,state) VALUES('execute-research-job',$1::jsonb,'created')`,[JSON.stringify({job_id:row.id})]);const result=await classify(client,row);assert.equal(result.live_queue_job_count,1);assert.equal(result.hard_delete_eligible,false);
}));
test('15 state change before purge becomes race-abort eligible false',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);assert.equal((await classify(client,row)).hard_delete_eligible,true);await pendingOutbox(client,row);assert.equal((await classify(client,row)).hard_delete_eligible,false);
}));
test('16 purge replay deletes zero additional jobs',{skip:!pool},async()=>{
  const classifier=new ResearchJobPurgeClassifier({pool});const row=await job(pool);
  const first=await classifier.purgeEligible({jobId:row.id});const second=await classifier.purgeEligible({jobId:row.id});
  assert.equal(first.results.filter(item=>item.status==='DELETED').length,1);assert.equal(second.results.length,0);
});
test('17 provider usage rows are retained because their job is rejected',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await providerEvent(client,row,{used:1});assert.equal((await classify(client,row)).hard_delete_eligible,false);
  assert.equal((await client.query(`SELECT count(*)::int count FROM leadgen.provider_usage_events WHERE research_job_id=$1`,[row.id])).rows[0].count,1);
}));
test('18 business rows are retained because their job is rejected',{skip:!pool},()=>transaction(async client=>{
  const row=await job(client);await company(client,row.id);assert.equal((await classify(client,row)).hard_delete_eligible,false);
  assert.equal((await client.query(`SELECT count(*)::int count FROM leadgen.companies WHERE research_job_id=$1`,[row.id])).rows[0].count,1);
}));
test('19 classification has zero email delta',{skip:!pool},()=>transaction(async client=>{
  const before=(await client.query(`SELECT count(*)::int count FROM leadgen.outbound_messages`)).rows[0].count;
  await classify(client,await job(client));const after=(await client.query(`SELECT count(*)::int count FROM leadgen.outbound_messages`)).rows[0].count;assert.equal(after,before);
}));
test('20 classification has zero CRM delta',{skip:!pool},()=>transaction(async client=>{
  const before=(await client.query(`SELECT count(*)::int count FROM leadgen.crm_sync_outbox`)).rows[0].count;
  await classify(client,await job(client));const after=(await client.query(`SELECT count(*)::int count FROM leadgen.crm_sync_outbox`)).rows[0].count;assert.equal(after,before);
}));

test.after(async()=>{if(pool)await pool.end();});
