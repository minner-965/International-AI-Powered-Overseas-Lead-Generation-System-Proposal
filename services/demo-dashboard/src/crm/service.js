import {buildSalesTaskFromReply} from '../outreach/inbound.js';
import {stableSmtpMessageId,stableSmtpMessageKey} from '../outreach/smtpImapProvider.js';
import {FIRST_TOUCH_SENDER_NAME} from '../outreach/firstTouchTemplates.js';
import {activityOutboxPayload} from './outboxPayloads.js';
import {feishuConfigured} from './feishuBitableAdapter.js';
import {FOLLOWUP_OFFSET_DAYS,MAX_FOLLOWUP_SEQUENCE,renderFollowupTemplate} from './followupTemplates.js';
import {CrmRepository,FOLLOWUP_THREAD_OPEN_SQL,MANUAL_ACTIVITY_TYPES,PIPELINE_STAGES,TASK_STATUSES,TASK_TYPES,crmUuid} from './repository.js';

export const CRM_FOLLOWUP_SCAN_QUEUE='crm-followup-scan';
export const CRM_FOLLOWUP_SEND_QUEUE='crm-followup-send';
export const CRM_SYNC_QUEUE='sync-outreach-to-crm';
const REPLY_INTENTS=Object.freeze(['CATALOGUE','SAMPLE','QUOTATION','MEETING','DEFER','DECLINE','OPT_OUT','AUTO_REPLY','IRRELEVANT','REVIEW']);
const INTENT_TASK_TYPES=Object.freeze({CATALOGUE:'FOLLOW_UP',SAMPLE:'SAMPLE',QUOTATION:'QUOTATION',MEETING:'MEETING',DEFER:'FOLLOW_UP',DECLINE:'REPLY_REVIEW',REVIEW:'REPLY_REVIEW'});

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const bool=(value,fallback=false)=>value===undefined||value===null||value===''?fallback:['1','true','yes','on'].includes(String(value).toLowerCase());
const upper=value=>String(value??'').trim().toUpperCase();
function text(value,label,{required=false,max=1000}={}){
  const cleaned=String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
  if(required&&!cleaned)throw fail('CRM_FIELD_REQUIRED',`${label} is required`);
  if(cleaned.length>max)throw fail('CRM_FIELD_TOO_LONG',`${label} is too long`);
  return cleaned||null;
}
function oneOf(value,allowed,label,{required=true}={}){
  const normalized=upper(value);
  if(!normalized&&!required)return null;
  if(!allowed.includes(normalized))throw fail('CRM_VALUE_INVALID',`${label} is not supported`);
  return normalized;
}
// undefined = leave unchanged, null/'' = clear, otherwise a valid timestamp.
function timestamp(value,label){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw fail('CRM_DATE_INVALID',`${label} must be a valid date`);
  return date.toISOString();
}
// One count for both the send gate and the approval page quota: cold-outreach messages
// (first touch + follow-ups) reserved, sent or ambiguous since the start of the database day.
export async function countColdOutreachToday(queryable){
  return Number((await queryable.query(`SELECT count(*)::int count FROM leadgen.outbound_messages
    WHERE provider_purpose='COLD_OUTREACH' AND send_status IN('SENDING','PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS')
      AND coalesce(sent_at,send_reserved_at,queued_at)>=date_trunc('day',now())`)).rows[0]?.count||0);
}
const actorOf=user=>text(user?.identity,'actor',{required:true,max:200});
const limitOf=value=>Math.min(Math.max(Number.parseInt(value,10)||100,1),500);

export class CrmService{
  // merchantSending: {providerFor(merchantId), emailAllowance(merchantId,client), senderFor(merchantId)}
  // (MerchantService). A merchant's follow-ups go out from the merchant's own mailbox.
  constructor({pool,repository=null,outboundProvider=null,automationControl=null,queue=null,env=process.env,audit=()=>{},merchantSending=null}={}){
    this.repository=repository||new CrmRepository({pool});
    Object.assign(this,{pool,outboundProvider,automationControl,queue,env,audit,merchantSending});
  }

  async listPipeline(query={},scope=null){
    return this.repository.listPipeline({stage:oneOf(query.stage,PIPELINE_STAGES,'stage',{required:false}),
      owner:text(query.owner,'owner',{max:200}),q:text(query.q,'search',{max:200}),limit:limitOf(query.limit),scope});
  }

