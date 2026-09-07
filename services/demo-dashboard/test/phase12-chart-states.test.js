import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteCount, marketSeries, lazyChart } from '../public/ui/v3/charts.js';
import { overviewModel, marketDonut } from '../public/ui/v3/overview.js';

test('missing counters are not coerced to zero',()=>{
  for(const value of [null,undefined,'',NaN,-1])assert.equal(finiteCount(value),null);
  assert.equal(finiteCount(0),0);
  const model=overviewModel({opportunities:null,getStatus:()=>''});
  assert.equal(model.marketTotal,null);
  assert.match(marketDonut([],null),/unavailable/);
});
test('empty is distinct from malformed and partial market data',()=>{
  assert.equal(marketSeries([],0).state,'empty');
  assert.equal(marketSeries([['AE',1]],2).state,'error');
  assert.equal(marketSeries([['AE',null]],0).state,'error');
  assert.equal(marketSeries([['AE',2]],2).rows[0].share,100);
});
test('chart geometry waits for visibility and disconnects observer',()=>{
  let callback,rendered=0,disconnected=0;
  class Observer {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected++;}}
  lazyChart({},()=>rendered++,Observer);
  assert.equal(rendered,0);callback([{isIntersecting:false}]);assert.equal(rendered,0);
  callback([{isIntersecting:true}]);assert.equal(rendered,1);assert.equal(disconnected,1);
});
test('native text chart fallback works without observer support',()=>{
  let rendered=false;lazyChart({},()=>{rendered=true;},null);assert.equal(rendered,true);
  assert.match(marketDonut([['AE',1]],1),/1 · 100%/);
});
test('partial pending projection remains unknown',()=>{
  const result=overviewModel({opportunities:[],getStatus:()=>'',operations:{prospect:{pending_management:null,pending_drafts:0,pending_contacts:0,pending_followups:0},monitoring:{alerts:[]}}});
  assert.equal(result.pending,null);
});
