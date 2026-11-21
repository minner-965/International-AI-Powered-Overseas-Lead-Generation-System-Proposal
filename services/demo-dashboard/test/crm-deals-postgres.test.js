// Deal values, grades, key customers, reminder tasks and reports (migration 079) against a throwaway
// PostgreSQL database built from every migration. No external calls.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {CrmRepository} from '../src/crm/repository.js';
import {DealService} from '../src/crm/deals.js';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {CRM_DEAL_HEALTH_MIGRATION_KEY,verifyCrmDealHealthMigration} from '../src/phase7/migrationRunner.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const SIM=Object.freeze({merchantId:null,restrict:false});

async function withDatabase(run){
  const name=`crm_deals_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:6});
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
async function seedCompanies(pool,specs){
  const out={};
  await pool.query('SET session_replication_role=replica');
  try{
    for(const [key,country] of specs){
      const company=uuid(),snapshot=uuid();
      await pool.query(`INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code,website_url) VALUES($1,$2,$3,$4,$5)`,
        [company,`${key} Trading LLC`,`${key.toLowerCase()}-${company.slice(0,8)}.example`,country,`https://${key.toLowerCase()}.example`]);
      await pool.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile,buyer_business_model_result_id,
          category_procurement_match_result_id,cooperation_feasibility_result_id,system_recommendation_status,relationship_status,rule_version,assessment_revision,input_digest)
        VALUES($1,$2,'WOMENSWEAR',$3,$4,$5,'RECOMMENDED','NEW_PROSPECT','test-v1',1,$6)`,[snapshot,company,uuid(),uuid(),uuid(),hex(key+company)]);
      out[key]={company,snapshot};
    }
  }finally{await pool.query('RESET session_replication_role');}
  return out;
}

test('migration 079 verifies; deal history is append-only',{skip:!adminUrl},async()=>{
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
  assert.ok(files.includes(CRM_DEAL_HEALTH_MIGRATION_KEY));
  await withDatabase(async pool=>{
    assert.deepEqual(await verifyCrmDealHealthMigration(pool),{crm_deal_health:true});
    const [{A}]=[await seedCompanies(pool,[['A','AE']])];
    const deals=new DealService({pool,repository:new CrmRepository({pool})});
    await deals.saveDeal(A.company,{deal_amount:100,deal_currency:'usd'},'simon',SIM);
    await assert.rejects(pool.query('DELETE FROM leadgen.crm_deal_profile_events'),/CRM_DEAL_HISTORY_APPEND_ONLY/);
    await assert.rejects(pool.query(`INSERT INTO leadgen.crm_deal_profiles(company_id,deal_amount,updated_by) VALUES($1,5,'x')`,[A.company]),/check|duplicate/,'an amount needs a currency, and one profile per owner');
  });
});

test('deals, stage reasons, key customers, reminder tasks and reports per owner',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const now=new Date();
    const repository=new CrmRepository({pool});
    const deals=new DealService({pool,repository,now:()=>now});
    const c=await seedCompanies(pool,[['A','AE'],['B','AE'],['C','MX'],['D','MX']]);
    const stage=async(key,to,daysAgo,extra={})=>{
      await repository.setStage(c[key].snapshot,{stage:to,...extra},'simon',SIM);
      await pool.query(`UPDATE leadgen.opportunity_crm_states SET stage_changed_at=now()-($2::int*interval '1 day') WHERE company_id=$1`,[c[key].company,daysAgo]);
    };
    await stage('A','QUOTED',5);await stage('B','CONTACTED',10);await stage('C','WON',2);await stage('D','NEGOTIATING',1);

    // ---- deal values ----
    await assert.rejects(deals.saveDeal(c.A.company,{deal_amount:12000},'simon',SIM),{code:'CRM_CURRENCY_REQUIRED'});
    await assert.rejects(deals.saveDeal(c.A.company,{customer_grade:'E'},'simon',SIM),{code:'CRM_VALUE_INVALID'});
    let view=await deals.saveDeal(c.A.company,{deal_amount:'12000',deal_currency:'usd',expected_close_date:'2026-12-31',customer_grade:'a'},'simon',SIM);
    assert.deepEqual([view.deal_amount,view.deal_currency,view.expected_close_date,view.customer_grade,view.win_probability,view.effective_win_probability,view.version],
      [12000,'USD','2026-12-31','A',null,40,1]);
    assert.ok(view.flags.includes('QUOTED_NO_REPLY'));assert.ok(view.health.score>0);
    await assert.rejects(deals.saveDeal(c.A.company,{win_probability:30,expected_version:0},'simon',SIM),{code:'CRM_VERSION_CONFLICT'});
    await deals.saveDeal(c.C.company,{deal_amount:5000,deal_currency:'USD'},'simon',SIM);
    view=await deals.saveDeal(c.D.company,{deal_amount:3000,deal_currency:'USD',win_probability:50},'simon',SIM);
    assert.equal(view.effective_win_probability,50);
    assert.equal(Number((await pool.query('SELECT count(*) FROM leadgen.crm_deal_profile_events')).rows[0].count),3);

    // ---- stage reasons ----
    await assert.rejects(repository.setStage(c.C.snapshot,{stage:'NEGOTIATING'},'simon',SIM),{code:'CRM_STAGE_REASON_REQUIRED'});
    await assert.rejects(repository.setStage(c.D.snapshot,{stage:'LOST'},'simon',SIM),{code:'CRM_STAGE_REASON_REQUIRED'});
    assert.equal((await repository.setStage(c.D.snapshot,{stage:'SAMPLE',note:'Buyer asked for new samples'},'simon',SIM)).pipeline_stage,'SAMPLE');
    await pool.query(`UPDATE leadgen.opportunity_crm_states SET stage_changed_at=now()-interval '1 day' WHERE company_id=$1`,[c.D.company]);

    // ---- key customers ----
    const key=await deals.keyCustomers(SIM);
    assert.deepEqual(key.counts,{high_intent:2,no_follow_up:1,quoted_no_reply:1,sample_no_confirm:0});
    assert.equal(key.items[0].company_id,c.A.company,'quote unanswered comes first');
    assert.deepEqual(key.items.find(item=>item.company_id===c.B.company).flags,['NO_FOLLOW_UP']);

    // ---- reminder tasks: one per rule and company, not again right after a person closes it ----
    const first=await deals.scanReminders();
    assert.equal(first.created,2);
    const tasks=(await pool.query(`SELECT company_id,task_type,priority,source_rule,details->>'title' title FROM leadgen.sales_tasks WHERE source_rule IS NOT NULL ORDER BY source_rule`)).rows;
    assert.deepEqual(tasks.map(row=>[row.company_id,row.task_type,row.priority,row.source_rule]),
      [[c.B.company,'FOLLOW_UP','NORMAL','NO_FOLLOW_UP'],[c.A.company,'QUOTATION','HIGH','QUOTED_NO_REPLY']]);
    assert.equal((await deals.scanReminders()).created,0,'no duplicate while open');
    await pool.query(`UPDATE leadgen.sales_tasks SET task_status='COMPLETED',closed_at=now() WHERE source_rule='NO_FOLLOW_UP'`);
    assert.equal((await deals.scanReminders()).created,0,'not again within the rule\'s days after closing');
    await deals.saveRules({enabled:false,no_follow_up_days:7,quoted_no_reply_days:3,sample_no_confirm_days:7},'simon',SIM);
    await pool.query(`UPDATE leadgen.sales_tasks SET task_status='CANCELLED',closed_at=now()-interval '30 days' WHERE source_rule IS NOT NULL`);
    assert.equal((await deals.scanReminders()).created,0,'rules switched off');
    await assert.rejects(deals.saveRules({no_follow_up_days:0,quoted_no_reply_days:3,sample_no_confirm_days:7},'simon',SIM),{code:'CRM_VALUE_INVALID'});

    // ---- reports ----
    const report=await deals.reports(SIM);
    assert.equal(report.currency,'USD');
    assert.deepEqual([report.totals.customers,report.totals.active,report.totals.won,report.totals.won_amount],[4,3,1,5000]);
    assert.equal(report.totals.pipeline_amount,15000);
    assert.equal(report.totals.weighted_amount,12000*0.4+3000*0.5);
    const funnel=Object.fromEntries(report.funnel.map(row=>[row.stage,row]));
    assert.equal(funnel.WON.count,1);assert.equal(funnel.QUOTED.reached,3,'A quoted, D went past quote, C won');
    assert.equal(funnel.SAMPLE.conversion,Math.round(2/3*1000)/10,'2 of the 3 quoted went on to samples');assert.equal(funnel.NEGOTIATING.conversion,100);
    assert.deepEqual(report.countries.map(row=>[row.country_code,row.customers]).sort(),[['AE',2],['MX',2]]);
    assert.ok(Array.isArray(report.merchants),'the administrator also sees the merchant ranking');

    // ---- a merchant sees only its own deals ----
    const merchants=new MerchantService({pool,env:{}});
    const created=await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin');
    const merchantScope={merchantId:created.merchant.id,restrict:true};
    await merchants.assignCompanies(created.merchant.id,[c.A.company],'admin');
    const own=await deals.saveDeal(c.A.company,{deal_amount:800,deal_currency:'EUR',customer_grade:'C'},'anna@alpha.example',merchantScope);
    assert.deepEqual([own.deal_amount,own.customer_grade,own.pipeline_stage],[800,'C','NEW']);
    assert.equal((await deals.dealView(c.A.company,SIM)).deal_amount,12000,'SIM\'s values are untouched');
    await assert.rejects(deals.dealView(c.B.company,merchantScope),{code:'CRM_COMPANY_NOT_FOUND'});
    const merchantReport=await deals.reports(merchantScope);
    assert.equal(merchantReport.totals.customers,1);assert.equal(merchantReport.merchants,undefined);
    assert.equal(merchantReport.currency,'EUR');
  });
});
