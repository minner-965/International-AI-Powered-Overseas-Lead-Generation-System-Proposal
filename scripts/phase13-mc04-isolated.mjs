import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const {Pool,Client}=createRequire('/app/package.json')('pg');
const {OpportunityPoolService,projectPoolDecision}=await import('/tmp/mc04-src/opportunityPool/OpportunityPoolService.js');
const config={host:process.env.POSTGRES_HOST||'postgres',user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
const db=`mc04_fixture_${Date.now()}_${randomBytes(6).toString('hex')}`;
assert.match(db,/^mc04_fixture_\d+_[a-f0-9]{12}$/);assert.notEqual(db,process.env.POSTGRES_DB);
const admin=new Client({...config,database:'postgres'});let pool,created=false;
const report={production_writes:0,provider_calls:0,email_sends:0,checks:[]};
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);created=true;
 pool=new Pool({...config,database:db,max:5});
 await pool.query('CREATE SCHEMA leadgen; CREATE TABLE leadgen.companies(id uuid PRIMARY KEY); CREATE TABLE leadgen.research_jobs(id uuid PRIMARY KEY); CREATE TABLE leadgen.legacy_history(id int PRIMARY KEY,value text); INSERT INTO leadgen.legacy_history VALUES(1,\'preserved\')');
 await pool.query(await readFile('/tmp/mc04-058.sql','utf8'));
 const id=randomUUID();await pool.query('INSERT INTO leadgen.companies VALUES($1)',[id]);
 const business={company_id:id,new_opportunity_pool_band:'PRECISION',category_basis:'DIRECT',company_type_basis:['RETAIL'],notes:[],profile_results:[],evidence_references:[]};
 const contact={contact_readiness:['NO_CONTACT_FOUND'],email_eligibility:{status:'NOT_EVALUATED_FOR_SEND'}};
 let row=projectPoolDecision(business,contact);
 assert.equal(row.is_active_business_opportunity,true);assert.equal(row.email_send_eligibility.send_authorized,false);report.checks.push('precision without contact stays active and grants no send permission');
 const reviewed=projectPoolDecision({...business,new_opportunity_pool_band:'GENERAL_RELEVANT',notes:['REVIEW_REQUIRED']},{...contact,email_eligibility:{status:'BLOCKED_SUPPRESSION'}});
 assert.equal(reviewed.is_active_business_opportunity,true);assert.equal(reviewed.email_send_eligibility.status,'BLOCKED_SUPPRESSION');report.checks.push('review and suppression remain separate from business fit');
 const svc=new OpportunityPoolService({pool});svc.preview=async()=>({observed_at:new Date().toISOString(),rows:[row]});
 assert.equal((await svc.refreshAll()).inserted,1);assert.equal((await svc.refreshAll()).replayed,1);report.checks.push('first append and identical replay');
 row=reviewed;assert.equal((await svc.refreshAll()).inserted,1);row=projectPoolDecision(business,contact);assert.equal((await svc.refreshAll()).inserted,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.opportunity_pool_decisions')).rows[0].n,3);
 assert.equal((await pool.query('SELECT opportunity_pool_band FROM leadgen.opportunity_pool_current')).rows[0].opportunity_pool_band,'PRECISION');report.checks.push('A to B to A appends full history and current is latest');
 row={...row,review_flags:['NEW_REVIEW']};const concurrent=await Promise.all([svc.refreshAll(),svc.refreshAll()]);assert.equal(concurrent.reduce((n,r)=>n+r.inserted,0),1);report.checks.push('concurrent refresh appends once');
 await assert.rejects(pool.query('UPDATE leadgen.opportunity_pool_decisions SET change_reason=\'mutated\''),/append-only/);
 await assert.rejects(pool.query('DELETE FROM leadgen.opportunity_pool_decisions'),/append-only/);report.checks.push('history update and delete rejected');
 assert.deepEqual((await pool.query('SELECT * FROM leadgen.legacy_history')).rows,[{id:1,value:'preserved'}]);report.checks.push('unrelated legacy history unchanged');
}finally{
 await pool?.end();if(created){await admin.query(`DROP DATABASE "${db}"`);assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);report.cleanup='DROPPED_AND_ABSENCE_VERIFIED';}await admin.end();console.log(JSON.stringify(report));
}
