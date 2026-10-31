// Reply correlation when the mail server rewrites the Message-ID (migration 076, acceptance bug 2026-10-27).
// 1. Sent-folder aliases: after an SMTP send is accepted, the next inbound sync of that mailbox reads the
//    Sent folder (read-only, no extra sends), finds the stored copy (recipient + subject + send time +
//    body hash, or SIM's message key header if the server kept it) and records the server's Message-ID
//    as an alias of the outbound message. Lookups are logged and retried with backoff (append-only).
// 2. Header correlation (Phase7Repository.findInboundThread) matches In-Reply-To/References against the
//    Message-ID SIM set and against these aliases.
// 3. Subject fallback (last resort): "Re:/RE:/回复:/答复:" + the exact sent subject, from the exact
//    recipient address, to the same mailbox and owner, sent within 60 days, exactly one candidate.
//    Recorded as SUBJECT_FALLBACK with LOW confidence; two or more candidates stay REVIEW.
// 4. recorrelateReviewReplies re-runs 2+3 for REVIEW replies and starts the normal downstream steps
//    (classification if missing, then the same create-sales-followup work: timeline activity, CRM
//    state, follow-up task, CRM outbox). Every correlation change is logged in inbound_correlation_events.
import {sanitizeInboundText,digestCanonical} from '../outreach/index.js';
import {sha256} from './repository.js';

const REPLY_PREFIX=/^\s*(?:re|回复|答复)\s*[:：]\s*/i;
const SQL_HASH=value=>`encode(sha256(convert_to(${value},'UTF8')),'hex')`;
const ACCEPTED=`('PROVIDER_ACCEPTED','DELIVERED')`;
export const SUBJECT_FALLBACK_DAYS=60;
export const SENT_LOOKUP_MAX_ATTEMPTS=6;
export const SENT_LOOKUP_WINDOW_DAYS=7;
export const SENT_LOOKUP_BACKOFF_MINUTES=10;

/** Subjects a reply could quote: the reply subject with one, two, ... reply prefixes removed. */
export function strippedReplySubjects(subject){
  let current=sanitizeInboundText(subject,500);const variants=[];
  while(REPLY_PREFIX.test(current)&&variants.length<5){current=current.replace(REPLY_PREFIX,'').trim();if(current)variants.push(current);}
  return variants;
}

export function senderAddress(value){
  const raw=String(value||'').trim().toLowerCase();
  return(raw.match(/<([^<>@\s]+@[^<>\s]+)>/)?.[1]||raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i)?.[0]||'').toLowerCase();
}

export function headerReferences(value){
  return[value].filter(Boolean).flatMap(item=>String(item).match(/<[^>]+>|[^\s,]+/g)||[]);
}

// One row per outbound message with its envelope, whatever path sent it (first touch, follow-up, legacy approval).
export const OUTBOUND_CONTEXT_SQL=`SELECT m.id,m.company_id,m.merchant_id,m.provider,m.send_status,m.sent_at,m.rfc_message_id,m.message_key_header,
    lower(btrim(coalesce(fr.normalized_recipient,ftr.normalized_recipient,rcpt.normalized_recipient,ap.normalized_recipient))) recipient,
    lower(btrim(coalesce(fr.sender_identity,ftr.sender_identity,ap.from_identity))) sender,
    coalesce(fr.subject,fd.subject,od.subject) subject,coalesce(fr.body_text,fd.body_text,od.body_text) body_text,
    th.id thread_id,th.thread_status
  FROM leadgen.outbound_messages m
  LEFT JOIN leadgen.phase13_first_touch_reservations fr ON fr.id=m.first_touch_reservation_id
  LEFT JOIN leadgen.crm_followup_drafts fd ON fd.id=m.followup_draft_id
  LEFT JOIN leadgen.phase13_first_touch_reservations ftr ON ftr.id=fd.first_touch_reservation_id
  LEFT JOIN leadgen.outreach_approvals ap ON ap.id=m.approval_id
  LEFT JOIN leadgen.outreach_drafts od ON od.id=ap.draft_id
  LEFT JOIN leadgen.outreach_recipients rcpt ON rcpt.id=m.recipient_id
  LEFT JOIN LATERAL(SELECT t.id,t.thread_status FROM leadgen.outreach_threads t WHERE t.company_id=m.company_id AND (
      (m.first_touch_reservation_id IS NOT NULL AND t.first_touch_reservation_id=m.first_touch_reservation_id)
      OR (m.followup_draft_id IS NOT NULL AND t.id=fd.thread_id)
      OR (m.recipient_id IS NOT NULL AND t.recipient_id=m.recipient_id))
    ORDER BY t.updated_at DESC LIMIT 1) th ON true`;

