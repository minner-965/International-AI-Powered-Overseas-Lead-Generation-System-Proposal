import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// This runner never creates fixtures in the operational database or calls a mail/CRM provider.
const root=process.env.DPV_PROJECT_ROOT||process.cwd();
const app=process.env.PHASE11_APP_ROOT||path.join(root,'services/demo-dashboard');
const pg=createRequire(path.join(app,'package.json'))('pg');
const {applyCategoryProcurementMigration}=await import(pathToFileURL(path.join(app,'src/categoryProcurement/migrationRunner.js')));
const {applyPhase7Migration}=await import(pathToFileURL(process.env.PHASE11_MIGRATION_MODULE||path.join(app,'src/phase7/migrationRunner.js')));
const {Phase7Repository}=await import(pathToFileURL(process.env.PHASE11_REPOSITORY_MODULE||path.join(app,'src/phase7/repository.js')));
const hash=x=>createHash('sha256').update(x).digest('hex');
const config={host:process.env.POSTGRES_HOST||'postgres',user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
assert.ok(config.user&&config.password&&process.env.POSTGRES_DB,'Database environment required');
const db=`phase11_oq14_${Date.now()}_${randomBytes(6).toString('hex')}`;
const admin=new pg.Client({...config,database:'postgres'});
const production=new pg.Client({...config,database:process.env.POSTGRES_DB,options:'-c default_transaction_read_only=on'});
let created=false,pool;
const report={started_at:new Date().toISOString(),production_mode:'READ_ONLY',provider_calls:0,checks:[]};
const check=async(name,fn)=>{try{await fn();report.checks.push({name,status:'PASS'});}catch(e){report.checks.push({name,status:'FAIL',code:e.code||e.name,message:e.message});}};
try{
  const dir=path.join(root,'database/migrations');
  const names=(await fs.readdir(dir)).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
  assert.ok(names.length>=56);assert.ok(names.every((n,i)=>+n.slice(0,3)===i+1));
  await production.connect();
  const ledger=(await production.query('SELECT migration_key,checksum_sha256 FROM leadgen.schema_migrations ORDER BY migration_key')).rows;
  for(const r of ledger)assert.equal(hash(await fs.readFile(path.join(dir,r.migration_key))),r.checksum_sha256);
  report.production_ledger_matched=ledger.length;
  await production.end();await admin.connect();
  assert.match(db,/^phase11_oq14_\d+_[a-f0-9]{12}$/);assert.notEqual(db,process.env.POSTGRES_DB);
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);
  await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);created=true;
  pool=new pg.Pool({...config,database:db,max:8});
  for(const name of names){const n=+name.slice(0,3);if(n<24)await pool.query(await fs.readFile(path.join(dir,name),'utf8'));
    else assert.equal((await(n===24?applyCategoryProcurementMigration:applyPhase7Migration)({pool,migrationPath:path.join(dir,name),expectedDatabase:db,appliedBy:'oq14-isolated'})).status,'APPLIED');}
  report.migrations_applied=names.length;
  const before=(await pool.query('SELECT * FROM leadgen.schema_migrations ORDER BY migration_key')).rows;
  await check('Migration049–050 and052+ replay leaves ledger unchanged',async()=>{
    for(const name of names.filter(n=>[49,50].includes(+n.slice(0,3))||+n.slice(0,3)>=52))assert.equal((await applyPhase7Migration({pool,migrationPath:path.join(dir,name),expectedDatabase:db,appliedBy:'oq14-replay'})).status,'SKIPPED_ALREADY_APPLIED');
    assert.deepEqual((await pool.query('SELECT * FROM leadgen.schema_migrations ORDER BY migration_key')).rows,before);
  });
  const repository=new Phase7Repository({pool});
  await check('Successful IMAP checkpoint records success time and failure preserves it',async()=>{
    const completed=await repository.saveImapCheckpoint('checkpoint@example.test',{folder:'INBOX',uidvalidity:1,lastProcessedUid:5});
    assert.ok(completed.last_success_at);assert.equal(completed.checkpoint_status,'ACTIVE');
    const failed=await repository.saveImapCheckpoint('checkpoint@example.test',{folder:'INBOX',uidvalidity:1,lastProcessedUid:5,status:'FAILED'});
    assert.equal(failed.checkpoint_status,'ERROR');assert.equal(failed.last_success_at.toISOString(),completed.last_success_at.toISOString());
  });
  const company=(await pool.query("INSERT INTO leadgen.companies(company_name,normalized_domain,country_code) VALUES('OQ14 isolated fixture','oq14.example.test','AE') RETURNING id")).rows[0].id;
  const input={provider:'SMTP',provider_message_id:'oq14-message',correlation_status:'REVIEW',from_address_hash:'a'.repeat(64),subject_sanitized:'Fixture',body_text_sanitized:'Please review',attachment_status:'NONE',received_at:new Date().toISOString(),mailbox_identity_hash:'b'.repeat(64),folder_path:'INBOX',imap_uidvalidity:1,imap_uid:1,internet_message_id:'<oq14@example.test>'};
  let inbound,classification;
  await check('Eight simultaneous UID/message replays persist one inbound',async()=>{const rows=await Promise.all(Array.from({length:8},()=>repository.createInboundMessage(input)));assert.equal(new Set(rows.map(r=>r.id)).size,1);inbound=rows[0];});
  await check('Same Message-ID with later UID remains same inbound',async()=>assert.equal((await repository.createInboundMessage({...input,imap_uid:2})).id,inbound.id));
  await check('Concurrent classification revision persists once',async()=>{const rows=await Promise.all(Array.from({length:8},()=>repository.createReplyClassification({inbound_message_id:inbound.id,intent:'REVIEW',confidence:1,review_status:'PENDING_REVIEW',classifier_version:'oq14',reason_codes:[],reply_category:'HUMAN_NEUTRAL'})));assert.equal(new Set(rows.map(r=>r.id)).size,1);classification=rows[0];});
  const effect={effect_key:'oq14-human-effect',company_id:company,inbound_message_id:inbound?.id,classification_id:classification?.id,activity_type:'REPLIED',funnel_status:'REPLIED',owner:'fixture.owner',due_at:'2030-01-01T00:00:00Z',task:{task_type:'REPLY_REVIEW',details:{source:'isolated-regression'}}};
  await check('Concurrent CRM effects create one activity and one task',async()=>{await Promise.all(Array.from({length:8},()=>repository.applyInboundCrmEffects(effect)));assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.opportunity_activities')).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.sales_tasks')).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.crm_sync_outbox')).rows[0].n,2);});
  await check('Fresh repository after restart replays CRM effect without duplicate',async()=>{const restarted=new Phase7Repository({pool});assert.equal((await restarted.applyInboundCrmEffects(effect)).replay,true);});
  const item=await repository.createCrmOutbox({company_id:company,operation:'UPDATE_ACTIVITY',payload:{fixture:true},idempotency_key:'oq14-claim'});
  await check('Concurrent CRM outbox claim grants one worker',async()=>{const rows=await Promise.all(Array.from({length:8},()=>repository.claimCrmOutbox(item.outbox.id)));assert.equal(rows.filter(r=>r.claimed).length,1);});
  await check('CRM retry reuses outbox identity and increments attempt only once',async()=>{await repository.failCrmOutbox(item.outbox.id,{retryable:true,error:'fixture',retryAfterSeconds:1});await pool.query("UPDATE leadgen.crm_sync_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[item.outbox.id]);assert.equal((await repository.claimCrmOutbox(item.outbox.id)).outbox.attempt_count,2);await repository.completeCrmOutbox(item.outbox.id);assert.equal((await repository.claimCrmOutbox(item.outbox.id)).claimed,false);});
  await check('Restart after uncertain CRM processing holds reconciliation without duplicate claim',async()=>{
    const pending=await repository.createCrmOutbox({company_id:company,operation:'UPDATE_ACTIVITY',payload:{fixture:true},idempotency_key:'oq14-stale'});
    assert.equal((await repository.claimCrmOutbox(pending.outbox.id)).claimed,true);
    assert.equal((await new Phase7Repository({pool}).claimCrmOutbox(pending.outbox.id)).claimed,false);
    await pool.query("UPDATE leadgen.crm_sync_outbox SET updated_at=now()-interval '6 minutes' WHERE id=$1",[pending.outbox.id]);
    const results=await Promise.all(Array.from({length:8},()=>new Phase7Repository({pool}).claimCrmOutbox(pending.outbox.id)));
    assert.ok(results.every(r=>!r.claimed));const held=await repository.getCrmOutbox(pending.outbox.id);
    assert.equal(held.sync_status,'PERMANENT_ERROR');assert.equal(held.last_error,'CRM_STALE_PROCESSING_RECONCILIATION_REQUIRED');assert.equal(held.attempt_count,1);
  });
  if(names.some(n=>n.startsWith('057_'))){
    const {controlledCrmCases}=await import('./phase11-controlled-crm-isolated-cases.mjs');
    await controlledCrmCases({pool,repository,check});
  }
  report.result=report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
}catch(e){report.result='FAIL';report.failure={code:e.code||e.name,message:e.message};}
finally{
  if(pool)await pool.end();
  if(created){assert.match(db,/^phase11_oq14_\d+_[a-f0-9]{12}$/);assert.notEqual(db,process.env.POSTGRES_DB);await admin.query(`DROP DATABASE "${db}"`);assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);report.cleanup='DROPPED_AND_ABSENCE_VERIFIED';}
  await production.end().catch(()=>{});await admin.end().catch(()=>{});report.finished_at=new Date().toISOString();console.log(JSON.stringify(report,null,2));
}
if(report.result!=='PASS')process.exitCode=1;
