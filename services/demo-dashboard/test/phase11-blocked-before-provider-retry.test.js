import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Repository} from '../src/phase7/repository.js';
const id='04602fd0-5247-4c94-a8e4-54d14cbcb315';
function fixture({status='BLOCKED',started=false,sent_at=null}={}){
  const writes=[];const row={id,approval_id:'approval',send_status:status,sent_at,idempotency_key:'same-key',send_execution_key:'same-key',rfc_message_id:'<same@fixture.invalid>'};
  const repository=new Phase7Repository({pool:{query:async()=>({rows:[]})}});
  repository.transaction=async op=>op({query:async(sql)=>{
    if(sql.startsWith('SELECT *'))return{rows:[row]};
    if(sql.startsWith('SELECT EXISTS'))return{rows:[{started}]};
    writes.push(sql);return{rows:[{...row,send_status:'QUEUED'}]};
  }});return{repository,writes};
}
test('blocked pre-provider retry preserves message, execution key and RFC identity',async()=>{
  const {repository,writes}=fixture();const message=await repository.retryBlockedOutboundBeforeProvider(id,'approval');
  assert.equal(message.id,id);assert.equal(message.send_execution_key,'same-key');assert.equal(message.rfc_message_id,'<same@fixture.invalid>');
  assert.equal(writes.length,1);assert.doesNotMatch(writes[0],/SET[^;]*(?:idempotency_key|send_execution_key|rfc_message_id)=/);
});
test('retry rejects provider-started, ambiguous, accepted and different approval before writes',async()=>{
  for(const options of [{started:true},{status:'AMBIGUOUS'},{status:'PROVIDER_ACCEPTED'},{status:'QUEUED'},{sent_at:new Date()}]){
    const {repository,writes}=fixture(options);
    await assert.rejects(repository.retryBlockedOutboundBeforeProvider(id,'approval'),error=>error.code==='OUTBOUND_RETRY_FORBIDDEN');assert.equal(writes.length,0);
  }
  await assert.rejects(fixture().repository.retryBlockedOutboundBeforeProvider(id,'other'),error=>error.code==='OUTBOUND_RETRY_FORBIDDEN');
});
