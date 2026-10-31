// Batch 3 E1 against throwaway PostgreSQL databases: migration 075 on a fresh database (every migration
// file) and on a copy of live_copy; append-only guards, the initial OFF switch, and the SQL store end to
// end (switch history, ledger, evidence, review queue, usable evidence, usage, merchant isolation).
// Model answers come from an in-process fetch double: no real model API is called.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch3-llm-postgres.test.js
// Optional: LLM_TEST_LIVE_TEMPLATE=live_copy (default) - the copy is skipped when that database is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {createCredentialResolver} from '../src/credentials/credentialResolver.js';
import {createModelAssist,verifyLlmAssistMigration} from '../src/llm/assistService.js';
import {STANDARD_VERSION} from '../src/llm/standard.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||'';
const liveTemplate=process.env.LLM_TEST_LIVE_TEMPLATE||'live_copy';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const MIGRATION='075_llm_assist.sql';
const SECRET_KEY=crypto.randomBytes(32).toString('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function withDatabase({template=null}={},run){
  const name=`batch3_llm_${crypto.randomBytes(4).toString('hex')}`;
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
const apply075=async pool=>pool.query(await readFile(path.join(migrations,MIGRATION),'utf8'));
async function templateExists(){
  if(!adminUrl)return false;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{return (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[liveTemplate])).rowCount===1;}finally{await admin.end();}
}
async function verify(pool){
  const client=await pool.connect();
  try{return await verifyLlmAssistMigration(client);}finally{client.release();}
}
async function assertAppendOnly(pool){
  for(const sql of [`UPDATE leadgen.llm_assist_settings SET enabled=true`,`DELETE FROM leadgen.llm_assist_settings`])
    await assert.rejects(()=>pool.query(sql),/LLM_ASSIST_APPEND_ONLY/);
}

const inputOf=body=>{const user=body.messages.find(message=>message.role==='user').content;return JSON.parse(user.slice(user.indexOf('\n{')+1));};
function fakeFetch(confidence){
  const calls=[];
  const impl=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,headers:init.headers,body});
    const input=inputOf(body);
    const output={task:'T1_CATEGORY_EVIDENCE',standard_version:STANDARD_VERSION,request_id:input.request_id,status:'OK',page_language:'en',page_is_own_operation:true,notes:[],
      items:[{code:'DRESSES',raw_category:'Dresses',profile:'WOMENSWEAR',activity:'WHOLESALE',product_examples:[],quote:'We are a wholesaler of women\'s dresses',confidence,note:null}]};
    const answer=body.system?{content:[{type:'text',text:JSON.stringify(output)}],stop_reason:'end_turn',usage:{input_tokens:1200,output_tokens:300}}
      :{choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:1200,completion_tokens:300}};
    return new Response(JSON.stringify(answer),{status:200});
  };
  impl.calls=calls;return impl;
}
const args=(companyId,url)=>({company_id:companyId,company:{display_name:'Al Example',official_domain:'example.ae',market:'AE'},
  page:{url,text:'Al Example LLC, Dubai. We are a wholesaler of women\'s dresses for boutiques across the GCC.'},approved_categories:[{code:'DRESSES',profile:'WOMENSWEAR',names:['dresses']}]});

