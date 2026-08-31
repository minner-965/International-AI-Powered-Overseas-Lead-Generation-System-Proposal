import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  applyPhase7Migration,
  PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY
} from '../src/phase7/migrationRunner.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const migrationPath=path.join(root,'database/migrations',PHASE9_REAL_OPPORTUNITY_MIGRATION_KEY);
const sql=fs.readFileSync(migrationPath,'utf8');
const runner=fs.readFileSync(path.join(root,'services/demo-dashboard/src/phase7/migrationRunner.js'),'utf8');
const liveDatabaseUrl=process.env.PHASE9_TEST_DATABASE_URL||'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

test('029 is transactional, additive and keeps Phase 9 request identity and bounded wave data explicit',()=>{
  assert.match(sql,/^BEGIN;/);
  assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+leadgen\./i);
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\./i);
  assert.doesNotMatch(sql,/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  for(const column of ['idempotency_key','request_digest','created_by_identity','created_by_role',
    'research_wave','run_budget_cap_units','stop_reason_code'])assert.match(sql,new RegExp(column));
  assert.match(sql,/REAL_OPPORTUNITY_RESEARCH/);
  assert.match(sql,/max_results <= CASE research_wave WHEN 'A' THEN 5 WHEN 'B' THEN 15 END/);
  assert.match(sql,/idx_research_jobs_phase9_idempotency/);
  assert.match(sql,/trg_research_jobs_phase9_request_guard/);
});

test('029 fixes one company to one profile/catalog snapshot per job and makes the cohort append-only',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS leadgen\.research_job_cohort_items/);
  for(const column of ['research_job_id','company_id','product_profile','product_profile_catalog_snapshot_id',
    'market_code','research_wave','selection_rank','selection_reason_code','selection_input_digest',
    'company_verification_status_snapshot','company_lifecycle_status_snapshot','relationship_status_snapshot']){
    assert.match(sql,new RegExp(column));
  }
  assert.match(sql,/UNIQUE \(research_job_id,company_id\)/);
  assert.match(sql,/UNIQUE \(research_job_id,selection_rank\)/);
  assert.match(sql,/REFERENCES leadgen\.product_profile_catalog_snapshots\(id,product_profile\) ON DELETE RESTRICT/);
  assert.match(sql,/company_verification_status_snapshot='VERIFIED'/);
  assert.match(sql,/company_lifecycle_status_snapshot='ACTIVE'/);
  assert.match(sql,/relationship_status_snapshot='NEW_PROSPECT'/);
  assert.match(sql,/'research_job_cohort_items','research_job_stage_events','contact_verification_events'/);
  assert.match(sql,/prevent_phase9_audit_mutation/);
});

test('029 stage facts are extensible append-only events with canonical result references',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS leadgen\.research_job_stage_events/);
  assert.match(sql,/cohort_item_id uuid NOT NULL/);
  assert.match(sql,/stage text NOT NULL CHECK \(stage ~ '\^\[A-Z\]/);
  assert.match(sql,/event_type text NOT NULL CHECK \(event_type ~ '\^\[A-Z\]/);
  assert.match(sql,/outcome_code text NOT NULL/);
  assert.match(sql,/idempotency_key text NOT NULL UNIQUE/);
  for(const reference of ['buyer_business_model_result_id','category_procurement_match_result_id',
    'product_opportunity_result_id','cooperation_feasibility_result_id','decision_maker_id',
    'decision_maker_contact_id','contact_verification_event_id','business_opportunity_decision_snapshot_id',
    'provider_usage_event_id'])assert.match(sql,new RegExp(reference));
  assert.match(sql,/REFERENCES leadgen\.research_job_cohort_items\(id,research_job_id\) ON DELETE RESTRICT/);
  assert.match(sql,/prevent_phase9_audit_mutation/);
});

test('029 contact verification event links an exact contact to a settled Hunter ledger event without plaintext email',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS leadgen\.contact_verification_events/);
  for(const column of ['research_job_id','company_id','decision_maker_contact_id','provider_usage_event_id',
    'verification_status','verification_score','verified_at','captured_at','input_digest','created_at']){
    assert.match(sql,new RegExp(column));
  }
  for(const status of ['VALID','ACCEPT_ALL','UNKNOWN','INVALID','TEMPORARY_ERROR','NOT_VERIFIED']){
    assert.match(sql,new RegExp(`'${status}'`));
  }
  assert.match(sql,/provider='HUNTER'/);
  assert.match(sql,/endpoint='email-verifier'/);
  assert.match(sql,/recipient_hash text NOT NULL/);
  assert.doesNotMatch(sql,/\bemail(?:_address|_value)?\s+text/i);
  assert.match(sql,/usage_status='RESERVED'/);
  assert.match(sql,/trg_contact_verification_events_exact_reference/);
  assert.match(sql,/prevent_phase9_audit_mutation/);
});

