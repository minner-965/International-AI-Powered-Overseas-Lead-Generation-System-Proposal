import {createHash} from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import {ImapFlow} from 'imapflow';

const text=value=>String(value??'').trim();
const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const sha=value=>createHash('sha256').update(String(value||'')).digest('hex');
const timeoutMs=Math.max(1000,number(process.env.OUTBOUND_EMAIL_TIMEOUT_MS,10_000));
const smtpHost=text(process.env.SMTP_HOST);
const imapHost=text(process.env.IMAP_HOST);
const smtpUser=text(process.env.SMTP_USER);
const smtpPassword=String(process.env.SMTP_PASSWORD||'');
const imapUser=text(process.env.IMAP_USER);
const imapPassword=String(process.env.IMAP_PASSWORD||'');
const smokeMessageId=text(process.env.OQUMAIL_SMOKE_MESSAGE_ID);

function assertConfigured(){
  if(!smtpHost||!imapHost||!smtpUser||!smtpPassword||!imapUser||!imapPassword)throw new Error('MAILBOX_CONFIGURATION_INCOMPLETE');
  if(number(process.env.SMTP_PORT,587)!==587||/^(1|true|yes|on)$/i.test(text(process.env.SMTP_SECURE))||!(/^(1|true|yes|on)$/i.test(text(process.env.SMTP_REQUIRE_TLS))))throw new Error('SMTP_STARTTLS_587_REQUIRED');
  if(number(process.env.IMAP_PORT,993)!==993||!/^(1|true|yes|on)$/i.test(text(process.env.IMAP_TLS)))throw new Error('IMAP_TLS_993_REQUIRED');
}

class ReplyReader {
  constructor(socket){this.socket=socket;this.buffer='';this.current=[];this.queue=[];this.waiters=[];this.onData=chunk=>this.#push(chunk);socket.on('data',this.onData);}
  #push(chunk){
    this.buffer+=chunk.toString('utf8');let index;
    while((index=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,index+1).replace(/[\r\n]+$/,'');this.buffer=this.buffer.slice(index+1);this.current.push(line);
      if(/^\d{3} /.test(line)){const reply={code:Number(line.slice(0,3)),lines:this.current};this.current=[];const waiter=this.waiters.shift();if(waiter)waiter(reply);else this.queue.push(reply);}
    }
  }
  next(){if(this.queue.length)return Promise.resolve(this.queue.shift());return new Promise(resolve=>this.waiters.push(resolve));}
  close(){this.socket.off('data',this.onData);}
}

function openSocket(host,port){return new Promise((resolve,reject)=>{
  const socket=net.connect({host,port});const timer=setTimeout(()=>{socket.destroy();reject(new Error('SMTP_CONNECT_TIMEOUT'));},timeoutMs);
  socket.once('error',error=>{clearTimeout(timer);reject(error);});socket.once('connect',()=>{clearTimeout(timer);resolve(socket);});
});}
function upgradeSocket(socket,host){return new Promise((resolve,reject)=>{
  const secure=tls.connect({socket,servername:host,rejectUnauthorized:true,minVersion:'TLSv1.2'});const timer=setTimeout(()=>{secure.destroy();reject(new Error('SMTP_TLS_TIMEOUT'));},timeoutMs);
  secure.once('error',error=>{clearTimeout(timer);reject(error);});secure.once('secureConnect',()=>{clearTimeout(timer);resolve(secure);});
});}
async function smtpCapabilityProbe(){
  let plain;let secure;let reader;
  try{
    plain=await openSocket(smtpHost,587);reader=new ReplyReader(plain);const greeting=await reader.next();
    if(greeting.code!==220)throw new Error('SMTP_GREETING_REJECTED');
    plain.write('EHLO dpv-capability-probe.local\r\n');const beforeTls=await reader.next();
    if(beforeTls.code!==250)throw new Error('SMTP_EHLO_REJECTED');
    const advertised=beforeTls.lines.map(line=>line.replace(/^250[- ]/,'').split(/[ =]/)[0].toUpperCase()).filter(Boolean);
    if(!advertised.includes('STARTTLS'))throw new Error('SMTP_STARTTLS_NOT_ADVERTISED');
    plain.write('STARTTLS\r\n');const startTls=await reader.next();if(startTls.code!==220)throw new Error('SMTP_STARTTLS_REJECTED');
    reader.close();secure=await upgradeSocket(plain,smtpHost);reader=new ReplyReader(secure);
    secure.write('EHLO dpv-capability-probe.local\r\n');const afterTls=await reader.next();if(afterTls.code!==250)throw new Error('SMTP_TLS_EHLO_REJECTED');
    const cert=secure.getPeerCertificate(true)||{};const authLines=afterTls.lines.filter(line=>/^250[- ]AUTH(?:=|\s)/i.test(line));
    secure.write('QUIT\r\n');const quit=await reader.next();
    return {greeting_code:greeting.code,starttls_advertised:true,auth_advertised:authLines.length>0,tls_protocol:secure.getProtocol(),certificate_verified:secure.authorized===true,certificate_fingerprint_sha256:cert.fingerprint256?sha(cert.fingerprint256):null,quit_code:quit.code};
  } finally {reader?.close();secure?.destroy();if(!secure)plain?.destroy();}
}

