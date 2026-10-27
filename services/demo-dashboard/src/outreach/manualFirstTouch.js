// B1: human-approved first touch for manually added companies.
// Draft (approved template, real variables) -> a person approves -> sent at once from SIM's mailbox
// or the merchant's own mailbox. The send is an ordinary first touch: a
// phase13_first_touch_reservations row (source MANUAL, never RESERVED, so the automatic dispatcher
// never picks it up), an outbound_messages row with a stable Message-ID and an OPEN outreach thread.
// Reply correlation, "already contacted", the 30-day recipient cooldown, follow-up drafts, the CRM
// timeline and the Feishu outbox therefore work exactly as for automatic first touches.
// Suppression, opt-out, hard bounce, sender quotas and the test-recipient allowlist are checked
// on the server immediately before sending.
import {createHash} from 'node:crypto';
import {FIRST_TOUCH_SENDER_NAME,FIRST_TOUCH_TEMPLATE_SET,renderFirstTouchTemplate,selectFirstTouchTemplate} from './firstTouchTemplates.js';
import {stableSmtpMessageId,stableSmtpMessageKey} from './smtpImapProvider.js';
import {activityOutboxPayload} from '../crm/outboxPayloads.js';
import {countColdOutreachToday} from '../crm/service.js';
import {ManualCompanyService} from '../companies/manualCompanyService.js';
import {RECIPIENT_COOLDOWN_DAYS,TEMPLATE_KEYS,fail,humanCategory,isAdmin,normalizeEmail,ownerOf,parseAllowlist,
  recipientHash,recipientProblem,transaction,uuidOf} from '../companies/common.js';

const ACTIVE_RESERVATION=`('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')`;
const sha=value=>createHash('sha256').update(value).digest('hex');

/** Template for a manually entered mailbox: named person -> A, department of an importer/wholesaler/
 *  distributor -> B, otherwise C (company mailbox). The person entering it vouches for the address. */
export function manualTemplateKey({contact={},companyType=''}={}){
  const kind=contact.contact_type;
  const recipient={normalized_recipient:contact.email,verification_status:'VALID',official_source_verified:true,domain_verified:true,
    generic_mailbox:kind==='GENERIC_BUSINESS_EMAIL'||contact.is_generic===true,
    named_person_verified:kind==='BUSINESS_EMAIL'&&Boolean(contact.person_name),
    recipient_type:kind==='BUSINESS_EMAIL'?'NAMED_BUYER_EMAIL':kind==='DEPARTMENT_EMAIL'?'OFFICIAL_DEPARTMENT_EMAIL':'OFFICIAL_COMPANY_EMAIL'};
  return selectFirstTouchTemplate({recipient,company_types:[String(companyType||'').toUpperCase()]})||'C_OFFICIAL_GENERIC_MAILBOX';
}

/** Variables for the approved template from a manual company record. */
export function manualTemplateVariables({company,contact,replyTo}){
  const category=humanCategory(company.normalized_category);
  const firstName=String(contact?.person_name||'').trim().split(/\s+/)[0]||null;
  const variables={category,target_category:category,matched_category:category,company:company.company_name,market:company.country_name,reply_to:replyTo,first_name:firstName};
  return{variables,verified_fields:Object.keys(variables).filter(key=>variables[key])};
}

export class ManualFirstTouchService{
  // merchantSending: MerchantService ({providerFor, emailAllowance, holdMailbox}).
  constructor({pool,outboundProvider,merchantSending=null,automationControl=null,companies=null,env=process.env,queue=null,audit=()=>{},followupSettings=null}={}){
    Object.assign(this,{pool,outboundProvider,merchantSending,automationControl,env,queue,audit,followupSettings});
    this.companies=companies||new ManualCompanyService({pool,env,queue,audit});
  }

  // SIM's daily cold-outreach limit: the follow-up settings saved on the settings page (072), else the environment.
  async dailyLimit(){return this.followupSettings?Number(await this.followupSettings.dailyLimit()):Number(this.env.CRM_FOLLOWUP_DAILY_LIMIT||50);}

