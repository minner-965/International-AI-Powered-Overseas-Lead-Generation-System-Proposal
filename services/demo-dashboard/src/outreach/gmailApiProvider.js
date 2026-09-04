import { createHash } from 'node:crypto';

const cleanHeader = (value, maximum = 998) => String(value ?? '').replace(/[\r\n]+/g,' ').trim().slice(0,maximum);
const base64url = value => Buffer.from(value).toString('base64url');
const decodeBase64url = value => Buffer.from(String(value || ''),'base64url').toString('utf8');
const bool = (value, fallback = false) => value === undefined || value === null || value === ''
  ? fallback : /^(1|true|yes|on)$/i.test(String(value));

function headerMap(headers = []) {
  return Object.fromEntries((headers || []).map(item => [String(item?.name || '').toLowerCase(),String(item?.value || '')]));
}

function bodyText(part = {}) {
  if (part?.body?.data && /^text\/plain/i.test(String(part.mimeType || ''))) return decodeBase64url(part.body.data);
  for (const child of part?.parts || []) {
    const value = bodyText(child);
    if (value) return value;
  }
  if (part?.body?.data) return decodeBase64url(part.body.data);
  return '';
}

function flattenParts(part = {}) {
  return [part,...(part.parts || []).flatMap(flattenParts)];
}

function structuredDsn(part = {}) {
  const reportType=/^multipart\/report/i.test(String(part.mimeType||''))
    && /report-type\s*=\s*delivery-status/i.test(String(part.mimeType||''));
  const deliveryPart=flattenParts(part).find(item=>/^message\/delivery-status/i.test(String(item.mimeType||'')));
  if(!reportType||!deliveryPart?.body?.data)return null;
  const value=decodeBase64url(deliveryPart.body.data);
  const recipient=value.match(/^(?:Original|Final)-Recipient:\s*(?:[^;]+;\s*)?([^\r\n]+)/im)?.[1]?.trim()||null;
  const status=value.match(/^Status:\s*([245]\.\d+\.\d+)/im)?.[1]||null;
  const diagnostic=value.match(/^Diagnostic-Code:\s*([^\r\n]+)/im)?.[1]?.trim()||null;
  if(!recipient||!status)return null;
  return{recipient,status,diagnostic_code:diagnostic,bounce_class:status.startsWith('5.')?'HARD':'SOFT'};
}

export function stableGmailMessageId(idempotencyKey, domain = 'dpvinternational.com') {
  const digest=createHash('sha256').update(String(idempotencyKey || '')).digest('hex').slice(0,40);
  const safeDomain=cleanHeader(domain,200).toLowerCase().replace(/[^a-z0-9.-]/g,'')||'dpvinternational.com';
  return `<dpv-${digest}@${safeDomain}>`;
}