test('explicit migration runner verifies and applies 029 after 028',()=>{
  assert.match(runner,/029_phase9_real_opportunity_research_audit\.sql/);
  assert.match(runner,/verifyPhase9RealOpportunityMigration/);
  assert.match(runner,/phase9MigrationPath/);
  assert.ok(runner.indexOf('realOpportunity=await applyPhase7Migration')>
    runner.indexOf('contactReady=await applyPhase7Migration'));
  assert.match(runner,/status:realOpportunity\.status/);
});

async function counts(client){
  const names=['companies','sources','contacts','lead_reviews','collection_runs','research_jobs',
    'enrichment_job_companies','decision_makers','decision_maker_contacts','provider_usage_events',
    'product_master','business_opportunity_decision_snapshots'];
  const result={};
  for(const name of names){
    const row=await client.query(`SELECT count(*)::integer count FROM leadgen.${name}`);
    result[name]=Number(row.rows[0].count);
  }
  return result;
}

let savepointSequence=0;
async function expectDatabaseFailure(client,operation,pattern){
  const name=`phase9_expected_failure_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${name}`);
  let caught=null;
  try{await operation();}catch(error){caught=error;}
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  await client.query(`RELEASE SAVEPOINT ${name}`);
  assert.ok(caught,'database operation should have failed');
  if(pattern)assert.match(String(caught.message),pattern);
}

