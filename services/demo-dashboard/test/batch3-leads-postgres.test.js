import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {ContactResearchReconciler} from '../src/automation/ContactResearchReconciler.js';
import {EnrichmentService} from '../src/enrichment/EnrichmentService.js';
import {OpportunityPoolService} from '../src/opportunityPool/OpportunityPoolService.js';
import {LeadUsabilityService,MAX_LEAD_ENRICHMENT_ATTEMPTS,verifyLeadEnrichmentAttemptsMigration} from '../src/opportunityPool/leadUsability.js';
import {ResearchWorkbenchService} from '../src/research/ResearchWorkbenchService.js';

// Batch 3 supplementary contact verification (migration 073) against a throwaway PostgreSQL database built
// from every migration file. Providers are in-process doubles: no search, crawl or Hunter call leaves the test.
//   BATCH3_LEADS_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres  (MERCHANT_TEST_ADMIN_URL accepted too)
const adminUrl=process.env.BATCH3_LEADS_TEST_ADMIN_URL||process.env.MERCHANT_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function withDatabase(run){
  const name=`b3leads_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:8});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    // pg-boss owns this schema in production; the reconciler only reads pgboss.job.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS pgboss;CREATE TABLE IF NOT EXISTS pgboss.job(id uuid DEFAULT gen_random_uuid(),name text,data jsonb,state text)`);
    return await run(pool);
  }finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

async function company(pool,{name,domain,band='EXPLORATORY'}){
  const row=(await pool.query(`INSERT INTO leadgen.companies(company_name,normalized_domain,country_code,website_url,official_root_domain,verification_status,lifecycle_status,product_categories)
    VALUES($1,$2,'AE',$3,$2,'VERIFIED','ACTIVE',ARRAY['women dresses']) RETURNING *`,[name,domain,`https://${domain}`])).rows[0];
  await pool.query(`INSERT INTO leadgen.opportunity_pool_decisions(company_id,rule_version,input_digest,opportunity_pool_band,is_active_business_opportunity,
    category_relation,company_fit_relation,email_send_eligibility,profile_results,change_reason,observed_at)
    VALUES($1,'v2_MC08',$2,$3,$4,'NO_CURRENT_CATEGORY_EVIDENCE','{}'::jsonb,'{"send_authorized":false}'::jsonb,$5::jsonb,'TEST',now())`,
  [row.id,hex(`${row.id}:${band}`),band,['PRECISION','RELEVANT','GENERAL_RELEVANT'].includes(band),
    JSON.stringify([{product_profile:'WOMENSWEAR',band,category_basis:'NO_CURRENT_CATEGORY_EVIDENCE'}])]);
  return row;
}
async function automationJob(pool,companyIds,{identity='phase13-automation',role='SYSTEM'}={}){
  return(await pool.query(`INSERT INTO leadgen.research_jobs(country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
    buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,idempotency_key,request_digest,created_by_identity,created_by_role,dispatch_execution_key)
    VALUES('Automated','XX','Automated','en','MULTI_MARKET','Buyer / Procurement Enrichment','WOMENSWEAR',ARRAY['Buyer'],$2,'QUEUED','DECISION_MAKER_ENRICHMENT',
      ARRAY['AE'],ARRAY['WOMENSWEAR'],$1::uuid[],$3,$4,$5,$6,$7) RETURNING *`,
  [companyIds,companyIds.length,`b3-${crypto.randomUUID()}`,hex(crypto.randomUUID()),identity,role,`dispatch-${crypto.randomUUID()}`])).rows[0];
}
// Provider doubles. `mode` switches the search double between a real (mocked) call and a spend-policy pause.
function enrichment(pool,{searchCalls,mode}){
  return new EnrichmentService({pool,provider:{name:'searxng'},
    searchAudit:{async search(){
      if(mode.pause)throw Object.assign(new Error('paused'),{searchPause:true,code:'PAUSED_FREE_PROVIDER_UNAVAILABLE'});
      searchCalls.push(1);return{results:[],result_count:0,provider:'searxng'};}},
    checker:{async robotsAllows(){return true;},async fetchPage(url){return{reachable:false,url,final_url:url,fetch_status:'NOT_FOUND'};}},
    hunter:{capabilities:{enabled:false},mode:'DISABLED'},maxQueriesPerCompany:1});
}
const automation=()=>({async getState(){return{contact_research_automation:true,allowed_bands:['PRECISION','RELEVANT','GENERAL_RELEVANT']};},
  async isContactResearchEnabled(){return true;}});

