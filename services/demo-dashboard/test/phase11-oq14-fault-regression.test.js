import test from 'node:test';
import assert from 'node:assert/strict';
import {SmtpImapProviderAdapter} from '../src/outreach/smtpImapProvider.js';

const config={smtpEnabled:true,smtpInboundSyncEnabled:true,smtpHost:'mail.oqumail.com',smtpPort:587,smtpSecure:false,smtpRequireTls:true,
  smtpUser:'fixture@example.test',smtpPassword:'fixture',senderEmail:'fixture@example.test',replyToEmail:'fixture@example.test',
  imapHost:'mail.oqumail.com',imapPort:993,imapTls:true,imapUser:'fixture@example.test',imapPassword:'fixture'};

test('UIDVALIDITY reset never carries the old high UID into the new mailbox checkpoint',async()=>{
  const ranges=[];
  const client={mailbox:{uidValidity:2,uidNext:6},connect:async()=>{},logout:async()=>{},getMailboxLock:async()=>({release(){}}),
    fetch(range){ranges.push(range);return(async function*(){yield{uid:5,headers:Buffer.from('Message-ID: <new-5@example.test>\r\n'),bodyParts:new Map()};})();}};
  const adapter=new SmtpImapProviderAdapter({...config,imapClientFactory:()=>client});
  const result=await adapter.readMailboxChanges({checkpoint:{uidvalidity:1,last_processed_uid:200}});
  assert.equal(result.status,'COMPLETED');assert.equal(result.uidvalidity_changed,true);assert.equal(result.last_processed_uid,5);
  client.mailbox.uidNext=7;
  await adapter.readMailboxChanges({checkpoint:{uidvalidity:result.uidvalidity,last_processed_uid:result.last_processed_uid}});
  assert.equal(ranges[1],'6:*');
});

test('empty mailbox after UIDVALIDITY reset persists zero rather than the retired UID',async()=>{
  const client={mailbox:{uidValidity:2,uidNext:1},connect:async()=>{},logout:async()=>{},getMailboxLock:async()=>({release(){}}),fetch(){return(async function*(){})();}};
  const result=await new SmtpImapProviderAdapter({...config,imapClientFactory:()=>client}).readMailboxChanges({checkpoint:{uidvalidity:1,last_processed_uid:200}});
  assert.equal(result.last_processed_uid,0);
});

test('mid-fetch IMAP disconnect exposes no partial cursor and releases mailbox lock',async()=>{
  let releases=0,logouts=0;
  const client={mailbox:{uidValidity:2,uidNext:8},connect:async()=>{},logout:async()=>{logouts++;},getMailboxLock:async()=>({release(){releases++;}}),fetch(){return(async function*(){yield{uid:5,headers:Buffer.from('Message-ID: <partial@example.test>\r\n'),bodyParts:new Map()};throw Object.assign(new Error('fixture disconnect'),{code:'ECONNRESET'});})();}};
  const result=await new SmtpImapProviderAdapter({...config,imapClientFactory:()=>client}).readMailboxChanges({checkpoint:{uidvalidity:2,last_processed_uid:4}});
  assert.equal(result.status,'FAILED');assert.deepEqual(result.messages,[]);assert.equal(result.last_processed_uid,undefined);assert.equal(releases,1);assert.equal(logouts,1);
});

test('SMTP connection reset or unknown exception after send initiation is held ambiguous, never retryable failure',async()=>{
  for(const code of ['ECONNRESET','EPIPE','UNKNOWN_PROVIDER_EXCEPTION']){
    let calls=0;const adapter=new SmtpImapProviderAdapter({...config,smtpControlledTestMode:true,controlledRecipientAllowlist:'recipient@example.test',
      transporterFactory:()=>({close(){},async sendMail(){calls++;throw Object.assign(new Error('fixture after DATA uncertainty'),{code});}})});
    const result=await adapter.send({to:'recipient@example.test',subject:'Fixture',body_text:'Fixture'},`uncertain-${code}`);
    assert.equal(result.status,'AMBIGUOUS',code);assert.equal(result.code,'SMTP_SEND_AMBIGUOUS');assert.equal(calls,1);
  }
});