  async senderContext(owner){
    if(!owner){
      if(!this.outboundProvider?.senderEmail)throw fail('SENDER_NOT_CONFIGURED','The sending mailbox is not set up',409);
      return{owner:null,provider:this.outboundProvider,sender:null,fromName:FIRST_TOUCH_SENDER_NAME,mailbox:null};
    }
    if(!this.merchantSending)throw fail('MERCHANT_MAILBOX_NOT_VERIFIED','Bind and test the sending mailbox first',409);
    const context=await this.merchantSending.providerFor(owner);
    return{owner,provider:context.provider,sender:context.sender,fromName:context.fromName,mailbox:context.mailbox||null};
  }

  // A merchant approves its own first touch; SIM approves SIM's. SIM viewing a merchant cannot.
  ownerForSending(scope){
    if(isAdmin(scope)&&scope?.restrict)throw fail('MERCHANT_SELF_SERVICE_ONLY','Only the merchant can send from its own mailbox',403);
    return ownerOf(scope);
  }

  async contactOf(client,companyId,contactId){
    const contact=(await client.query(`SELECT dc.id,dc.contact_type,lower(btrim(dc.contact_value_normalized)) email,nullif(dc.source_url,'') source_url,dc.is_generic,
        dm.person_name,dm.department_name
      FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
      WHERE dc.id=$1 AND dc.company_id=$2 AND dc.evidence_origin='MANUAL_ENTRY'
        AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')`,[contactId,companyId])).rows[0];
    if(!contact)throw fail('CONTACT_NOT_FOUND','Choose one of the company\'s mailboxes',404);
    return contact;
  }

  render({company,contact,provider,sender,templateKey}){
    const key=templateKey?String(templateKey).trim().toUpperCase():manualTemplateKey({contact,companyType:company.company_type});
    if(!TEMPLATE_KEYS.includes(key))throw fail('TEMPLATE_INVALID','Choose template A, B or C',422,{field:'template_key'});
    if(key==='A_NAMED_BUYER'&&!(contact.contact_type==='BUSINESS_EMAIL'&&contact.person_name))
      throw fail('TEMPLATE_NEEDS_NAMED_CONTACT','Template A needs a named person',422,{field:'template_key'});
    const {variables,verified_fields}=manualTemplateVariables({company,contact,replyTo:provider.replyToEmail});
    return renderFirstTouchTemplate({template_key:key,variables,verified_fields,sender});
  }

