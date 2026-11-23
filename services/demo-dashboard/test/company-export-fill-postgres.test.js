// Export, fill-in import and the manual-company stage gate (migrations 080-081) against a throwaway
// PostgreSQL database built from every migration. No external calls.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {ManualCompanyService} from '../src/companies/manualCompanyService.js';
import {CompanyImportService} from '../src/companies/importWizard.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {MerchantService} from '../src/merchant/MerchantService.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const ADMIN=Object.freeze({admin:true,merchantId:null,restrict:false});

async function withDatabase(run){
  const name=`company_fill_it_${crypto.randomBytes(4).toString('hex')}`;
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
import ExcelJS from 'exceljs';

const sheetRows=async buffer=>{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const rows=[];
  workbook.worksheets[0].eachRow(row=>rows.push(row.values.slice(1).map(value=>value===null||value===undefined?'':String(value))));return rows;};

test('export, edit and import again: empty fields are filled, nothing is overwritten, won deals keep their values',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const category=await approveCategory(pool);
    const companies=new ManualCompanyService({pool,env:{}});
    const imports=new CompanyImportService({pool,companies});
    const add=(name,site,extra={})=>companies.create({company_name:name,website:site,market_code:'AE',company_type:'IMPORTER',category_scope_id:category,...extra},'simon',ADMIN);
    const alNoor=(await add('Al Noor Fashion LLC','alnoor.example',{contact:{email:'info@alnoor.example'}})).company.id;
    const gulf=(await add('Gulf Home LLC','gulfhome.example')).company.id;
    const won=(await add('Desert Rose','desertrose.example')).company.id;
    await pool.query(`UPDATE leadgen.companies SET city='Dubai' WHERE id=$1`,[gulf]);
    await companies.setStage(won,{stage:'WON',won_confirmation:'PO'},'simon',ADMIN);

    // ---- export ----
    const file=await imports.exportWorkbook(ADMIN,new Date('2026-11-22T10:00:00Z'));
    assert.equal(file.file_name,'companies-2026-11-22.xlsx');assert.equal(file.count,3);
    const exported=await sheetRows(file.buffer);
    assert.equal(exported[0][0],'编号 ID');assert.equal(exported[0][9],'阶段 Stage');
    const line=exported.find(row=>row[0]===alNoor);
    assert.deepEqual([line[1],line[3],line[6],line[9]],['Al Noor Fashion LLC','AE','info@alnoor.example','NEW']);
    const wonLine=exported.find(row=>row[0]===won);
    assert.equal(wonLine[9],'WON');

    // ---- edit in Excel and import again ----
    const headers=exported[0];
    const edited=[headers,
      [alNoor,'Al Noor Fashion LLC','alnoor.example','AE','IMPORTER','Sharjah','buying@alnoor.example','Omar','Buyer','NEW','12000','USD','A',''],
      [gulf,'Gulf Home LLC','gulfhome.example','AE','IMPORTER','Abu Dhabi','','','','NEW','','','',''],
      [won,'Desert Rose','desertrose.example','AE','IMPORTER','','','','','WON','5000','EUR','B',''],
      ['00000000-0000-4000-8000-000000000000','Ghost','ghost.example','AE','IMPORTER','','','','','NEW','','','',''],
      ['','New Buyer LLC','newbuyer.example','AE','IMPORTER','Dubai','','','','','AED 3000','','C','']];
    const preview=await imports.preview({file_name:'edited.csv',content_base64:Buffer.from(edited.map(row=>row.join(',')).join('\n')).toString('base64')},ADMIN);
    assert.equal(preview.suggested_mapping.company_id,0);
    const body={file_name:'edited.csv',rows:preview.rows,mapping:preview.suggested_mapping,category_scope_id:category};
    const checked=await imports.check(body,ADMIN);
    const byRow=Object.fromEntries(checked.rows.map(row=>[row.row,row]));
    assert.deepEqual([byRow[2].status,byRow[2].fills],['UPDATE',['city','contact','deal_amount','customer_grade']]);
    assert.deepEqual([byRow[3].status,byRow[3].reasons],['DUPLICATE',['ALREADY_IN_DIRECTORY']],'city already set: nothing to fill');
    assert.deepEqual([byRow[4].status,byRow[4].warnings],['DUPLICATE',['DEAL_WON_NOT_CHANGED']]);
    assert.deepEqual([byRow[5].status,byRow[5].reasons],['ERROR',['COMPANY_ID_UNKNOWN']]);
    assert.equal(byRow[6].status,'OK');
    assert.deepEqual([checked.summary.update,checked.summary.importable],[1,1]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM leadgen.crm_deal_profiles')).rows[0].count),1,'check writes nothing (only the won deal profile exists)');

    const result=await imports.commit(body,'simon',ADMIN);
    assert.deepEqual([result.summary.created,result.summary.updated,result.summary.skipped],[1,1,3]);
    const filled=(await pool.query(`SELECT c.city,d.deal_amount::text,d.deal_currency,d.customer_grade FROM leadgen.companies c
      LEFT JOIN leadgen.crm_deal_profiles d ON d.company_id=c.id AND d.merchant_id IS NULL WHERE c.id=$1`,[alNoor])).rows[0];
    assert.deepEqual(filled,{city:'Sharjah',deal_amount:'12000.00',deal_currency:'USD',customer_grade:'A'});
    assert.equal((await pool.query(`SELECT city FROM leadgen.companies WHERE id=$1`,[gulf])).rows[0].city,'Dubai','never overwritten');
    const emails=(await pool.query(`SELECT contact_value_normalized e FROM leadgen.decision_maker_contacts WHERE company_id=$1 ORDER BY created_at`,[alNoor])).rows.map(row=>row.e);
    assert.deepEqual(emails,['info@alnoor.example','buying@alnoor.example']);
    const note=(await pool.query(`SELECT details->>'source' source,details->'fields' fields FROM leadgen.opportunity_activities WHERE company_id=$1 AND activity_type='NOTE'`,[alNoor])).rows[0];
    assert.deepEqual(note,{source:'IMPORT_FILL',fields:['city','contact','deal_amount','customer_grade']});
    const created=result.results.find(row=>row.status==='CREATED');
    assert.deepEqual(created.fills,['city','deal_amount','customer_grade'],'a new company gets its city, amount and grade too');
    assert.equal((await pool.query(`SELECT deal_amount::text FROM leadgen.crm_deal_profiles WHERE company_id=$1`,[won])).rows[0].deal_amount,null,'won deal untouched');

    // Importing the same sheet again changes nothing more.
    const again=await imports.check(body,ADMIN);
    assert.equal(again.summary.update,0);

    // ---- a merchant exports and fills only its own companies ----
    const merchants=new MerchantService({pool,env:{}});
    const anna=await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin');
    const scope={admin:false,merchantId:anna.merchant.id,restrict:true};
    await merchants.assignCompanies(anna.merchant.id,[gulf],'admin');
    const own=await imports.exportWorkbook(scope);
    assert.deepEqual((await sheetRows(own.buffer)).slice(1).map(row=>row[0]),[gulf]);
    const foreign=await imports.check({rows:[[alNoor,'Al Noor','alnoor.example','','','Ajman']],mapping:{company_id:0,company_name:1,website:2,city:5},category_scope_id:category},scope);
    assert.deepEqual([foreign.rows[0].status,foreign.rows[0].reasons,foreign.rows[0].company_id],['ERROR',['COMPANY_ID_UNKNOWN'],undefined],'another owner\'s company is never revealed');
    const mine=await imports.check({rows:[[gulf,'','','','','','','','','','900','USD','B']],mapping:{company_id:0,deal_amount:10,deal_currency:11,customer_grade:12},category_scope_id:category},scope);
    assert.deepEqual([mine.rows[0].status,mine.rows[0].fills],['UPDATE',['deal_amount','customer_grade']],'the merchant\'s own deal values are empty even though SIM\'s are not');
    await imports.commit({file_name:'mine.csv',rows:[[gulf,'','','','','','','','','','900','USD','B']],mapping:{company_id:0,deal_amount:10,deal_currency:11,customer_grade:12},category_scope_id:category},'anna@alpha.example',scope);
    assert.equal((await pool.query(`SELECT customer_grade FROM leadgen.crm_deal_profiles WHERE company_id=$1 AND merchant_id=$2`,[gulf,anna.merchant.id])).rows[0].customer_grade,'B');
  });
});

