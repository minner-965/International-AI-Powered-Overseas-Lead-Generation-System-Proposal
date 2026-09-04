import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {applyPhase7Migration,PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY}
  from '../src/phase7/migrationRunner.js';

const database=process.env.PHASE10_RETIRE_LIMITS_TEST_DATABASE||'';
const connectionString=database
  ?`postgresql://${encodeURIComponent(process.env.POSTGRES_USER||'leadgen_app')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD||'')}@${process.env.POSTGRES_HOST||'postgres'}:${process.env.POSTGRES_PORT||'5432'}/${database}`:'';
const root=process.env.DPV_PROJECT_ROOT?path.resolve(process.env.DPV_PROJECT_ROOT)
  :path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const migrationPath=path.join(root,'database/migrations',PHASE10_RETIRE_INTERNAL_TAVILY_ENFORCEMENT_MIGRATION_KEY);

test('047 applies and replays with no Tavily ceiling or fixed strategy cap',{skip:!connectionString},async()=>{
  const pool=new pg.Pool({connectionString,max:2});
  try{
    const first=await applyPhase7Migration({pool,migrationPath,expectedDatabase:database,appliedBy:'wp-u05-u09-test'});
    const replay=await applyPhase7Migration({pool,migrationPath,expectedDatabase:database,appliedBy:'wp-u05-u09-replay'});
    assert.equal(first.status,'APPLIED');assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
    const state=(await pool.query(`SELECT
      NOT EXISTS(SELECT 1 FROM leadgen.provider_credit_ledger WHERE provider='TAVILY' AND credit_limit_units IS NOT NULL) no_ceiling,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.auto_evidence_tasks'::regclass
        AND conname='auto_evidence_tasks_strategy_attempt_count_check'
        AND pg_get_constraintdef(oid) NOT LIKE '%max_attempts%') no_fixed_cap`)).rows[0];
    assert.deepEqual(state,{no_ceiling:true,no_fixed_cap:true});
  }finally{await pool.end();}
});