  async setStage(opportunityId,body={},user,scope=null){
    const stage=oneOf(body.stage,PIPELINE_STAGES,'stage');
    const lostReason=text(body.lost_reason,'lost reason',{max:500});
    if(stage==='LOST'&&!lostReason)throw fail('CRM_LOST_REASON_REQUIRED','A reason is required when an opportunity is lost');
    return this.repository.setStage(crmUuid(opportunityId,'opportunity_id'),{stage,lost_reason:lostReason,note:text(body.note,'note'),
      owner:text(body.owner,'owner',{max:200}),next_action:text(body.next_action,'next action',{max:500}),
      next_action_due_at:timestamp(body.next_action_due_at,'next follow-up'),
      expected_version:body.expected_version===undefined||body.expected_version===null?null:Number(body.expected_version)},actorOf(user),scope);
  }

  async addActivity(opportunityId,body={},user,scope=null){
    const occurredAt=timestamp(body.occurred_at,'occurred at')||new Date().toISOString();
    if(new Date(occurredAt).getTime()>Date.now()+5*60_000)throw fail('CRM_DATE_INVALID','An activity cannot be recorded in the future');
    return this.repository.addActivity(crmUuid(opportunityId,'opportunity_id'),{activity_type:oneOf(body.activity_type,MANUAL_ACTIVITY_TYPES,'activity type'),
      occurred_at:occurredAt,summary:text(body.summary,'summary',{required:true,max:2000}),result:text(body.result,'result',{max:200}),
      next_follow_up_at:timestamp(body.next_follow_up_at,'next follow-up')||null},actorOf(user),scope);
  }

  async timeline(companyId,query={},scope=null){return this.repository.timeline(crmUuid(companyId,'company_id'),{limit:limitOf(query.limit),scope});}

  async listTasks(query={},user,scope=null){
    const due=query.due?oneOf(query.due,['OVERDUE','TODAY','WEEK'],'due').toLowerCase():null;
    const owner=bool(query.mine)?actorOf(user):text(query.owner,'owner',{max:200});
    return this.repository.listTasks({owner,status:oneOf(query.status,TASK_STATUSES,'status',{required:false}),due,
      company_id:query.company_id?crmUuid(query.company_id,'company_id'):null,limit:limitOf(query.limit),scope});
  }

  async createTask(body={},user,scope=null){
    return this.repository.createTask({company_id:crmUuid(body.company_id,'company_id'),task_type:oneOf(body.task_type,TASK_TYPES,'task type'),
      owner:text(body.owner,'owner',{max:200}),due_at:timestamp(body.due_at,'due date')||null,title:text(body.title,'title',{required:true,max:200}),
      next_action:text(body.next_action,'next action',{max:500})},actorOf(user),scope);
  }

  async updateTask(taskId,body={},user,scope=null){
    const input={task_status:oneOf(body.task_status,TASK_STATUSES,'status',{required:false}),owner:text(body.owner,'owner',{max:200}),
      due_at:timestamp(body.due_at,'due date'),note:text(body.note,'note',{max:1000})};
    if(!input.task_status&&!input.owner&&input.due_at===undefined&&!input.note)throw fail('CRM_NO_CHANGE','Nothing to update');
    return this.repository.updateTask(crmUuid(taskId,'task_id'),input,actorOf(user),scope);
  }

  async reviewReply(classificationId,body={},user,scope=null){
    const decision=oneOf(body.decision,['CONFIRM','CORRECT'],'decision');
    const intent=decision==='CORRECT'?oneOf(body.intent,REPLY_INTENTS,'intent'):null;
    return this.repository.reviewReply(crmUuid(classificationId,'classification_id'),{decision,intent},actorOf(user),input=>{
      const built=buildSalesTaskFromReply({classification:{intent:input.intent,sanitized_subject:input.subject,sanitized_body_text:input.body_text},
        company_id:input.company_id,thread_id:input.thread_id});
      return built.create_task?{task:built.task,task_type:INTENT_TASK_TYPES[input.intent]||'REPLY_REVIEW'}:null;
    },scope);
  }