test('manual-company stage gate: close date from the quote stage on, customer confirmation for won, saved with the change',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const category=await approveCategory(pool);
    const companies=new ManualCompanyService({pool,env:{}});
    const id=(await companies.create({company_name:'Casa Moda SA',website:'casamoda.example',market_code:'AE',company_type:'IMPORTER',category_scope_id:category},'simon',ADMIN)).company.id;
    await companies.setStage(id,{stage:'CONTACTED'},'simon',ADMIN);
    await assert.rejects(companies.setStage(id,{stage:'QUOTED'},'simon',ADMIN),{code:'CLOSE_DATE_REQUIRED',status:422});
    await assert.rejects(companies.setStage(id,{stage:'QUOTED',expected_close_date:'not a date'},'simon',ADMIN),{code:'CRM_DATE_INVALID'});
    await companies.setStage(id,{stage:'QUOTED',expected_close_date:'2026-12-31'},'simon',ADMIN);
    await companies.setStage(id,{stage:'SAMPLE'},'simon',ADMIN);   // the saved date is enough
    await assert.rejects(companies.setStage(id,{stage:'WON'},'simon',ADMIN),{code:'WON_CONFIRMATION_REQUIRED'});
    await assert.rejects(companies.setStage(id,{stage:'WON',won_confirmation:'OTHER'},'simon',ADMIN),{code:'WON_CONFIRMATION_NOTE_REQUIRED'});
    await assert.rejects(companies.setStage(id,{stage:'WON',won_confirmation:'LETTER'},'simon',ADMIN),{code:'CRM_VALUE_INVALID'});
    assert.equal(await companies.currentStage(pool,id,null),'SAMPLE','a refused change writes nothing');
    await companies.setStage(id,{stage:'WON',won_confirmation:'DEPOSIT'},'simon',ADMIN);
    const deal=(await pool.query(`SELECT expected_close_date::text,won_confirmation,won_confirmed_at IS NOT NULL confirmed FROM leadgen.crm_deal_profiles WHERE company_id=$1`,[id])).rows[0];
    assert.deepEqual(deal,{expected_close_date:'2026-12-31',won_confirmation:'DEPOSIT',confirmed:true});
    const events=(await pool.query(`SELECT changes->>'stage_change' change FROM leadgen.crm_deal_profile_events WHERE company_id=$1 ORDER BY changed_at`,[id])).rows.map(row=>row.change);
    assert.deepEqual(events,['CONTACTED->QUOTED','SAMPLE->WON']);
    const listed=(await companies.get(id,ADMIN)).company;
    assert.deepEqual([listed.stage,listed.deal_close_date,listed.won_confirmation],['WON','2026-12-31','DEPOSIT']);
  });
});
