import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {
  companyDirectoryAdmittedSql,
  evaluatedCategoryProfilesSql,
  confirmedCategoryStatusSql
} from '../src/categoryProcurement/categoryAdmission.js';
import {queryCategoryProcurementOpportunities} from '../src/categoryProcurement/opportunitiesRoute.js';

test('formal company directory admission is based on verified active company identity',()=>{
  const admission=companyDirectoryAdmittedSql('c');
  assert.match(admission,/c\.verification_status='VERIFIED'/);
  assert.match(admission,/c\.lifecycle_status='ACTIVE'/);
  assert.match(admission,/c\.explicit_exclusion_reason IS NULL/);
  assert.doesNotMatch(admission,/CATEGORY_MATCH|PRODUCT_EVIDENCE/);
  const profiles=evaluatedCategoryProfilesSql('c');
  assert.match(profiles,/SELECT DISTINCT admitted_category\.product_profile/);
  assert.match(profiles,/NOT EXISTS[\s\S]*newer_category/);
  assert.doesNotMatch(profiles,/CATEGORY_MATCH_CONFIRMED|NEEDS_PRODUCT_EVIDENCE/);
  assert.match(confirmedCategoryStatusSql('result.match_status'),/^result\.match_status IN/);
});

test('Companies and company export expose verified records with every evaluated category profile',async()=>{
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  assert.ok((server.match(/companyDirectoryAdmittedSql\('c'\)/g)||[]).length>=4);
  assert.ok((server.match(/evaluatedCategoryProfilesSql\('c'\)/g)||[]).length>=3);
  assert.doesNotMatch(server,/companyCategoryAdmittedSql|confirmedCategoryProfilesSql/);
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
  assert.match(sql,/coalesce\(routes\.route_types,'\{\}'::text\[\]\)&&ARRAY\['BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL','BUSINESS_PHONE','BUSINESS_WHATSAPP','CONTACT_FORM'\]::text\[\]/);
  assert.doesNotMatch(sql,/ARRAY\[[^\]]*SUPPLIER_PORTAL[^\]]*\]::text\[\]/);
  assert.match(sql,/bod\.display_opportunity_status IN\('RECOMMENDED','MANAGEMENT_APPROVED','HOLD'\)/);
  assert.doesNotMatch(sql,/bod\.display_opportunity_status IN\([^)]*EVIDENCE_REQUIRED/);
});
