// Migrations 081 (follow-up rules round two) and 082 (merchant applications and payments), and the
// stage gate shared by the server and the page. Database part runs against a throwaway PostgreSQL database.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {stageGateProblem,WON_CONFIRMATIONS} from '../src/crm/stageRules.js';
import {stageGateProblem as pageGate,WON_CONFIRMATIONS as PAGE_CONFIRMATIONS} from '../public/ui/v4/crm.js';
import {CRM_FOLLOWUP_RULES_MIGRATION_KEY,MERCHANT_ONBOARDING_MIGRATION_KEY,verifyCrmFollowupRulesMigration,verifyMerchantOnboardingMigration} from '../src/phase7/migrationRunner.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const STAGES=['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON','LOST'];

test('stage gate: close date from the quote stage on, customer confirmation for won; page and server agree',()=>{
  assert.deepEqual(Object.keys(PAGE_CONFIRMATIONS),[...WON_CONFIRMATIONS]);
  const deals=[{},{expected_close_date:'2026-12-31'},{won_confirmation:'PO'},{won_confirmation:'OTHER'},{won_confirmation:'OTHER',won_confirmation_note:'Signed by email'},
    {expected_close_date:'2026-12-31',won_confirmation:'DEPOSIT'}];
  for(const from of STAGES)for(const to of STAGES)for(const deal of deals)assert.equal(pageGate(from,to,deal),stageGateProblem(from,to,deal),`${from}->${to} ${JSON.stringify(deal)}`);
  assert.equal(stageGateProblem('REPLIED','QUOTED',{}),'CLOSE_DATE_REQUIRED');
  assert.equal(stageGateProblem('QUOTED','QUOTED',{}),null,'no change, no gate');
  assert.equal(stageGateProblem('NEGOTIATING','WON',{}),'WON_CONFIRMATION_REQUIRED');
  assert.equal(stageGateProblem('NEGOTIATING','WON',{won_confirmation:'OTHER'}),'WON_CONFIRMATION_NOTE_REQUIRED');
  assert.equal(stageGateProblem('NEGOTIATING','WON',{won_confirmation:'PO'}),null,'won needs no close date');
  assert.equal(stageGateProblem('QUOTED','LOST',{}),null);assert.equal(stageGateProblem('NEW','CONTACTED',{}),null);
});

async function withDatabase(run){
  const name=`followup_rules_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:4});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool);
  }finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

test('migrations 081 and 082 verify, run twice safely, and keep history',{skip:!adminUrl},async()=>{
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
  assert.deepEqual(files.slice(-2),[CRM_FOLLOWUP_RULES_MIGRATION_KEY,MERCHANT_ONBOARDING_MIGRATION_KEY]);
  await withDatabase(async pool=>{
    for(const file of files.slice(-2))await pool.query(await readFile(path.join(migrations,file),'utf8'));
    assert.deepEqual(await verifyCrmFollowupRulesMigration(pool),{crm_followup_rules:true});
    assert.deepEqual(await verifyMerchantOnboardingMigration(pool),{merchant_onboarding:true});
    // Exchange rates: one per owner and currency, history append-only.
    await pool.query(`INSERT INTO leadgen.crm_exchange_rates(base_currency,currency,rate,updated_by) VALUES('USD','EUR',1.08,'simon')`);
    await assert.rejects(pool.query(`INSERT INTO leadgen.crm_exchange_rates(base_currency,currency,rate,updated_by) VALUES('USD','EUR',1.1,'simon')`),/duplicate/);
    await assert.rejects(pool.query(`INSERT INTO leadgen.crm_exchange_rates(base_currency,currency,rate,updated_by) VALUES('USD','USD',1,'simon')`),/check/);
    await pool.query(`INSERT INTO leadgen.crm_exchange_rate_events(base_currency,rates,changed_by) VALUES('USD','{"EUR":1.08}','simon')`);
    await assert.rejects(pool.query('DELETE FROM leadgen.crm_exchange_rate_events'),/CRM_EXCHANGE_RATE_HISTORY_APPEND_ONLY/);
    // Reminder source rule accepts the new kind only.
    const check=(await pool.query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='sales_tasks_source_rule_check'`)).rows[0].def;
    assert.match(check,/NEXT_ACTION_DUE/);
    // Applications: one open per email; decided ones never change; never deleted.
    await pool.query(`INSERT INTO leadgen.merchant_applications(company_name,contact_name,email) VALUES('Alpha','Anna','anna@alpha.example')`);
    await assert.rejects(pool.query(`INSERT INTO leadgen.merchant_applications(company_name,contact_name,email) VALUES('Alpha 2','Anna','ANNA@alpha.example')`),/duplicate/);
    await assert.rejects(pool.query(`UPDATE leadgen.merchant_applications SET status='REJECTED',decided_at=now(),decided_by='simon'`),/check/,'a rejection needs a reason');
    await pool.query(`UPDATE leadgen.merchant_applications SET status='REJECTED',decided_at=now(),decided_by='simon',decision_reason='Not an exporter'`);
    await assert.rejects(pool.query(`UPDATE leadgen.merchant_applications SET decision_reason='x'`),/MERCHANT_APPLICATION_DECIDED/);
    await assert.rejects(pool.query('DELETE FROM leadgen.merchant_applications'),/MERCHANT_APPLICATION_KEPT/);
  });
});