function folderKind(folder){
  const special=String(folder.specialUse||'').toLowerCase();
  if(special==='\\inbox'||/^inbox$/i.test(folder.path))return 'INBOX';
  if(special==='\\sent')return 'SENT';if(special==='\\drafts')return 'DRAFTS';if(special==='\\trash')return 'TRASH';if(special==='\\junk')return 'JUNK';if(special==='\\archive')return 'ARCHIVE';return 'OTHER';
}
function statusOf(folder){const status=folder.status||folder;return {uid_validity:status.uidValidity===undefined?null:String(status.uidValidity),uid_next:status.uidNext===undefined?null:String(status.uidNext),highest_modseq:status.highestModseq===undefined?null:String(status.highestModseq),messages:status.messages===undefined?null:Number(status.messages)};}
async function imapCapabilityProbe(){
  const client=new ImapFlow({host:imapHost,port:993,secure:true,auth:{user:imapUser,pass:imapPassword},logger:false,disableAutoIdle:true,
    connectionTimeout:timeoutMs,greetingTimeout:timeoutMs,socketTimeout:timeoutMs,tls:{servername:imapHost,rejectUnauthorized:true,minVersion:'TLSv1.2'}});
  try{
    await client.connect();const listed=await client.list({statusQuery:{messages:true,uidNext:true,uidValidity:true,highestModseq:true}});
    const folders=listed.map(folder=>({kind:folderKind(folder),path:folder.path,delimiter:folder.delimiter||null,special_use:folder.specialUse||null,...statusOf(folder)}));
    const sent=listed.find(folder=>folderKind(folder)==='SENT');let sentLookup={status:'UNKNOWN',source:'NOT_FOUND'};
    if(sent){
      const opened=await client.mailboxOpen(sent.path,{readOnly:true});const mailbox={...statusOf(opened)};
      if(smokeMessageId){
        const uids=await client.search({all:true},{uid:true});let matches=0;
        for await(const item of client.fetch(uids,{uid:true,envelope:true},{uid:true}))if(String(item.envelope?.messageId||'')===smokeMessageId)matches+=1;
        sentLookup={status:matches?'YES':'NO',source:'SPECIAL_USE',message_id_sha256:sha(smokeMessageId),matches,mailbox};
      }
      else sentLookup={status:'UNKNOWN',source:'SPECIAL_USE_MESSAGE_ID_NOT_CONFIGURED',mailbox};
    }
    const capabilitySet=client.capabilities instanceof Map?[...client.capabilities.keys()].map(value=>String(value).toUpperCase()):[];
    return {folders,capabilities:{idle:capabilitySet.includes('IDLE'),condstore:capabilitySet.includes('CONDSTORE'),qresync:capabilitySet.includes('QRESYNC')},sent_auto_save:sentLookup};
  } finally {await client.logout().catch(()=>{});}
}

assertConfigured();
const [smtp,imap]=await Promise.all([smtpCapabilityProbe(),imapCapabilityProbe()]);
console.log(JSON.stringify({observed_at:new Date().toISOString(),operation:'READ_ONLY_CAPABILITY_PROBE',smtp,imap},null,2));
