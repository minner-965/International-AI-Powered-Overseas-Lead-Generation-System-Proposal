import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createResearchBatchRouter} from '../src/research/researchBatchRouter.js';

async function harness(t,{maintenance=false}={}) {
  const calls=[];
  const service={options:async()=>({markets:[],categories:[]}),preview:async body=>({total_scopes:body.scope_count}),
    list:async()=>({items:[]}),get:async id=>({batch_id:id}),
    create:async(body,actor)=>{calls.push({body,actor});return {batch_id:'fixture',idempotent_replay:body.replay===true};}};
  // Only the router's role/maintenance behavior is isolated here; production
  // authentication/CSRF retains its existing independently tested middleware.
  const managementAuth={authenticate:(req,res,next)=>{
    if(!req.get('x-fixture-role'))return res.sendStatus(401);
    req.managementUser={identity:'isolated-test',role:req.get('x-fixture-role')};next();},
    requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.sendStatus(403)};
  const app=express();app.use(express.json());app.use('/api/research/batches',createResearchBatchRouter({service,managementAuth,creationMaintenance:maintenance}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const request=(path='',body=null,role='MANAGEMENT',headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api/research/batches${path}`,{
    method:body?'POST':'GET',headers:{'content-type':'application/json',...(role?{'x-fixture-role':role}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  return {calls,request};
}
test('MC05 router permits registry/preview reads but requires management creation role',async t=>{
  const h=await harness(t);
  assert.equal((await h.request('/options',null,null)).status,401);
  assert.equal((await h.request('/options',null,'SALES')).status,200);
  assert.deepEqual(await(await h.request('/preview',{scope_count:26},'SALES')).json(),{total_scopes:26});
  assert.equal((await h.request('',{idempotency_key:'a'},'SALES')).status,403);
  assert.equal(h.calls.length,0);
});
test('MC05 router returns persisted parent and honors header idempotency key',async t=>{
  const h=await harness(t);
  assert.equal((await h.request('',{idempotency_key:'body'},'DATA_ADMIN',{'idempotency-key':'header'})).status,202);
  assert.equal(h.calls[0].body.idempotency_key,'header');
  assert.equal((await h.request('',{replay:true,idempotency_key:'header'})).status,200);
  assert.equal((await h.request('/fixture')).status,200);
});
test('MC05 creation maintenance blocks writes but retains reads and preview',async t=>{
  const h=await harness(t,{maintenance:true});
  assert.equal((await h.request('',{idempotency_key:'x'})).status,503);
  assert.equal(h.calls.length,0);
  assert.equal((await h.request('/preview',{scope_count:1})).status,200);
});
