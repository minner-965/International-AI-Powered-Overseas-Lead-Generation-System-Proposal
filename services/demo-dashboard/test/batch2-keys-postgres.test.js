// Batch 2 B9 against throwaway PostgreSQL databases: migration 071 on a fresh database (every migration
// file) and on a copy of live_copy; encrypted storage, append-only history, no plaintext in any API
// answer, merchant isolation, resolver precedence and the test button (provider mocked).
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch2-keys-postgres.test.js
// Optional: KEYS_TEST_LIVE_TEMPLATE=live_copy (default) - the copy is skipped when that database is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {createCredentialResolver,verifyProviderCredentialsMigration} from '../src/credentials/credentialResolver.js';
import {createCredentialsRouter} from '../src/credentials/router.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||'';
const liveTemplate=process.env.KEYS_TEST_LIVE_TEMPLATE||'live_copy';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const MIGRATION='071_provider_credentials.sql';
const SECRET_KEY=crypto.randomBytes(32).toString('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function withDatabase({template=null}={},run){
  const name=`batch2_keys_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{
    for(let attempt=0;;attempt+=1){
      try{await admin.query(template?`CREATE DATABASE ${name} TEMPLATE ${pg.escapeIdentifier(template)}`:`CREATE DATABASE ${name}`);break;}
      catch(error){if(!template||attempt>=20||!/being accessed by other users/.test(error.message))throw error;await wait(1500);}
    }
  }finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:6});
  try{return await run(pool);}
  finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}
async function applyAll(pool){
  for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
    await pool.query(await readFile(path.join(migrations,file),'utf8'));
}
const apply071=async pool=>pool.query(await readFile(path.join(migrations,MIGRATION),'utf8'));
async function templateExists(){
  if(!adminUrl)return false;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{return (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[liveTemplate])).rowCount===1;}finally{await admin.end();}
}

async function serve(router){
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{const header=req.get('x-test-user');if(header)req.workspaceUser=JSON.parse(header);next();});
  app.use(router);
  app.use((error,_req,res,_next)=>res.status(500).json({error:String(error.message)}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const bodies=[];
  const call=async(method,url,{user,body}={})=>{
    const response=await fetch(`${base}${url}`,{method,headers:{'content-type':'application/json',...(user?{'x-test-user':JSON.stringify(user)}:{})},body:body?JSON.stringify(body):undefined});
    const text=await response.text();bodies.push(text);
    return{status:response.status,body:text?JSON.parse(text):null,text};
  };
  return{call,bodies,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('071 on a fresh database: tables, guards and append-only history',{skip:!adminUrl},async()=>{
  await withDatabase({},async pool=>{
    await applyAll(pool);
    await apply071(pool); // re-runnable
    const client=await pool.connect();
    try{assert.deepEqual(await verifyProviderCredentialsMigration(client),{provider_credentials:true,provider_credential_tests:true,guards:2});}
    finally{client.release();}
    const store=createCredentialResolver({pool,secretKey:SECRET_KEY,env:{}});
    await store.set({provider:'tavily',values:{api_key:'tvly-first-0001'},actor:'simon'});
    await store.set({provider:'tavily',values:{api_key:'tvly-second-0002'},actor:'simon'});
    const rows=(await pool.query(`SELECT * FROM leadgen.provider_credentials WHERE provider='tavily' ORDER BY set_at,id`)).rows;
    assert.equal(rows.length,2);assert.equal(rows.filter(row=>!row.revoked_at).length,1);
    assert.ok(rows.every(row=>!row.ciphertext.includes('tvly-')),'only ciphertext is stored');
    await assert.rejects(pool.query(`DELETE FROM leadgen.provider_credentials`),/APPEND_ONLY/);
    await assert.rejects(pool.query(`UPDATE leadgen.provider_credentials SET ciphertext='v1:x:y:z' WHERE revoked_at IS NULL`),/APPEND_ONLY/);
    await assert.rejects(pool.query(`UPDATE leadgen.provider_credentials SET revoked_at=NULL,revoked_by=NULL WHERE revoked_at IS NOT NULL`),/APPEND_ONLY/);
    await assert.rejects(pool.query(`INSERT INTO leadgen.provider_credentials(owner_scope,provider,field,ciphertext,set_by) VALUES('SIM','tavily','api_key','v1:a:b:c','x')`),/provider_credentials_active_sim_idx/);
    await assert.rejects(pool.query(`INSERT INTO leadgen.provider_credentials(owner_scope,provider,field,ciphertext,set_by) VALUES('MERCHANT','exa','api_key','v1:a:b:c','x')`),/owner_pair/);
    await store.recordTest({provider:'tavily',source:'SIM',ok:true,code:'OK',actor:'simon'});
    await assert.rejects(pool.query(`DELETE FROM leadgen.provider_credential_tests`),/APPEND_ONLY/);
  });
});

test('071 on a copy of live_copy: applies over live data without changing existing rows',{skip:!adminUrl},async t=>{
  if(!await templateExists())return t.skip(`${liveTemplate} not present`);
  await withDatabase({template:liveTemplate},async pool=>{
    const before=(await pool.query(`SELECT (SELECT count(*) FROM leadgen.merchants)::int merchants,(SELECT count(*) FROM leadgen.companies)::int companies,
      (SELECT count(*) FROM leadgen.schema_migrations)::int migrations`)).rows[0];
    await apply071(pool);await apply071(pool);
    const after=(await pool.query(`SELECT (SELECT count(*) FROM leadgen.merchants)::int merchants,(SELECT count(*) FROM leadgen.companies)::int companies,
      (SELECT count(*) FROM leadgen.schema_migrations)::int migrations`)).rows[0];
    assert.deepEqual(after,before);
    const client=await pool.connect();
    try{assert.equal((await verifyProviderCredentialsMigration(client)).guards,2);}finally{client.release();}
    const merchant=(await pool.query('SELECT id FROM leadgen.merchants ORDER BY created_at LIMIT 1')).rows[0];
    const store=createCredentialResolver({pool,secretKey:SECRET_KEY,env:{TAVILY_API_KEY:'env-key'}});
    if(merchant){
      await store.set({merchantId:merchant.id,provider:'hunter',values:{api_key:'hunter-merchant-9999'},actor:'test'});
      assert.equal(await store.getCredential({merchantId:merchant.id,provider:'hunter',field:'api_key'}),'hunter-merchant-9999');
    }
    assert.equal(await store.getCredential({provider:'tavily',field:'api_key'}),'env-key');
  });
});

test('B9 API: no plaintext in responses, merchant isolation, precedence, SIM-only providers, mocked test button',{skip:!adminUrl},async()=>{
  await withDatabase({},async pool=>{
    await applyAll(pool);
    const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET_KEY}});
    const a=(await merchants.createMerchant({company_name:'Alpha',contact_name:'Anna',login_email:'anna@alpha.example'},'admin')).merchant.id;
    const b=(await merchants.createMerchant({company_name:'Beta',contact_name:'Ben',login_email:'ben@beta.example'},'admin')).merchant.id;
    const env={HUNTER_API_KEY:'env-hunter-key-0000',SEARCH_PROVIDER_ORDER:'searxng,exa,tavily'};
    const store=createCredentialResolver({pool,secretKey:SECRET_KEY,env});
    const testerCalls=[];
    const tester=async(provider,resolved)=>{testerCalls.push({provider,resolved});if(!resolved.configured)return{ok:false,code:'NOT_CONFIGURED'};return resolved.values.api_key==='tvly-alpha-good-1111'?{ok:true,code:'OK'}:{ok:false,code:'KEY_REJECTED'};};
    const {call,bodies,close}=await serve(createCredentialsRouter({credentials:store,tester,spendPolicy:async()=>({mode:'FREE_ONLY'})}));
    const admin={id:'u0',role:'ADMIN',email:'simon@sim.example',merchant_id:null};
    const userA={id:'u1',role:'MERCHANT',email:'anna@alpha.example',merchant_id:a};
    const userB={id:'u2',role:'MERCHANT',email:'ben@beta.example',merchant_id:b};
    const secrets=['tvly-sim-secret-7777','feishu-secret-abcd-5555','tvly-alpha-good-1111','tvly-beta-bad-2222'];
    try{
      // SIM keys.
      let r=await call('PUT','/api/admin/provider-credentials/tavily',{user:admin,body:{values:{api_key:secrets[0]}}});
      assert.equal(r.status,200);
      const tavily=r.body.items.find(item=>item.provider==='tavily');
      assert.deepEqual([tavily.in_use,tavily.configured,tavily.fields[0].last4],['SIM',true,'7777']);
      assert.equal(r.body.items.find(item=>item.provider==='hunter').in_use,'ENV');
      r=await call('PUT','/api/admin/provider-credentials/feishu',{user:admin,body:{values:{app_secret:secrets[1],app_id:'cli_a1b2c3d4'}}});
      assert.equal(r.status,200);
      r=await call('GET','/api/admin/provider-credentials',{user:admin});
      assert.equal(r.body.search_spend_mode,'FREE_ONLY');assert.equal(r.body.items.length,8);
      assert.equal(r.body.items.find(item=>item.provider==='tavily').usage.enabled,true);
      // Merchants cannot use the admin endpoints, nor set SIM-only providers.
      assert.equal((await call('GET','/api/admin/provider-credentials',{user:userA})).status,403);
      assert.equal((await call('PUT','/api/admin/provider-credentials/tavily',{user:userA,body:{values:{api_key:'x-123456789'}}})).status,403);
      r=await call('PUT','/api/merchant/provider-credentials/feishu',{user:userA,body:{values:{app_secret:'m-secret-123456'}}});
      assert.deepEqual([r.status,r.body.code],[403,'CREDENTIAL_SIM_ONLY']);
      r=await call('PUT','/api/merchant/provider-credentials/llm',{user:userA,body:{values:{base_url:'http://searxng:8080'}}});
      assert.deepEqual([r.status,r.body.code],[400,'CREDENTIAL_URL_NOT_ALLOWED']);
      // Merchant A adds its own Tavily key; B adds a different one.
      r=await call('PUT','/api/merchant/provider-credentials/tavily',{user:userA,body:{values:{api_key:secrets[2]}}});
      assert.equal(r.status,200);
      const own=r.body.items.find(item=>item.provider==='tavily');
      assert.deepEqual([own.in_use,own.merchant_billed,own.fields[0].last4],['MERCHANT',true,'1111']);
      assert.ok(!r.body.items.some(item=>['feishu','translate'].includes(item.provider)),'SIM-only providers are not listed for merchants');
      assert.equal(r.body.items.find(item=>item.provider==='hunter').in_use,'SIM_PROVIDED');
      await call('PUT','/api/merchant/provider-credentials/tavily',{user:userB,body:{values:{api_key:secrets[3]}}});
      // Isolation: B never sees A's key details; a merchant's merchant_id query is ignored.
      r=await call('GET',`/api/merchant/provider-credentials?merchant_id=${a}`,{user:userB});
      assert.equal(r.body.merchant_id,b);assert.equal(r.body.items.find(item=>item.provider==='tavily').fields[0].last4,'2222');
      // Admin can look at a merchant's keys with merchant_id.
      r=await call('GET',`/api/merchant/provider-credentials?merchant_id=${a}`,{user:admin});
      assert.equal(r.body.items.find(item=>item.provider==='tavily').fields[0].last4,'1111');
      assert.equal((await call('GET','/api/merchant/provider-credentials',{user:admin})).status,400);
      // Resolver precedence.
      assert.equal(await store.getCredential({merchantId:a,provider:'tavily',field:'api_key'}),secrets[2]);
      assert.equal(await store.getCredential({merchantId:b,provider:'tavily',field:'api_key'}),secrets[3]);
      assert.equal(await store.getCredential({merchantId:null,provider:'tavily',field:'api_key'}),secrets[0]);
      assert.equal(await store.getCredential({merchantId:a,provider:'hunter',field:'api_key'}),env.HUNTER_API_KEY);
      // Test button: A's own key (mocked provider accepts), B's rejected; recorded without secrets.
      r=await call('POST','/api/merchant/provider-credentials/tavily/test',{user:userA});
      assert.deepEqual(r.body,{provider:'tavily',ok:true,code:'OK',source:'MERCHANT'});
      r=await call('POST','/api/merchant/provider-credentials/tavily/test',{user:userB});
      assert.equal(r.body.ok,false);assert.equal(r.body.code,'KEY_REJECTED');
      // A merchant without its own Hunter key cannot test SIM's key.
      r=await call('POST','/api/merchant/provider-credentials/hunter/test',{user:userA});
      assert.deepEqual([r.body.ok,r.body.code,r.body.source],[false,'NOT_CONFIGURED','NONE']);
      assert.equal(testerCalls.filter(entry=>entry.provider==='hunter').every(entry=>entry.resolved.configured===false),true);
      r=await call('GET','/api/merchant/provider-credentials',{user:userA});
      assert.equal(r.body.items.find(item=>item.provider==='tavily').last_test.ok,true);
      // Revoke: history kept, SIM provides again.
      r=await call('POST','/api/merchant/provider-credentials/tavily/revoke',{user:userA});
      assert.equal(r.body.items.find(item=>item.provider==='tavily').in_use,'SIM_PROVIDED');
      assert.equal(await store.getCredential({merchantId:a,provider:'tavily',field:'api_key'}),secrets[0]);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM leadgen.provider_credentials WHERE merchant_id=$1`,[a])).rows[0].n,1);
      // Unknown merchant id from an administrator.
      r=await call('PUT',`/api/merchant/provider-credentials/exa?merchant_id=${crypto.randomUUID()}`,{user:admin,body:{values:{api_key:'exa-123456789'}}});
      assert.equal(r.status,404);
      // No response ever contained a stored value.
      for(const body of bodies)for(const secret of secrets)assert.ok(!body.includes(secret),`response leaked ${secret.slice(0,6)}`);
      // Another process (or worker) with the same key reads the values; a wrong key cannot.
      const other=createCredentialResolver({pool,secretKey:SECRET_KEY,env:{}});
      assert.equal(await other.getCredential({provider:'feishu',field:'app_secret'}),secrets[1]);
      const wrong=createCredentialResolver({pool,secretKey:crypto.randomBytes(32).toString('hex'),env:{},log:null});
      assert.equal(await wrong.getCredential({provider:'feishu',field:'app_secret'}),'');
    }finally{await close();}
  });
});
