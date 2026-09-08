import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createPhase7Router} from '../src/phase7/router.js';
import {Phase7Service} from '../src/phase7/service.js';
import {Phase7Repository} from '../src/phase7/repository.js';

async function fixture(t,role='MANAGEMENT'){
  const effects={sql:0,queued:0};
  const service=Object.create(Phase7Service.prototype);
  service.repository=new Phase7Repository({pool:{query:async()=>{effects.sql++;throw new Error('Unexpected SQL');}}});
  const app=express();app.use(express.json());
  app.use(createPhase7Router({service,queue:{enqueue:async()=>{effects.queued++;throw new Error('Unexpected enqueue');}},
    env:{DPV_WORKSPACE_ACTOR:'cl09.fixture',DPV_WORKSPACE_ROLE:role}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {service,effects,request:(path,method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{
    method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})};
}

test('CL09 retired manual writes return 410 through HTTP and create no DB or queue effects',async t=>{
  const {request,effects}=await fixture(t);
  for(const path of ['/api/manual-official-routes/reconcile','/api/manual-official-routes/11111111-1111-4111-8111-111111111111/actions']){
    const response=await request(path,'POST',{status:'IN_PROGRESS'});
    assert.equal(response.status,410);assert.equal((await response.json()).code,'RETIRED_POLICY');
  }
  assert.deepEqual(effects,{sql:0,queued:0});
});

test('CL09 retired write routes retain role protection before service execution',async t=>{
  const {request,effects}=await fixture(t,'SALES');
  const response=await request('/api/manual-official-routes/reconcile','POST',{});
  assert.equal(response.status,403);assert.deepEqual(effects,{sql:0,queued:0});
});

test('CL09 current draft lookup retains success and not-found HTTP contracts',async t=>{
  const {request,service,effects}=await fixture(t);
  service.repository.getDraft=async id=>id==='present'?{id,status:'APPROVED'}:null;
  const found=await request('/api/outreach/drafts/present');assert.equal(found.status,200);
  assert.deepEqual(await found.json(),{id:'present',status:'APPROVED'});
  const missing=await request('/api/outreach/drafts/missing');assert.equal(missing.status,404);
  assert.equal((await missing.json()).code,'OUTREACH_DRAFT_NOT_FOUND');
  assert.deepEqual(effects,{sql:0,queued:0});
});
