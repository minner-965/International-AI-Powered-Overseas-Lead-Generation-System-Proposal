// Trial applications and payment records (migration 082) over real HTTP against a throwaway PostgreSQL
// database: the public form needs no session, only the administrator reviews and records payments.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {createSessionMiddleware,createWorkspaceGate} from '../src/merchant/auth.js';
import {createMerchantRouter} from '../src/merchant/router.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');

async function withDatabase(run){
  const name=`onboarding_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:8});
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
function client(base){
  let cookie='';
  return async(method,url,body)=>{
    const response=await fetch(base+url,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    let json=null;try{json=await response.json();}catch{}
    return{status:response.status,body:json};
  };
}

test('trial applications: public form, one open per email, approve opens a trial account, reject needs a reason; payments mark the merchant paid',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const env={AUTH_REQUIRED:'true',ADMIN_2FA_REQUIRED:'false',SESSION_SECRET:'test-session-secret',MERCHANT_SECRET_KEY:crypto.randomBytes(32).toString('hex')};
    const merchants=new MerchantService({pool,env});
    const app=express();app.use(express.json());
    app.use('/api',createSessionMiddleware({pool,env}));
    app.use(createWorkspaceGate({merchants,env,pool}));
    app.use(createMerchantRouter({merchants,env}));
    app.use((error,_req,res,_next)=>res.status(Number(error.status)||500).json({code:error.code,error:error.message}));
    const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
      await merchants.createAdmin({email:'simon@sim.example',password:'AdminPass2026',display_name:'Simon'});
      const existing=await merchants.createMerchant({company_name:'Existing Co',contact_name:'Eve',login_email:'eve@existing.example'},'simon');
      const visitor=client(base);
      // ---- public form: no session needed; the same answer whether stored or not ----
      const form={company_name:'Alpha Textiles',contact_name:'Anna',email:'anna@alpha.example',phone:'+86 138 0000 0000',country:'China',message:'Dresses for the Gulf'};
      assert.deepEqual(await visitor('POST','/api/merchant-applications',form),{status:202,body:{status:'RECEIVED'}});
      assert.deepEqual(await visitor('POST','/api/merchant-applications',{...form,company_name:'Alpha again',email:'ANNA@alpha.example'}),{status:202,body:{status:'RECEIVED'}});
      assert.equal((await visitor('POST','/api/merchant-applications',{...form,email:'bot@spam.example',website_url2:'http://spam.example'})).status,202);
      assert.equal((await visitor('POST','/api/merchant-applications',{company_name:'Taken',contact_name:'Eve',email:'eve@existing.example'})).status,202);
      assert.equal((await visitor('POST','/api/merchant-applications',{company_name:'Beta',contact_name:'Bob'})).body.code,'APPLICATION_EMAIL_INVALID');
      assert.equal((await visitor('POST','/api/merchant-applications',form)).body.code,'APPLICATION_RATE_LIMITED','five per hour from one address');
      const rows=(await pool.query(`SELECT email,status,source_ip_hash FROM leadgen.merchant_applications ORDER BY created_at`)).rows;
      assert.deepEqual(rows.map(row=>[row.email,row.status]),[['anna@alpha.example','PENDING'],['eve@existing.example','PENDING']],'duplicate and automated ones are not stored');
      assert.match(rows[0].source_ip_hash,/^[0-9a-f]{64}$/,'only a hash of the address is kept');
      // ---- only the administrator reviews ----
      assert.equal((await visitor('GET','/api/admin/merchant-applications')).status,401);
      const simon=client(base);
      assert.equal((await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'AdminPass2026'})).status,200);
      const list=(await simon('GET','/api/admin/merchant-applications?status=PENDING')).body;
      assert.equal(list.items.length,2);assert.deepEqual(list.counts,{PENDING:2,APPROVED:0,REJECTED:0});
      const anna=list.items.find(item=>item.email==='anna@alpha.example'),eve=list.items.find(item=>item.email==='eve@existing.example');
      assert.equal(eve.email_in_use,true);
      // Approve: a trial merchant with a temporary password; deciding twice is refused.
      const approved=await simon('POST',`/api/admin/merchant-applications/${anna.id}/approve`,{trial_days:10});
      assert.equal(approved.status,201);assert.equal(approved.body.user.email,'anna@alpha.example');assert.ok(approved.body.temporary_password);
      assert.deepEqual([approved.body.application.status,approved.body.application.merchant_id],['APPROVED',approved.body.merchant.id]);
      assert.equal(approved.body.merchant.status,'TRIAL');
      assert.equal((await simon('POST',`/api/admin/merchant-applications/${anna.id}/approve`,{})).body.code,'APPLICATION_DECIDED');
      // The new merchant signs in with the temporary password; it cannot see applications.
      const annaClient=client(base);
      assert.equal((await annaClient('POST','/api/auth/login',{email:'anna@alpha.example',password:approved.body.temporary_password})).status,200);
      assert.equal((await annaClient('GET','/api/admin/merchant-applications')).status,403);
      // An email that already has an account: refused, application stays open; then rejected with a reason.
      assert.equal((await simon('POST',`/api/admin/merchant-applications/${eve.id}/approve`,{})).body.code,'APPLICATION_EMAIL_TAKEN');
      assert.equal((await pool.query('SELECT status FROM leadgen.merchant_applications WHERE id=$1',[eve.id])).rows[0].status,'PENDING');
      assert.equal((await simon('POST',`/api/admin/merchant-applications/${eve.id}/reject`,{reason:' '})).body.code,'APPLICATION_REASON_REQUIRED');
      assert.equal((await simon('POST',`/api/admin/merchant-applications/${eve.id}/reject`,{reason:'Already a customer'})).body.application.status,'REJECTED');
      assert.equal((await simon('POST',`/api/admin/merchant-applications/${eve.id}/reject`,{reason:'again'})).body.code,'APPLICATION_DECIDED');
      await assert.rejects(pool.query('DELETE FROM leadgen.merchant_applications'),/MERCHANT_APPLICATION_KEPT/);

      // ---- payments: recorded by SIM only; mark paid until the covered day, never shorten it ----
      const merchantId=existing.merchant.id;
      const nextYear=new Date(Date.now()+365*86_400_000).toISOString().slice(0,10),soon=new Date(Date.now()+30*86_400_000).toISOString().slice(0,10);
      assert.equal((await annaClient('POST',`/api/admin/merchants/${merchantId}/payments`,{amount:1,currency:'CNY',paid_until:nextYear})).status,403);
      const paid=await simon('POST',`/api/admin/merchants/${merchantId}/payments`,{amount:1999,currency:'cny',method:'ALIPAY',paid_until:nextYear,external_reference:'TX-1'});
      assert.equal(paid.status,201);assert.equal(paid.body.merchant.status,'ACTIVE');
      assert.equal(new Date(paid.body.merchant.paid_until).toISOString().slice(0,10),nextYear);
      const shorter=await simon('POST',`/api/admin/merchants/${merchantId}/payments`,{amount:100,currency:'CNY',method:'BANK',paid_until:soon});
      assert.equal(new Date(shorter.body.merchant.paid_until).toISOString().slice(0,10),nextYear,'a later end date stays');
      assert.equal((await simon('POST',`/api/admin/merchants/${merchantId}/payments`,{amount:5,currency:'CNY',method:'ALIPAY',paid_until:nextYear,external_reference:'TX-1'})).body.code,'PAYMENT_DUPLICATE');
      assert.equal((await simon('POST',`/api/admin/merchants/${merchantId}/payments`,{amount:-5,currency:'CNY',paid_until:nextYear})).body.code,'PAYMENT_AMOUNT_INVALID');
      const history=(await simon('GET',`/api/admin/merchants/${merchantId}/payments`)).body.items;
      assert.deepEqual(history.map(item=>[item.amount,item.currency,item.method]).sort((a,b)=>b[0]-a[0]),[[1999,'CNY','ALIPAY'],[100,'CNY','BANK']]);
      assert.equal((await simon('GET','/api/admin/merchants')).body.items.find(item=>item.id===merchantId).status,'ACTIVE');
      await assert.rejects(pool.query('UPDATE leadgen.merchant_payments SET amount=1'),/MERCHANT_PAYMENT_APPEND_ONLY/);
      await assert.rejects(pool.query('DELETE FROM leadgen.merchant_payments'),/MERCHANT_PAYMENT_APPEND_ONLY/);
      // ---- online payment callback is not connected ----
      assert.equal((await visitor('POST','/api/webhooks/payments/stripe',{})).status,404);
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
});
