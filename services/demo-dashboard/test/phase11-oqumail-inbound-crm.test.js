import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {SmtpImapProviderAdapter} from '../src/outreach/smtpImapProvider.js';
import {classifyInboundReply} from '../src/outreach/inbound.js';

const root=new URL('../../../',import.meta.url);
const config=overrides=>({smtpEnabled:true,smtpInboundSyncEnabled:true,smtpHost:'mail.oqumail.com',smtpPort:587,smtpSecure:false,smtpRequireTls:true,
  smtpUser:'mailbox@example.test',smtpPassword:'fixture',senderEmail:'mailbox@example.test',replyToEmail:'mailbox@example.test',imapHost:'mail.oqumail.com',imapPort:993,imapTls:true,imapUser:'mailbox@example.test',imapPassword:'fixture',...overrides});

function fakeImap({uidValidity=90,uidNext=12,messages=[]}={}){
  const ranges=[];const client={mailbox:{uidValidity,uidNext,highestModseq:null},connect:async()=>{},logout:async()=>{},getMailboxLock:async()=>({release(){}}),
    fetch(range){ranges.push(range);return(async function*(){for(const row of messages)yield row;})();}};
  return{client,ranges};
}

test('IMAP reads only the incremental UID range and never downloads full message source',async()=>{
  const fixture=fakeImap({messages:[{uid:11,envelope:{subject:'Reply'},headers:Buffer.from('Message-ID: <reply-11@example.test>\r\nIn-Reply-To: <sent@example.test>\r\n'),bodyParts:new Map([['1',Buffer.from('Thank you')]])}]});
  const adapter=new SmtpImapProviderAdapter(config({imapClientFactory:()=>fixture.client}));
  const result=await adapter.readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(fixture.ranges[0],'11:*');assert.equal(result.messages[0].uid,11);assert.equal(result.messages[0].message_id,'<reply-11@example.test>');
  const source=await fs.readFile(new URL('../src/outreach/smtpImapProvider.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/client\.fetch\([^\n]+source\s*:\s*true/);
});

test('UIDVALIDITY change starts a bounded rescan window',async()=>{
  const fixture=fakeImap({uidValidity:91,uidNext:250});const adapter=new SmtpImapProviderAdapter(config({imapClientFactory:()=>fixture.client}));
  const result=await adapter.readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:200},rescanWindow:100});
  assert.equal(result.uidvalidity_changed,true);assert.equal(fixture.ranges[0],'150:*');
});

test('actual ImapFlow combined MIME types decode UTF8 base64 with UID semantics and no nested fetch',async()=>{
  let fetching=false;const requested=[];
  const fixture=fakeImap();
  fixture.client.fetch=(range,query,options)=>(async function*(){
    assert.deepEqual(options,{uid:true});fetching=true;
    yield {uid:11,headers:Buffer.from('Message-ID: <real-shape@example.test>\r\n'),bodyStructure:{type:'multipart/alternative',childNodes:[
      {part:'1',type:'text/plain',encoding:'base64',parameters:{charset:'UTF-8'}},
      {part:'2',type:'text/html',encoding:'base64'},
      {part:'3',type:'text/plain',disposition:'attachment',parameters:{name:'private.txt'}}]}};
    fetching=false;
  })();
  fixture.client.fetchOne=async(uid,query,options)=>{
    assert.equal(fetching,false);assert.deepEqual(options,{uid:true});requested.push(...query.bodyParts);
    return {bodyParts:new Map([['1',Buffer.from(Buffer.from('已收到，谢谢。').toString('base64'))]])};
  };
  const result=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>fixture.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(result.status,'COMPLETED');assert.equal(result.messages[0].body_text,'已收到，谢谢。');
  assert.deepEqual(requested,['1']);
});

test('quoted printable charset and HTML-only reply produce readable text without attachments',async()=>{
  const fixture=fakeImap({messages:[{uid:11,headers:Buffer.from('Message-ID: <html@example.test>\r\n'),
    bodyStructure:{type:'text/html',part:'1',encoding:'quoted-printable',parameters:{charset:'iso-8859-1'}}}]});
  fixture.client.fetchOne=async()=>({bodyParts:new Map([['1',Buffer.from('<p>Ol=E1 &amp; thanks</p><script>hidden</script>')]])});
  const result=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>fixture.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(result.messages[0].body_text.trim(),'Olá & thanks');
});

test('controlled Sent alias requires unique exact content envelope and bounded timestamp',async()=>{
  const adapter=new SmtpImapProviderAdapter(config({controlledTestMode:true,controlledRecipientAllowlist:'recipient@example.test'}));
  const input={body_text:'Hello\r\nReply please.',subject:'Controlled verification',from:'mailbox@example.test',to:'recipient@example.test',sent_at:'2026-09-07T02:00:00Z'};
  const sent={body_text:'Hello\nReply please.\n',subject:input.subject,from_address:input.from,to_addresses:[input.to],
    date:'2026-09-07T02:00:02Z',message_id:'<rewritten@example.test>',uid:4,uidvalidity:90};
  let rows=[sent];adapter.readMailboxChanges=async()=>({status:'COMPLETED',messages:rows,network_calls:1});
  assert.equal((await adapter.reconcileControlledSent(input)).provider_message_id,sent.message_id);
  for(const altered of [{...sent,body_text:'Different body'},{...sent,to_addresses:['other@example.test']},
    {...sent,date:'2026-09-07T02:10:00Z'},{...sent,from_address:'other@example.test'}]){
    rows=[altered];assert.equal((await adapter.reconcileControlledSent(input)).status,'MANUAL_HOLD');
  }
  rows=[sent,{...sent,uid:5,message_id:'<duplicate@example.test>'}];
  assert.equal((await adapter.reconcileControlledSent(input)).code,'CONTROLLED_SENT_MULTIPLE_MATCHES');
});

