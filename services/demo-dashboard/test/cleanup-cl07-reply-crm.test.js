import assert from 'node:assert/strict';
import test from 'node:test';
import * as inboundModule from '../src/outreach/inbound.js';
import { Phase7Repository } from '../src/phase7/repository.js';
import { Phase7Service } from '../src/phase7/service.js';

test('CL07 retired sender-only correlator is absent; current RFC correlation remains', async () => {
  assert.equal('correlateInboundReply' in inboundModule, false);
  let parameters;
  const repository = new Phase7Repository({pool:{query:async(sql,values)=>{
    parameters=values;
    assert.match(sql,/m\.rfc_message_id=ANY\(\$1::text\[\]\)/);
    assert.match(sql,/m\.rfc_message_id=ANY\(\$2::text\[\]\)/);
    assert.match(sql,/AND \(\s*m\.rfc_message_id/);
    assert.doesNotMatch(sql,/SENDER_ACTIVE_THREAD/);
    return {rows:[]};
  }}});
  assert.equal(await repository.findInboundThread({normalizedSender:'BUYER@example.test'}),null);
  assert.deepEqual(parameters,[[],[],null,null,'buyer@example.test']);
  await repository.findInboundThread({inReplyTo:'<sent@example.test>',references:['<older@example.test>'],normalizedSender:'buyer@example.test'});
  assert.deepEqual(parameters[0],['sent@example.test','<sent@example.test>']);
  assert.deepEqual(parameters[1],['older@example.test','<older@example.test>']);
});

for (const [body,flags,category,intent,taskExpected] of [
  ['Please send your catalogue.',{},'HUMAN_POSITIVE','CATALOGUE',true],
  ['We are not interested.',{},'HUMAN_NEGATIVE','DECLINE',true],
  ['Please unsubscribe me.',{},'OPT_OUT','OPT_OUT',false],
  ['Back next week.',{out_of_office:true},'OUT_OF_OFFICE','AUTO_REPLY',false],
  ['Delivery failed.',{dsn:true},'BOUNCE_DSN','IRRELEVANT',false]
]) test(`CL07 shared classifier preserves ${category} and CRM task boundary`,async()=>{
  const classification=inboundModule.classifyInboundReply({body_text:body,...flags});
  assert.equal(classification.reply_category,category);
  assert.equal(classification.intent,intent);
  const row={id:'reply-fixture',company_id:'company-fixture',thread_id:'thread-fixture',intent,
    reply_category:category,body_text_sanitized:body,classification_revision:1,owner_identity:'sales-owner'};
  const effects=[];
  const context={repository:{getInboundForTask:async()=>row,applyInboundCrmEffects:async input=>{
    effects.push(input);return {replay:effects.length>1,activity:{id:'activity-fixture'},task:input.task?{id:'task-fixture'}:null,outboxes:[]};
  }},queue:{enqueue:async()=>{throw new Error('No queue expected');}}};
  const result=await Phase7Service.prototype.createSalesFollowupWork.call(context,{inbound_message_id:row.id});
  const replay=await Phase7Service.prototype.createSalesFollowupWork.call(context,{inbound_message_id:row.id});
  assert.equal(Boolean(effects[0].task),taskExpected);
  assert.equal(result.automatic_send_allowed,false);
  assert.equal(effects[0].effect_key,effects[1].effect_key);
  assert.equal(replay.status,'REPLAY_NO_DELTA');
  assert.equal(effects[0].owner,'sales-owner');
  assert.equal(effects[0].close_followups,category==='OPT_OUT');
  assert.ok(!['WON','LOST'].includes(effects[0].funnel_status));
});

test('CL07 unmatched inbound does not create CRM effects or sales tasks',async()=>{
  const result=await Phase7Service.prototype.createSalesFollowupWork.call({repository:{
    getInboundForTask:async()=>({company_id:'company-fixture'}),
    applyInboundCrmEffects:async()=>{throw new Error('Unexpected CRM write');}
  }},{inbound_message_id:'unmatched'});
  assert.equal(result.reason,'UNMATCHED_INBOUND');
  assert.equal(result.automatic_send_allowed,false);
});
