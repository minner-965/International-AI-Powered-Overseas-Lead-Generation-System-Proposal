// Email results per owner and exchange rates against a throwaway PostgreSQL database built from every migration.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import {EmailStatsService} from '../src/crm/emailStats.js';
import {ExchangeRateService} from '../src/crm/exchangeRates.js';
import {createCrmStatsRouter} from '../src/crm/statsRouter.js';
import {MerchantService} from '../src/merchant/MerchantService.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const SIM=Object.freeze({merchantId:null,restrict:false});

async function withDatabase(run){
  const name=`crm_stats_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:4});
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

// Mail rows are seeded with triggers and foreign keys off; only the columns the statistics read matter.
async function seedMail(pool,{merchantId=null,sentAt,bounced=false,complained=false,replyAt=null,purpose='COLD_OUTREACH'}){
  const id=uuid(),company=uuid(),key=uuid();
  await pool.query(`INSERT INTO leadgen.outbound_messages(id,company_id,provider,provider_purpose,idempotency_key,send_execution_key,send_status,first_touch_reservation_id,sent_at,merchant_id)
    VALUES($1,$2,'SMTP',$3,$4,$4,$5,$6,$7,$8)`,[id,company,purpose,key,bounced?'HARD_BOUNCED':'PROVIDER_ACCEPTED',uuid(),sentAt,merchantId]);
  if(complained)await pool.query(`INSERT INTO leadgen.email_message_events(outbound_message_id,event_type,occurred_at,event_digest) VALUES($1,'COMPLAINED',$2,$3)`,[id,sentAt,hex(id+'c')]);
  if(replyAt){
    const thread=uuid();
    await pool.query(`INSERT INTO leadgen.outreach_threads(id,company_id,thread_token,first_touch_reservation_id,merchant_id) VALUES($1,$2,$3,$4,$5)`,[thread,company,hex(thread),uuid(),merchantId]);
    await pool.query(`INSERT INTO leadgen.inbound_messages(thread_id,provider,provider_message_id,from_address_hash,received_at,merchant_id) VALUES($1,'IMAP',$2,$3,$4,$5)`,[thread,`<${thread}@x>`,hex(thread+'f'),replyAt,merchantId]);
  }
  return id;
}

test('email results: per owner, zero-filled days and months, transactional mail left out, a line per merchant mailbox for SIM',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const now=new Date('2026-11-22T12:00:00Z');
    const merchants=new MerchantService({pool,env:{}});
    const alpha=(await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin')).merchant;
    await pool.query('SET session_replication_role=replica');
    try{
      await pool.query(`INSERT INTO leadgen.merchant_mailboxes(merchant_id,smtp_host,smtp_port,imap_host,imap_port,username,password_ciphertext,from_email,reply_to,updated_by)
        VALUES($1,'smtp.alpha.example',587,'imap.alpha.example',993,'sales',NULL,'sales@alpha.example','sales@alpha.example','anna')`,[alpha.id]);
      await seedMail(pool,{sentAt:'2026-11-22T08:00:00Z',replyAt:'2026-11-22T10:00:00Z'});
      await seedMail(pool,{sentAt:'2026-11-22T09:00:00Z',bounced:true});
      await seedMail(pool,{sentAt:'2026-11-20T09:00:00Z',complained:true});
      await seedMail(pool,{sentAt:'2026-11-20T09:30:00Z',purpose:'TRANSACTIONAL'});
      await seedMail(pool,{sentAt:'2026-06-03T09:00:00Z'});
      await seedMail(pool,{merchantId:alpha.id,sentAt:'2026-11-21T09:00:00Z',bounced:true});
      await seedMail(pool,{merchantId:alpha.id,sentAt:'2026-11-21T09:10:00Z'});
    }finally{await pool.query('RESET session_replication_role');}
    const stats=new EmailStatsService({pool,now:()=>now});

    const days=await stats.stats(SIM,'30d');
    assert.equal(days.rows.length,30);assert.equal(days.rows.at(-1).period,'2026-11-22');assert.equal(days.rows[0].period,'2026-10-24');
    assert.deepEqual(days.rows.at(-1),{period:'2026-11-22',sent:2,replied:1,bounced:1,complained:0});
    assert.deepEqual(days.rows.find(row=>row.period==='2026-11-20'),{period:'2026-11-20',sent:1,replied:0,bounced:0,complained:1},'transactional mail is not counted');
    assert.deepEqual([days.totals.sent,days.totals.replied,days.totals.bounced,days.totals.complained,days.totals.reply_rate],[3,1,1,1,33.3]);
    const [own,alphaBox]=days.mailboxes;
    assert.deepEqual([own.sender_key,own.level,own.reasons],['SIM','HIGH',['BOUNCE_HIGH','COMPLAINTS']]);
    assert.deepEqual([alphaBox.label,alphaBox.merchant_name,alphaBox.totals.sent,alphaBox.level],['sales@alpha.example','Alpha Textiles',2,'HIGH']);

    const months=await stats.stats(SIM,'12m');
    assert.equal(months.rows.length,12);assert.equal(months.rows.at(-1).period,'2026-11');
    assert.equal(months.rows.find(row=>row.period==='2026-06').sent,1);assert.equal(months.totals.sent,4);

    const merchantView=await stats.stats({merchantId:alpha.id,restrict:true},'30d');
    assert.equal(merchantView.totals.sent,2);assert.equal(merchantView.mailboxes.length,1,'a merchant sees only its own mailbox');
    assert.equal(merchantView.mailboxes[0].label,'sales@alpha.example');
    await assert.rejects(stats.stats(SIM,'7d'),{code:'CRM_VALUE_INVALID'});
  });
});

test('exchange rates: saved per owner as a whole set, history kept, converted totals through the route',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const rates=new ExchangeRateService({pool});
    assert.deepEqual(await rates.get(SIM),{base_currency:'USD',rates:[],updated_at:null,updated_by:null});
    await rates.save({base_currency:'USD',rates:[{currency:'EUR',rate:1.08},{currency:'AED',rate:0.2723}]},'simon',SIM);
    let saved=await rates.save({base_currency:'USD',rates:[{currency:'EUR',rate:1.1}]},'simon',SIM);
    assert.deepEqual(saved.rates,[{currency:'EUR',rate:1.1}],'the whole set is replaced');assert.equal(saved.updated_by,'simon');
    assert.equal(Number((await pool.query('SELECT count(*) FROM leadgen.crm_exchange_rate_events')).rows[0].count),2);
    await assert.rejects(rates.save({base_currency:'USD',rates:[{currency:'USD',rate:1}]},'simon',SIM),{code:'CRM_RATE_SAME_AS_BASE'});
    assert.deepEqual((await rates.get(SIM)).rates,[{currency:'EUR',rate:1.1}],'a refused save changes nothing');

    const merchants=new MerchantService({pool,env:{}});
    const alpha=(await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin')).merchant;
    const alphaScope={merchantId:alpha.id,restrict:true};
    assert.deepEqual((await rates.get(alphaScope)).rates,[],'a merchant does not see SIM rates');
    await rates.save({base_currency:'EUR',rates:[{currency:'USD',rate:0.92}]},'anna@alpha.example',alphaScope);
    assert.deepEqual((await rates.get(SIM)).rates,[{currency:'EUR',rate:1.1}]);assert.equal((await rates.get(alphaScope)).base_currency,'EUR');

    // Route: the report's currencies are converted with the caller's own rates.
    const deals={reports:async scope=>({currencies:scope.restrict?[{currency:'EUR',pipeline_amount:100,weighted_amount:50,won_amount:0}]
      :[{currency:'USD',pipeline_amount:1000,weighted_amount:400,won_amount:0},{currency:'EUR',pipeline_amount:2000,weighted_amount:200,won_amount:100}]})};
    let scope=SIM;
    const app=express();app.use(express.json());
    app.use((req,res,next)=>{req.workspaceScope=scope;req.managementUser={identity:scope.restrict?'anna@alpha.example':'simon'};next();});
    app.use('/api/crm',createCrmStatsRouter({pool,deals,managementAuth:{authenticate:(req,res,next)=>next(),requireRoles:()=>(req,res,next)=>next()}}));
    app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code}));
    const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api/crm`;
    try{
      let body=await(await fetch(`${base}/exchange-rates?include=totals`)).json();
      assert.deepEqual(body.converted,{base:'USD',total:{pipeline_amount:3200,weighted_amount:620,won_amount:110},missing:[],currencies:['USD','EUR']});
      assert.equal((await(await fetch(`${base}/exchange-rates`)).json()).converted,undefined,'totals only when asked');
      const put=await fetch(`${base}/exchange-rates`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({base_currency:'USD',rates:[{currency:'EURO',rate:1}]})});
      assert.equal(put.status,400);assert.equal((await put.json()).code,'CRM_VALUE_INVALID');
      scope=alphaScope;
      body=await(await fetch(`${base}/exchange-rates?include=totals`)).json();
      assert.equal(body.base_currency,'EUR');assert.deepEqual(body.converted.total,{pipeline_amount:100,weighted_amount:50,won_amount:0});
      assert.equal((await(await fetch(`${base}/email-stats?range=12m`)).json()).rows.length,12);
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
});
