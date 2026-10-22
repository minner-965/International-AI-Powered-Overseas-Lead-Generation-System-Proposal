import {createHash} from 'node:crypto';
import {renderFirstTouchTemplate,FIRST_TOUCH_SENDER_NAME} from './firstTouchTemplates.js';
import {evaluatePhase13EmailEligibility,phase13EmailQueueState} from './phase13EmailEligibility.js';
import {stableSmtpMessageId} from './smtpImapProvider.js';
import {activityOutboxPayload} from '../crm/outboxPayloads.js';

export const AUTO_FIRST_TOUCH_QUEUE='send-auto-first-touch';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
export class AutoFirstTouchService {
 constructor({pool,queue,outboundProvider,automationControl,loadEligibilityFacts,env={}}){Object.assign(this,{pool,queue,outboundProvider,automationControl,loadEligibilityFacts,env});}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async evaluate(companyId,{reservationId=null,client=this.pool}={}){
  if(!this.loadEligibilityFacts)throw fail('FIRST_TOUCH_FACT_LOADER_REQUIRED');
  const facts=await this.loadEligibilityFacts(companyId,{reservationId,client});
  const policy=await this.automationControl.getState();
  const health=await this.outboundProvider.health({verifyConnection:false});
  const eligibility=evaluatePhase13EmailEligibility(facts,{...policy,sender_ready:health.ready===true});
  return{facts,policy,eligibility,queue_status:phase13EmailQueueState({eligibility,has_email:Boolean(facts.recipient?.normalized_recipient),contact_progress_status:facts.contact_progress_status})};
 }
 async reserve(companyId){
  const state=await this.evaluate(companyId);if(!state.eligibility.eligible)return state;
  const {facts,eligibility}=state;
  const draft=renderFirstTouchTemplate({template_key:eligibility.template_key,variables:facts.template_variables,verified_fields:facts.verified_template_fields});
  const sender=this.outboundProvider.senderEmail,reply=this.outboundProvider.replyToEmail;
  if(!sender||!reply||facts.template_variables.reply_to!==reply)throw fail('FIRST_TOUCH_SENDER_MISMATCH');
  const reservation=await this.transaction(async c=>{
   const r=(await c.query('SELECT * FROM leadgen.reserve_phase13_first_touch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[])',
    [companyId,eligibility.policy_revision,facts.recipient.decision_maker_contact_id||facts.recipient.id||null,eligibility.normalized_recipient,facts.market.market_code,draft.template_set_key,draft.template_key,sender,reply,draft.subject,draft.body_text,draft.content_hash,JSON.stringify({...eligibility,category_id:facts.category_id,product_profile:facts.product_profile}),[]])).rows[0];
   const key=`phase13-first-touch:${r.id}`,rfc=stableSmtpMessageId(key,this.outboundProvider.messageIdDomain);
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
   const rows=(await c.query("UPDATE leadgen.phase13_first_touch_reservations SET status='AMBIGUOUS',reason_codes=ARRAY['SMTP_SEND_INTERRUPTED'],completed_at=now() WHERE status='SENDING' AND provider_call_started_at<now()-interval '10 minutes' RETURNING id")).rows;
   for(const row of rows)await c.query("UPDATE leadgen.outbound_messages SET send_status='AMBIGUOUS',transport_status='SEND_AMBIGUOUS',business_contact_status='SEND_AMBIGUOUS',ambiguous_since=coalesce(ambiguous_since,now()),reason_codes=ARRAY['SMTP_SEND_INTERRUPTED'],updated_at=now() WHERE first_touch_reservation_id=$1 AND send_status='SENDING'",[row.id]);
   return rows.map(row=>row.id);
  });
  if(ids.length)await this.automationControl.pauseEmail('SMTP_SEND_INTERRUPTED');
  return{ambiguous_reservations:ids};
 }
 async sendReservation(id){
  const existing=await this.get(id);if(!existing)throw fail('FIRST_TOUCH_RESERVATION_NOT_FOUND');
  if(existing.status!=='RESERVED')return{reservation:existing,idempotent_replay:true};
  const current=await this.evaluate(existing.company_id,{reservationId:id});
  if(!current.eligibility.eligible)return{...current,reservation:existing};
  if(current.eligibility.policy_revision!==existing.policy_revision||current.eligibility.normalized_recipient!==existing.normalized_recipient||current.eligibility.template_key!==existing.template_key||this.outboundProvider.senderEmail!==existing.sender_identity||this.outboundProvider.replyToEmail!==existing.reply_to)throw fail('FIRST_TOUCH_FROZEN_IDENTITY_MISMATCH');
  const frozen=renderFirstTouchTemplate({template_key:existing.template_key,variables:current.facts.template_variables,verified_fields:current.facts.verified_template_fields});
  if(frozen.content_hash!==existing.content_hash)throw fail('FIRST_TOUCH_CONTENT_CHANGED');
  const attempt=await this.transaction(async c=>{
   const r=(await c.query('SELECT * FROM leadgen.phase13_first_touch_reservations WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(r.status!=='RESERVED')return null;
   const gate=await this.evaluate(r.company_id,{reservationId:id,client:c});if(!gate.eligibility.eligible)return null;
   const latest=renderFirstTouchTemplate({template_key:gate.eligibility.template_key,variables:gate.facts.template_variables,verified_fields:gate.facts.verified_template_fields});
   if(gate.eligibility.policy_revision!==r.policy_revision||gate.eligibility.normalized_recipient!==r.normalized_recipient||latest.content_hash!==r.content_hash)throw fail('FIRST_TOUCH_FROZEN_IDENTITY_MISMATCH');
   const m=(await c.query('SELECT * FROM leadgen.outbound_messages WHERE first_touch_reservation_id=$1 FOR UPDATE',[id])).rows[0];if(!m||m.send_status!=='QUEUED')throw fail('FIRST_TOUCH_OUTBOUND_STATE_CONFLICT');
   const a=(await c.query("INSERT INTO leadgen.outbound_message_attempts(outbound_message_id,attempt_number,attempt_status,provider,provider_call_started_at) VALUES($1,1,'STARTED','SMTP',now()) RETURNING *",[m.id])).rows[0];
   await c.query("UPDATE leadgen.phase13_first_touch_reservations SET status='SENDING',provider_call_started_at=now(),rfc_message_id=$2 WHERE id=$1",[id,m.rfc_message_id]);
   await c.query("UPDATE leadgen.outbound_messages SET send_status='SENDING',send_reserved_at=now(),updated_at=now() WHERE id=$1",[m.id]);
   return{a,m,r};
  });
  if(!attempt)return{reservation:await this.get(id),idempotent_replay:true};
  // The committed provider marker forbids all replay after a crash or ambiguous SMTP outcome.
  let result;try{result=await this.outboundProvider.send({from:`${FIRST_TOUCH_SENDER_NAME} <${existing.sender_identity}>`,to:existing.normalized_recipient,reply_to:existing.reply_to,subject:existing.subject,body_text:existing.body_text,purpose:'COLD_OUTREACH',send_scope:'PROSPECT_PILOT'},attempt.m.idempotency_key);}catch{result={status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS'};}
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
      (opportunity_snapshot_id,company_id,funnel_status,owner_identity,next_action,next_action_due_at)
      VALUES($1,$2,'CONTACTED','phase13-automation','AWAIT_REPLY',NULL)
      ON CONFLICT(opportunity_snapshot_id) DO UPDATE SET funnel_status=CASE WHEN leadgen.opportunity_crm_states.funnel_status='CONTACTED' THEN 'CONTACTED' ELSE leadgen.opportunity_crm_states.funnel_status END,
        owner_identity=coalesce(leadgen.opportunity_crm_states.owner_identity,EXCLUDED.owner_identity),version=leadgen.opportunity_crm_states.version+1,updated_at=now()`,[activity.opportunity_snapshot_id,existing.company_id]);
    await c.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
      VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now()) ON CONFLICT(idempotency_key) DO NOTHING`,
      [existing.company_id,JSON.stringify(activityOutboxPayload({activity_type:'CONTACTED',owner:'phase13-automation',references:{activity:activity?.id,outbound:attempt.m.id,funnel:'CONTACTED'}})),`phase13-first-touch:${id}:crm:contacted`]);
   }
  });
  if(status!=='PROVIDER_ACCEPTED')await this.automationControl.pauseEmail(result.code||status);
  return{reservation:await this.get(id),outbound_message_id:attempt.m.id,transport_status:transport};
 }
}
