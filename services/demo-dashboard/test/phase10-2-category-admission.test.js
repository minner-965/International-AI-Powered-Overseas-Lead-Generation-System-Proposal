import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {
  companyCategoryAdmittedSql,
  confirmedCategoryProfilesSql,
  confirmedCategoryStatusSql
} from '../src/categoryProcurement/categoryAdmission.js';
import {queryCategoryProcurementOpportunities} from '../src/categoryProcurement/opportunitiesRoute.js';

test('formal company admission requires the latest category result to be confirmed',()=>{
  const admission=companyCategoryAdmittedSql('c');
  assert.match(admission,/CATEGORY_MATCH_CONFIRMED/);
  assert.match(admission,/CATEGORY_PROCUREMENT_MATCH/);
  assert.match(admission,/CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE/);
  assert.match(admission,/NOT EXISTS[\s\S]*newer_category/);
  assert.doesNotMatch(admission,/CATEGORY_CONFIRMATION_REQUIRED|NEEDS_PRODUCT_EVIDENCE/);
  assert.match(confirmedCategoryProfilesSql('c'),/SELECT DISTINCT admitted_category\.product_profile/);
  assert.match(confirmedCategoryStatusSql('result.match_status'),/^result\.match_status IN/);
});

test('Companies and company export expose only category-admitted records and confirmed profiles',async()=>{
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  assert.ok((server.match(/companyCategoryAdmittedSql\('c'\)/g)||[]).length>=4);
  assert.ok((server.match(/confirmedCategoryProfilesSql\('c'\)/g)||[]).length>=3);
  const companyList=server.slice(server.indexOf("app.get('/api/leads'"),server.indexOf("app.get('/api/export/leads'"));
  assert.match(companyList,/LEFT JOIN leadgen\.lead_reviews r ON r\.company_id = c\.id/);
  assert.doesNotMatch(companyList,/FROM leadgen\.companies c JOIN leadgen\.lead_reviews/);
});

test('Opportunities contain only category-confirmed contact-ready business records',async()=>{
  let sql='';
  const pool={query:async statement=>{sql=String(statement);return{rows:[]};}};
  await queryCategoryProcurementOpportunities({
    pool,query:{status:'ALL'},publicDataOriginSql:"'PUBLIC_RESEARCH'",
    companyMarketVisibleSql:()=> 'TRUE',excludesConfirmedExistingCustomerSql:()=> 'TRUE'
  });
  assert.match(sql,/cpm\.match_status IN\('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'\)/);
  assert.match(sql,/bod\.display_opportunity_status IN\('RECOMMENDED','MANAGEMENT_APPROVED','HOLD'\)/);
  assert.doesNotMatch(sql,/bod\.display_opportunity_status IN\([^)]*EVIDENCE_REQUIRED/);
});
