import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCommunicationSync,COMMUNICATION_CHANGE_EVENT} from '../public/ui/communication-sync.js';

function fixture(){
  const channels=[];
  const channelFactory=()=>{const handlers=new Set();const channel={sent:[],addEventListener:(_name,fn)=>handlers.add(fn),removeEventListener:(_name,fn)=>handlers.delete(fn),close(){this.closed=true;},postMessage(data){this.sent.push(data);for(const other of channels)if(other!==this)other.receive(data);},receive(data){for(const fn of handlers)fn({data});}};channels.push(channel);return channel;};
  return{channels,channelFactory};
}
test('communication invalidation broadcasts once, strips business content and never predicts a state',()=>{
  const f=fixture(),a=createCommunicationSync({...f,idFactory:()=> 'a'}),b=createCommunicationSync({...f,idFactory:()=> 'b'});
  const local=[],remote=[];a.subscribe(x=>local.push(x));b.subscribe(x=>remote.push(x));
  const detail=a.publish({companyId:'00000000-0000-0000-0000-000000000001',productProfile:'WOMENSWEAR',reason:'SEND_COMPLETED',email:'private@example.invalid',body:'secret',status:'SENT'});
  assert.deepEqual(Object.keys(detail),['companyId','productProfile','reason']);assert.equal(local.length,1);assert.deepEqual(remote,local);
  assert.equal(f.channels[0].sent.length,1);assert.equal(f.channels[1].sent.length,0);
  f.channels[1].receive(f.channels[0].sent[0]);assert.equal(remote.length,1);a.close();b.close();
});
test('missing broadcast capability still delivers a sanitized document event and subscriptions',()=>{
  const events=[],sync=createCommunicationSync({target:{dispatchEvent:event=>events.push(event)},eventFactory:(type,detail)=>({type,detail}),channelFactory:()=>{throw new Error('Unavailable');}});
  let calls=0;const unsubscribe=sync.subscribe(()=>calls++);sync.publish({companyId:'<script>',reason:'SEND_NOW',productProfile:'x'});
  assert.deepEqual(events[0],{type:COMMUNICATION_CHANGE_EVENT,detail:{companyId:null,productProfile:null,reason:'UPDATED'}});
  assert.equal(calls,1);unsubscribe();sync.publish();assert.equal(calls,1);sync.close();sync.publish();assert.equal(events.length,2);
});
test('malformed, unknown version and self messages ignored; throwing subscriber does not suppress others',()=>{
  const f=fixture(),sync=createCommunicationSync({...f,idFactory:()=> 'self'});let calls=0;
  sync.subscribe(()=>{throw new Error('read failed');});sync.subscribe(()=>calls++);
  for(const data of [null,{}, {type:COMMUNICATION_CHANGE_EVENT,version:2,id:'x'}, {type:COMMUNICATION_CHANGE_EVENT,version:1,id:'x',source:'self'}])f.channels[0].receive(data);
  assert.equal(calls,0);sync.publish({reason:'REPLY_UPDATED'});assert.equal(calls,1);sync.close();
});
test('linked read views invalidate cached data and reject responses superseded by a communication change',()=>{
  const read=path=>readFileSync(new URL(`../public/${path}`,import.meta.url),'utf8');
  const queue=read('ui/contact-queue.js'),replies=read('ui/v3/replies.js'),detail=read('phase7-ui.js');
  for(const source of [queue,replies]){
    assert.match(source,/subscribeCommunicationChanges\(invalidate\)/);
    assert.match(source,/ticket!==generation/);
    assert.match(source,/visibilitychange/);
    assert.match(source,/'focus'/);
  }
  assert.match(detail,/if\(generation===\(state.generation\|\|0\)\)state.cache=data/);
  assert.match(detail,/if\(state.editing\)return/);
  assert.match(detail,/reason:'MANAGEMENT_UPDATED'/);
  assert.match(detail,/if\(action==='commit'\)publishCommunicationChange/);
});
test('a replacement draft cannot hide prior company correspondence or its authoritative next action',async()=>{
  const source=readFileSync(new URL('../public/ui/v3/replies.js',import.meta.url),'utf8');
  const pure=source.slice(source.indexOf('const esc='),source.indexOf('export function mountReplies'));
  const {replyRows,communicationRow,renderReplyRows}=await import(`data:text/javascript;base64,${Buffer.from(pure).toString('base64')}`);
  const oldContact={company_id:'company',company_name:'Company',message_id:null,business_contact_status:'DRAFT',
    next_action:'REVIEW_DRAFT',has_prior_company_contact:true,first_contact_pending:false,last_contact_at:'2026-09-07T08:00:00Z',contact_progress_status:'SENT_NO_REPLY'};
  assert.equal(replyRows({items:[oldContact,{company_id:'fresh'}]}).length,1);
  assert.equal(communicationRow(oldContact).next_action,'WAIT_FOR_REPLY');
  const html=renderReplyRows([communicationRow(oldContact)]);assert.match(html,/Sent, no reply yet/);assert.match(html,/Wait for reply/);assert.doesNotMatch(html,/Review draft/);
  assert.equal(communicationRow({...oldContact,contact_progress_status:'REPLIED'}).next_action,'FOLLOW_UP_REQUIRED');
  assert.equal(communicationRow({...oldContact,contact_progress_status:'OPTED_OUT'}).next_action,'STOP_CONTACT');
  assert.equal(communicationRow({...oldContact,contact_progress_status:'SEND_AMBIGUOUS'}).next_action,'REVIEW_SEND_RESULT');
  assert.match(source,/if\(visible\(\)&&!busy\)refresh\(\);},30000/);
  assert.match(source,/fingerprint===lastFingerprint/);
});
