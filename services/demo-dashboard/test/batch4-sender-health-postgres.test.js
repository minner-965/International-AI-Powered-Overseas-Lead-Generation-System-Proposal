// Batch 4 (D3/D4, migration 077) against a throwaway PostgreSQL database built from every migration.
// Zero external calls: the mailbox provider is a double and nothing is sent.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {SenderHealth} from '../src/outreach/senderHealth.js';
import {SENDER_HEALTH_MIGRATION_KEY,verifySenderHealthMigration} from '../src/phase7/migrationRunner.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const SECRET_KEY=crypto.randomBytes(32).toString('hex');

async function withDatabase(run){
  const name=`sender_health_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:6});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool);
  }finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

// Sent messages for one sender (merchant id, or null for SIM), the newest last; `bounced` of them
// hard-bounced, `complained` of them drew a complaint event.
async function seedSent(pool,{merchantId=null,count,bounced=0,complained=0,minutesAgo=120,status='PROVIDER_ACCEPTED'}){
  const company=uuid();
  await pool.query('SET session_replication_role=replica');
  try{
    await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,$2,$3,'AE')`,[company,`Buyer ${company.slice(0,8)}`,`b-${company.slice(0,8)}.example`]);
    for(let i=0;i<count;i++){
      const id=uuid(),key=`batch4:${id}`;
      const bounce=i<bounced;
      // Replica mode skips foreign keys, so each message names its own (unseeded) reservation.
      await pool.query(`INSERT INTO leadgen.outbound_messages(id,company_id,first_touch_reservation_id,provider,provider_purpose,idempotency_key,send_execution_key,rfc_message_id,send_status,sent_at,queued_at,merchant_id)
        VALUES($1,$2,$8,'SMTP','COLD_OUTREACH',$3,$3,$4,$5,now()-($6||' minutes')::interval,now()-($6||' minutes')::interval,$7)`,
        [id,company,key,`<${id}@sender.example>`,bounce?'HARD_BOUNCED':status,String(minutesAgo+count-i),merchantId,uuid()]);
      if(i<complained)await pool.query(`INSERT INTO leadgen.email_message_events(outbound_message_id,event_type,occurred_at,event_digest) VALUES($1,'COMPLAINED',now(),$2)`,
        [id,crypto.createHash('sha256').update(`complaint:${id}`).digest('hex')]);
    }
  }finally{await pool.query('RESET session_replication_role');}
}

test('migration 077 is the latest file and verifies; sender health history is append-only',{skip:!adminUrl},async()=>{
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
  assert.equal(files.at(-1),SENDER_HEALTH_MIGRATION_KEY);
  await withDatabase(async pool=>{
    assert.deepEqual(await verifySenderHealthMigration(pool),{sender_health:true});
    const row=(await pool.query(`INSERT INTO leadgen.sender_health_events(sender_key,event_type,reason,actor) VALUES('SIM','PAUSED','BOUNCE_RATE_HIGH','t') RETURNING id`)).rows[0];
    await assert.rejects(pool.query(`UPDATE leadgen.sender_health_events SET reason='X' WHERE id=$1`,[row.id]),/SENDER_HEALTH_APPEND_ONLY/);
    await assert.rejects(pool.query(`DELETE FROM leadgen.sender_health_events WHERE id=$1`,[row.id]),/SENDER_HEALTH_APPEND_ONLY/);
    await assert.rejects(pool.query(`INSERT INTO leadgen.sender_health_events(sender_key,event_type,reason,actor) VALUES('not-a-sender','PAUSED','X','t')`),/check/);
  });
});

