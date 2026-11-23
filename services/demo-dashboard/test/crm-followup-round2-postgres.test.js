// Round two (migration 081): stage gate on the pipeline, reminders counted from an event, preview,
// overdue reschedule reason, suggested win probability. Against a throwaway
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
import {CrmService} from '../src/crm/service.js';
import {DealService} from '../src/crm/deals.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const uuid=()=>crypto.randomUUID();
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const SIM=Object.freeze({merchantId:null,restrict:false});

async function withDatabase(run){
  const name=`crm_round2_it_${crypto.randomBytes(4).toString('hex')}`;
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


test('stage gate on the pipeline, reminders from an event with preview, overdue reschedule reason',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const now=new Date();
    const repository=new CrmRepository({pool});
    const crm=new CrmService({pool,repository});
    const deals=new DealService({pool,repository,now:()=>now});
    const sales={identity:'simon',role:'ADMIN'};
    const c=await seedCompanies(pool,[['A','AE'],['B','MX']]);

    // ---- stage gate: a person moving to quoted needs a close date; won needs the customer's confirmation ----
    await assert.rejects(crm.setStage(c.A.snapshot,{stage:'QUOTED'},sales,SIM),{code:'CLOSE_DATE_REQUIRED',status:422});
    await crm.setStage(c.A.snapshot,{stage:'QUOTED',expected_close_date:'2026-12-31'},sales,SIM);
    let view=await deals.dealView(c.A.company,SIM);
    assert.deepEqual([view.pipeline_stage,view.expected_close_date],['QUOTED','2026-12-31']);
    await assert.rejects(crm.setStage(c.A.snapshot,{stage:'WON'},sales,SIM),{code:'WON_CONFIRMATION_REQUIRED'});
    await assert.rejects(crm.setStage(c.A.snapshot,{stage:'WON',won_confirmation:'OTHER'},sales,SIM),{code:'WON_CONFIRMATION_NOTE_REQUIRED'});
    await assert.rejects(crm.setStage(c.A.snapshot,{stage:'WON',won_confirmation:'NOPE'},sales,SIM),{code:'CRM_VALUE_INVALID'});
    await crm.setStage(c.A.snapshot,{stage:'WON',won_confirmation:'deposit'},sales,SIM);
    view=await deals.dealView(c.A.company,SIM);
    assert.deepEqual([view.pipeline_stage,view.won_confirmation,Boolean(view.won_confirmed_at),view.effective_win_probability],['WON','DEPOSIT',true,100]);
    const events=(await pool.query(`SELECT changes FROM leadgen.crm_deal_profile_events WHERE company_id=$1 ORDER BY changed_at`,[c.A.company])).rows.map(row=>row.changes.stage_change);
    assert.deepEqual(events,['NEW->QUOTED','QUOTED->WON'],'each gated change is recorded');
    // Stages before the quote need nothing extra.
    await crm.setStage(c.B.snapshot,{stage:'CONTACTED'},sales,SIM);

    // ---- reminders count from an event ----
    await crm.setStage(c.B.snapshot,{stage:'QUOTED',expected_close_date:'2026-12-31'},sales,SIM);
    await pool.query(`UPDATE leadgen.opportunity_crm_states SET stage_changed_at=now()-interval '5 days' WHERE company_id=$1`,[c.B.company]);
    const before=Number((await pool.query('SELECT count(*) FROM leadgen.sales_tasks')).rows[0].count);
    const preview=await deals.previewReminders(SIM);
    assert.equal(preview.rules.QUOTED_NO_REPLY.creatable,1);assert.deepEqual(preview.rules.QUOTED_NO_REPLY.examples,['B Trading LLC']);
    assert.equal(Number((await pool.query('SELECT count(*) FROM leadgen.sales_tasks')).rows[0].count),before,'the preview writes nothing');
    assert.equal((await deals.scanReminders()).created,1);
    const task=(await pool.query(`SELECT id,source_event_at FROM leadgen.sales_tasks WHERE source_rule='QUOTED_NO_REPLY'`)).rows[0];
    const stageAt=(await pool.query(`SELECT stage_changed_at FROM leadgen.opportunity_crm_states WHERE company_id=$1`,[c.B.company])).rows[0].stage_changed_at;
    assert.equal(new Date(task.source_event_at).getTime(),new Date(stageAt).getTime(),'counted from the quote');
    // Closed a while ago for the same quote: not again. A new quote: again.
    await pool.query(`UPDATE leadgen.sales_tasks SET task_status='COMPLETED',closed_at=now()-interval '30 days' WHERE id=$1`,[task.id]);
    assert.equal((await deals.scanReminders()).created,0,'same event');
    assert.equal((await deals.previewReminders(SIM)).rules.QUOTED_NO_REPLY.skipped.same_event,1);
    await pool.query(`UPDATE leadgen.opportunity_crm_states SET stage_changed_at=now()-interval '4 days' WHERE company_id=$1`,[c.B.company]);
    assert.equal((await deals.scanReminders()).created,1,'a new quote starts a new cycle');

    // ---- an overdue task moves only with a reason ----
    const due=await repository.createTask({company_id:c.B.company,task_type:'FOLLOW_UP',title:'Call back',due_at:new Date(Date.now()-86_400_000).toISOString()},'simon',SIM);
    const tomorrow=new Date(Date.now()+86_400_000).toISOString();
    await assert.rejects(crm.updateTask(due.id,{due_at:tomorrow},sales,SIM),{code:'CRM_RESCHEDULE_REASON_REQUIRED',status:422});
    const moved=await crm.updateTask(due.id,{due_at:tomorrow,note:'Customer travelling this week'},sales,SIM);
    const note=moved.details.notes.at(-1);
    assert.equal(note.text,'Customer travelling this week');assert.equal(new Date(note.rescheduled_from).getTime(),new Date(due.due_at).getTime());
    assert.equal(new Date(note.rescheduled_to).getTime(),new Date(tomorrow).getTime());
    // Not overdue any more: moving again needs no reason.
    await crm.updateTask(due.id,{due_at:new Date(Date.now()+2*86_400_000).toISOString()},sales,SIM);
  });
});