  /** Reasons the mail must not go out now (company, recipient and sender side). Empty = may send. */
  async blockers(client,{company,contact,owner,ctx,draft=null}){
    const reasons=[];const recipient=normalizeEmail(contact.email);const hash=recipientHash(recipient);
    if(company.lifecycle_status!=='ACTIVE')reasons.push('COMPANY_NOT_ACTIVE');
    const problem=recipientProblem({email:recipient,companyDomain:company.normalized_domain,sourceUrl:contact.source_url,isTest:company.is_test,allowlist:parseAllowlist(this.env.TEST_RECIPIENT_ALLOWLIST)});
    if(problem)reasons.push(problem);
    const facts=(await client.query(`SELECT
        EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=$1 AND s.lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.lifted_at IS NULL AND (s.normalized_recipient_hash=$3
          OR (s.company_id=$1 AND (s.decision_maker_contact_id=$4 OR s.suppression_type IN('OPT_OUT','COMPLAINT')))))
        OR EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.lifted_at IS NULL AND s.normalized_recipient_hash=$3 AND s.suppression_type<>'HARD_BOUNCE') suppressed,
        EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.lifted_at IS NULL AND s.normalized_recipient_hash=$3 AND s.suppression_type='HARD_BOUNCE')
        OR EXISTS(SELECT 1 FROM leadgen.outbound_messages m JOIN leadgen.phase13_first_touch_reservations r ON r.id=m.first_touch_reservation_id
          WHERE m.send_status='HARD_BOUNCED' AND lower(btrim(r.normalized_recipient))=$2) hard_bounced,
        EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE r.company_id=$1 AND r.merchant_id IS NOT DISTINCT FROM $5::uuid)
        OR EXISTS(SELECT 1 FROM leadgen.outbound_messages m WHERE m.company_id=$1 AND m.merchant_id IS NOT DISTINCT FROM $5::uuid
          AND (m.sent_at IS NOT NULL OR m.send_status IN('SENDING','PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS'))) already_contacted,
        EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE lower(btrim(r.normalized_recipient))=$2
          AND r.status IN ${ACTIVE_RESERVATION} AND r.reserved_at>=now()-make_interval(days=>${RECIPIENT_COOLDOWN_DAYS})) recently_contacted,
        ($5::uuid IS NULL AND EXISTS(SELECT 1 FROM leadgen.merchant_companies mc WHERE mc.company_id=$1)) assigned_to_merchant`,
      [company.id,recipient,hash,contact.id,owner])).rows[0];
    if(facts.suppressed)reasons.push('SUPPRESSED');
    if(facts.hard_bounced)reasons.push('HARD_BOUNCED');
    if(facts.already_contacted)reasons.push('ALREADY_FIRST_CONTACTED');
    // The test recipient list belongs to SIM; it is exempt from the cross-sender cooldown.
    if(facts.recently_contacted&&!company.is_test)reasons.push('RECIPIENT_RECENTLY_CONTACTED');
    if(facts.assigned_to_merchant)reasons.push('COMPANY_ASSIGNED_TO_MERCHANT');
    if(ctx){
      if(!ctx.provider?.senderEmail||!ctx.provider?.replyToEmail)reasons.push('SENDER_NOT_CONFIGURED');
      if(draft&&(draft.sender_identity!==ctx.provider.senderEmail||draft.reply_to!==ctx.provider.replyToEmail))reasons.push('SENDER_CHANGED');
      if(ctx.mailbox?.sending_hold_at)reasons.push('MERCHANT_MAILBOX_HELD');
      const policy=typeof ctx.provider?.validatePurpose==='function'?ctx.provider.validatePurpose({to:recipient,purpose:'COLD_OUTREACH'}):{allowed:true};
      if(!policy.allowed)reasons.push(policy.code||'SENDER_NOT_READY');
    }
    return[...new Set(reasons)];
  }

  async createDraft(companyId,body={},actor,scope){
    const owner=this.ownerForSending(scope);
    const contactId=uuidOf(body.contact_id,'contact_id');
    const ctx=await this.senderContext(owner);
    return transaction(this.pool,async client=>{
      const company=await this.companies.requireManualCompany(client,companyId,scope,{lock:true});
      const contact=await this.contactOf(client,company.id,contactId);
      const reasons=await this.blockers(client,{company,contact,owner,ctx});
      if(reasons.length)throw fail('FIRST_TOUCH_NOT_ALLOWED','This email cannot be sent now',409,{reason_codes:reasons});
      if((await client.query(`SELECT 1 FROM leadgen.manual_first_touch_drafts WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid
        AND draft_status IN('PENDING_APPROVAL','SENDING')`,[company.id,owner])).rowCount)
        throw fail('DRAFT_ALREADY_OPEN','A first email for this company is already waiting for approval',409);
      const draft=this.render({company,contact,provider:ctx.provider,sender:ctx.sender,templateKey:body.template_key});
      return(await client.query(`INSERT INTO leadgen.manual_first_touch_drafts(company_id,merchant_id,decision_maker_contact_id,normalized_recipient,template_set_key,template_key,
          subject,body_text,content_hash,sender_identity,reply_to,product_profile,is_test_company,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [company.id,owner,contact.id,contact.email,draft.template_set_key,draft.template_key,draft.subject,draft.body_text,draft.content_hash,
          ctx.provider.senderEmail,ctx.provider.replyToEmail,company.product_profile,company.is_test,actor])).rows[0];
    });
  }

  async listDrafts(query={},scope){
    const status=String(query.status||'PENDING_APPROVAL').toUpperCase();
    const params=[status==='ALL'?null:status];
    let where='($1::text IS NULL OR d.draft_status=$1)';
    if(scope?.restrict){params.push(scope.merchantId);where+=` AND d.merchant_id=$${params.length}::uuid`;}
    return{items:(await this.pool.query(`SELECT d.*,c.company_name,c.country_code FROM leadgen.manual_first_touch_drafts d JOIN leadgen.companies c ON c.id=d.company_id
      WHERE ${where} ORDER BY d.created_at DESC LIMIT 200`,params)).rows};
  }

  /** body.decision: APPROVE (send now) or DISCARD. */
  async decide(draftId,body={},actor,scope){
    const id=uuidOf(draftId,'draft_id');
    const decision=String(body.decision||'').trim().toUpperCase();
    if(!['APPROVE','DISCARD'].includes(decision))throw fail('DECISION_INVALID','decision must be APPROVE or DISCARD',422);
    const owner=this.ownerForSending(scope);
    if(decision==='DISCARD')return transaction(this.pool,async client=>{
      const draft=await this.lockDraft(client,id,owner);
      return(await client.query(`UPDATE leadgen.manual_first_touch_drafts SET draft_status='DISCARDED',decided_by=$2,decided_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[draft.id,actor])).rows[0];
    });
    return this.approveAndSend(id,owner,actor,scope);
  }