async function exercise(pool){
  const merchant=(await pool.query(`INSERT INTO leadgen.merchants(company_name,trial_ends_at,created_by,referral_code) VALUES('Batch3 LLM Merchant',now()+interval '7 days','batch3-test','B3LLM'||upper(substr(md5(random()::text),1,8))) RETURNING id`)).rows[0].id;
  const company=(await pool.query(`INSERT INTO leadgen.companies(company_name,country_code,website_url,normalized_domain) VALUES('Al Example Trading','AE','https://example.ae','b3llm-'||substr(md5(random()::text),1,8)||'.example.ae') RETURNING id`)).rows[0].id;
  const credentials=createCredentialResolver({pool,secretKey:SECRET_KEY,env:{}});
  await credentials.set({provider:'llm',values:{provider:'anthropic',model:'claude-haiku-5-5',api_key:'sk-ant-sim-test-000011112222'},actor:'simon'});
  await credentials.set({merchantId:merchant,provider:'llm',values:{provider:'deepseek',model:'deepseek-chat',api_key:'sk-merchant-test-000011112222'},actor:'m@x'});
  const fetchImpl=fakeFetch(0.65);
  const assist=createModelAssist({pool,credentials,fetchImpl,retries:0,log:{warn(){}}});

  // Off by default (the 075 row): nothing called.
  assert.equal((await assist.run('T1_CATEGORY_EVIDENCE',args(company,'https://example.ae/'))).code,'MODEL_ASSIST_OFF');
  assert.equal(fetchImpl.calls.length,0);
  await assist.settings.setSim({enabled:true,mode:'ASSIST',tasks:{T1_CATEGORY_EVIDENCE:true}},'simon@test');
  const sim=await assist.run('T1_CATEGORY_EVIDENCE',args(company,'https://example.ae/'));
  assert.equal(sim.review.length,1,'0.65 goes to the review list');assert.deepEqual(sim.usable,[]);
  assert.equal(fetchImpl.calls[0].headers['x-api-key'],'sk-ant-sim-test-000011112222');
  // Reuse of the same input.
  assert.equal((await assist.run('T1_CATEGORY_EVIDENCE',args(company,'https://example.ae/'))).cached,true);
  assert.equal(fetchImpl.calls.length,1);

  // Merchant with its own key.
  await assist.settings.setMerchant(merchant,{enabled:true,tasks:{T1_CATEGORY_EVIDENCE:true}},'m@x',{hasOwnKey:await assist.merchantHasOwnKey(merchant)});
  await assist.run('T1_CATEGORY_EVIDENCE',args(company,'https://example.ae/about'),{merchantId:merchant});
  assert.equal(fetchImpl.calls[1].headers.authorization,'Bearer sk-merchant-test-000011112222');

  const calls=(await pool.query(`SELECT owner_scope,billed_to,status,input_tokens,output_tokens,cost_amount::float8 cost,cost_currency FROM leadgen.llm_calls ORDER BY created_at`)).rows;
  assert.deepEqual(calls.map(row=>[row.owner_scope,row.billed_to,row.status]),[['SIM','SIM','OK'],['SIM','SIM','CACHED'],['MERCHANT','MERCHANT','OK']]);
  assert.equal(calls[0].cost,0.00027);assert.equal(calls[0].cost_currency,'USD');
  assert.equal(calls[2].cost_currency,'CNY');
  assert.ok(!JSON.stringify(calls).includes('sk-'),'no key in the ledger');

  // Review queue: SIM sees its own; the merchant only its own; the company name is joined.
  const simQueue=await assist.store.reviewQueue({});const merchantQueue=await assist.store.reviewQueue({merchantId:merchant});
  assert.equal(simQueue.length,2,'original + cached run');assert.equal(simQueue[0].company_name,'Al Example Trading');
  assert.equal(merchantQueue.length,1);assert.equal(merchantQueue[0].merchant_id,merchant);
  assert.equal((await assist.store.reviewQueue({all:true})).length,3);

  // A person confirms one: it becomes usable evidence for rules (ASSIST mode only).
  assert.equal((await assist.store.usableEvidence({companyId:company,task:'T1_CATEGORY_EVIDENCE'})).length,0);
  await assist.store.insertDecision({evidenceId:simQueue[0].id,decision:'CONFIRMED',note:null,actor:'simon'});
  await assist.store.insertDecision({evidenceId:simQueue[1].id,decision:'REJECTED',note:'dup',actor:'simon'});
  const usable=await assist.store.usableEvidence({companyId:company,task:'T1_CATEGORY_EVIDENCE'});
  assert.equal(usable.length,1);assert.equal(usable[0].id,simQueue[0].id);
  assert.equal((await assist.store.usableEvidence({companyId:company,task:'T1_CATEGORY_EVIDENCE',merchantId:merchant})).length,0,'merchant evidence is separate');
  assert.equal((await assist.store.reviewQueue({})).length,0);

  const usage=await assist.store.usage({});
  assert.equal(usage.calls,2);assert.equal(usage.cached_calls,1);assert.equal(usage.input_tokens,1200);assert.deepEqual(usage.cost,{USD:0.00027});
  const overview=await assist.overview({admin:true});
  assert.equal(overview.settings.enabled,true);assert.equal(overview.usage_all.calls,3);assert.ok(!JSON.stringify(overview).includes('sk-'));

  // Allowance history and settings history are append-only.
  await assist.settings.setSimKeyAllowed(merchant,true,'simon');await assist.settings.setSimKeyAllowed(merchant,false,'simon');
  assert.equal(await assist.settings.simKeyAllowed(merchant),false);
  for(const table of ['llm_calls','llm_evidence','llm_review_decisions','llm_merchant_allowances'])
    await assert.rejects(()=>pool.query(`DELETE FROM leadgen.${table}`),/LLM_ASSIST_APPEND_ONLY/,table);
  await assert.rejects(()=>pool.query(`UPDATE leadgen.llm_evidence SET status='ACCEPTED'`),/LLM_ASSIST_APPEND_ONLY/);
  await assertAppendOnly(pool);
}

test('075 on a fresh database: tables, guards, OFF initial row, re-runnable, store end to end',{skip:!adminUrl},async()=>{
  await withDatabase({},async pool=>{
    await applyAll(pool);
    await apply075(pool);
    const before=(await pool.query(`SELECT count(*)::int n FROM leadgen.llm_assist_settings`)).rows[0].n;
    assert.equal(before,1,'re-running 075 does not add a second initial row');
    assert.deepEqual(await verify(pool),{tables:5,guards:5,initial_enabled:false});
    const row=(await pool.query(`SELECT * FROM leadgen.llm_assist_settings`)).rows[0];
    assert.equal(row.mode,'SHADOW');assert.ok(Object.values(row.tasks).every(value=>value===false));
    await assert.rejects(()=>pool.query(`INSERT INTO leadgen.llm_assist_settings(owner_scope,merchant_id,enabled,mode,set_by) VALUES('SIM',NULL,true,'DECIDE','x')`),/check constraint/);
    await exercise(pool);
  });
});

test('075 on a copy of live_copy: applies on top of the live schema and data, nothing existing changes',{skip:!adminUrl},async t=>{
  if(!await templateExists()){t.skip(`${liveTemplate} not present`);return;}
  await withDatabase({template:liveTemplate},async pool=>{
    const counts=async()=>(await pool.query(`SELECT (SELECT count(*) FROM leadgen.companies)::int companies,(SELECT count(*) FROM leadgen.merchants)::int merchants,
      (SELECT count(*) FROM leadgen.provider_credentials)::int credentials`)).rows[0];
    const missing=(await pool.query(`SELECT to_regclass('leadgen.provider_credentials') t`)).rows[0].t;
    if(!missing)for(const file of ['071_provider_credentials.sql'])await pool.query(await readFile(path.join(migrations,file),'utf8'));
    const before=await counts();
    await apply075(pool);await apply075(pool);
    assert.deepEqual(await counts(),before);
    assert.equal((await verify(pool)).initial_enabled,false);
    await exercise(pool);
  });
});