  async listFollowupDrafts(query={},scope=null){
    const status=query.status==='ALL'?null:oneOf(query.status||'PENDING_APPROVAL',['PENDING_APPROVAL','APPROVED','SENDING','SENT','DISCARDED','BLOCKED'],'status');
    return this.repository.listFollowupDrafts({status,limit:limitOf(query.limit),scope});
  }

  followupDailyLimit(){return Number(this.env.CRM_FOLLOWUP_DAILY_LIMIT||50);}
  async followupQuota(scope=null){
    if(scope?.restrict&&this.merchantSending){
      const allowance=await this.merchantSending.emailAllowance(scope.merchantId);
      const sent_today=Number(allowance.sent_today??0);const daily_limit=Number(allowance.daily_limit??allowance.merchant?.daily_email_quota??0);
      return{sent_today,daily_limit,remaining:Math.max(0,daily_limit-sent_today)};
    }
    const daily_limit=this.followupDailyLimit();
    const sent_today=await countColdOutreachToday(this.pool);
    return{sent_today,daily_limit,remaining:Math.max(0,daily_limit-sent_today)};
  }

  async decideFollowupDraft(draftId,body={},user,scope=null){
    const decision=oneOf(body.decision,['APPROVE','DISCARD'],'decision');
    const draft=await this.repository.decideFollowupDraft(crmUuid(draftId,'draft_id'),{decision,
      subject:text(body.subject,'subject',{max:240}),body_text:text(body.body_text,'body',{max:12000}),reason:text(body.reason,'reason',{max:500})},actorOf(user),scope);
    if(draft.draft_status==='APPROVED'&&this.queue)
      await this.queue.enqueue(CRM_FOLLOWUP_SEND_QUEUE,{draft_id:draft.id},{singletonKey:`crm-followup-send:${draft.id}`});
    return draft;
  }

  // Queues prospect CRM rows that are pending or due for a retry. Rows are written in the same
  // transaction as the business change; this keeps delivery going after restarts and retries.
  async dispatchCrmOutbox({limit=50}={}){
    const provider=upper(this.env.CRM_PROVIDER);
    const configured=provider==='FEISHU'?feishuConfigured(this.env):Boolean(String(this.env.CRM_BASE_URL||'').trim()&&String(this.env.CRM_API_KEY||'').trim()&&!/REPLACE_WITH|NOT_CONFIGURED/i.test(`${this.env.CRM_BASE_URL}|${this.env.CRM_API_KEY}`));
    if(!configured)return{status:'NOT_CONFIGURED',queued:0};
    const rows=(await this.pool.query(`SELECT id,attempt_count FROM leadgen.crm_sync_outbox
      WHERE record_scope='PROSPECT' AND merchant_id IS NULL AND sync_status IN('PENDING','RETRYABLE_ERROR') AND coalesce(next_attempt_at,now())<=now()
      ORDER BY created_at LIMIT $1`,[Math.min(Math.max(Number(limit)||50,1),200)])).rows;
    for(const row of rows)await this.queue.enqueue(CRM_SYNC_QUEUE,{outbox_id:row.id},{singletonKey:`crm:dispatch:${row.id}:${row.attempt_count}`});
    return{status:'COMPLETED',queued:rows.length};
  }

  // Creates PENDING_APPROVAL drafts only; nothing is sent from a scan.
  async scanFollowups({now=new Date()}={}){
    if(!bool(this.env.CRM_FOLLOWUP_DRAFTS_ENABLED,false))return{status:'DISABLED',created:0};
    const maxSequence=Math.min(Number(this.env.CRM_FOLLOWUP_MAX_SEQUENCE||MAX_FOLLOWUP_SEQUENCE),MAX_FOLLOWUP_SEQUENCE);
    const candidates=await this.repository.dueFollowupCandidates({offsets:FOLLOWUP_OFFSET_DAYS,maxSequence,now});
    let created=0;const skipped=[];
    for(const candidate of candidates){
      try{
        const sender=candidate.merchant_id&&this.merchantSending?await this.merchantSending.senderFor(candidate.merchant_id):null;
        const rendered=renderFollowupTemplate({sequence_no:candidate.sequence_no,company_name:candidate.company_name,product_profile:candidate.product_profile,reply_to:candidate.reply_to,sender});
        if(await this.repository.insertFollowupDraft({...candidate,...rendered}))created+=1;
      }catch(error){skipped.push({thread_id:candidate.thread_id,code:error.code||'CRM_FOLLOWUP_RENDER_FAILED'});}
    }
    // Approved drafts that waited (email paused, daily limit, sender change) are retried here;
    // sending re-checks every condition and is idempotent per draft.
    const approved=(await this.pool.query(`SELECT id FROM leadgen.crm_followup_drafts WHERE draft_status='APPROVED' ORDER BY approved_at LIMIT 50`)).rows;
    if(this.queue)for(const row of approved)await this.queue.enqueue(CRM_FOLLOWUP_SEND_QUEUE,{draft_id:row.id},{singletonKey:`crm-followup-send:${row.id}`});
    return{status:'COMPLETED',created,skipped,requeued:approved.length};
  }

