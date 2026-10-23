import {randomUUID} from 'node:crypto';
import {activityOutboxPayload,opportunityOutboxPayload} from './outboxPayloads.js';
import {companyScopeSql,ownerScopeSql,companyVisible} from '../merchant/scope.js';

export const PIPELINE_STAGES=Object.freeze(['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON','LOST']);
export const MANUAL_ACTIVITY_TYPES=Object.freeze(['CALL','WHATSAPP','MEETING','NOTE','EMAIL_MANUAL']);
export const TASK_TYPES=Object.freeze(['FOLLOW_UP','REPLY_REVIEW','QUOTATION','SAMPLE','MEETING','CRM_HANDOFF','OTHER']);
export const TASK_STATUSES=Object.freeze(['OPEN','IN_PROGRESS','COMPLETED','CANCELLED']);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,message,status)=>Object.assign(new Error(message),{code,status});
export function crmUuid(value,label='id'){
  const normalized=String(value||'').trim();
  if(!UUID.test(normalized))throw fail('CRM_INVALID_ID',`${label} must be a UUID`,400);
  return normalized;
}

// Hash used by every suppression table: sha256 of the trimmed, lower-cased address.
const RECIPIENT_HASH="encode(sha256(convert_to(lower(btrim(r.normalized_recipient)),'UTF8')),'hex')";
// A thread may receive a follow-up only while nobody has answered or opted out.
export const FOLLOWUP_THREAD_OPEN_SQL=`t.thread_status='OPEN'
  AND r.status='PROVIDER_ACCEPTED'
  AND NOT EXISTS(SELECT 1 FROM leadgen.inbound_messages i WHERE i.thread_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=t.company_id AND s.lifted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.company_id=t.company_id AND s.lifted_at IS NULL
    AND s.normalized_recipient_hash=${RECIPIENT_HASH})
  AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=t.company_id AND s.lifted_at IS NULL
    AND (s.suppression_type IN('OPT_OUT','COMPLAINT') OR s.normalized_recipient_hash=${RECIPIENT_HASH}))
  AND NOT EXISTS(SELECT 1 FROM leadgen.opportunity_crm_states cs WHERE cs.company_id=t.company_id
    AND cs.merchant_id IS NOT DISTINCT FROM t.merchant_id AND cs.pipeline_stage NOT IN('NEW','CONTACTED'))`;

// Latest CRM state for each current opportunity, across assessment revisions, for one owner
// ($ownerParam: NULL = SIM, otherwise a merchant). companyClause restricts a merchant's view.
const currentPipelineSql=(ownerParam,companyClause='TRUE')=>`
  SELECT o.id opportunity_id,o.company_id,o.product_profile,c.company_name,c.country_code,c.city,c.website_url,
    coalesce(cs.pipeline_stage,'NEW') pipeline_stage,cs.funnel_status,cs.owner_identity,cs.next_action,cs.next_action_due_at,
    cs.lost_reason,cs.stage_changed_at,cs.version crm_version,cs.opportunity_snapshot_id crm_snapshot_id,
    (cs.next_action_due_at IS NOT NULL AND cs.next_action_due_at<now() AND coalesce(cs.pipeline_stage,'NEW') NOT IN('WON','LOST')) overdue
  FROM leadgen.business_opportunity_current o
  JOIN leadgen.companies c ON c.id=o.company_id
  LEFT JOIN LATERAL(
    SELECT s.* FROM leadgen.opportunity_crm_states s
    JOIN leadgen.business_opportunity_decision_snapshots snap ON snap.id=s.opportunity_snapshot_id
    WHERE s.company_id=o.company_id AND snap.product_profile=o.product_profile AND s.merchant_id IS NOT DISTINCT FROM ${ownerParam}::uuid
    ORDER BY s.updated_at DESC LIMIT 1
  ) cs ON true
  WHERE ${companyClause}`;

export class CrmRepository{
  constructor({pool}){this.pool=pool;}

