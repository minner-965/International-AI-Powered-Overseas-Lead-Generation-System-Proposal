import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {deriveOpportunityDecision} from '../src/phase7/opportunityDecision.js';
import {Phase7Repository} from '../src/phase7/repository.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const legacyCategory={match_status:'CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE',calculation_version:'category-procurement-match-v2',
  scope_revision_id:'11111111-1111-4111-8111-111111111111',match_basis:'EXACT_CATEGORY'};
const base={company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},category:legacyCategory,
  relationship_status:'NEW_PROSPECT'};

test('B03 historical buying-evidence status plus an ordinary official route reprojects to RECOMMENDED',()=>{
  const result=deriveOpportunityDecision({...base,active_company_contact_route_count:1,company_contact_route_types:['CONTACT_FORM']});
  assert.equal(result.system_recommendation_status,'RECOMMENDED');
  assert.equal(result.reason_codes.includes('BUYING_EVIDENCE_REQUIRED'),false);
  assert.equal(result.reason_codes.includes('PROCUREMENT_EVIDENCE_REQUIRED'),false);
});

test('B03 category match without a contact route reprojects only to CONTACT_ROUTE_REQUIRED',()=>{
  const result=deriveOpportunityDecision({...base,active_company_contact_route_count:0,company_contact_route_types:[]});
  assert.equal(result.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.ok(result.reason_codes.includes('CONTACT_ROUTE_REQUIRED'));
  assert.ok(!result.reason_codes.includes('CATEGORY_CONFIRMATION_REQUIRED'));
});

test('B03 an unconfirmed category remains CATEGORY_CONFIRMATION_REQUIRED even when contact exists',()=>{
  const result=deriveOpportunityDecision({...base,category:{match_status:'NEEDS_PRODUCT_EVIDENCE'},
    active_company_contact_route_count:1,company_contact_route_types:['BUSINESS_PHONE']});
  assert.equal(result.system_recommendation_status,'EVIDENCE_REQUIRED');
  assert.ok(result.reason_codes.includes('CATEGORY_CONFIRMATION_REQUIRED'));
});

test('B04 active source creates no manual procurement-route task',()=>{
  const sourceRoots=['services/demo-dashboard/src/autoEvidence','services/demo-dashboard/src/research'];
  const source=sourceRoots.flatMap(folder=>fs.readdirSync(path.join(root,folder),{recursive:true})
    .filter(name=>String(name).endsWith('.js')).map(name=>fs.readFileSync(path.join(root,folder,String(name)),'utf8'))).join('\n');
  assert.doesNotMatch(source,/task_type\s*[:=][^\n]*(?:BUYING_EVIDENCE_REQUIRED|PROCUREMENT_EVIDENCE_REQUIRED|SUPPLIER_ACCESS_REQUIRED|MANUAL_OFFICIAL_ROUTE_READY)/);
});

test('B05 Contact Queue groups by company and aggregates distinct categories and canonical routes',async()=>{
  let sql='';
  const repository=new Phase7Repository({pool:{query:async statement=>{sql=String(statement);return{rows:[],rowCount:0};}}});
  assert.deepEqual(await repository.listContactQueue(),[]);
  assert.match(sql,/GROUP BY o\.company_id/);
  assert.match(sql,/array_agg\(DISTINCT o\.product_profile/);
  assert.match(sql,/count\(DISTINCT \(dc\.contact_type,lower\(btrim\(dc\.contact_value_normalized\)\)\)\)/);
  assert.match(sql,/concat_ws\('\|',c\.id::text,dc\.contact_type,lower\(btrim\(dc\.contact_value_normalized\)\)\)/);
  assert.doesNotMatch(sql,/SUPPLIER_PORTAL|VENDOR_REGISTRATION/);
});

test('B05 replay implementation locks and refreshes a company-level canonical route',()=>{
  const source=fs.readFileSync(path.join(root,'services/demo-dashboard/src/enrichment/EnrichmentService.js'),'utf8');
  const body=source.slice(source.indexOf('async upsertContact'),source.indexOf('async persistHunterContactCheckpoint'));
  assert.match(body,/pg_advisory_xact_lock/);
  assert.match(body,/dm\.company_id=\(SELECT company_id FROM target\)/);
  assert.match(body,/lower\(btrim\(dc\.contact_value_normalized\)\)=lower\(btrim\(\$3\)\)/);
  assert.match(body,/UPDATE leadgen\.decision_maker_contacts SET[\s\S]*last_verified_at=\$11/);
});
