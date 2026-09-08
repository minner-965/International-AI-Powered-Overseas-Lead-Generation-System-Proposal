import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {applyPhase7Migration,PHASE13_AUTOMATION_CONTROL_MIGRATION_KEY} from '../src/phase7/migrationRunner.js';

const sql=readFileSync(new URL('../../../database/migrations/061_phase13_automation_control_query_execution.sql',import.meta.url),'utf8');
const isolatedDatabaseUrl=process.env.PHASE13_MC07_TEST_DATABASE_URL||'';

test('061 is additive, transactional and fail-closed',()=>{
  assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
  assert.match(sql,/RESEARCH_PROVIDER_EXECUTION',false/);assert.match(sql,/PHASE13_AUTO_FIRST_TOUCH',false/);
  assert.match(sql,/automation_control_event_immutable/);
});

test('061 query execution supports zero-call recovery and strategy fan-in',()=>{
  for(const field of ['request_snapshot','response_snapshot','selection_reason','retry_after_at','lease_expires_at','provider_completed_at','persisted_at','completed_at'])assert.match(sql,new RegExp(field));
  for(const status of ['PENDING','CLAIMED','PROVIDER_COMPLETED','PERSISTED','NOT_FOUND','RATE_LIMITED','TEMPORARY_ERROR','AUTH_ERROR','FAILED','REVIEW_REQUIRED'])assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/UNIQUE\(research_query_plan_id,query_fingerprint,provider\)/);
  assert.match(sql,/CREATE INDEX research_query_executions_usage_event_idx/);
  assert.doesNotMatch(sql,/UNIQUE INDEX research_query_executions_usage_event/);
});

test('061 first-touch reservation is separate from manual approval and quota-atomic',()=>{
  assert.match(sql,/UNIQUE\(company_id,policy_revision\)/);
  assert.match(sql,/pg_advisory_xact_lock[\s\S]*phase13:first-touch:policy/);
  assert.match(sql,/pg_advisory_xact_lock[\s\S]*phase13:first-touch:company/);
  assert.match(sql,/FIRST_TOUCH_MINUTE_LIMIT/);assert.match(sql,/FIRST_TOUCH_DAY_LIMIT/);assert.match(sql,/FIRST_TOUCH_COMPANY_COOLDOWN/);
  assert.match(sql,/ALTER COLUMN approval_id DROP NOT NULL/);
  assert.match(sql,/num_nonnulls|approval_id IS NOT NULL[\s\S]*first_touch_reservation_id IS NULL/);
  assert.doesNotMatch(sql,/INSERT INTO leadgen\.(?:contact_work_queue|outreach_approvals)/i);
});

test('061 applies and replays on an explicitly isolated PostgreSQL database',
  {skip:!isolatedDatabaseUrl},async()=>{
    const pool=new pg.Pool({connectionString:isolatedDatabaseUrl,max:2});
    try{
      const before=(await pool.query('SELECT count(*)::int count FROM leadgen.outbound_messages')).rows[0].count;
      const migrationPath=new URL('../../../database/migrations/061_phase13_automation_control_query_execution.sql',import.meta.url).pathname.replace(/^\/(.:)/,'$1');
      const first=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase13-mc07-isolated-test'});
      assert.ok(['APPLIED','SKIPPED_ALREADY_APPLIED'].includes(first.status));
      assert.equal(first.phase13_automation_control_tables_verified,5);
      assert.equal(first.phase13_automation_controls_fail_closed,true);
      assert.equal((await pool.query('SELECT count(*)::int count FROM leadgen.outbound_messages')).rows[0].count,before);
      const replay=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase13-mc07-isolated-replay'});
      assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
      assert.equal((await pool.query("SELECT count(*)::int count FROM leadgen.automation_controls WHERE enabled=false")).rows[0].count,2);
      assert.equal(PHASE13_AUTOMATION_CONTROL_MIGRATION_KEY,'061_phase13_automation_control_query_execution.sql');
    }finally{await pool.end();}
  });
