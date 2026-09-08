import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {Pool}=createRequire('/app/package.json')('pg');
const {OpportunityPoolService}=await import('/tmp/mc04-src/opportunityPool/OpportunityPoolService.js');
assert.equal(process.env.MC04_EXPLICIT_APPLY,'058_AND_POOL_ONLY');
const pool=new Pool({host:process.env.POSTGRES_HOST||'postgres',user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});
const client=await pool.connect();const report={provider_calls:0,email_sends:0};
try{
 const key='058_phase13_opportunity_pool.sql',sql=await readFile('/tmp/mc04-058.sql','utf8'),checksum=createHash('sha256').update(sql).digest('hex');
 await client.query('BEGIN');
 assert.equal((await client.query('SELECT current_database() db')).rows[0].db,process.env.POSTGRES_DB);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`leadgen:migration:${key}`]);
 const previous=(await client.query('SELECT * FROM leadgen.schema_migrations WHERE migration_key=$1 FOR UPDATE',[key])).rows[0];
 if(previous){assert.equal(previous.checksum_sha256,checksum);report.migration='ALREADY_APPLIED';}
 else{
  const latest=(await client.query('SELECT migration_key FROM leadgen.schema_migrations ORDER BY migration_key DESC LIMIT 1')).rows[0];
  assert.match(latest.migration_key,/^057_/);
  await client.query(sql.replace(/^\s*BEGIN\s*;/i,'').replace(/COMMIT\s*;\s*$/i,''));
  await client.query('INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by) VALUES($1,$2,$3)',[key,checksum,'dpv-mc04-explicit-authorized-runner']);report.migration='APPLIED';
 }
 assert.ok((await client.query("SELECT to_regclass('leadgen.opportunity_pool_current') view")).rows[0].view);
 await client.query('COMMIT');report.checksum_sha256=checksum;
 const service=new OpportunityPoolService({pool});
 const first=await service.refreshAll({reason:'MC04_APPROVED_INITIAL_MATERIALIZATION'});
 report.first_refresh={inserted:first.inserted,replayed:first.replayed,summary:first.summary};
 const replay=await service.refreshAll({reason:'MC04_REPLAY_VERIFICATION'});
 assert.equal(replay.inserted,0);report.replay={inserted:replay.inserted,replayed:replay.replayed};
 report.persisted_summary=await service.summary();console.log(JSON.stringify(report));
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