test('a merchant mailbox is paused for bounces, keeps the pause through a connection test, and a person resumes it',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const env={MERCHANT_SECRET_KEY:SECRET_KEY,DPV_WORKSPACE_ACTOR:'dev'};
    const merchants=new MerchantService({pool,env,providerFactory:config=>({config,testConnections:async()=>({smtp:{ok:true},imap:{ok:true}})})});
    const created=await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin');
    const merchantId=created.merchant.id;
    await merchants.saveMailbox(merchantId,{preset_key:'gmail',username:'anna@alpha.example',password:'app-pass',from_name:'Anna'},'admin');
    await merchants.testConnection(merchantId);
    const simPauses=[];
    const health=new SenderHealth({pool,env:{},merchants,automationControl:{async pauseEmail(reason){simPauses.push(reason);}}});

    // SIM's own history does not count against the merchant, and vice versa.
    await seedSent(pool,{merchantId:null,count:30,bounced:10});
    await seedSent(pool,{merchantId,count:40,bounced:1});
    assert.equal((await health.healthGate(merchantId)).ok,true,'1 bounce in 40 stays below the minimum of two');
    await seedSent(pool,{merchantId,count:10,bounced:2,minutesAgo:30});
    const metrics=await health.metrics(merchantId);
    assert.deepEqual([metrics.sent,metrics.hard_bounces,metrics.complaints],[50,3,0]);

    const gate=await health.healthGate(merchantId);
    assert.equal(gate.code,'SENDER_BOUNCE_RATE_HIGH');assert.deepEqual(simPauses,[],'SIM keeps sending');
    let mailbox=await merchants.mailbox(merchantId);assert.equal(mailbox.sending_hold.reason,'BOUNCE_RATE_HIGH');
    await health.healthGate(merchantId);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM leadgen.sender_health_events WHERE sender_key=$1`,[merchantId])).rows[0].count),1,'one pause row');

    // A passing connection test proves the server works, not that the list is clean.
    await merchants.testConnection(merchantId);
    mailbox=await merchants.mailbox(merchantId);assert.equal(mailbox.sending_hold.reason,'BOUNCE_RATE_HIGH');

    const status=await health.resume(merchantId,{actor:'anna@alpha.example',note:'Removed the bad addresses'});
    assert.equal(status.paused,null);assert.equal(status.healthy,true);assert.equal(status.metrics.sent,0,'the window restarts at the resume');
    mailbox=await merchants.mailbox(merchantId);assert.equal(mailbox.sending_hold,null);
    const events=(await pool.query(`SELECT event_type,reason,actor,metrics FROM leadgen.sender_health_events WHERE sender_key=$1 ORDER BY recorded_at`,[merchantId])).rows;
    assert.deepEqual(events.map(row=>[row.event_type,row.reason,row.actor]),[['PAUSED','BOUNCE_RATE_HIGH','sender-health'],['RESUMED','Removed the bad addresses','anna@alpha.example']]);
    assert.equal(events[0].metrics.hard_bounces,3);

    // A stalled-send hold is still lifted by a passing test, as before.
    await merchants.holdMailbox(merchantId,'SMTP_SEND_INTERRUPTED');
    await merchants.testConnection(merchantId);
    assert.equal((await merchants.mailbox(merchantId)).sending_hold,null);
  });
});

test('SIM is paused through the email switch on a complaint; pacing counts only SIM mail',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const pauses=[];
    const now=new Date();
    const health=new SenderHealth({pool,env:{},now:()=>now,automationControl:{async pauseEmail(reason){pauses.push(reason);}}});
    await seedSent(pool,{merchantId:null,count:5,complained:1,minutesAgo:3});
    const gate=await health.firstTouchGate(null);
    assert.equal(gate.code,'SENDER_COMPLAINT_RECEIVED');assert.deepEqual(pauses,['SENDER_COMPLAINT_RECEIVED']);
    const pacing=await health.pacing(null);
    assert.equal(pacing.sent_today>=1,true);assert.ok(pacing.first_sent_at);assert.ok(pacing.last_sent_at);

    // After a person turns email back on (a RESUMED row), only newer mail counts; the latest
    // message was 3 minutes ago, so the next automatic first touch waits for the 15-minute gap.
    await pool.query(`INSERT INTO leadgen.sender_health_events(sender_key,event_type,reason,actor) VALUES('SIM','RESUMED','EMAIL_ON_AFTER_SENDER_COMPLAINT_RECEIVED','simon')`);
    const next=await health.firstTouchGate(null);
    assert.equal(next.code,'SENDER_MIN_INTERVAL');assert.ok(new Date(next.next_allowed_at)>now);
  });
});
