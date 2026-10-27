// Batch 2 integration against a throwaway PostgreSQL database built from every migration file (070–072
// included): manual companies in the CRM pipeline (per owner), the follow-up settings control (072),
// market send-window events (072) and the migration runner verification of 070/071/072.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch2-integration-postgres.test.js
// Skipped when no admin URL is set. No external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {ManualCompanyService} from '../src/companies/manualCompanyService.js';
import {CrmRepository} from '../src/crm/repository.js';
import {AutomationControlService} from '../src/automation/AutomationControlService.js';
import {FollowupSettingsService} from '../src/crm/followupSettings.js';
import {MarketRegistryService} from '../src/market/MarketRegistryService.js';
import {applyPhase7Migrations,verifyManualCompaniesMigration,verifyFollowupSettingsMigration} from '../src/phase7/migrationRunner.js';
import {verifyProviderCredentialsMigration} from '../src/credentials/credentialResolver.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const ADMIN=Object.freeze({admin:true,merchantId:null,restrict:false});
const merchantScope=id=>Object.freeze({admin:false,merchantId:id,restrict:true});

async function admin(sql){const client=new pg.Client({connectionString:adminUrl});await client.connect();try{return await client.query(sql);}finally{await client.end();}}
function dbUrl(name){const url=new URL(adminUrl);url.pathname=`/${name}`;return url.toString();}
async function withDatabase(run){
  const name=`batch2_int_${crypto.randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const pool=new pg.Pool({connectionString:dbUrl(name),max:8});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool,name);
  }finally{await pool.end();await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}
}

async function approveCategory(pool){
  const scopes=new CategoryScopeService({pool});const candidates=await scopes.listCandidates();
  const picked=candidates.find(c=>`${c.product_profile}:${c.normalized_category}`==='WOMENSWEAR:DRESSES')||candidates[0];
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:hex('d'),actor:'simon',
    scopes:[{client_key:'s0',product_profile:picked.product_profile,normalized_category:picked.normalized_category,source_fact_digest:picked.source_fact_digest}]});
  await scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:hex('a'),actor:'simon',actor_role:'MANAGEMENT'});
  for(let attempt=0;attempt<50;attempt++){
    const rows=(await pool.query(`SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' LIMIT 1`)).rows;
    if(rows.length)return rows[0].id;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('approved category not current');
}
const company=(category,name,website,extra={})=>({company_name:name,website,market_code:'AE',company_type:'IMPORTER',category_scope_id:category,...extra});

test('manual companies appear in the CRM pipeline with their manual stage, per owner',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const category=await approveCategory(pool);
    const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:crypto.randomBytes(32).toString('hex')}});
    const make=async name=>(await merchants.createMerchant({company_name:name,contact_name:name,login_email:`${name.toLowerCase()}@${name.toLowerCase()}.example`,
      quotas:{monthly_searches:100,daily_emails:20}},'admin')).merchant.id;
    const alpha=await make('Alpha');const beta=await make('Beta');
    const companies=new ManualCompanyService({pool,env:{}});
    const sim=await companies.create(company(category,'Gulf Fashion Trading LLC','gulf-fashion.example'),'simon@sim.example',ADMIN);
    const own=await companies.create(company(category,'Desert Retail LLC','desert-retail.example'),'anna@alpha.example',merchantScope(alpha));
    const repository=new CrmRepository({pool});

    const simView=await repository.listPipeline({scope:null});
    const simRows=simView.items.filter(row=>row.source==='MANUAL');
    assert.deepEqual(simRows.map(row=>row.company_name).sort(),['Desert Retail LLC','Gulf Fashion Trading LLC']);
    for(const row of simRows){assert.equal(row.opportunity_id,null);assert.equal(row.pipeline_stage,'NEW');assert.equal(row.product_profile,'WOMENSWEAR');}
    assert.equal(simView.stage_counts.NEW,2);

    const alphaView=await repository.listPipeline({scope:merchantScope(alpha)});
    assert.deepEqual(alphaView.items.map(row=>row.company_id),[own.company.id]);
    assert.equal(alphaView.items[0].owner_identity,'anna@alpha.example');
    assert.deepEqual((await repository.listPipeline({scope:merchantScope(beta)})).items,[]);

    // Stages are kept per owner: Alpha's QUOTED does not move SIM's view of the same company.
    await companies.setStage(own.company.id,{stage:'QUOTED',note:'Price list sent'},'anna@alpha.example',merchantScope(alpha));
    await companies.addActivity(own.company.id,{activity_type:'CALL',summary:'Called the buyer',next_follow_up_at:new Date(Date.now()-3600_000).toISOString()},
      'anna@alpha.example',merchantScope(alpha)).catch(error=>{if(error?.code!=='DATE_INVALID')throw error;});
    const quoted=(await repository.listPipeline({scope:merchantScope(alpha)})).items[0];
    assert.equal(quoted.pipeline_stage,'QUOTED');assert.equal(quoted.source,'MANUAL');
    assert.equal((await repository.listPipeline({scope:merchantScope(alpha),stage:'QUOTED'})).items.length,1);
    assert.equal((await repository.listPipeline({scope:null})).items.find(row=>row.company_id===own.company.id).pipeline_stage,'NEW');
    await companies.setStage(sim.company.id,{stage:'LOST',lost_reason:'No import licence'},'simon@sim.example',ADMIN);
    const lost=(await repository.listPipeline({scope:null,stage:'LOST'})).items;
    assert.deepEqual(lost.map(row=>[row.company_name,row.lost_reason,row.overdue]),[['Gulf Fashion Trading LLC','No import licence',false]]);
    assert.equal((await repository.listPipeline({scope:null,q:'desert'})).items.length,1);
  });
});

