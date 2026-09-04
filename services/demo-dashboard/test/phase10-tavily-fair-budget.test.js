import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

import {autoEvidenceConfig,AutoEvidenceRepository} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import {TavilyCreditBudget} from '../src/search/TavilyUsageAudit.js';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('provider-account-only ignores every legacy numeric Tavily limit',()=>{
  const config=autoEvidenceConfig({TAVILY_INTERNAL_LIMITS_ENABLED:'true',MAX_TAVILY_CREDITS_PER_DAY_UNITS:'1',
    MAX_TAVILY_CREDITS_PER_RUN_UNITS:'1',TAVILY_DISCOVERY_DAILY_UNITS:'0',TAVILY_EVIDENCE_DAILY_UNITS:'0',
    MAX_TAVILY_UNITS_PER_COMPANY_PROFILE_CYCLE:'1'});
  assert.equal(config.tavilyInternalLimitsEnabled,false);
  assert.equal(config.tavilyDailyCapUnits,null);
  assert.equal(config.tavilyRunCapUnits,null);
  assert.equal(config.tavilyDiscoveryDailyUnits,null);
  assert.equal(config.tavilyEvidenceDailyUnits,null);
  assert.equal(config.tavilyCompanyProfileCycleUnits,null);
});

test('discovery and evidence pools are independent while sharing the global Tavily ceiling',async()=>{
  const now=()=>new Date('2026-09-03T01:00:00.000Z');
  const budget=new TavilyCreditBudget({runCapUnits:5,dailyCapUnits:3,billingPeriodCapUnits:10,
    discoveryDailyCapUnits:1,evidenceDailyCapUnits:2,companyProfileCycleCapUnits:2,now});
  const reserve=async({job,query,purpose,companyId=null,productProfile=null})=>budget.reserve({researchJobId:job,
    companyId,productProfile,purpose,endpoint:'api.tavily.com/search',request:{query,count:5}});
  const discovery=await reserve({job:'discovery-job',query:'new companies',purpose:'NEW_COMPANY_DISCOVERY'});
  await budget.settle(discovery,{usedUnits:1,status:'COMPLETED'});
  await assert.rejects(()=>reserve({job:'discovery-job',query:'more companies',purpose:'NEW_COMPANY_DISCOVERY'}),
    error=>error.code==='TAVILY_CREDIT_CAP'&&error.budget_pool==='DISCOVERY');
  for(const query of ['buyer one','buyer two']){const event=await reserve({job:'evidence-job',query,
    purpose:'DECISION_MAKER_DISCOVERY',companyId:'company-a',productProfile:'WOMENSWEAR'});
    await budget.settle(event,{usedUnits:1,status:'NOT_FOUND'});}
  await assert.rejects(()=>reserve({job:'evidence-job',query:'buyer three',purpose:'DECISION_MAKER_DISCOVERY',
    companyId:'company-a',productProfile:'WOMENSWEAR'}),error=>error.code==='TAVILY_CREDIT_CAP');
});

test('candidate selection is priority-first and round-robin within priority',async()=>{
  let sql='';const repository=new AutoEvidenceRepository({pool:{async query(statement){sql=String(statement);return{rows:[]};}}});
  await repository.selectCandidates({limit:10});
  assert.match(sql,/ORDER BY priority,fairness\.last_strategy_started_at NULLS FIRST,company_id,product_profile/);
  assert.match(sql,/NOT EXISTS \(SELECT 1 FROM leadgen\.company_suppressions/);
  assert.match(sql,/INTERNAL_EXISTING_CUSTOMER/);
});

test('Workbench presents units, companies, strategies and usable evidence as separate facts',()=>{
  const ui=fs.readFileSync(path.join(appRoot,'public/ui/phase9-research-workbench.js'),'utf8');
  for(const label of ['Tavily units used today','Companies attempted today','Strategies attempted today',
    'New usable evidence today'])assert.match(ui,new RegExp(label));
  assert.doesNotMatch(ui,/25 companies/i);
});

test('WP10 live PostgreSQL budget reservation and settlement roll back cleanly',{
  skip:process.env.WP10_LIVE_DB!=='true'
},async()=>{
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const identity=(await client.query(`SELECT j.id research_job_id,c.id company_id,
      coalesce(j.product_profile,j.product_profiles[1],'WOMENSWEAR') product_profile
      FROM leadgen.research_jobs j JOIN leadgen.companies c ON c.research_job_id=j.id
      ORDER BY j.created_at,c.created_at LIMIT 1`)).rows[0];
    assert.ok(identity);
    const transactionalPool={async connect(){return{query:(sql,args)=>{
      if(['BEGIN','COMMIT','ROLLBACK'].includes(String(sql).trim().toUpperCase()))return Promise.resolve({rows:[],rowCount:0});
      return client.query(sql,args);},release(){}};}};
    const budget=new TavilyCreditBudget({pool:transactionalPool,runCapUnits:1000,dailyCapUnits:1000,
      discoveryDailyCapUnits:500,evidenceDailyCapUnits:500,companyProfileCycleCapUnits:2,
      billingPeriodCapUnits:1000});
    const event=await budget.reserve({researchJobId:identity.research_job_id,companyId:identity.company_id,
      productProfile:identity.product_profile,purpose:'CATEGORY_BUYER_EVIDENCE',endpoint:'api.tavily.com/search',
      request:{query:`wp10 rollback probe ${Date.now()}`,count:1}});
    assert.equal(event.budget_pool,'EVIDENCE');assert.equal(event.product_profile,identity.product_profile);
    const settled=await budget.settle(event,{usedUnits:1,status:'NOT_FOUND'});
    assert.equal(settled.used_units,1);assert.equal(settled.reserved_units,0);
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();}
});