  async lockDraft(client,id,owner){
    const draft=(await client.query(`SELECT * FROM leadgen.manual_first_touch_drafts WHERE id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`,[id,owner])).rows[0];
    if(!draft)throw fail('DRAFT_NOT_FOUND','Draft not found',404);
    if(draft.draft_status!=='PENDING_APPROVAL')throw fail('DRAFT_ALREADY_DECIDED','This draft has already been decided',409,{draft_status:draft.draft_status});
    return draft;
  }

  async approveAndSend(id,owner,actor,scope){
    const ctx=await this.senderContext(owner);
    if(!owner&&this.automationControl?.getState){
      const state=await this.automationControl.getState();
      if(state?.sim_sender_paused===true)throw fail('FIRST_TOUCH_NOT_ALLOWED','Sending is paused after a mailbox problem',409,{reason_codes:['EMAIL_PAUSED']});
    }
    const prepared=await transaction(this.pool,async client=>{
      const draft=await this.lockDraft(client,id,owner);
      const company=await this.companies.requireManualCompany(client,draft.company_id,scope,{lock:true});
      const contact=await this.contactOf(client,company.id,draft.decision_maker_contact_id);
      const reasons=await this.blockers(client,{company,contact,owner,ctx,draft});
      if(owner){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`merchant:email-quota:${owner}`]);
        const allowance=await this.merchantSending.emailAllowance(owner,client);
        if(!allowance.allowed)reasons.push(allowance.code);
      }else{
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['phase13:first-touch:email-quota:sim']);
        if(await countColdOutreachToday(client)>=await this.dailyLimit())reasons.push('DAILY_LIMIT_REACHED');
      }
      if(reasons.length)throw fail('FIRST_TOUCH_NOT_ALLOWED','This email cannot be sent now',409,{reason_codes:[...new Set(reasons)]});
      // The approved text is exactly the draft; re-rendering must give the same content.
      const current=this.render({company,contact,provider:ctx.provider,sender:ctx.sender,templateKey:draft.template_key});
      if(current.content_hash!==draft.content_hash)throw fail('FIRST_TOUCH_NOT_ALLOWED','The company details changed; create a new draft',409,{reason_codes:['CONTENT_CHANGED']});
      const policy=(await client.query(`SELECT policy_revision FROM leadgen.phase13_first_touch_controls WHERE template_set_key=$1 ORDER BY updated_at DESC,policy_revision LIMIT 1`,[FIRST_TOUCH_TEMPLATE_SET])).rows[0];
      if(!policy)throw fail('FIRST_TOUCH_NOT_ALLOWED','First email settings are missing',409,{reason_codes:['FIRST_TOUCH_POLICY_MISSING']});
      await client.query(`UPDATE leadgen.manual_first_touch_drafts SET draft_status='SENDING',decided_by=$2,decided_at=now(),updated_at=now() WHERE id=$1`,[draft.id,actor]);
      const reservation=(await client.query(`INSERT INTO leadgen.phase13_first_touch_reservations
          (company_id,policy_revision,decision_maker_contact_id,normalized_recipient,market_code,template_set_key,template_key,sender_identity,reply_to,
           subject,body_text,content_hash,eligibility_snapshot,status,reservation_minute,reservation_day,provider_call_started_at,reason_codes,merchant_id)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'SENDING',date_trunc('minute',now()),(now() AT TIME ZONE m.timezone)::date,now(),ARRAY['MANUAL_APPROVED'],$14
        FROM leadgen.research_market_registry m WHERE m.market_code=$5 RETURNING *`,
        [company.id,policy.policy_revision,contact.id,draft.normalized_recipient,company.market_code,draft.template_set_key,draft.template_key,draft.sender_identity,draft.reply_to,
          draft.subject,draft.body_text,draft.content_hash,
          JSON.stringify({source:'MANUAL',manual_first_touch_draft_id:draft.id,approved_by:actor,category_id:company.category_scope_id,product_profile:draft.product_profile,
            template_key:draft.template_key,is_test_company:company.is_test}),owner])).rows[0];
      const key=`manual-first-touch:${reservation.id}`;
      const rfc=stableSmtpMessageId(key,ctx.provider.messageIdDomain);
      await client.query(`UPDATE leadgen.phase13_first_touch_reservations SET rfc_message_id=$2 WHERE id=$1`,[reservation.id,rfc]);
      const message=(await client.query(`INSERT INTO leadgen.outbound_messages(company_id,first_touch_reservation_id,provider,provider_purpose,idempotency_key,send_execution_key,
          rfc_message_id,message_key_header,send_status,send_reserved_at,reason_codes)
        VALUES($1,$2,'SMTP','COLD_OUTREACH',$3,$3,$4,$5,'SENDING',now(),'{}') RETURNING *`,[company.id,reservation.id,key,rfc,stableSmtpMessageKey(key)])).rows[0];
      const attempt=(await client.query(`INSERT INTO leadgen.outbound_message_attempts(outbound_message_id,attempt_number,attempt_status,provider,provider_call_started_at)
        VALUES($1,1,'STARTED','SMTP',now()) RETURNING *`,[message.id])).rows[0];
      const thread=(await client.query(`INSERT INTO leadgen.outreach_threads(company_id,first_touch_reservation_id,thread_token,thread_status) VALUES($1,$2,$3,'OPEN') RETURNING *`,
        [company.id,reservation.id,`manual-first-touch:${reservation.id}`])).rows[0];
      await client.query(`UPDATE leadgen.manual_first_touch_drafts SET first_touch_reservation_id=$2,outbound_message_id=$3,updated_at=now() WHERE id=$1`,[draft.id,reservation.id,message.id]);
      return{draft,company,reservation,message,attempt,thread};
    });
    // A committed SENDING row forbids any replay after a crash or an ambiguous SMTP outcome
    // (the automatic service's stalled-send recovery marks it AMBIGUOUS after 10 minutes).
    const {draft,reservation,message,attempt}=prepared;
    let result;
    try{
      result=await ctx.provider.send({from:`${ctx.fromName} <${draft.sender_identity}>`,to:draft.normalized_recipient,reply_to:draft.reply_to,
        subject:draft.subject,body_text:draft.body_text,purpose:'COLD_OUTREACH',send_scope:'PROSPECT_PILOT'},message.idempotency_key);
    }catch{result={status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS'};}
    const status=['PROVIDER_ACCEPTED','FAILED','BLOCKED'].includes(result?.status)?result.status:'AMBIGUOUS';
    const code=String(result?.code||status).toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,80);
    const transport=status==='PROVIDER_ACCEPTED'?'SMTP_ACCEPTED':status==='AMBIGUOUS'?'SEND_AMBIGUOUS':'SEND_FAILED';
    const outboxes=[];
    await transaction(this.pool,async client=>{
      await client.query('UPDATE leadgen.phase13_first_touch_reservations SET status=$2,completed_at=now(),reason_codes=$3::text[] WHERE id=$1',[reservation.id,status,['MANUAL_APPROVED',code]]);
      await client.query(`UPDATE leadgen.outbound_message_attempts SET attempt_status=$2,reason_codes=$3::text[],completed_at=now() WHERE id=$1`,
        [attempt.id,status==='PROVIDER_ACCEPTED'?'ACCEPTED':'PERMANENT_ERROR',[code]]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status=$2,transport_status=$3,business_contact_status=$4,provider_message_id=$5,
          sent_at=CASE WHEN $2='PROVIDER_ACCEPTED' THEN now() ELSE sent_at END,ambiguous_since=CASE WHEN $2='AMBIGUOUS' THEN now() ELSE NULL END,
          reason_codes=$6::text[],updated_at=now() WHERE id=$1`,
        [message.id,status,transport,status==='PROVIDER_ACCEPTED'?'SENT_NO_REPLY':transport,status==='PROVIDER_ACCEPTED'?result.provider_message_id||null:null,[code]]);
      await client.query(`INSERT INTO leadgen.email_message_events(outbound_message_id,event_type,occurred_at,event_digest) VALUES($1,$2,now(),$3) ON CONFLICT(event_digest) DO NOTHING`,
        [message.id,status==='AMBIGUOUS'?'FAILED':status,sha(`manual-first-touch:${reservation.id}:${status}`)]);
      await client.query(`UPDATE leadgen.manual_first_touch_drafts SET draft_status=$2,reason_codes=$3::text[],updated_at=now() WHERE id=$1`,
        [draft.id,status==='PROVIDER_ACCEPTED'?'SENT':status,[code]]);
      if(status==='PROVIDER_ACCEPTED'){
        const activity=(await client.query(`INSERT INTO leadgen.opportunity_activities(company_id,activity_type,owner_identity,details,idempotency_key,occurred_at,recorded_by,merchant_id)
          VALUES($1,'CONTACTED',$2,$3::jsonb,$4,now(),$2,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [draft.company_id,actor,JSON.stringify({channel:'EMAIL',summary:'First-touch email sent',outbound_message_id:message.id,first_touch_reservation_id:reservation.id,
            manual_first_touch_draft_id:draft.id,template_set_key:draft.template_set_key}),`manual-first-touch:${reservation.id}:contacted`,owner])).rows[0];
        outboxes.push((await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
          VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now(),$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,sync_status`,
          [draft.company_id,JSON.stringify(activityOutboxPayload({activity_type:'CONTACTED',owner:actor,references:{activity:activity?.id,outbound:message.id,funnel:'CONTACTED'}})),
            `manual-first-touch:${reservation.id}:crm:contacted`,owner])).rows[0]);
        if(await this.companies.currentStage(client,draft.company_id,owner)==='NEW')
          outboxes.push((await this.companies.appendStage(client,{companyId:draft.company_id,owner,stage:'CONTACTED',note:'First-touch email sent',actor})).outbox);
      }
    });
    await this.companies.dispatch(outboxes.filter(Boolean));
    // SIM's mailbox failing pauses SIM's sending (same as approved follow-ups); a merchant's
    // ambiguous result holds only that merchant's mailbox. A provider policy block pauses nothing.
    if(['FAILED','AMBIGUOUS'].includes(status)&&!owner)await this.automationControl?.pauseEmail?.(code);
    if(status==='AMBIGUOUS'&&owner&&this.merchantSending?.holdMailbox)await this.merchantSending.holdMailbox(owner,code);
    this.audit('manual_first_touch_send',{draft_id:draft.id,company_id:draft.company_id,merchant_id:owner,status});
    return{draft_id:draft.id,status:status==='PROVIDER_ACCEPTED'?'SENT':status,code,reservation_id:reservation.id,outbound_message_id:message.id,thread_id:prepared.thread.id};
  }
}
