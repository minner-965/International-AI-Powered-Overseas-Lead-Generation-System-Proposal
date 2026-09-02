import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const readJson=relative=>{
  const target=path.join(root,relative);
  assert.equal(fs.existsSync(target),true,`missing ${relative}`);
  return JSON.parse(fs.readFileSync(target,'utf8'));
};

test('V3 product taxonomy remains versioned, bilingual and profile/category/subcategory controlled',()=>{
  const taxonomy=readJson('rules/product-taxonomy/v1/taxonomy.json');
  const aliases=readJson('rules/product-taxonomy/v1/aliases.json');
  const metadata=readJson('rules/product-taxonomy/v1/metadata.json');
  const serialized=JSON.stringify({taxonomy,aliases,metadata});
  assert.match(serialized,/WOMENSWEAR/);
  assert.match(serialized,/GENERAL_MERCHANDISE/);
  assert.match(serialized,/taxonomy[_-]?version/i);
  assert.match(serialized,/English|\ben\b/i);
  assert.match(serialized,/Spanish|\bes\b/i);
  assert.match(serialized,/Chinese|\bzh\b/i);
  for(const status of ['CONFIRMED','SUPPORTED','REVIEW','UNKNOWN']) assert.match(serialized,new RegExp(status));
});

test('Buyer Business Model V3 rules include direct, distribution, unclear and exclusion evidence gates',()=>{
  const decision=readJson('rules/buyer-business-model/v1/decision.json');
  const metadata=readJson('rules/buyer-business-model/v1/metadata.json');
  const implementation=fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/buyerBusinessModel.js'),'utf8');
  const serialized=`${JSON.stringify({decision,metadata})}\n${implementation}`;
  for(const model of ['DIRECT_END_BUYER','DISTRIBUTION_BUYER','UNCLEAR_INTERMEDIARY','EXCLUDED_INTERMEDIARY','UNKNOWN']) assert.match(serialized,new RegExp(model));
  for(const evidence of ['IMPORT_ACTIVITY','WAREHOUSE_INVENTORY','DISTRIBUTION_NETWORK','INTERMEDIARY_EXCLUSION']) assert.match(serialized,new RegExp(evidence));
});

test('Category Procurement Match V3 rules freeze five weights and 70/60 publication gates',()=>{
  const decision=readJson('rules/category-procurement-match/v1/decision.json');
  const metadata=readJson('rules/category-procurement-match/v1/metadata.json');
  const serialized=JSON.stringify({decision,metadata});
  for(const weight of [45,25,15,10,5]) assert.match(serialized,new RegExp(`[:\\[]${weight}(?:[,}\\]])`));
  assert.match(serialized,/coverage/i);
  assert.match(serialized,/70/);
  assert.match(serialized,/score/i);
  assert.match(serialized,/60/);
  for(const status of ['CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE','INELIGIBLE_BUYER_MODEL']) assert.match(serialized,new RegExp(status));
});

test('legacy Cooperation V3 rule remains preserved for historical audit',()=>{
  const decision=readJson('rules/cooperation-feasibility/v3/decision.json');
  const metadata=readJson('rules/cooperation-feasibility/v3/metadata.json');
  const serialized=JSON.stringify({decision,metadata});
  for(const axis of ['external_supplier_openness','supplier_onboarding_accessibility','buying_procurement_accessibility','commercial_operational_feasibility','supplier_lock_in_barrier']) assert.match(serialized,new RegExp(axis,'i'));
  for(const matrixPart of ['DIRECT_BUYER','DISTRIBUTION_BUYER','HIGH_PRODUCT_','HIGH_ACCESS','UNKNOWN_PRODUCT','INELIGIBLE_BUYER_MODEL']) assert.match(serialized,new RegExp(matrixPart));
  const precedence=['SUPPRESSED','EXISTING_CUSTOMER','INELIGIBLE_BUYER_MODEL','HISTORICAL_REVIEW','NEEDS_INTERNAL_CATALOG_EVIDENCE','NEEDS_PRODUCT_EVIDENCE','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','PRODUCT_MISMATCH','WEAK_CATEGORY_MATCH','NEEDS_DECISION_MAKER','NEEDS_CONTACT_ROUTE','NEEDS_VERIFICATION'];
  const orderSource=serialized.slice(serialized.lastIndexOf("const order="));
  const positions=precedence.map(value=>orderSource.indexOf(value));
  assert.equal(positions.every(position=>position>=0),true);
  for(let index=1;index<positions.length;index+=1) assert.ok(positions[index]>positions[index-1],`${precedence[index]} is out of order`);
  assert.match(serialized,/SALES_READY/);
});

test('current Cooperation V4 rule is approved-category-only and creates no catalog or SKU gate',()=>{
  const metadata=readJson('rules/cooperation-feasibility/v4/metadata.json');
  const implementation=fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/cooperationV3.js'),'utf8');
  assert.equal(metadata.opportunity_gate,'APPROVED_CATEGORY_SCOPE_ONLY');
  assert.equal(metadata.exact_sku_required,false);
  assert.equal(metadata.catalog_maintenance_task_allowed,false);
  assert.match(implementation,/rawStatus==='NEEDS_INTERNAL_CATALOG_EVIDENCE'\?'CATEGORY_PROCUREMENT_MATCH'/);
  assert.doesNotMatch(implementation,/blockers\.push\('NEEDS_PRODUCT_RECOMMENDATION'\)/);
  const currentOrder=implementation.slice(implementation.lastIndexOf("const order="));
  assert.doesNotMatch(currentOrder,/NEEDS_INTERNAL_CATALOG_EVIDENCE|NEEDS_PRODUCT_RECOMMENDATION/);
});
