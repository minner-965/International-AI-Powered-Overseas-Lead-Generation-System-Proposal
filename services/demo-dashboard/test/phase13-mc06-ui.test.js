import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchPlanViewModel} from '../public/ui/v3/research-batch.js';
test('MC06 Search Plan preserves actual planned values and never derives executed counts',()=>{
 const model=searchPlanViewModel({status:'EXECUTED',strategy_version:'v2',summary:{scopes:26,precision_strategies:7,coverage_strategies:8,languages:['en','es'],planned_query_count:120,precision_planned:60,coverage_planned:60}});
 assert.equal(model.status,'PLANNED');assert.equal(model.planned,120);assert.equal(model.precision,60);assert.equal(model.scopes,26);assert.deepEqual(model.languages,['en','es']);assert.equal(model.version,'v2');
});
test('MC06 Search Plan limits examples to five per lane and distinguishes missing data from zero',()=>{
 const queries=Array.from({length:99},(_,index)=>({normalized_query:`query ${index}`,language:'en'}));const model=searchPlanViewModel({samples:{PRECISION_LANE:queries,COVERAGE_LANE:queries},summary:{precision_planned:0}});
 assert.equal(model.samples[0].queries.length,5);assert.equal(model.samples[1].queries.length,5);assert.equal(model.precision,0);assert.equal(model.coverage,null);assert.equal(model.planned,null);
});
test('MC06 UI adds read-only progressive disclosure without provider endpoints or new mutations',async()=>{
 const source=await readFile(new URL('../public/ui/v3/research-batch.js',import.meta.url),'utf8');
 assert.match(source,/View sample queries/);assert.match(source,/data-search-plan-retry/);assert.match(source,/batch-search-plan/);assert.match(source,/api\.esc\(query.normalized_query/);
 assert.doesNotMatch(source,/api\.brave|api\.tavily|api\.hunter|\/api\/outreach\/send/);
});
