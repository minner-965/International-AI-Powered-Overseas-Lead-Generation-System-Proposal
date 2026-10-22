import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Phase7Service, validateCrmPayload } from '../src/phase7/service.js';
import { activityOutboxPayload, normalizeLegacyCrmPayload, opportunityOutboxPayload } from '../src/crm/outboxPayloads.js';

const ID=Object.freeze({
  activity:'11111111-1111-4111-8111-111111111111',inbound:'22222222-2222-4222-8222-222222222222',
  classification:'33333333-3333-4333-8333-333333333333',opportunity:'44444444-4444-4444-8444-444444444444',
  outbound:'55555555-5555-4555-8555-555555555555',outbox:'66666666-6666-4666-8666-666666666666',
});

test('activity builders produce payloads accepted by the UPDATE_ACTIVITY allowlist',()=>{
  const reply=activityOutboxPayload({activity_type:'REPLIED',owner:'sales.owner',summary:'Reply received: QUOTE_REQUEST',
    references:{activity:ID.activity,inbound:ID.inbound,classification:ID.classification,opportunity:ID.opportunity,funnel:'REPLIED'}});
  const firstTouch=activityOutboxPayload({activity_type:'CONTACTED',owner:'phase13-automation',references:{activity:ID.activity,outbound:ID.outbound,funnel:'CONTACTED'}});
  for(const payload of [reply,firstTouch]){
    const projected=validateCrmPayload('UPDATE_ACTIVITY',payload);
    assert.deepEqual(Object.keys(projected).sort(),Object.keys(payload).sort());
    assert.match(projected.source_reference,/activity=/);
  }
  assert.equal(firstTouch.summary,'First-touch email sent');
  assert.doesNotThrow(()=>validateCrmPayload('UPDATE_OPPORTUNITY',opportunityOutboxPayload({stage:'quoted',owner:'sales.owner'})));
});

test('legacy UPDATE_ACTIVITY rows are folded into source_reference; other unknown keys stay rejected',()=>{
  const legacyInbound={activity_id:ID.activity,inbound_message_id:ID.inbound,classification_id:ID.classification,
    opportunity_snapshot_id:ID.opportunity,activity_type:'REPLIED',funnel_status:'REPLIED',owner:'sales.owner',due_at:null};
  const legacyFirstTouch={activity_id:ID.activity,outbound_message_id:ID.outbound,activity_type:'CONTACTED',funnel_status:'CONTACTED'};
  for(const legacy of [legacyInbound,legacyFirstTouch]){
    assert.throws(()=>validateCrmPayload('UPDATE_ACTIVITY',legacy),{code:'CRM_PAYLOAD_FIELD_FORBIDDEN'});
    const projected=validateCrmPayload('UPDATE_ACTIVITY',normalizeLegacyCrmPayload('UPDATE_ACTIVITY',legacy));
    assert.equal(projected.activity_type,legacy.activity_type);assert.match(projected.source_reference,new RegExp(`activity=${ID.activity}`));
  }
  assert.throws(()=>validateCrmPayload('UPDATE_ACTIVITY',normalizeLegacyCrmPayload('UPDATE_ACTIVITY',{activity_id:ID.activity,raw_body:'x'})),{code:'CRM_PAYLOAD_FIELD_FORBIDDEN'});
  const task={task_id:ID.activity,activity_id:ID.activity};
  assert.equal(normalizeLegacyCrmPayload('CREATE_TASK',task),task);
});

test('a prospect activity row reaches the adapter check instead of PERMANENT_ERROR',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})},env:{}});
  const failures=[];
  service.repository={
    getCrmOutbox:async()=>({record_scope:'PROSPECT'}),
    claimCrmOutbox:async()=>({claimed:true,outbox:{id:ID.outbox,idempotency_key:'k',attempt_count:1,operation:'UPDATE_ACTIVITY',
      payload:{activity_id:ID.activity,outbound_message_id:ID.outbound,activity_type:'CONTACTED',funnel_status:'CONTACTED'}}}),
    failCrmOutbox:async(id,input)=>{failures.push(input);return{id,sync_status:input.retryable?'RETRYABLE_ERROR':'PERMANENT_ERROR',attempt_count:1};},
  };
  const result=await service.processCrmSyncWork({outbox_id:ID.outbox});
  assert.equal(result.configuration_status,'ADAPTER_NOT_CONFIGURED');assert.equal(failures[0].retryable,true);
});

test('outbox writers use the allowlisted builder',async()=>{
  const root=new URL('../src/',import.meta.url);
  const repository=await readFile(new URL('phase7/repository.js',root),'utf8');
  const firstTouch=await readFile(new URL('outreach/AutoFirstTouchService.js',root),'utf8');
  for(const source of [repository,firstTouch]){
    assert.match(source,/activityOutboxPayload\(/);
    assert.doesNotMatch(source,/JSON\.stringify\(\{activity_id:/);
    assert.doesNotMatch(source,/const payload=\{activity_id:/);
  }
});
