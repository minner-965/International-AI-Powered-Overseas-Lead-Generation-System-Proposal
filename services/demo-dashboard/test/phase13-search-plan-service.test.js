import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchPlanService} from '../src/searchPlanning/SearchPlanService.js';
const snapshot={version:1,scopes:[{market_code:'MX',country_name:'Mexico',category_scope_id:'scope-1',category_code:'DRESSES',
  languages:['es','en'],buyer_types:['Importer','Wholesaler','Department Store'],product_profile:'WOMENSWEAR'}]};
test('search plan preview is bounded, read-only and explicitly planned',()=>{
  const service=new SearchPlanService({pool:{query(){throw Error('Preview must not write or read the database');}}});
  const result=service.preview(snapshot);
  assert.equal(result.status,'PLANNED');assert.equal(result.persisted,false);assert.equal(result.queries,undefined);
  assert.deepEqual(result.summary.languages,['en','es']);assert.ok(result.summary.planned_query_count>0);
  for(const samples of Object.values(result.samples))assert.ok(samples.length<=5);
});
test('saved batch plan survives later config and registry changes without regeneration',async()=>{
  const service=new SearchPlanService({pool:{async query(){return {rowCount:1,rows:[{plan:{status:'PLANNED',strategy_version:'frozen',queries:[1],summary:{planned_query_count:7}}}]};}}});
  service.plan=()=>{throw Error('Saved plan must not regenerate');};
  const result=await service.forBatch({id:'batch',research_scope_snapshot:{}});
  assert.equal(result.strategy_version,'frozen');assert.equal(result.persisted,true);assert.equal(result.summary.planned_query_count,7);
});
test('freezing a batch persists only new child plans, not reused child overrides',async()=>{
  const service=new SearchPlanService({pool:{}}),calls=[];
  service.store=async(_client,args)=>calls.push(args);
  await service.freezeBatch({},'batch',snapshot,[{scope:snapshot.scopes[0],child:{id:'new',inserted:true}},
    {scope:{...snapshot.scopes[0],languages:['ar']},child:{id:'reused',inserted:false}}]);
  assert.equal(calls.length,2);assert.equal(calls[1].jobId,'new');assert.deepEqual(calls[1].snapshot.scopes,snapshot.scopes);
});
