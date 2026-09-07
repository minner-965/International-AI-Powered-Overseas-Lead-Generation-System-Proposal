import {createHash} from 'node:crypto';
import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {load} from 'cheerio';

const bool=(value,fallback=false)=>value===undefined||value===null||value===''?fallback:/^(1|true|yes|on)$/i.test(String(value));
const clean=(value,maximum=998)=>String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,maximum);
const normalizedEmail=value=>clean(value,320).toLowerCase();
const timeoutCode=error=>/ETIMEDOUT|ESOCKET|ECONNECTION|CONNECTION_TIMEOUT|SOCKET_TIMEOUT/i.test(String(error?.code||error?.message||''));

export function stableSmtpMessageId(key,domain='localhost'){
  const digest=createHash('sha256').update(String(key||'')).digest('hex').slice(0,40);
  const safe=clean(domain,200).toLowerCase().replace(/[^a-z0-9.-]/g,'')||'localhost';
  return `<dpv-${digest}@${safe}>`;
}

export function stableSmtpMessageKey(key){
  return createHash('sha256').update(String(key||'')).digest('base64url');
}

function headerValue(source,name){
  const match=String(source||'').match(new RegExp(`^${name}:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*)`,'im'));
  return match?match[1].replace(/\r?\n[ \t]+/g,' ').trim():'';
}

function parseStructuredDsn(contentType,source){
  if(!/multipart\/report\s*;[^\r\n]*report-type\s*=\s*delivery-status/i.test(String(contentType||'')))return null;
  const raw=Buffer.isBuffer(source)?source.toString('utf8'):String(source||'');
  const recipient=raw.match(/^(?:Final-Recipient|Original-Recipient):\s*[^;\r\n]*;\s*([^\r\n]+)/im)?.[1]?.trim()||'';
  const status=raw.match(/^Status:\s*([45]\.\d+\.\d+)/im)?.[1]||'';
  if(!recipient||!status)return null;
  const diagnosticCode=raw.match(/^Diagnostic-Code:\s*([^\r\n]+)/im)?.[1]?.trim()||null;
  const originalMessageId=raw.match(/^Original-Message-ID:\s*(<[^>]+>|[^\r\n]+)/im)?.[1]?.trim()||null;
  return{recipient,status,diagnostic_code:diagnosticCode,original_message_id:originalMessageId,bounce_class:status.startsWith('5.')?'HARD':'SOFT'};
}

function parseMailboxSource(source,envelope={},dsnSource=null){
  const raw=Buffer.isBuffer(source)?source.toString('utf8'):String(source||'');
  const split=raw.search(/\r?\n\r?\n/);const body=split>=0?raw.slice(split).replace(/^\r?\n\r?\n/,''):'';
  const autoSubmitted=headerValue(raw,'Auto-Submitted');const precedence=headerValue(raw,'Precedence');
  const from=headerValue(raw,'From')||envelope.from?.[0]?.address||'';
  const contentType=headerValue(raw,'Content-Type');const dsnDetails=parseStructuredDsn(contentType,dsnSource);
  return{message_id:headerValue(raw,'Message-ID')||envelope.messageId||'',in_reply_to:headerValue(raw,'In-Reply-To'),references:headerValue(raw,'References'),
    message_key:headerValue(raw,'X-DPV-Message-Key'),from,to:headerValue(raw,'To'),
    from_address:envelope.from?.length===1?envelope.from[0].address:null,to_addresses:(envelope.to||[]).map(item=>item.address),
    date:headerValue(raw,'Date')||envelope.date?.toISOString?.()||'',
    subject:envelope.subject||headerValue(raw,'Subject')||'',auto_submitted:autoSubmitted,precedence,
    x_auto_response_suppress:headerValue(raw,'X-Auto-Response-Suppress'),return_path:headerValue(raw,'Return-Path'),content_type:contentType,
    body_text:body.slice(0,20000),automatic:Boolean(autoSubmitted&&!/^no$/i.test(autoSubmitted)||/bulk|junk|list/i.test(precedence)||headerValue(raw,'X-Auto-Response-Suppress')),
    out_of_office:/out of (?:the )?office|vacation|away from (?:my )?email|fuera de (?:la )?oficina/i.test(`${envelope.subject||''}\n${body}`),
    dsn:Boolean(dsnDetails),dsn_details:dsnDetails};
}

function safeMailboxPartPaths(node,result={text:[],dsn:null}){
  if(!node)return result;
  const mime=String(node.type||'').toLowerCase();
  const type=mime.split('/')[0],subtype=mime.split('/')[1]||String(node.subtype||'').toLowerCase();
  if(String(node.disposition||'').toLowerCase()==='attachment'||node.dispositionParameters?.filename||node.parameters?.name)return result;
  const part={path:String(node.part||'1'),subtype,encoding:node.encoding,charset:node.parameters?.charset||'utf-8'};
  if(type==='text'&&['plain','html'].includes(subtype)&&result.text.length<6)result.text.push(part);
  if(type==='message'&&subtype==='delivery-status'&&!result.dsn)result.dsn=part;
  // Attached messages are not the reply body and must never drive opt-out classification.
  if(type!=='message')for(const child of node.childNodes||[])safeMailboxPartPaths(child,result);
  return result;
}

