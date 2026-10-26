import {createHash} from 'node:crypto';
import {renderFirstTouchTemplate,FIRST_TOUCH_SENDER_NAME} from './firstTouchTemplates.js';
import {evaluatePhase13EmailEligibility,phase13EmailQueueState} from './phase13EmailEligibility.js';
import {stableSmtpMessageId} from './smtpImapProvider.js';
import {activityOutboxPayload} from '../crm/outboxPayloads.js';

export const AUTO_FIRST_TOUCH_QUEUE='send-auto-first-touch';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
export class AutoFirstTouchService {
 // merchantSending (MerchantService): a merchant's first touch is reserved and sent from the
 // merchant's own verified mailbox, signed with its sender name and company, within its daily quota.
 constructor({pool,queue,outboundProvider,automationControl,loadEligibilityFacts,env={},merchantSending=null}){Object.assign(this,{pool,queue,outboundProvider,automationControl,loadEligibilityFacts,env,merchantSending});}
 async senderContext(merchantId=null){
  if(!merchantId)return{merchantId:null,provider:this.outboundProvider,sender:null,fromName:FIRST_TOUCH_SENDER_NAME};
  if(!this.merchantSending)throw fail('MERCHANT_MAILBOX_NOT_VERIFIED');
  const context=await this.merchantSending.providerFor(merchantId);
  return{merchantId,provider:context.provider,sender:context.sender,fromName:context.fromName,merchant:context.merchant||null,mailbox:context.mailbox||null};
 }
 // A merchant's automatic first touch needs the merchant's own opt-in and a mailbox that is not
 // held after a failed send. The reservation function checks the same again in the database.
 merchantSendingBlock(ctx){
  if(!ctx.merchantId)return null;
  if(ctx.merchant&&ctx.merchant.auto_first_touch_enabled!==true)return'MERCHANT_AUTO_FIRST_TOUCH_OFF';
  if(ctx.mailbox?.sending_hold_at)return'MERCHANT_MAILBOX_HELD';
  return null;
 }
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async evaluate(companyId,{reservationId=null,client=this.pool,context=null}={}){
  if(!this.loadEligibilityFacts)throw fail('FIRST_TOUCH_FACT_LOADER_REQUIRED');
  const ctx=context||await this.senderContext(null);
  const facts=await this.loadEligibilityFacts(companyId,{reservationId,client,...(ctx.merchantId?{merchantId:ctx.merchantId,replyToEmail:ctx.provider.replyToEmail}:{})});
  const policy=await this.automationControl.getState();
  const health=await ctx.provider.health({verifyConnection:false});
  const eligibility=evaluatePhase13EmailEligibility(facts,{...policy,sender_ready:health.ready===true});
  return{facts,policy,eligibility,queue_status:phase13EmailQueueState({eligibility,has_email:Boolean(facts.recipient?.normalized_recipient),contact_progress_status:facts.contact_progress_status})};
 }
 async reserve(companyId,{merchantId=null}={}){
  const ctx=await this.senderContext(merchantId);
  const block=this.merchantSendingBlock(ctx);if(block)throw fail(block);
  const state=await this.evaluate(companyId,{context:ctx});if(!state.eligibility.eligible)return state;
  const {facts,eligibility}=state;
  const draft=renderFirstTouchTemplate({template_key:eligibility.template_key,variables:facts.template_variables,verified_fields:facts.verified_template_fields,sender:ctx.sender});
  const sender=ctx.provider.senderEmail,reply=ctx.provider.replyToEmail;
  if(!sender||!reply||facts.template_variables.reply_to!==reply)throw fail('FIRST_TOUCH_SENDER_MISMATCH');
  const reservation=await this.transaction(async c=>{
   const args=[companyId,eligibility.policy_revision,facts.recipient.decision_maker_contact_id||facts.recipient.id||null,eligibility.normalized_recipient,facts.market.market_code,draft.template_set_key,draft.template_key,sender,reply,draft.subject,draft.body_text,draft.content_hash,JSON.stringify({...eligibility,category_id:facts.category_id,product_profile:facts.product_profile}),[]];
   let r;
   if(ctx.merchantId){
    const allowance=await this.merchantSending.emailAllowance(ctx.merchantId,c);
    if(!allowance.allowed&&allowance.code!=='MERCHANT_EMAIL_QUOTA_EXCEEDED')throw fail(allowance.code);
    if(allowance.merchant&&allowance.merchant.auto_first_touch_enabled!==true)throw fail('MERCHANT_AUTO_FIRST_TOUCH_OFF');
    r=(await c.query('SELECT * FROM leadgen.reserve_phase13_first_touch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[],$15::uuid,$16::integer)',
     [...args,ctx.merchantId,allowance.merchant.daily_email_quota])).rows[0];
   }else r=(await c.query('SELECT * FROM leadgen.reserve_phase13_first_touch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[])',args)).rows[0];
   const key=`phase13-first-touch:${r.id}`,rfc=stableSmtpMessageId(key,ctx.provider.messageIdDomain);
   await c.query(`INSERT INTO leadgen.outbound_messages(company_id,approval_id,recipient_id,first_touch_reservation_id,provider,provider_purpose,idempotency_key,send_execution_key,rfc_message_id,send_status,reason_codes)
    VALUES($1,NULL,$3,$2,'SMTP','COLD_OUTREACH',$4,$4,$5,'QUEUED','{}') ON CONFLICT(first_touch_reservation_id) DO NOTHING`,[companyId,r.id,facts.recipient.outreach_recipient_id||null,key,rfc]);
   await c.query(`INSERT INTO leadgen.outreach_threads(company_id,recipient_id,first_touch_reservation_id,thread_token,thread_status)
    VALUES($1,$2,$3,$4,'OPEN') ON CONFLICT(first_touch_reservation_id) DO NOTHING`,
    [companyId,facts.recipient.outreach_recipient_id||null,r.id,`phase13-auto-first-touch:${r.id}`]);
   return r;
  });
  // A durable RESERVED row is the replay source if queue publication fails.
  if(reservation.status==='RESERVED')await this.queue.enqueue(AUTO_FIRST_TOUCH_QUEUE,{reservation_id:reservation.id},{singletonKey:reservation.id});
  return{...state,reservation};
 }
 async dispatchPending(){const rows=(await this.pool.query("SELECT id FROM leadgen.phase13_first_touch_reservations WHERE status='RESERVED' ORDER BY created_at LIMIT 50")).rows;for(const r of rows)await this.queue.enqueue(AUTO_FIRST_TOUCH_QUEUE,{reservation_id:r.id},{singletonKey:r.id});return{dispatched:rows.length};}
 async get(id){return(await this.pool.query('SELECT * FROM leadgen.phase13_first_touch_reservations WHERE id=$1',[id])).rows[0]||null;}
 async recoverStalledReservations(){
  const ids=await this.transaction(async c=>{
   const rows=(await c.query("UPDATE leadgen.phase13_first_touch_reservations SET status='AMBIGUOUS',reason_codes=ARRAY['SMTP_SEND_INTERRUPTED'],completed_at=now() WHERE status='SENDING' AND provider_call_started_at<now()-interval '10 minutes' RETURNING id,merchant_id")).rows;
   for(const row of rows)await c.query("UPDATE leadgen.outbound_messages SET send_status='AMBIGUOUS',transport_status='SEND_AMBIGUOUS',business_contact_status='SEND_AMBIGUOUS',ambiguous_since=coalesce(ambiguous_since,now()),reason_codes=ARRAY['SMTP_SEND_INTERRUPTED'],updated_at=now() WHERE first_touch_reservation_id=$1 AND send_status='SENDING'",[row.id]);
   return rows;
  });
  // SIM's mailbox stalled: pause SIM's automatic first touch. A merchant's mailbox stalled: hold
  // only that merchant's mailbox; SIM and every other merchant keep sending.
  const simStalled=ids.some(row=>!row.merchant_id);
  const merchantIds=[...new Set(ids.filter(row=>row.merchant_id).map(row=>row.merchant_id))];
  if(simStalled)await this.automationControl.pauseEmail('SMTP_SEND_INTERRUPTED');
  const held=[];
  for(const merchantId of merchantIds){
   if(!this.merchantSending?.holdMailbox)continue;
   await this.merchantSending.holdMailbox(merchantId,'SMTP_SEND_INTERRUPTED');held.push(merchantId);
  }
  return{ambiguous_reservations:ids.map(row=>row.id),email_paused:simStalled,held_merchants:held};
 }
 async sendReservation(id){
  const existing=await this.get(id);if(!existing)throw fail('FIRST_TOUCH_RESERVATION_NOT_FOUND');
  if(existing.status!=='RESERVED')return{reservation:existing,idempotent_replay:true};
  const ctx=await this.senderContext(existing.merchant_id||null);
  // Merchant switched automatic first touch off, or its mailbox is held: keep the reservation
  // queued without sending; it goes out (after a fresh check) once the merchant resumes.
  const block=this.merchantSendingBlock(ctx);if(block)return{reservation:existing,held:true,reason_codes:[block]};
  const current=await this.evaluate(existing.company_id,{reservationId:id,context:ctx});
  if(!current.eligibility.eligible)return{...current,reservation:existing};
  if(current.eligibility.policy_revision!==existing.policy_revision||current.eligibility.normalized_recipient!==existing.normalized_recipient||current.eligibility.template_key!==existing.template_key||ctx.provider.senderEmail!==existing.sender_identity||ctx.provider.replyToEmail!==existing.reply_to)throw fail('FIRST_TOUCH_FROZEN_IDENTITY_MISMATCH');
  const frozen=renderFirstTouchTemplate({template_key:existing.template_key,variables:current.facts.template_variables,verified_fields:current.facts.verified_template_fields,sender:ctx.sender});
  if(frozen.content_hash!==existing.content_hash)throw fail('FIRST_TOUCH_CONTENT_CHANGED');
  const attempt=await this.transaction(async c=>{
   const r=(await c.query('SELECT * FROM leadgen.phase13_first_touch_reservations WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(r.status!=='RESERVED')return null;
   const gate=await this.evaluate(r.company_id,{reservationId:id,client:c,context:ctx});if(!gate.eligibility.eligible)return null;
   const latest=renderFirstTouchTemplate({template_key:gate.eligibility.template_key,variables:gate.facts.template_variables,verified_fields:gate.facts.verified_template_fields,sender:ctx.sender});
   if(gate.eligibility.policy_revision!==r.policy_revision||gate.eligibility.normalized_recipient!==r.normalized_recipient||latest.content_hash!==r.content_hash)throw fail('FIRST_TOUCH_FROZEN_IDENTITY_MISMATCH');
   const m=(await c.query('SELECT * FROM leadgen.outbound_messages WHERE first_touch_reservation_id=$1 FOR UPDATE',[id])).rows[0];if(!m||m.send_status!=='QUEUED')throw fail('FIRST_TOUCH_OUTBOUND_STATE_CONFLICT');
   const a=(await c.query("INSERT INTO leadgen.outbound_message_attempts(outbound_message_id,attempt_number,attempt_status,provider,provider_call_started_at) VALUES($1,1,'STARTED','SMTP',now()) RETURNING *",[m.id])).rows[0];
   await c.query("UPDATE leadgen.phase13_first_touch_reservations SET status='SENDING',provider_call_started_at=now(),rfc_message_id=$2 WHERE id=$1",[id,m.rfc_message_id]);
   await c.query("UPDATE leadgen.outbound_messages SET send_status='SENDING',send_reserved_at=now(),updated_at=now() WHERE id=$1",[m.id]);
   return{a,m,r};
  });
  if(!attempt)return{reservation:await this.get(id),idempotent_replay:true};
  // The committed provider marker forbids all replay after a crash or ambiguous SMTP outcome.
  let result;try{result=await ctx.provider.send({from:`${ctx.fromName} <${existing.sender_identity}>`,to:existing.normalized_recipient,reply_to:existing.reply_to,subject:existing.subject,body_text:existing.body_text,purpose:'COLD_OUTREACH',send_scope:'PROSPECT_PILOT'},attempt.m.idempotency_key);}catch{result={status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS'};}
  const status=['PROVIDER_ACCEPTED','FAILED','BLOCKED'].includes(result.status)?result.status:'AMBIGUOUS';
  const transport=status==='PROVIDER_ACCEPTED'?'SMTP_ACCEPTED':status==='AMBIGUOUS'?'SEND_AMBIGUOUS':'SEND_FAILED';
  await this.transaction(async c=>{
   await c.query('UPDATE leadgen.phase13_first_touch_reservations SET status=$2,completed_at=now(),reason_codes=$3::text[] WHERE id=$1',[id,status,[result.code||status]]);
   await c.query(`UPDATE leadgen.outbound_message_attempts SET attempt_status=$2,reason_codes=$3::text[],completed_at=now() WHERE id=$1`,[attempt.a.id,status==='PROVIDER_ACCEPTED'?'ACCEPTED':'PERMANENT_ERROR',[result.code||status]]);
   await c.query(`UPDATE leadgen.outbound_messages SET send_status=$2,transport_status=$3,business_contact_status=$4,provider_message_id=$5,sent_at=CASE WHEN $2='PROVIDER_ACCEPTED' THEN now() ELSE sent_at END,ambiguous_since=CASE WHEN $2='AMBIGUOUS' THEN now() ELSE NULL END,reason_codes=$6::text[],updated_at=now() WHERE id=$1`,[attempt.m.id,status,transport,status==='PROVIDER_ACCEPTED'?'SENT_NO_REPLY':transport,result.provider_message_id||null,[result.code||status]]);
   await c.query(`INSERT INTO leadgen.email_message_events(outbound_message_id,event_type,occurred_at,event_digest) VALUES($1,$2,now(),$3) ON CONFLICT(event_digest) DO NOTHING`,[attempt.m.id,status==='AMBIGUOUS'?'FAILED':status,hash(`${id}:${status}`)]);
   if(status==='PROVIDER_ACCEPTED'){
    const activity=(await c.query(`INSERT INTO leadgen.opportunity_activities
      (company_id,opportunity_snapshot_id,activity_type,owner_identity,details,idempotency_key)
      SELECT $1,opportunity.id,'CONTACTED','phase13-automation',$2::jsonb,$3
      FROM (SELECT 1) seed LEFT JOIN LATERAL(
        SELECT current.id FROM leadgen.business_opportunity_current current
        WHERE current.company_id=$1 AND current.product_profile=$4 ORDER BY current.id LIMIT 1
      ) opportunity ON true ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,opportunity_snapshot_id`,
      [existing.company_id,JSON.stringify({channel:'EMAIL',outbound_message_id:attempt.m.id,first_touch_reservation_id:id,template_set_key:existing.template_set_key}),`phase13-first-touch:${id}:contacted`,existing.eligibility_snapshot?.product_profile||'WOMENSWEAR'])).rows[0];
    if(activity?.opportunity_snapshot_id)await c.query(`INSERT INTO leadgen.opportunity_crm_states
      (opportunity_snapshot_id,company_id,funnel_status,owner_identity,next_action,next_action_due_at,merchant_id)
      VALUES($1,$2,'CONTACTED','phase13-automation','AWAIT_REPLY',NULL,$3)
      ON CONFLICT(opportunity_snapshot_id,merchant_key) DO UPDATE SET funnel_status=CASE WHEN leadgen.opportunity_crm_states.funnel_status='CONTACTED' THEN 'CONTACTED' ELSE leadgen.opportunity_crm_states.funnel_status END,
        owner_identity=coalesce(leadgen.opportunity_crm_states.owner_identity,EXCLUDED.owner_identity),version=leadgen.opportunity_crm_states.version+1,updated_at=now()`,[activity.opportunity_snapshot_id,existing.company_id,existing.merchant_id||null]);
    await c.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
      VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now()) ON CONFLICT(idempotency_key) DO NOTHING`,
      [existing.company_id,JSON.stringify(activityOutboxPayload({activity_type:'CONTACTED',owner:'phase13-automation',references:{activity:activity?.id,outbound:attempt.m.id,funnel:'CONTACTED'}})),`phase13-first-touch:${id}:crm:contacted`]);
   }
  });
  // A merchant mailbox failure blocks that reservation only; SIM's sending keeps running.
  if(status!=='PROVIDER_ACCEPTED'&&!existing.merchant_id)await this.automationControl.pauseEmail(result.code||status);
  // An ambiguous result from a merchant mailbox holds that mailbox (never SIM's control).
  if(status==='AMBIGUOUS'&&existing.merchant_id&&this.merchantSending?.holdMailbox)await this.merchantSending.holdMailbox(existing.merchant_id,result.code||'SMTP_SEND_AMBIGUOUS');
  return{reservation:await this.get(id),outbound_message_id:attempt.m.id,transport_status:transport};
 }
}