  async sendApprovedFollowup({draft_id}){
    const id=crmUuid(draft_id,'draft_id');
    const policy=this.automationControl?await this.automationControl.getState():null;
    if(policy?.auto_first_touch_email!==true)return{status:'WAITING',code:'EMAIL_PAUSED',draft_id:id};
    const owner=(await this.pool.query('SELECT merchant_id FROM leadgen.crm_followup_drafts WHERE id=$1',[id])).rows[0]?.merchant_id||null;
    let provider=this.outboundProvider;let fromName=FIRST_TOUCH_SENDER_NAME;
    if(owner){
      if(!this.merchantSending)return{status:'WAITING',code:'MERCHANT_MAILBOX_NOT_VERIFIED',draft_id:id};
      try{const context=await this.merchantSending.providerFor(owner);provider=context.provider;fromName=context.fromName;}
      catch(error){return{status:'WAITING',code:error.code||'MERCHANT_MAILBOX_NOT_VERIFIED',draft_id:id};}
    }
    if(!provider?.senderEmail)return{status:'WAITING',code:'SENDER_NOT_CONFIGURED',draft_id:id};
    const dailyLimit=this.followupDailyLimit();
    const prepared=await this.repository.transaction(async client=>{
      const draft=(await client.query('SELECT * FROM leadgen.crm_followup_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!draft)throw fail('CRM_FOLLOWUP_NOT_FOUND','Follow-up draft not found',404);
      if(draft.draft_status!=='APPROVED')return{replay:true,draft};
      const thread=(await client.query(`SELECT t.id,r.normalized_recipient,r.reply_to,r.sender_identity,first.rfc_message_id first_rfc
        FROM leadgen.outreach_threads t JOIN leadgen.phase13_first_touch_reservations r ON r.id=t.first_touch_reservation_id
        LEFT JOIN leadgen.outbound_messages first ON first.first_touch_reservation_id=r.id
        WHERE t.id=$1 AND ${FOLLOWUP_THREAD_OPEN_SQL}`,[draft.thread_id])).rows[0];
      if(!thread){
        await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status='BLOCKED',reason_codes=ARRAY['THREAD_NOT_OPEN'],updated_at=now() WHERE id=$1`,[id]);
        return{blocked:'THREAD_NOT_OPEN'};
      }
      if(thread.sender_identity!==provider.senderEmail||thread.reply_to!==provider.replyToEmail)return{waiting:'SENDER_CHANGED'};
      if(owner){
        // Per-merchant daily email quota (first touch and follow-ups of that merchant).
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`merchant:email-quota:${owner}`]);
        const allowance=await this.merchantSending.emailAllowance(owner,client);
        if(!allowance.allowed)return{waiting:allowance.code};
      }else{
        const sentToday=await countColdOutreachToday(client);
        if(sentToday>=dailyLimit)return{waiting:'DAILY_LIMIT_REACHED'};
      }
      const key=`crm-followup:${id}`;
      const message=(await client.query(`INSERT INTO leadgen.outbound_messages(company_id,followup_draft_id,provider,provider_purpose,idempotency_key,send_execution_key,
          rfc_message_id,message_key_header,send_status,send_reserved_at,reason_codes)
        VALUES($1,$2,'SMTP','COLD_OUTREACH',$3,$3,$4,$5,'SENDING',now(),'{}') RETURNING *`,
        [draft.company_id,id,key,stableSmtpMessageId(key,provider.messageIdDomain),stableSmtpMessageKey(key)])).rows[0];
      const attempt=(await client.query(`INSERT INTO leadgen.outbound_message_attempts(outbound_message_id,attempt_number,attempt_status,provider,provider_call_started_at)
        VALUES($1,1,'STARTED','SMTP',now()) RETURNING *`,[message.id])).rows[0];
      await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status='SENDING',updated_at=now() WHERE id=$1`,[id]);
      return{draft,thread,message,attempt};
    });
    if(prepared.replay)return{status:prepared.draft.draft_status,draft_id:id,idempotent_replay:true};
    if(prepared.blocked)return{status:'BLOCKED',code:prepared.blocked,draft_id:id};
    if(prepared.waiting)return{status:'WAITING',code:prepared.waiting,draft_id:id};
    // A committed SENDING row forbids replay after a crash or ambiguous SMTP outcome.
    let result;
    try{
      result=await provider.send({from:`${fromName} <${prepared.thread.sender_identity}>`,to:prepared.thread.normalized_recipient,
        reply_to:prepared.thread.reply_to,subject:prepared.draft.subject,body_text:prepared.draft.body_text,in_reply_to:prepared.thread.first_rfc||null,
        purpose:'COLD_OUTREACH',send_scope:'PROSPECT_PILOT'},prepared.message.idempotency_key);
    }catch{result={status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS'};}
    const status=['PROVIDER_ACCEPTED','FAILED','BLOCKED'].includes(result.status)?result.status:'AMBIGUOUS';
    await this.repository.transaction(async client=>{
      await client.query(`UPDATE leadgen.outbound_message_attempts SET attempt_status=$2,reason_codes=$3::text[],completed_at=now() WHERE id=$1`,
        [prepared.attempt.id,status==='PROVIDER_ACCEPTED'?'ACCEPTED':'PERMANENT_ERROR',[result.code||status]]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status=$2,transport_status=$3,provider_message_id=$4,
          sent_at=CASE WHEN $2='PROVIDER_ACCEPTED' THEN now() ELSE sent_at END,ambiguous_since=CASE WHEN $2='AMBIGUOUS' THEN now() ELSE NULL END,
          reason_codes=$5::text[],updated_at=now() WHERE id=$1`,
        [prepared.message.id,status,status==='PROVIDER_ACCEPTED'?'SMTP_ACCEPTED':status==='AMBIGUOUS'?'SEND_AMBIGUOUS':'SEND_FAILED',
          status==='PROVIDER_ACCEPTED'?result.provider_message_id||null:null,[result.code||status]]);
      await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status=$2,reason_codes=$3::text[],updated_at=now() WHERE id=$1`,
        [id,status==='PROVIDER_ACCEPTED'?'SENT':'BLOCKED',[result.code||status]]);
      if(status==='PROVIDER_ACCEPTED'){
        const activity=(await client.query(`INSERT INTO leadgen.opportunity_activities(company_id,activity_type,owner_identity,details,idempotency_key,occurred_at,recorded_by)
          VALUES($1,'CONTACTED',$2,$3::jsonb,$4,now(),$2) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [prepared.draft.company_id,prepared.draft.approved_by,JSON.stringify({channel:'EMAIL',summary:`Follow-up email ${prepared.draft.sequence_no} sent`,
            followup_draft_id:id,outbound_message_id:prepared.message.id}),`crm-followup:${id}:contacted`])).rows[0];
        await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
          VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now()) ON CONFLICT(idempotency_key) DO NOTHING`,
          [prepared.draft.company_id,JSON.stringify(activityOutboxPayload({activity_type:'CONTACTED',summary:`Follow-up email ${prepared.draft.sequence_no} sent`,
            owner:prepared.draft.approved_by,references:{activity:activity?.id,outbound:prepared.message.id}})),`crm-followup:${id}:crm`]);
      }
    });
    // A merchant mailbox problem never pauses SIM's sending; the draft is BLOCKED with the reason.
    if(status!=='PROVIDER_ACCEPTED'&&!owner)await this.automationControl?.pauseEmail?.(result.code||status);
    this.audit('crm_followup_send',{draft_id:id,status});
    return{status,draft_id:id,outbound_message_id:prepared.message.id};
  }
}