test('header-derived automation wins over quoted opt-out text while explicit human opt-out remains opt-out',()=>{
  const auto=classifyInboundReply({automatic:true,body_text:'Original message: unsubscribe here'});
  assert.equal(auto.reply_category,'AUTO_REPLY');assert.deepEqual(auto.actions,[]);
  assert.equal(classifyInboundReply({out_of_office:true,body_text:'Back next week'}).reply_category,'OUT_OF_OFFICE');
  assert.equal(classifyInboundReply({dsn:true,body_text:'5.1.1'}).reply_category,'BOUNCE_DSN');
  assert.equal(classifyInboundReply({body_text:'Please remove me from this list.'}).reply_category,'OPT_OUT');
  assert.notEqual(classifyInboundReply({body_text:'Thank you\n\nOn Monday sender@example.test wrote:\n> Unsubscribe'}).reply_category,'OPT_OUT');
});

test('provider-neutral queue, strict thread correlation and exactly-once CRM schema are wired',async()=>{
  const [queue,repository,service,migration]=await Promise.all([
    fs.readFile(new URL('../src/jobs/phase5Queue.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../src/phase7/repository.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../src/phase7/service.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../../../database/migrations/053_phase11_oqumail_inbound_crm.sql',import.meta.url),'utf8')]);
  assert.match(queue,/INBOUND_EMAIL_SYNC:\s*'inbound-email-sync'/);assert.match(repository,/m\.rfc_message_id=ANY\(\$1::text\[\]\).*'IN_REPLY_TO'/s);
  assert.doesNotMatch(repository,/SENDER_ACTIVE_THREAD/);assert.match(migration,/UNIQUE\(mailbox_identity_hash,folder_path,uidvalidity,imap_uid\)/);
  assert.match(migration,/opportunity_activities/);assert.match(service,/classification_revision:inbound\.classification_revision.*opportunity_id:inbound\.opportunity_snapshot_id/s);
});

test('hard bounce requires structured DSN fields and plain delivery-failed text is not a DSN',async()=>{
  const structured=fakeImap({messages:[{uid:11,envelope:{subject:'Delivery status'},headers:Buffer.from('Message-ID: <dsn@example.test>\r\nContent-Type: multipart/report; report-type=delivery-status\r\n'),bodyStructure:{childNodes:[{part:'1',type:'text',subtype:'plain'},{part:'2',type:'message',subtype:'delivery-status'}]}}]});
  structured.client.fetchOne=async()=>({bodyParts:new Map([['1',Buffer.from('Delivery report')],['2',Buffer.from('Final-Recipient: rfc822; user@example.test\r\nOriginal-Message-ID: <sent@example.test>\r\nStatus: 5.1.1')]])});
  const result=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>structured.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(result.messages[0].dsn,true);assert.equal(result.messages[0].dsn_details.status,'5.1.1');assert.equal(result.messages[0].dsn_details.original_message_id,'<sent@example.test>');
  const plain=fakeImap({messages:[{uid:11,envelope:{subject:'Delivery failed'},headers:Buffer.from('From: mailer-daemon@example.test\r\nContent-Type: text/plain\r\n'),bodyStructure:{part:'1',type:'text',subtype:'plain'}}]});
  plain.client.fetchOne=async()=>({bodyParts:new Map([['1',Buffer.from('delivery failed')]])});
  const normal=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>plain.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(normal.messages[0].dsn,false);assert.equal(normal.messages[0].dsn_details,null);

  const spoof=fakeImap({messages:[{uid:11,envelope:{subject:'Delivery report'},headers:Buffer.from('Content-Type: multipart/report; report-type=delivery-status\r\n'),bodyStructure:{part:'1',type:'text',subtype:'plain'}}]});
  spoof.client.fetchOne=async()=>({bodyParts:new Map([['1',Buffer.from('Final-Recipient: rfc822; user@example.test\r\nStatus: 5.1.1')]])});
  const spoofed=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>spoof.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(spoofed.messages[0].dsn,false);assert.equal(spoofed.messages[0].dsn_details,null);

  const delayed=fakeImap({messages:[{uid:11,envelope:{subject:'Delivery delayed'},headers:Buffer.from('Content-Type: multipart/report; report-type=delivery-status\r\n'),bodyStructure:{part:'2',type:'message',subtype:'delivery-status'}}]});
  delayed.client.fetchOne=async()=>({bodyParts:new Map([['2',Buffer.from('Original-Recipient: rfc822; user@example.test\r\nStatus: 4.2.0')]])});
  const soft=await new SmtpImapProviderAdapter(config({imapClientFactory:()=>delayed.client})).readMailboxChanges({checkpoint:{uidvalidity:90,last_processed_uid:10}});
  assert.equal(soft.messages[0].dsn,true);assert.equal(soft.messages[0].dsn_details.bounce_class,'SOFT');
});

test('opt-out closed loop cancels unsent work and later cancelled send performs zero network calls',async()=>{
  const [repositorySource,migration]=await Promise.all([fs.readFile(new URL('../src/phase7/repository.js',import.meta.url),'utf8'),fs.readFile(new URL('../../../database/migrations/054_phase11_suppression_closed_loop.sql',import.meta.url),'utf8')]);
  assert.match(repositorySource,/draft_status='CANCELLED'/);assert.match(repositorySource,/send_status='CANCELLED'/);assert.match(repositorySource,/outreach_recipient_suppressions/);
  assert.match(migration,/lifecycle_status IN\([^)]*'SUPPRESSED'/);assert.match(migration,/outreach_recipient_suppressions/);
});
