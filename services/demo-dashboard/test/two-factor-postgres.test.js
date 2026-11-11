// Two-step sign-in (migration 078) over real HTTP against a throwaway PostgreSQL database.
// Codes are computed from the secret the setup returns, with a test clock; zero external calls.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {createSessionMiddleware,createWorkspaceGate} from '../src/merchant/auth.js';
import {createMerchantRouter} from '../src/merchant/router.js';
import {TwoFactorService} from '../src/merchant/twoFactor.js';
import {TWO_FACTOR_MIGRATION_KEY,verifyTwoFactorMigration} from '../src/phase7/migrationRunner.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const SECRET_KEY=crypto.randomBytes(32).toString('hex');

async function withDatabase(run){
  const name=`two_factor_it_${crypto.randomBytes(4).toString('hex')}`;
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
// The code an authenticator app would show for this secret at the test clock.
const codeAt=(secret,ms)=>new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret.replace(/\s/g,'')),digits:6,period:30}).generate({timestamp:ms});

test('migration 078 is the latest file and verifies; two-step history is append-only',{skip:!adminUrl},async()=>{
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
  assert.equal(files.at(-1),TWO_FACTOR_MIGRATION_KEY);
  await withDatabase(async pool=>{
    assert.deepEqual(await verifyTwoFactorMigration(pool),{two_factor:true});
    const merchants=new MerchantService({pool,env:{}});
    const user=await merchants.createAdmin({email:'simon@sim.example',password:'AdminPass2026'});
    const event=(await pool.query(`INSERT INTO leadgen.two_factor_events(user_id,event_type,actor) VALUES($1,'ENABLED','t') RETURNING id`,[user.id])).rows[0];
    await assert.rejects(pool.query('DELETE FROM leadgen.two_factor_events WHERE id=$1',[event.id]),/TWO_FACTOR_APPEND_ONLY/);
    await assert.rejects(pool.query(`UPDATE leadgen.workspace_users SET totp_enabled_at=now() WHERE id=$1`,[user.id]),/workspace_users_totp_enabled_check/,'cannot be on without a secret');
  });
});

