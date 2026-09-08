// Explicitly authorized MC06 schema-only migration. Never creates research work.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
assert.equal(process.argv[2],'--apply-060-only');
const baselinePath=process.argv[3]||join(root,'artifacts/phase13-mc04/mc06-baseline-2026-09-08T04-38-25-478Z/baseline.json');
const baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
for(const [name,expected] of Object.entries(baseline.migration_hashes_001_059))assert.equal(createHash('sha256').update(readFileSync(join(root,'database/migrations',name))).digest('hex'),expected,`Changed old migration ${name}`);
for(const [name,expected] of Object.entries(baseline.mc04_rule_hashes).filter(([name])=>name.includes('/opportunityPool/')))assert.equal(createHash('sha256').update(readFileSync(join(root,name))).digest('hex'),expected,`Changed MC04 rule ${name}`);
const key='060_phase13_search_planning_corroboration.sql',sql=readFileSync(join(root,'database/migrations',key),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
async function apply({key,sql,checksum,expectedPool}){
 const {default:pg}=await import('pg');const {default:assert}=await import('node:assert/strict');
 const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});const c=await pool.connect();
 const hash=async()=>(await c.query("SELECT count(*)::int count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) content_md5 FROM(SELECT md5(row_to_json(t)::text) row_hash FROM leadgen.opportunity_pool_decisions t)s")).rows[0];
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`leadgen:migration:${key}`]);
  assert.deepEqual(await hash(),expectedPool,'MC04 accepted pool differs from checkpoint');
  const prior=(await c.query('SELECT * FROM leadgen.schema_migrations WHERE migration_key=$1 FOR UPDATE',[key])).rows[0];
  if(prior)assert.equal(prior.checksum_sha256,checksum);
  else{
   const latest=(await c.query('SELECT migration_key FROM leadgen.schema_migrations ORDER BY migration_key DESC LIMIT 1')).rows[0];assert.match(latest.migration_key,/^059_/);
   await c.query(sql.replace(/^\s*BEGIN\s*;/i,'').replace(/COMMIT\s*;\s*$/i,''));
   await c.query('INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by)VALUES($1,$2,$3)',[key,checksum,'dpv-mc06-explicit-schema-only']);
  }
  assert.deepEqual(await hash(),expectedPool);
  const markets=(await c.query('SELECT market_code,status,search_enabled FROM leadgen.research_market_registry ORDER BY market_code')).rows;
  const batches=Number((await c.query('SELECT count(*) n FROM leadgen.research_batches')).rows[0].n);assert.equal(batches,0,'No live batch creation allowed during MC06 verification');
  const plans=Number((await c.query('SELECT count(*) n FROM leadgen.research_query_plans')).rows[0].n),hits=Number((await c.query('SELECT count(*) n FROM leadgen.research_search_hit_provenance')).rows[0].n);assert.equal(plans,0);assert.equal(hits,0);
  await c.query('COMMIT');return{migration:prior?'ALREADY_APPLIED':'APPLIED',key,checksum,mc04_pool_unchanged:true,markets,batches,plans,hits,provider_calls:0,email_sends:0};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
}
const params={key,sql,checksum,expectedPool:baseline.tables.opportunity_pool_decisions};
const output=execFileSync('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],{cwd:root,input:`console.log(JSON.stringify(await (${apply.toString()})(${JSON.stringify(params)})));`,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
writeFileSync(join(dirname(baselinePath),'migration-result.json'),output);console.log(output.trim());