  async transaction(fn){
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async listPipeline({stage=null,owner=null,q=null,limit=200,scope=null}={}){
    const params=[scope?.merchantId??null];const where=[];
    const companyClause=companyScopeSql(scope,'o',params,'company_id');
    const base=currentPipelineSql('$1',companyClause);const baseParams=[...params];
    if(stage){params.push(stage);where.push(`pipeline_stage=$${params.length}`);}
    if(owner){params.push(owner);where.push(`owner_identity=$${params.length}`);}
    if(q){params.push(`%${q}%`);where.push(`company_name ILIKE $${params.length}`);}
    params.push(limit);
    const rows=(await this.pool.query(`WITH p AS(${base}) SELECT * FROM p
      ${where.length?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY overdue DESC,next_action_due_at ASC NULLS LAST,company_name LIMIT $${params.length}`,params)).rows;
    const counts=(await this.pool.query(`WITH p AS(${base}) SELECT pipeline_stage,count(*)::int count FROM p GROUP BY 1`,baseParams)).rows;
    return{items:rows,stage_counts:Object.fromEntries(PIPELINE_STAGES.map(key=>[key,counts.find(row=>row.pipeline_stage===key)?.count||0]))};
  }

  async opportunity(client,opportunityId,scope=null){
    const row=(await client.query(`SELECT id,company_id,product_profile FROM leadgen.business_opportunity_decision_snapshots WHERE id=$1`,[opportunityId])).rows[0];
    if(!row||!await companyVisible(client,scope,row.company_id))throw fail('CRM_OPPORTUNITY_NOT_FOUND','Opportunity not found',404);
    return row;
  }

  // Locks and returns the CRM state used for this opportunity's company/profile, creating it if needed.
  // State is per owner: SIM (merchantId NULL) and each merchant keep their own stage.
  async lockState(client,opportunity,actor,merchantId=null){
    await client.query("SELECT set_config('leadgen.stage_actor',$1,true)",[actor]);
    const existing=(await client.query(`SELECT s.* FROM leadgen.opportunity_crm_states s
      JOIN leadgen.business_opportunity_decision_snapshots snap ON snap.id=s.opportunity_snapshot_id
      WHERE s.company_id=$1 AND snap.product_profile=$2 AND s.merchant_id IS NOT DISTINCT FROM $3::uuid
      ORDER BY s.updated_at DESC LIMIT 1 FOR UPDATE OF s`,
      [opportunity.company_id,opportunity.product_profile,merchantId])).rows[0];
    if(existing)return existing;
    return(await client.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status,owner_identity,merchant_id)
      VALUES($1,$2,'NOT_CONTACTED',$3,$4) RETURNING *`,[opportunity.id,opportunity.company_id,actor,merchantId])).rows[0];
  }

  async setStage(opportunityId,{stage,lost_reason=null,note=null,owner=null,next_action=null,next_action_due_at,expected_version=null},actor,scope=null){
    const merchantId=scope?.merchantId??null;
    return this.transaction(async client=>{
      const opportunity=await this.opportunity(client,opportunityId,scope);
      const state=await this.lockState(client,opportunity,actor,merchantId);
      if(expected_version!==null&&Number(expected_version)!==Number(state.version))throw fail('CRM_VERSION_CONFLICT','The opportunity was changed by someone else',409);
      const updated=(await client.query(`UPDATE leadgen.opportunity_crm_states SET pipeline_stage=$2,lost_reason=$3,stage_note=$4,
          owner_identity=coalesce($5,owner_identity),next_action=coalesce($6,next_action),
          next_action_due_at=CASE WHEN $8 THEN $7::timestamptz ELSE next_action_due_at END,
          version=version+1,updated_at=now()
        WHERE id=$9 AND opportunity_snapshot_id=$1 RETURNING *`,
        [state.opportunity_snapshot_id,stage,stage==='LOST'?lost_reason:null,note,owner,next_action,next_action_due_at??null,next_action_due_at!==undefined,state.id])).rows[0];
      if(updated.pipeline_stage!==state.pipeline_stage){
        await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
          VALUES($1,'UPDATE_OPPORTUNITY',$2::jsonb,$3,'PENDING',now(),$4)`,
          [opportunity.company_id,JSON.stringify(opportunityOutboxPayload({stage:updated.pipeline_stage,status:updated.pipeline_stage==='LOST'?'LOST':updated.pipeline_stage==='WON'?'WON':'OPEN',owner:updated.owner_identity})),
            merchantId?`crm:stage:${updated.opportunity_snapshot_id}:${merchantId}:${updated.version}`:`crm:stage:${updated.opportunity_snapshot_id}:${updated.version}`,merchantId]);
      }
      return updated;
    });
  }

  async addActivity(opportunityId,{activity_type,occurred_at,summary,result=null,next_follow_up_at=null},actor,scope=null){
    const merchantId=scope?.merchantId??null;
    return this.transaction(async client=>{
      const opportunity=await this.opportunity(client,opportunityId,scope);
      const state=await this.lockState(client,opportunity,actor,merchantId);
      const activity=(await client.query(`INSERT INTO leadgen.opportunity_activities
          (company_id,opportunity_snapshot_id,activity_type,owner_identity,due_at,details,idempotency_key,occurred_at,recorded_by,merchant_id)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$4,$9) RETURNING *`,
        [opportunity.company_id,state.opportunity_snapshot_id,activity_type,actor,next_follow_up_at,
          JSON.stringify({summary,result,channel:activity_type}),`crm:manual:${randomUUID()}`,occurred_at,merchantId])).rows[0];
      if(next_follow_up_at)await client.query(`UPDATE leadgen.opportunity_crm_states SET next_action_due_at=$2,version=version+1,updated_at=now()
        WHERE id=$1`,[state.id,next_follow_up_at]);
      await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
        VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now(),$4)`,
        [opportunity.company_id,JSON.stringify(activityOutboxPayload({activity_type,occurred_at,summary,owner:actor,references:{activity:activity.id}})),`crm:activity:${activity.id}`,merchantId]);
      return activity;
    });
  }

  async timeline(companyId,{limit=100,scope=null}={}){
    if(!await companyVisible(this.pool,scope,companyId))throw fail('CRM_COMPANY_NOT_FOUND','Company not found',404);
    const owner=scope?.restrict?scope.merchantId:null;
    return(await this.pool.query(`SELECT * FROM(
        SELECT 'ACTIVITY' kind,a.id,a.activity_type event_type,coalesce(a.occurred_at,a.created_at) occurred_at,
          coalesce(a.recorded_by,a.owner_identity) actor,a.details->>'summary' summary,a.details->>'result' result,NULL from_stage,NULL to_stage
        FROM leadgen.opportunity_activities a WHERE a.company_id=$1 AND ($3::uuid IS NULL OR a.merchant_id=$3)
        UNION ALL
        SELECT 'STAGE',h.id,'STAGE_CHANGED',h.changed_at,h.changed_by,h.note,h.lost_reason,h.from_stage,h.to_stage
        FROM leadgen.opportunity_stage_history h WHERE h.company_id=$1 AND ($3::uuid IS NULL OR h.merchant_id=$3)
        UNION ALL
        SELECT 'TASK',t.id,t.task_type,t.created_at,t.owner,t.details->>'title',t.task_status,NULL,NULL
        FROM leadgen.sales_tasks t WHERE t.company_id=$1 AND t.record_scope='PROSPECT' AND ($3::uuid IS NULL OR t.merchant_id=$3)
      ) events ORDER BY occurred_at DESC LIMIT $2`,[companyId,limit,owner])).rows;
  }

  async listTasks({owner=null,status=null,due=null,company_id=null,limit=200,scope=null}={}){
    const params=[];const where=["t.record_scope='PROSPECT'"];
    where.push(ownerScopeSql(scope,'t',params));
    if(status){params.push(status);where.push(`t.task_status=$${params.length}`);}
    else where.push("t.task_status IN('OPEN','IN_PROGRESS')");
    if(owner){params.push(owner);where.push(`t.owner=$${params.length}`);}
    if(company_id){params.push(company_id);where.push(`t.company_id=$${params.length}`);}
    if(due==='overdue')where.push('t.due_at<now()');
    if(due==='today')where.push("t.due_at<date_trunc('day',now())+interval '1 day'");
    if(due==='week')where.push("t.due_at<date_trunc('day',now())+interval '7 days'");
    params.push(limit);
    const items=(await this.pool.query(`SELECT t.id,t.company_id,c.company_name,c.country_code,t.task_type,t.task_status,t.owner,t.due_at,
        t.details->>'title' title,t.details->>'next_action' next_action,t.details->>'intent' source_intent,t.details->'notes' notes,
        t.created_at,t.updated_at,(t.due_at<now() AND t.task_status IN('OPEN','IN_PROGRESS')) overdue
      FROM leadgen.sales_tasks t JOIN leadgen.companies c ON c.id=t.company_id
      WHERE ${where.join(' AND ')} ORDER BY t.due_at ASC NULLS LAST,t.created_at LIMIT $${params.length}`,params)).rows;
    const summary=(await this.pool.query(`SELECT
        count(*) FILTER(WHERE task_status IN('OPEN','IN_PROGRESS'))::int open,
        count(*) FILTER(WHERE task_status IN('OPEN','IN_PROGRESS') AND due_at<now())::int overdue,
        count(*) FILTER(WHERE task_status IN('OPEN','IN_PROGRESS') AND due_at<date_trunc('day',now())+interval '1 day')::int due_today
      FROM leadgen.sales_tasks WHERE record_scope='PROSPECT' AND ($1::uuid IS NULL OR merchant_id=$1)`,[scope?.restrict?scope.merchantId:null])).rows[0];
    return{items,summary};
  }

  async createTask({company_id,task_type,owner=null,due_at=null,title,next_action=null},actor,scope=null){
    return this.transaction(async client=>{
      const company=(await client.query('SELECT id FROM leadgen.companies WHERE id=$1',[company_id])).rows[0];
      if(!company||!await companyVisible(client,scope,company_id))throw fail('CRM_COMPANY_NOT_FOUND','Company not found',404);
      const task=(await client.query(`INSERT INTO leadgen.sales_tasks(company_id,task_type,task_status,owner,due_at,details,updated_by,merchant_id)
        VALUES($1,$2,'OPEN',$3,$4,$5::jsonb,$6,$7) RETURNING *`,
        [company_id,task_type,owner||actor,due_at,JSON.stringify({title,next_action,source:'MANUAL',created_by:actor,notes:[]}),actor,scope?.merchantId??null])).rows[0];
      await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,task_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
        VALUES($1,$2,'CREATE_TASK',$3::jsonb,$4,'PENDING',now())`,
        [company_id,task.id,JSON.stringify({task_id:task.id,task_type,due_at:task.due_at,owner:task.owner,summary:title,source:'MANUAL'}),`crm:task:${task.id}`]);
      return task;
    });
  }

  async updateTask(taskId,{task_status,owner,due_at,note},actor,scope=null){
    return this.transaction(async client=>{
      const task=(await client.query(`SELECT * FROM leadgen.sales_tasks WHERE id=$1 AND record_scope='PROSPECT'
        AND ($2::uuid IS NULL OR merchant_id=$2) FOR UPDATE`,[taskId,scope?.restrict?scope.merchantId:null])).rows[0];
      if(!task)throw fail('CRM_TASK_NOT_FOUND','Task not found',404);
      if(['COMPLETED','CANCELLED'].includes(task.task_status)&&task_status&&task_status!==task.task_status)
        throw fail('CRM_TASK_CLOSED','A closed task cannot be reopened',409);
      const notes=Array.isArray(task.details?.notes)?task.details.notes:[];
      const nextNotes=note?[...notes,{at:new Date().toISOString(),by:actor,text:note}].slice(-50):notes;
      const closing=task_status&&['COMPLETED','CANCELLED'].includes(task_status)&&task_status!==task.task_status;
      return(await client.query(`UPDATE leadgen.sales_tasks SET task_status=coalesce($2,task_status),owner=coalesce($3,owner),
          due_at=CASE WHEN $5 THEN $4::timestamptz ELSE due_at END,details=jsonb_set(details,'{notes}',$6::jsonb,true),
          closed_at=CASE WHEN $7 THEN now() ELSE closed_at END,close_reason=CASE WHEN $7 THEN $2 ELSE close_reason END,
          updated_by=$8,updated_at=now()
        WHERE id=$1 RETURNING *`,
        [taskId,task_status||null,owner||null,due_at??null,due_at!==undefined,JSON.stringify(nextNotes),closing,actor])).rows[0];
    });
  }

  async reviewReply(classificationId,{decision,intent=null},actor,buildTask,scope=null){
    return this.transaction(async client=>{
      const row=(await client.query(`SELECT rc.*,i.thread_id,coalesce(t.company_id,om.company_id) company_id,i.subject_sanitized,i.body_text_sanitized
        FROM leadgen.reply_classifications rc JOIN leadgen.inbound_messages i ON i.id=rc.inbound_message_id
        LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id
        LEFT JOIN leadgen.outbound_messages om ON om.id=i.correlation_outbound_message_id
        WHERE rc.id=$1 AND ($2::uuid IS NULL OR i.merchant_id=$2) FOR UPDATE OF rc`,[classificationId,scope?.restrict?scope.merchantId:null])).rows[0];
      if(!row)throw fail('CRM_CLASSIFICATION_NOT_FOUND','Reply classification not found',404);
      if(row.review_status!=='PENDING_REVIEW')throw fail('CRM_CLASSIFICATION_REVIEWED','This reply has already been reviewed',409);
      // The original reading stays as recorded; a correction is appended as a new revision.
      const reviewed=(await client.query(`UPDATE leadgen.reply_classifications SET review_status=$2,reviewed_by=$3,reviewed_at=now()
        WHERE id=$1 RETURNING *`,[classificationId,decision==='CORRECT'?'CORRECTED':'CONFIRMED',actor])).rows[0];
      if(decision!=='CORRECT'||intent===row.intent)return{classification:reviewed,correction:null,task:null};
      const correction=(await client.query(`INSERT INTO leadgen.reply_classifications
          (inbound_message_id,intent,confidence,review_status,classifier_version,reason_codes,reviewed_by,reviewed_at,reply_category,classification_revision)
        SELECT $1,$2,1,'CONFIRMED','HUMAN_REVIEW_V1',ARRAY['HUMAN_CORRECTION'],$3,now(),$4,coalesce(max(classification_revision),0)+1
        FROM leadgen.reply_classifications WHERE inbound_message_id=$1 RETURNING *`,
        [row.inbound_message_id,intent,actor,row.reply_category])).rows[0];
      let task=null;
      const built=row.company_id?buildTask({intent,company_id:row.company_id,thread_id:row.thread_id,subject:row.subject_sanitized,body_text:row.body_text_sanitized}):null;
      if(built){
        // The task created for the original reading no longer applies.
        await client.query(`UPDATE leadgen.sales_tasks SET task_status='CANCELLED',closed_at=now(),close_reason='RECLASSIFIED',updated_by=$2,updated_at=now()
          WHERE classification_id=$1 AND task_status IN('OPEN','IN_PROGRESS')`,[classificationId,actor]);
        task=(await client.query(`INSERT INTO leadgen.sales_tasks(company_id,thread_id,inbound_message_id,task_type,task_status,owner,due_at,details,classification_id,effect_key,updated_by)
          VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7::jsonb,$8,$9,$5) RETURNING *`,
          [row.company_id,row.thread_id,row.inbound_message_id,built.task_type,actor,built.task.due_at,JSON.stringify(built.task),correction.id,`crm:review:${correction.id}`])).rows[0];
      }
      return{classification:reviewed,correction,task};
    });
  }

  async listFollowupDrafts({status='PENDING_APPROVAL',limit=100,scope=null}={}){
    return(await this.pool.query(`SELECT d.*,c.company_name,c.country_code,r.normalized_recipient recipient
      FROM leadgen.crm_followup_drafts d JOIN leadgen.companies c ON c.id=d.company_id
      LEFT JOIN leadgen.phase13_first_touch_reservations r ON r.id=d.first_touch_reservation_id
      WHERE ($1::text IS NULL OR d.draft_status=$1) AND ($3::uuid IS NULL OR d.merchant_id=$3)
      ORDER BY d.due_at,d.created_at LIMIT $2`,[status,limit,scope?.restrict?scope.merchantId:null])).rows;
  }

  // Threads whose next follow-up is due and that have no draft for that step yet.
  async dueFollowupCandidates({offsets,maxSequence,now=new Date(),limit=50}){
    const offsetRows=Object.entries(offsets).map(([sequence,days])=>`(${Number(sequence)},${Number(days)})`).join(',');
    return(await this.pool.query(`WITH steps(sequence_no,offset_days) AS(VALUES ${offsetRows})
      SELECT t.id thread_id,t.company_id,t.merchant_id,r.id reservation_id,r.reply_to,r.eligibility_snapshot->>'product_profile' product_profile,
        c.company_name,s.sequence_no,(r.completed_at+make_interval(days=>s.offset_days)) due_at
      FROM leadgen.outreach_threads t
      JOIN leadgen.phase13_first_touch_reservations r ON r.id=t.first_touch_reservation_id
      JOIN leadgen.companies c ON c.id=t.company_id
      JOIN steps s ON s.sequence_no<=$1
      WHERE ${FOLLOWUP_THREAD_OPEN_SQL}
        AND r.completed_at+make_interval(days=>s.offset_days)<=$2
        AND NOT EXISTS(SELECT 1 FROM leadgen.crm_followup_drafts d WHERE d.thread_id=t.id AND d.sequence_no=s.sequence_no)
        AND (s.sequence_no=2 OR EXISTS(SELECT 1 FROM leadgen.crm_followup_drafts d WHERE d.thread_id=t.id AND d.sequence_no=s.sequence_no-1 AND d.draft_status='SENT'))
      ORDER BY due_at LIMIT $3`,[maxSequence,now,limit])).rows;
  }

  async insertFollowupDraft(input){
    return(await this.pool.query(`INSERT INTO leadgen.crm_followup_drafts(company_id,thread_id,first_touch_reservation_id,sequence_no,due_at,subject,body_text,template_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(thread_id,sequence_no) DO NOTHING RETURNING *`,
      [input.company_id,input.thread_id,input.reservation_id,input.sequence_no,input.due_at,input.subject,input.body_text,input.template_key])).rows[0]||null;
  }

  async decideFollowupDraft(draftId,{decision,subject,body_text,reason},actor,scope=null){
    return this.transaction(async client=>{
      const draft=(await client.query('SELECT * FROM leadgen.crm_followup_drafts WHERE id=$1 AND ($2::uuid IS NULL OR merchant_id=$2) FOR UPDATE',[draftId,scope?.restrict?scope.merchantId:null])).rows[0];
      if(!draft)throw fail('CRM_FOLLOWUP_NOT_FOUND','Follow-up draft not found',404);
      if(draft.draft_status!=='PENDING_APPROVAL')throw fail('CRM_FOLLOWUP_DECIDED','This follow-up has already been decided',409);
      if(decision==='DISCARD')return(await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status='DISCARDED',discarded_by=$2,discard_reason=$3,updated_at=now()
        WHERE id=$1 RETURNING *`,[draftId,actor,reason||null])).rows[0];
      const open=(await client.query(`SELECT 1 FROM leadgen.outreach_threads t JOIN leadgen.phase13_first_touch_reservations r ON r.id=t.first_touch_reservation_id
        WHERE t.id=$1 AND ${FOLLOWUP_THREAD_OPEN_SQL}`,[draft.thread_id])).rowCount;
      if(!open)return(await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status='BLOCKED',reason_codes=ARRAY['THREAD_NOT_OPEN'],updated_at=now()
        WHERE id=$1 RETURNING *`,[draftId])).rows[0];
      return(await client.query(`UPDATE leadgen.crm_followup_drafts SET draft_status='APPROVED',subject=coalesce($2,subject),body_text=coalesce($3,body_text),
          approved_by=$4,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[draftId,subject||null,body_text||null,actor])).rows[0];
    });
  }
}
