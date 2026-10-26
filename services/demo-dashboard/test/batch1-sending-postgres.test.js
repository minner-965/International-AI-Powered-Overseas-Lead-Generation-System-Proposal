// Batch 1 sending safety against a throwaway PostgreSQL database built from every migration
// file (069 included). Zero external calls: SMTP/IMAP is an in-process double.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch1-sending-postgres.test.js
// Skipped when no admin URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const DAY=86_400_000;
const SECRET_KEY=crypto.randomBytes(32).toString('hex');
const POLICY='MC07_DPV_FIRST_TOUCH_V1';const TEMPLATE_SET='DPV_FIRST_TOUCH_V1';

async function withDatabase(run){
  const name=`batch1_send_${crypto.randomBytes(4).toString('hex')}`;
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

// Fixture setup bypasses guard triggers the way the existing merchant integration test does.
async function fixtures(pool){
  const client=await pool.connect();
  try{
    await client.query('SET session_replication_role=replica');
    await client.query(`UPDATE leadgen.phase13_first_touch_controls SET enabled=true,per_minute_limit=10,per_day_limit=50 WHERE policy_revision=$1`,[POLICY]);
    await client.query(`INSERT INTO leadgen.automation_controls(control_key,enabled,updated_by,change_reason) VALUES('PHASE13_AUTO_FIRST_TOUCH',true,'test','fixture')
      ON CONFLICT(control_key) DO UPDATE SET enabled=true`);
    // AE is seeded by the migrations; open its send window all day so the test is time-independent.
    const market=await client.query(`UPDATE leadgen.research_market_registry SET status='ACTIVE',timezone='UTC',
      business_send_window='{"days":[1,2,3,4,5,6,7],"start":"00:00","end":"23:59"}'::jsonb WHERE market_code='AE'`);
    assert.equal(market.rowCount,1);
    const companies={};
    for(const key of ['assigned','free','other']){
      companies[key]=uuid();
      await client.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES($1,$2,$3,'AE')`,[companies[key],`Buyer ${key}`,`${key}-buyer.example`]);
    }
    await client.query('RESET session_replication_role');
    return companies;
  }finally{client.release();}
}

async function reserve(pool,{company,recipient,merchantId=null,dailyLimit=30}){
  const body=`Hello ${recipient} ${company}`;
  const args=[company,POLICY,null,recipient,'AE',TEMPLATE_SET,'C_OFFICIAL_GENERIC_MAILBOX','sender@example.test','sender@example.test','Subject',body,hex(body),'{}',[]];
  const sql=merchantId
    ?'SELECT * FROM leadgen.reserve_phase13_first_touch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[],$15::uuid,$16::integer)'
    :'SELECT * FROM leadgen.reserve_phase13_first_touch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[])';
  return (await pool.query(sql,merchantId?[...args,merchantId,dailyLimit]:args)).rows[0];
}
const raises=(promise,code)=>assert.rejects(promise,error=>String(error.message).includes(code));

test('069: reservation function enforces opt-in, mailbox hold, merchant assignment and the cross-sender recipient cooldown',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const companies=await fixtures(pool);
    const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET_KEY}});
    const a=(await merchants.createMerchant({company_name:'Alpha',contact_name:'Anna',login_email:'anna@alpha.example'},'admin')).merchant.id;
    const b=(await merchants.createMerchant({company_name:'Beta',contact_name:'Ben',login_email:'ben@beta.example'},'admin')).merchant.id;
    assert.equal((await pool.query('SELECT auto_first_touch_enabled FROM leadgen.merchants_current WHERE id=$1',[a])).rows[0].auto_first_touch_enabled,false);
    await merchants.assignCompanies(a,[companies.assigned],'admin');

    await raises(reserve(pool,{company:companies.assigned,recipient:'info@buyer.example',merchantId:a}),'MERCHANT_AUTO_FIRST_TOUCH_OFF');
    await raises(reserve(pool,{company:companies.assigned,recipient:'info@buyer.example'}),'COMPANY_ASSIGNED_TO_MERCHANT');

    await pool.query('UPDATE leadgen.merchants SET auto_first_touch_enabled=true WHERE id=ANY($1::uuid[])',[[a,b]]);
    const first=await reserve(pool,{company:companies.assigned,recipient:'info@buyer.example',merchantId:a});
    assert.equal(first.status,'RESERVED');assert.equal(first.merchant_id,a);
    // Same address, other senders, other companies: blocked for SIM and for merchant B.
    await raises(reserve(pool,{company:companies.free,recipient:' INFO@Buyer.example'}),'RECIPIENT_RECENTLY_CONTACTED');
    await raises(reserve(pool,{company:companies.other,recipient:'info@buyer.example',merchantId:b}),'RECIPIENT_RECENTLY_CONTACTED');
    // A different address is fine; an older first touch (31 days) no longer blocks.
    assert.equal((await reserve(pool,{company:companies.free,recipient:'buyer@free.example'})).status,'RESERVED');
    await pool.query(`UPDATE leadgen.phase13_first_touch_reservations SET reserved_at=now()-interval '31 days' WHERE id=$1`,[first.id]);
    assert.equal((await reserve(pool,{company:companies.other,recipient:'info@buyer.example',merchantId:b})).status,'RESERVED');

    // A held merchant mailbox reserves nothing.
    await merchants.saveMailbox(b,{preset_key:'gmail',username:'ben@beta.example',password:'app-pass'},'admin');
    await merchants.holdMailbox(b,'SMTP_SEND_INTERRUPTED');
    await merchants.assignCompanies(b,[companies.free],'admin');
    await raises(reserve(pool,{company:companies.free,recipient:'sales@free.example',merchantId:b}),'MERCHANT_MAILBOX_HELD');
  });
});

test('069: sending list needs opt-in and no hold; inbound list keeps expired merchants; three failed tests clear verification',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const results=[];
    const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET_KEY},providerFactory:()=>({async testConnections(){return results.shift();}})});
    const make=async name=>(await merchants.createMerchant({company_name:name,contact_name:name,login_email:`${name.toLowerCase()}@m.example`},'admin')).merchant.id;
    const active=await make('Active');const expired=await make('Expired');const disabled=await make('Disabled');
    for(const id of [active,expired,disabled]){
      await merchants.saveMailbox(id,{preset_key:'gmail',username:`box-${id.slice(0,8)}@m.example`,password:'app-pass'},'admin');
      results.push({smtp:{ok:true},imap:{ok:true}});await merchants.testConnection(id);
    }
    await pool.query(`UPDATE leadgen.merchants SET trial_ends_at=now()-interval '1 day' WHERE id=$1`,[expired]);
    await pool.query(`UPDATE leadgen.merchants SET status='DISABLED' WHERE id=$1`,[disabled]);
    const ids=rows=>rows.map(row=>row.id).sort();
    assert.deepEqual(ids(await merchants.sendingMerchants()),[]);
    await assert.rejects(merchants.setAutoFirstTouch(expired,true,'x'),{code:'MERCHANT_READ_ONLY'});
    const view=await merchants.setAutoFirstTouch(active,true,'owner@m.example');assert.equal(view.auto_first_touch.enabled,true);
    assert.deepEqual(ids(await merchants.sendingMerchants()),[active]);
    assert.deepEqual(ids(await merchants.inboundMerchants()),[active,expired].sort());
    await merchants.holdMailbox(active,'SMTP_SEND_INTERRUPTED');
    assert.deepEqual(ids(await merchants.sendingMerchants()),[]);
    assert.equal((await merchants.mailbox(active)).sending_hold.reason,'SMTP_SEND_INTERRUPTED');
    // One failed test keeps verification; three in a row clear it; a success lifts the hold.
    results.push({smtp:{ok:false,code:'SMTP_TIMEOUT'},imap:{ok:true}});
    assert.equal((await merchants.testConnection(active)).verified,true);
    assert.ok((await merchants.mailbox(active)).verified_at);
    results.push({smtp:{ok:true},imap:{ok:true}});await merchants.testConnection(active);
    const lifted=await merchants.mailbox(active);assert.equal(lifted.sending_hold,null);assert.equal(lifted.consecutive_test_failures,0);
    for(let i=0;i<3;i++)results.push({smtp:{ok:true},imap:{ok:false,code:'IMAP_AUTH'}});
    await merchants.testConnection(active);await merchants.testConnection(active);
    assert.ok((await merchants.mailbox(active)).verified_at);
    await merchants.testConnection(active);
    const cleared=await merchants.mailbox(active);assert.equal(cleared.verified_at,null);assert.equal(cleared.consecutive_test_failures,3);
    assert.deepEqual(ids(await merchants.inboundMerchants()),[expired]);
    // Admin view shows the merchant setting and mailbox state read-only.
    const admin=await merchants.adminMerchant(active);
    assert.equal(admin.auto_first_touch_enabled,true);assert.equal(admin.mailbox.configured,true);assert.equal(admin.mailbox.verified_at,null);
    void DAY;
  });
});