test('follow-up settings and market send windows are append-only workspace settings (migration 072)',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const controls=new AutomationControlService({pool});
    const settings=new FollowupSettingsService({controls,env:{CRM_FOLLOWUP_DRAFTS_ENABLED:'true',CRM_FOLLOWUP_DAILY_LIMIT:'40'}});
    assert.deepEqual(await settings.get(),{enabled:true,daily_limit:40,source:'ENVIRONMENT_DEFAULT',installed:true,revision:1,updated_by:null,updated_at:null});
    const saved=await settings.set({enabled:false,daily_limit:15,actor:'simon@sim.example'});
    assert.equal(saved.source,'WORKSPACE');assert.equal(saved.enabled,false);assert.equal(saved.daily_limit,15);assert.equal(saved.revision,2);
    const events=(await pool.query(`SELECT revision,enabled,settings_snapshot,actor FROM leadgen.automation_control_events WHERE control_key='CRM_FOLLOWUP_DRAFTS' ORDER BY revision`)).rows;
    assert.deepEqual(events.map(row=>[Number(row.revision),row.enabled,row.settings_snapshot.source]),[[1,false,'ENVIRONMENT_DEFAULT'],[2,false,'WORKSPACE']]);
    await assert.rejects(pool.query(`DELETE FROM leadgen.automation_control_events WHERE control_key='CRM_FOLLOWUP_DRAFTS'`));

    const markets=new MarketRegistryService({pool});
    const before=(await pool.query(`SELECT business_send_window,status,search_enabled FROM leadgen.research_market_registry WHERE market_code='AE'`)).rows[0];
    const changed=await markets.setSendWindow('ae',{business_send_window:{days:[7,1,2,3,4],start:'08:00',end:'16:30'},actor:'simon@sim.example',role:'MANAGEMENT'});
    assert.equal(changed.changed,true);assert.deepEqual(changed.business_send_window,{days:[1,2,3,4,7],start:'08:00',end:'16:30'});
    assert.equal((await markets.setSendWindow('AE',{business_send_window:{days:[1,2,3,4,7],start:'08:00',end:'16:30'},actor:'simon@sim.example'})).changed,false);
    const event=(await pool.query(`SELECT previous_business_send_window,business_send_window,status,search_enabled,previous_status FROM leadgen.research_market_registry_events WHERE market_code='AE'`)).rows;
    assert.equal(event.length,1);
    assert.deepEqual(event[0].previous_business_send_window,before.business_send_window);
    assert.deepEqual(event[0].business_send_window,{days:[1,2,3,4,7],start:'08:00',end:'16:30'});
    assert.equal(event[0].status,before.status);assert.equal(event[0].search_enabled,before.search_enabled);
    await assert.rejects(markets.setSendWindow('AE',{business_send_window:{days:[1],start:'18:00',end:'09:00'},actor:'simon'}),{code:'MARKET_SEND_WINDOW_ORDER_INVALID'});
    await assert.rejects(markets.setSendWindow('ZZ',{business_send_window:{days:[1],start:'09:00',end:'17:00'},actor:'simon'}),{code:'MARKET_NOT_FOUND'});
  });
});

test('migration runner baselines and verifies 070, 071 and 072 on a fresh database',{skip:!adminUrl},async()=>{
  await withDatabase(async(pool,name)=>{
    const result=await applyPhase7Migrations({pool,expectedDatabase:name,baseline:true});
    assert.equal(result.manualCompanies.status,'BASELINED');assert.equal(result.providerCredentials.status,'BASELINED');assert.equal(result.followupSettings.status,'BASELINED');
    const again=await applyPhase7Migrations({pool,expectedDatabase:name});
    for(const key of ['manualCompanies','providerCredentials','followupSettings'])assert.equal(again[key].status,'SKIPPED_ALREADY_APPLIED',key);
    const client=await pool.connect();
    try{
      assert.equal((await verifyManualCompaniesMigration(client)).manual_companies,'HUMAN_APPROVED_FIRST_TOUCH');
      assert.equal((await verifyProviderCredentialsMigration(client)).provider_credentials,true);
      assert.equal((await verifyFollowupSettingsMigration(client)).market_send_window_events,true);
    }finally{client.release();}
  });
});