test('batch 3 leads: real attempts are counted, the 5th failed attempt marks the lead unusable, later runs skip it, restore works',
  {skip:!adminUrl&&'set BATCH3_LEADS_TEST_ADMIN_URL (or MERCHANT_TEST_ADMIN_URL) to run'},async()=>{
  await withDatabase(async pool=>{
    assert.equal((await verifyLeadEnrichmentAttemptsMigration(pool)).lead_enrichment_attempts,'APPEND_ONLY');
    const lead=await company(pool,{name:'Exploratory Trading LLC',domain:'exploratory-trading.example'});
    const enqueued=[];const queue={async enqueue(...args){enqueued.push(args);}};
    const reconciler=new ContactResearchReconciler({pool,queue,queueName:'enrich-decision-makers',automation:automation(),
      selectProvider:async()=>({provider:'searxng'}),env:{}});
    // Exploratory companies now get supplementary contact research (no named buyer required).
    const first=await reconciler.reconcile({limit:5});
    assert.equal(first.status,'QUEUED');assert.equal(first.exploratory_company_count,1);assert.equal(enqueued.length,1);
    const job=(await pool.query('SELECT * FROM leadgen.research_jobs WHERE id=$1',[first.research_job_id])).rows[0];
    assert.deepEqual(job.requested_company_ids,[lead.id]);assert.equal(job.created_by_role,'SYSTEM');assert.deepEqual(job.product_profiles,['WOMENSWEAR']);
    // The switch off: nothing is created (the existing CONTACT_RESEARCH_EXECUTION gate still decides).
    const off=new ContactResearchReconciler({pool,queue,queueName:'q',env:{},automation:{async getState(){return{contact_research_automation:false};}}});
    assert.equal((await off.reconcile()).status,'PAUSED');
    // Disabling exploratory supplementary research leaves only the active bands.
    const activeOnly=new ContactResearchReconciler({pool,queue,queueName:'q',automation:automation(),env:{CONTACT_RESEARCH_EXPLORATORY:'false'}});
    assert.equal((await activeOnly.reconcile()).status,'WAITING_CONTACT_RESEARCH_WORK');

    const searchCalls=[];const mode={pause:false};const service=enrichment(pool,{searchCalls,mode});
    const counts=async()=>(await pool.query('SELECT * FROM leadgen.lead_enrichment_attempt_current WHERE company_id=$1',[lead.id])).rows[0]||{attempts_since_restore:0,total_attempts:0};
    const status=async()=>(await pool.query('SELECT status FROM leadgen.lead_usability_current WHERE company_id=$1',[lead.id])).rows[0]?.status||null;
    const run1=await service.runJob(job.id);
    assert.equal(run1.lead_attempts.recorded,1);assert.equal(searchCalls.length,1);
    assert.equal((await counts()).attempts_since_restore,1);
    const attempt=(await pool.query('SELECT * FROM leadgen.lead_enrichment_attempts WHERE company_id=$1',[lead.id])).rows[0];
    assert.equal(attempt.outcome==='NO_USABLE_EMAIL'||attempt.outcome==='FAILED',true);assert.equal(attempt.attempt_source,'CONTACT_RESEARCH');
    assert.equal(attempt.opportunity_pool_band,'EXPLORATORY');assert.equal(attempt.search_queries_executed,1);
    // A paused run (FREE_ONLY without a free provider) made no provider call: it is not an attempt.
    mode.pause=true;
    const paused=await service.runJob((await automationJob(pool,[lead.id])).id);
    assert.equal(paused.lead_attempts.recorded,0);assert.equal(paused.lead_attempts.skipped_no_provider_call,1);
    assert.equal((await counts()).attempts_since_restore,1);assert.equal(searchCalls.length,1);
    mode.pause=false;
    for(let n=2;n<MAX_LEAD_ENRICHMENT_ATTEMPTS;n++){await service.runJob((await automationJob(pool,[lead.id])).id);assert.equal(await status(),null,`still usable after ${n}`);}
    assert.equal((await counts()).attempts_since_restore,4);
    const fifth=await service.runJob((await automationJob(pool,[lead.id])).id);
    assert.deepEqual(fifth.lead_attempts.marked_unusable,[lead.id]);
    assert.equal(await status(),'UNUSABLE');
    const event=(await pool.query('SELECT * FROM leadgen.lead_usability_events WHERE company_id=$1',[lead.id])).rows;
    assert.equal(event.length,1);assert.equal(event[0].reason_code,'NO_USABLE_BUSINESS_EMAIL_AFTER_MAX_ATTEMPTS');assert.equal(event[0].attempt_count,5);
    // Later automatic runs skip it: the reconciler does not select it and an automatic job finds no eligible company.
    await pool.query(`UPDATE leadgen.enrichment_job_companies SET updated_at=now()-interval '3 days' WHERE company_id=$1`,[lead.id]);
    assert.equal((await reconciler.reconcile()).status,'WAITING_CONTACT_RESEARCH_WORK');
    const skipped=await service.runJob((await automationJob(pool,[lead.id])).id);
    assert.equal(skipped.reason,'NO_ELIGIBLE_COMPANIES');assert.equal(searchCalls.length,5);
    const autoEvidence=await service.runJob((await automationJob(pool,[lead.id],{identity:'phase10-auto-evidence'})).id);
    assert.equal(autoEvidence.reason,'NO_ELIGIBLE_COMPANIES');
    // An operator-started run is not an automatic search and still runs (and is recorded as OPERATOR).
    const operator=await service.runJob((await automationJob(pool,[lead.id],{identity:'simon@sim.example',role:'MANAGEMENT'})).id);
    assert.equal(operator.companies_attempted,1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leadgen.lead_enrichment_attempts WHERE company_id=$1 AND attempt_source='OPERATOR'`,[lead.id])).rows[0].n,1);
    // Pages: list rows carry the flag (hidden by default in the UI).
    const pools=new OpportunityPoolService({pool});
    const [decorated]=await pools.decorateRows([{company_id:lead.id,company_name:'x'}]);
    assert.equal(decorated.unusable_lead,true);assert.equal(decorated.lead_usability.status,'UNUSABLE');
    // Append-only.
    await assert.rejects(pool.query('UPDATE leadgen.lead_enrichment_attempts SET outcome=$1',['USABLE_EMAIL_FOUND']),/append-only/);
    await assert.rejects(pool.query('DELETE FROM leadgen.lead_usability_events'),/append-only/);
    // Restore (admin): RESTORED row, a fresh budget, and contact research selects it again.
    const usability=new LeadUsabilityService({pool});
    await assert.rejects(usability.restore(crypto.randomUUID(),{actor:'simon'}),error=>error.code==='LEAD_NOT_UNUSABLE');
    const restored=await usability.restore(lead.id,{actor:'simon@sim.example',reason:'New website found'});
    assert.equal(restored.status,'USABLE');assert.equal(restored.event,'RESTORED');
    assert.equal(await status(),'RESTORED');assert.equal((await counts()).attempts_since_restore,0);
    assert.equal((await counts()).total_attempts,6);
    await pool.query(`UPDATE leadgen.enrichment_job_companies SET updated_at=now()-interval '3 days' WHERE company_id=$1`,[lead.id]);
    const again=await reconciler.reconcile();assert.ok(['QUEUED','REUSED'].includes(again.status),'selected again (same-day request reuses the daily job key)');assert.equal(again.company_count,1);
    const [afterRestore]=await pools.decorateRows([{company_id:lead.id}]);assert.equal(afterRestore.unusable_lead,false);
    const history=await usability.history(lead.id);assert.equal(history.events.length,2);assert.equal(history.attempts.length,6);
  });
});

test('batch 3 leads: any business mailbox counts as usable; a usable email never marks the lead unusable',
  {skip:!adminUrl&&'set BATCH3_LEADS_TEST_ADMIN_URL (or MERCHANT_TEST_ADMIN_URL) to run'},async()=>{
  await withDatabase(async pool=>{
    const lead=await company(pool,{name:'Mailbox Imports',domain:'mailbox-imports.example'});
    const other=await company(pool,{name:'Foreign Mail Co',domain:'foreign-mail.example'});
    const person=async c=>(await pool.query(`INSERT INTO leadgen.decision_makers(company_id,department_name,normalized_role,market_code)
      VALUES($1,'Sales','COMMERCIAL','AE') RETURNING id`,[c.id])).rows[0].id;
    // info@ on the company's own site: usable without a named decision maker.
    await pool.query(`INSERT INTO leadgen.decision_maker_contacts(decision_maker_id,company_id,contact_type,contact_value_raw,contact_value_normalized,source_url,evidence_origin,verification_status)
      VALUES($1,$2,'GENERIC_BUSINESS_EMAIL','info@mailbox-imports.example','info@mailbox-imports.example','https://mailbox-imports.example/contact','OFFICIAL_SITE_OBSERVED','NOT_VERIFIED')`,[await person(lead),lead.id]);
    // Provider-found address on another domain is not the company's business mailbox; an INVALID one never counts.
    const otherPerson=await person(other);
    await pool.query(`INSERT INTO leadgen.decision_maker_contacts(decision_maker_id,company_id,contact_type,contact_value_raw,contact_value_normalized,source_url,evidence_origin,verification_status)
      VALUES($1,$2,'BUSINESS_EMAIL','someone@gmail.com','someone@gmail.com','https://foreign-mail.example','PROVIDER_FOUND','VALID'),
            ($1,$2,'BUSINESS_EMAIL','buying@foreign-mail.example','buying@foreign-mail.example','https://foreign-mail.example','PROVIDER_FOUND','INVALID')`,[otherPerson,other.id]);
    const usability=new LeadUsabilityService({pool});
    const counts=await usability.usableEmailCounts([lead.id,other.id]);
    assert.equal(counts.get(lead.id),1);assert.equal(counts.get(other.id)||0,0);
    const searchCalls=[];const service=enrichment(pool,{searchCalls,mode:{pause:false}});
    for(let n=0;n<MAX_LEAD_ENRICHMENT_ATTEMPTS;n++)await service.runJob((await automationJob(pool,[lead.id])).id);
    const rows=(await pool.query('SELECT outcome,usable_email_count FROM leadgen.lead_enrichment_attempts WHERE company_id=$1',[lead.id])).rows;
    assert.equal(rows.length,5);assert.ok(rows.every(row=>row.outcome==='USABLE_EMAIL_FOUND'&&row.usable_email_count===1));
    assert.equal((await usability.statusFor([lead.id])).get(lead.id).status,'USABLE');
    // A same-domain mailbox (sales@) found by a provider is usable too.
    await pool.query(`INSERT INTO leadgen.decision_maker_contacts(decision_maker_id,company_id,contact_type,contact_value_raw,contact_value_normalized,source_url,evidence_origin,verification_status)
      VALUES($1,$2,'GENERIC_BUSINESS_EMAIL','sales@foreign-mail.example','sales@foreign-mail.example','https://foreign-mail.example','PROVIDER_FOUND','ACCEPT_ALL')`,[otherPerson,other.id]);
    assert.equal((await usability.usableEmailCounts([other.id])).get(other.id),1);
    // Research cohort reuse skips a lead marked unusable.
    const third=await company(pool,{name:'Cohort Skip Co',domain:'cohort-skip.example'});
    await pool.query(`INSERT INTO leadgen.lead_enrichment_attempts(company_id,attempt_source,outcome,search_queries_executed,idempotency_key) SELECT $1,'CONTACT_RESEARCH','NO_USABLE_EMAIL',1,'seed-'||g FROM generate_series(1,5) g`,[third.id]);
    assert.ok(await usability.markIfExhausted(third.id));
    assert.equal(await usability.markIfExhausted(third.id),null,'idempotent');
    const workbench=new ResearchWorkbenchService({pool,publicDataOrigins:['live_discovered']});
    const cohortSql=String(workbench.selectCohort);assert.match(cohortSql,/usableLeadSql\('c'\)/);
  });
});
