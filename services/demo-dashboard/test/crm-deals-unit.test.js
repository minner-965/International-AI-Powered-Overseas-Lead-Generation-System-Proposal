// Deal values, grade, health, key customers and stage reasons (migration 079). No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {customerHealth,keyCustomerFlags,stageChangeNeedsReason,STAGE_WIN_PROBABILITY,DEFAULT_REMINDER_RULES} from '../src/crm/deals.js';
import {CrmService} from '../src/crm/service.js';

const now=new Date('2026-11-21T10:00:00Z');
const daysAgo=n=>new Date(now.getTime()-n*86_400_000).toISOString();

test('a reason is needed to lose a deal, move it back, or reopen it; moving forward needs none',()=>{
  assert.equal(stageChangeNeedsReason('CONTACTED','QUOTED'),false);
  assert.equal(stageChangeNeedsReason('QUOTED','LOST'),true);
  assert.equal(stageChangeNeedsReason('SAMPLE','REPLIED'),true);
  assert.equal(stageChangeNeedsReason('WON','NEGOTIATING'),true);
  assert.equal(stageChangeNeedsReason('LOST','CONTACTED'),true);
  assert.equal(stageChangeNeedsReason('QUOTED','QUOTED'),false);
  assert.equal(stageChangeNeedsReason(null,'QUOTED'),false);
});

test('win probability defaults follow the stage',()=>{
  assert.deepEqual([STAGE_WIN_PROBABILITY.QUOTED,STAGE_WIN_PROBABILITY.SAMPLE,STAGE_WIN_PROBABILITY.NEGOTIATING,STAGE_WIN_PROBABILITY.WON,STAGE_WIN_PROBABILITY.LOST],[40,60,75,100,0]);
});

test('health: profile, timely follow-up, a moving deal and a customer answer each count',()=>{
  const strong=customerHealth({website_url:'https://a.example',country_code:'AE',has_email:true,last_touch_at:daysAgo(2),pipeline_stage:'NEGOTIATING',last_inbound_at:daysAgo(3)},now);
  assert.deepEqual([strong.score,strong.level],[100,'GOOD']);
  const weak=customerHealth({pipeline_stage:'CONTACTED',last_touch_at:daysAgo(40),overdue:true},now);
  assert.deepEqual(weak.parts,{profile:0,timely:0,moving:10,answered:0});assert.equal(weak.level,'POOR');
  const middling=customerHealth({country_code:'MX',has_email:true,last_touch_at:daysAgo(10),pipeline_stage:'REPLIED',activity_count:2},now);
  assert.equal(middling.score,5+12+20+15+8);assert.equal(middling.level,'FAIR');
  assert.equal(customerHealth({pipeline_stage:'QUOTED',last_touch_at:daysAgo(3),overdue:true},now).parts.timely,25);
});

test('key customers: interested, gone quiet, quote or samples unanswered',()=>{
  const rules=DEFAULT_REMINDER_RULES;
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'CONTACTED',last_touch_at:daysAgo(8)},rules,now),['NO_FOLLOW_UP']);
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'CONTACTED',last_touch_at:daysAgo(7)},rules,now),[]);
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'QUOTED',stage_changed_at:daysAgo(4),last_touch_at:daysAgo(4)},rules,now),['HIGH_INTENT','QUOTED_NO_REPLY']);
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'QUOTED',stage_changed_at:daysAgo(4),last_touch_at:daysAgo(1),last_inbound_at:daysAgo(1)},rules,now),['HIGH_INTENT'],'they answered after the quote');
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'SAMPLE',stage_changed_at:daysAgo(9),last_touch_at:daysAgo(9)},rules,now),['HIGH_INTENT','NO_FOLLOW_UP','SAMPLE_NO_CONFIRM']);
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'NEW',customer_grade:'A'},rules,now),['HIGH_INTENT']);
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'WON',last_touch_at:daysAgo(60)},rules,now),[],'closed deals are not chased');
  assert.deepEqual(keyCustomerFlags({pipeline_stage:'QUOTED',stage_changed_at:daysAgo(2),last_touch_at:daysAgo(2)},{...rules,quoted_no_reply_days:1},now),['HIGH_INTENT','QUOTED_NO_REPLY']);
});

test('tasks accept a priority and can be listed by it',async()=>{
  const calls=[];
  const service=new CrmService({pool:{},repository:{async createTask(input){calls.push(['create',input]);return input;},async listTasks(input){calls.push(['list',input]);return{items:[]};},
    async updateTask(id,input){calls.push(['update',input]);return input;}}});
  const user={identity:'anna@alpha.example'};
  await service.createTask({company_id:'11111111-1111-4111-8111-111111111111',task_type:'FOLLOW_UP',title:'Call',priority:'high'},user);
  await service.createTask({company_id:'11111111-1111-4111-8111-111111111111',task_type:'FOLLOW_UP',title:'Call'},user);
  await service.listTasks({priority:'HIGH'},user);
  await service.updateTask('22222222-2222-4222-8222-222222222222',{priority:'LOW'},user);
  assert.deepEqual(calls.map(([kind,input])=>`${kind}:${input.priority}`),['create:HIGH','create:NORMAL','list:HIGH','update:LOW']);
  await assert.rejects(service.createTask({company_id:'11111111-1111-4111-8111-111111111111',task_type:'FOLLOW_UP',title:'x',priority:'URGENT'},user),{code:'CRM_VALUE_INVALID'});
});
