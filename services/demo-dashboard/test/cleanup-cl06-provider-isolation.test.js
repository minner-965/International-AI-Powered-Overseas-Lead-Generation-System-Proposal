import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Service} from '../src/phase7/service.js';
import {createOutboundProvider} from '../src/outreach/providers.js';

test('SMTP factory ignores legacy API credentials without invoking Gmail or Resend',async()=>{
  let apiCalls=0;
  const provider=createOutboundProvider({provider:'SMTP',enabled:false,apiKey:'fixture-only',clientId:'fixture-only',clientSecret:'fixture-only',refreshToken:'fixture-only',fetchImpl(){apiCalls++;throw new Error('Unexpected API call');}});
  assert.equal(provider.name,'SMTP');
  const result=await provider.send({to:'contact@example.test'},'fixture-only');
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.network_calls,0);
  assert.equal(apiCalls,0);
});

test('unselected Gmail reconciliation leaves SMTP and historical rows untouched', async()=>{
  let calls=0;
  const service={env:{OUTBOUND_EMAIL_PROVIDER:'SMTP'},repository:{getOutboundMessage(){calls++;}},outboundProvider:{reconcileAmbiguousSend(){calls++;}}};
  const result=await Phase7Service.prototype.reconcileGmailAmbiguousSendWork.call(service,{message_id:'historical-message'});
  assert.equal(result.code,'GMAIL_PROVIDER_NOT_SELECTED');
  assert.equal(result.network_calls,0);
  assert.equal(calls,0);
});

test('unselected Gmail inbound and explicit health checks have no provider calls',async()=>{
  let calls=0;
  const service={env:{OUTBOUND_EMAIL_PROVIDER:'SMTP'},repository:{getGmailCheckpoint(){calls++;}},outboundProvider:{healthCheck(){calls++;},readMailboxChanges(){calls++;}}};
  assert.equal((await Phase7Service.prototype.gmailHealth.call(service,{verify_oauth:true})).code,'GMAIL_PROVIDER_NOT_SELECTED');
  assert.equal((await Phase7Service.prototype.syncGmailInboundWork.call(service)).code,'GMAIL_PROVIDER_NOT_SELECTED');
  assert.equal(calls,0);
});

test('selected Gmail historical reconciliation retains its audit path',async()=>{
  const calls=[];
  const service={env:{OUTBOUND_EMAIL_PROVIDER:'GMAIL_API'},repository:{
    async getOutboundMessage(){return{id:'historical-message',provider:'GMAIL_API',send_status:'AMBIGUOUS',rfc_message_id:'<stable@example.test>'};},
    async recordGmailAmbiguousEvent(){calls.push('audit');},async resolveGmailAmbiguousSend(){calls.push('resolve');}
  },outboundProvider:{async reconcileAmbiguousSend({rfcMessageId}){assert.equal(rfcMessageId,'<stable@example.test>');calls.push('fixture');return{status:'PROVIDER_ACCEPTED',provider_message_id:'fixture-id'};}}};
  assert.equal((await Phase7Service.prototype.reconcileGmailAmbiguousSendWork.call(service,{message_id:'historical-message'})).status,'PROVIDER_ACCEPTED');
  assert.deepEqual(calls,['fixture','audit','resolve']);
});
