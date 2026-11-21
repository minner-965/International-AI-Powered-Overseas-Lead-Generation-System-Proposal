// Spreadsheet import of companies (migration 080) against a throwaway PostgreSQL database built from
// every migration. Rows go through the same create rules as adding one company by hand.
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
import {COMPANY_IMPORT_RUNS_MIGRATION_KEY,verifyCompanyImportRunsMigration} from '../src/phase7/migrationRunner.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const ADMIN=Object.freeze({admin:true,merchantId:null,restrict:false});

async function withDatabase(run){
  const name=`company_import_it_${crypto.randomBytes(4).toString('hex')}`;
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

test('migration 080 is the latest file and verifies; import history is append-only',{skip:!adminUrl},async()=>{
  const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
  assert.equal(files.at(-1),COMPANY_IMPORT_RUNS_MIGRATION_KEY);
  await withDatabase(async pool=>{
    assert.deepEqual(await verifyCompanyImportRunsMigration(pool),{company_import_runs:true});
    const run=(await pool.query(`INSERT INTO leadgen.company_import_runs(file_name,row_count,created_count,skipped_count,failed_count,mapping,results,created_by)
      VALUES('a.csv',0,0,0,0,'{}','[]','t') RETURNING id`)).rows[0];
    await assert.rejects(pool.query('DELETE FROM leadgen.company_import_runs WHERE id=$1',[run.id]),/COMPANY_IMPORT_APPEND_ONLY/);
  });
});

test('check sorts rows into importable, duplicate and error; import creates companies for the owner and records the run',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const category=await approveCategory(pool);
    const companies=new ManualCompanyService({pool,env:{}});
    const imports=new CompanyImportService({pool,companies});
    // Already in the directory before the import.
    await companies.create({company_name:'Listed Co',website:'listed.example',market_code:'AE',company_type:'IMPORTER',category_scope_id:category},'simon',ADMIN);
    const csv=['公司名称,官网,国家,类型,邮箱,联系人,备注',
      'Al Noor Fashion LLC,https://www.alnoor.example,阿联酋,进口商,buying@alnoor.example,Omar,Met at the fair',
      'Casa Moda SA,casamoda.example,MX,零售商,info@gmail.example,,',
      'Repeat Name,alnoor.example,AE,Importer,,,',
      'Listed Again,listed.example,AE,Importer,,,',
      ',broken,AE,Importer,,,',
      'No Market,nomarket.example,Peru,Importer,,,',
      'Default Type,defaulttype.example,AE,,,,'].join('\n');
    const preview=await imports.preview({file_name:'展会客户.csv',content_base64:Buffer.from(csv).toString('base64')},ADMIN);
    assert.equal(preview.row_count,7);
    assert.deepEqual(preview.suggested_mapping,{company_name:0,website:1,market:2,company_type:3,contact_email:4,contact_name:5,notes:6});
    const body={file_name:preview.file_name,rows:preview.rows,mapping:preview.suggested_mapping,category_scope_id:category,default_company_type:'WHOLESALER'};
    await assert.rejects(imports.check({...body,category_scope_id:'00000000-0000-4000-8000-000000000000'},ADMIN),{code:'IMPORT_CATEGORY_REQUIRED'});
    const checked=await imports.check(body,ADMIN);
    const status=Object.fromEntries(checked.rows.map(row=>[row.row,[row.status,...row.reasons,...row.warnings]]));
    assert.deepEqual(status,{2:['OK'],3:['WARNING','CONTACT_NOT_ON_COMPANY_DOMAIN'],4:['DUPLICATE','DUPLICATE_IN_FILE'],5:['DUPLICATE','ALREADY_IN_DIRECTORY'],
      6:['ERROR','COMPANY_NAME_MISSING','WEBSITE_INVALID'],7:['ERROR','MARKET_NOT_ACTIVE'],8:['OK']});
    assert.deepEqual(checked.summary,{total:7,ok:2,warning:1,duplicate:2,error:2,importable:3});
    assert.equal(Number((await pool.query(`SELECT count(*) FROM leadgen.companies WHERE data_origin='manual'`)).rows[0].count),1,'check writes nothing');

    const result=await imports.commit(body,'simon',ADMIN);
    assert.deepEqual(result.summary,{total:7,created:3,skipped:4,failed:0});
    const created=(await pool.query(`SELECT c.company_name,c.normalized_domain,c.country_code,e.company_type,e.notes FROM leadgen.companies c
      JOIN leadgen.manual_company_entries e ON e.company_id=c.id WHERE c.company_name<>'Listed Co' ORDER BY c.company_name`)).rows;
    assert.deepEqual(created.map(row=>[row.company_name,row.normalized_domain,row.country_code,row.company_type]),
      [['Al Noor Fashion LLC','alnoor.example','AE','IMPORTER'],['Casa Moda SA','casamoda.example','MX','RETAILER'],['Default Type','defaulttype.example','AE','WHOLESALER']]);
    assert.equal(created[0].notes,'Met at the fair');
    const contacts=(await pool.query(`SELECT contact_value_normalized FROM leadgen.decision_maker_contacts ORDER BY 1`)).rows.map(row=>row.contact_value_normalized);
    assert.deepEqual(contacts,['buying@alnoor.example'],'the off-domain address was left out');
    const runs=(await imports.runs(ADMIN)).items;
    assert.deepEqual([runs.length,runs[0].file_name,runs[0].created_count,runs[0].skipped_count],[1,'展会客户.csv',3,4]);
    // Importing the same file again creates nothing new.
    assert.equal((await imports.commit(body,'simon',ADMIN)).summary.created,0);

    // ---- a merchant imports for itself and sees only its own runs ----
    const merchants=new MerchantService({pool,env:{}});
    const anna=await merchants.createMerchant({company_name:'Alpha Textiles',contact_name:'Anna',login_email:'anna@alpha.example'},'admin');
    const scope={admin:false,merchantId:anna.merchant.id,restrict:true};
    const own=await imports.commit({file_name:'mine.csv',rows:[['Gulf Home LLC','gulfhome.example','AE','Retail chain']],
      mapping:{company_name:0,website:1,market:2,company_type:3},category_scope_id:category},'anna@alpha.example',scope);
    assert.equal(own.summary.created,1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leadgen.merchant_companies mc JOIN leadgen.companies c ON c.id=mc.company_id
      WHERE mc.merchant_id=$1 AND c.normalized_domain='gulfhome.example'`,[anna.merchant.id])).rows[0].n,1);
    assert.deepEqual((await imports.runs(scope)).items.map(run=>run.file_name),['mine.csv']);
    // A merchant learns that a company exists, never which owner holds it.
    const again=await imports.check({rows:[['Someone','listed.example','AE','Importer']],mapping:{company_name:0,website:1,market:2,company_type:3},category_scope_id:category},scope);
    assert.deepEqual(again.rows[0].reasons,['ALREADY_IN_DIRECTORY']);assert.equal(again.rows[0].company_id,undefined);
    // Same name and country under another website: still importable, with a note to check.
    const similar=await imports.check({rows:[['LISTED CO. LLC','listed-new.example','AE','Importer'],['Listed Co','listed-mx.example','MX','Importer']],
      mapping:{company_name:0,website:1,market:2,company_type:3},category_scope_id:category},scope);
    assert.deepEqual(similar.rows.map(row=>[row.status,...row.warnings]),[['WARNING','SIMILAR_NAME_IN_DIRECTORY'],['OK']]);
  });
});
