import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const folder=join(root,'artifacts','phase13-mc04',`mc06-baseline-${new Date().toISOString().replace(/[:.]/g,'-')}`);
execFileSync('git',['check-ignore','--quiet',join(folder,'baseline.json')],{cwd:root});
async function collect(){
 const {default:pg}=await import('pg');
 const client=new pg.Client({host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,options:'-c default_transaction_read_only=on'});
 await client.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables={};
  for(const {tablename} of (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='leadgen' ORDER BY tablename")).rows){
   if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Invalid table');
   tables[tablename]=(await client.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) content_md5 FROM (SELECT md5(row_to_json(t)::text) row_hash FROM leadgen.${tablename} t) s`)).rows[0];
  }
  const pool_distribution=(await client.query('SELECT opportunity_pool_band,count(*)::int count FROM leadgen.opportunity_pool_current GROUP BY 1 ORDER BY 1')).rows;
  const result={observed_at:(await client.query('SELECT now() t')).rows[0].t,transaction_read_only:(await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,tables,pool_distribution};
  await client.query('ROLLBACK');return result;
 }finally{await client.end();}
}
const snapshot=JSON.parse(execFileSync('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],{cwd:root,input:`console.log(JSON.stringify(await (${collect.toString()})()));`,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024}));
const migrationDir=join(root,'database','migrations');
const hashes=Object.fromEntries(readdirSync(migrationDir).filter(n=>/^\d{3}_.*\.sql$/.test(n)&&Number(n.slice(0,3))<=59).sort().map(n=>[n,createHash('sha256').update(readFileSync(join(migrationDir,n))).digest('hex')]));
mkdirSync(folder,{recursive:true});
const dump=execFileSync('docker',['exec','dpv-leadgen-postgres-1','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],{cwd:root,timeout:60000,maxBuffer:128*1024*1024});
writeFileSync(join(folder,'database.dump'),dump);
const target=`/tmp/mc06-baseline-${Date.now()}.dump`;
execFileSync('docker',['cp',join(folder,'database.dump'),`dpv-leadgen-postgres-1:${target}`],{cwd:root});
const list=execFileSync('docker',['exec','dpv-leadgen-postgres-1','pg_restore','--list',target],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const mc04files=['services/demo-dashboard/src/researchBatch/ResearchBatchService.js','services/demo-dashboard/src/opportunityPool/classifier.js','services/demo-dashboard/src/opportunityPool/contactReadiness.js','services/demo-dashboard/src/opportunityPool/OpportunityPoolService.js'];
const mc04_rule_hashes=Object.fromEntries(mc04files.map(name=>[name,createHash('sha256').update(readFileSync(join(root,name))).digest('hex')]));
const report={...snapshot,git_head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),migration_hashes_001_059:hashes,mc04_rule_hashes,dump_bytes:dump.length,dump_sha256:createHash('sha256').update(dump).digest('hex'),archive_entries:list.split('\n').filter(s=>/^\d+;/.test(s)).length,restore_performed:false,production_writes:0,provider_calls:0,email_sends:0};
writeFileSync(join(folder,'baseline.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({folder,...report}));
