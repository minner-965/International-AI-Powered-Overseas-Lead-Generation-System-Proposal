import { createHash, randomUUID } from 'node:crypto';
import { deriveOpportunityDecision } from './opportunityDecision.js';
import {attachContactProgress,firstContactPendingSql} from '../outreach/contactProgress.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value, label = 'id') {
  const normalized = String(value || '').trim();
  if (!UUID.test(normalized)) {
    const error = new Error(`${label} must be a UUID`);
    error.code = 'PHASE7_INVALID_ID';
    error.status = 400;
    throw error;
  }
  return normalized;
}

function notFound(message, code = 'PHASE7_NOT_FOUND') {
  const error = new Error(message);
  error.code = code;
  error.status = 404;
  return error;
}

function cleanFilename(value) {
  return String(value || 'phase7-upload')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180) || 'phase7-upload';
}

function importDomain(value) {
  try { return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return null; }
}

function normalizedCompanyName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function mapImportStatus(row) {
  if (!row) return null;
  const approval = row.approval_decision;
  const status = row.status === 'VALIDATED' ? 'DRY_RUN_READY'
    : row.status === 'VALIDATION_FAILED' ? 'DRY_RUN_FAILED'
      : row.status === 'COMMITTING' && approval === 'APPROVED' ? 'APPROVED'
        : row.status === 'COMMITTING' ? 'SUBMITTED'
          : row.status;
  return { ...row, api_status: status };
}

function approvalGateBlocked(reasons = []) {
  const error = new Error('Opportunity approval requires a current contact-ready decision, fresh eligibility and an unsuppressed VALID recipient');
  error.code = 'OPPORTUNITY_APPROVAL_GATE_BLOCKED';
  error.status = 409;
  error.details = { reasons:[...new Set(reasons)] };
  return error;
}

export class Phase7Repository {
  constructor({ pool }) {
    if (!pool?.query) throw new TypeError('pool.query is required');
    this.pool = pool;
  }

