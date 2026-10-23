import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {CrmService,countColdOutreachToday} from '../src/crm/service.js';
import {createCrmRouter} from '../src/crm/router.js';
import {Phase7Repository} from '../src/phase7/repository.js';
import {Phase7Service} from '../src/phase7/service.js';

test('follow-up quota uses the same cold-outreach count as the send gate',async()=>{
  const seen=[];
  const pool={query:async sql=>{seen.push(sql);return{rows:[{count:7}]};}};
  assert.equal(await countColdOutreachToday(pool),7);
  const service=new CrmService({pool,repository:{},env:{CRM_FOLLOWUP_DAILY_LIMIT:'10'}});
  assert.deepEqual(await service.followupQuota(),{sent_today:7,daily_limit:10,remaining:3});
  const full=new CrmService({pool:{query:async()=>({rows:[{count:12}]})},repository:{},env:{CRM_FOLLOWUP_DAILY_LIMIT:'10'}});
  assert.equal((await full.followupQuota()).remaining,0);
  assert.match(seen[0],/provider_purpose='COLD_OUTREACH'/);
  const source=(await import('node:fs')).readFileSync(new URL('../src/crm/service.js',import.meta.url),'utf8');
  assert.match(source,/const sentToday=await countColdOutreachToday\(client\)/);
});

test('GET /api/crm/followup-drafts returns items and quota',async()=>{
  const app=express();
  const service={listFollowupDrafts:async()=>[{id:'d1'}],followupQuota:async()=>({sent_today:2,daily_limit:50,remaining:48})};
  const auth={authenticate:(req,_res,next)=>{req.managementUser={identity:'simon',role:'MANAGEMENT'};next();},requireRoles:()=>(_req,_res,next)=>next()};
  app.use('/api/crm',createCrmRouter({service,managementAuth:auth}));
  const server=app.listen(0);await new Promise(r=>server.once('listening',r));
  try{
    const body=await (await fetch(`http://127.0.0.1:${server.address().port}/api/crm/followup-drafts`)).json();
    assert.deepEqual(body,{items:[{id:'d1'}],quota:{sent_today:2,daily_limit:50,remaining:48}});
  }finally{server.close();}
});

test('operations summary exposes first_touch this/last ISO week in the configured time zone',async()=>{
  const calls=[];
  const repo=new Phase7Repository({pool:{query:async(sql,params)=>{calls.push([sql,params]);return{rows:[{this_week:3,last_week:5,week_start:'2026-10-19'}]};}}});
  const weekly=await repo.getFirstTouchWeekly({timezone:'UTC'});
  assert.deepEqual(weekly,{this_week:3,last_week:5,week_start:'2026-10-19',timezone:'UTC',week_basis:'ISO_WEEK_MONDAY'});
  assert.match(calls[0][0],/date_trunc\('week'/);assert.match(calls[0][0],/followup_draft_id IS NULL/);assert.deepEqual(calls[0][1],['UTC']);
  const service=Object.create(Phase7Service.prototype);
  service.env={};service.opportunityQuery=null;
  service.repository={getOutreachOperationsSummary:async()=>({prospect:{smtp_accepted:9},controlled:{}}),getOutreachMonitoring:async()=>({}),
    getFirstTouchWeekly:async({timezone})=>({this_week:1,last_week:2,timezone})};
  const summary=await service.getOutreachOperationsSummary();
  assert.deepEqual(summary.first_touch,{this_week:1,last_week:2,timezone:'Asia/Shanghai'});
  assert.equal(summary.prospect.smtp_accepted,9);
});