export function buildGmailMime(message = {}, idempotencyKey, { messageIdDomain, unsubscribeEmail } = {}) {
  const messageId=stableGmailMessageId(idempotencyKey,messageIdDomain);
  const correlationKey=createHash('sha256').update(String(idempotencyKey || '')).digest('base64url');
  const from=cleanHeader(message.from,320);const to=cleanHeader(message.to,320);
  const replyTo=cleanHeader(message.reply_to||message.from,320);const subject=cleanHeader(message.subject,500);
  const stopAddress=cleanHeader(unsubscribeEmail||replyTo,320);
  const lines=[`From: ${from}`,`To: ${to}`,`Reply-To: ${replyTo}`,`Subject: ${subject}`,
    `Message-ID: ${messageId}`,`X-DPV-Message-Key: ${correlationKey}`,
    `List-Unsubscribe: <mailto:${stopAddress}?subject=unsubscribe>`,`List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',String(message.body_text||'')];
  return {raw:base64url(lines.join('\r\n')),message_id:messageId,correlation_key:correlationKey};
}

export class GmailApiProviderAdapter {
  constructor(config = {}) {
    this.name='GMAIL_API';
    this.enabled=bool(config.enabled ?? config.gmailApiEnabled,false);
    this.inboundEnabled=bool(config.inboundEnabled ?? config.gmailInboundSyncEnabled,false);
    this.controlledTestMode=bool(config.controlledTestMode ?? config.gmailControlledTestMode,true);
    this.useCaseApproved=bool(config.useCaseApproved ?? config.gmailUseCaseApproved,false);
    this.clientId=String(config.clientId||'');this.clientSecret=String(config.clientSecret||'');
    this.refreshToken=String(config.refreshToken||'');this.senderEmail=String(config.senderEmail||'').trim().toLowerCase();
    this.replyToEmail=String(config.replyToEmail||this.senderEmail).trim().toLowerCase();
    this.unsubscribeEmail=String(config.unsubscribeEmail||this.replyToEmail).trim().toLowerCase();
    this.messageIdDomain=String(config.messageIdDomain||this.senderEmail.split('@')[1]||'dpvinternational.com');
    this.allowlist=new Set(String(config.controlledRecipientAllowlist||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
    this.fetchImpl=config.fetchImpl||globalThis.fetch;this.timeoutMs=Math.max(1000,Number(config.timeoutMs)||10_000);
    this.tokenEndpoint=String(config.tokenEndpoint||'https://oauth2.googleapis.com/token');
    this.apiBase=String(config.apiBase||'https://gmail.googleapis.com/gmail/v1/users/me').replace(/\/$/,'');
    this.accessToken=null;this.accessTokenExpiresAt=0;this.completed=new Map();
  }

  configured(){return Boolean(this.clientId&&this.clientSecret&&this.refreshToken&&this.senderEmail&&typeof this.fetchImpl==='function');}
  capabilities(){return{outbound:true,inbound:true,drafts:true,ambiguous_reconciliation:true,purposes:['COLD_OUTREACH','OPT_IN','TRANSACTIONAL'],controlled_test_mode:this.controlledTestMode};}
  validatePurpose(message={}){
    if(!this.enabled)return{allowed:false,code:'GMAIL_API_DISABLED'};
    if(!this.configured())return{allowed:false,code:'PROVIDER_NOT_CONFIGURED'};
    const recipient=String(message.to||message.normalized_recipient||'').trim().toLowerCase();
    if(this.controlledTestMode&&!this.allowlist.has(recipient))return{allowed:false,code:'GMAIL_CONTROLLED_RECIPIENT_REQUIRED'};
    if(!this.controlledTestMode&&!this.useCaseApproved)return{allowed:false,code:'GMAIL_USE_CASE_NOT_APPROVED'};
    return{allowed:true,code:'PROVIDER_PURPOSE_ALLOWED'};
  }

  async #fetch(url,options={}){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{return await this.fetchImpl(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
  }
  async #token(){
    if(this.accessToken&&Date.now()<this.accessTokenExpiresAt-30_000)return this.accessToken;
    if(!this.configured())throw Object.assign(new Error('Gmail OAuth is not configured'),{code:'PROVIDER_NOT_CONFIGURED'});
    const response=await this.#fetch(this.tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.clientId,client_secret:this.clientSecret,refresh_token:this.refreshToken,grant_type:'refresh_token'})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.access_token)throw Object.assign(new Error('Gmail OAuth refresh failed'),{code:`GMAIL_OAUTH_HTTP_${response.status}`});
    this.accessToken=String(payload.access_token);this.accessTokenExpiresAt=Date.now()+Math.max(60,Number(payload.expires_in)||3600)*1000;
    return this.accessToken;
  }
  async #api(path,options={}){
    const execute=async()=>this.#fetch(`${this.apiBase}${path}`,{...options,headers:{authorization:`Bearer ${await this.#token()}`,'content-type':'application/json',...(options.headers||{})}});
    let response=await execute();if(response.status===401){this.accessToken=null;this.accessTokenExpiresAt=0;response=await execute();}
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error('Gmail API request failed'),{code:`GMAIL_API_HTTP_${response.status}`,http_status:response.status});
    return payload;
  }

  async healthCheck({verifyOAuth=false}={}){
    const configured=this.configured();
    if(!configured)return{provider:this.name,configured:false,enabled:this.enabled,ready:false,code:'PROVIDER_NOT_CONFIGURED',network_calls:0};
    if(!this.enabled&&!verifyOAuth)return{provider:this.name,configured:true,enabled:false,ready:false,code:'GMAIL_API_DISABLED',network_calls:0};
    try{const profile=await this.#api('/profile');return{provider:this.name,configured:true,enabled:this.enabled,ready:this.enabled,email_matches:String(profile.emailAddress||'').toLowerCase()===this.senderEmail,code:'GMAIL_OAUTH_READY',network_calls:2};}
    catch(error){return{provider:this.name,configured:true,enabled:this.enabled,ready:false,code:error.code||'GMAIL_HEALTH_FAILED',network_calls:1};}
  }
  async health(options){return this.healthCheck(options);}

  async createProviderDraft(message={},idempotencyKey){
    const policy=this.validatePurpose(message);if(!policy.allowed)return{status:'BLOCKED',code:policy.code,network_calls:0};
    const mime=buildGmailMime(message,idempotencyKey,this);
    const payload=await this.#api('/drafts',{method:'POST',body:JSON.stringify({message:{raw:mime.raw}})});
    return{status:'DRAFT_CREATED',code:'GMAIL_DRAFT_CREATED',provider_draft_id:payload.id||null,provider_message_id:payload.message?.id||null,rfc_message_id:mime.message_id,network_calls:1};
  }

  async sendApprovedMessage(message={},idempotencyKey){
    const policy=this.validatePurpose(message);if(!policy.allowed)return{status:'BLOCKED',code:policy.code,network_calls:0};
    const key=String(idempotencyKey||'').trim();if(!key)return{status:'BLOCKED',code:'IDEMPOTENCY_KEY_REQUIRED',network_calls:0};
    if(this.completed.has(key))return{...this.completed.get(key),idempotent_replay:true,network_calls:0};
    const mime=buildGmailMime(message,key,this);
    try{
      const payload=await this.#api('/messages/send',{method:'POST',body:JSON.stringify({raw:mime.raw})});
      const result={status:'PROVIDER_ACCEPTED',code:'ACCEPTED_BY_GMAIL',provider_message_id:payload.id||null,
        provider_thread_id:payload.threadId||null,rfc_message_id:mime.message_id,send_execution_key:key,network_calls:1};
      this.completed.set(key,result);return result;
    }catch(error){
      if(error?.name==='AbortError'||error?.code==='PROVIDER_TIMEOUT')return{status:'AMBIGUOUS',code:'GMAIL_SEND_AMBIGUOUS',rfc_message_id:mime.message_id,send_execution_key:key,network_calls:1};
      return{status:'FAILED',code:error.code||'GMAIL_API_ERROR',http_status:error.http_status,error_type:'NETWORK_ERROR',rfc_message_id:mime.message_id,send_execution_key:key,network_calls:1};
    }
  }
  async send(message,idempotencyKey){return this.sendApprovedMessage(message,idempotencyKey);}

  async reconcileAmbiguousSend({rfcMessageId}={}){
    const id=cleanHeader(rfcMessageId,300);if(!id)return{status:'BLOCKED',code:'RFC_MESSAGE_ID_REQUIRED',network_calls:0};
    const payload=await this.#api(`/messages?q=${encodeURIComponent(`rfc822msgid:${id} in:sent`)}&maxResults=2`);
    const match=payload.messages?.[0];return match
      ?{status:'PROVIDER_ACCEPTED',code:'GMAIL_SENT_RECONCILED',provider_message_id:match.id,provider_thread_id:match.threadId||null,rfc_message_id:id,network_calls:1}
      :{status:'NOT_FOUND',code:'GMAIL_SENT_NOT_FOUND',rfc_message_id:id,network_calls:1};
  }

  async fetchMessage(id){
    const payload=await this.#api(`/messages/${encodeURIComponent(String(id))}?format=full`);const headers=headerMap(payload.payload?.headers);
    const dsnDetails=structuredDsn(payload.payload);
    return{provider:'GMAIL_API',provider_message_id:payload.id,provider_thread_id:payload.threadId||null,history_id:payload.historyId||null,
      occurred_at:payload.internalDate?new Date(Number(payload.internalDate)).toISOString():new Date().toISOString(),from:headers.from||'',to:headers.to||'',
      subject:headers.subject||'',in_reply_to:headers['in-reply-to']||null,references:headers.references||null,message_id:headers['message-id']||null,
      body_text:bodyText(payload.payload),automatic:/auto-submitted|x-autoreply|x-autorespond/i.test(Object.keys(headers).join('|'))||/auto-replied/i.test(headers['auto-submitted']||''),
      dsn:Boolean(dsnDetails),dsn_details:dsnDetails,attachments:flattenParts(payload.payload).filter(part=>part.filename).map(part=>({attachment_id:part.body?.attachmentId,content_type:part.mimeType,size_bytes:part.body?.size||0}))};
  }

  async readMailboxChanges({historyId=null}={}){
    if(!this.inboundEnabled)return{status:'DISABLED',code:'GMAIL_INBOUND_SYNC_DISABLED',messages:[],history_id:historyId,network_calls:0};
    let ids=[];let latest=historyId;
    if(historyId){const payload=await this.#api(`/history?startHistoryId=${encodeURIComponent(String(historyId))}&historyTypes=messageAdded&labelId=INBOX`);
      ids=[...new Set((payload.history||[]).flatMap(item=>item.messagesAdded||[]).map(item=>item.message?.id).filter(Boolean))];latest=payload.historyId||historyId;
    }else{const payload=await this.#api('/messages?labelIds=INBOX&q=newer_than%3A1d&maxResults=25');ids=(payload.messages||[]).map(item=>item.id);latest=payload.resultSizeEstimate===0?historyId:null;}
    const messages=[];for(const id of ids)messages.push(await this.fetchMessage(id));
    return{status:'COMPLETED',messages,history_id:latest||messages.at(-1)?.history_id||historyId,network_calls:1+ids.length};
  }
}