async function inTransaction(pool,operation){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
  finally{client.release();}
}

export class ReplyCorrelationService{
  /** repository: Phase7Repository (findInboundThread). service: Phase7Service (downstream work). */
  constructor({pool,repository,service=null,queue=null,audit=()=>{}}={}){
    Object.assign(this,{pool,repository,service,queue,audit});
  }

  // ---- 1. Sent-folder aliases -------------------------------------------------------------
  async pendingSentLookups({mailbox,senderEmail=null,merchantId=null,limit=20,backoffMinutes=SENT_LOOKUP_BACKOFF_MINUTES}){
    const identities=[...new Set([mailbox,senderEmail].map(value=>String(value||'').trim().toLowerCase()).filter(Boolean))];
    if(!identities.length)return[];
    return(await this.pool.query(`SELECT x.* FROM (${OUTBOUND_CONTEXT_SQL}) x
      WHERE x.provider='SMTP' AND x.send_status IN${ACCEPTED} AND x.sent_at>now()-($4::int*interval '1 day')
        AND x.merchant_id IS NOT DISTINCT FROM $1::uuid AND x.sender=ANY($2::text[]) AND x.recipient IS NOT NULL AND x.subject IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_message_id_aliases a WHERE a.outbound_message_id=x.id)
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_sent_lookup_attempts s WHERE s.outbound_message_id=x.id AND s.lookup_status IN('MATCHED','SAME_ID'))
        AND (SELECT count(*) FROM leadgen.outbound_sent_lookup_attempts s WHERE s.outbound_message_id=x.id)<$5
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_sent_lookup_attempts s WHERE s.outbound_message_id=x.id AND s.attempted_at>now()-($6::int*interval '1 minute'))
      ORDER BY x.sent_at DESC LIMIT $3`,[merchantId,identities,Math.max(1,Math.min(50,Number(limit)||20)),SENT_LOOKUP_WINDOW_DAYS,SENT_LOOKUP_MAX_ATTEMPTS,Math.max(0,Number(backoffMinutes)||0)])).rows;
  }

