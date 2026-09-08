import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Repository} from '../src/phase7/repository.js';
import {ResearchWorkbenchService} from '../src/research/ResearchWorkbenchService.js';
import {verifyCleanupOptionalCatalogMigration} from '../src/phase7/migrationRunner.js';

test('retired manual routes never return active queue rows; history remains readable',async()=>{
  let calls=0;
  const repository=new Phase7Repository({pool:{query:async()=>{calls++;return{rows:[{id:'historical'}]};}}});
  for(const status of ['ACTIVE','READY','IN_PROGRESS'])assert.deepEqual(await repository.listManualOfficialRoutes({status}),[]);
  assert.equal(calls,0);
  assert.deepEqual(await repository.listManualOfficialRoutes({status:'COMPLETED'}),[{id:'historical'}]);
  assert.equal(calls,1);
});

for(const snapshot of [null,'existing-snapshot'])test(`cohort preserves optional catalog context: ${snapshot}`,async()=>{
  let insert;
  const client={release(){},async query(sql,params){
    if(sql.includes('SELECT id FROM leadgen.product_profile_catalog_snapshots'))return{rowCount:snapshot?1:0,rows:snapshot?[{id:snapshot}]:[]};
    if(sql.includes('SELECT c.verification_status'))return{rowCount:1,rows:[{verification_status:'VERIFIED',lifecycle_status:'ACTIVE',relationship_status:'NEW_PROSPECT'}]};
    if(sql.includes('INSERT INTO leadgen.research_job_cohort_items')){insert=params;return{rows:[{id:'cohort'}]};}
    return{rows:[]};
  }};
  const service=new ResearchWorkbenchService({pool:{connect:async()=>client}});
  await service.freezeCohort({jobId:'job',wave:'A',items:[{company_id:'company',product_profile:'WOMENSWEAR',market:'AE'}]});
  assert.equal(insert[3],snapshot);
});

test('migration verifier rejects a still-required catalog snapshot',async()=>{
  await assert.rejects(verifyCleanupOptionalCatalogMigration({query:async()=>({rows:[{is_nullable:'NO'}]})}));
  assert.deepEqual(await verifyCleanupOptionalCatalogMigration({query:async()=>({rows:[{is_nullable:'YES'}]})}),{catalog_snapshot:'OPTIONAL_AUDIT_CONTEXT'});
});