test('administrator: setup is required, then every sign-in needs a fresh code or a one-time recovery code; a merchant may opt in and SIM can reset it',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const env={AUTH_REQUIRED:'true',SESSION_SECRET:'test-session-secret',MERCHANT_SECRET_KEY:SECRET_KEY,DPV_WORKSPACE_ACTOR:'dev'};
    let clock=Date.parse('2026-11-11T08:00:05Z');
    const merchants=new MerchantService({pool,env});
    const twoFactor=new TwoFactorService({pool,env,now:()=>clock});
    const app=express();app.use(express.json());
    app.use('/api',createSessionMiddleware({pool,env}));
    app.use(createWorkspaceGate({merchants,env,pool}));
    app.use(createMerchantRouter({merchants,env,twoFactor}));
    app.use((error,_req,res,_next)=>res.status(Number(error.status)||500).json({code:error.code,error:error.message}));
    const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
      await merchants.createAdmin({email:'simon@sim.example',password:'AdminPass2026',display_name:'Simon'});
      let simon=client(base);
      // Signed in, but nothing works until two-step sign-in is set up.
      assert.equal((await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'AdminPass2026'})).status,200);
      const me=(await simon('GET','/api/auth/me')).body.user;
      assert.equal(me.two_factor_setup_required,true);assert.deepEqual([me.two_factor.enabled,me.two_factor.required],[false,true]);
      assert.equal((await simon('GET','/api/admin/merchants')).body.code,'TWO_FACTOR_SETUP_REQUIRED');
      assert.equal((await simon('POST','/api/auth/2fa/enable',{code:'123456'})).body.code,'TWO_FACTOR_SETUP_NOT_STARTED');
      const setup=(await simon('POST','/api/auth/2fa/setup')).body;
      assert.match(setup.qr_data_url,/^data:image\/png;base64,/);assert.match(setup.otpauth_uri,/^otpauth:\/\/totp\/SIM%20Prospecting:simon%40sim\.example\?/);
      assert.match(setup.secret,/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/);
      const stored=(await pool.query(`SELECT totp_pending_ciphertext,totp_secret_ciphertext FROM leadgen.workspace_users WHERE email='simon@sim.example'`)).rows[0];
      assert.ok(stored.totp_pending_ciphertext&&!stored.totp_pending_ciphertext.includes(setup.secret.replace(/\s/g,'')),'the secret is stored encrypted');
      assert.equal(stored.totp_secret_ciphertext,null,'not active before a correct code');
      assert.equal((await simon('POST','/api/auth/2fa/enable',{code:'000000'})).body.code,'TWO_FACTOR_CODE_INVALID');
      const enabled=(await simon('POST','/api/auth/2fa/enable',{code:codeAt(setup.secret,clock)})).body;
      assert.equal(enabled.recovery_codes.length,10);assert.match(enabled.recovery_codes[0],/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      assert.deepEqual([enabled.user.two_factor.enabled,enabled.user.two_factor.recovery_codes_left,enabled.user.two_factor_setup_required],[true,10,false]);
      assert.equal((await simon('GET','/api/admin/merchants')).status,200);
      assert.equal((await simon('POST','/api/auth/2fa/disable',{password:'AdminPass2026',code:codeAt(setup.secret,clock+30_000)})).body.code,'TWO_FACTOR_REQUIRED');

      // Next sign-in: the password alone signs nobody in.
      await simon('POST','/api/auth/logout');
      simon=client(base);
      assert.deepEqual((await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'AdminPass2026'})).body,{two_factor_required:true});
      assert.equal((await simon('GET','/api/auth/me')).status,401);
      assert.equal((await simon('GET','/api/admin/merchants')).body.code,'AUTH_REQUIRED');
      // The code used to switch it on cannot be used again (same 30-second step).
      assert.equal((await simon('POST','/api/auth/2fa/verify',{code:codeAt(setup.secret,clock)})).body.code,'TWO_FACTOR_CODE_INVALID');
      clock+=30_000;
      const verified=await simon('POST','/api/auth/2fa/verify',{code:codeAt(setup.secret,clock)});
      assert.equal(verified.status,200);assert.equal(verified.body.method,'AUTHENTICATOR');assert.equal(verified.body.user.email,'simon@sim.example');
      assert.equal((await simon('GET','/api/admin/merchants')).status,200);

      // A recovery code works once.
      await simon('POST','/api/auth/logout');simon=client(base);
      await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'AdminPass2026'});
      const recovered=await simon('POST','/api/auth/2fa/verify',{recovery_code:enabled.recovery_codes[3].toUpperCase().replace('-',' ')});
      assert.equal(recovered.body.method,'RECOVERY_CODE');assert.equal(recovered.body.recovery_codes_left,9);
      await simon('POST','/api/auth/logout');simon=client(base);
      await simon('POST','/api/auth/login',{email:'simon@sim.example',password:'AdminPass2026'});
      assert.equal((await simon('POST','/api/auth/2fa/verify',{recovery_code:enabled.recovery_codes[3]})).body.code,'TWO_FACTOR_CODE_INVALID');
      // A second-step request without a password step first is refused.
      assert.equal((await client(base)('POST','/api/auth/2fa/verify',{code:'123456'})).body.code,'TWO_FACTOR_SESSION_EXPIRED');
      // Wrong codes count against the sign-in limiter (8 per 15 minutes).
      let last;for(let i=0;i<9;i++)last=await simon('POST','/api/auth/2fa/verify',{code:'000000'});
      assert.equal(last.body.code,'AUTH_RATE_LIMITED');
      await pool.query('UPDATE leadgen.login_attempts SET attempts=0,locked_until=NULL');
      clock+=30_000;
      assert.equal((await simon('POST','/api/auth/2fa/verify',{code:codeAt(setup.secret,clock)})).status,200);
      // New recovery codes replace the old ones.
      clock+=30_000;
      const renewed=(await simon('POST','/api/auth/2fa/recovery-codes',{code:codeAt(setup.secret,clock)})).body.recovery_codes;
      assert.equal(renewed.length,10);assert.equal((await simon('GET','/api/auth/me')).body.user.two_factor.recovery_codes_left,10);

      // ---- merchant: optional ----
      const created=(await simon('POST','/api/admin/merchants',{company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'})).body;
      const anna=client(base);
      await anna('POST','/api/auth/login',{email:'anna@alpha.example',password:created.temporary_password});
      await anna('POST','/api/auth/password',{current_password:created.temporary_password,new_password:'AnnaPass2026'});
      const annaMe=(await anna('GET','/api/auth/me')).body.user;
      assert.deepEqual([annaMe.two_factor.required,annaMe.two_factor_setup_required],[false,false]);
      assert.equal((await anna('GET','/api/merchant/profile')).status,200,'merchants are not forced');
      const annaSetup=(await anna('POST','/api/auth/2fa/setup')).body;
      await anna('POST','/api/auth/2fa/enable',{code:codeAt(annaSetup.secret,clock)});
      await anna('POST','/api/auth/logout');
      const annaAgain=client(base);
      assert.deepEqual((await annaAgain('POST','/api/auth/login',{email:'anna@alpha.example',password:'AnnaPass2026'})).body,{two_factor_required:true});
      // Lost phone: SIM resets it; the next sign-in needs the password only.
      assert.deepEqual((await simon('POST',`/api/admin/merchants/${created.merchant.id}/reset-2fa`)).body,{reset:1});
      assert.equal((await anna('POST',`/api/admin/merchants/${created.merchant.id}/reset-2fa`)).status,401);
      const annaThird=client(base);
      assert.equal((await annaThird('POST','/api/auth/login',{email:'anna@alpha.example',password:'AnnaPass2026'})).body.user.email,'anna@alpha.example');
      // A merchant may also switch it off itself (password and a current code).
      const annaSetup2=(await annaThird('POST','/api/auth/2fa/setup')).body;
      clock+=30_000;await annaThird('POST','/api/auth/2fa/enable',{code:codeAt(annaSetup2.secret,clock)});
      assert.equal((await annaThird('POST','/api/auth/2fa/disable',{password:'wrong-pass-1',code:codeAt(annaSetup2.secret,clock+30_000)})).body.code,'AUTH_INVALID_CREDENTIALS');
      clock+=30_000;
      assert.equal((await annaThird('POST','/api/auth/2fa/disable',{password:'AnnaPass2026',code:codeAt(annaSetup2.secret,clock)})).body.user.two_factor.enabled,false);

      const events=(await pool.query(`SELECT u.email,e.event_type,e.actor FROM leadgen.two_factor_events e JOIN leadgen.workspace_users u ON u.id=e.user_id ORDER BY e.recorded_at,e.id`)).rows;
      assert.deepEqual(events.map(row=>`${row.email}:${row.event_type}`),['simon@sim.example:ENABLED','simon@sim.example:RECOVERY_CODE_USED','simon@sim.example:RECOVERY_CODES_RENEWED',
        'anna@alpha.example:ENABLED','anna@alpha.example:RESET_BY_ADMIN','anna@alpha.example:ENABLED','anna@alpha.example:DISABLED']);
      assert.equal(events.find(row=>row.event_type==='RESET_BY_ADMIN').actor,'simon@sim.example');
    }finally{server.close();}
  });
});