function decodeMailboxPart(value,part){
  if(!Buffer.isBuffer(value))return '';
  let bytes=value;
  if(/^base64$/i.test(part.encoding||''))bytes=Buffer.from(value.toString('ascii').replace(/\s/g,''),'base64');
  else if(/^quoted-printable$/i.test(part.encoding||'')){
    const raw=value.toString('latin1').replace(/=\r?\n/g,'');
    bytes=Buffer.from(raw.replace(/=([0-9a-f]{2})/gi,(_match,hex)=>String.fromCharCode(parseInt(hex,16))),'latin1');
  }
  let text;
  try{text=new TextDecoder(part.charset).decode(bytes);}catch{text=bytes.toString('utf8');}
  if(part.subtype==='html'){
    const document=load(text);document('script,style,head').remove();document('br').replaceWith('\n');
    document('p,div,li,tr').append('\n');text=document.root().text();
  }
  return text.slice(0,20000);
}

export class SmtpImapProviderAdapter {
  constructor(config={}){
    this.name='SMTP';
    this.enabled=bool(config.enabled??config.smtpEnabled,false);
    this.inboundEnabled=bool(config.inboundEnabled??config.smtpInboundSyncEnabled,false);
    this.controlledTestMode=bool(config.controlledTestMode??config.smtpControlledTestMode,true);
    this.useCaseApproved=bool(config.useCaseApproved??config.smtpUseCaseApproved,false);
    this.smtpHost=clean(config.smtpHost||'');this.smtpPort=Number(config.smtpPort||587);
    this.smtpSecure=bool(config.smtpSecure,false);this.smtpRequireTls=bool(config.smtpRequireTls,true);
    this.smtpUser=normalizedEmail(config.smtpUser||'');this.smtpPassword=String(config.smtpPassword||'');
    this.senderEmail=normalizedEmail(config.senderEmail||this.smtpUser);this.replyToEmail=normalizedEmail(config.replyToEmail||this.senderEmail);
    this.unsubscribeEmail=normalizedEmail(config.unsubscribeEmail||this.replyToEmail);
    this.messageIdDomain=clean(config.messageIdDomain||this.senderEmail.split('@')[1]||'localhost',200);
    this.imapHost=clean(config.imapHost||'');this.imapPort=Number(config.imapPort||993);this.imapTls=bool(config.imapTls,true);
    this.imapUser=normalizedEmail(config.imapUser||this.smtpUser);this.imapPassword=String(config.imapPassword||this.smtpPassword);
    this.imapInbox=clean(config.imapInbox||'INBOX',200);this.imapSentMailbox=clean(config.imapSentMailbox||'Sent',200);
    this.allowlist=new Set(String(config.controlledRecipientAllowlist||'').split(',').map(normalizedEmail).filter(Boolean));
    this.timeoutMs=Math.max(1000,Number(config.timeoutMs)||10_000);
    this.transporterFactory=config.transporterFactory||nodemailer.createTransport;
    this.imapClientFactory=config.imapClientFactory||((options)=>new ImapFlow(options));
    this.completed=new Map();
  }
  configured(){return Boolean(this.smtpHost&&this.smtpUser&&this.smtpPassword&&this.senderEmail&&this.imapHost&&this.imapUser&&this.imapPassword);}
  connectionContract(){
    const errors=[];
    if(this.smtpPort!==587||this.smtpSecure||!this.smtpRequireTls)errors.push('SMTP_STARTTLS_587_REQUIRED');
    if(this.imapPort!==993||!this.imapTls)errors.push('IMAP_TLS_993_REQUIRED');
    if(this.senderEmail!==this.smtpUser)errors.push('SMTP_SENDER_MISMATCH');
    if(this.replyToEmail!==this.smtpUser)errors.push('SMTP_REPLY_TO_MISMATCH');
    return errors;
  }
  capabilities(){return{outbound:true,inbound:true,ambiguous_reconciliation:true,transport:'SMTP_STARTTLS',mailbox:'IMAP_TLS'};}
  validatePurpose(message={}){
    if(!this.enabled)return{allowed:false,code:'SMTP_IMAP_DISABLED'};
    if(!this.configured())return{allowed:false,code:'PROVIDER_NOT_CONFIGURED'};
    const contract=this.connectionContract();if(contract.length)return{allowed:false,code:contract[0]};
    const recipient=normalizedEmail(message.to||message.normalized_recipient);
    if(this.controlledTestMode&&!this.allowlist.has(recipient))return{allowed:false,code:'SMTP_CONTROLLED_RECIPIENT_REQUIRED'};
    if(!this.controlledTestMode&&!this.useCaseApproved)return{allowed:false,code:'SMTP_USE_CASE_NOT_APPROVED'};
    return{allowed:true,code:'PROVIDER_PURPOSE_ALLOWED'};
  }
  #smtp(){return this.transporterFactory({host:this.smtpHost,port:this.smtpPort,secure:false,requireTLS:true,auth:{user:this.smtpUser,pass:this.smtpPassword},connectionTimeout:this.timeoutMs,greetingTimeout:this.timeoutMs,socketTimeout:this.timeoutMs,tls:{servername:this.smtpHost}});}
  #imap({verifyOnly=false}={}){return this.imapClientFactory({host:this.imapHost,port:this.imapPort,secure:true,auth:{user:this.imapUser,pass:this.imapPassword},logger:false,verifyOnly,connectionTimeout:this.timeoutMs,greetingTimeout:this.timeoutMs,socketTimeout:this.timeoutMs,tls:{servername:this.imapHost}});}
  async healthCheck({verifyConnection=false}={}){
    const configured=this.configured();const contract=this.connectionContract();
    if(!configured)return{provider:this.name,configured:false,enabled:this.enabled,ready:false,code:'PROVIDER_NOT_CONFIGURED',network_calls:0};
    if(contract.length)return{provider:this.name,configured:true,enabled:this.enabled,ready:false,code:contract[0],network_calls:0};
    if(!verifyConnection)return{provider:this.name,configured:true,enabled:this.enabled,ready:this.enabled,code:this.enabled?'SMTP_IMAP_READY':'SMTP_IMAP_DISABLED',network_calls:0};
    let smtp=null,imap=null;
    try{smtp=this.#smtp();await smtp.verify();imap=this.#imap({verifyOnly:true});await imap.connect();return{provider:this.name,configured:true,enabled:this.enabled,ready:this.enabled,connection_ready:true,code:'SMTP_IMAP_CONNECTION_READY',network_calls:2};}
    catch(error){return{provider:this.name,configured:true,enabled:this.enabled,ready:false,code:timeoutCode(error)?'SMTP_IMAP_TIMEOUT':'SMTP_IMAP_CONNECTION_FAILED',network_calls:2};}
    finally{await smtp?.close?.();await imap?.logout?.().catch(()=>{});}
  }
  async health(options){return this.healthCheck(options);}
  async send(message={},idempotencyKey){
    const policy=this.validatePurpose(message);if(!policy.allowed)return{status:'BLOCKED',code:policy.code,network_calls:0};
    const key=clean(idempotencyKey,200);if(!key)return{status:'BLOCKED',code:'IDEMPOTENCY_KEY_REQUIRED',network_calls:0};
    if(this.completed.has(key))return{...this.completed.get(key),idempotent_replay:true,network_calls:0};
    const rfcMessageId=stableSmtpMessageId(key,this.messageIdDomain);let transporter;
    try{transporter=this.#smtp();const info=await transporter.sendMail({from:clean(message.from||this.senderEmail,320),to:normalizedEmail(message.to),replyTo:clean(message.reply_to||this.replyToEmail,320),subject:clean(message.subject,500),text:String(message.body_text||''),messageId:rfcMessageId,headers:{'X-DPV-Message-Key':stableSmtpMessageKey(key),'List-Unsubscribe':`<mailto:${this.unsubscribeEmail}?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}});const result={status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_SMTP',provider_message_id:clean(info.messageId||rfcMessageId,500),rfc_message_id:rfcMessageId,send_execution_key:key,network_calls:1};this.completed.set(key,result);return result;}
    catch(error){
      const explicitPreDataRejection=error.code==='EAUTH'||['CONN','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO'].includes(String(error.command||'').toUpperCase());
      return explicitPreDataRejection?{status:'FAILED',code:'SMTP_SEND_FAILED',error_type:'PRE_DATA_REJECTION',rfc_message_id:rfcMessageId,send_execution_key:key,network_calls:1}:
        {status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS',rfc_message_id:rfcMessageId,send_execution_key:key,network_calls:1};
    }
    finally{await transporter?.close?.();}
  }

  async readMailboxChanges({folder=this.imapInbox,checkpoint=null,rescanWindow=100}={}){
    if(!this.inboundEnabled)return{status:'DISABLED',code:'IMAP_INBOUND_SYNC_DISABLED',messages:[],network_calls:0};
    if(!this.configured()||this.connectionContract().length)return{status:'DISABLED',code:'PROVIDER_NOT_CONFIGURED',messages:[],network_calls:0};
    const client=this.#imap();let lock;
    try{
      await client.connect();lock=await client.getMailboxLock(folder,{readOnly:true});
      const mailbox=client.mailbox||{};const uidvalidity=Number(mailbox.uidValidity||mailbox.uidvalidity||0);
      const uidNext=Number(mailbox.uidNext||1);const changed=Boolean(checkpoint?.uidvalidity&&Number(checkpoint.uidvalidity)!==uidvalidity);
      const startUid=(!checkpoint||changed)?Math.max(1,uidNext-Math.max(1,Number(rescanWindow)||100)):Math.max(1,Number(checkpoint.last_processed_uid||0)+1);
      const metadata=[];
      if(uidNext>startUid)for await(const item of client.fetch(`${startUid}:*`,{uid:true,envelope:true,headers:true,bodyStructure:true},{uid:true})){
        if(Number(item.uid)>=startUid)metadata.push(item);
      }
      // Finish FETCH before starting another IMAP command; nested fetchOne can deadlock ImapFlow.
      const messages=[];for(const item of metadata){
        const parts=safeMailboxPartPaths(item.bodyStructure);
        const plain=parts.text.filter(part=>part.subtype==='plain');
        const selected=(plain.length?plain:parts.text.filter(part=>part.subtype==='html')).slice(0,3);
        const requested=[...new Set([...selected.map(part=>part.path),...(parts.dsn?[parts.dsn.path]:[])])];
        const bodyFetch=client.fetchOne&&requested.length?await client.fetchOne(item.uid,{bodyParts:requested},{uid:true}):item;
        const body=selected.map(part=>decodeMailboxPart(bodyFetch?.bodyParts?.get?.(part.path),part)).join('\n');
        const dsnPart=parts.dsn?decodeMailboxPart(bodyFetch?.bodyParts?.get?.(parts.dsn.path),parts.dsn):null;
        const headers=String(item.headers||'').replace(/(?:\r?\n)*$/,'');
        const parsed=parseMailboxSource(`${headers}\r\n\r\n${body}`,item.envelope||{},dsnPart);messages.push({...parsed,uid:Number(item.uid),uidvalidity,folder_path:folder});
      }
      return{status:'COMPLETED',messages,folder_path:folder,uidvalidity,last_processed_uid:messages.reduce((m,x)=>Math.max(m,x.uid),changed?Math.max(0,startUid-1):Number(checkpoint?.last_processed_uid||0)),highest_modseq:mailbox.highestModseq?String(mailbox.highestModseq):null,uidvalidity_changed:changed,network_calls:1};
    }catch(error){return{status:'FAILED',code:timeoutCode(error)?'IMAP_SYNC_TIMEOUT':'IMAP_SYNC_FAILED',messages:[],network_calls:1};}
    finally{lock?.release?.();await client.logout?.().catch(()=>{});}
  }

  async reconcileControlledSent({body_text,subject,from,to,sent_at}={}){
    const canonical=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
    const at=Date.parse(sent_at),body=canonical(body_text);
    const recipient=normalizedEmail(to),sender=normalizedEmail(from);
    if(!this.controlledTestMode||!this.allowlist.has(recipient)||!Number.isFinite(at)||!body||!subject||!sender)
      return {status:'MANUAL_HOLD',code:'CONTROLLED_SENT_RECONCILIATION_INPUT_REQUIRED',network_calls:0};
    const mailbox=await this.readMailboxChanges({folder:this.imapSentMailbox,rescanWindow:100});
    if(mailbox.status!=='COMPLETED')return {status:'MANUAL_HOLD',code:'CONTROLLED_SENT_LOOKUP_FAILED',network_calls:mailbox.network_calls};
    const matches=mailbox.messages.filter(message=>{
      const timestamp=Date.parse(message.date);
      return message.message_id&&message.subject===subject&&canonical(message.body_text)===body
        && normalizedEmail(message.from_address)===sender&&message.to_addresses?.length===1
        && normalizedEmail(message.to_addresses[0])===recipient&&Number.isFinite(timestamp)
        && timestamp>=at-60000&&timestamp<=at+300000;
    });
    if(matches.length!==1)return {status:'MANUAL_HOLD',code:matches.length?'CONTROLLED_SENT_MULTIPLE_MATCHES':'CONTROLLED_SENT_NO_EXACT_MATCH',network_calls:mailbox.network_calls};
    const match=matches[0];
    return {status:'MATCHED',provider_message_id:match.message_id,network_calls:mailbox.network_calls,
      evidence:{method:'CONTROLLED_SENT_EXACT_CONTENT_AND_ENVELOPE',folder_path:this.imapSentMailbox,
        uid:match.uid,uidvalidity:match.uidvalidity,observed_date:match.date,
        canonical_body_sha256:createHash('sha256').update(body).digest('hex'),unique_matches:1}};
  }
}
