import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {OpportunityPoolService,OPPORTUNITY_POOL_VERSION} from '../src/opportunityPool/OpportunityPoolService.js';
import {reevaluateOpportunityPool} from '../scripts/reevaluate-opportunity-pool.mjs';

// v2_MC08 re-evaluation on a COPY of the restored live data (CREATE DATABASE … TEMPLATE live_copy); the
// original live_copy is never written. Env-gated:
//   BATCH3_POOL_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres  (MERCHANT_TEST_ADMIN_URL accepted)
//   BATCH3_POOL_TEST_TEMPLATE=live_copy (default)
const adminUrl=process.env.BATCH3_POOL_TEST_ADMIN_URL||process.env.MERCHANT_TEST_ADMIN_URL||'';
const template=process.env.BATCH3_POOL_TEST_TEMPLATE||'live_copy';

async function withCopy(run){
  const name=`b3pool_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{
    const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[template])).rowCount;
    if(!exists)return'NO_TEMPLATE';
    let lastError;
    for(let attempt=0;attempt<10;attempt++){
      try{await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);lastError=null;break;}
      catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,500));}
    }
    if(lastError)throw lastError;
  }finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:4});
  try{return await run(pool);}finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

test('v2_MC08 re-evaluation on a copy of live data: dry run writes nothing, apply appends only changed companies, history kept',
  {skip:!adminUrl&&'set BATCH3_POOL_TEST_ADMIN_URL (or MERCHANT_TEST_ADMIN_URL) to run'},async t=>{
  const outcome=await withCopy(async pool=>{
    const count=async()=>Number((await pool.query('SELECT count(*) n FROM leadgen.opportunity_pool_decisions')).rows[0].n);
    const before=await count();
    const v1Rows=(await pool.query(`SELECT company_id,revision FROM leadgen.opportunity_pool_current`)).rows;
    assert.ok(v1Rows.length>0,'live copy has pool decisions');

    const dry=await reevaluateOpportunityPool({pool,apply:false});
    assert.equal(dry.dry_run,true);assert.equal(dry.rule_version,'v2_MC08');assert.equal(dry.appended,0);
    assert.equal(await count(),before,'dry run writes nothing');
    assert.equal(dry.counts.UNCHANGED+dry.counts.NEW+dry.counts.BAND_CHANGED+dry.counts.INPUTS_CHANGED,dry.total);
    assert.ok(dry.changes.length<dry.total,'unchanged companies are not re-appended');
    // The approved comparison: broad-only GENERAL_RELEVANT companies drop to EXPLORATORY, none move up.
    const bandChanges=dry.changes.filter(row=>row.change==='BAND_CHANGED');
    assert.ok(bandChanges.length>0);
    assert.ok(bandChanges.every(row=>row.from_band==='GENERAL_RELEVANT'&&row.to_band==='EXPLORATORY'));

    const applied=await reevaluateOpportunityPool({pool,apply:true});
    assert.equal(applied.dry_run,false);assert.equal(applied.appended,dry.changes.length);
    assert.equal(await count(),before+dry.changes.length,'append-only: only changed companies got a new row');
    for(const row of v1Rows)assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.opportunity_pool_decisions WHERE company_id=$1 AND revision=$2',[row.company_id,row.revision])).rows[0].n,1,'old decision kept');
    const current=(await pool.query(`SELECT rule_version,count(*)::int n FROM leadgen.opportunity_pool_current GROUP BY 1`)).rows;
    assert.equal(current.find(row=>row.rule_version==='v2_MC08')?.n,dry.changes.length);
    for(const row of bandChanges)assert.equal((await pool.query('SELECT opportunity_pool_band FROM leadgen.opportunity_pool_current WHERE company_id=$1',[row.company_id])).rows[0].opportunity_pool_band,'EXPLORATORY');

    // Replay: nothing left to append.
    const again=await reevaluateOpportunityPool({pool,apply:false});
    assert.equal(again.changes.length,0);assert.equal(again.counts.UNCHANGED,again.total);

    // New evaluations use v2: an evidence refresh of a company still on v1 appends a v2 decision.
    const stillV1=(await pool.query(`SELECT company_id FROM leadgen.opportunity_pool_current WHERE rule_version='v1_MC04' LIMIT 1`)).rows[0];
    if(stillV1){
      const service=new OpportunityPoolService({pool});
      const refreshed=await service.refreshCompany(stillV1.company_id,{reason:'TEST_EVIDENCE_CHANGED'});
      assert.equal(refreshed.inserted,1);assert.equal(refreshed.decisions[0].rule_version,OPPORTUNITY_POOL_VERSION);
      assert.equal((await service.refreshCompany(stillV1.company_id,{reason:'TEST_REPLAY'})).replayed,1);
    }
    await assert.rejects(pool.query(`UPDATE leadgen.opportunity_pool_decisions SET change_reason='x'`),/append-only/);
  });
  if(outcome==='NO_TEMPLATE')t.skip(`template database ${template} not present`);
});
