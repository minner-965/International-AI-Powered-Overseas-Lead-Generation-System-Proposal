// Batch 3: reply correlation for servers that rewrite the Message-ID, and the CREATE_LEAD website check.
// No network: SMTP and IMAP are in-process doubles.
import assert from 'node:assert/strict';
import test from 'node:test';
import {SmtpImapProviderAdapter,matchSentCopy,stableSmtpMessageKey} from '../src/outreach/smtpImapProvider.js';
import {strippedReplySubjects,senderAddress,inlineReplyQueue} from '../src/phase7/replyCorrelation.js';
import {validateCrmPayload} from '../src/phase7/service.js';
import {leadOutboxPayload,websiteOrigin} from '../src/crm/outboxPayloads.js';
import {rebuiltPayload} from '../src/crm/outboxRepair.js';
import {parseArgs} from '../scripts/recorrelate-inbound-replies.mjs';
import {rewritingServer} from './batch3-correlation-mailserver.js';

const config=overrides=>({smtpEnabled:true,smtpInboundSyncEnabled:true,smtpHost:'mail.oqumail.com',smtpPort:587,smtpUser:'sales@shimin.example',smtpPassword:'fixture',
  senderEmail:'sales@shimin.example',replyToEmail:'sales@shimin.example',imapHost:'mail.oqumail.com',imapPort:993,imapTls:true,controlledTestMode:false,useCaseApproved:true,...overrides});

test('Sent-folder lookup finds the rewritten Message-ID of a sent email (no extra send)',async()=>{
  const server=rewritingServer();
  const adapter=new SmtpImapProviderAdapter(config({transporterFactory:server.transporterFactory,imapClientFactory:server.imapClientFactory}));
  const subject='Dresses enquiry for SIM验收测试客户（邮件）';const body='Hello,\nWe make dresses.\nBest regards';
  const sent=await adapter.send({to:'965214484@qq.com',subject,body_text:body},'manual-first-touch:r1');
  assert.equal(sent.status,'PROVIDER_ACCEPTED');assert.match(sent.rfc_message_id,/^<dpv-/);
  const lookup=await adapter.lookupSentMessageIds([{key:'m1',to:'965214484@qq.com',from:'sales@shimin.example',subject,body_text:body,
    sent_at:new Date().toISOString(),rfc_message_id:sent.rfc_message_id,message_key:stableSmtpMessageKey('manual-first-touch:r1')}]);
  assert.equal(lookup.status,'COMPLETED');assert.equal(lookup.folder_path,'Sent Messages');
  assert.deepEqual({status:lookup.results[0].status,id:lookup.results[0].message_id,method:lookup.results[0].match_method},
    {status:'MATCHED',id:'<srv-1@shimin.example>',method:'ENVELOPE_SUBJECT_TIME_BODY'});
  assert.equal(server.sent.length,1,'the lookup never sends');
  // A server that keeps the ID reports SAME_ID via the preserved key header.
  const keep=rewritingServer({rewrite:false,folderName:'Sent',specialUse:''});
  const keeper=new SmtpImapProviderAdapter(config({transporterFactory:keep.transporterFactory,imapClientFactory:keep.imapClientFactory}));
  const own=await keeper.send({to:'buyer@example.test',subject:'Hi',body_text:'Body'},'k2');
  const same=await keeper.lookupSentMessageIds([{key:'m2',to:'buyer@example.test',subject:'Hi',body_text:'Body',sent_at:new Date().toISOString(),rfc_message_id:own.rfc_message_id,message_key:stableSmtpMessageKey('k2')}]);
  assert.equal(same.results[0].status,'SAME_ID');assert.equal(same.results[0].match_method,'MESSAGE_KEY_HEADER');
  // Nothing to look up: no IMAP connection.
  assert.deepEqual((await keeper.lookupSentMessageIds([])).network_calls,0);
});

test('Sent copy matching needs recipient, subject, time window and body; ambiguity never matches',()=>{
  const candidate={to:'Buyer <buyer@example.test>',subject:'Offer',body_text:'Line one\r\nLine two',sent_at:'2026-10-27T03:00:00Z',rfc_message_id:'<dpv-1@x>'};
  const copy={message_id:'<srv-9@x>',subject:'Offer',to_addresses:['buyer@example.test'],date:'2026-10-27T03:00:20Z',body_text:'Line one\nLine two\n',uid:9,uidvalidity:1};
  assert.equal(matchSentCopy(candidate,[copy]).status,'MATCHED');
  assert.equal(matchSentCopy(candidate,[{...copy,body_text:'Line one\nLine two\n\n-- \nSent with Oqumail'}]).match_method,'ENVELOPE_SUBJECT_TIME_BODY_PREFIX');
  for(const changed of [{to_addresses:['other@example.test']},{to_addresses:['buyer@example.test','cc@example.test']},{subject:'Other'},
    {date:'2026-10-27T04:00:00Z'},{body_text:'Different'},{message_id:'not-an-id'}])
    assert.equal(matchSentCopy(candidate,[{...copy,...changed}]).status,'NO_MATCH',JSON.stringify(changed));
  assert.equal(matchSentCopy(candidate,[copy,{...copy,uid:10,message_id:'<srv-10@x>'}]).status,'MULTIPLE_MATCHES');
});