  /** Reads the mailbox's Sent folder for recent accepted sends without an alias and records what it finds.
   *  Nothing happens (no network) when no send is waiting. Then re-correlates REVIEW replies of that mailbox. */
  async reconcileSentAliases({provider,mailbox,merchantId=null,limit=20,backoffMinutes=SENT_LOOKUP_BACKOFF_MINUTES}={}){
    if(typeof provider?.lookupSentMessageIds!=='function')return{status:'UNSUPPORTED',looked_up:0,aliases:0,network_calls:0};
    const mailboxHash=sha256(String(mailbox||'').trim().toLowerCase());
    const pending=await this.pendingSentLookups({mailbox,senderEmail:provider.senderEmail,merchantId,limit,backoffMinutes});
    if(!pending.length)return{status:'NOTHING_PENDING',looked_up:0,aliases:0,network_calls:0};
    let lookup;
    try{lookup=await provider.lookupSentMessageIds(pending.map(row=>({key:row.id,to:row.recipient,from:row.sender,subject:row.subject,body_text:row.body_text,
      sent_at:new Date(row.sent_at).toISOString(),rfc_message_id:row.rfc_message_id,message_key:row.message_key_header})));}
    catch{lookup={status:'FAILED',code:'SENT_LOOKUP_FAILED',results:[],network_calls:1};}
    const byKey=new Map((lookup.results||[]).map(result=>[result.key,result]));
    let aliases=0;
    await inTransaction(this.pool,async client=>{
      for(const row of pending){
        const result=lookup.status==='COMPLETED'?byKey.get(row.id)||{status:'NO_MATCH'}:{status:'LOOKUP_FAILED',code:lookup.code||'SENT_LOOKUP_FAILED'};
        let status=['MATCHED','SAME_ID','NO_MATCH','MULTIPLE_MATCHES'].includes(result.status)?result.status:'LOOKUP_FAILED';
        if(status==='MATCHED'){
          const inserted=await client.query(`INSERT INTO leadgen.outbound_message_id_aliases(outbound_message_id,alias_message_id,alias_source,match_method,
              mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid,body_sha256,merchant_id)
            VALUES($1,$2,'SENT_FOLDER_LOOKUP',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
            [row.id,String(result.message_id).trim(),result.match_method,mailboxHash,result.folder_path||lookup.folder_path||'Sent',
              result.uidvalidity??null,result.uid??null,result.body_sha256||null,row.merchant_id]);
          if(inserted.rowCount)aliases+=1;
          else{const owner=(await client.query(`SELECT outbound_message_id FROM leadgen.outbound_message_id_aliases WHERE alias_message_id=$1`,[String(result.message_id).trim()])).rows[0];
            if(owner&&owner.outbound_message_id!==row.id)status='MULTIPLE_MATCHES';}
        }
        await client.query(`INSERT INTO leadgen.outbound_sent_lookup_attempts(outbound_message_id,mailbox_identity_hash,lookup_status,folder_path,code,merchant_id)
          VALUES($1,$2,$3,$4,$5,$6)`,[row.id,mailboxHash,status,result.folder_path||lookup.folder_path||null,result.code||result.match_method||null,row.merchant_id]);
      }
    });
    this.audit('reply_correlation_sent_lookup',{merchant_id:merchantId,looked_up:pending.length,aliases,status:lookup.status});
    const recorrelated=aliases?await this.recorrelateReviewReplies({apply:true,mailboxHash,subjectFallback:false,recordedBy:'SENT_ALIAS_LOOKUP'}):null;
    return{status:lookup.status,looked_up:pending.length,aliases,network_calls:lookup.network_calls||0,recorrelated:recorrelated?.matched?.length||0};
  }

  // ---- 3. Subject fallback ------------------------------------------------------------------
  /** inbound: {subject, from_address_hash, mailbox_identity_hash, merchant_id, received_at}. */
  async findSubjectFallback(inbound={}){
    const variants=strippedReplySubjects(inbound.subject);
    if(!variants.length||!inbound.mailbox_identity_hash||!/^[0-9a-f]{64}$/i.test(String(inbound.from_address_hash||'')))return{match:null,candidates:0};
    const receivedAt=new Date(inbound.received_at||Date.now());
    const rows=(await this.pool.query(`SELECT x.* FROM (${OUTBOUND_CONTEXT_SQL}) x
      WHERE x.send_status IN${ACCEPTED} AND x.merchant_id IS NOT DISTINCT FROM $1::uuid
        AND ${SQL_HASH('x.sender')}=lower($2) AND ${SQL_HASH('x.recipient')}=lower($3)
        AND x.sent_at<=$4::timestamptz+interval '5 minutes' AND x.sent_at>=$4::timestamptz-($5::int*interval '1 day')
        AND x.thread_id IS NOT NULL AND x.thread_status IN('OPEN','REPLIED','MANUAL_TAKEOVER')`,
      [inbound.merchant_id||null,inbound.mailbox_identity_hash,inbound.from_address_hash,receivedAt.toISOString(),SUBJECT_FALLBACK_DAYS])).rows;
    const matches=rows.filter(row=>variants.includes(sanitizeInboundText(row.subject,500)));
    if(matches.length!==1)return{match:null,candidates:matches.length};
    const row=matches[0];
    return{candidates:1,match:{id:row.thread_id,company_id:row.company_id,outbound_message_id:row.id,correlation_method:'SUBJECT_FALLBACK',correlation_confidence:'LOW'}};
  }

  // ---- 4. Re-correlation of REVIEW replies --------------------------------------------------
  async reviewReplies({inboundIds=null,mailboxHash=null,limit=200}={}){
    return(await this.pool.query(`SELECT i.id,i.correlation_status,i.subject_sanitized,i.from_address_hash,i.mailbox_identity_hash,i.merchant_id,i.received_at,
        w.sanitized_payload payload,
        EXISTS(SELECT 1 FROM leadgen.reply_classifications c WHERE c.inbound_message_id=i.id) classified
      FROM leadgen.inbound_messages i LEFT JOIN leadgen.email_webhook_inbox w ON w.id=i.webhook_inbox_id
      WHERE i.correlation_status='REVIEW' AND ($1::uuid[] IS NULL OR i.id=ANY($1::uuid[]))
        AND ($2::text IS NULL OR i.mailbox_identity_hash=$2) AND i.received_at>now()-interval '180 days'
      ORDER BY i.received_at DESC LIMIT $3`,[inboundIds&&inboundIds.length?inboundIds:null,mailboxHash,Math.max(1,Math.min(1000,Number(limit)||200))])).rows;
  }

  /** Correlation for one stored reply (headers incl. aliases, then optionally the subject fallback). */
  async correlate(row,{subjectFallback=true}={}){
    const payload=row.payload||{};
    if(payload.dsn===true)return{match:null,reason:'DSN_NOT_A_REPLY'};
    const sender=senderAddress(payload.from||payload.metadata?.from);
    const references=headerReferences(payload.references);
    const header=await this.repository.findInboundThread({inReplyTo:payload.in_reply_to,references,messageKey:payload.message_key,providerThreadId:payload.provider_thread_id,normalizedSender:sender});
    if(header){
      const owner=(await this.pool.query('SELECT merchant_id FROM leadgen.outbound_messages WHERE id=$1',[header.outbound_message_id])).rows[0];
      if(!owner||(owner.merchant_id||null)!==(row.merchant_id||null))return{match:null,reason:'OWNER_MISMATCH'};
      return{match:{...header,correlation_confidence:'HIGH'},references,sender};
    }
    if(!subjectFallback)return{match:null,reason:'NO_HEADER_MATCH'};
    const fallback=await this.findSubjectFallback({subject:row.subject_sanitized||payload.subject,from_address_hash:row.from_address_hash,
      mailbox_identity_hash:row.mailbox_identity_hash,merchant_id:row.merchant_id,received_at:row.received_at});
    return fallback.match?{match:fallback.match,references,sender}:{match:null,reason:fallback.candidates>1?'SUBJECT_FALLBACK_AMBIGUOUS':'NO_MATCH',candidates:fallback.candidates};
  }

  async applyCorrelation(row,match,{recordedBy,references=[]}){
    const payload=row.payload||{};
    const digest=digestCanonical({in_reply_to:payload.in_reply_to||null,references,message_key:payload.message_key||null,provider_thread_id:payload.provider_thread_id||null,
      matched:match.outbound_message_id,method:match.correlation_method,recorrelated_by:recordedBy});
    return inTransaction(this.pool,async client=>{
      const current=(await client.query('SELECT id,correlation_status,merchant_id,received_at FROM leadgen.inbound_messages WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      if(!current||current.correlation_status!=='REVIEW')return{applied:false,reason:'NOT_REVIEW'};
      await client.query(`UPDATE leadgen.inbound_messages SET correlation_status='MATCHED',thread_id=$2,correlation_outbound_message_id=$3,correlation_method=$4,
          correlation_confidence=$5,correlation_evidence_digest=$6,
          merchant_id=coalesce(merchant_id,(SELECT t.merchant_id FROM leadgen.outreach_threads t WHERE t.id=$2))
        WHERE id=$1 AND correlation_status='REVIEW'`,[row.id,match.id,match.outbound_message_id,match.correlation_method,match.correlation_confidence,digest]);
      await client.query(`UPDATE leadgen.outreach_threads SET thread_status='REPLIED',last_message_at=$2,updated_at=now() WHERE id=$1 AND thread_status='OPEN'`,[match.id,current.received_at]);
      await client.query(`INSERT INTO leadgen.inbound_correlation_events(inbound_message_id,previous_status,correlation_status,correlation_method,correlation_confidence,
          outbound_message_id,thread_id,recorded_by,evidence_digest,merchant_id)
        VALUES($1,'REVIEW','MATCHED',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [row.id,match.correlation_method,match.correlation_confidence,match.outbound_message_id,match.id,recordedBy,digest,current.merchant_id]);
      return{applied:true};
    });
  }

  /** The steps a normally correlated reply takes after classification. */
  async startDownstream(row){
    const queue=this.queue||this.service?.queue;if(!queue?.enqueue)return{queued:null};
    if(row.classified)return{queued:await queue.enqueue('create-sales-followup',{inbound_message_id:row.id},{singletonKey:`phase11:crm-effects:${row.id}:1`}),step:'create-sales-followup'};
    return{queued:await queue.enqueue('classify-inbound-reply',{inbound_message_id:row.id},{singletonKey:`phase7:classify-inbound:${row.id}:recorrelated`}),step:'classify-inbound-reply'};
  }

  /** Dry run by default: reports what would match. apply=true writes the correlation and starts downstream work. */
  async recorrelateReviewReplies({apply=false,inboundIds=null,mailboxHash=null,subjectFallback=true,recordedBy='REPAIR_SCRIPT',limit=200}={}){
    const rows=await this.reviewReplies({inboundIds,mailboxHash,limit});
    const matched=[];const unmatched=[];
    for(const row of rows){
      const result=await this.correlate(row,{subjectFallback});
      if(!result.match){unmatched.push({inbound_message_id:row.id,reason:result.reason,candidates:result.candidates??null});continue;}
      const item={inbound_message_id:row.id,merchant_id:row.merchant_id,outbound_message_id:result.match.outbound_message_id,thread_id:result.match.id,company_id:result.match.company_id,
        correlation_method:result.match.correlation_method,correlation_confidence:result.match.correlation_confidence,subject:row.subject_sanitized};
      if(apply){
        const applied=await this.applyCorrelation(row,result.match,{recordedBy,references:result.references});
        item.applied=applied.applied;
        if(applied.applied){
          try{Object.assign(item,await this.startDownstream(row));}
          catch(error){item.downstream_error=String(error?.message||error).slice(0,200);}
        }
      }
      matched.push(item);
    }
    if(apply&&matched.length)this.audit('reply_correlation_recorrelated',{recorded_by:recordedBy,matched:matched.length});
    return{dry_run:!apply,reviewed:rows.length,matched,unmatched};
  }
}

/** A queue that runs the reply steps in-process (used by the repair script): classification and the
 *  CRM effects run now; CRM sync rows stay PENDING for the regular CRM outbox dispatch. */
export function inlineReplyQueue(service){
  const ran=[];
  return{ran,async enqueue(name,data){
    if(name==='classify-inbound-reply'){ran.push(name);await service.classifyInboundWork(data);return `inline:${name}`;}
    if(name==='create-sales-followup'){ran.push(name);await service.createSalesFollowupWork(data);return `inline:${name}`;}
    ran.push(`${name}:deferred`);return null;
  }};
}