test('029 live PostgreSQL apply/replay preserves rows and enforces constraints and immutability',
  {skip:!liveDatabaseUrl},async()=>{
    const pool=new pg.Pool({connectionString:liveDatabaseUrl,max:2});
    try{
      const before=await counts(pool);
      const applied=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase9-migration-test'});
      assert.equal(applied.status,'APPLIED');
      assert.equal(applied.phase9_tables_verified,3);
      assert.equal(applied.phase9_audit_and_reference_triggers_verified,5);
      assert.deepEqual(await counts(pool),before);

      const replay=await applyPhase7Migration({pool,migrationPath,appliedBy:'phase9-migration-test-replay'});
      assert.equal(replay.status,'SKIPPED_ALREADY_APPLIED');
      assert.deepEqual(await counts(pool),before);

      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const candidate=(await client.query(`SELECT c.id company_id,c.country_code market_code,
            s.id snapshot_id,s.product_profile
          FROM leadgen.companies c
          CROSS JOIN LATERAL (
            SELECT id,product_profile FROM leadgen.product_profile_catalog_snapshots
            ORDER BY created_at DESC,id LIMIT 1
          ) s
          WHERE c.country_code IN ('AE','MX')
            AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
          ORDER BY c.created_at,c.id LIMIT 1`)).rows[0];
        assert.ok(candidate,'live migration fixture requires one real active AE/MX company and catalog snapshot');
        const jobKey=`phase9-migration-test-${crypto.randomUUID()}`;
        const job=(await client.query(`INSERT INTO leadgen.research_jobs
          (country,country_code,country_name,market_profile,product_category,max_results,
           job_type,market_codes,product_profiles,status,
           idempotency_key,request_digest,created_by_identity,created_by_role,research_wave,run_budget_cap_units)
          VALUES($1,$2,$3,$4,$5,5,'REAL_OPPORTUNITY_RESEARCH',$6,$7,'QUEUED',$8,$9,
            'phase9.migration.test','DATA_ADMIN','A',2000)
          RETURNING id`,[candidate.market_code,candidate.market_code,
            candidate.market_code==='AE'?'United Arab Emirates':'Mexico',candidate.market_code,
            'PHASE9_MIGRATION_TEST',[candidate.market_code],[candidate.product_profile],
            jobKey,digest(jobKey)])).rows[0];

        await expectDatabaseFailure(client,()=>client.query(`INSERT INTO leadgen.research_jobs
          (country,country_code,country_name,market_profile,product_category,max_results,
           job_type,idempotency_key,request_digest,
           created_by_identity,created_by_role,research_wave,run_budget_cap_units)
          VALUES('AE','AE','United Arab Emirates','AE','TEST',6,
            'REAL_OPPORTUNITY_RESEARCH',$1,$2,'test','DATA_ADMIN','A',1)`,
          [`${jobKey}-cap`,digest(`${jobKey}-cap`)]),/research_jobs_phase9_required_fields_check/);
        await expectDatabaseFailure(client,()=>client.query(
          'UPDATE leadgen.research_jobs SET run_budget_cap_units=9999 WHERE id=$1',[job.id]),
          /request and budget are immutable/);

        const cohort=(await client.query(`INSERT INTO leadgen.research_job_cohort_items
          (research_job_id,company_id,product_profile,product_profile_catalog_snapshot_id,market_code,
           research_wave,selection_rank,selection_reason_code,company_verification_status_snapshot,
           company_lifecycle_status_snapshot,relationship_status_snapshot,selection_input_digest,selected_at)
          VALUES($1,$2,$3,$4,$5,'A',1,'VERIFIED_ACTIVE_NEW_PROSPECT','VERIFIED','ACTIVE',
            'NEW_PROSPECT',$6,now()) RETURNING id`,[job.id,candidate.company_id,candidate.product_profile,
            candidate.snapshot_id,candidate.market_code,digest(`${jobKey}-cohort`)])).rows[0];
        await expectDatabaseFailure(client,()=>client.query(`INSERT INTO leadgen.research_job_cohort_items
          (research_job_id,company_id,product_profile,product_profile_catalog_snapshot_id,market_code,
           research_wave,selection_rank,selection_reason_code,company_verification_status_snapshot,
           company_lifecycle_status_snapshot,relationship_status_snapshot,selection_input_digest,selected_at)
          VALUES($1,$2,$3,$4,$5,'A',2,'DUPLICATE_SELECTION','VERIFIED','ACTIVE','NEW_PROSPECT',$6,now())`,
          [job.id,candidate.company_id,candidate.product_profile,candidate.snapshot_id,candidate.market_code,
            digest(`${jobKey}-duplicate`)]),/research_job_cohort_items_research_job_id_company_id_key/);
        await expectDatabaseFailure(client,()=>client.query(
          "UPDATE leadgen.research_job_cohort_items SET selection_reason_code='CHANGED' WHERE id=$1",[cohort.id]),
          /append-only/);

        const stage=(await client.query(`INSERT INTO leadgen.research_job_stage_events
          (research_job_id,cohort_item_id,stage,event_type,outcome_code,input_digest,idempotency_key,occurred_at)
          VALUES($1,$2,'IDENTITY','STAGE_EVALUATED','IDENTITY_READY',$3,$4,now()) RETURNING id`,
          [job.id,cohort.id,digest(`${jobKey}-stage`),`${jobKey}-stage`])).rows[0];
        await expectDatabaseFailure(client,()=>client.query(
          "UPDATE leadgen.research_job_stage_events SET outcome_code='CHANGED' WHERE id=$1",[stage.id]),
          /append-only/);

        const contact=(await client.query(`SELECT dmc.id,dm.company_id
          FROM leadgen.decision_maker_contacts dmc
          JOIN leadgen.decision_makers dm ON dm.id=dmc.decision_maker_id
          ORDER BY dmc.created_at,dmc.id LIMIT 1`)).rows[0];
        assert.ok(contact,'live migration fixture requires one existing decision-maker contact');
        const usage=(await client.query(`INSERT INTO leadgen.provider_usage_events
          (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,used_units)
          VALUES($1,$2,'HUNTER','2099-01','email-verifier',$3,'COMPLETED',1000) RETURNING id`,
          [job.id,contact.company_id,digest(`${jobKey}-usage`)])).rows[0];
        const verification=(await client.query(`INSERT INTO leadgen.contact_verification_events
          (research_job_id,company_id,decision_maker_contact_id,provider_usage_event_id,
           verification_status,verification_score,verified_at,captured_at,expires_at,
           recipient_hash,input_digest,idempotency_key)
          VALUES($1,$2,$3,$4,'VALID',95,now(),now(),now()+interval '30 days',$5,$6,$7) RETURNING id`,
          [job.id,contact.company_id,contact.id,usage.id,digest(`${jobKey}-recipient`),
            digest(`${jobKey}-verify-input`),`${jobKey}-verification`])).rows[0];
        await expectDatabaseFailure(client,()=>client.query(
          "UPDATE leadgen.contact_verification_events SET verification_status='UNKNOWN' WHERE id=$1",
          [verification.id]),/append-only/);

        const reserved=(await client.query(`INSERT INTO leadgen.provider_usage_events
          (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,reserved_units)
          VALUES($1,$2,'HUNTER','2099-01','email-verifier',$3,'RESERVED',1000) RETURNING id`,
          [job.id,contact.company_id,digest(`${jobKey}-reserved`)])).rows[0];
        await expectDatabaseFailure(client,()=>client.query(`INSERT INTO leadgen.contact_verification_events
          (research_job_id,company_id,decision_maker_contact_id,provider_usage_event_id,
           verification_status,captured_at,recipient_hash,input_digest,idempotency_key)
          VALUES($1,$2,$3,$4,'TEMPORARY_ERROR',now(),$5,$6,$7)`,
          [job.id,contact.company_id,contact.id,reserved.id,digest(`${jobKey}-reserved-recipient`),
            digest(`${jobKey}-reserved-input`),`${jobKey}-reserved-verification`]),/unsettled usage/);

        await client.query("UPDATE leadgen.research_jobs SET status='PARTIAL',stop_reason_code='HUNTER_BUDGET_CAP' WHERE id=$1",[job.id]);
        await expectDatabaseFailure(client,()=>client.query(
          "UPDATE leadgen.research_jobs SET stop_reason_code='MANUAL_STOP' WHERE id=$1",[job.id]),
          /stop reason is immutable/);
        await expectDatabaseFailure(client,()=>client.query(
          'DELETE FROM leadgen.research_job_cohort_items WHERE id=$1',[cohort.id]),/append-only/);
        await client.query('ROLLBACK');
      }finally{client.release();}
      assert.deepEqual(await counts(pool),before);
    }finally{await pool.end();}
  });
