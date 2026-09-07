import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const app=process.env.PHASE13_APP_ROOT||'/app';
const {Pool,Client}=createRequire(`${app}/package.json`)('pg');
const {BraveSearchProvider}=await import(pathToFileURL(process.env.PHASE13_BRAVE_MODULE||`${app}/src/search/BraveSearchProvider.js`));
const {SearchUsageAudit}=await import(pathToFileURL(process.env.PHASE13_AUDIT_MODULE||`${app}/src/search/SearchUsageAudit.js`));
const config={host:process.env.POSTGRES_HOST||'postgres',user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
assert.ok(config.user&&config.password&&process.env.POSTGRES_DB);
const db=`phase13_search_${Date.now()}_${randomBytes(6).toString('hex')}`;
assert.match(db,/^phase13_search_\d+_[a-f0-9]{12}$/);assert.notEqual(db,process.env.POSTGRES_DB);
const admin=new Client({...config,database:'postgres'});let pool,created=false;
const report={production_writes:0,live_provider_calls:0,checks:[],cleanup:null};
try{
  await admin.connect();assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);
  await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);created=true;pool=new Pool({...config,database:db,max:8});
  await pool.query(`CREATE SCHEMA leadgen; CREATE TABLE leadgen.research_jobs(id uuid PRIMARY KEY);
    CREATE TABLE leadgen.companies(id uuid PRIMARY KEY);
    CREATE TABLE leadgen.provider_usage_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    research_job_id uuid NOT NULL REFERENCES leadgen.research_jobs(id) ON DELETE CASCADE,
    company_id uuid REFERENCES leadgen.companies(id) ON DELETE SET NULL,provider text NOT NULL,billing_period text NOT NULL,
    endpoint text NOT NULL,request_fingerprint text NOT NULL,status text NOT NULL CHECK(status IN('RESERVED','COMPLETED','NOT_FOUND','FAILED','TEMPORARY_ERROR','SKIPPED')),
    reserved_units integer NOT NULL DEFAULT 0 CHECK(reserved_units>=0),used_units integer NOT NULL DEFAULT 0 CHECK(used_units>=0),
    budget_pool text NOT NULL CHECK(budget_pool IN('DISCOVERY','EVIDENCE')),product_profile text,
    error_code text,result_payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
    UNIQUE(provider,request_fingerprint));`);
  const job=randomUUID();await pool.query('INSERT INTO leadgen.research_jobs VALUES($1)',[job]);
  let calls=0,release;const provider=new BraveSearchProvider({apiKey:'fixture',sleep:async()=>{},fetchImpl:async()=>{calls++;if(calls===1)await new Promise(resolve=>release=resolve);return new Response(JSON.stringify({web:{results:[{url:'https://example.invalid',title:'Fixture'}]}}));}});
  const audit=new SearchUsageAudit({provider,pool}),input={researchJobId:job,purpose:'COMPANY_DISCOVERY',request:{query:'fixture Mexico',country:'MX'}};
  const pending=audit.search(input);while(!release)await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(new SearchUsageAudit({provider,pool}).search(input),{code:'SEARCH_REQUEST_IN_PROGRESS'});release();await pending;assert.equal(calls,1);report.checks.push('concurrent unique claim');
  const replay=await new SearchUsageAudit({provider,pool}).search(input);assert.equal(replay.replay,true);assert.equal(replay.results.length,1);assert.equal(calls,1);report.checks.push('restart replay without candidate table');
  for(const change of [{offset:1},{searchLang:'es'}])await audit.search({...input,request:{...input.request,...change}});
  assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.provider_usage_events')).rows[0].n,3);report.checks.push('page and language fingerprints distinct');
  let retries=0;const retryAudit=new SearchUsageAudit({pool,provider:new BraveSearchProvider({apiKey:'fixture',sleep:async()=>{},fetchImpl:async()=>++retries===1?new Response('{}',{status:429,headers:{'retry-after':'0'}}):new Response(JSON.stringify({web:{results:[]}}))})});
  const retried=await retryAudit.search({...input,request:{query:'retry'}});assert.equal(retried.usage_event.result_payload.audit.attempt_count,2);assert.equal(retries,2);assert.equal(retried.usage_event.used_units,0);assert.equal(retried.usage_event.result_payload.audit.billing_units_known,false);report.checks.push('two attempts persisted with unknown billing');
  await assert.rejects(audit.search({...input,researchJobId:randomUUID()}),error=>error.code==='23503');report.checks.push('research FK enforced');
}finally{
  await pool?.end();if(created){await admin.query(`DROP DATABASE "${db}"`);assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);report.cleanup='DROPPED_AND_ABSENCE_VERIFIED';}await admin.end();
  console.log(JSON.stringify(report));
}
