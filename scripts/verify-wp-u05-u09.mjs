import path from 'node:path';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(new URL('../services/demo-dashboard/package.json',import.meta.url));
const pg=require('pg');
const pool=new pg.Pool({
  host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB||'lead_generation',user:process.env.POSTGRES_USER||'leadgen_app',
  password:process.env.POSTGRES_PASSWORD,max:2
});

try{
  if(process.argv.includes('--apply-migration')){
    const runnerUrl=existsSync(new URL('../services/demo-dashboard/src/phase7/migrationRunner.js',import.meta.url))
      ?new URL('../services/demo-dashboard/src/phase7/migrationRunner.js',import.meta.url)
      :new URL('../src/phase7/migrationRunner.js',import.meta.url);
    const {applyPhase7Migration,PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY}=await import(runnerUrl);
    const result=await applyPhase7Migration({pool,
      migrationPath:path.join(root,'database/migrations',PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY),
      expectedDatabase:process.env.POSTGRES_DB||null,appliedBy:'wp-u05-u09-controlled-apply'});
    console.log(JSON.stringify({migration_key:result.migration_key,status:result.status,database:result.database,
      verified:result.phase10_internal_tavily_enforcement_retired===true
        || result.status==='SKIPPED_ALREADY_APPLIED'}));
  }
  const result=await pool.query(`SELECT current_database() database,
    (SELECT count(*)::int FROM leadgen.auto_evidence_tasks WHERE task_status='BUDGET_PAUSED') historical_budget_paused,
    (SELECT count(*)::int FROM leadgen.auto_evidence_tasks WHERE task_status='PROVIDER_CAPACITY_WAIT') provider_capacity_wait,
    (SELECT count(*)::int FROM leadgen.provider_credit_ledger WHERE provider='TAVILY' AND credit_limit_units IS NOT NULL) tavily_internal_ceilings,
    (SELECT count(*)::int FROM leadgen.outbound_messages) outbound_messages,
    (SELECT count(*)::int FROM leadgen.outbound_message_attempts) outbound_attempts,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm_outbox`);
  console.log(JSON.stringify(result.rows[0]));
}finally{await pool.end();}
