import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { applyPhase7Migration, applyPhase7Migrations } from '../src/phase7/migrationRunner.js';
import { Phase7Repository } from '../src/phase7/repository.js';
import { Phase7Service, validateCrmPayload } from '../src/phase7/service.js';
import { CrmService } from '../src/crm/service.js';

// Runs against a throwaway database cloned from a template that has migrations 001–063 applied:
// CRM_PIPELINE_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres CRM_PIPELINE_TEST_TEMPLATE=dpv_replay
const adminUrl=process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const template=process.env.CRM_PIPELINE_TEST_TEMPLATE||'';
const migrationPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations/064_crm_followup_pipeline.sql');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const DAY=86_400_000;

async function seed(client){
  await client.query('SET session_replication_role=replica');
  const ids={};
  for(const key of ['A','B','C']){
    ids[`company${key}`]=uuid();ids[`snapshot${key}`]=uuid();
    await client.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,$2,$3,'AE')`,
      [ids[`company${key}`],`Company ${key} Trading LLC`,`company-${key.toLowerCase()}-${ids[`company${key}`]}.example`]);
    await client.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile,buyer_business_model_result_id,
        category_procurement_match_result_id,cooperation_feasibility_result_id,system_recommendation_status,relationship_status,rule_version,assessment_revision,input_digest)
      VALUES($1,$2,'WOMENSWEAR',$3,$4,$5,'RECOMMENDED','NEW_PROSPECT','test-v1',1,$6)`,
      [ids[`snapshot${key}`],ids[`company${key}`],uuid(),uuid(),uuid(),hex(key)]);
  }
  // Company A already replied before the pipeline existed.
  await client.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status,owner_identity) VALUES($1,$2,'REPLIED','li.na')`,[ids.snapshotA,ids.companyA]);
  // Company B received a first touch ten days ago and has not answered.
  ids.reservationB=uuid();ids.threadB=uuid();ids.firstMessageB=uuid();ids.firstRfc='<first-touch-b@dpv.example>';
  await client.query(`INSERT INTO leadgen.phase13_first_touch_reservations(id,company_id,policy_revision,normalized_recipient,market_code,template_set_key,template_key,
      sender_identity,reply_to,subject,body_text,content_hash,eligibility_snapshot,reservation_minute,reservation_day,status,completed_at,rfc_message_id)
    VALUES($1,$2,'MC07_DPV_FIRST_TOUCH_V1','buyer@company-b.example','AE','DPV_FIRST_TOUCH_V1','B_IMPORTER_WHOLESALER_DISTRIBUTOR','sender@dpv.example',
      'simon@dpv.example','Competitive womenswear range','Hello',$3,'{"product_profile":"WOMENSWEAR"}',now()-interval '10 days',current_date-10,'PROVIDER_ACCEPTED',now()-interval '10 days',$4)`,
    [ids.reservationB,ids.companyB,hex('content-b'),ids.firstRfc]);
  await client.query(`INSERT INTO leadgen.outbound_messages(id,company_id,first_touch_reservation_id,provider,provider_purpose,idempotency_key,send_execution_key,rfc_message_id,send_status,sent_at)
    VALUES($1,$2,$3,'SMTP','COLD_OUTREACH',$4,$4,$5,'PROVIDER_ACCEPTED',now()-interval '10 days')`,[ids.firstMessageB,ids.companyB,ids.reservationB,`phase13-first-touch:${ids.reservationB}`,ids.firstRfc]);
  await client.query(`INSERT INTO leadgen.outreach_threads(id,company_id,first_touch_reservation_id,thread_token,thread_status) VALUES($1,$2,$3,$4,'OPEN')`,
    [ids.threadB,ids.companyB,ids.reservationB,`phase13-auto-first-touch:${ids.reservationB}`]);
  // A queued activity row written by the old code path.
  ids.legacyOutbox=uuid();
  await client.query(`INSERT INTO leadgen.crm_sync_outbox(id,company_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
    VALUES($1,$2,'UPDATE_ACTIVITY',$3,$4,'PENDING',now())`,[ids.legacyOutbox,ids.companyB,
    JSON.stringify({activity_id:uuid(),outbound_message_id:ids.firstMessageB,activity_type:'CONTACTED',funnel_status:'CONTACTED'}),`legacy:${ids.legacyOutbox}`]);
  await client.query('RESET session_replication_role');
  return ids;
}

test('CRM pipeline migration, APIs and approved follow-ups work end to end',{skip:!(adminUrl&&template)},async()=>{
  const database=`crm_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  await admin.query(`CREATE DATABASE ${database} TEMPLATE ${pg.escapeIdentifier?pg.escapeIdentifier(template):template}`);
  const url=new URL(adminUrl);url.pathname=`/${database}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:4});
  try{
    const seedClient=await pool.connect();let ids;try{ids=await seed(seedClient);}finally{seedClient.release();}

    const applied=await applyPhase7Migration({pool,migrationPath,expectedDatabase:database,appliedBy:'crm-pipeline-test'});
    assert.equal(applied.status,'APPLIED');assert.equal(applied.pipeline_stage,'REQUIRED');
    const replay=await applyPhase7Migration({pool,migrationPath,expectedDatabase:database,appliedBy:'crm-pipeline-test'});
    assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
    // Later migrations the current CRM code relies on (065 search cost, 066 merchant ownership columns).
    for(const later of ['065_global_markets_categories_search_cost.sql','066_merchant_accounts.sql'])
      assert.equal((await applyPhase7Migration({pool,migrationPath:path.join(path.dirname(migrationPath),later),expectedDatabase:database,appliedBy:'crm-pipeline-test'})).status,'APPLIED');
    const backfilled=(await pool.query('SELECT pipeline_stage,funnel_status FROM leadgen.opportunity_crm_states WHERE company_id=$1',[ids.companyA])).rows[0];
    assert.deepEqual(backfilled,{pipeline_stage:'REPLIED',funnel_status:'REPLIED'});

    const queued=[];const sent=[];
    // state=false models SIM's sender paused after a provider-path failure (pauseEmail).
    const automation={state:true,getState:async()=>({auto_first_touch_email:automation.state,sim_sender_paused:!automation.state}),pauseEmail:async()=>{automation.state=false;}};
    const provider={senderEmail:'sender@dpv.example',replyToEmail:'simon@dpv.example',messageIdDomain:'dpv.example',
      send:async(message,key)=>{sent.push({message,key});return{status:'PROVIDER_ACCEPTED',provider_message_id:`<${key}@dpv.example>`};}};
    const crm=new CrmService({pool,outboundProvider:provider,automationControl:automation,queue:{enqueue:async(...args)=>queued.push(args)},
      env:{CRM_FOLLOWUP_DRAFTS_ENABLED:'true'}});
    const sales={identity:'li.na',role:'SALES'};

    // Pipeline list and stage changes.
    const pipeline=await crm.listPipeline({});
    assert.equal(pipeline.items.find(row=>row.company_id===ids.companyA).pipeline_stage,'REPLIED');
    assert.equal(pipeline.items.find(row=>row.company_id===ids.companyB).pipeline_stage,'NEW');
    assert.ok(pipeline.stage_counts.REPLIED>=1&&pipeline.stage_counts.NEW>=2);
    const quoted=await crm.setStage(ids.snapshotA,{stage:'QUOTED',note:'FOB quote sent',next_action:'Await quote feedback',next_action_due_at:new Date(Date.now()-DAY).toISOString()},sales);
    assert.equal(quoted.pipeline_stage,'QUOTED');
    await assert.rejects(()=>crm.setStage(ids.snapshotA,{stage:'SAMPLE',expected_version:quoted.version-1},sales),{code:'CRM_VERSION_CONFLICT',status:409});
    // An email event later must not pull a person's stage backwards.
    await pool.query(`UPDATE leadgen.opportunity_crm_states SET funnel_status='REPLIED',version=version+1 WHERE company_id=$1`,[ids.companyA]);
    assert.equal((await pool.query('SELECT pipeline_stage FROM leadgen.opportunity_crm_states WHERE company_id=$1',[ids.companyA])).rows[0].pipeline_stage,'QUOTED');
    const lost=await crm.setStage(ids.snapshotA,{stage:'LOST',lost_reason:'Chose another supplier',note:'Price too high'},sales);
    assert.equal(lost.lost_reason,'Chose another supplier');
    const reopened=await crm.setStage(ids.snapshotA,{stage:'NEGOTIATING'},sales);
    assert.equal(reopened.lost_reason,null);
    const history=(await pool.query('SELECT from_stage,to_stage,changed_by,note FROM leadgen.opportunity_stage_history WHERE company_id=$1 ORDER BY changed_at,id',[ids.companyA])).rows;
    assert.deepEqual(history.map(row=>`${row.from_stage}>${row.to_stage}`),['REPLIED>QUOTED','QUOTED>LOST','LOST>NEGOTIATING']);
    assert.equal(history[0].changed_by,'li.na');assert.equal(history[0].note,'FOB quote sent');
    // Consecutive changes by the same person keep that person and their note.
    assert.deepEqual([history[1].changed_by,history[1].note],['li.na','Price too high']);
    assert.deepEqual([history[2].changed_by,history[2].note],['li.na',null]);

    // The email funnel moves early stages automatically and records the system as actor.
    await pool.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status) VALUES($1,$2,'CONTACTED')`,[ids.snapshotC,ids.companyC]);
    await pool.query(`UPDATE leadgen.opportunity_crm_states SET funnel_status='REPLIED',version=version+1 WHERE company_id=$1`,[ids.companyC]);
    const autoHistory=(await pool.query('SELECT to_stage,changed_by FROM leadgen.opportunity_stage_history WHERE company_id=$1 ORDER BY changed_at,id',[ids.companyC])).rows;
    assert.deepEqual(autoHistory,[{to_stage:'CONTACTED',changed_by:'system'},{to_stage:'REPLIED',changed_by:'system'}]);

    // Manual activities and timeline.
    const followUpAt=new Date(Date.now()+2*DAY).toISOString();
    const call=await crm.addActivity(ids.snapshotA,{activity_type:'CALL',summary:'Discussed linen dresses with buyer',result:'Interested',next_follow_up_at:followUpAt},sales);
    assert.equal(call.activity_type,'CALL');assert.equal(call.recorded_by,'li.na');
    assert.equal(new Date((await pool.query('SELECT next_action_due_at FROM leadgen.opportunity_crm_states WHERE company_id=$1',[ids.companyA])).rows[0].next_action_due_at).toISOString(),followUpAt);
    const timeline=await crm.timeline(ids.companyA);
    assert.ok(timeline.some(row=>row.kind==='ACTIVITY'&&row.event_type==='CALL'));assert.ok(timeline.some(row=>row.kind==='STAGE'&&row.to_stage==='NEGOTIATING'));
    for(const row of (await pool.query(`SELECT operation,payload FROM leadgen.crm_sync_outbox WHERE company_id=$1`,[ids.companyA])).rows)
      assert.doesNotThrow(()=>validateCrmPayload(row.operation,row.payload));

    // Tasks.
    const task=await crm.createTask({company_id:ids.companyA,task_type:'QUOTATION',title:'Send revised FOB quote',due_at:new Date(Date.now()-3_600_000).toISOString()},sales);
    const overdue=await crm.listTasks({due:'overdue',mine:'true'},sales);
    assert.ok(overdue.items.some(row=>row.id===task.id&&row.overdue));assert.ok(overdue.summary.overdue>=1);
    const done=await crm.updateTask(task.id,{task_status:'COMPLETED',note:'Quote sent by email'},sales);
    assert.equal(done.task_status,'COMPLETED');assert.ok(done.closed_at);assert.equal(done.details.notes[0].text,'Quote sent by email');
    await assert.rejects(()=>crm.updateTask(task.id,{task_status:'OPEN'},sales),{code:'CRM_TASK_CLOSED',status:409});

    // Follow-up drafts: scan creates one draft per due step, approval is required before sending.
    const scan=await crm.scanFollowups();
    assert.equal(scan.created,1);assert.equal((await crm.scanFollowups()).created,0);
    const [draft]=await crm.listFollowupDrafts({});
    assert.equal(draft.thread_id,ids.threadB);assert.equal(draft.sequence_no,2);assert.equal(draft.recipient,'buyer@company-b.example');
    assert.match(draft.body_text,/Company B Trading LLC/);assert.equal(sent.length,0);
    const approved=await crm.decideFollowupDraft(draft.id,{decision:'APPROVE',subject:'Following up on womenswear supply'},{identity:'simon',role:'MANAGEMENT'});
    assert.equal(approved.draft_status,'APPROVED');
    // While email is paused the draft waits, and the next scan queues it again.
    automation.state=false;
    assert.equal((await crm.sendApprovedFollowup({draft_id:draft.id})).code,'EMAIL_PAUSED');
    const queuedBefore=queued.length;assert.equal((await crm.scanFollowups()).requeued,1);
    assert.deepEqual(queued.slice(queuedBefore).map(args=>args[1].draft_id),[draft.id]);
    automation.state=true;assert.equal(approved.subject,'Following up on womenswear supply');
    assert.deepEqual(queued.at(-1).slice(0,2),['crm-followup-send',{draft_id:draft.id}]);
    await assert.rejects(()=>crm.decideFollowupDraft(draft.id,{decision:'DISCARD'},{identity:'simon'}),{code:'CRM_FOLLOWUP_DECIDED',status:409});

    const delivery=await crm.sendApprovedFollowup({draft_id:draft.id});
    assert.equal(delivery.status,'PROVIDER_ACCEPTED');assert.equal(sent.length,1);
    assert.equal(sent[0].message.to,'buyer@company-b.example');assert.equal(sent[0].message.in_reply_to,ids.firstRfc);
    assert.equal(sent[0].message.subject,'Following up on womenswear supply');
    assert.equal((await crm.sendApprovedFollowup({draft_id:draft.id})).idempotent_replay,true);assert.equal(sent.length,1);
    const followupMessage=(await pool.query('SELECT * FROM leadgen.outbound_messages WHERE followup_draft_id=$1',[draft.id])).rows[0];
    assert.equal(followupMessage.send_status,'PROVIDER_ACCEPTED');
    assert.equal((await pool.query(`SELECT draft_status FROM leadgen.crm_followup_drafts WHERE id=$1`,[draft.id])).rows[0].draft_status,'SENT');

    // A reply to the follow-up quotes the first touch in References and resolves to the same thread.
    const thread=await new Phase7Repository({pool}).findInboundThread({inReplyTo:followupMessage.rfc_message_id,references:[ids.firstRfc,followupMessage.rfc_message_id],normalizedSender:'buyer@company-b.example'});
    assert.equal(thread.id,ids.threadB);

    // The third email becomes due only after the second was sent; a reply blocks it at approval.
    const third=await crm.scanFollowups({now:new Date(Date.now()+DAY)});
    assert.equal(third.created,1);assert.equal(third.requeued,0);
    const inboundId=uuid();
    await pool.query(`INSERT INTO leadgen.inbound_messages(id,provider,provider_message_id,thread_id,correlation_status,from_address_hash,received_at,subject_sanitized,body_text_sanitized)
      VALUES($1,'IMAP','<reply-b@company-b.example>',$2,'MATCHED',$3,now(),'Re: womenswear','Please send your catalogue')`,[inboundId,ids.threadB,hex('buyer@company-b.example')]);
    const [pendingThird]=await crm.listFollowupDrafts({});
    assert.equal(pendingThird.sequence_no,3);
    assert.equal((await crm.decideFollowupDraft(pendingThird.id,{decision:'APPROVE'},{identity:'simon'})).draft_status,'BLOCKED');

    // Reply review keeps the original reading and appends the correction.
    const classificationId=uuid();
    await pool.query(`INSERT INTO leadgen.reply_classifications(id,inbound_message_id,intent,classifier_version,reply_category) VALUES($1,$2,'CATALOGUE','rules-v1','HUMAN_POSITIVE')`,[classificationId,inboundId]);
    await pool.query(`INSERT INTO leadgen.sales_tasks(company_id,thread_id,inbound_message_id,task_type,task_status,classification_id,details) VALUES($1,$2,$3,'FOLLOW_UP','OPEN',$4,'{}')`,
      [ids.companyB,ids.threadB,inboundId,classificationId]);
    const review=await crm.reviewReply(classificationId,{decision:'CORRECT',intent:'QUOTATION'},sales);
    assert.equal(review.classification.intent,'CATALOGUE');assert.equal(review.classification.review_status,'CORRECTED');
    assert.deepEqual([review.correction.intent,review.correction.classification_revision,review.correction.classifier_version],['QUOTATION',2,'HUMAN_REVIEW_V1']);
    assert.equal(review.task.task_type,'QUOTATION');
    assert.equal((await pool.query(`SELECT task_status FROM leadgen.sales_tasks WHERE classification_id=$1`,[classificationId])).rows[0].task_status,'CANCELLED');
    await assert.rejects(()=>crm.reviewReply(classificationId,{decision:'CONFIRM'},sales),{code:'CRM_CLASSIFICATION_REVIEWED',status:409});

    // The dispatcher queues every pending prospect row once a CRM is configured.
    const dispatchQueue=[];
    const dispatcher=new CrmService({pool,queue:{enqueue:async(...args)=>dispatchQueue.push(args)},
      env:{CRM_PROVIDER:'feishu',FEISHU_APP_ID:'cli',FEISHU_APP_SECRET:'s',FEISHU_BITABLE_APP_TOKEN:'b',FEISHU_BITABLE_TABLE_ID:'t'}});
    const pending=Number((await pool.query(`SELECT count(*)::int count FROM leadgen.crm_sync_outbox WHERE record_scope='PROSPECT' AND sync_status='PENDING'`)).rows[0].count);
    const dispatched=await dispatcher.dispatchCrmOutbox();
    assert.equal(dispatched.queued,pending);assert.ok(pending>=5);
    assert.ok(dispatchQueue.every(([queue,data])=>queue==='sync-outreach-to-crm'&&data.outbox_id));
    assert.equal((await new CrmService({pool,env:{}}).dispatchCrmOutbox()).status,'NOT_CONFIGURED');

    // The queued legacy row now waits for configuration instead of failing permanently.
    const legacy=await new Phase7Service({pool,env:{}}).processCrmSyncWork({outbox_id:ids.legacyOutbox});
    assert.equal(legacy.configuration_status,'ADAPTER_NOT_CONFIGURED');
    assert.equal((await pool.query('SELECT sync_status FROM leadgen.crm_sync_outbox WHERE id=$1',[ids.legacyOutbox])).rows[0].sync_status,'RETRYABLE_ERROR');
  }finally{
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();
  }
});

test('a new database built from all migration files is baselined once, then replays as applied',{skip:!adminUrl},async()=>{
  const database=`sim_fresh_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const url=new URL(adminUrl);url.pathname=`/${database}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:2});
  try{
    // Same order the PostgreSQL container uses for /docker-entrypoint-initdb.d.
    const directory=path.dirname(migrationPath);
    for(const name of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort())
      await pool.query(await readFile(path.join(directory,name),'utf8'));
    const statuses=result=>Object.values(result).filter(value=>value&&typeof value==='object').map(value=>value.status);
    const baseline=await applyPhase7Migrations({pool,expectedDatabase:database,baseline:true});
    assert.ok(statuses(baseline).length>=40);assert.ok(statuses(baseline).every(status=>status==='BASELINED'));
    assert.equal(baseline.crmFollowupPipeline.pipeline_stage,'REQUIRED');
    const replay=await applyPhase7Migrations({pool,expectedDatabase:database});
    assert.ok(statuses(replay).every(status=>status==='SKIPPED_ALREADY_APPLIED'));
    await assert.rejects(()=>applyPhase7Migrations({pool,expectedDatabase:database,baseline:true}),/empty migration ledger/);
  }finally{
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();
  }
});
