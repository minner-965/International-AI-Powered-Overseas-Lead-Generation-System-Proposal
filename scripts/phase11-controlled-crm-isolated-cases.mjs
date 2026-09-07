import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function controlledCrmCases({pool,repository,check}){
  const hash='d'.repeat(64);const received='2026-01-01T10:00:00.000Z';
  const count=async(scope)=>(await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.opportunity_activities WHERE record_scope=$1) activities,
    (SELECT count(*)::int FROM leadgen.sales_tasks WHERE record_scope=$1) tasks,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox WHERE record_scope=$1) outboxes`,[scope])).rows[0];
  const baseline=await count('PROSPECT');
  const fixture=async(label)=>{
    const context=(await pool.query(`INSERT INTO leadgen.controlled_application_contexts(context_label,recipient_hash,provider_purpose,sender_identity,reply_to,max_messages,snapshot_hash,created_by)
      VALUES($1,$2,'COLD_OUTREACH','fixture@example.test','fixture@example.test',1,$3,'fixture.owner') RETURNING id`,[label,hash,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
    const draft=(await pool.query(`INSERT INTO leadgen.controlled_application_drafts(context_id,version,subject,body_text,content_hash,created_by) VALUES($1,1,'Fixture','Fixture',$2,'fixture.owner') RETURNING id`,[context,hash])).rows[0].id;
    const message=(await pool.query(`INSERT INTO leadgen.controlled_application_messages(context_id,draft_id,provider_purpose,idempotency_key,rfc_message_id,message_key_header)
      VALUES($1,$2,'COLD_OUTREACH',$3,$4,$5) RETURNING id`,[context,draft,randomUUID().replaceAll('-','').repeat(2),`<${randomUUID()}@example.test>`,randomUUID()])).rows[0].id;
    const inbound=[];for(const [i,category]of ['UNKNOWN_REVIEW','OPT_OUT'].entries()){
      inbound.push((await pool.query(`INSERT INTO leadgen.controlled_application_inbound_messages(context_id,outbound_message_id,mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid,from_address_hash,received_at,reply_category,classification_revision)
        VALUES($1,$2,$3,$4,1,$5,$3,$6,$7,1) RETURNING id`,[context,message,hash,`FIXTURE-${context}`,i+1,new Date(Date.parse(received)+i*60000),category])).rows[0].id);
    }
    return{context,inbound};
  };
  const f=await fixture('Concurrent shared CRM fixture');
  let outboxes=[];
  await check('Controlled same-source concurrent enqueue yields two shared outbox identities',async()=>{
    await Promise.all(Array.from({length:8},()=>repository.enqueueControlledCrmEffects(f.context)));
    outboxes=(await pool.query('SELECT id,controlled_inbound_message_id,payload FROM leadgen.crm_sync_outbox WHERE controlled_context_id=$1',[f.context])).rows;
    assert.equal(outboxes.length,2);assert.ok(outboxes.every(r=>!JSON.stringify(r.payload).includes('@')));
  });
  await check('Real shared executor opt-out-first concurrency keeps historical owner/due task cancelled',async()=>{
    const optout=outboxes.find(r=>r.controlled_inbound_message_id===f.inbound[1]);
    const human=outboxes.find(r=>r.controlled_inbound_message_id===f.inbound[0]);
    await repository.processControlledCrmOutbox(optout.id);
    const results=await Promise.all(Array.from({length:8},()=>repository.processControlledCrmOutbox(human.id)));
    assert.ok(results.every(r=>r.network_calls===0));
    const rows=(await pool.query('SELECT task_status,owner,due_at,close_reason FROM leadgen.sales_tasks WHERE controlled_context_id=$1',[f.context])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].owner,'fixture.owner');assert.equal(rows[0].due_at.toISOString(),'2026-01-02T10:00:00.000Z');assert.equal(rows[0].task_status,'CANCELLED');
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.opportunity_activities WHERE controlled_context_id=$1',[f.context])).rows[0].n,2);
  });
  await check('Controlled worker restart/replay leaves synced effects byte-for-byte unchanged',async()=>{
    const snapshot=async()=>(await pool.query(`SELECT jsonb_build_object('outbox',(SELECT jsonb_agg(x ORDER BY id) FROM leadgen.crm_sync_outbox x WHERE controlled_context_id=$1),
      'tasks',(SELECT jsonb_agg(x ORDER BY id) FROM leadgen.sales_tasks x WHERE controlled_context_id=$1),
      'activities',(SELECT jsonb_agg(x ORDER BY id) FROM leadgen.opportunity_activities x WHERE controlled_context_id=$1)) value`,[f.context])).rows[0].value;
    const before=await snapshot();const restarted=new repository.constructor({pool});
    for(const item of outboxes)assert.equal((await restarted.processControlledCrmOutbox(item.id)).replay,true);
    await restarted.enqueueControlledCrmEffects(f.context);assert.deepEqual(await snapshot(),before);
  });
  const second=await fixture('Human before opt-out fixture');
  await check('Controlled human task closes when later opt-out arrives and cannot reopen',async()=>{
    await repository.enqueueControlledCrmEffects(second.context);
    const boxes=(await pool.query('SELECT id,controlled_inbound_message_id FROM leadgen.crm_sync_outbox WHERE controlled_context_id=$1',[second.context])).rows;
    const human=boxes.find(r=>r.controlled_inbound_message_id===second.inbound[0]);const optout=boxes.find(r=>r.controlled_inbound_message_id===second.inbound[1]);
    await repository.processControlledCrmOutbox(human.id);
    const initial=(await pool.query('SELECT owner,due_at,task_status FROM leadgen.sales_tasks WHERE controlled_context_id=$1',[second.context])).rows[0];
    assert.ok(initial);assert.equal(initial.owner,'fixture.owner');
    await repository.processControlledCrmOutbox(optout.id);await repository.processControlledCrmOutbox(human.id);
    assert.equal((await pool.query('SELECT task_status FROM leadgen.sales_tasks WHERE controlled_context_id=$1',[second.context])).rows[0].task_status,'CANCELLED');
  });
  await check('Cross-context inbound and mixed prospect/control scope are rejected by database',async()=>{
    const insert=`INSERT INTO leadgen.crm_sync_outbox(company_id,record_scope,controlled_context_id,controlled_inbound_message_id,operation,payload,idempotency_key) VALUES($1,$2,$3,$4,'UPDATE_ACTIVITY','{}',$5)`;
    await assert.rejects(pool.query(insert,[null,'CONTROLLED',f.context,second.inbound[0],randomUUID()]),e=>e.code==='23503');
    await assert.rejects(pool.query(insert,[null,'PROSPECT',f.context,f.inbound[0],randomUUID()]),e=>e.code==='23514');
    await assert.rejects(pool.query(insert,[null,'CONTROLLED',null,null,randomUUID()]),e=>e.code==='23514');
  });
  const automatic=await fixture('Automatic reply local restart fixture');
  await pool.query("UPDATE leadgen.controlled_application_inbound_messages SET reply_category=CASE WHEN id=$2 THEN 'AUTO_REPLY' ELSE 'OUT_OF_OFFICE' END WHERE context_id=$1",[automatic.context,automatic.inbound[0]]);
  await repository.enqueueControlledCrmEffects(automatic.context);
  const autoBoxes=(await pool.query('SELECT id FROM leadgen.crm_sync_outbox WHERE controlled_context_id=$1 ORDER BY id',[automatic.context])).rows;
  await check('Controlled local CRM resumes interrupted processing atomically without external call',async()=>{
    await pool.query("UPDATE leadgen.crm_sync_outbox SET sync_status='PROCESSING',updated_at=now()-interval '6 minutes' WHERE id=$1",[autoBoxes[0].id]);
    const restarted=new repository.constructor({pool});
    const results=await Promise.all(Array.from({length:8},()=>restarted.processControlledCrmOutbox(autoBoxes[0].id)));
    assert.equal(results.filter(r=>!r.replay).length,1);assert.ok(results.every(r=>r.network_calls===0));
    assert.equal((await pool.query('SELECT sync_status,attempt_count FROM leadgen.crm_sync_outbox WHERE id=$1',[autoBoxes[0].id])).rows[0].attempt_count,1);
  });
  await check('Automatic and out-of-office replies create Activities but no positive follow-up task',async()=>{
    await repository.processControlledCrmOutbox(autoBoxes[1].id);
    const activities=(await pool.query('SELECT activity_type FROM leadgen.opportunity_activities WHERE controlled_context_id=$1',[automatic.context])).rows;
    assert.equal(activities.length,2);assert.ok(activities.every(r=>r.activity_type==='AUTO_REPLY'));
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.sales_tasks WHERE controlled_context_id=$1',[automatic.context])).rows[0].n,0);
  });
  await check('Controlled shared CRM creates zero prospect-scope records and no invented company',async()=>{
    assert.deepEqual(await count('PROSPECT'),baseline);
    for(const table of ['crm_sync_outbox','sales_tasks','opportunity_activities'])assert.equal((await pool.query(`SELECT count(*)::int n FROM leadgen.${table} WHERE record_scope='CONTROLLED' AND company_id IS NOT NULL`)).rows[0].n,0);
  });
}