  async transaction(operation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getMarketingContext() {
    const result = await this.pool.query(`
      SELECT v.*,a.id approval_id,a.decision approval_decision,a.approver_identity,
        a.approver_role,a.approved_at approval_decided_at
      FROM leadgen.marketing_context_versions v
      LEFT JOIN LATERAL (
        SELECT x.* FROM leadgen.marketing_context_approvals x
        WHERE x.marketing_context_version_id=v.id
        ORDER BY x.approved_at DESC,x.id DESC LIMIT 1
      ) a ON true
      ORDER BY (a.decision='APPROVED') DESC,v.created_at DESC LIMIT 1`);
    return result.rows[0] || null;
  }

  async listOutreachWorkbench(){
    const result=await this.pool.query(`SELECT c.id company_id,c.company_name,o.product_profile,
      o.id opportunity_id,o.display_opportunity_status opportunity_status,
      s.id eligibility_snapshot_id,CASE WHEN auto_r.id IS NOT NULL THEN 'ELIGIBLE' ELSE s.eligibility_status END eligibility_status,s.input_digest,
      r.id recipient_id,coalesce(r.normalized_recipient,contact.contact_value_normalized,auto_r.normalized_recipient) recipient_email,
      coalesce(r.verification_status,contact.verification_status,auto_contact.verification_status) verification_status,
      coalesce(r.verified_at,contact.last_verified_at,auto_contact.last_verified_at) verified_at,
      coalesce(r.verification_provider,contact.verification_provider,auto_contact.verification_provider) verification_provider,
      coalesce(contact.evidence_origin,auto_contact.evidence_origin) verification_source,
      d.id draft_id,d.draft_status,coalesce(d.subject,auto_r.subject) subject,coalesce(d.body_text,auto_r.body_text) body_text,d.version draft_version,d.submitted_at,
      a.id approval_id,m.id message_id,m.send_status,src.id evidence_source_id,
      coalesce(r.recipient_type,auto_contact.contact_type) recipient_type,coalesce(contact.source_url,auto_contact.source_url) recipient_source,
      m.transport_status,m.receipt_evidence_status,auto_r.id first_touch_reservation_id,auto_r.template_key,
      (auto_r.id IS NOT NULL) automated_first_touch,
      CASE WHEN crm.funnel_status IN('OPTED_OUT','BOUNCED','REPLIED') THEN crm.funnel_status
        WHEN m.send_status='HARD_BOUNCED' THEN 'BOUNCED'
        WHEN reply.reply_category='OPT_OUT' THEN 'OPTED_OUT'
        WHEN reply.reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE') THEN 'REPLIED'
        ELSE m.business_contact_status END business_contact_status,m.sent_at,
      d.created_at draft_created_at,a.approved_at,coalesce(crm.owner_identity,q.owner_identity,me.actor_identity) owner,
      crm.next_action,reply.received_at last_reply_at,reply.reply_category reply_status,
      coalesce(sync.sync_status,'NOT_REQUIRED') crm_sync,
      EXISTS(SELECT 1 FROM leadgen.contact_suppressions x WHERE x.lifted_at IS NULL AND x.company_id=c.id AND
        (x.contact_id=r.contact_id OR x.decision_maker_contact_id=coalesce(r.decision_maker_contact_id,auto_r.decision_maker_contact_id) OR
        x.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(coalesce(r.normalized_recipient,auto_r.normalized_recipient))),'UTF8')),'hex'))) suppression,
      coalesce(activity.events,'[]'::jsonb) activity,
      (m.send_status='BLOCKED' AND m.sent_at IS NULL AND m.provider_message_id IS NULL AND m.ambiguous_since IS NULL
        AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_message_attempts x WHERE x.outbound_message_id=m.id AND x.provider_call_started_at IS NOT NULL)) retry_before_provider_possible
      FROM leadgen.business_opportunity_current o JOIN leadgen.companies c ON c.id=o.company_id
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.outreach_eligibility_snapshots x
        WHERE x.company_id=o.company_id AND x.product_profile=o.product_profile ORDER BY created_at DESC,id DESC LIMIT 1)s ON true
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.phase13_first_touch_reservations x
        WHERE x.company_id=o.company_id AND x.eligibility_snapshot->>'product_profile'=o.product_profile
        ORDER BY x.created_at DESC,x.id DESC LIMIT 1)auto_r ON true
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.outreach_drafts x JOIN leadgen.outreach_eligibility_snapshots ds ON ds.id=x.eligibility_snapshot_id
        WHERE x.company_id=o.company_id AND ds.product_profile=o.product_profile ORDER BY x.created_at DESC,x.version DESC,x.id DESC LIMIT 1)d ON true
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.outreach_recipients x
        WHERE (d.id IS NOT NULL AND x.id=d.recipient_id) OR (d.id IS NULL AND x.eligibility_snapshot_id=s.id AND x.lifecycle_status='ACTIVE') ORDER BY verified_at DESC NULLS LAST,id LIMIT 1)r ON true
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.decision_maker_contacts x WHERE x.decision_maker_id=s.decision_maker_id
        AND x.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
        AND (r.decision_maker_contact_id IS NULL OR x.id=r.decision_maker_contact_id)
        ORDER BY (x.verification_status='VALID') DESC,x.last_verified_at DESC NULLS LAST,x.id LIMIT 1)contact ON true
      LEFT JOIN leadgen.decision_maker_contacts auto_contact ON auto_contact.id=auto_r.decision_maker_contact_id
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.outreach_approvals x WHERE x.draft_id=d.id
        AND x.content_hash=d.content_hash AND x.decision='APPROVED' ORDER BY approved_at DESC,id DESC LIMIT 1)a ON true
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.outbound_messages x
        WHERE (a.id IS NOT NULL AND x.approval_id=a.id)
          OR (auto_r.id IS NOT NULL AND x.first_touch_reservation_id=auto_r.id)
        ORDER BY x.queued_at DESC,x.id DESC LIMIT 1)m ON true
      LEFT JOIN leadgen.contact_work_queue q ON q.company_id=c.id AND q.product_profile=o.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      LEFT JOIN leadgen.business_opportunity_management_events me ON me.id=q.management_event_id
      LEFT JOIN leadgen.opportunity_crm_states crm ON crm.opportunity_snapshot_id=o.id
      LEFT JOIN LATERAL(SELECT i.received_at,rc.reply_category FROM leadgen.inbound_messages i
        LEFT JOIN LATERAL(SELECT x.reply_category FROM leadgen.reply_classifications x WHERE x.inbound_message_id=i.id ORDER BY x.created_at DESC LIMIT 1)rc ON true
        WHERE i.correlation_outbound_message_id=m.id AND i.correlation_status='MATCHED' ORDER BY i.received_at DESC LIMIT 1)reply ON true
      LEFT JOIN LATERAL(SELECT x.sync_status FROM leadgen.crm_sync_outbox x WHERE x.record_scope='PROSPECT' AND x.company_id=c.id ORDER BY x.created_at DESC LIMIT 1)sync ON true
      LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('event_type',x.activity_type,'occurred_at',x.created_at) ORDER BY x.created_at) events
        FROM leadgen.opportunity_activities x WHERE x.record_scope='PROSPECT' AND x.company_id=c.id AND x.opportunity_snapshot_id=o.id)activity ON true
      LEFT JOIN LATERAL(SELECT x.id FROM leadgen.sources x WHERE x.company_id=c.id ORDER BY x.id LIMIT 1)src ON true
      WHERE o.display_opportunity_status IN('RECOMMENDED','MANAGEMENT_APPROVED') OR d.id IS NOT NULL OR auto_r.id IS NOT NULL
      ORDER BY c.company_name,o.product_profile LIMIT 100`);
    return attachContactProgress(this.pool,result.rows);
  }

  async getOutreachOperationsSummary(){
    const result=await this.pool.query(`SELECT
      (SELECT count(*)::int FROM leadgen.outbound_messages m
        LEFT JOIN leadgen.outreach_approvals a ON a.id=m.approval_id
        LEFT JOIN leadgen.opportunity_crm_states crm ON crm.opportunity_snapshot_id=coalesce(a.opportunity_snapshot_id,
          (SELECT current.id FROM leadgen.business_opportunity_current current
           JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.company_id=current.company_id
            AND reservation.id=m.first_touch_reservation_id
           WHERE current.product_profile=reservation.eligibility_snapshot->>'product_profile' LIMIT 1))
        LEFT JOIN LATERAL(SELECT rc.reply_category FROM leadgen.inbound_messages i
          LEFT JOIN LATERAL(SELECT x.reply_category FROM leadgen.reply_classifications x
            WHERE x.inbound_message_id=i.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)rc ON true
          WHERE i.correlation_outbound_message_id=m.id AND i.correlation_status='MATCHED'
          ORDER BY CASE WHEN rc.reply_category='OPT_OUT' THEN 0
            WHEN rc.reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE') THEN 1 ELSE 2 END,
            i.received_at DESC,i.id DESC LIMIT 1)reply ON true
        WHERE CASE WHEN crm.funnel_status IN('OPTED_OUT','BOUNCED','REPLIED') THEN crm.funnel_status
          WHEN m.send_status='HARD_BOUNCED' THEN 'BOUNCED'
          WHEN reply.reply_category='OPT_OUT' THEN 'OPTED_OUT'
          WHEN reply.reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE') THEN 'REPLIED'
          ELSE m.business_contact_status END='SENT_NO_REPLY') sent_no_reply,
      (SELECT count(*)::int FROM leadgen.sales_tasks
        WHERE record_scope='PROSPECT' AND task_status IN('OPEN','IN_PROGRESS')
          AND task_type IN('FOLLOW_UP','REPLY_REVIEW','QUOTATION','SAMPLE','MEETING','CRM_HANDOFF')) pending_followups,
      (SELECT count(*)::int FROM leadgen.business_opportunity_current o
        WHERE display_opportunity_status='RECOMMENDED' AND ${firstContactPendingSql('o')}) pending_management,
      (SELECT count(*)::int FROM leadgen.business_opportunity_current
        WHERE business_fit_status='FIT' AND contact_readiness<>'READY'
          AND display_opportunity_status='EVIDENCE_REQUIRED') pending_contacts,
      (SELECT count(*)::int FROM (SELECT DISTINCT ON(company_id,product_profile) eligibility_status,expires_at
        FROM leadgen.outreach_eligibility_snapshots ORDER BY company_id,product_profile,created_at DESC,id DESC)s
        WHERE eligibility_status='ELIGIBLE' AND expires_at>now()) eligible,
      (SELECT count(*)::int FROM leadgen.outreach_drafts WHERE draft_status IN('DRAFT','PENDING_REVIEW','NEEDS_CHANGES')) pending_drafts,
      (SELECT count(*)::int FROM leadgen.outreach_drafts WHERE draft_status='APPROVED') approved,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE send_status IN('QUEUED','SENDING')) queued,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE sent_at IS NOT NULL) smtp_accepted,
      (SELECT count(*)::int FROM leadgen.inbound_messages i
        JOIN LATERAL(SELECT rc.reply_category FROM leadgen.reply_classifications rc WHERE rc.inbound_message_id=i.id
          ORDER BY rc.created_at DESC,rc.id DESC LIMIT 1)current_reply ON true
        WHERE i.correlation_status='MATCHED' AND current_reply.reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE')
          AND EXISTS(SELECT 1 FROM leadgen.outbound_messages m WHERE m.id=i.correlation_outbound_message_id AND m.sent_at IS NOT NULL)) replies,
      (SELECT count(*)::int FROM leadgen.contact_suppressions WHERE lifted_at IS NULL) suppressed,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE send_status IN('FAILED','BLOCKED','AMBIGUOUS','HARD_BOUNCED')) failed,
      (SELECT count(*)::int FROM leadgen.controlled_application_contexts) controlled_contexts,
      (SELECT count(*)::int FROM leadgen.controlled_application_messages WHERE send_status='PROVIDER_ACCEPTED') controlled_sent,
      (SELECT count(*)::int FROM leadgen.controlled_application_inbound_messages) controlled_inbound,
      (SELECT count(*)::int FROM leadgen.controlled_application_suppressions) controlled_suppressed`);
    const {controlled_contexts,controlled_sent,controlled_inbound,controlled_suppressed,...prospect}=result.rows[0];
    return{prospect,controlled:{contexts:controlled_contexts,sent:controlled_sent,inbound:controlled_inbound,suppressed:controlled_suppressed}};
  }

  async getOutreachMonitoring(){
    const result=await this.pool.query(`SELECT
      (SELECT max(last_sync_at) FROM leadgen.imap_mailbox_checkpoints) last_inbound_sync,
      (SELECT max(last_success_at) FROM leadgen.imap_mailbox_checkpoints) last_successful_sync,
      (SELECT count(*)::int FROM leadgen.imap_mailbox_checkpoints WHERE last_success_at IS NULL OR last_success_at<now()-interval '15 minutes') imap_checkpoint_stale,
      (SELECT count(*)::int FROM leadgen.imap_mailbox_checkpoints WHERE checkpoint_status='ERROR') imap_sync_failure,
      (SELECT count(*)::int FROM leadgen.imap_checkpoint_events WHERE event_type='UIDVALIDITY_RESET' AND occurred_at>now()-interval '24 hours') uidvalidity_changed,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE send_status='AMBIGUOUS') send_ambiguous,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE send_status='SENDING' AND send_lease_expires_at<now()) outbound_stuck,
      (SELECT count(*)::int FROM leadgen.crm_sync_outbox WHERE record_scope='PROSPECT' AND sync_status IN('PENDING','PROCESSING','RETRYABLE_ERROR') AND created_at<now()-interval '15 minutes') crm_outbox_lag,
      (SELECT count(*)::int FROM leadgen.crm_sync_outbox WHERE record_scope='PROSPECT' AND last_error='CRM_STALE_PROCESSING_RECONCILIATION_REQUIRED') crm_reconciliation_required,
      (SELECT count(*)::int FROM leadgen.outbound_message_attempts WHERE started_at>now()-interval '24 hours' AND (response_code='535' OR 'SMTP_AUTH_FAILED'=ANY(reason_codes))) smtp_auth_failure,
      (SELECT count(*)::int FROM leadgen.outbound_messages WHERE updated_at>now()-interval '24 hours' AND send_status='BLOCKED' AND EXISTS(SELECT 1 FROM unnest(reason_codes) reason WHERE reason LIKE '%SUPPRESS%')) suppression_blocked_attempt,
      (SELECT count(*)::int FROM leadgen.inbound_messages WHERE correlation_status<>'MATCHED') inbound_correlation_review`);
    return result.rows[0];
  }

  async createMarketingContext(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.marketing_context_versions
      (version,context_status,allowed_markets,allowed_product_profiles,target_languages,
       ruleset_version,content,content_hash,created_by,submitted_at,expires_at,supersedes_version_id)
      VALUES($1,$2,$3::text[],$4::text[],$5::text[],$6,$7::jsonb,$8,$9,$10,$11,$12)
      ON CONFLICT(version) DO NOTHING
      RETURNING *`, [
      input.version, input.context_status, input.allowed_markets, input.allowed_product_profiles,
      input.target_languages, input.ruleset_version, JSON.stringify(input.content), input.content_hash,
      input.created_by, input.submitted_at, input.expires_at, input.supersedes_version_id
    ]);
    if (result.rowCount) return result.rows[0];
    const existing = await this.pool.query('SELECT * FROM leadgen.marketing_context_versions WHERE version=$1', [input.version]);
    const row = existing.rows[0];
    if (row && row.content_hash.toLowerCase() === input.content_hash.toLowerCase()
      && row.ruleset_version === input.ruleset_version) return row;
    const error = new Error('Marketing context version already exists with a different immutable payload');
    error.code = 'MARKETING_CONTEXT_VERSION_CONFLICT'; error.status = 409; throw error;
  }

  async approveMarketingContext({ id, contentHash, approvalDigest, decision, actor, role, reason }) {
    requiredUuid(id, 'marketing_context_id');
    return this.transaction(async client => {
      const version = await client.query(`SELECT * FROM leadgen.marketing_context_versions
        WHERE id=$1 AND lower(content_hash)=lower($2) FOR UPDATE`, [id,contentHash]);
      if (!version.rowCount) throw notFound('Marketing context version was not found or content changed', 'MARKETING_CONTEXT_NOT_FOUND');
      const prior = await client.query(`SELECT * FROM leadgen.marketing_context_approvals
        WHERE marketing_context_version_id=$1 AND approval_digest=$2 AND decision=$3
        ORDER BY approved_at DESC LIMIT 1`, [id,approvalDigest,decision]);
      let approval = prior.rows[0] || null;
      if (!approval) {
        const result = await client.query(`INSERT INTO leadgen.marketing_context_approvals
          (marketing_context_version_id,content_hash,approval_digest,decision,approver_identity,approver_role,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT DO NOTHING RETURNING *`, [id,contentHash,approvalDigest,decision,actor,role,reason]);
        approval = result.rows[0] || (await client.query(`SELECT * FROM leadgen.marketing_context_approvals
          WHERE marketing_context_version_id=$1 AND content_hash=$2 AND decision='APPROVED'
          ORDER BY approved_at DESC LIMIT 1`, [id,contentHash])).rows[0];
      }
      if (!approval) {
        const error = new Error('Marketing context already has a different active approval');
        error.code = 'MARKETING_CONTEXT_APPROVAL_CONFLICT'; error.status = 409; throw error;
      }
      const contextStatus = decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'SUPERSEDED';
      await client.query(`UPDATE leadgen.marketing_context_versions SET context_status=$2,
        approved_at=CASE WHEN $2='APPROVED' THEN coalesce(approved_at,now()) ELSE approved_at END WHERE id=$1`, [id,contextStatus]);
      return approval;
    });
  }

  async resolveOpportunity(reference, queryable = this.pool) {
    const value = String(reference || '').trim();
    const key = value.match(/^([0-9a-f-]{36}):(WOMENSWEAR|GENERAL_MERCHANDISE)$/i);
    const params = key ? [key[1],key[2].toUpperCase()] : [requiredUuid(value,'opportunity_id')];
    const where = key ? 'company_id=$1 AND product_profile=$2' : 'id=$1';
    const result = await queryable.query(`SELECT * FROM leadgen.business_opportunity_current WHERE ${where}`, params);
    return result.rows[0] || null;
  }

  async opportunityDecisionHistory(reference) {
    const current = await this.resolveOpportunity(reference);
    if (!current) throw notFound('Opportunity decision not found','OPPORTUNITY_DECISION_NOT_FOUND');
    const [snapshots,events,queue] = await Promise.all([
      this.pool.query(`SELECT * FROM leadgen.business_opportunity_decision_snapshots
        WHERE company_id=$1 AND product_profile=$2 ORDER BY assessment_revision DESC,created_at DESC`, [current.company_id,current.product_profile]),
      this.pool.query(`SELECT * FROM leadgen.business_opportunity_management_events
        WHERE company_id=$1 AND product_profile=$2 ORDER BY created_at DESC,id DESC`, [current.company_id,current.product_profile]),
      this.pool.query(`SELECT * FROM leadgen.contact_work_queue
        WHERE company_id=$1 AND product_profile=$2 ORDER BY created_at DESC,id DESC`, [current.company_id,current.product_profile])
    ]);
    return { current, snapshots:snapshots.rows, management_events:events.rows, contact_queue_history:queue.rows };
  }

  async recordOpportunityManagement(reference, input) {
    return this.transaction(async client => {
      const initiallyCurrent = await this.resolveOpportunity(reference,client);
      if (!initiallyCurrent) throw notFound('Opportunity decision not found','OPPORTUNITY_DECISION_NOT_FOUND');
      await client.query(`SELECT id FROM leadgen.business_opportunity_decision_snapshots
        WHERE company_id=$1 AND product_profile=$2
        ORDER BY assessment_revision DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [initiallyCurrent.company_id,initiallyCurrent.product_profile]);
      const companyLock=await client.query(`SELECT id,verification_status,lifecycle_status FROM leadgen.companies
        WHERE id=$1 FOR UPDATE`,[initiallyCurrent.company_id]);
      const current=await this.resolveOpportunity(`${initiallyCurrent.company_id}:${initiallyCurrent.product_profile}`,client);
      if (!current) throw notFound('Opportunity decision not found','OPPORTUNITY_DECISION_NOT_FOUND');

      let approvalRecipients=[];
      let recipientsCreated=0;
      if(input.event_type==='MANAGEMENT_APPROVED'){
        const reasons=[];
        if(current.id!==input.expected_decision_snapshot_id
          ||Number(current.assessment_revision)!==Number(input.expected_assessment_revision))reasons.push('DECISION_REVISION_CHANGED');
        if(current.display_opportunity_status!=='RECOMMENDED')reasons.push('DISPLAY_STATUS_NOT_RECOMMENDED');
        if(current.system_recommendation_status!=='RECOMMENDED')reasons.push('SYSTEM_STATUS_NOT_RECOMMENDED');
        if(current.business_fit_status!=='FIT')reasons.push('BUSINESS_FIT_NOT_READY');
        if(current.contact_readiness!=='READY')reasons.push('CONTACT_NOT_READY');
        if(current.policy_contact_status!=='OPEN'||current.relationship_status!=='NEW_PROSPECT')reasons.push('CONTACT_POLICY_BLOCKED');
        if(current.rule_version!=='business-opportunity-decision-v5')reasons.push('DECISION_RULE_VERSION_STALE');
        if(companyLock.rows[0]?.verification_status!=='VERIFIED'||companyLock.rows[0]?.lifecycle_status!=='ACTIVE')reasons.push('COMPANY_NOT_ACTIVE_VERIFIED');
        if(reasons.length)throw approvalGateBlocked(reasons);

        const eligibility=await client.query(`SELECT * FROM leadgen.outreach_eligibility_snapshots
          WHERE company_id=$1 AND product_profile=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
        [current.company_id,current.product_profile]);
        const eligible=eligibility.rows[0];
        if(!eligible)reasons.push('ELIGIBILITY_MISSING');
        else{
          if(eligible.eligibility_status!=='ELIGIBLE'||new Date(eligible.expires_at)<=new Date())reasons.push('ELIGIBILITY_NOT_CURRENT');
          if(eligible.rule_version!==current.rule_version||eligible.input_digest!==current.input_digest)reasons.push('ELIGIBILITY_VERSION_STALE');
          if(eligible.buyer_business_model_result_id!==current.buyer_business_model_result_id
            ||eligible.category_procurement_match_result_id!==current.category_procurement_match_result_id
            ||eligible.product_opportunity_result_id!==current.product_opportunity_result_id
            ||eligible.cooperation_feasibility_result_id!==current.cooperation_feasibility_result_id)reasons.push('ELIGIBILITY_DECISION_MISMATCH');
        }
        if(reasons.length)throw approvalGateBlocked(reasons);

        const ttlDays=Math.max(1,Number(input.verification_ttl_days)||30);
        const contacts=await client.query(`SELECT dc.id decision_maker_contact_id,
          lower(btrim(dc.contact_value_normalized)) normalized_recipient,dc.contact_type,dc.verification_status,
          dc.verification_provider,dc.last_verified_at
          FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id AND dm.id=$1
            AND dm.company_id=$2 AND dm.lifecycle_status='ACTIVE'
          JOIN leadgen.companies recipient_company ON recipient_company.id=dm.company_id
          WHERE $3::text IS NOT NULL AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
            AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($4::int*interval '1 day')
            AND dc.last_verified_at<=now()
            AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED'
            AND lower(split_part(dc.contact_value_normalized,'@',2))=lower(regexp_replace(recipient_company.normalized_domain,'^(live:[a-z]{2}:)?(www[.])?','','i'))
            AND position('@' in dc.contact_value_normalized)>1
            AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions cs
              WHERE cs.company_id=$2 AND cs.lifted_at IS NULL)
            AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx
              WHERE sx.company_id=$2 AND sx.lifted_at IS NULL AND (
                sx.decision_maker_contact_id=dc.id OR
                sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(dc.contact_value_normalized)),'UTF8')),'hex')))
          ORDER BY dc.last_verified_at DESC,dc.id LIMIT 1 FOR UPDATE OF dm,dc`,
        [eligible.decision_maker_id,current.company_id,current.product_profile,ttlDays]);
        if(!contacts.rowCount)throw approvalGateBlocked(['ACTIVE_VALID_RECIPIENT_REQUIRED']);
        const contact=contacts.rows[0];
        const recipient=await client.query(`INSERT INTO leadgen.outreach_recipients
          (eligibility_snapshot_id,company_id,decision_maker_contact_id,normalized_recipient,
           consent_status,verification_status,verification_provider,verified_at,lifecycle_status,recipient_type,recipient_source_class,recipient_domain_verified)
          VALUES($1,$2,$3,$4,'UNKNOWN','VALID',$5,$6,'ACTIVE',CASE WHEN $7='BUSINESS_EMAIL' THEN 'NAMED_BUYER_EMAIL' WHEN $7='DEPARTMENT_EMAIL' THEN 'OFFICIAL_DEPARTMENT_EMAIL' ELSE 'OFFICIAL_COMPANY_EMAIL' END,'VERIFIED_DECISION_MAKER_CONTACT',true)
          ON CONFLICT(eligibility_snapshot_id,normalized_recipient) DO UPDATE SET
            verification_status=EXCLUDED.verification_status,
            verification_provider=EXCLUDED.verification_provider,
            verified_at=EXCLUDED.verified_at
          WHERE leadgen.outreach_recipients.lifecycle_status='ACTIVE'
          RETURNING *`,[eligible.id,current.company_id,contact.decision_maker_contact_id,
          contact.normalized_recipient,contact.verification_provider,contact.last_verified_at,contact.contact_type]);
        approvalRecipients=recipient.rows;
        recipientsCreated=recipient.rowCount;
        if(!approvalRecipients.some(row=>row.lifecycle_status==='ACTIVE'&&row.verification_status==='VALID'
          &&row.verified_at&&Date.now()-new Date(row.verified_at).getTime()<=ttlDays*86_400_000)){
          throw approvalGateBlocked(['ACTIVE_VALID_RECIPIENT_REQUIRED']);
        }
      }
      const inserted = await client.query(`INSERT INTO leadgen.business_opportunity_management_events
        (decision_snapshot_id,company_id,product_profile,event_type,management_contact_status,
         actor_identity,actor_role,reason,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`, [
        current.id,current.company_id,current.product_profile,input.event_type,input.management_contact_status,
        input.actor,input.role,input.reason,input.idempotency_key]);
      const managementEvent=inserted.rows[0]||(await client.query(`SELECT * FROM leadgen.business_opportunity_management_events WHERE idempotency_key=$1`,[input.idempotency_key])).rows[0];
      let queue = null;
      if (input.event_type === 'MANAGEMENT_APPROVED') {
        const queued = await client.query(`INSERT INTO leadgen.contact_work_queue
          (company_id,product_profile,decision_snapshot_id,management_event_id,queue_status,owner_identity,reason_codes)
          VALUES($1,$2,$3,$4,'ACTIVE',$5,$6::text[])
          ON CONFLICT(management_event_id) DO NOTHING RETURNING *`, [
          current.company_id,current.product_profile,current.id,managementEvent.id,input.owner_identity || null,input.reason_codes || []]);
        queue = queued.rows[0]||(await client.query(`SELECT * FROM leadgen.contact_work_queue WHERE management_event_id=$1`,[managementEvent.id])).rows[0];
      } else {
        const queueStatus = input.event_type === 'HOLD' ? 'CANCELLED' : 'STALE';
        await client.query(`UPDATE leadgen.contact_work_queue SET queue_status=$3,updated_at=now()
          WHERE company_id=$1 AND product_profile=$2 AND queue_status='ACTIVE'`, [current.company_id,current.product_profile,queueStatus]);
      }
      return { current, management_event:managementEvent, queue,recipients:approvalRecipients,
        recipients_created:recipientsCreated,provider_calls:0,messages_approved:0 };
    });
  }

  async listContactQueue({ limit = 200 } = {}) {
    const result = await this.pool.query(`WITH recommended AS (
      SELECT o.company_id,array_agg(DISTINCT o.product_profile ORDER BY o.product_profile) matched_categories,
        (array_agg(o.id ORDER BY o.created_at DESC,o.id DESC))[1] opportunity_id,
        max(o.created_at) assessed_at
      FROM leadgen.business_opportunity_current o
      WHERE o.display_opportunity_status='RECOMMENDED' AND ${firstContactPendingSql('o')}
      GROUP BY o.company_id
    )
    SELECT r.opportunity_id,c.id company_id,c.company_name,c.country_code,c.website_url,
      'CONTACT_READY' queue_status,r.matched_categories,'RECOMMENDED' opportunity_status,r.assessed_at,
      route.named_buyers,route.contact_routes,route.route_count,
      coalesce(cardinality(route.named_buyers),0)>0 named_buyer_ready,
      coalesce(route.contact_routes@>'[{"route_type":"BUSINESS_EMAIL"}]'::jsonb,false)
        OR coalesce(route.contact_routes@>'[{"route_type":"GENERIC_BUSINESS_EMAIL"}]'::jsonb,false)
        OR coalesce(route.contact_routes@>'[{"route_type":"DEPARTMENT_EMAIL"}]'::jsonb,false) official_email_route,
      coalesce(route.contact_routes@>'[{"route_type":"BUSINESS_PHONE"}]'::jsonb,false) official_phone_route,
      coalesce(route.contact_routes@>'[{"route_type":"BUSINESS_WHATSAPP"}]'::jsonb,false) official_whatsapp_route,
      coalesce(route.contact_routes@>'[{"route_type":"CONTACT_FORM"}]'::jsonb,false) official_form_route
    FROM recommended r JOIN leadgen.companies c ON c.id=r.company_id
    JOIN LATERAL(SELECT
      coalesce(array_agg(DISTINCT dm.person_name ORDER BY dm.person_name)
        FILTER(WHERE dm.person_name IS NOT NULL AND dm.verification_status='VERIFIED'),'{}'::text[]) named_buyers,
      coalesce(jsonb_agg(DISTINCT jsonb_build_object(
        'route_type',dc.contact_type,'value',dc.contact_value_normalized,'source_url',dc.source_url,
        'last_verified_at',dc.last_verified_at,'canonical_route_key',encode(sha256(convert_to(
          concat_ws('|',c.id::text,dc.contact_type,lower(btrim(dc.contact_value_normalized))),'UTF8')),'hex')))
        FILTER(WHERE dc.id IS NOT NULL),'[]'::jsonb) contact_routes,
      count(DISTINCT (dc.contact_type,lower(btrim(dc.contact_value_normalized))))::int route_count
      FROM leadgen.decision_makers dm
      LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=dm.id
        AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED' AND dc.source_url~'^https?://'
        AND ((dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
              AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED'))
          OR (dc.contact_type='BUSINESS_PHONE' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','FORMAT_VALID'))
          OR (dc.contact_type='BUSINESS_WHATSAPP' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','BUSINESS_WHATSAPP_OBSERVED'))
          OR (dc.contact_type='CONTACT_FORM' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED')
              AND dc.contact_value_normalized~*'/(contact([-_]?us)?|support|enquiry|inquiry)(/|[?#]|$)'))
      WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
    )route ON route.route_count>0
    WHERE c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
      AND c.explicit_exclusion_reason IS NULL AND c.replaced_by_company_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
    ORDER BY r.assessed_at DESC,c.company_name LIMIT $1`, [Math.max(1,Math.min(500,Number(limit)||200))]);
    return attachContactProgress(this.pool,result.rows);
  }

  async syncManualOfficialRoutes({ verificationTtlDays = 30, sourceTtlDays = 90, createdBy = 'SYSTEM_RECONCILIATION' } = {}) {
    void verificationTtlDays;void sourceTtlDays;void createdBy;
    return{created:0,items:[],retired_policy:true};
  }

  async listManualOfficialRoutes({ status = 'ACTIVE', limit = 200 } = {}) {
    const normalized=String(status||'ACTIVE').trim().toUpperCase();
    // Retired tasks remain auditable but never re-enter an active work queue.
    if (['ACTIVE','READY','IN_PROGRESS'].includes(normalized)) return [];
    const allowed=['READY','IN_PROGRESS','COMPLETED','DISMISSED'];
    if(normalized!=='ACTIVE'&&!allowed.includes(normalized)){
      const error=new Error('Invalid manual route status');error.code='MANUAL_ROUTE_STATUS_INVALID';error.status=400;throw error;
    }
    const result=await this.pool.query(`SELECT t.*,c.company_name,c.country_code,c.website_url,
      o.display_opportunity_status
      FROM leadgen.official_route_manual_task_current t
      JOIN leadgen.companies c ON c.id=t.company_id
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=t.company_id AND o.product_profile=t.product_profile
      WHERE (($1='ACTIVE' AND t.manual_action_status IN('READY','IN_PROGRESS')
          AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
          AND c.explicit_exclusion_reason IS NULL AND c.replaced_by_company_id IS NULL
          AND t.verified_at>=now()-(30*interval '1 day') AND t.captured_at>=now()-(90*interval '1 day')
          AND (t.route_type<>'CONTACT_FORM' OR t.official_url~*'/(contact([-_]?us)?|support|enquiry|inquiry|supplier|vendor|procurement|register|apply)(/|[?#]|$)')
          AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions sx
            WHERE sx.company_id=t.company_id AND sx.lifted_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
            JOIN leadgen.historical_customers hc ON hc.id=l.historical_customer_id
            WHERE l.company_id=t.company_id AND l.link_status='CONFIRMED'
              AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER')
          AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx
            WHERE sx.company_id=t.company_id AND sx.lifted_at IS NULL
              AND t.official_contact IS NOT NULL
              AND sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(t.official_contact)),'UTF8')),'hex')))
        OR ($1<>'ACTIVE' AND t.manual_action_status=$1))
      ORDER BY CASE t.manual_action_status WHEN 'IN_PROGRESS' THEN 1 WHEN 'READY' THEN 2 ELSE 3 END,
        t.created_at DESC,t.id DESC LIMIT $2`,[normalized,Math.max(1,Math.min(500,Number(limit)||200))]);
    return result.rows;
  }

  async recordManualOfficialRouteAction(id,{ status, ownerIdentity, outcome, actor, requestId }={}){
    void id;void status;void ownerIdentity;void outcome;void actor;void requestId;
    const error=new Error('Official route review tasks are retired');error.code='RETIRED_POLICY';error.status=410;throw error;
  }

  async refreshOpportunityDecisions({ ttlDays = 7 } = {}) {
    const facts = await this.pool.query(`
      WITH current_match AS (
        SELECT DISTINCT ON (company_id,product_profile) * FROM leadgen.category_procurement_match_results
        ORDER BY company_id,product_profile,created_at DESC,id DESC
      )
      SELECT c.id company_id,c.verification_status,c.lifecycle_status,c.replaced_by_company_id,
        c.explicit_exclusion_reason,c.verification_freshness,cpm.product_profile,cpm.research_job_id,
        cpm.id category_procurement_match_result_id,cpm.match_status,cpm.score,cpm.coverage_percent,
        cpm.calculation_version category_calculation_version,cpm.scope_revision_id,cpm.match_basis,
        bbm.id buyer_business_model_result_id,bbm.buyer_model,bbm.eligibility_status,bbm.reason_codes buyer_reason_codes,
        po.id product_opportunity_result_id,po.recommendation_status product_opportunity_status,
        f.id cooperation_feasibility_result_id,f.opportunity_readiness,f.relationship_status,
        f.verified_decision_maker_count,f.usable_contact_route_count,f.reason_codes cooperation_reason_codes,
        EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL) company_suppressed,
        EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers hc
          ON hc.id=l.historical_customer_id WHERE l.company_id=c.id AND l.link_status='CONFIRMED'
          AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER') confirmed_existing_customer,
        (SELECT count(DISTINCT dm.id)::int FROM leadgen.decision_makers dm
          JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dm.id AND pr.product_profile=cpm.product_profile
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE' AND dm.verification_status='VERIFIED'
            AND pr.relevance IN('HIGH','MEDIUM')) profile_relevant_buyer_count,
        (SELECT count(DISTINCT dm.id)::int FROM leadgen.decision_makers dm
          JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dm.id AND pr.product_profile=cpm.product_profile
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE' AND dm.verification_status='VERIFIED'
            AND pr.relevance IN('HIGH','MEDIUM') AND dm.normalized_role IN(
              'BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT',
              'MERCHANDISING','SOURCING','BUYING_DEPARTMENT','PROCUREMENT_DEPARTMENT')) verified_buyer_role_count,
        (SELECT count(*)::int FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
            AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) business_email_route_count,
        (SELECT count(*)::int FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
            AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
            AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')
            AND dc.last_verified_at<=now() AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED'
            AND lower(split_part(dc.contact_value_normalized,'@',2))=lower(regexp_replace(c.normalized_domain,'^(live:[a-z]{2}:)?(www[.])?','','i'))
            AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id
              AND sx.lifted_at IS NULL AND (sx.decision_maker_contact_id=dc.id OR
                sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(dc.contact_value_normalized)),'UTF8')),'hex')))) active_valid_email_route_count,
        (SELECT count(*)::int FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE' AND dc.source_url IS NOT NULL
            AND dc.last_verified_at>=now()-($1::int*interval '1 day')
            AND ((dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
                  AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED'))
              OR (dc.contact_type='BUSINESS_PHONE' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','FORMAT_VALID'))
              OR (dc.contact_type='BUSINESS_WHATSAPP' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','BUSINESS_WHATSAPP_OBSERVED'))
              OR (dc.contact_type='CONTACT_FORM' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED')
                  AND dc.contact_value_normalized~*'/(contact([-_]?us)?|support|enquiry|inquiry)(/|[?#]|$)'))
            AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id
              AND sx.lifted_at IS NULL AND (sx.decision_maker_contact_id=dc.id OR
                sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(dc.contact_value_normalized)),'UTF8')),'hex')))) active_company_contact_route_count,
        (SELECT coalesce(array_agg(DISTINCT dc.contact_type),'{}'::text[]) FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE' AND dc.source_url IS NOT NULL
            AND dc.last_verified_at>=now()-($1::int*interval '1 day')
            AND ((dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
                  AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED'))
              OR (dc.contact_type='BUSINESS_PHONE' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','FORMAT_VALID'))
              OR (dc.contact_type='BUSINESS_WHATSAPP' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','BUSINESS_WHATSAPP_OBSERVED'))
              OR (dc.contact_type='CONTACT_FORM' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED')
                  AND dc.contact_value_normalized~*'/(contact([-_]?us)?|support|enquiry|inquiry)(/|[?#]|$)'))) company_contact_route_types,
        (SELECT count(*)::int FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
            AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
            AND dc.verification_status='VALID' AND (dc.last_verified_at IS NULL OR dc.last_verified_at<now()-($1::int*interval '1 day'))) expired_valid_email_route_count,
        (SELECT coalesce(array_agg(DISTINCT dc.verification_status),'{}'::text[]) FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
            AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) email_route_statuses,
        /* Address suppressions are evaluated on each route above, not as a company-wide hold. */
        false contact_suppressed,
        (SELECT dm.id FROM leadgen.decision_makers dm
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
          ORDER BY CASE WHEN EXISTS(SELECT 1 FROM leadgen.decision_maker_contacts dc WHERE dc.decision_maker_id=dm.id
              AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
              AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')
              AND dc.last_verified_at<=now() AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED'
              AND lower(split_part(dc.contact_value_normalized,'@',2))=lower(regexp_replace(c.normalized_domain,'^(live:[a-z]{2}:)?(www[.])?','','i'))
              AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id
                AND sx.lifted_at IS NULL AND (sx.decision_maker_contact_id=dc.id OR
                  sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(dc.contact_value_normalized)),'UTF8')),'hex')))) THEN 0 ELSE 1 END,
            dm.updated_at DESC LIMIT 1) decision_maker_id
      FROM current_match cpm JOIN leadgen.companies c ON c.id=cpm.company_id
      JOIN leadgen.buyer_business_model_results bbm ON bbm.id=cpm.buyer_business_model_result_id
      LEFT JOIN leadgen.product_opportunity_results po ON po.category_procurement_match_result_id=cpm.id
      JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=cpm.id
      ORDER BY c.company_name,cpm.product_profile`, [Math.max(1,Number(ttlDays)||7)]);
    const results=[];
    for (const fact of facts.rows) {
      const decision=deriveOpportunityDecision({
        company:{verification_status:fact.verification_status,lifecycle_status:fact.lifecycle_status,
          replaced_by_company_id:fact.replaced_by_company_id},
        buyer:{buyer_model:fact.buyer_model,eligibility_status:fact.eligibility_status},
        category:{match_status:fact.match_status,score:fact.score,coverage_percent:fact.coverage_percent,
          calculation_version:fact.category_calculation_version,scope_revision_id:fact.scope_revision_id,
          match_basis:fact.match_basis},
        cooperation:{opportunity_readiness:fact.opportunity_readiness,relationship_status:fact.relationship_status,
          verified_decision_maker_count:fact.verified_decision_maker_count},
        underlying_relationship_status:fact.relationship_status,company_suppressed:fact.company_suppressed,
        confirmed_existing_customer:fact.confirmed_existing_customer,
        profile_relevant_buyer_count:fact.profile_relevant_buyer_count,
        verified_buyer_role_count:fact.verified_buyer_role_count,
        business_email_route_count:fact.business_email_route_count,
        active_valid_email_route_count:fact.active_valid_email_route_count,
        active_company_contact_route_count:fact.active_company_contact_route_count,
        company_contact_route_types:fact.company_contact_route_types,
        expired_valid_email_route_count:fact.expired_valid_email_route_count,
        email_route_statuses:fact.email_route_statuses,
        contact_suppressed:fact.contact_suppressed,
        identity_conflict:Boolean(fact.explicit_exclusion_reason),website_status:fact.verification_freshness==='STALE'?'UNKNOWN':'SUPPORTED'
      });
      const inputDigest=sha256(JSON.stringify({decision_digest:decision.input_digest,
        buyer_business_model_result_id:fact.buyer_business_model_result_id,
        category_procurement_match_result_id:fact.category_procurement_match_result_id,
        product_opportunity_result_id:fact.product_opportunity_result_id,
        cooperation_feasibility_result_id:fact.cooperation_feasibility_result_id}));
      const stored=await this.transaction(async client=>{
        const inserted=await client.query(`INSERT INTO leadgen.business_opportunity_decision_snapshots
          (company_id,product_profile,research_job_id,buyer_business_model_result_id,category_procurement_match_result_id,
           product_opportunity_result_id,cooperation_feasibility_result_id,business_fit_status,system_recommendation_status,contact_readiness,
           policy_contact_status,relationship_status,reason_codes,rule_version,assessment_revision,input_digest)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,
            coalesce((SELECT max(assessment_revision)+1 FROM leadgen.business_opportunity_decision_snapshots WHERE company_id=$1 AND product_profile=$2),1),$15
          ON CONFLICT(company_id,product_profile,input_digest) DO NOTHING RETURNING *`, [fact.company_id,fact.product_profile,
          fact.research_job_id,fact.buyer_business_model_result_id,fact.category_procurement_match_result_id,
          fact.product_opportunity_result_id,fact.cooperation_feasibility_result_id,decision.business_fit_status,decision.system_recommendation_status,
          decision.contact_readiness,decision.policy_contact_status,decision.relationship_status,decision.reason_codes,
          decision.rule_version,inputDigest]);
        const snapshot=inserted.rows[0]||(await client.query(`SELECT * FROM leadgen.business_opportunity_decision_snapshots
          WHERE company_id=$1 AND product_profile=$2 AND input_digest=$3`,[fact.company_id,fact.product_profile,inputDigest])).rows[0];
        const eligibilityStatus=decision.system_recommendation_status==='RECOMMENDED'&&decision.contact_readiness==='READY'
          &&decision.policy_contact_status==='OPEN'&&decision.relationship_status==='NEW_PROSPECT'
          &&Number(fact.active_valid_email_route_count)>0&&Boolean(fact.decision_maker_id)?'ELIGIBLE':'BLOCKED';
        await client.query(`INSERT INTO leadgen.outreach_eligibility_snapshots
          (company_id,product_profile,buyer_business_model_result_id,category_procurement_match_result_id,
           product_opportunity_result_id,cooperation_feasibility_result_id,decision_maker_id,eligibility_status,
           relationship_status,reason_codes,rule_version,input_digest,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,now()+($13::int*interval '1 day'))
          ON CONFLICT(company_id,product_profile,input_digest) DO NOTHING`, [fact.company_id,fact.product_profile,
          fact.buyer_business_model_result_id,fact.category_procurement_match_result_id,fact.product_opportunity_result_id,
          fact.cooperation_feasibility_result_id,fact.decision_maker_id,eligibilityStatus,decision.relationship_status,
          decision.reason_codes,decision.rule_version,inputDigest,Math.max(1,Number(ttlDays)||7)]);
        return {snapshot,eligibility_status:eligibilityStatus,created:Boolean(inserted.rowCount)};
      });
      results.push(stored);
    }
    return {processed:results.length,created:results.filter(item=>item.created).length,
      recommended:results.filter(item=>item.snapshot.system_recommendation_status==='RECOMMENDED').length,
      blocked:results.filter(item=>item.eligibility_status==='BLOCKED').length,
      eligible:results.filter(item=>item.eligibility_status==='ELIGIBLE').length,
      manual_official_routes_created:0,manual_official_route_policy:'RETIRED'};
  }

  async findContact(id) {
    requiredUuid(id, 'contact_id');
    const decision = await this.pool.query(`SELECT dc.*,dm.company_id,dm.research_job_id,
      'DECISION_MAKER_CONTACT' contact_record_type
      FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
      WHERE dc.id=$1`, [id]);
    if (decision.rowCount) return decision.rows[0];
    const legacy = await this.pool.query(`SELECT c.*,c.id contact_id,'CONTACT' contact_record_type
      FROM leadgen.contacts c WHERE c.id=$1`, [id]);
    return legacy.rows[0] || null;
  }

  async updateContactVerification(contact, verification) {
    if (contact.contact_record_type === 'DECISION_MAKER_CONTACT') {
      const result = await this.pool.query(`UPDATE leadgen.decision_maker_contacts SET
        verification_status=$2,verification_provider=$3,verification_score=$4,
        last_verified_at=$5,updated_at=now() WHERE id=$1 RETURNING *`, [
        contact.id, verification.verification_status, verification.provider,
        verification.verification_score, verification.captured_at
      ]);
      return result.rows[0];
    }
    const status = verification.verification_status === 'VALID' ? 'valid'
      : verification.verification_status === 'INVALID' ? 'invalid' : 'unknown';
    const lifecycle = verification.verification_status === 'INVALID' ? 'INVALID' : 'ACTIVE';
    const publicStatus = verification.verification_status === 'INVALID' ? 'INVALID'
      : verification.verification_status === 'VALID' ? 'DOMAIN_MX_VERIFIED' : 'PUBLICLY_OBSERVED';
    const result = await this.pool.query(`UPDATE leadgen.contacts SET
      email_verification_status=$2,contact_verification_status=$3,lifecycle_status=$4,
      last_verified_at=$5,updated_at=now() WHERE id=$1 RETURNING *`, [
      contact.id, status, publicStatus, lifecycle, verification.captured_at
    ]);
    return result.rows[0];
  }

  async getContactVerificationHistory(id) {
    const contact = await this.findContact(id);
    if (!contact) throw notFound('Contact not found', 'CONTACT_NOT_FOUND');
    if(contact.contact_record_type!=='DECISION_MAKER_CONTACT')return {contact,verification_events:[]};
    const history=await this.pool.query(`SELECT v.id,v.provider,v.endpoint,v.verification_status,v.verification_score,
      v.verified_at,v.captured_at,v.expires_at,v.created_at,
      p.status provider_status,p.error_code,p.reserved_units,p.used_units
      FROM leadgen.contact_verification_events v
      LEFT JOIN leadgen.provider_usage_events p ON p.id=v.provider_usage_event_id
      WHERE v.decision_maker_contact_id=$1 ORDER BY v.verified_at DESC,v.id DESC LIMIT 50`,[contact.id]);
    return { contact,verification_events:history.rows };
  }

  async createEligibleRecipients({ companyId, productProfile = null, contactId = null, verificationTtlDays = 30 }) {
    const result = await this.pool.query(`WITH current_eligible AS (
      SELECT DISTINCT ON (s.company_id,s.product_profile) s.*
      FROM leadgen.outreach_eligibility_snapshots s
      JOIN leadgen.business_opportunity_current o ON o.company_id=s.company_id
        AND o.product_profile=s.product_profile AND o.display_opportunity_status='MANAGEMENT_APPROVED'
      JOIN leadgen.contact_work_queue q ON q.company_id=s.company_id AND q.product_profile=s.product_profile
        AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      WHERE s.company_id=$1 AND ($2::text IS NULL OR s.product_profile=$2)
        AND s.eligibility_status='ELIGIBLE' AND s.relationship_status='NEW_PROSPECT' AND s.expires_at>now()
        AND s.buyer_business_model_result_id=o.buyer_business_model_result_id
        AND s.category_procurement_match_result_id=o.category_procurement_match_result_id
        AND s.product_opportunity_result_id IS NOT DISTINCT FROM o.product_opportunity_result_id
        AND s.cooperation_feasibility_result_id=o.cooperation_feasibility_result_id
      ORDER BY s.company_id,s.product_profile,s.created_at DESC,s.id DESC
    ), eligible_contacts AS (
      SELECT s.id eligibility_snapshot_id,s.company_id,dc.id decision_maker_contact_id,
        lower(btrim(dc.contact_value_normalized)) normalized_recipient,dc.contact_type,dc.verification_status,
        dc.verification_provider,dc.last_verified_at
      FROM current_eligible s
      JOIN leadgen.companies c ON c.id=s.company_id AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
      JOIN leadgen.decision_makers dm ON dm.id=s.decision_maker_id AND dm.company_id=s.company_id
        AND dm.lifecycle_status='ACTIVE'
      JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=dm.id
      WHERE dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
        AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($4::int*interval '1 day')
        AND dc.last_verified_at<=now()
        AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED'
        AND lower(split_part(dc.contact_value_normalized,'@',2))=lower(regexp_replace(c.normalized_domain,'^(live:[a-z]{2}:)?(www[.])?','','i'))
        AND ($3::uuid IS NULL OR dc.id=$3)
        AND position('@' in dc.contact_value_normalized)>1
        AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions cs
          WHERE cs.company_id=s.company_id AND cs.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx
          WHERE sx.company_id=s.company_id AND sx.lifted_at IS NULL AND (
            sx.decision_maker_contact_id=dc.id OR
            sx.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(dc.contact_value_normalized)),'UTF8')),'hex')))
    )
    INSERT INTO leadgen.outreach_recipients
      (eligibility_snapshot_id,company_id,decision_maker_contact_id,normalized_recipient,
       consent_status,verification_status,verification_provider,verified_at,lifecycle_status,recipient_type,recipient_source_class,recipient_domain_verified)
    SELECT eligibility_snapshot_id,company_id,decision_maker_contact_id,normalized_recipient,
      'UNKNOWN',verification_status,verification_provider,last_verified_at,'ACTIVE',
      CASE WHEN contact_type='BUSINESS_EMAIL' THEN 'NAMED_BUYER_EMAIL' WHEN contact_type='DEPARTMENT_EMAIL' THEN 'OFFICIAL_DEPARTMENT_EMAIL' ELSE 'OFFICIAL_COMPANY_EMAIL' END,
      'VERIFIED_DECISION_MAKER_CONTACT',true
    FROM eligible_contacts
    ON CONFLICT(eligibility_snapshot_id,normalized_recipient) DO NOTHING
    RETURNING *`, [requiredUuid(companyId,'company_id'),productProfile || null,contactId ? requiredUuid(contactId,'contact_id') : null,
      Math.max(1,Number(verificationTtlDays)||30)]);
    return result.rows;
  }

  async getDraft(id, queryable = this.pool) {
    requiredUuid(id, 'draft_id');
    const result = await queryable.query(`SELECT d.*,r.normalized_recipient,r.consent_status,
      r.verification_status recipient_verification_status,r.verified_at recipient_verified_at,
      s.product_profile,s.eligibility_status,s.reason_codes eligibility_reason_codes,s.expires_at eligibility_expires_at,
      coalesce(jsonb_agg(DISTINCT p.approved_claim_ids) FILTER(WHERE p.product_master_id IS NOT NULL),'[]'::jsonb) draft_product_claim_sets
      FROM leadgen.outreach_drafts d
      JOIN leadgen.outreach_recipients r ON r.id=d.recipient_id
      JOIN leadgen.outreach_eligibility_snapshots s ON s.id=d.eligibility_snapshot_id
      LEFT JOIN leadgen.outreach_draft_products p ON p.draft_id=d.id
      WHERE d.id=$1 GROUP BY d.id,r.id,s.id`, [id]);
    return result.rows[0] || null;
  }

  async assertCurrentDraftGate(id, queryable = this.pool, { verificationTtlDays = 30 } = {}) {
    requiredUuid(id, 'draft_id');
    const recipient=await queryable.query(`SELECT r.normalized_recipient FROM leadgen.outreach_drafts d
      JOIN leadgen.outreach_recipients r ON r.id=d.recipient_id WHERE d.id=$1`,[id]);
    const recipientHash=recipient.rowCount?sha256(String(recipient.rows[0].normalized_recipient||'').trim().toLowerCase()):null;
    const result=await queryable.query(`SELECT d.id
      FROM leadgen.outreach_drafts d
      JOIN leadgen.outreach_eligibility_snapshots s ON s.id=d.eligibility_snapshot_id AND s.company_id=d.company_id
      JOIN leadgen.outreach_recipients r ON r.id=d.recipient_id AND r.company_id=d.company_id
        AND r.eligibility_snapshot_id=s.id
      JOIN leadgen.companies c ON c.id=d.company_id AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
      JOIN leadgen.business_opportunity_current o ON o.company_id=d.company_id AND o.product_profile=s.product_profile
        AND o.display_opportunity_status='MANAGEMENT_APPROVED'
      JOIN leadgen.contact_work_queue q ON q.company_id=d.company_id AND q.product_profile=s.product_profile
        AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      WHERE d.id=$1 AND s.eligibility_status='ELIGIBLE' AND s.relationship_status='NEW_PROSPECT' AND s.expires_at>now()
        AND r.lifecycle_status='ACTIVE' AND r.verification_status='VALID'
        AND r.verified_at>=now()-($2::int*interval '1 day')
        AND s.buyer_business_model_result_id=o.buyer_business_model_result_id
        AND s.category_procurement_match_result_id=o.category_procurement_match_result_id
        AND s.product_opportunity_result_id IS NOT DISTINCT FROM o.product_opportunity_result_id
        AND s.cooperation_feasibility_result_id=o.cooperation_feasibility_result_id
        AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_eligibility_snapshots newer
          WHERE newer.company_id=s.company_id AND newer.product_profile=s.product_profile
            AND (newer.created_at,newer.id)>(s.created_at,s.id))
        AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions cs
          WHERE cs.company_id=d.company_id AND cs.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx
          WHERE sx.company_id=d.company_id AND sx.lifted_at IS NULL AND (
            (r.contact_id IS NOT NULL AND sx.contact_id=r.contact_id) OR
            (r.decision_maker_contact_id IS NOT NULL AND sx.decision_maker_contact_id=r.decision_maker_contact_id) OR
            sx.normalized_recipient_hash=$3))
      FOR UPDATE OF d,s,r,q`, [id,Math.max(1,Number(verificationTtlDays)||30),recipientHash]);
    if(!result.rowCount){
      const error=new Error('Draft requires the current management-approved opportunity, active Contact Queue, fresh eligibility and unsuppressed recipient');
      error.code='DRAFT_CURRENT_GATE_BLOCKED';error.status=409;throw error;
    }
    return result.rows[0];
  }

  async getDraftValidationContract(id, queryable = this.pool) {
    requiredUuid(id, 'draft_id');
    const result = await queryable.query(`SELECT d.*,s.product_profile,s.input_digest eligibility_input_digest,
      s.company_id eligibility_company_id,s.eligibility_status current_eligibility_status,
      s.relationship_status current_relationship_status,s.expires_at current_eligibility_expires_at,r.decision_maker_contact_id,r.normalized_recipient,r.recipient_type,r.recipient_source_class,r.recipient_domain_verified,
      r.verification_status current_recipient_verification_status,r.lifecycle_status current_recipient_lifecycle_status,
      r.verified_at current_recipient_verified_at,c.country_code,c.verification_status current_company_verification_status,
      c.lifecycle_status current_company_lifecycle_status,o.id current_opportunity_snapshot_id,
      o.display_opportunity_status current_opportunity_status,q.id current_contact_work_queue_id,q.management_event_id current_management_event_id,q.queue_status current_queue_status,
      (s.buyer_business_model_result_id=o.buyer_business_model_result_id
        AND s.category_procurement_match_result_id=o.category_procurement_match_result_id
        AND s.product_opportunity_result_id IS NOT DISTINCT FROM o.product_opportunity_result_id
        AND s.cooperation_feasibility_result_id=o.cooperation_feasibility_result_id) current_eligibility_matches_opportunity,
      NOT EXISTS(SELECT 1 FROM leadgen.outreach_eligibility_snapshots newer
        WHERE newer.company_id=s.company_id AND newer.product_profile=s.product_profile
          AND (newer.created_at,newer.id)>(s.created_at,s.id)) is_latest_eligibility_snapshot,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions x WHERE x.company_id=d.company_id AND x.lifted_at IS NULL) current_company_suppressed,
      (EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions rs WHERE rs.company_id=d.company_id AND rs.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(r.normalized_recipient)),'UTF8')),'hex') AND rs.lifted_at IS NULL) OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions x WHERE x.company_id=d.company_id AND x.lifted_at IS NULL AND (
        (r.contact_id IS NOT NULL AND x.contact_id=r.contact_id) OR
        (r.decision_maker_contact_id IS NOT NULL AND x.decision_maker_contact_id=r.decision_maker_contact_id)))) current_contact_suppressed,
      v.content marketing_context_content,v.allowed_markets marketing_context_allowed_markets,
      v.allowed_product_profiles marketing_context_allowed_profiles,v.target_languages marketing_context_target_languages,
      v.expires_at marketing_context_expires_at,
      (SELECT a.decision FROM leadgen.marketing_context_approvals a
        WHERE a.marketing_context_version_id=v.id AND a.content_hash=v.content_hash
        ORDER BY a.approved_at DESC,a.id DESC LIMIT 1) marketing_context_current_decision,
      coalesce((SELECT array_agg(coalesce(de.prospect_category_observation_id,de.decision_maker_source_id,de.company_source_id)::text)
        FROM leadgen.outreach_draft_evidence de
        LEFT JOIN leadgen.prospect_category_observations o ON o.id=de.prospect_category_observation_id
        LEFT JOIN leadgen.decision_maker_sources ds ON ds.id=de.decision_maker_source_id
        LEFT JOIN leadgen.decision_makers dm ON dm.id=ds.decision_maker_id
        LEFT JOIN leadgen.sources cs ON cs.id=de.company_source_id
        WHERE de.draft_id=d.id AND
          (o.id IS NULL OR (o.company_id=d.company_id AND o.normalized_profile IN(s.product_profile,'UNKNOWN') AND o.verification_status='VERIFIED')) AND
          (ds.id IS NULL OR (dm.company_id=d.company_id AND ds.evidence_status='VERIFIED')) AND
          (cs.id IS NULL OR cs.company_id=d.company_id)),'{}'::text[]) authoritative_evidence_ids,
      coalesce((SELECT array_agg(p.product_master_id::text ORDER BY p.display_order)
        FROM leadgen.outreach_draft_products p JOIN leadgen.product_master pm ON pm.id=p.product_master_id
        WHERE p.draft_id=d.id AND pm.product_profile=s.product_profile),'{}'::text[]) authoritative_product_ids,
      coalesce((SELECT array_agg(DISTINCT claim_id)
        FROM leadgen.outreach_draft_products p CROSS JOIN LATERAL unnest(p.approved_claim_ids) claim_id
        JOIN leadgen.product_master pm ON pm.id=p.product_master_id
        WHERE p.draft_id=d.id AND pm.product_profile=s.product_profile),'{}'::text[]) authoritative_claim_ids,
      NOT EXISTS(SELECT 1 FROM leadgen.outreach_draft_evidence de
        LEFT JOIN leadgen.prospect_category_observations o ON o.id=de.prospect_category_observation_id
        LEFT JOIN leadgen.decision_maker_sources ds ON ds.id=de.decision_maker_source_id
        LEFT JOIN leadgen.decision_makers dm ON dm.id=ds.decision_maker_id
        LEFT JOIN leadgen.sources cs ON cs.id=de.company_source_id
        WHERE de.draft_id=d.id AND (
          (o.id IS NOT NULL AND (o.company_id<>d.company_id OR o.normalized_profile NOT IN(s.product_profile,'UNKNOWN') OR o.verification_status<>'VERIFIED')) OR
          (ds.id IS NOT NULL AND (dm.company_id<>d.company_id OR ds.evidence_status<>'VERIFIED')) OR
          (cs.id IS NOT NULL AND cs.company_id<>d.company_id)))
      AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_draft_products p JOIN leadgen.product_master pm ON pm.id=p.product_master_id
        WHERE p.draft_id=d.id AND pm.product_profile<>s.product_profile) reference_integrity_valid
      FROM leadgen.outreach_drafts d
      JOIN leadgen.outreach_eligibility_snapshots s ON s.id=d.eligibility_snapshot_id AND s.company_id=d.company_id
      JOIN leadgen.outreach_recipients r ON r.id=d.recipient_id AND r.company_id=d.company_id
      JOIN leadgen.companies c ON c.id=d.company_id
      JOIN leadgen.marketing_context_versions v ON v.version=d.marketing_context_version
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=d.company_id AND o.product_profile=s.product_profile
      LEFT JOIN leadgen.contact_work_queue q ON q.company_id=d.company_id AND q.product_profile=s.product_profile
        AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      WHERE d.id=$1`, [id]);
    return result.rows[0] || null;
  }

  async createDraft(input) {
    return this.transaction(async client => {
      const recipientIdentity=await client.query(`SELECT normalized_recipient FROM leadgen.outreach_recipients WHERE id=$1`,[input.recipient_id]);
      const recipientHash=recipientIdentity.rowCount?sha256(String(recipientIdentity.rows[0].normalized_recipient||'').trim().toLowerCase()):null;
      const gate = await client.query(`SELECT s.*,r.normalized_recipient,r.consent_status,
      r.verification_status recipient_verification_status,r.verified_at,r.lifecycle_status recipient_lifecycle_status,
      r.recipient_type,r.recipient_source_class,r.recipient_domain_verified,
        c.country_code
        FROM leadgen.outreach_eligibility_snapshots s
        JOIN leadgen.outreach_recipients r ON r.eligibility_snapshot_id=s.id AND r.company_id=s.company_id
        JOIN leadgen.companies c ON c.id=s.company_id AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        JOIN leadgen.business_opportunity_current o ON o.company_id=s.company_id AND o.product_profile=s.product_profile
          AND o.display_opportunity_status='MANAGEMENT_APPROVED'
        JOIN leadgen.contact_work_queue q ON q.company_id=s.company_id AND q.product_profile=s.product_profile
          AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
        WHERE s.id=$1 AND r.id=$2
          AND s.eligibility_status='ELIGIBLE' AND s.relationship_status='NEW_PROSPECT' AND s.expires_at>now()
          AND r.lifecycle_status='ACTIVE' AND r.verification_status='VALID'
          AND r.verified_at>=now()-($3::int*interval '1 day')
          AND s.buyer_business_model_result_id=o.buyer_business_model_result_id
          AND s.category_procurement_match_result_id=o.category_procurement_match_result_id
          AND s.product_opportunity_result_id IS NOT DISTINCT FROM o.product_opportunity_result_id
          AND s.cooperation_feasibility_result_id=o.cooperation_feasibility_result_id
          AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_eligibility_snapshots newer
            WHERE newer.company_id=s.company_id AND newer.product_profile=s.product_profile
              AND (newer.created_at,newer.id)>(s.created_at,s.id))
          AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions cs
            WHERE cs.company_id=s.company_id AND cs.lifted_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx
            WHERE sx.company_id=s.company_id AND sx.lifted_at IS NULL AND (
              (r.contact_id IS NOT NULL AND sx.contact_id=r.contact_id) OR
              (r.decision_maker_contact_id IS NOT NULL AND sx.decision_maker_contact_id=r.decision_maker_contact_id) OR
              sx.normalized_recipient_hash=$4))
        FOR UPDATE OF s,r,q`, [input.eligibility_snapshot_id,input.recipient_id,
          Math.max(1,Number(input.verification_ttl_days)||30),recipientHash]);
      if (!gate.rowCount) {
        const error=new Error('Draft requires the current management-approved opportunity, active Contact Queue, fresh eligibility and unsuppressed recipient');
        error.code='DRAFT_CURRENT_GATE_BLOCKED';error.status=409;throw error;
      }
      const currentGate = gate.rows[0];
      const verifiedAt = currentGate.verified_at ? new Date(currentGate.verified_at) : null;
      const verificationFresh = verifiedAt && !Number.isNaN(verifiedAt.getTime())
        && Date.now() - verifiedAt.getTime() <= Math.max(1,Number(input.verification_ttl_days)||30) * 86_400_000;
      if (currentGate.eligibility_status !== 'ELIGIBLE' || new Date(currentGate.expires_at) <= new Date()
        || currentGate.recipient_lifecycle_status !== 'ACTIVE'
        || currentGate.recipient_verification_status !== 'VALID' || !verificationFresh) {
        const error = new Error('Current eligibility and a fresh VALID mailbox are required before drafting');
        error.code = 'OUTREACH_ELIGIBILITY_BLOCKED'; error.status = 422; throw error;
      }
      if (String(input.input_digest || '').toLowerCase() !== String(currentGate.input_digest || '').toLowerCase()) {
        const error = new Error('Draft input digest does not match the current eligibility snapshot');
        error.code = 'INPUT_DIGEST_MISMATCH'; error.status = 409; throw error;
      }
      const context = await client.query(`SELECT v.* FROM leadgen.marketing_context_versions v
        WHERE v.version=$1 AND (SELECT a.decision FROM leadgen.marketing_context_approvals a
          WHERE a.marketing_context_version_id=v.id AND a.content_hash=v.content_hash
          ORDER BY a.approved_at DESC,a.id DESC LIMIT 1)='APPROVED'`, [input.marketing_context_version]);
      if (!context.rowCount) throw notFound('Approved marketing context not found', 'MARKETING_CONTEXT_NOT_APPROVED');
      const productIds = (input.products || []).map(item => item.product_master_id);
      if (productIds.length) {
        const products = await client.query(`SELECT id FROM leadgen.product_master
          WHERE id=ANY($1::uuid[]) AND product_profile=$2`, [productIds,currentGate.product_profile]);
        if (products.rowCount !== new Set(productIds).size) {
          const error = new Error('Draft products must be current database products for the eligibility profile');
          error.code='DRAFT_PRODUCT_ALLOWLIST_MISMATCH'; error.status=409; throw error;
        }
      }
      const approvedClaims = Array.isArray(context.rows[0].content?.approved_claims)
        ? context.rows[0].content.approved_claims.filter(claim =>
          (!Array.isArray(claim.allowed_markets) || claim.allowed_markets.includes(currentGate.country_code))
          && (!Array.isArray(claim.allowed_product_profiles) || claim.allowed_product_profiles.includes(currentGate.product_profile))
          && (!claim.expires_at || new Date(claim.expires_at) > new Date()))
        : [];
      const approvedClaimIds = new Set(approvedClaims.map(claim => String(claim.approved_claim_id)));
      const requestedClaimIds = new Set((input.products || []).flatMap(item => item.approved_claim_ids || []).map(String));
      if ([...requestedClaimIds].some(claimId => !approvedClaimIds.has(claimId))) {
        const error = new Error('Draft claims must resolve to the approved database marketing context');
        error.code='DRAFT_CLAIM_ALLOWLIST_MISMATCH'; error.status=409; throw error;
      }
      for (const item of input.evidence || []) {
        const evidence = await client.query(`SELECT
          EXISTS(SELECT 1 FROM leadgen.prospect_category_observations o WHERE o.id=$1::uuid AND o.company_id=$4
            AND o.normalized_profile IN($5,'UNKNOWN') AND o.verification_status='VERIFIED') category_ok,
          EXISTS(SELECT 1 FROM leadgen.decision_maker_sources ds JOIN leadgen.decision_makers dm ON dm.id=ds.decision_maker_id
            WHERE ds.id=$2::uuid AND dm.company_id=$4 AND ds.evidence_status='VERIFIED') decision_maker_ok,
          EXISTS(SELECT 1 FROM leadgen.sources cs WHERE cs.id=$3::uuid AND cs.company_id=$4) company_ok`, [
          item.prospect_category_observation_id || null,item.decision_maker_source_id || null,
          item.company_source_id || null,currentGate.company_id,currentGate.product_profile]);
        if (!evidence.rows[0]?.category_ok && !evidence.rows[0]?.decision_maker_ok && !evidence.rows[0]?.company_ok) {
          const error = new Error('Draft evidence must be verified database evidence owned by the eligibility company and profile');
          error.code='DRAFT_EVIDENCE_ALLOWLIST_MISMATCH'; error.status=409; throw error;
        }
      }
      const result = await client.query(`INSERT INTO leadgen.outreach_drafts
        (company_id,eligibility_snapshot_id,recipient_id,supersedes_draft_id,version,draft_status,
         language,subject,body_text,followups,personalization_reason,marketing_context_version,
         template_version,skill_versions,generation_version,input_digest,content_hash,policy_warnings,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::text[],$19)
        RETURNING *`, [gate.rows[0].company_id, input.eligibility_snapshot_id, input.recipient_id,
        input.supersedes_draft_id, input.version, input.draft_status, input.language, input.subject,
        input.body_text, JSON.stringify(input.followups), input.personalization_reason,
        input.marketing_context_version, input.template_version, JSON.stringify(input.skill_versions),
        input.generation_version, input.input_digest, input.content_hash, input.policy_warnings, input.created_by]);
      for (const item of input.products || []) {
        await client.query(`INSERT INTO leadgen.outreach_draft_products
          (draft_id,product_master_id,approved_claim_ids,display_order) VALUES($1,$2,$3::text[],$4)`,
        [result.rows[0].id, item.product_master_id, item.approved_claim_ids || [], item.display_order]);
      }
      for (const item of input.evidence || []) {
        await client.query(`INSERT INTO leadgen.outreach_draft_evidence
          (draft_id,prospect_category_observation_id,decision_maker_source_id,company_source_id)
          VALUES($1,$2,$3,$4)`, [result.rows[0].id, item.prospect_category_observation_id || null,
          item.decision_maker_source_id || null, item.company_source_id || null]);
      }
      return { draft: result.rows[0], gate: gate.rows[0], marketing_context: context.rows[0] };
    });
  }

  async reviseDraft(id, input) {
    return this.transaction(async client => {
      await this.assertCurrentDraftGate(id,client,{verificationTtlDays:input.verification_ttl_days});
      const current = await this.getDraft(id, client);
      if (!current) throw notFound('Draft not found', 'OUTREACH_DRAFT_NOT_FOUND');
      if (!['DRAFT', 'INVALID_DRAFT', 'NEEDS_CHANGES', 'REJECTED', 'PENDING_REVIEW', 'APPROVED', 'SUPERSEDED'].includes(current.draft_status)) {
        const error = new Error('Draft is not in a revisable state'); error.code = 'DRAFT_REVISION_FORBIDDEN'; error.status = 409; throw error;
      }
      const revisionGate=await client.query(`SELECT
        EXISTS(SELECT 1 FROM leadgen.outbound_messages m JOIN leadgen.outreach_approvals a
          ON a.id=m.approval_id WHERE a.draft_id=$1) has_message,
        EXISTS(SELECT 1 FROM leadgen.outreach_drafts WHERE supersedes_draft_id=$1) has_revision`,[id]);
      if(revisionGate.rows[0]?.has_message||revisionGate.rows[0]?.has_revision){
        const error=new Error('Queued or already revised drafts require their current workflow');
        error.code='DRAFT_REVISION_FORBIDDEN';error.status=409;throw error;
      }
      await client.query(`UPDATE leadgen.outreach_drafts SET draft_status='SUPERSEDED',updated_at=now() WHERE id=$1`, [id]);
      const created = await client.query(`INSERT INTO leadgen.outreach_drafts
        (company_id,eligibility_snapshot_id,recipient_id,supersedes_draft_id,version,draft_status,
         language,subject,body_text,followups,personalization_reason,marketing_context_version,
         template_version,skill_versions,generation_version,input_digest,content_hash,policy_warnings,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::text[],$19)
        RETURNING *`, [current.company_id,current.eligibility_snapshot_id,current.recipient_id,current.id,
        current.version + 1,input.draft_status,input.language,input.subject,input.body_text,JSON.stringify(input.followups),
        input.personalization_reason,current.marketing_context_version,input.template_version,
        JSON.stringify(input.skill_versions),input.generation_version,input.input_digest,input.content_hash,
        input.policy_warnings,input.created_by]);
      await client.query(`INSERT INTO leadgen.outreach_draft_products
        (draft_id,product_master_id,approved_claim_ids,display_order)
        SELECT $2,product_master_id,approved_claim_ids,display_order FROM leadgen.outreach_draft_products WHERE draft_id=$1`, [id,created.rows[0].id]);
      await client.query(`INSERT INTO leadgen.outreach_draft_evidence
        (draft_id,prospect_category_observation_id,decision_maker_source_id,company_source_id)
        SELECT $2,prospect_category_observation_id,decision_maker_source_id,company_source_id
        FROM leadgen.outreach_draft_evidence WHERE draft_id=$1`, [id,created.rows[0].id]);
      return created.rows[0];
    });
  }

  async setDraftStatus(id, fromStatuses, status, { submitted = false } = {}) {
    const result = await this.pool.query(`UPDATE leadgen.outreach_drafts SET draft_status=$2,
      submitted_at=CASE WHEN $3 THEN now() ELSE submitted_at END,updated_at=now()
      WHERE id=$1 AND draft_status=ANY($4::text[]) RETURNING *`, [requiredUuid(id, 'draft_id'), status, submitted, fromStatuses]);
    if (!result.rowCount) throw notFound('Draft was not found or is not in an allowed state', 'OUTREACH_DRAFT_STATE_CONFLICT');
    return result.rows[0];
  }

  async submitDraft(id, { contentHash, verificationTtlDays = 30 } = {}) {
    return this.transaction(async client => {
      await this.assertCurrentDraftGate(id,client,{verificationTtlDays});
      const result=await client.query(`UPDATE leadgen.outreach_drafts SET draft_status='PENDING_REVIEW',
        submitted_at=now(),updated_at=now() WHERE id=$1 AND draft_status=ANY($2::text[]) AND content_hash=$3 RETURNING *`,
      [requiredUuid(id,'draft_id'),['DRAFT','PENDING_REVIEW'],contentHash]);
      if(!result.rowCount){
        const error=new Error('Draft was not found, changed, or is not in a submittable state');
        error.code='DRAFT_SUBMIT_VALIDATION_FAILED';error.status=409;throw error;
      }
      return result.rows[0];
    });
  }

  async createDraftApproval(input) {
    return this.transaction(async client => {
      if(input.decision==='APPROVED')await this.assertCurrentDraftGate(input.draft_id,client,{verificationTtlDays:input.verification_ttl_days});
      const draft = await this.getDraft(input.draft_id, client);
      if (!draft) throw notFound('Draft not found', 'OUTREACH_DRAFT_NOT_FOUND');
      if(input.decision==='APPROVED'&&!draft.submitted_at){
        const error=new Error('Submit the current draft before approval');
        error.code='DRAFT_SUBMISSION_REQUIRED';error.status=409;throw error;
      }
      const prior = await client.query(`SELECT * FROM leadgen.outreach_approvals
        WHERE approval_digest=$1 AND decision=$2 ORDER BY approved_at DESC LIMIT 1`, [input.approval_digest,input.decision]);
      let approval = prior.rows[0] || null;
      if (!approval) {
        const result = await client.query(`INSERT INTO leadgen.outreach_approvals
        (draft_id,recipient_id,company_id,draft_version,normalized_recipient,product_profile,
         content_hash,approval_digest,evidence_snapshot_hash,from_identity,reply_to,channel,
         decision,approver_identity,approver_role,reason,opportunity_snapshot_id,management_event_id,
         recipient_route_snapshot_hash,provider_purpose,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'EMAIL',$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT DO NOTHING RETURNING *`, [
        draft.id,draft.recipient_id,draft.company_id,draft.version,draft.normalized_recipient,draft.product_profile,
        draft.content_hash,input.approval_digest,input.evidence_snapshot_hash,input.from_identity,input.reply_to,
        input.decision,input.actor,input.role,input.reason,input.opportunity_snapshot_id,input.management_event_id,
        input.recipient_route_snapshot_hash,input.provider_purpose,input.expires_at]);
        approval = result.rows[0] || (await client.query(`SELECT * FROM leadgen.outreach_approvals
          WHERE draft_id=$1 AND draft_version=$2 AND content_hash=$3 AND normalized_recipient=$4
            AND from_identity=$5 AND reply_to=$6 AND decision='APPROVED'
          ORDER BY approved_at DESC LIMIT 1`, [draft.id,draft.version,draft.content_hash,draft.normalized_recipient,
            input.from_identity,input.reply_to])).rows[0];
      }
      if (!approval || approval.approval_digest !== input.approval_digest || approval.decision !== input.decision) {
        const error = new Error('Draft already has a different exact approval');
        error.code = 'DRAFT_APPROVAL_CONFLICT'; error.status = 409; throw error;
      }
      await client.query(`UPDATE leadgen.outreach_drafts SET draft_status=$2,updated_at=now() WHERE id=$1`, [
        draft.id, input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED']);
      return { approval, draft };
    });
  }

  async getApprovalForEnqueue(id) {
    requiredUuid(id, 'message_or_approval_id');
    const result = await this.pool.query(`SELECT a.*,d.language,d.subject,d.body_text,d.followups,d.template_version,d.version,
      d.draft_status,r.consent_status,r.verification_status recipient_verification_status,
      r.verified_at,r.lifecycle_status recipient_lifecycle_status,r.recipient_type,r.recipient_source_class,r.recipient_domain_verified,r.contact_id,r.decision_maker_contact_id,
      s.eligibility_status,s.reason_codes eligibility_reason_codes,s.expires_at eligibility_expires_at,
      s.buyer_business_model_result_id,s.category_procurement_match_result_id,s.product_opportunity_result_id,
      s.cooperation_feasibility_result_id,s.decision_maker_id,
      c.verification_status company_verification_status,c.lifecycle_status company_lifecycle_status,
      o.id current_opportunity_snapshot_id,o.display_opportunity_status,o.buyer_business_model_result_id current_buyer_result_id,
      o.category_procurement_match_result_id current_category_result_id,o.product_opportunity_result_id current_product_result_id,
      o.cooperation_feasibility_result_id current_cooperation_result_id,
      dm.verification_status decision_maker_verification_status,dm.lifecycle_status decision_maker_lifecycle_status,
      EXISTS(SELECT 1 FROM leadgen.contact_work_queue q WHERE q.company_id=a.company_id
        AND q.product_profile=a.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE') current_contact_queue_active,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers hc
        ON hc.id=l.historical_customer_id WHERE l.company_id=a.company_id AND l.link_status='CONFIRMED'
        AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER') confirmed_existing_customer,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions x WHERE x.company_id=a.company_id AND x.lifted_at IS NULL) company_suppressed,
      q.management_event_id current_management_event_id,
      (EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions rs WHERE rs.company_id=a.company_id AND rs.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(r.normalized_recipient)),'UTF8')),'hex') AND rs.lifted_at IS NULL) OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions x WHERE x.company_id=a.company_id AND x.lifted_at IS NULL
        AND ((r.contact_id IS NOT NULL AND x.contact_id=r.contact_id) OR
             (r.decision_maker_contact_id IS NOT NULL AND x.decision_maker_contact_id=r.decision_maker_contact_id)))) contact_suppressed,
      coalesce((SELECT jsonb_agg(p.approved_claim_ids) FROM leadgen.outreach_draft_products p WHERE p.draft_id=d.id),'[]'::jsonb) draft_product_claim_sets
      FROM leadgen.outreach_approvals a JOIN leadgen.outreach_drafts d ON d.id=a.draft_id
      JOIN leadgen.outreach_recipients r ON r.id=a.recipient_id
      JOIN leadgen.outreach_eligibility_snapshots s ON s.id=d.eligibility_snapshot_id
      JOIN leadgen.companies c ON c.id=a.company_id
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=a.company_id AND o.product_profile=a.product_profile
      LEFT JOIN leadgen.decision_makers dm ON dm.id=s.decision_maker_id
      LEFT JOIN leadgen.contact_work_queue q ON q.company_id=a.company_id AND q.product_profile=a.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      WHERE (a.id=$1 OR a.draft_id=$1) AND a.decision='APPROVED'
      ORDER BY a.approved_at DESC LIMIT 1`, [id]);
    return result.rows[0] || null;
  }

  async createOutboundMessage(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.outbound_messages
      (company_id,recipient_id,approval_id,provider,provider_purpose,idempotency_key,message_key_header,send_status,reason_codes,send_execution_key,rfc_message_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$6,$10)
      ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=leadgen.outbound_messages.updated_at
      RETURNING *`, [input.company_id,input.recipient_id,input.approval_id,input.provider,input.provider_purpose,
      input.idempotency_key,input.message_key_header||null,input.send_status,input.reason_codes,input.rfc_message_id||null]);
    return result.rows[0];
  }

  async retryBlockedOutboundBeforeProvider(messageId,approvalId){
    return this.transaction(async client=>{
      const locked=(await client.query('SELECT * FROM leadgen.outbound_messages WHERE id=$1 FOR UPDATE',[requiredUuid(messageId,'message_id')])).rows[0];
      if(!locked)throw notFound('Outbound message not found','OUTBOUND_MESSAGE_NOT_FOUND');
      const attempted=(await client.query('SELECT EXISTS(SELECT 1 FROM leadgen.outbound_message_attempts WHERE outbound_message_id=$1 AND provider_call_started_at IS NOT NULL) started',[messageId])).rows[0]?.started;
      if(locked.send_status!=='BLOCKED'||locked.approval_id!==approvalId||attempted||locked.sent_at||locked.provider_message_id||locked.ambiguous_since){
        const error=new Error('Only a blocked message with no provider attempt can be retried');error.code='OUTBOUND_RETRY_FORBIDDEN';error.status=409;throw error;
      }
      return(await client.query(`UPDATE leadgen.outbound_messages SET send_status='QUEUED',reason_codes='{}'::text[],
        transport_status='NOT_ATTEMPTED',business_contact_status='NOT_SENT',updated_at=now()
        WHERE id=$1 RETURNING *`,[messageId])).rows[0];
    });
  }

  async getOutboundMessage(id) {
    const messageId=requiredUuid(id,'message_id');
    const automated=await this.pool.query(`SELECT m.*,reservation.normalized_recipient,reservation.sender_identity from_identity,
      reservation.reply_to,reservation.subject,reservation.body_text,reservation.content_hash,reservation.template_set_key template_version,
      reservation.template_key,reservation.policy_revision,reservation.eligibility_snapshot,
      'en'::text language,'AUTO_APPROVED'::text draft_status,'APPROVED'::text approval_decision,
      recipient.verification_status recipient_verification_status,recipient.verified_at,
      recipient.lifecycle_status recipient_lifecycle_status,recipient.recipient_type,
      recipient.recipient_source_class,recipient.recipient_domain_verified,recipient.contact_id,recipient.decision_maker_contact_id,
      company.verification_status company_verification_status,company.lifecycle_status company_lifecycle_status,
      opportunity.id opportunity_pool_decision_id,opportunity.opportunity_pool_band,
      opportunity.is_active_business_opportunity,opportunity.profile_results,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions suppression WHERE suppression.company_id=m.company_id AND suppression.lifted_at IS NULL) company_suppressed,
      (EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions suppression
        WHERE suppression.company_id=m.company_id AND suppression.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(reservation.normalized_recipient)),'UTF8')),'hex') AND suppression.lifted_at IS NULL)
       OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions suppression WHERE suppression.company_id=m.company_id
        AND suppression.lifted_at IS NULL AND ((recipient.contact_id IS NOT NULL AND suppression.contact_id=recipient.contact_id)
          OR (recipient.decision_maker_contact_id IS NOT NULL AND suppression.decision_maker_contact_id=recipient.decision_maker_contact_id)))) contact_suppressed,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=now()-interval '1 minute') sent_last_minute,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=date_trunc('day',now())) sent_today,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.company_id=m.company_id AND x.id<>m.id
        AND x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=now()-interval '30 days') company_sent_30d
      FROM leadgen.outbound_messages m
      JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=m.first_touch_reservation_id
      JOIN leadgen.companies company ON company.id=m.company_id
      LEFT JOIN leadgen.outreach_recipients recipient ON recipient.id=m.recipient_id
      LEFT JOIN leadgen.opportunity_pool_current opportunity ON opportunity.company_id=m.company_id
      WHERE m.id=$1`,[messageId]);
    if(automated.rowCount)return automated.rows[0];
    const result = await this.pool.query(`SELECT m.*,a.draft_id,a.draft_version,a.normalized_recipient,a.from_identity,a.reply_to,
      a.opportunity_snapshot_id,a.management_event_id,a.recipient_route_snapshot_hash,a.expires_at,
      a.approval_digest,a.content_hash,a.evidence_snapshot_hash,a.product_profile,a.channel,a.decision approval_decision,
      d.language,d.subject,d.body_text,d.followups,d.template_version,d.version,d.draft_status,
      r.consent_status,r.verification_status recipient_verification_status,r.verified_at,
      r.lifecycle_status recipient_lifecycle_status,r.recipient_type,r.recipient_source_class,r.recipient_domain_verified,r.contact_id,r.decision_maker_contact_id,
      s.eligibility_status,s.expires_at eligibility_expires_at,s.buyer_business_model_result_id,
      s.category_procurement_match_result_id,s.product_opportunity_result_id,s.cooperation_feasibility_result_id,s.decision_maker_id,
      c.verification_status company_verification_status,c.lifecycle_status company_lifecycle_status,
      o.id current_opportunity_snapshot_id,o.display_opportunity_status,o.buyer_business_model_result_id current_buyer_result_id,
      o.category_procurement_match_result_id current_category_result_id,o.product_opportunity_result_id current_product_result_id,
      o.cooperation_feasibility_result_id current_cooperation_result_id,
      dm.verification_status decision_maker_verification_status,dm.lifecycle_status decision_maker_lifecycle_status,
      EXISTS(SELECT 1 FROM leadgen.contact_work_queue q WHERE q.company_id=m.company_id
        AND q.product_profile=a.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE') current_contact_queue_active,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers hc
        ON hc.id=l.historical_customer_id WHERE l.company_id=m.company_id AND l.link_status='CONFIRMED'
        AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER') confirmed_existing_customer,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions x WHERE x.company_id=m.company_id AND x.lifted_at IS NULL) company_suppressed,
      q.management_event_id current_management_event_id,
      (EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions rs WHERE rs.company_id=m.company_id AND rs.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(r.normalized_recipient)),'UTF8')),'hex') AND rs.lifted_at IS NULL) OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions x WHERE x.company_id=m.company_id AND x.lifted_at IS NULL
        AND ((r.contact_id IS NOT NULL AND x.contact_id=r.contact_id) OR
             (r.decision_maker_contact_id IS NOT NULL AND x.decision_maker_contact_id=r.decision_maker_contact_id)))) contact_suppressed,
      coalesce((SELECT jsonb_agg(p.approved_claim_ids) FROM leadgen.outreach_draft_products p WHERE p.draft_id=d.id),'[]'::jsonb) draft_product_claim_sets,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED')
        AND x.sent_at>=now()-interval '1 minute') sent_last_minute,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED')
        AND x.sent_at>=date_trunc('day',now())) sent_today,
      (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.company_id=m.company_id
        AND x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=now()-interval '30 days') company_sent_30d
      FROM leadgen.outbound_messages m JOIN leadgen.outreach_approvals a ON a.id=m.approval_id
      JOIN leadgen.outreach_drafts d ON d.id=a.draft_id JOIN leadgen.outreach_recipients r ON r.id=m.recipient_id
      JOIN leadgen.outreach_eligibility_snapshots s ON s.id=d.eligibility_snapshot_id
      JOIN leadgen.companies c ON c.id=m.company_id
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=m.company_id AND o.product_profile=a.product_profile
      LEFT JOIN leadgen.decision_makers dm ON dm.id=s.decision_maker_id
      LEFT JOIN leadgen.contact_work_queue q ON q.company_id=m.company_id AND q.product_profile=a.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      WHERE m.id=$1`, [messageId]);
    return result.rows[0] || null;
  }

  async getOutboundEvents(id) {
    requiredUuid(id, 'message_id');
    const result = await this.pool.query(`SELECT id,event_type,occurred_at,provider_sequence,created_at
      FROM leadgen.email_message_events WHERE outbound_message_id=$1 ORDER BY occurred_at,id`, [id]);
    return result.rows;
  }

  async beginOutboundAttempt(messageId, { providerCallStarted = false } = {}) {
    return this.transaction(async client => {
      const locked=await client.query('SELECT * FROM leadgen.outbound_messages WHERE id=$1 FOR UPDATE',[messageId]);
      const message=locked.rows[0];
      if(!message)throw notFound('Outbound message not found','OUTBOUND_MESSAGE_NOT_FOUND');
      if(message.provider_message_id&&['PROVIDER_ACCEPTED','DELIVERED'].includes(message.send_status)){
        return{...message,idempotent_replay:true};
      }
      if(message.send_status==='SENDING'){
        const error=new Error('Outbound message is already being sent');error.code='OUTBOUND_SEND_IN_PROGRESS';error.status=409;throw error;
      }
      const count = await client.query(`SELECT coalesce(max(attempt_number),0)+1 attempt_number
        FROM leadgen.outbound_message_attempts WHERE outbound_message_id=$1`, [messageId]);
      const result = await client.query(`INSERT INTO leadgen.outbound_message_attempts
        (outbound_message_id,attempt_number,attempt_status,provider,provider_call_started_at)
        SELECT id,$2,'STARTED',provider,CASE WHEN $3 THEN now() ELSE NULL END
        FROM leadgen.outbound_messages WHERE id=$1 RETURNING *`, [messageId,count.rows[0].attempt_number,providerCallStarted]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status='SENDING',updated_at=now() WHERE id=$1`, [messageId]);
      return result.rows[0];
    });
  }

  async reserveOutboundAttempt(messageId,{rfcMessageId=null,leaseSeconds=120}={}){
    return this.transaction(async client=>{
      const locked=await client.query('SELECT * FROM leadgen.outbound_messages WHERE id=$1 FOR UPDATE',[requiredUuid(messageId,'message_id')]);
      const message=locked.rows[0];if(!message)throw notFound('Outbound message not found','OUTBOUND_MESSAGE_NOT_FOUND');
      if(message.provider_message_id&&['PROVIDER_ACCEPTED','DELIVERED'].includes(message.send_status))return{...message,idempotent_replay:true};
      if(message.send_status==='AMBIGUOUS')return{...message,ambiguous_hold:true};
      const recipient=(await client.query('SELECT * FROM leadgen.outreach_recipients WHERE id=$1 FOR UPDATE',[message.recipient_id])).rows[0];
      const recipientHash=sha256(recipient?.normalized_recipient||'');
      const suppression=await client.query(`SELECT EXISTS(SELECT 1 FROM leadgen.outreach_recipients r WHERE r.id=$1 AND (EXISTS(SELECT 1 FROM leadgen.company_suppressions cs WHERE cs.company_id=r.company_id AND cs.lifted_at IS NULL) OR EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions rs WHERE rs.company_id=r.company_id AND rs.normalized_recipient_hash=$2 AND rs.lifted_at IS NULL) OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=r.company_id AND sx.lifted_at IS NULL AND ((r.contact_id IS NOT NULL AND sx.contact_id=r.contact_id) OR (r.decision_maker_contact_id IS NOT NULL AND sx.decision_maker_contact_id=r.decision_maker_contact_id) OR sx.normalized_recipient_hash=$2)))) blocked`,[message.recipient_id,recipientHash]);
      if(suppression.rows[0]?.blocked){const held=(await client.query(`UPDATE leadgen.outbound_messages SET send_status='BLOCKED',reason_codes=ARRAY(SELECT DISTINCT unnest(reason_codes||ARRAY['SUPPRESSED_BEFORE_PROVIDER_CALL']::text[])),updated_at=now() WHERE id=$1 RETURNING *`,[messageId])).rows[0];return{...held,suppression_blocked:true};}
      if(message.send_status==='SENDING'){
        const previous=await client.query(`SELECT * FROM leadgen.outbound_message_attempts WHERE outbound_message_id=$1 ORDER BY attempt_number DESC LIMIT 1`,[messageId]);
        if(previous.rows[0]?.provider_call_started_at){
          const held=await client.query(`UPDATE leadgen.outbound_messages SET send_status='AMBIGUOUS',transport_status='SEND_AMBIGUOUS',business_contact_status='SEND_AMBIGUOUS',ambiguous_since=coalesce(ambiguous_since,now()),send_lease_expires_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[messageId]);
          return{...held.rows[0],ambiguous_hold:true};
        }
        if(message.send_lease_expires_at&&new Date(message.send_lease_expires_at)>new Date())return{...message,send_in_progress:true};
      }
      const count=await client.query(`SELECT coalesce(max(attempt_number),0)+1 attempt_number FROM leadgen.outbound_message_attempts WHERE outbound_message_id=$1`,[messageId]);
      const attempt=await client.query(`INSERT INTO leadgen.outbound_message_attempts(outbound_message_id,attempt_number,attempt_status,provider) SELECT id,$2,'STARTED',provider FROM leadgen.outbound_messages WHERE id=$1 RETURNING *`,[messageId,count.rows[0].attempt_number]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status='SENDING',rfc_message_id=coalesce(rfc_message_id,$2),send_reserved_at=now(),send_lease_expires_at=now()+($3::int*interval '1 second'),updated_at=now() WHERE id=$1`,[messageId,rfcMessageId,Math.max(30,Number(leaseSeconds)||120)]);
      return{...attempt.rows[0],rfc_message_id:rfcMessageId||message.rfc_message_id};
    });
  }

  async blockOutboundWithoutAttempt(messageId,reasonCodes=[]){
    return(await this.pool.query(`UPDATE leadgen.outbound_messages SET send_status='BLOCKED',reason_codes=$2::text[],updated_at=now() WHERE id=$1 AND send_status IN('QUEUED','BLOCKED') RETURNING *`,[requiredUuid(messageId,'message_id'),reasonCodes])).rows[0]||null;
  }

  async markOutboundProviderCallStarted(messageId,attemptId){
    return this.transaction(async client=>{
      const locked=(await client.query(`SELECT m.*,r.normalized_recipient,r.contact_id,r.decision_maker_contact_id
        FROM leadgen.outbound_messages m JOIN leadgen.outreach_recipients r ON r.id=m.recipient_id
        WHERE m.id=$1 FOR UPDATE OF m,r`,[requiredUuid(messageId,'message_id')])).rows[0];
      if(!locked)throw notFound('Outbound message not found','OUTBOUND_MESSAGE_NOT_FOUND');
      const recipientHash=sha256(locked.normalized_recipient||'');
      const blocked=(await client.query(`SELECT
        EXISTS(SELECT 1 FROM leadgen.company_suppressions WHERE company_id=$1 AND lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions WHERE company_id=$1 AND normalized_recipient_hash=$2 AND lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.contact_suppressions WHERE company_id=$1 AND lifted_at IS NULL AND ((contact_id IS NOT NULL AND contact_id=$3) OR (decision_maker_contact_id IS NOT NULL AND decision_maker_contact_id=$4) OR normalized_recipient_hash=$2)) blocked`,[locked.company_id,recipientHash,locked.contact_id,locked.decision_maker_contact_id])).rows[0]?.blocked;
      if(blocked){
        await client.query(`UPDATE leadgen.outbound_message_attempts SET attempt_status='BLOCKED',reason_codes=ARRAY['SUPPRESSED_BEFORE_PROVIDER_CALL'],completed_at=now() WHERE id=$1 AND outbound_message_id=$2 AND completed_at IS NULL`,[attemptId,messageId]);
        await client.query(`UPDATE leadgen.outbound_messages SET send_status='CANCELLED',reason_codes=ARRAY(SELECT DISTINCT unnest(reason_codes||ARRAY['SUPPRESSED_BEFORE_PROVIDER_CALL']::text[])),send_lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[messageId]);
        return{suppression_blocked:true,id:attemptId};
      }
      const result=await client.query(`UPDATE leadgen.outbound_message_attempts SET provider_call_started_at=coalesce(provider_call_started_at,now()) WHERE id=$1 AND outbound_message_id=$2 AND completed_at IS NULL RETURNING *`,[attemptId,messageId]);
      if(!result.rowCount)throw notFound('Outbound attempt is unavailable','OUTBOUND_ATTEMPT_STATE_CONFLICT');return result.rows[0];
    });
  }

  async completeOutboundAttempt({ messageId, attemptId, attemptStatus, sendStatus, reasonCodes = [], responseCode = null, responseDigest = null,
    providerMessageId = null, providerThreadId = null, rfcMessageId = null, sendExecutionKey = null }) {
    return this.transaction(async client => {
      await client.query(`UPDATE leadgen.outbound_message_attempts SET attempt_status=$2,reason_codes=$3::text[],
        response_code=$4,response_digest=$5,completed_at=now() WHERE id=$1`, [attemptId,attemptStatus,reasonCodes,responseCode,responseDigest]);
      const result = await client.query(`UPDATE leadgen.outbound_messages SET send_status=$2,reason_codes=$3::text[],
        provider_message_id=coalesce($4,provider_message_id),provider_thread_id=coalesce($5,provider_thread_id),
        rfc_message_id=coalesce($6,rfc_message_id),send_execution_key=coalesce($7,send_execution_key),
        ambiguous_since=CASE WHEN $2='AMBIGUOUS' THEN coalesce(ambiguous_since,now()) ELSE NULL END,
        sent_at=CASE WHEN $2='PROVIDER_ACCEPTED' THEN now() ELSE sent_at END,
        transport_status=CASE WHEN $2='PROVIDER_ACCEPTED' THEN 'SMTP_ACCEPTED' WHEN $2='AMBIGUOUS' THEN 'SEND_AMBIGUOUS' WHEN $2 IN('FAILED','BLOCKED') THEN 'SEND_FAILED' ELSE transport_status END,
        business_contact_status=CASE WHEN $2='PROVIDER_ACCEPTED' THEN 'SENT_NO_REPLY' WHEN $2='AMBIGUOUS' THEN 'SEND_AMBIGUOUS' WHEN $2 IN('FAILED','BLOCKED') THEN 'SEND_FAILED' ELSE business_contact_status END,
        send_lease_expires_at=NULL,
        updated_at=now() WHERE id=$1 RETURNING *`, [messageId,sendStatus,reasonCodes,providerMessageId,providerThreadId,rfcMessageId,sendExecutionKey]);
      let thread = null;
      if (sendStatus === 'PROVIDER_ACCEPTED' && result.rowCount) {
        const message = result.rows[0];
        const threaded = await client.query(`INSERT INTO leadgen.outreach_threads
          (company_id,recipient_id,thread_token,thread_status,last_message_at)
          VALUES($1,$2,$3,'OPEN',now())
          ON CONFLICT(company_id,recipient_id) DO UPDATE SET last_message_at=now(),updated_at=now()
          RETURNING *`, [message.company_id,message.recipient_id,randomUUID()]);
        thread = threaded.rows[0];
      }
      return { ...result.rows[0], thread_id:thread?.id || null };
    });
  }

  async recordGmailAmbiguousEvent(messageId,{eventType,rfcMessageId,providerMessageId=null,providerThreadId=null}={}){
    const digest=sha256(JSON.stringify({messageId,eventType,rfcMessageId,providerMessageId,providerThreadId}));
    const result=await this.pool.query(`INSERT INTO leadgen.gmail_ambiguous_send_events
      (outbound_message_id,event_type,rfc_message_id,provider_message_id,provider_thread_id,event_digest)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_digest) DO NOTHING RETURNING *`,
    [requiredUuid(messageId,'message_id'),eventType,rfcMessageId,providerMessageId,providerThreadId,digest]);
    return result.rows[0]||null;
  }

  async recordOutboundAmbiguousEvent(messageId,{provider,eventType,rfcMessageId,providerMessageId=null}={}){
    const digest=sha256(JSON.stringify({messageId,provider,eventType,rfcMessageId,providerMessageId}));
    const result=await this.pool.query(`INSERT INTO leadgen.outbound_ambiguous_send_events(outbound_message_id,provider,event_type,rfc_message_id,provider_message_id,evidence_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(evidence_digest) DO NOTHING RETURNING *`,[requiredUuid(messageId,'message_id'),provider,eventType,rfcMessageId,providerMessageId,digest]);
    return result.rows[0]||null;
  }

  async resolveGmailAmbiguousSend(messageId,{provider_message_id,provider_thread_id,rfc_message_id}={}){
    const result=await this.pool.query(`UPDATE leadgen.outbound_messages SET send_status='PROVIDER_ACCEPTED',
      provider_message_id=$2,provider_thread_id=$3,rfc_message_id=coalesce($4,rfc_message_id),ambiguous_since=NULL,
      sent_at=coalesce(sent_at,now()),updated_at=now() WHERE id=$1 AND send_status='AMBIGUOUS' RETURNING *`,
    [requiredUuid(messageId,'message_id'),provider_message_id,provider_thread_id,rfc_message_id]);
    return result.rows[0]||null;
  }

  async getGmailCheckpoint(mailbox){
    const hash=sha256(String(mailbox||'').trim().toLowerCase());
    return (await this.pool.query('SELECT * FROM leadgen.gmail_mailbox_checkpoints WHERE mailbox_email_hash=$1',[hash])).rows[0]||null;
  }

  async saveGmailCheckpoint(mailbox,{historyId=null,status='COMPLETED',errorCode=null}={}){
    const hash=sha256(String(mailbox||'').trim().toLowerCase());
    const result=await this.pool.query(`INSERT INTO leadgen.gmail_mailbox_checkpoints
      (mailbox_email_hash,history_id,last_success_at,last_status,last_error_code)
      VALUES($1,$2,CASE WHEN $3='COMPLETED' THEN now() ELSE NULL END,$3,$4)
      ON CONFLICT(mailbox_email_hash) DO UPDATE SET history_id=coalesce(EXCLUDED.history_id,leadgen.gmail_mailbox_checkpoints.history_id),
      last_success_at=CASE WHEN EXCLUDED.last_status='COMPLETED' THEN now() ELSE leadgen.gmail_mailbox_checkpoints.last_success_at END,
      last_status=EXCLUDED.last_status,last_error_code=EXCLUDED.last_error_code,updated_at=now() RETURNING *`,[hash,historyId,status,errorCode]);
    return result.rows[0];
  }

  async getImapCheckpoint(mailbox,folder){
    return(await this.pool.query(`SELECT * FROM leadgen.imap_mailbox_checkpoints WHERE provider='SMTP' AND mailbox_identity_hash=$1 AND folder_path=$2`,[sha256(String(mailbox||'').trim().toLowerCase()),String(folder)])).rows[0]||null;
  }

  async saveImapCheckpoint(mailbox,{folder,uidvalidity,lastProcessedUid=0,highestModseq=null,status='COMPLETED'}={}){
    return this.transaction(async client=>{
      const mailboxHash=sha256(String(mailbox||'').trim().toLowerCase());
      const prior=(await client.query(`SELECT * FROM leadgen.imap_mailbox_checkpoints WHERE provider='SMTP' AND mailbox_identity_hash=$1 AND folder_path=$2 FOR UPDATE`,[mailboxHash,folder])).rows[0]||null;
      const changed=Boolean(prior&&Number(prior.uidvalidity)!==Number(uidvalidity));
      const row=(await client.query(`INSERT INTO leadgen.imap_mailbox_checkpoints(provider,mailbox_identity_hash,folder_path,uidvalidity,last_processed_uid,highest_modseq,checkpoint_status,reset_count,last_sync_at,last_success_at)
        VALUES('SMTP',$1,$2,$3,$4,$5,$6,0,now(),CASE WHEN $6='ACTIVE' THEN now() END)
        ON CONFLICT(provider,mailbox_identity_hash,folder_path) DO UPDATE SET uidvalidity=EXCLUDED.uidvalidity,last_processed_uid=EXCLUDED.last_processed_uid,highest_modseq=EXCLUDED.highest_modseq,
          checkpoint_status=CASE WHEN leadgen.imap_mailbox_checkpoints.uidvalidity<>EXCLUDED.uidvalidity THEN 'RESET_RESCAN' ELSE EXCLUDED.checkpoint_status END,
          reset_count=leadgen.imap_mailbox_checkpoints.reset_count+CASE WHEN leadgen.imap_mailbox_checkpoints.uidvalidity<>EXCLUDED.uidvalidity THEN 1 ELSE 0 END,last_sync_at=now(),last_success_at=CASE WHEN $6='ACTIVE' THEN now() ELSE leadgen.imap_mailbox_checkpoints.last_success_at END,updated_at=now() RETURNING *`,
      [mailboxHash,folder,Number(uidvalidity),Number(lastProcessedUid)||0,highestModseq,status==='COMPLETED'?'ACTIVE':'ERROR'])).rows[0];
      const eventType=!prior?'CREATED':changed?'UIDVALIDITY_RESET':status==='COMPLETED'?'ADVANCED':'SYNC_FAILED';
      const digest=sha256(JSON.stringify({checkpointId:row.id,eventType,priorUidvalidity:prior?.uidvalidity||null,uidvalidity:Number(uidvalidity),priorUid:prior?.last_processed_uid||null,uid:Number(lastProcessedUid)||0}));
      await client.query(`INSERT INTO leadgen.imap_checkpoint_events(checkpoint_id,event_type,prior_uidvalidity,current_uidvalidity,prior_uid,current_uid,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_digest) DO NOTHING`,[row.id,eventType,prior?.uidvalidity||null,Number(uidvalidity),prior?.last_processed_uid||null,Number(lastProcessedUid)||0,digest]);
      return{...row,uidvalidity_changed:changed};
    });
  }

  async recordImapReceipt(input){
    const result=await this.pool.query(`INSERT INTO leadgen.imap_message_receipts(mailbox_identity_hash,folder_path,uidvalidity,imap_uid,internet_message_id,webhook_inbox_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(mailbox_identity_hash,folder_path,uidvalidity,imap_uid) DO NOTHING RETURNING *`,[input.mailbox_identity_hash,input.folder_path,input.uidvalidity,input.uid,input.internet_message_id||null,input.webhook_inbox_id||null]);
    return{receipt:result.rows[0]||null,replay:!result.rowCount};
  }

  async persistWebhook(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.email_webhook_inbox
      (provider,provider_event_id,signature_status,event_type,raw_body_digest,sanitized_payload,processing_status)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT(provider,provider_event_id) DO UPDATE SET provider_event_id=EXCLUDED.provider_event_id
      RETURNING *`, [input.provider,input.provider_event_id,input.signature_status,input.event_type,
      input.raw_body_digest,JSON.stringify(input.sanitized_payload),input.processing_status || 'RECEIVED']);
    return result.rows[0];
  }

  async getWebhook(id) {
    const result = await this.pool.query(`SELECT * FROM leadgen.email_webhook_inbox WHERE id=$1`, [requiredUuid(id, 'webhook_id')]);
    return result.rows[0] || null;
  }

  async recordProviderEvent(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.email_message_events
      (outbound_message_id,webhook_inbox_id,event_type,occurred_at,provider_sequence,event_digest)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_digest) DO NOTHING RETURNING *`,
    [input.outbound_message_id,input.webhook_inbox_id,input.event_type,input.occurred_at,input.provider_sequence,input.event_digest]);
    return result.rows[0]||(await this.pool.query('SELECT * FROM leadgen.email_message_events WHERE event_digest=$1',[input.event_digest])).rows[0];
  }

  async findOutboundByProvider(provider, providerMessageId) {
    const result = await this.pool.query(`SELECT * FROM leadgen.outbound_messages WHERE provider=$1 AND provider_message_id=$2`, [provider,providerMessageId]);
    return result.rows[0] || null;
  }

  async findOutboundByRfcReferences(references = []) {
    const values=[...new Set((references||[]).flatMap(value=>{
      const clean=String(value||'').trim();if(!clean)return[];
      const bare=clean.replace(/^<|>$/g,'');return[clean,bare,`<${bare}>`];
    }))];
    if(!values.length)return null;
    const result=await this.pool.query(`SELECT m.*,coalesce(r.normalized_recipient,reservation.normalized_recipient) normalized_recipient
      FROM leadgen.outbound_messages m
      LEFT JOIN leadgen.outreach_recipients r ON r.id=m.recipient_id
      LEFT JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=m.first_touch_reservation_id
      WHERE m.rfc_message_id=ANY($1::text[]) ORDER BY m.created_at DESC LIMIT 1`,[values]);
    return result.rows[0]||null;
  }

  async updateOutboundState(id, status) {
    await this.pool.query(`UPDATE leadgen.outbound_messages SET send_status=$2,updated_at=now() WHERE id=$1`, [id,status]);
  }

  async markWebhookProcessed(id, status = 'PROCESSED') {
    await this.pool.query(`UPDATE leadgen.email_webhook_inbox SET processing_status=$2,processed_at=now() WHERE id=$1`, [id,status]);
  }

  async createInboundMessage(input) {
    return this.transaction(async client => {
      const result = await client.query(`INSERT INTO leadgen.inbound_messages
        (provider,provider_message_id,webhook_inbox_id,thread_id,correlation_status,from_address_hash,
         subject_sanitized,body_text_sanitized,attachment_status,received_at,mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid,internet_message_id,header_classification,correlation_outbound_message_id,correlation_method,correlation_evidence_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)
        ON CONFLICT(provider,provider_message_id) DO UPDATE SET provider_message_id=EXCLUDED.provider_message_id RETURNING *`,
      [input.provider,input.provider_message_id,input.webhook_inbox_id,input.thread_id,input.correlation_status,
        input.from_address_hash,input.subject_sanitized,input.body_text_sanitized,input.attachment_status,input.received_at,input.mailbox_identity_hash||null,input.folder_path||null,input.imap_uidvalidity||null,input.imap_uid||null,input.internet_message_id||null,JSON.stringify(input.header_classification||{}),input.correlation_outbound_message_id||null,input.correlation_method||null,input.correlation_evidence_digest||null]);
      if (input.thread_id) {
        await client.query(`UPDATE leadgen.outreach_threads SET thread_status='REPLIED',last_message_at=$2,updated_at=now()
          WHERE id=$1 AND thread_status='OPEN'`, [input.thread_id,input.received_at]);
      }
      return result.rows[0];
    });
  }

  async createReplyClassification(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.reply_classifications
      (inbound_message_id,intent,confidence,review_status,classifier_version,reason_codes,reply_category,classification_revision)
      VALUES($1,$2,$3,$4,$5,$6::text[],$7,$8) ON CONFLICT(inbound_message_id,classifier_version,classification_revision) DO NOTHING RETURNING *`, [input.inbound_message_id,input.intent,input.confidence,input.review_status,input.classifier_version,input.reason_codes,input.reply_category||'UNKNOWN_REVIEW',input.classification_revision||1]);
    return result.rows[0]||(await this.pool.query(`SELECT * FROM leadgen.reply_classifications WHERE inbound_message_id=$1 AND classifier_version=$2 AND classification_revision=$3`,[input.inbound_message_id,input.classifier_version,input.classification_revision||1])).rows[0];
  }

  async createSalesTask(input) {
    return this.transaction(async client => {
      const result = await client.query(`INSERT INTO leadgen.sales_tasks
        (company_id,thread_id,inbound_message_id,task_type,task_status,owner,due_at,details)
        SELECT $1,$2,$3,$4,'OPEN',$5,$6,$7::jsonb
        WHERE NOT EXISTS(SELECT 1 FROM leadgen.sales_tasks WHERE inbound_message_id=$3 AND task_type=$4)
        RETURNING *`, [input.company_id,input.thread_id,input.inbound_message_id,input.task_type,input.owner,input.due_at,JSON.stringify(input.details)]);
      return result.rows[0] || (await client.query(`SELECT * FROM leadgen.sales_tasks
        WHERE inbound_message_id=$1 AND task_type=$2 ORDER BY created_at LIMIT 1`, [input.inbound_message_id,input.task_type])).rows[0];
    });
  }

  async createCrmOutbox(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.crm_sync_outbox
      (company_id,task_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
      VALUES($1,$2,$3,$4::jsonb,$5,'PENDING',now())
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`, [requiredUuid(input.company_id,'company_id'),
      input.task_id?requiredUuid(input.task_id,'task_id'):null,input.operation,JSON.stringify(input.payload||{}),input.idempotency_key]);
    if (result.rowCount) return { outbox:result.rows[0],replay:false };
    const existing=await this.pool.query('SELECT * FROM leadgen.crm_sync_outbox WHERE idempotency_key=$1',[input.idempotency_key]);
    return { outbox:existing.rows[0],replay:true };
  }

  async applyInboundCrmEffects(input){
    return this.transaction(async client=>{
      const baseKey=input.effect_key;const activityKey=`${baseKey}:activity:${input.activity_type}`;
      const activity=(await client.query(`INSERT INTO leadgen.opportunity_activities(company_id,opportunity_snapshot_id,inbound_message_id,classification_id,activity_type,owner_identity,due_at,details,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,[input.company_id,input.opportunity_snapshot_id||null,input.inbound_message_id,input.classification_id,input.activity_type,input.owner||null,input.due_at||null,JSON.stringify(input.details||{}),activityKey])).rows[0]||null;
      if(activity&&input.opportunity_snapshot_id)await client.query(`INSERT INTO leadgen.opportunity_crm_states(opportunity_snapshot_id,company_id,funnel_status,owner_identity,next_action,next_action_due_at,source_inbound_message_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(opportunity_snapshot_id) DO UPDATE SET funnel_status=EXCLUDED.funnel_status,owner_identity=coalesce(EXCLUDED.owner_identity,leadgen.opportunity_crm_states.owner_identity),next_action=EXCLUDED.next_action,next_action_due_at=EXCLUDED.next_action_due_at,source_inbound_message_id=EXCLUDED.source_inbound_message_id,version=leadgen.opportunity_crm_states.version+1,updated_at=now()`,[input.opportunity_snapshot_id,input.company_id,input.funnel_status,input.owner||null,input.next_action||null,input.due_at||null,input.inbound_message_id]);
      if(activity&&input.close_followups)await client.query(`UPDATE leadgen.sales_tasks SET task_status='CANCELLED',closed_at=now(),close_reason='OPT_OUT',updated_at=now() WHERE thread_id=$1 AND task_status IN('OPEN','IN_PROGRESS')`,[input.thread_id]);
      let task=null;if(input.task){task=(await client.query(`INSERT INTO leadgen.sales_tasks(company_id,thread_id,inbound_message_id,task_type,task_status,owner,due_at,details,opportunity_snapshot_id,classification_id,effect_key)
        VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7::jsonb,$8,$9,$10) ON CONFLICT(effect_key) WHERE effect_key IS NOT NULL DO NOTHING RETURNING *`,[input.company_id,input.thread_id,input.inbound_message_id,input.task.task_type,input.owner||null,input.due_at||null,JSON.stringify(input.task.details||{}),input.opportunity_snapshot_id||null,input.classification_id,`${baseKey}:task`])).rows[0]||null;}
      const payload={activity_id:activity?.id||null,inbound_message_id:input.inbound_message_id,classification_id:input.classification_id,opportunity_snapshot_id:input.opportunity_snapshot_id||null,activity_type:input.activity_type,funnel_status:input.funnel_status,owner:input.owner||null,due_at:input.due_at||null};
      const activityOutbox=(await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,task_id,operation,payload,idempotency_key,sync_status,next_attempt_at) VALUES($1,NULL,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now()) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,[input.company_id,JSON.stringify(payload),`${baseKey}:crm:activity`])).rows[0]||null;
      let taskOutbox=null;if(task)taskOutbox=(await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,task_id,operation,payload,idempotency_key,sync_status,next_attempt_at) VALUES($1,$2,'CREATE_TASK',$3::jsonb,$4,'PENDING',now()) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,[input.company_id,task.id,JSON.stringify({task_id:task.id,task_type:task.task_type,due_at:task.due_at,source:'INBOUND_FOLLOWUP'}),`${baseKey}:crm:task`])).rows[0]||null;
      return{activity,task,outboxes:[activityOutbox,taskOutbox].filter(Boolean),replay:!activity&&!task&&!activityOutbox&&!taskOutbox};
    });
  }

  async getCrmOutbox(id) {
    const result=await this.pool.query('SELECT * FROM leadgen.crm_sync_outbox WHERE id=$1',[requiredUuid(id,'outbox_id')]);
    return result.rows[0]||null;
  }

  async enqueueControlledCrmEffects(contextId){
    requiredUuid(contextId,'controlled_context_id');
    const result=await this.pool.query(`INSERT INTO leadgen.crm_sync_outbox
      (company_id,record_scope,controlled_context_id,controlled_inbound_message_id,operation,payload,idempotency_key,sync_status,next_attempt_at)
      SELECT NULL,'CONTROLLED',i.context_id,i.id,'UPDATE_ACTIVITY',jsonb_build_object('classification_revision',i.classification_revision),
        'controlled-crm:'||i.context_id::text||':'||i.id::text||':'||i.classification_revision::text,'PENDING',now()
      FROM leadgen.controlled_application_inbound_messages i WHERE i.context_id=$1 AND i.classification_revision IS NOT NULL
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[contextId]);
    const rows=await this.pool.query(`SELECT id,sync_status FROM leadgen.crm_sync_outbox WHERE record_scope='CONTROLLED' AND controlled_context_id=$1 ORDER BY created_at,id`,[contextId]);
    return{created:result.rowCount,items:rows.rows};
  }

  async processControlledCrmOutbox(id){
    return this.transaction(async client=>{
      const candidate=(await client.query(`SELECT controlled_context_id FROM leadgen.crm_sync_outbox WHERE id=$1 AND record_scope='CONTROLLED'`,[requiredUuid(id,'outbox_id')])).rows[0];
      if(!candidate)throw notFound('Controlled CRM item not found','CONTROLLED_CRM_NOT_FOUND');
      const context=(await client.query(`SELECT * FROM leadgen.controlled_application_contexts WHERE id=$1 FOR UPDATE`,[candidate.controlled_context_id])).rows[0];
      const outbox=(await client.query(`SELECT * FROM leadgen.crm_sync_outbox WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(outbox.sync_status==='SYNCED')return{status:'SYNCED',outbox_id:id,replay:true,network_calls:0};
      if(outbox.record_scope!=='CONTROLLED'||outbox.company_id!==null||outbox.controlled_context_id!==context.id)throw new Error('CONTROLLED_CRM_SCOPE_MISMATCH');
      const inbound=(await client.query(`SELECT * FROM leadgen.controlled_application_inbound_messages WHERE id=$1 AND context_id=$2`,[outbox.controlled_inbound_message_id,context.id])).rows[0];
      if(!inbound||Number(inbound.classification_revision)!==Number(outbox.payload?.classification_revision))throw new Error('CONTROLLED_CRM_CLASSIFICATION_STALE');
      const category=inbound.reply_category;
      const activityType=category==='OPT_OUT'?'OPTED_OUT':category==='BOUNCE_DSN'?'BOUNCED':
        ['AUTO_REPLY','OUT_OF_OFFICE'].includes(category)?'AUTO_REPLY':category==='UNKNOWN_REVIEW'?'FOLLOW_UP_REQUIRED':'REPLIED';
      const review=!['OPT_OUT','BOUNCE_DSN','AUTO_REPLY','OUT_OF_OFFICE'].includes(category);
      const dueAt=review?new Date(new Date(inbound.received_at).getTime()+86400000):null;
      const suppressed=(await client.query(`SELECT EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions WHERE context_id=$1 AND lifted_at IS NULL)
        OR EXISTS(SELECT 1 FROM leadgen.controlled_application_inbound_messages WHERE context_id=$1 AND reply_category='OPT_OUT') blocked`,[context.id])).rows[0].blocked;
      await client.query(`INSERT INTO leadgen.opportunity_activities
        (company_id,record_scope,controlled_context_id,controlled_inbound_message_id,activity_type,owner_identity,due_at,details,idempotency_key)
        VALUES(NULL,'CONTROLLED',$1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(idempotency_key) DO NOTHING`,
        [context.id,inbound.id,activityType,context.created_by,dueAt,JSON.stringify({reply_category:category,occurred_at:inbound.received_at}),`${outbox.idempotency_key}:activity`]);
      if(review)await client.query(`INSERT INTO leadgen.sales_tasks
        (company_id,record_scope,controlled_context_id,controlled_inbound_message_id,task_type,task_status,owner,due_at,details,effect_key,closed_at,close_reason)
        VALUES(NULL,'CONTROLLED',$1,$2,'REPLY_REVIEW',$3,$4,$5,'{}'::jsonb,$6,CASE WHEN $7 THEN now() END,CASE WHEN $7 THEN 'OPT_OUT' END)
        ON CONFLICT(effect_key) WHERE effect_key IS NOT NULL DO NOTHING`,[context.id,inbound.id,suppressed?'CANCELLED':'OPEN',context.created_by,dueAt,`${outbox.idempotency_key}:task`,suppressed]);
      if(suppressed)await client.query(`UPDATE leadgen.sales_tasks SET task_status='CANCELLED',closed_at=coalesce(closed_at,now()),close_reason='OPT_OUT',updated_at=now()
        WHERE record_scope='CONTROLLED' AND controlled_context_id=$1 AND task_status IN('OPEN','IN_PROGRESS')`,[context.id]);
      await client.query(`UPDATE leadgen.crm_sync_outbox SET sync_status='SYNCED',attempt_count=attempt_count+1,last_error=NULL,next_attempt_at=NULL,updated_at=now() WHERE id=$1`,[id]);
      return{status:'SYNCED',outbox_id:id,replay:false,network_calls:0};
    });
  }

  async getControlledCrmState(contextId){
    const [activities,tasks,outbox]=await Promise.all([
      this.pool.query(`SELECT id,activity_type,owner_identity,due_at,created_at FROM leadgen.opportunity_activities WHERE record_scope='CONTROLLED' AND controlled_context_id=$1 ORDER BY created_at,id`,[contextId]),
      this.pool.query(`SELECT id,task_type,task_status,owner,due_at,closed_at,close_reason FROM leadgen.sales_tasks WHERE record_scope='CONTROLLED' AND controlled_context_id=$1 ORDER BY created_at,id`,[contextId]),
      this.pool.query(`SELECT id,sync_status,created_at,updated_at FROM leadgen.crm_sync_outbox WHERE record_scope='CONTROLLED' AND controlled_context_id=$1 ORDER BY created_at,id`,[contextId])]);
    const task=tasks.rows.find(row=>['OPEN','IN_PROGRESS'].includes(row.task_status))||tasks.rows.at(-1);
    const stopped=task?.task_status==='CANCELLED'||activities.rows.some(row=>row.activity_type==='OPTED_OUT');
    return{activities:activities.rows,tasks:tasks.rows,outbox:outbox.rows,status:outbox.rows.length&&outbox.rows.every(row=>row.sync_status==='SYNCED')?'SYNCED':'PENDING',
      owner:task?.owner||activities.rows.at(-1)?.owner_identity||null,next_action:stopped?'STOP_CONTACT':task?'REVIEW_REPLY':null,due_at:stopped?null:task?.due_at||null};
  }

  async claimCrmOutbox(id) {
    return this.transaction(async client=>{
      const current=await client.query('SELECT * FROM leadgen.crm_sync_outbox WHERE id=$1 FOR UPDATE',[requiredUuid(id,'outbox_id')]);
      if(!current.rowCount)throw notFound('CRM outbox item not found','CRM_OUTBOX_NOT_FOUND');
      const row=current.rows[0];
      if(['SYNCED','PERMANENT_ERROR','CANCELLED'].includes(row.sync_status))return{outbox:row,claimed:false};
      if(row.sync_status==='PROCESSING'){
        if(new Date(row.updated_at).getTime()<Date.now()-300000){
          const held=await client.query(`UPDATE leadgen.crm_sync_outbox SET sync_status='PERMANENT_ERROR',
            last_error='CRM_STALE_PROCESSING_RECONCILIATION_REQUIRED',next_attempt_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[id]);
          return{outbox:held.rows[0],claimed:false};
        }
        return{outbox:row,claimed:false};
      }
      if(row.next_attempt_at&&new Date(row.next_attempt_at)>new Date())return{outbox:row,claimed:false};
      const claimed=await client.query(`UPDATE leadgen.crm_sync_outbox SET sync_status='PROCESSING',
        attempt_count=attempt_count+1,updated_at=now(),last_error=NULL WHERE id=$1 RETURNING *`,[id]);
      return{outbox:claimed.rows[0],claimed:true};
    });
  }

  async completeCrmOutbox(id) {
    const result=await this.pool.query(`UPDATE leadgen.crm_sync_outbox SET sync_status='SYNCED',
      next_attempt_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND sync_status='PROCESSING' RETURNING *`,[requiredUuid(id,'outbox_id')]);
    if(!result.rowCount)throw notFound('Processing CRM outbox item not found','CRM_OUTBOX_STATE_CONFLICT');
    return result.rows[0];
  }

  async failCrmOutbox(id,{retryable,error,retryAfterSeconds=300}={}) {
    const status=retryable?'RETRYABLE_ERROR':'PERMANENT_ERROR';
    const result=await this.pool.query(`UPDATE leadgen.crm_sync_outbox SET sync_status=$2,
      next_attempt_at=CASE WHEN $2='RETRYABLE_ERROR' THEN now()+($4::int*interval '1 second') ELSE NULL END,
      last_error=$3,updated_at=now() WHERE id=$1 AND sync_status='PROCESSING' RETURNING *`,
    [requiredUuid(id,'outbox_id'),status,String(error||'CRM_SYNC_FAILED').slice(0,1000),Math.max(30,Number(retryAfterSeconds)||300)]);
    if(!result.rowCount)throw notFound('Processing CRM outbox item not found','CRM_OUTBOX_STATE_CONFLICT');
    return result.rows[0];
  }

  async pendingImportEffects(importId) {
    const result=await this.pool.query(`SELECT * FROM leadgen.data_import_effect_outbox
      WHERE import_id=$1 AND effect_status IN ('PENDING','RETRYABLE_ERROR') ORDER BY created_at,id`,[requiredUuid(importId,'import_id')]);
    return result.rows;
  }

  async markImportEffectDispatched(id,queueJobId) {
    return (await this.pool.query(`UPDATE leadgen.data_import_effect_outbox SET effect_status='DISPATCHED',
      queue_job_id=$2,attempt_count=attempt_count+1,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[id,String(queueJobId)])).rows[0];
  }

  async markImportEffectRetryable(id,error) {
    return (await this.pool.query(`UPDATE leadgen.data_import_effect_outbox SET effect_status='RETRYABLE_ERROR',
      attempt_count=attempt_count+1,last_error=$2,updated_at=now() WHERE id=$1 RETURNING *`,[id,String(error||'QUEUE_DISPATCH_FAILED').slice(0,1000)])).rows[0];
  }

  async findInboundThread({ inReplyTo = null, references = [], messageKey = null, providerThreadId = null, normalizedSender = null } = {}) {
    const variants=value=>{const bare=String(value||'').replace(/[<>]/g,'').trim();return bare?[bare,`<${bare}>`]:[];};
    const replyValues=[...new Set(variants(inReplyTo))];const referenceValues=[...new Set((references||[]).flatMap(variants))];
    const result = await this.pool.query(`SELECT t.id,t.company_id,t.recipient_id,m.id outbound_message_id,
      CASE WHEN m.rfc_message_id=ANY($1::text[]) THEN 'IN_REPLY_TO'
           WHEN m.rfc_message_id=ANY($2::text[]) THEN 'REFERENCES'
           WHEN m.message_key_header=$3 THEN 'MESSAGE_KEY'
           WHEN m.provider_thread_id=$4 THEN 'PROVIDER_THREAD' END correlation_method
      FROM leadgen.outbound_messages m
      JOIN leadgen.outreach_threads t ON t.company_id=m.company_id AND (
        (t.recipient_id IS NOT NULL AND t.recipient_id=m.recipient_id)
        OR (t.first_touch_reservation_id IS NOT NULL AND t.first_touch_reservation_id=m.first_touch_reservation_id))
      LEFT JOIN leadgen.outreach_recipients r ON r.id=t.recipient_id
      LEFT JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=t.first_touch_reservation_id
      WHERE t.thread_status IN('OPEN','REPLIED','MANUAL_TAKEOVER')
      AND ($5::text='' OR lower(coalesce(r.normalized_recipient,reservation.normalized_recipient))=lower($5)) AND (
        m.rfc_message_id=ANY($1::text[]) OR m.rfc_message_id=ANY($2::text[]) OR m.message_key_header=$3 OR m.provider_thread_id=$4)
      ORDER BY CASE WHEN m.rfc_message_id=ANY($1::text[]) THEN 1 WHEN m.rfc_message_id=ANY($2::text[]) THEN 2 WHEN m.message_key_header=$3 THEN 3 ELSE 4 END,t.updated_at DESC LIMIT 1`,[replyValues,referenceValues,messageKey||null,providerThreadId||null,String(normalizedSender||'').trim().toLowerCase()]);
    return result.rows[0] || null;
  }

  async getInboundForTask(id) {
    const result = await this.pool.query(`SELECT i.*,coalesce(t.company_id,m.company_id) company_id,t.recipient_id,t.thread_status,
      c.id classification_id,c.intent,c.reply_category,c.classification_revision,c.confidence,c.reason_codes classification_reason_codes,
      o.id opportunity_snapshot_id,coalesce(q.owner_identity,me.actor_identity) owner_identity
      FROM leadgen.inbound_messages i
      LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id
      LEFT JOIN leadgen.outbound_messages m ON m.id=i.correlation_outbound_message_id
      LEFT JOIN leadgen.outreach_recipients r ON r.id=t.recipient_id
      LEFT JOIN leadgen.outreach_eligibility_snapshots s ON s.id=r.eligibility_snapshot_id
      LEFT JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=coalesce(t.first_touch_reservation_id,m.first_touch_reservation_id)
      LEFT JOIN leadgen.business_opportunity_current o ON o.company_id=coalesce(t.company_id,m.company_id)
        AND o.product_profile=coalesce(s.product_profile,reservation.eligibility_snapshot->>'product_profile')
      LEFT JOIN leadgen.contact_work_queue q ON q.company_id=coalesce(t.company_id,m.company_id)
        AND q.product_profile=o.product_profile AND q.decision_snapshot_id=o.id AND q.queue_status='ACTIVE'
      LEFT JOIN leadgen.business_opportunity_management_events me ON me.id=q.management_event_id
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.reply_classifications x
        WHERE x.inbound_message_id=i.id ORDER BY x.created_at DESC LIMIT 1)c ON true
      WHERE i.id=$1`, [requiredUuid(id,'inbound_message_id')]);
    return result.rows[0] || null;
  }

  async getThread(id) {
    const result = await this.pool.query(`SELECT t.*,
      coalesce(json_agg(json_build_object('id',i.id,'subject',i.subject_sanitized,'body',i.body_text_sanitized,
        'received_at',i.received_at)) FILTER(WHERE i.id IS NOT NULL),'[]') inbound_messages
      FROM leadgen.outreach_threads t LEFT JOIN leadgen.inbound_messages i ON i.thread_id=t.id
      WHERE t.id=$1 GROUP BY t.id`, [requiredUuid(id, 'thread_id')]);
    return result.rows[0] || null;
  }

  async listInbox({ limit = 100, company_id = null } = {}) {
    const companyId = company_id ? requiredUuid(company_id,'company_id') : null;
    const result = await this.pool.query(`SELECT i.id,i.provider,i.provider_message_id,i.thread_id,i.correlation_status,
      i.subject_sanitized,i.body_text_sanitized,i.attachment_status,i.received_at,
      c.intent,c.confidence,c.review_status,coalesce(t.company_id,m.company_id) company_id,t.thread_status
      FROM leadgen.inbound_messages i
      LEFT JOIN LATERAL(SELECT x.* FROM leadgen.reply_classifications x WHERE x.inbound_message_id=i.id ORDER BY x.created_at DESC LIMIT 1)c ON true
      LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id
      LEFT JOIN leadgen.outbound_messages m ON m.id=i.correlation_outbound_message_id
      WHERE ($2::uuid IS NULL OR coalesce(t.company_id,m.company_id)=$2)
      ORDER BY i.received_at DESC LIMIT $1`, [Math.max(1, Math.min(500, Number(limit) || 100)),companyId]);
    return result.rows;
  }

  async suppressRecipientForMessage(messageId, suppressionType, sourceEventId, { companyWide = false } = {}) {
    return this.transaction(async client => {
      const recipient = await client.query(`SELECT m.company_id,r.contact_id,
          coalesce(r.decision_maker_contact_id,reservation.decision_maker_contact_id) decision_maker_contact_id,
          coalesce(r.normalized_recipient,reservation.normalized_recipient) normalized_recipient
        FROM leadgen.outbound_messages m
        LEFT JOIN leadgen.outreach_recipients r ON r.id=m.recipient_id
        LEFT JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=m.first_touch_reservation_id
        WHERE m.id=$1 FOR UPDATE OF m`, [messageId]);
      if (!recipient.rowCount) return null;
      const row=recipient.rows[0];
      const result=await client.query(`INSERT INTO leadgen.contact_suppressions
        (company_id,contact_id,decision_maker_contact_id,normalized_recipient_hash,suppression_type,
         reason,source_event_id,recorded_by)
        VALUES($1,$2,$3,CASE WHEN $2::uuid IS NULL AND $3::uuid IS NULL THEN $4 ELSE NULL END,$5,$5,$6,'PROVIDER_EVENT')
      ON CONFLICT DO NOTHING RETURNING *`, [row.company_id,row.contact_id,row.decision_maker_contact_id,
        sha256(row.normalized_recipient),suppressionType,sourceEventId]);
      const recipientHash=sha256(row.normalized_recipient);
      if(['OPT_OUT','HARD_BOUNCE','COMPLAINT','MANUAL'].includes(suppressionType))await client.query(`INSERT INTO leadgen.outreach_recipient_suppressions
        (company_id,normalized_recipient_hash,suppression_type,recorded_by)
        VALUES($1,$2,$3,'PROVIDER_EVENT') ON CONFLICT DO NOTHING`,[row.company_id,recipientHash,suppressionType]);
      if (suppressionType === 'COMPLAINT') {
        await client.query(`INSERT INTO leadgen.company_suppressions(company_id,suppression_type,reason)
          VALUES($1,'DO_NOT_CONTACT','Provider complaint') ON CONFLICT DO NOTHING`, [row.company_id]);
      } else if (suppressionType === 'OPT_OUT' && companyWide) {
        await client.query(`INSERT INTO leadgen.company_suppressions(company_id,suppression_type,reason)
          VALUES($1,'OPT_OUT','Explicit company-wide opt-out') ON CONFLICT DO NOTHING`, [row.company_id]);
      }
      await client.query(`UPDATE leadgen.outreach_recipients SET lifecycle_status='SUPPRESSED',
        consent_status=CASE WHEN $3='OPT_OUT' THEN 'OPTED_OUT' ELSE consent_status END,updated_at=now()
        WHERE company_id=$1 AND lower(normalized_recipient)=lower($2)`,[row.company_id,row.normalized_recipient,suppressionType]);
      await client.query(`UPDATE leadgen.outreach_drafts SET draft_status='CANCELLED',updated_at=now()
        WHERE recipient_id IN(SELECT id FROM leadgen.outreach_recipients WHERE company_id=$1 AND lower(normalized_recipient)=lower($2))
          AND draft_status IN('DRAFT','INVALID_DRAFT','PENDING_REVIEW','NEEDS_CHANGES','APPROVED')`,[row.company_id,row.normalized_recipient]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status='CANCELLED',
        reason_codes=ARRAY(SELECT DISTINCT unnest(reason_codes||ARRAY[$3]::text[])),updated_at=now()
        WHERE recipient_id IN(SELECT id FROM leadgen.outreach_recipients WHERE company_id=$1 AND lower(normalized_recipient)=lower($2))
          AND send_status IN('QUEUED','BLOCKED')`,[row.company_id,row.normalized_recipient,`${suppressionType}_SUPPRESSED`]);
      if(suppressionType==='COMPLAINT'||(suppressionType==='OPT_OUT'&&companyWide)){
        await client.query(`UPDATE leadgen.outreach_drafts SET draft_status='CANCELLED',updated_at=now()
          WHERE company_id=$1 AND draft_status IN('DRAFT','INVALID_DRAFT','PENDING_REVIEW','NEEDS_CHANGES','APPROVED')`,[row.company_id]);
        await client.query(`UPDATE leadgen.outbound_messages SET send_status='CANCELLED',
          reason_codes=ARRAY(SELECT DISTINCT unnest(reason_codes||ARRAY['COMPANY_SUPPRESSED']::text[])),updated_at=now()
          WHERE company_id=$1 AND send_status IN('QUEUED','BLOCKED')`,[row.company_id]);
      }
      return result.rows[0]||null;
    });
  }

  async suppressRecipientForInbound(inboundMessageId, { companyWide = false } = {}) {
    return this.transaction(async client => {
      const recipient=await client.query(`SELECT coalesce(t.company_id,m.company_id) company_id,r.contact_id,
          coalesce(r.decision_maker_contact_id,reservation.decision_maker_contact_id) decision_maker_contact_id,
          coalesce(r.normalized_recipient,reservation.normalized_recipient) normalized_recipient,t.id thread_id
        FROM leadgen.inbound_messages i
        LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id
        LEFT JOIN leadgen.outbound_messages m ON m.id=i.correlation_outbound_message_id
        LEFT JOIN leadgen.outreach_recipients r ON r.id=t.recipient_id
        LEFT JOIN leadgen.phase13_first_touch_reservations reservation ON reservation.id=coalesce(t.first_touch_reservation_id,m.first_touch_reservation_id)
        WHERE i.id=$1 FOR UPDATE OF i`, [inboundMessageId]);
      if(!recipient.rowCount)return null;
      const row=recipient.rows[0];
      const inserted=await client.query(`INSERT INTO leadgen.contact_suppressions
        (company_id,contact_id,decision_maker_contact_id,normalized_recipient_hash,suppression_type,reason,recorded_by)
        VALUES($1,$2,$3,CASE WHEN $2::uuid IS NULL AND $3::uuid IS NULL THEN $4 ELSE NULL END,'OPT_OUT','OPT_OUT','INBOUND_REPLY')
        ON CONFLICT DO NOTHING RETURNING *`, [row.company_id,row.contact_id,row.decision_maker_contact_id,sha256(row.normalized_recipient)]);
      const recipientHash=sha256(row.normalized_recipient);
      await client.query(`INSERT INTO leadgen.outreach_recipient_suppressions(company_id,normalized_recipient_hash,suppression_type,source_inbound_message_id,recorded_by) VALUES($1,$2,'OPT_OUT',$3,'INBOUND_REPLY') ON CONFLICT DO NOTHING`,[row.company_id,recipientHash,inboundMessageId]);
      if(companyWide)await client.query(`INSERT INTO leadgen.company_suppressions(company_id,suppression_type,reason)
        VALUES($1,'OPT_OUT','Explicit company-wide opt-out') ON CONFLICT DO NOTHING`,[row.company_id]);
      if(row.thread_id)await client.query(`UPDATE leadgen.outreach_threads SET thread_status='SUPPRESSED',updated_at=now() WHERE id=$1`,[row.thread_id]);
      await client.query(`UPDATE leadgen.outreach_recipients SET lifecycle_status='SUPPRESSED',consent_status='OPTED_OUT',updated_at=now() WHERE company_id=$1 AND lower(normalized_recipient)=lower($2)`,[row.company_id,row.normalized_recipient]);
      await client.query(`UPDATE leadgen.outreach_drafts SET draft_status='CANCELLED',updated_at=now() WHERE recipient_id IN(SELECT id FROM leadgen.outreach_recipients WHERE company_id=$1 AND lower(normalized_recipient)=lower($2)) AND draft_status IN('DRAFT','INVALID_DRAFT','PENDING_REVIEW','NEEDS_CHANGES','APPROVED')`,[row.company_id,row.normalized_recipient]);
      await client.query(`UPDATE leadgen.outbound_messages SET send_status='CANCELLED',reason_codes=ARRAY(SELECT DISTINCT unnest(reason_codes||ARRAY['OPT_OUT_SUPPRESSED']::text[])),updated_at=now() WHERE recipient_id IN(SELECT id FROM leadgen.outreach_recipients WHERE company_id=$1 AND lower(normalized_recipient)=lower($2)) AND send_status IN('QUEUED','BLOCKED')`,[row.company_id,row.normalized_recipient]);
      return inserted.rows[0]||null;
    });
  }

  async createImport(record, { sourceFilename }) {
    return this.transaction(async client => {
      const existing = await client.query(`SELECT * FROM leadgen.reference_data_imports
        WHERE import_type=$1 AND content_sha256=$2 AND import_batch_id IS NULL`, [record.importType,record.sourceSha256]);
      if (existing.rowCount) return { import: mapImportStatus(existing.rows[0]), replay: true };
      const summary = record.dryRun.summary;
      const result = await client.query(`INSERT INTO leadgen.reference_data_imports
        (id,import_type,source_filename,content_sha256,status,row_count,accepted_count,rejected_count,
         duplicate_count,error_report,validated_at,created_by,import_version,dataset_role,schema_version,
         dry_run_passed,dry_run_digest,dry_run_passed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),$11,$12,$13,$14,$15,$16,CASE WHEN $15 THEN now() ELSE NULL END)
        RETURNING *`, [record.importId,record.importType,cleanFilename(sourceFilename),record.sourceSha256,
        record.dryRun.passed ? 'VALIDATED' : 'VALIDATION_FAILED',record.dryRun.rows.length,
        summary.accepted,summary.rejected,summary.duplicate,JSON.stringify({ summary }),
        record.createdBy,record.importVersion,record.datasetRole,record.schemaVersion,record.dryRun.passed,record.dryRun.digest]);
      for (const row of record.dryRun.rows) {
        await client.query(`INSERT INTO leadgen.reference_data_import_rows
          (import_id,row_number,raw_payload,normalized_payload,duplicate_key,row_status,error_codes,
           source_sheet,source_row,source_hash,source_identity_key,captured_at)
          VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7::text[],'Import',$8,$9,$10,now())`, [
          record.importId,row.rowNumber,JSON.stringify(row.rawPayload),JSON.stringify(row.normalizedPayload),
          row.duplicateKey,row.rowStatus,[...row.errorCodes,...row.reviewReasons,...row.warningCodes],row.rowNumber,
          row.rowDigest,sha256(`${record.importId}|${row.rowNumber}|${row.rowDigest}`)]);
      }
      return { import: mapImportStatus(result.rows[0]), replay: false };
    });
  }

  async resolveImportRows(importType, rows) {
    if (importType === 'PROSPECT_LEADS') {
      const domains = [...new Set(rows.map(row => importDomain(row.website_url)).filter(Boolean))];
      const externalIds = [...new Set(rows.map(row => String(row.external_lead_id || '').trim().toLowerCase()).filter(Boolean))];
      const [domainMatches, identityMatches] = await Promise.all([
        domains.length ? this.pool.query(`SELECT id,lower(normalized_domain) normalized_domain
          FROM leadgen.companies WHERE lower(normalized_domain)=ANY($1::text[])`, [domains]) : { rows: [] },
        externalIds.length ? this.pool.query(`SELECT lower(r.normalized_payload->>'external_lead_id') external_lead_id,
            r.canonical_entity_id company_id
          FROM leadgen.reference_data_import_rows r JOIN leadgen.reference_data_imports i ON i.id=r.import_id
          WHERE i.import_type='PROSPECT_LEADS' AND lower(r.normalized_payload->>'external_lead_id')=ANY($1::text[])
            AND r.canonical_entity_type='COMPANY' AND r.canonical_entity_id IS NOT NULL
          ORDER BY r.created_at DESC`, [externalIds]) : { rows: [] },
      ]);
      const byDomain = new Map(domainMatches.rows.map(row => [row.normalized_domain, row.id]));
      const byExternalId = new Map(identityMatches.rows.map(row => [row.external_lead_id, row.company_id]));
      const resolved = [];
      for (const row of rows) {
        const domain = importDomain(row.website_url);
        const externalId = String(row.external_lead_id || '').trim().toLowerCase();
        if (domain && byDomain.has(domain)) {
          resolved.push({ ...row, existingCompanyMatch: 'EXACT_DOMAIN', matchedCompanyId: byDomain.get(domain) });
          continue;
        }
        if (externalId && byExternalId.has(externalId)) {
          resolved.push({ ...row, existingCompanyMatch: 'EXACT_EXTERNAL_ID', matchedCompanyId: byExternalId.get(externalId) });
          continue;
        }
        const name = normalizedCompanyName(row.company_name);
        if (!name) { resolved.push(row); continue; }
        const candidate = await this.pool.query(`SELECT id,company_name,similarity(lower(company_name),$1) confidence
          FROM leadgen.companies
          WHERE ($2::text IS NULL OR country_code=$2) AND similarity(lower(company_name),$1)>=0.65
          ORDER BY confidence DESC,id LIMIT 2`, [name, String(row.country_code || '').trim().toUpperCase() || null]);
        resolved.push(candidate.rowCount
          ? { ...row, existingCompanyMatch: 'FUZZY_OR_UNCERTAIN', ambiguousCompanyLink: true,
            candidateCompanyIds: candidate.rows.map(item => item.id) }
          : row);
      }
      return resolved;
    }
    if (!['CUSTOMER_DEALS', 'CUSTOMER_DEAL_LINES'].includes(importType)) return rows;
    const companyIds = [...new Set(rows.map(row => String(row.crosswalk_company_id || '').trim().toLowerCase()).filter(value => UUID.test(value)))];
    const historicalIds = [...new Set(rows.map(row => String(row.crosswalk_historical_customer_id || '').trim().toLowerCase()).filter(value => UUID.test(value)))];
    const orderIds = [...new Set(rows.map(row => String(row.external_deal_or_order_id || '').trim()).filter(Boolean))];
    const [companies, historicalCustomers, existingOrders] = await Promise.all([
      companyIds.length ? this.pool.query('SELECT id FROM leadgen.companies WHERE id=ANY($1::uuid[])', [companyIds]) : { rows: [] },
      historicalIds.length ? this.pool.query(`SELECT h.id,h.external_customer_id,
          array_remove(array_agg(l.company_id) FILTER (WHERE l.link_status='CONFIRMED'),NULL) confirmed_company_ids
        FROM leadgen.historical_customers h LEFT JOIN leadgen.historical_customer_company_links l ON l.historical_customer_id=h.id
        WHERE h.id=ANY($1::uuid[]) GROUP BY h.id,h.external_customer_id`, [historicalIds]) : { rows: [] },
      orderIds.length ? this.pool.query(`SELECT external_order_id FROM leadgen.historical_orders
        WHERE source_system='PHASE7_DATA_EXCHANGE' AND external_order_id=ANY($1::text[])`, [orderIds]) : { rows: [] },
    ]);
    const existingCompanies = new Set(companies.rows.map(row => String(row.id).toLowerCase()));
    const existingHistorical = new Map(historicalCustomers.rows.map(row => [String(row.id).toLowerCase(),row]));
    const duplicateOrders = new Set(existingOrders.rows.map(row => row.external_order_id));
    return rows.map(row => {
      const companyId = String(row.crosswalk_company_id || '').trim().toLowerCase();
      const historicalId = String(row.crosswalk_historical_customer_id || '').trim().toLowerCase();
      const historical=historicalId?existingHistorical.get(historicalId):null;
      const confirmedCompanies=(historical?.confirmed_company_ids||[]).map(value=>String(value).toLowerCase());
      const crosswalkVerified = existingCompanies.has(companyId) && (!historicalId || (historical
        && String(historical.external_customer_id)===String(row.external_customer_id||'').trim()
        && (!confirmedCompanies.length||confirmedCompanies.includes(companyId))));
      return {
        ...row,
        crosswalkVerified,
        ambiguousCompanyLink: !crosswalkVerified,
        existingCanonicalDuplicate: importType === 'CUSTOMER_DEALS'
          && duplicateOrders.has(String(row.external_deal_or_order_id || '').trim()),
      };
    });
  }

  async getImport(id) {
    const result = await this.pool.query(`SELECT i.*,
      a.id approval_id,a.decision approval_decision,a.dry_run_digest approval_dry_run_digest,
      a.source_sha256 approval_source_sha256,a.approver_identity,a.approver_role,a.decided_at
      FROM leadgen.reference_data_imports i LEFT JOIN LATERAL(
        SELECT x.* FROM leadgen.import_approvals x WHERE x.import_id=i.id ORDER BY x.decided_at DESC,x.id DESC LIMIT 1
      )a ON true WHERE i.id=$1`, [requiredUuid(id, 'import_id')]);
    return mapImportStatus(result.rows[0]);
  }

  async getImportRows(id, { limit = 500, offset = 0 } = {}) {
    requiredUuid(id, 'import_id');
    const result = await this.pool.query(`SELECT id,row_number,normalized_payload,duplicate_key,row_status,error_codes,
      canonical_entity_type,canonical_entity_id,created_at
      FROM leadgen.reference_data_import_rows WHERE import_id=$1 ORDER BY row_number LIMIT $2 OFFSET $3`,
    [id,Math.max(1,Math.min(1000,Number(limit)||500)),Math.max(0,Number(offset)||0)]);
    return result.rows;
  }

  async submitImport(id) {
    const result = await this.pool.query(`UPDATE leadgen.reference_data_imports SET status='COMMITTING'
      WHERE id=$1 AND status='VALIDATED' AND dry_run_passed=true RETURNING *`, [requiredUuid(id, 'import_id')]);
    if (!result.rowCount) throw notFound('Passing import dry-run not found', 'IMPORT_SUBMIT_FORBIDDEN');
    return mapImportStatus(result.rows[0]);
  }

  async approveImport(input) {
    const result = await this.pool.query(`INSERT INTO leadgen.import_approvals
      (import_id,decision,dry_run_digest,source_sha256,approver_identity,approver_role,reason,idempotency_key)
      SELECT i.id,$2,i.dry_run_digest,i.content_sha256,$3,$4,$5,$6 FROM leadgen.reference_data_imports i
      WHERE i.id=$1 AND i.status='COMMITTING' AND i.dry_run_passed=true RETURNING *`, [
      requiredUuid(input.id,'import_id'),input.decision,input.actor,input.role,input.reason,input.idempotency_key]);
    if (!result.rowCount) throw notFound('Submitted import not found', 'IMPORT_APPROVAL_FORBIDDEN');
    return result.rows[0];
  }

  async commitImport(id, actor) {
    return this.transaction(async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`phase7-import:${id}`]);
      const record = await client.query(`SELECT i.*,a.id approval_id,a.decision approval_decision,
        a.dry_run_digest approval_dry_run_digest,a.source_sha256 approval_source_sha256
        FROM leadgen.reference_data_imports i LEFT JOIN LATERAL(SELECT x.* FROM leadgen.import_approvals x
          WHERE x.import_id=i.id ORDER BY x.decided_at DESC LIMIT 1)a ON true WHERE i.id=$1 FOR UPDATE OF i`, [requiredUuid(id,'import_id')]);
      if (!record.rowCount) throw notFound('Import not found', 'IMPORT_NOT_FOUND');
      const item = record.rows[0];
      if (item.status === 'COMMITTED') return { import: mapImportStatus(item), replay: true, mutations: 0 };
      if (!item.dry_run_passed || item.approval_decision !== 'APPROVED'
        || item.dry_run_digest.toLowerCase() !== item.approval_dry_run_digest.toLowerCase()
        || item.content_sha256.toLowerCase() !== item.approval_source_sha256.toLowerCase()) {
        const error = new Error('Exact dry-run and source hash approval is required'); error.code='IMPORT_COMMIT_FORBIDDEN'; error.status=409; throw error;
      }
      const unresolved = await client.query(`SELECT row_number,row_status FROM leadgen.reference_data_import_rows
        WHERE import_id=$1 AND row_status IN ('REVIEW','REJECTED') ORDER BY row_number FOR UPDATE`, [id]);
      if (unresolved.rowCount) {
        const error = new Error('Every review or rejected row must be resolved before commit');
        error.code='IMPORT_ROWS_UNRESOLVED'; error.status=409; error.rows=unresolved.rows; throw error;
      }
      const rows = await client.query(`SELECT * FROM leadgen.reference_data_import_rows WHERE import_id=$1
        AND row_status='ACCEPTED' ORDER BY row_number FOR UPDATE`, [id]);
      let mutations = 0;
      const affectedCompanies = new Set();
      const autoEvidenceCompanies = new Set();
      for (const row of rows.rows) {
        const payload = row.normalized_payload || {};
        if (item.import_type === 'PROSPECT_LEADS') {
          const domain = (() => { try { return new URL(payload.website_url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return `import-${payload.external_lead_id}`.toLowerCase(); } })();
          const inserted = await client.query(`INSERT INTO leadgen.companies
            (company_name,normalized_domain,country_code,city,website_url,company_type,product_categories,
             data_origin,verification_status,lifecycle_status,qualification_status)
            VALUES($1,$2,$3,$4,$5,$6,$7::text[],'imported','REVIEW','ACTIVE','needs_review')
            ON CONFLICT(normalized_domain) DO NOTHING RETURNING id`, [payload.company_name,domain,payload.country_code,
            payload.city,payload.website_url,payload.company_type,payload.product_profile && payload.product_profile !== 'UNKNOWN' ? [payload.product_profile] : []]);
          if (inserted.rowCount) {
            mutations += 1;
            autoEvidenceCompanies.add(inserted.rows[0].id);
            await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type='COMPANY',
              canonical_entity_id=$2,row_status='COMMITTED' WHERE id=$1`, [row.id,inserted.rows[0].id]);
            continue;
          }
          const existing = await client.query('SELECT id FROM leadgen.companies WHERE normalized_domain=$1', [domain]);
          if (existing.rowCount) {
            autoEvidenceCompanies.add(existing.rows[0].id);
            await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type='COMPANY',
              canonical_entity_id=$2,row_status='DUPLICATE' WHERE id=$1`, [row.id,existing.rows[0].id]);
            continue;
          }
        } else if (item.import_type === 'PRODUCT_MASTER_UPDATE') {
          const product = await client.query(`SELECT id FROM leadgen.product_master
            WHERE lower(coalesce(source_product_id,''))=lower($1) OR ($2::text IS NOT NULL AND lower(coalesce(sku,''))=lower($2))
            ORDER BY created_at LIMIT 1`, [payload.external_product_id,payload.sku]);
          if (product.rowCount) {
            const latest = await client.query(`SELECT id,revision_number FROM leadgen.product_master_revisions
              WHERE product_master_id=$1 ORDER BY revision_number DESC LIMIT 1`, [product.rows[0].id]);
            const revision = await client.query(`INSERT INTO leadgen.product_master_revisions
              (product_master_id,source_import_id,source_import_row_id,supersedes_revision_id,revision_number,
               product_profile,category,subcategory,revision_payload,catalog_status,effective_date,
               approval_status,approved_by,approved_at,record_digest)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'APPROVED',$12,now(),$13) RETURNING id`, [
              product.rows[0].id,id,row.id,latest.rows[0]?.id || null,Number(latest.rows[0]?.revision_number || 0)+1,
              payload.product_profile,payload.category,payload.subcategory,JSON.stringify(payload),payload.catalog_status,
              payload.effective_date,actor,row.source_hash]);
            mutations += 1;
            await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type='PRODUCT_MASTER_REVISION',
              canonical_entity_id=$2,row_status='COMMITTED' WHERE id=$1`, [row.id,revision.rows[0].id]);
            continue;
          }
        } else if (['CUSTOMER_DEALS','CUSTOMER_DEAL_LINES'].includes(item.import_type)) {
          const company = await client.query('SELECT id FROM leadgen.companies WHERE id=$1', [payload.crosswalk_company_id]);
          if (!company.rowCount || payload.crosswalk_status !== 'CONFIRMED') {
            const error = new Error(`Controlled company crosswalk is not confirmed for row ${row.row_number}`);
            error.code='IMPORT_CROSSWALK_UNRESOLVED'; error.status=409; throw error;
          }
          let historicalCustomerId = payload.crosswalk_historical_customer_id || null;
          if (historicalCustomerId) {
            const historical = await client.query('SELECT id FROM leadgen.historical_customers WHERE id=$1', [historicalCustomerId]);
            if (!historical.rowCount) {
              const error = new Error(`Historical customer crosswalk is not valid for row ${row.row_number}`);
              error.code='IMPORT_CROSSWALK_UNRESOLVED'; error.status=409; throw error;
            }
          } else {
            const historical = await client.query(`SELECT id FROM leadgen.historical_customers
              WHERE source_system='PHASE7_DATA_EXCHANGE' AND external_customer_id=$1`, [payload.external_customer_id]);
            historicalCustomerId = historical.rows[0]?.id || null;
          }
          if (!historicalCustomerId) {
            const historical = await client.query(`INSERT INTO leadgen.historical_customers
              (source_import_id,source_import_row_id,external_customer_id,source_system,company_name,
               normalized_company_name,country_code,market_code,customer_role,identity_resolution_status,
               source_identity_key,record_digest,latest_source_import_row_id)
              VALUES($1,$2,$3,'PHASE7_DATA_EXCHANGE',$4,$5,$6,$6,'INTERNAL_EXISTING_CUSTOMER','CONFIRMED',$7,$8,$2)
              RETURNING id`, [id,row.id,payload.external_customer_id,payload.company_name,
              normalizedCompanyName(payload.company_name),payload.country_code,
              sha256(`PHASE7_CUSTOMER|${payload.external_customer_id}`),row.source_hash]);
            historicalCustomerId = historical.rows[0].id;
            mutations += 1;
          }
          let order = await client.query(`SELECT id FROM leadgen.historical_orders
            WHERE source_system='PHASE7_DATA_EXCHANGE' AND external_order_id=$1
            ORDER BY source_version DESC LIMIT 1`, [payload.external_deal_or_order_id]);
          if (!order.rowCount) {
            const orderValue = payload.customer_sales_price != null && payload.quantity != null
              ? Number(payload.customer_sales_price) * Number(payload.quantity) : null;
            order = await client.query(`INSERT INTO leadgen.historical_orders
              (source_import_id,source_import_row_id,external_order_id,external_customer_id,source_system,
               order_date,sku,product_category,quantity,currency,incoterm,historical_customer_id,
               customer_resolution_status,order_status,unit_price,order_value,commercial_value_type,
               product_profile,source_identity_key,source_version,record_digest)
              VALUES($1,$2,$3,$4,'PHASE7_DATA_EXCHANGE',$5,$6,$7,$8,$9,$10,$11,'RESOLVED','CONFIRMED',$12,$13,$14,$15,$16,1,$17)
              RETURNING id`, [id,row.id,payload.external_deal_or_order_id,payload.external_customer_id,
              payload.order_date,payload.sku,payload.product_name,payload.quantity,
              payload.currency==='UNKNOWN'?null:payload.currency,payload.incoterm,historicalCustomerId,
              payload.customer_sales_price,orderValue,orderValue==null?'UNKNOWN':'CUSTOMER_SALES_REVENUE',
              payload.product_profile||'UNKNOWN',sha256(`PHASE7_ORDER|${payload.external_deal_or_order_id}`),row.source_hash]);
            mutations += 1;
          }
          let canonicalType = 'HISTORICAL_ORDER';
          let canonicalId = order.rows[0].id;
          if (item.import_type === 'CUSTOMER_DEAL_LINES') {
            const product = await client.query(`SELECT id FROM leadgen.product_master
              WHERE ($1::text IS NOT NULL AND lower(coalesce(source_product_id,''))=lower($1))
                 OR ($2::text IS NOT NULL AND lower(coalesce(sku,''))=lower($2))
              ORDER BY created_at LIMIT 1`, [payload.external_product_id,payload.sku]);
            const priceType = payload.customer_sales_price != null && payload.supplier_cost != null ? 'BOTH_EXPLICIT'
              : payload.customer_sales_price != null ? 'CUSTOMER_SALES_PRICE'
                : payload.supplier_cost != null ? 'SUPPLIER_PRICE' : 'UNKNOWN';
            const lineIdentity = sha256(`PHASE7_LINE|${payload.external_deal_or_order_id}|${payload.external_line_id || row.row_number}`);
            const line = await client.query(`INSERT INTO leadgen.historical_order_lines
              (historical_order_id,product_id,source_import_id,source_import_row_id,source_identity_key,
               line_number,external_line_id,sku,product_name,product_profile,product_category,quantity,
               customer_unit_price,customer_sales_currency,supplier_unit_price,supplier_currency,
               customer_sales_value,supplier_cost_value,price_type,currency,incoterm,record_digest)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$16,$17,$18,$19,$20,$21)
              ON CONFLICT(source_identity_key) DO NOTHING RETURNING id`, [order.rows[0].id,product.rows[0]?.id||null,
              id,row.id,lineIdentity,payload.line_number,payload.external_line_id,payload.sku,payload.product_name,
              payload.product_profile||'UNKNOWN',payload.product_name,payload.quantity,payload.customer_sales_price,
              payload.currency,payload.supplier_cost,
              payload.customer_sales_price!=null&&payload.quantity!=null?Number(payload.customer_sales_price)*Number(payload.quantity):null,
              payload.supplier_cost!=null&&payload.quantity!=null?Number(payload.supplier_cost)*Number(payload.quantity):null,
              priceType,payload.currency==='UNKNOWN'?null:payload.currency,payload.incoterm,row.source_hash]);
            if (!line.rowCount) {
              const priorLine = await client.query('SELECT id FROM leadgen.historical_order_lines WHERE source_identity_key=$1',[lineIdentity]);
              canonicalId=priorLine.rows[0].id;
              await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type='HISTORICAL_ORDER_LINE',
                canonical_entity_id=$2,row_status='DUPLICATE' WHERE id=$1`,[row.id,canonicalId]);
            } else {
              canonicalId=line.rows[0].id; mutations += 1;
              await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type='HISTORICAL_ORDER_LINE',
                canonical_entity_id=$2,row_status='COMMITTED' WHERE id=$1`,[row.id,canonicalId]);
            }
            canonicalType='HISTORICAL_ORDER_LINE';
          } else {
            await client.query(`UPDATE leadgen.reference_data_import_rows SET canonical_entity_type=$2,
              canonical_entity_id=$3,row_status='COMMITTED' WHERE id=$1`,[row.id,canonicalType,canonicalId]);
          }
          await client.query(`INSERT INTO leadgen.historical_customer_company_links
            (historical_customer_id,company_id,link_status,match_method,confidence,evidence,confirmed_by,confirmed_at)
            VALUES($1,$2,'CONFIRMED',$3,1,$4::jsonb,$5,now())
            ON CONFLICT(historical_customer_id,company_id) DO UPDATE SET link_status='CONFIRMED',match_method=excluded.match_method,
              confidence=1,evidence=excluded.evidence,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,updated_at=now()`,
          [historicalCustomerId,payload.crosswalk_company_id,payload.crosswalk_method||'CONTROLLED_IMPORT',
            JSON.stringify({import_id:id,import_row_id:row.id,external_customer_id:payload.external_customer_id}),actor]);
          await client.query(`UPDATE leadgen.contact_work_queue SET queue_status='CANCELLED',updated_at=now(),
            reason_codes=array_append(reason_codes,'CONFIRMED_EXISTING_CUSTOMER')
            WHERE company_id=$1 AND queue_status='ACTIVE'`,[payload.crosswalk_company_id]);
          affectedCompanies.add(payload.crosswalk_company_id);
          autoEvidenceCompanies.add(payload.crosswalk_company_id);
          continue;
        }
        const error = new Error(`Import row ${row.row_number} was not committed`);
        error.code='IMPORT_ROW_NOT_COMMITTED'; error.status=409; throw error;
      }
      const remaining = await client.query(`SELECT row_number FROM leadgen.reference_data_import_rows
        WHERE import_id=$1 AND row_status='ACCEPTED'`,[id]);
      if (remaining.rowCount) {
        const error = new Error('Accepted rows remain unprocessed'); error.code='IMPORT_ROWS_UNPROCESSED'; error.status=409; throw error;
      }
      if (affectedCompanies.size) {
        const effectVersion=sha256(`${id}|${item.dry_run_digest}|historical-customer-effect-v1`);
        for (const effectType of ['REBUILD_ICP_PROFILE','RECALCULATE_CUSTOMER_MATCH']) {
          await client.query(`INSERT INTO leadgen.data_import_effect_outbox
            (import_id,effect_type,effect_version,payload) VALUES($1,$2,$3,$4::jsonb)
            ON CONFLICT(import_id,effect_type,effect_version) DO NOTHING`,
          [id,effectType,effectVersion,JSON.stringify({import_id:id,company_ids:[...affectedCompanies],effect_version:effectVersion})]);
        }
      }
      const committed = await client.query(`UPDATE leadgen.reference_data_imports SET status='COMMITTED',committed_at=now()
        WHERE id=$1 RETURNING *`, [id]);
      return { import: mapImportStatus(committed.rows[0]), replay:false, mutations,
        affected_company_ids:[...new Set([...autoEvidenceCompanies,...affectedCompanies])] };
    });
  }

  async createControlledApplicationContext(input){
    const result=await this.pool.query(`INSERT INTO leadgen.controlled_application_contexts
      (context_label,recipient_hash,provider,provider_purpose,sender_identity,reply_to,max_messages,snapshot_hash,created_by)
      VALUES($1,$2,'SMTP',$3,$4,$5,$6,$7,$8)
      ON CONFLICT(recipient_hash,snapshot_hash) DO UPDATE SET updated_at=leadgen.controlled_application_contexts.updated_at
      RETURNING *`,[input.context_label,input.recipient_hash,input.provider_purpose,input.sender_identity,input.reply_to,
      input.max_messages,input.snapshot_hash,input.created_by]);
    return result.rows[0];
  }

  async getControlledApplicationContext(id){
    const context=(await this.pool.query(`SELECT c.*,
      EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions s WHERE s.recipient_hash=c.recipient_hash AND s.lifted_at IS NULL) suppressed,
      (SELECT count(*)::int FROM leadgen.controlled_application_messages m WHERE m.context_id=c.id AND m.send_status IN('QUEUED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')) reserved_messages
      FROM leadgen.controlled_application_contexts c WHERE c.id=$1`,[requiredUuid(id,'controlled_context_id')])).rows[0];
    if(!context)return null;
    const [approvals,drafts,messages,activities]=await Promise.all([
      this.pool.query(`SELECT id,context_id,draft_id,approval_stage,draft_version,binding_digest,decision,approver_identity,approver_role,reason,approved_at FROM leadgen.controlled_application_approvals WHERE context_id=$1 ORDER BY approved_at,id`,[id]),
      this.pool.query(`SELECT * FROM leadgen.controlled_application_drafts WHERE context_id=$1 ORDER BY version,id`,[id]),
      this.pool.query(`SELECT id,context_id,draft_id,provider,provider_purpose,idempotency_key,rfc_message_id,message_key_header,send_status,provider_message_id,reason_codes,sent_at,created_at,updated_at FROM leadgen.controlled_application_messages WHERE context_id=$1 ORDER BY created_at,id`,[id]),
      this.pool.query(`SELECT id,context_id,inbound_message_id,activity_type,idempotency_key,occurred_at,created_at FROM leadgen.controlled_application_activities WHERE context_id=$1 ORDER BY occurred_at,id`,[id])]);
    return{...context,approvals:approvals.rows,drafts:drafts.rows,messages:messages.rows,activities:activities.rows};
  }

  async listControlledApplicationContexts(limit=20){
    const result=await this.pool.query(`SELECT id,context_label,provider,provider_purpose,max_messages,context_status,snapshot_hash,created_by,created_at,updated_at,closed_at
      FROM leadgen.controlled_application_contexts ORDER BY created_at DESC,id DESC LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||20))]);
    return result.rows;
  }

  async approveControlledApplicationContext(id,input){
    return this.transaction(async client=>{
      const context=(await client.query(`SELECT * FROM leadgen.controlled_application_contexts WHERE id=$1 FOR UPDATE`,[requiredUuid(id,'controlled_context_id')])).rows[0];
      if(!context)throw notFound('Controlled application context not found','CONTROLLED_CONTEXT_NOT_FOUND');
      if(!['PENDING_MANAGEMENT_APPROVAL','MANAGEMENT_APPROVED'].includes(context.context_status)){const error=new Error('Controlled context is not awaiting management approval');error.code='CONTROLLED_CONTEXT_APPROVAL_FORBIDDEN';error.status=409;throw error;}
      const approval=(await client.query(`INSERT INTO leadgen.controlled_application_approvals
        (context_id,approval_stage,binding_digest,decision,approver_identity,approver_role,reason)
        VALUES($1,'MANAGEMENT',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
      [id,input.binding_digest,input.decision,input.approver_identity,input.approver_role,input.reason])).rows[0]
        ||(await client.query(`SELECT * FROM leadgen.controlled_application_approvals WHERE context_id=$1 AND approval_stage='MANAGEMENT' AND binding_digest=$2 AND decision=$3 ORDER BY approved_at DESC LIMIT 1`,[id,input.binding_digest,input.decision])).rows[0];
      const status=input.decision==='APPROVED'?'MANAGEMENT_APPROVED':'CLOSED';
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status=$2,updated_at=now(),closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE NULL END WHERE id=$1`,[id,status]);
      return approval;
    });
  }

  async createControlledApplicationDraft(id,input){
    return this.transaction(async client=>{
      const context=(await client.query(`SELECT * FROM leadgen.controlled_application_contexts WHERE id=$1 FOR UPDATE`,[requiredUuid(id,'controlled_context_id')])).rows[0];
      if(!context||!['MANAGEMENT_APPROVED','DRAFT_PENDING'].includes(context.context_status))throw notFound('Management-approved controlled context not found','CONTROLLED_CONTEXT_NOT_APPROVED');
      const version=Number((await client.query(`SELECT coalesce(max(version),0)+1 version FROM leadgen.controlled_application_drafts WHERE context_id=$1`,[id])).rows[0].version);
      const draft=(await client.query(`INSERT INTO leadgen.controlled_application_drafts(context_id,version,subject,body_text,content_hash,created_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(context_id,content_hash) DO UPDATE SET updated_at=leadgen.controlled_application_drafts.updated_at RETURNING *`,
      [id,version,input.subject,input.body_text,input.content_hash,input.created_by])).rows[0];
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status='DRAFT_PENDING',updated_at=now() WHERE id=$1`,[id]);
      return draft;
    });
  }

  async approveControlledApplicationDraft(contextId,draftId,input){
    return this.transaction(async client=>{
      const draft=(await client.query(`SELECT d.*,c.snapshot_hash,c.context_status FROM leadgen.controlled_application_drafts d JOIN leadgen.controlled_application_contexts c ON c.id=d.context_id WHERE d.id=$1 AND d.context_id=$2 FOR UPDATE OF d,c`,[requiredUuid(draftId,'controlled_draft_id'),requiredUuid(contextId,'controlled_context_id')])).rows[0];
      if(!draft||!['DRAFT_PENDING','DRAFT_APPROVED'].includes(draft.context_status))throw notFound('Controlled draft not found','CONTROLLED_DRAFT_NOT_FOUND');
      const approval=(await client.query(`INSERT INTO leadgen.controlled_application_approvals
        (context_id,draft_id,approval_stage,draft_version,binding_digest,decision,approver_identity,approver_role,reason)
        VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,
      [contextId,draftId,draft.version,input.binding_digest,input.decision,input.approver_identity,input.approver_role,input.reason])).rows[0]
        ||(await client.query(`SELECT * FROM leadgen.controlled_application_approvals WHERE context_id=$1 AND draft_id=$2 AND approval_stage='DRAFT' AND binding_digest=$3 AND decision=$4 ORDER BY approved_at DESC LIMIT 1`,[contextId,draftId,input.binding_digest,input.decision])).rows[0];
      await client.query(`UPDATE leadgen.controlled_application_drafts SET draft_status=$2,updated_at=now() WHERE id=$1`,[draftId,input.decision==='APPROVED'?'APPROVED':'REJECTED']);
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status=$2,updated_at=now(),closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE NULL END WHERE id=$1`,[contextId,input.decision==='APPROVED'?'DRAFT_APPROVED':'CLOSED']);
      return approval;
    });
  }

  async createControlledApplicationMessage(contextId,draftId,input){
    return this.transaction(async client=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('leadgen.controlled_application_send',0))`);
      const row=(await client.query(`SELECT c.*,d.version,d.subject,d.body_text,d.content_hash,d.draft_status,
        EXISTS(SELECT 1 FROM leadgen.controlled_application_approvals a WHERE a.context_id=c.id AND a.approval_stage='MANAGEMENT' AND a.decision='APPROVED' AND a.binding_digest=c.snapshot_hash) management_approved,
        EXISTS(SELECT 1 FROM leadgen.controlled_application_approvals a WHERE a.context_id=c.id AND a.draft_id=d.id AND a.approval_stage='DRAFT' AND a.draft_version=d.version AND a.decision='APPROVED' AND a.binding_digest=$3) draft_approved,
        EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions s WHERE s.recipient_hash=c.recipient_hash AND s.lifted_at IS NULL) suppressed,
        (SELECT count(*)::int FROM leadgen.controlled_application_messages m WHERE m.send_status IN('QUEUED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')) reserved_count
        FROM leadgen.controlled_application_contexts c JOIN leadgen.controlled_application_drafts d ON d.context_id=c.id
        WHERE c.id=$1 AND d.id=$2 FOR UPDATE OF c,d`,[requiredUuid(contextId,'controlled_context_id'),requiredUuid(draftId,'controlled_draft_id'),input.draft_binding_digest])).rows[0];
      if(!row)throw notFound('Controlled draft not found','CONTROLLED_DRAFT_NOT_FOUND');
      const reasons=[];if(row.context_status!=='DRAFT_APPROVED'||row.draft_status!=='APPROVED')reasons.push('CONTROLLED_DRAFT_NOT_APPROVED');
      if(!row.management_approved||!row.draft_approved)reasons.push('CONTROLLED_APPROVAL_BINDING_MISMATCH');
      if(row.suppressed)reasons.push('CONTROLLED_RECIPIENT_SUPPRESSED');
      if(Number(row.reserved_count)>=Number(row.max_messages))reasons.push('CONTROLLED_TEST_CAP_REACHED');
      const status=reasons.length?'BLOCKED':'QUEUED';
      const message=(await client.query(`INSERT INTO leadgen.controlled_application_messages
        (context_id,draft_id,provider,provider_purpose,idempotency_key,rfc_message_id,message_key_header,send_status,reason_codes)
        VALUES($1,$2,'SMTP',$3,$4,$5,$6,$7,$8::text[]) ON CONFLICT(context_id,draft_id) DO UPDATE SET updated_at=leadgen.controlled_application_messages.updated_at RETURNING *`,
      [contextId,draftId,row.provider_purpose,input.idempotency_key,input.rfc_message_id,input.message_key_header,status,reasons])).rows[0];
      if(!reasons.length)await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status='SEND_QUEUED',updated_at=now() WHERE id=$1`,[contextId]);
      return{message,reasons};
    });
  }

  async getControlledApplicationMessage(id){
    const result=await this.pool.query(`SELECT m.*,c.recipient_hash,c.sender_identity,c.reply_to,c.max_messages,c.context_status,c.snapshot_hash,d.subject,d.body_text,d.content_hash,d.version draft_version,
      EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions s WHERE s.recipient_hash=c.recipient_hash AND s.lifted_at IS NULL) suppressed
      FROM leadgen.controlled_application_messages m JOIN leadgen.controlled_application_contexts c ON c.id=m.context_id JOIN leadgen.controlled_application_drafts d ON d.id=m.draft_id WHERE m.id=$1`,[requiredUuid(id,'controlled_message_id')]);
    return result.rows[0]||null;
  }

  async reserveControlledApplicationAttempt(messageId){
    return this.transaction(async client=>{
      const message=(await client.query(`SELECT m.*,c.recipient_hash FROM leadgen.controlled_application_messages m JOIN leadgen.controlled_application_contexts c ON c.id=m.context_id WHERE m.id=$1 FOR UPDATE OF m,c`,[requiredUuid(messageId,'controlled_message_id')])).rows[0];
      if(!message)throw notFound('Controlled message not found','CONTROLLED_MESSAGE_NOT_FOUND');
      if(message.send_status==='PROVIDER_ACCEPTED')return{...message,idempotent_replay:true};
      const suppressed=(await client.query(`SELECT EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions s WHERE s.recipient_hash=$1 AND s.lifted_at IS NULL) blocked`,[message.recipient_hash])).rows[0]?.blocked===true;
      if(suppressed){await client.query(`UPDATE leadgen.controlled_application_messages SET send_status='CANCELLED',reason_codes=ARRAY['CONTROLLED_RECIPIENT_SUPPRESSED'],updated_at=now() WHERE id=$1`,[messageId]);return{...message,suppression_blocked:true};}
      if(message.send_status==='SENDING'){
        const existing=(await client.query(`SELECT * FROM leadgen.controlled_application_attempts WHERE message_id=$1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE`,[messageId])).rows[0];
        if(existing?.provider_call_started_at){await client.query(`UPDATE leadgen.controlled_application_messages SET send_status='AMBIGUOUS',reason_codes=ARRAY['CONTROLLED_SEND_MANUAL_HOLD'],updated_at=now() WHERE id=$1`,[messageId]);await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status='SEND_AMBIGUOUS',updated_at=now() WHERE id=$1`,[message.context_id]);return{...message,ambiguous_hold:true,attempt_id:existing.id};}
        return{...message,send_in_progress:true,attempt_id:existing?.id||null};
      }
      if(message.send_status!=='QUEUED')return{...message,blocked:true};
      const number=Number((await client.query(`SELECT coalesce(max(attempt_number),0)+1 number FROM leadgen.controlled_application_attempts WHERE message_id=$1`,[messageId])).rows[0].number);
      const attempt=(await client.query(`INSERT INTO leadgen.controlled_application_attempts(message_id,attempt_number,attempt_status) VALUES($1,$2,'STARTED') RETURNING *`,[messageId,number])).rows[0];
      await client.query(`UPDATE leadgen.controlled_application_messages SET send_status='SENDING',updated_at=now() WHERE id=$1`,[messageId]);
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status='SENDING',updated_at=now() WHERE id=$1`,[message.context_id]);
      return attempt;
    });
  }

  async markControlledApplicationProviderCallStarted(messageId,attemptId){
    return this.transaction(async client=>{
      const message=(await client.query(`SELECT m.*,c.recipient_hash FROM leadgen.controlled_application_messages m JOIN leadgen.controlled_application_contexts c ON c.id=m.context_id WHERE m.id=$1 FOR UPDATE OF m,c`,[requiredUuid(messageId,'controlled_message_id')])).rows[0];
      if(!message)return{blocked:true};
      const suppressed=(await client.query(`SELECT EXISTS(SELECT 1 FROM leadgen.controlled_application_suppressions s WHERE s.recipient_hash=$1 AND s.lifted_at IS NULL) blocked`,[message.recipient_hash])).rows[0]?.blocked===true;
      if(suppressed){await client.query(`UPDATE leadgen.controlled_application_messages SET send_status='CANCELLED',reason_codes=ARRAY['CONTROLLED_RECIPIENT_SUPPRESSED'],updated_at=now() WHERE id=$1`,[messageId]);await client.query(`UPDATE leadgen.controlled_application_attempts SET attempt_status='BLOCKED',response_code='CONTROLLED_RECIPIENT_SUPPRESSED',completed_at=now() WHERE id=$1 AND provider_call_started_at IS NULL`,[attemptId]);return{suppression_blocked:true};}
      const attempt=(await client.query(`UPDATE leadgen.controlled_application_attempts SET provider_call_started_at=coalesce(provider_call_started_at,now()) WHERE id=$1 AND message_id=$2 AND completed_at IS NULL RETURNING *`,[attemptId,messageId])).rows[0];
      return attempt||{blocked:true};
    });
  }

  async completeControlledApplicationAttempt(messageId,attemptId,result){
    return this.transaction(async client=>{
      const status=result.status==='PROVIDER_ACCEPTED'?'PROVIDER_ACCEPTED':result.status==='AMBIGUOUS'?'AMBIGUOUS':'FAILED';
      const attemptStatus=status==='PROVIDER_ACCEPTED'?'ACCEPTED':status;
      await client.query(`UPDATE leadgen.controlled_application_attempts SET attempt_status=$2,response_code=$3,completed_at=now() WHERE id=$1`,[attemptId,attemptStatus,result.code||null]);
      const message=(await client.query(`UPDATE leadgen.controlled_application_messages SET send_status=$2,provider_message_id=$3,sent_at=CASE WHEN $2='PROVIDER_ACCEPTED' THEN now() ELSE sent_at END,reason_codes=CASE WHEN $4::text IS NULL THEN reason_codes ELSE ARRAY[$4] END,updated_at=now() WHERE id=$1 RETURNING *`,[messageId,status,result.provider_message_id||null,result.code||null])).rows[0];
      const contextStatus=status==='PROVIDER_ACCEPTED'?'AWAITING_REPLY':status==='AMBIGUOUS'?'SEND_AMBIGUOUS':'FAILED';
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status=$2,updated_at=now() WHERE id=$1`,[message.context_id,contextStatus]);
      return message;
    });
  }

  async getControlledImapCheckpoint(mailboxHash,folder){
    return (await this.pool.query(`SELECT * FROM leadgen.controlled_application_imap_checkpoints WHERE mailbox_identity_hash=$1 AND folder_path=$2`,[mailboxHash,folder])).rows[0]||null;
  }

  async saveControlledImapCheckpoint(input){
    return (await this.pool.query(`INSERT INTO leadgen.controlled_application_imap_checkpoints(mailbox_identity_hash,folder_path,uidvalidity,last_processed_uid)
      VALUES($1,$2,$3,$4) ON CONFLICT(mailbox_identity_hash,folder_path) DO UPDATE SET uidvalidity=excluded.uidvalidity,last_processed_uid=excluded.last_processed_uid,updated_at=now() RETURNING *`,[input.mailbox_identity_hash,input.folder_path,input.uidvalidity,input.last_processed_uid])).rows[0];
  }

  async findControlledMessageByHeaders({messageKey,references=[]}){
    const result=await this.pool.query(`SELECT m.*,c.recipient_hash FROM leadgen.controlled_application_messages m JOIN leadgen.controlled_application_contexts c ON c.id=m.context_id
      WHERE ($1::text<>'' AND m.message_key_header=$1) OR m.rfc_message_id=ANY($2::text[])
        OR (m.reason_codes @> ARRAY['CONTROLLED_SENT_EXACT_CONTENT_MATCH']::text[] AND m.provider_message_id=ANY($2::text[]))
      ORDER BY m.created_at DESC LIMIT 1`,[String(messageKey||''),references]);
    return result.rows[0]||null;
  }

  async recordControlledInbound(input){
    const owner=(await this.pool.query(`SELECT recipient_hash FROM leadgen.controlled_application_contexts WHERE id=$1`,[requiredUuid(input.context_id,'controlled_context_id')])).rows[0];
    const dsn=input.classification_input?.dsn===true;
    if(!owner||(dsn?input.dsn_recipient_hash!==owner.recipient_hash:input.from_address_hash!==owner.recipient_hash))return{row:null,replay:false,rejected:true};
    const result=await this.pool.query(`INSERT INTO leadgen.controlled_application_inbound_messages
      (context_id,outbound_message_id,mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid,internet_message_id,from_address_hash,dsn_recipient_hash,subject_sanitized,body_text_sanitized,classification_input,received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) ON CONFLICT(mailbox_identity_hash,folder_path,imap_uidvalidity,imap_uid) DO NOTHING RETURNING *`,
    [input.context_id,input.outbound_message_id,input.mailbox_identity_hash,input.folder_path,input.imap_uidvalidity,input.imap_uid,input.internet_message_id,input.from_address_hash,input.dsn_recipient_hash,input.subject_sanitized,input.body_text_sanitized,JSON.stringify(input.classification_input||{}),input.received_at]);
    if(result.rowCount)return{row:result.rows[0],replay:false};
    return{row:(await this.pool.query(`SELECT * FROM leadgen.controlled_application_inbound_messages WHERE mailbox_identity_hash=$1 AND folder_path=$2 AND imap_uidvalidity=$3 AND imap_uid=$4`,[input.mailbox_identity_hash,input.folder_path,input.imap_uidvalidity,input.imap_uid])).rows[0],replay:true};
  }

  async applyControlledInbound(input){
    return this.transaction(async client=>{
      const inbound=(await client.query(`SELECT i.*,c.recipient_hash FROM leadgen.controlled_application_inbound_messages i JOIN leadgen.controlled_application_contexts c ON c.id=i.context_id WHERE i.id=$1 FOR UPDATE OF i,c`,[requiredUuid(input.inbound_message_id,'controlled_inbound_id')])).rows[0];
      if(!inbound)throw notFound('Controlled inbound message not found','CONTROLLED_INBOUND_NOT_FOUND');
      await client.query(`UPDATE leadgen.controlled_application_inbound_messages SET reply_category=$2,classification_revision=$3 WHERE id=$1`,[inbound.id,input.reply_category,input.classification_revision]);
      const activity=(await client.query(`INSERT INTO leadgen.controlled_application_activities(context_id,inbound_message_id,activity_type,idempotency_key,occurred_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,[inbound.context_id,inbound.id,input.activity_type,input.idempotency_key,inbound.received_at])).rows[0];
      const hardBounce=input.activity_type==='BOUNCE_DSN'&&String(inbound.classification_input?.dsn_details?.status||'').startsWith('5.');
      let suppression=null;if(input.activity_type==='OPT_OUT'||hardBounce)suppression=(await client.query(`INSERT INTO leadgen.controlled_application_suppressions(context_id,recipient_hash,suppression_type,source_inbound_message_id)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,[inbound.context_id,inbound.recipient_hash,input.activity_type==='OPT_OUT'?'OPT_OUT':'HARD_BOUNCE',inbound.id])).rows[0]||null;
      const status=input.activity_type==='OPT_OUT'?'OPTED_OUT':'REPLIED';
      await client.query(`UPDATE leadgen.controlled_application_contexts SET context_status=CASE
        WHEN context_status='OPTED_OUT' THEN context_status ELSE $2 END,updated_at=now() WHERE id=$1`,[inbound.context_id,status]);
      return{activity,suppression,replay:!activity};
    });
  }

  async createExportJob(job) {
    const result = await this.pool.query(`INSERT INTO leadgen.data_export_jobs
      (export_type,export_format,export_mode,schema_version,requester_identity,requester_role,
       requested_columns,applied_columns,filters,selected_entity_ids,export_status,request_digest,
       storage_provider,snapshot_at,download_token_hash,download_token_issued_at,
       download_token_expires_at,file_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::text[],$8::text[],$9::jsonb,$10::uuid[],'PROCESSING',$11,
        'LOCAL_EXPORT_DIRECTORY',$12,$13,$14,$15,$16) RETURNING *`, [job.exportType,job.format,job.mode,
      job.schemaVersion,job.requesterIdentity,job.requesterRole,job.requestedColumns,job.appliedColumns,
      JSON.stringify(job.filters),job.selectedEntityIds,job.requestDigest,job.snapshotAt,job.downloadTokenHash,
      job.downloadTokenIssuedAt,job.downloadTokenExpiresAt,job.fileExpiresAt]);
    return result.rows[0];
  }

  async finalizeExport(id, input) {
    const result = await this.pool.query(`UPDATE leadgen.data_export_jobs SET export_status='READY',
      storage_key=$2,row_count=$3,file_sha256=$4,internal_file_path=$5,completed_at=now()
      WHERE id=$1 RETURNING *`, [id,input.storage_key,input.row_count,input.file_sha256,input.internal_file_path]);
    return result.rows[0];
  }

  async failExport(id, code) {
    await this.pool.query(`UPDATE leadgen.data_export_jobs SET export_status='FAILED',error_code=$2,completed_at=now() WHERE id=$1`, [id,String(code||'EXPORT_FAILED').slice(0,100)]);
  }

  async getExport(id) {
    const result = await this.pool.query(`SELECT * FROM leadgen.data_export_jobs WHERE id=$1`, [requiredUuid(id,'export_id')]);
    return result.rows[0] || null;
  }

  async auditDownload(input) {
    await this.pool.query(`INSERT INTO leadgen.data_export_download_events
      (export_job_id,requester_identity,authorization_status,request_digest) VALUES($1,$2,$3,$4)`,
    [input.exportJobId,input.requesterIdentity,input.authorizationStatus,input.requestDigest]);
    if (input.authorizationStatus === 'AUTHORIZED') {
      await this.pool.query(`UPDATE leadgen.data_export_jobs SET last_downloaded_at=now() WHERE id=$1`, [input.exportJobId]);
    }
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export { cleanFilename, mapImportStatus, notFound, requiredUuid, randomUUID };
