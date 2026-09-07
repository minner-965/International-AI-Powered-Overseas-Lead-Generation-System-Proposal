import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const require=createRequire('/app/package.json');const {Client}=require('pg');
const {attachContactProgress,firstContactPendingSql}=await import('/tmp/phase12-contact-progress.mjs');
const config={host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
if(!config.database||!config.user||!config.password)throw Error('Container database environment required');
const name=`dpv_contact_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
assert.match(name,/^dpv_contact_test_\d+_[a-f0-9]{8}$/);assert.notEqual(name,config.database);
const admin=new Client(config);await admin.connect();let db;let made=false;let passed=0;
try{
 await admin.query(`CREATE DATABASE "${name}"`);made=true;db=new Client({...config,database:name});await db.connect();
 await db.query(`CREATE SCHEMA leadgen;
 CREATE TABLE leadgen.outbound_messages(company_id uuid,approval_id uuid,send_status text,transport_status text,business_contact_status text,sent_at timestamptz,queued_at timestamptz,id uuid,receipt_evidence_status text);
 CREATE TABLE leadgen.outreach_approvals(id uuid,opportunity_snapshot_id uuid);
 CREATE TABLE leadgen.business_opportunity_decision_snapshots(id uuid,product_profile text);
 CREATE TABLE leadgen.opportunity_crm_states(opportunity_snapshot_id uuid,funnel_status text);
 CREATE TABLE leadgen.inbound_messages(id uuid,correlation_outbound_message_id uuid,correlation_status text,received_at timestamptz);
 CREATE TABLE leadgen.reply_classifications(id uuid,inbound_message_id uuid,reply_category text,created_at timestamptz);
 CREATE TABLE leadgen.company_suppressions(company_id uuid,suppression_type text,lifted_at timestamptz);`);
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const row={company_id:id(1),product_profile:'WOMENSWEAR',management_contact_status:'NOT_REVIEWED'};
 const repositorySource=readFileSync('/tmp/contact-progress-repository.js','utf8');
 const summarySource=repositorySource.split('async getOutreachOperationsSummary(){')[1].split('const {controlled_contexts')[0];
 const sentSql=summarySource.split('this.pool.query(`')[1].split(",\n      (SELECT count(*)::int FROM leadgen.sales_tasks")[0];
 const repliesExpression=summarySource.match(/\(SELECT count\(\*\)::int FROM leadgen.inbound_messages i\s+JOIN LATERAL[\s\S]*?\) replies,/)[0].replace(/,$/,'');
 async function counts(sent,replies){await db.query('BEGIN READ ONLY');try{assert.equal((await db.query(sentSql)).rows[0].sent_no_reply,sent);assert.equal((await db.query(`SELECT ${repliesExpression}`)).rows[0].replies,replies);passed++;}finally{await db.query('ROLLBACK');}}
 await db.query("INSERT INTO leadgen.business_opportunity_decision_snapshots VALUES($1,'WOMENSWEAR');",[id(3)]);
 await db.query('INSERT INTO leadgen.outreach_approvals VALUES($1,$2)',[id(2),id(3)]);
 await db.query("INSERT INTO leadgen.outbound_messages VALUES($1,$2,'PROVIDER_ACCEPTED','SMTP_ACCEPTED','SENT_NO_REPLY',now(),now(),$3,'UNCONFIRMED')",[id(1),id(2),id(4)]);
 async function check(expected){await db.query('BEGIN READ ONLY');try{const [r]=await attachContactProgress(db,[row]);assert.equal(r.contact_progress_status,expected);assert.equal(r.first_contact_pending,false);assert.equal(r.management_contact_status,'NOT_REVIEWED');passed++;}finally{await db.query('ROLLBACK');}}
 await check('SENT_NO_REPLY');
 await counts(1,0);
 await db.query("INSERT INTO leadgen.inbound_messages VALUES($1,$2,'MATCHED',now()-interval '1 hour'),($3,$2,'MATCHED',now())",[id(5),id(4),id(6)]);
 await db.query("INSERT INTO leadgen.reply_classifications VALUES($1,$2,'HUMAN_POSITIVE',now()-interval '1 hour'),($3,$4,'AUTO_REPLY',now())",[id(7),id(5),id(8),id(6)]);
 await check('REPLIED');
 await counts(0,1);
 await db.query("INSERT INTO leadgen.reply_classifications VALUES($1,$2,'AUTO_REPLY',now()+interval '1 minute')",[id(9),id(5)]);
 await check('SENT_NO_REPLY'); // Later classification corrects the same inbound; historical obsolete human label must not win.
 await counts(1,0);
 await db.query("INSERT INTO leadgen.company_suppressions VALUES($1,'DO_NOT_CONTACT',null)",[id(1)]);await check('DO_NOT_CONTACT');
 await db.query("INSERT INTO leadgen.company_suppressions VALUES($1,'OPT_OUT',null)",[id(1)]);await check('OPTED_OUT');
 const q=await db.query(`SELECT ${firstContactPendingSql('o')} pending FROM (SELECT $1::uuid company_id)o`,[id(1)]);assert.equal(q.rows[0].pending,false);passed++;
 console.log(JSON.stringify({checks:passed,passed,failed:0,provider_calls:0,operational_writes:0,fixture_schema:'minimal isolated SQL projection fixture; not full migration regression'}));
}finally{if(db)await db.end();if(made){assert.match(name,/^dpv_contact_test_\d+_[a-f0-9]{8}$/);assert.notEqual(name,config.database);await admin.query(`DROP DATABASE "${name}"`);assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);console.log('Temporary database dropped and absence verified');}await admin.end();}