test('subject fallback prefixes: Re/RE/回复/答复 with ASCII or full-width colon, nothing else',()=>{
  assert.deepEqual(strippedReplySubjects('Re: Dresses enquiry for SIM验收测试客户（邮件）'),['Dresses enquiry for SIM验收测试客户（邮件）']);
  assert.deepEqual(strippedReplySubjects('RE: Re: Offer'),['Re: Offer','Offer']);
  assert.deepEqual(strippedReplySubjects('回复：Offer'),['Offer']);
  assert.deepEqual(strippedReplySubjects('答复: Offer'),['Offer']);
  assert.deepEqual(strippedReplySubjects('Fwd: Offer'),[]);
  assert.deepEqual(strippedReplySubjects('Offer'),[]);
  assert.equal(senderAddress('"QQ" <965214484@QQ.com>'),'965214484@qq.com');
});

test('inline reply queue runs classification and CRM effects now and leaves CRM sync to the dispatcher',async()=>{
  const calls=[];const service={async classifyInboundWork(data){calls.push(['classify',data]);},async createSalesFollowupWork(data){calls.push(['effects',data]);}};
  const queue=inlineReplyQueue(service);
  await queue.enqueue('classify-inbound-reply',{inbound_message_id:'a'});await queue.enqueue('create-sales-followup',{inbound_message_id:'a'});
  assert.equal(await queue.enqueue('sync-outreach-to-crm',{outbox_id:'b'}),null);
  assert.deepEqual(queue.ran,['classify-inbound-reply','create-sales-followup','sync-outreach-to-crm:deferred']);
  assert.deepEqual(parseArgs(['--inbound','9d1ad033-3e9b-4415-bbb7-4af274f507e6','--apply']).inboundIds,['9d1ad033-3e9b-4415-bbb7-4af274f507e6']);
  assert.throws(()=>parseArgs(['--inbound','x']));
  assert.equal(parseArgs([]).apply,false);
});

test('CREATE_LEAD for a manual company passes the CRM payload check; local paths are still refused',()=>{
  // The exact payload of the failed live row (outbox eea228bc…).
  const live={owner:'minm138@outlook.com',website_url:'https://example.com',company_name:'SIM验收测试客户（飞书）',country_code:'AE',source_reference:'manual_company=b32042dd-a8e9-4cc8-aa98-a37ea64a1295'};
  assert.deepEqual({...validateCrmPayload('CREATE_LEAD',live)},live);
  assert.deepEqual({...validateCrmPayload('CREATE_LEAD',rebuiltPayload({operation:'CREATE_LEAD',payload:live}))},live);
  const built=leadOutboxPayload({company_name:'Gulf',country_code:'ae',website_url:'https://www.Gulf.example/about',owner:'simon',references:{manual_company:'c1'}});
  assert.deepEqual(built,{company_name:'Gulf',country_code:'AE',website_url:'https://www.gulf.example',owner:'simon',source_reference:'manual_company=c1'});
  validateCrmPayload('CREATE_LEAD',built);
  assert.equal(websiteOrigin('ftp://x.example'),null);assert.equal(websiteOrigin('https://u:p@x.example'),null);
  for(const bad of ['file:///etc/passwd','https://x.example/home/user','C:\\Users\\x','\\\\server\\share','https://x.example/tmp/'])
    assert.throws(()=>validateCrmPayload('CREATE_LEAD',{company_name:'x',website_url:bad}),error=>['CRM_PAYLOAD_URL_INVALID','CRM_PAYLOAD_PATH_FORBIDDEN'].includes(error.code),bad);
  for(const bad of ['C:\\temp\\x','see /var/lib/x','\\\\srv\\share\\f','file://x'])
    assert.throws(()=>validateCrmPayload('UPDATE_ACTIVITY',{activity_type:'NOTE',summary:bad}),{code:'CRM_PAYLOAD_PATH_FORBIDDEN'},bad);
  assert.throws(()=>validateCrmPayload('CREATE_LEAD',{company_name:'x',owner:'D:/share'}),{code:'CRM_PAYLOAD_PATH_FORBIDDEN'});
});

test('subject fallback: exactly one candidate matches LOW; two candidates stay REVIEW',async()=>{
  const {ReplyCorrelationService}=await import('../src/phase7/replyCorrelation.js');
  const hash='a'.repeat(64);let rows=[];const seen=[];
  const service=new ReplyCorrelationService({pool:{async query(sql,values){seen.push(values);return{rows};}},repository:{}});
  const input={subject:'Re: Dresses enquiry',from_address_hash:hash,mailbox_identity_hash:hash,merchant_id:'m1',received_at:'2026-10-27T05:00:00Z'};
  const row=(id,subject='Dresses enquiry')=>({id,thread_id:`t-${id}`,company_id:'c1',subject});
  rows=[row('o1'),row('o2','Other subject')];
  assert.deepEqual((await service.findSubjectFallback(input)).match,{id:'t-o1',company_id:'c1',outbound_message_id:'o1',correlation_method:'SUBJECT_FALLBACK',correlation_confidence:'LOW'});
  assert.deepEqual(seen[0].slice(0,3),['m1',hash,hash]);assert.equal(seen[0][4],60);
  rows=[row('o1'),row('o2')];
  assert.deepEqual(await service.findSubjectFallback(input),{match:null,candidates:2});
  assert.deepEqual(await service.findSubjectFallback({...input,subject:'Dresses enquiry'}),{match:null,candidates:0},'no reply prefix');
  assert.deepEqual(await service.findSubjectFallback({...input,mailbox_identity_hash:null}),{match:null,candidates:0},'not an IMAP mailbox reply');
});
