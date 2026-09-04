import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildApprovalDigest,
  buildContentHash,
  buildOutboundIdempotencyKey,
  buildSalesTaskFromReply,
  classifyInboundReply,
  createInboundProvider,
  createOutboundProvider,
  deriveDeliveryState,
  digestCanonical,
  providerRetryDecision,
  sanitizeInboundText,
  validateOutreachDraft
} from '../outreach/index.js';
import {
  DataExchangeContractError,
  buildDownloadAuditEvent,
  buildImportErrorReport,
  buildTemplateWorkbook,
  buildXlsxExportBuffer,
  createExportJob,
  createImportDryRun,
  parseCsvUtf8,
  parseXlsxImportBuffer,
  projectExportRow,
  resolveExportRequest,
  serializeCsv,
  sha256Bytes,
  validateUploadMetadata
} from '../dataExchange/index.js';
import { validateReadOnlyManifest } from '../dataExchange/sharedFolderManifest.js';
import { Phase7Repository, cleanFilename, notFound, requiredUuid, sha256 } from './repository.js';

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function upper(value) { return String(value || '').trim().toUpperCase(); }
function text(value, maximum = 500) { return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maximum); }
function arrays(value, maximum = 100) { return [...new Set((Array.isArray(value) ? value : []).map(item => text(item, 160)).filter(Boolean))].slice(0, maximum); }
function exportBusinessList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => {
    if (item && typeof item === 'object') return text(item.canonical_name || item.category || item.normalized_category || item.scope_code || item.code, 160);
    return text(item, 160);
  }).filter(Boolean))].join('; ');
}
function digestBuffer(value) { return createHash('sha256').update(value).digest('hex'); }

function mapProviderEventType(value) {
  const type = upper(value);
  return ({
    SENT:'PROVIDER_ACCEPTED', BOUNCED:'HARD_BOUNCED', DELAYED:'DELIVERY_DELAYED',
    PROVIDER_ACCEPTED:'PROVIDER_ACCEPTED', SOFT_BOUNCED:'SOFT_BOUNCED', HARD_BOUNCED:'HARD_BOUNCED',
    COMPLAINED:'COMPLAINED', OPTED_OUT:'OPTED_OUT', DELIVERED:'DELIVERED', DELIVERY_DELAYED:'DELIVERY_DELAYED', FAILED:'FAILED',
    OPENED:'OPENED', CLICKED:'CLICKED', REPLIED:'REPLIED', QUEUED:'QUEUED', BLOCKED:'BLOCKED'
  })[type] || (['QUEUED','PROVIDER_ACCEPTED','DELIVERED','DELIVERY_DELAYED','SOFT_BOUNCED','HARD_BOUNCED','COMPLAINED','OPTED_OUT','OPENED','CLICKED','REPLIED','FAILED','BLOCKED'].includes(type)?type:'FAILED');
}

function mapOutboundState(eventType) {
  return ({ PROVIDER_ACCEPTED:'PROVIDER_ACCEPTED',DELIVERED:'DELIVERED',SOFT_BOUNCED:'SOFT_BOUNCED',
    HARD_BOUNCED:'HARD_BOUNCED',FAILED:'FAILED',BLOCKED:'BLOCKED' })[eventType] || null;
}

function mapReplyIntent(intent) {
  const normalized=upper(intent);
  return ['CATALOGUE','SAMPLE','QUOTATION','MEETING','DEFER','DECLINE','OPT_OUT','AUTO_REPLY','IRRELEVANT','REVIEW'].includes(normalized)?normalized:'REVIEW';
}

function responseDigest(result) {
  return digestCanonical({ status: result.status, code: result.code, provider_message_id: result.provider_message_id || null });
}

const CRM_OPERATION_FIELDS=Object.freeze({
  CREATE_LEAD:Object.freeze(['company_name','country_code','website_url','owner','source_reference']),
  UPDATE_ACTIVITY:Object.freeze(['activity_type','occurred_at','summary','owner','source_reference','external_crm_id']),
  CREATE_TASK:Object.freeze(['task_id','task_type','due_at','owner','summary','source']),
  UPDATE_OPPORTUNITY:Object.freeze(['stage','status','owner','value','currency','external_crm_id']),
  SUPPRESSION_NOTICE:Object.freeze(['suppression_type','reason','recorded_at','external_crm_id']),
});
const CRM_FORBIDDEN_FIELD=/(supplier_?cost|supplier_?price|raw_?payload|raw_?body|full_?body|body_?html|body_?text|provider_?payload|staging|unc|internal_?file|local_?path|source_?path|attachment_?content)/i;
const LOCAL_OR_UNC_PATH=/(?:\\\\|[a-z]:[\\/]|file:\/\/|\/(?:app|tmp|var|home)\/)/i;

export function validateCrmPayload(operation,payload){
  const normalized=upper(operation);const allowed=CRM_OPERATION_FIELDS[normalized];
  if(!allowed){const error=new Error('Unsupported CRM operation');error.code='CRM_OPERATION_INVALID';error.status=400;throw error;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)){const error=new Error('CRM payload must be an object');error.code='CRM_PAYLOAD_INVALID';error.status=400;throw error;}
  const unknown=Object.keys(payload).filter(key=>!allowed.includes(key)||CRM_FORBIDDEN_FIELD.test(key));
  if(unknown.length){const error=new Error('CRM payload contains fields outside the operation allowlist');error.code='CRM_PAYLOAD_FIELD_FORBIDDEN';error.status=400;error.details={fields:unknown};throw error;}
  const projected={};
  for(const key of allowed){
    if(payload[key]===undefined)continue;
    const value=payload[key];
    if(value&&typeof value==='object'){const error=new Error('Nested CRM payload values are not accepted');error.code='CRM_PAYLOAD_NESTED_FORBIDDEN';error.status=400;throw error;}
    const cleaned=typeof value==='string'?text(value,key==='summary'||key==='reason'?1000:500):value;
    if(typeof cleaned==='string'&&(LOCAL_OR_UNC_PATH.test(cleaned)||/\bstaging[\\/]/i.test(cleaned))){
      const error=new Error('CRM payload may not contain local, staging or shared-folder paths');error.code='CRM_PAYLOAD_PATH_FORBIDDEN';error.status=400;throw error;
    }
    projected[key]=cleaned;
  }
  return Object.freeze(projected);
}

function crmOutboxProjection(row,role){
  const base={id:row.id,operation:row.operation,sync_status:row.sync_status,attempt_count:row.attempt_count,
    next_attempt_at:row.next_attempt_at,created_at:row.created_at,updated_at:row.updated_at};
  if(!['MANAGEMENT','DATA_ADMIN'].includes(upper(role)))return base;
  let payload=null;let payload_status='AVAILABLE';
  try{payload=validateCrmPayload(row.operation,row.payload||{});}catch{payload_status='REDACTED_UNSAFE';}
  const lastErrorCode=row.last_error?String(row.last_error).split(':',1)[0].replace(/[^A-Z0-9_-]/gi,'_').slice(0,100):null;
  return{...base,company_id:row.company_id,task_id:row.task_id,payload,payload_status,last_error_code:lastErrorCode};
}

function canonicalSharedManifest(value){
  const manifest=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const mutations=manifest.sourceMutations&&typeof manifest.sourceMutations==='object'?manifest.sourceMutations:{};
  return Object.freeze({sourcePath:String(manifest.sourcePath||''),stagedPath:String(manifest.stagedPath||''),
    sourceSha256Before:String(manifest.sourceSha256Before||''),localSha256:String(manifest.localSha256||''),
    sourceSha256After:String(manifest.sourceSha256After||''),autoCommit:manifest.autoCommit===true,
    sourceMutations:Object.freeze({modified:Number(mutations.modified||0),deleted:Number(mutations.deleted||0),
      renamed:Number(mutations.renamed||0),moved:Number(mutations.moved||0),created:Number(mutations.created||0)})});
}

function safeExportJob(row) {
  if (!row) return null;
  const { internal_file_path: _internal, download_token_hash: _hash, ...safe } = row;
  return safe;
}

function exportJobModel(row) {
  return {
    id: row.id,
    exportType: row.export_type,
    format: row.export_format,
    mode: row.export_mode,
    schemaVersion: row.schema_version,
    requesterIdentity: row.requester_identity,
    requesterRole: row.requester_role,
    requestedColumns: row.requested_columns,
    appliedColumns: row.applied_columns,
    filters: row.filters,
    selectedEntityIds: row.selected_entity_ids,
    status: row.export_status,
    snapshotAt: new Date(row.snapshot_at).toISOString(),
    requestDigest: row.request_digest,
    downloadTokenHash: row.download_token_hash,
    downloadTokenIssuedAt: row.download_token_issued_at,
    downloadTokenExpiresAt: row.download_token_expires_at,
    fileExpiresAt: row.file_expires_at,
    internalFilePath: row.internal_file_path
  };
}

export class Phase7Service {
  constructor({ pool, queue = null, hunter = null, opportunityQuery = null, env = process.env, audit = () => {} } = {}) {
    this.repository = new Phase7Repository({ pool });
    this.pool = pool;
    this.queue = queue;
    this.hunter = hunter;
    this.opportunityQuery = opportunityQuery;
    this.env = env;
    this.audit = audit;
    this.exportDir = path.resolve(env.DATA_EXCHANGE_EXPORT_DIR || path.join(process.cwd(), 'runtime', 'phase7-exports'));
    this.importDir = path.resolve(env.DATA_EXCHANGE_STAGING_DIR || path.join(process.cwd(), 'runtime', 'phase7-import-staging'));
    this.outboundProvider = createOutboundProvider({
      provider: env.OUTBOUND_EMAIL_PROVIDER || 'NONE',
      apiKey: env.RESEND_API_KEY || '',
      useCase: env.RESEND_USE_CASE || 'DISABLED',
      endpoint: env.RESEND_API_ENDPOINT || 'https://api.resend.com/emails',
      timeoutMs: Number(env.OUTBOUND_EMAIL_TIMEOUT_MS || 10_000),
      enabled: env.GMAIL_API_ENABLED,
      inboundEnabled: env.GMAIL_INBOUND_SYNC_ENABLED,
      controlledTestMode: env.GMAIL_CONTROLLED_TEST_MODE,
      useCaseApproved: env.GMAIL_USE_CASE_APPROVED,
      clientId: env.GMAIL_OAUTH_CLIENT_ID || '',
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET || '',
      refreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN || '',
      senderEmail: env.GMAIL_SENDER_EMAIL || '',
      replyToEmail: env.GMAIL_REPLY_TO_EMAIL || '',
      unsubscribeEmail: env.GMAIL_UNSUBSCRIBE_EMAIL || '',
      controlledRecipientAllowlist: env.GMAIL_CONTROLLED_RECIPIENT_ALLOWLIST || '',
      messageIdDomain: env.GMAIL_MESSAGE_ID_DOMAIN || 'dpvinternational.com'
    });
    this.resendInbound = createInboundProvider({
      provider: 'RESEND', webhookSecret: env.RESEND_WEBHOOK_SECRET || '',
      toleranceSeconds: Number(env.EMAIL_WEBHOOK_TOLERANCE_SECONDS || 300)
    });
  }

  async getMarketingContext() { return this.repository.getMarketingContext(); }

  async createMarketingContext(body, user) {
    const content = body?.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content : {};
    const contextStatus = upper(body?.context_status || 'PENDING_REVIEW');
    if (!['DRAFT','PENDING_REVIEW'].includes(contextStatus)) {
      const error = new Error('New marketing context must be DRAFT or PENDING_REVIEW'); error.code='MARKETING_CONTEXT_STATUS_INVALID'; error.status=400; throw error;
    }
    const version = text(body?.version, 80);
    const rulesetVersion = text(body?.ruleset_version, 80);
    if (!version || !rulesetVersion) {
      const error = new Error('version and ruleset_version are required'); error.code='MARKETING_CONTEXT_INVALID'; error.status=400; throw error;
    }
    return this.repository.createMarketingContext({
      version, context_status: contextStatus,
      allowed_markets: arrays(body.allowed_markets, 30).map(upper),
      allowed_product_profiles: arrays(body.allowed_product_profiles, 10).map(upper),
      target_languages: arrays(body.target_languages, 10).map(value => value.toLowerCase()),
      ruleset_version: rulesetVersion, content, content_hash: digestCanonical(content),
      created_by: user.identity, submitted_at: contextStatus === 'PENDING_REVIEW' ? new Date() : null,
      expires_at: body.expires_at || null, supersedes_version_id: body.supersedes_version_id || null
    });
  }

  async approveMarketingContext(id, body, user) {
    const current = await this.repository.getMarketingContext();
    if (!current || current.id !== id) {
      const found = await this.pool.query('SELECT * FROM leadgen.marketing_context_versions WHERE id=$1', [requiredUuid(id,'marketing_context_id')]);
      if (!found.rowCount) throw notFound('Marketing context not found','MARKETING_CONTEXT_NOT_FOUND');
      current && void current;
      return this.#approveContextRow(found.rows[0], body, user);
    }
    return this.#approveContextRow(current, body, user);
  }

  async #approveContextRow(row, body, user) {
    const decision = upper(body?.decision || 'APPROVED');
    if (!['APPROVED','REJECTED','REVOKED'].includes(decision)) {
      const error=new Error('Invalid marketing context decision'); error.code='MARKETING_CONTEXT_DECISION_INVALID'; error.status=400; throw error;
    }
    const approvalDigest = digestCanonical({ marketing_context_version_id:row.id, content_hash:row.content_hash,
      decision, approver_identity:user.identity, approver_role:user.role });
    return this.repository.approveMarketingContext({ id:row.id,contentHash:row.content_hash,approvalDigest,
      decision,actor:user.identity,role:user.role,reason:text(body?.reason,1000)||null });
  }

  async opportunityDecisionHistory(reference) { return this.repository.opportunityDecisionHistory(reference); }
  async listContactQueue(query = {}) { return this.repository.listContactQueue({limit:query.limit}); }
  async listWorkspaceContactQueue(query = {}) {
    const rows=await this.repository.listContactQueue({limit:query.limit});
    return rows.map(row=>({opportunity_id:row.opportunity_id,company_id:row.company_id,queue_status:row.queue_status,
      company_name:row.company_name,country_code:row.country_code,website_url:row.website_url,
      matched_categories:row.matched_categories||[],opportunity_status:row.opportunity_status,
      named_buyers:row.named_buyers||[],contact_routes:row.contact_routes||[],named_buyer_ready:row.named_buyer_ready,
      official_email_route:row.official_email_route,official_phone_route:row.official_phone_route,
      official_whatsapp_route:row.official_whatsapp_route,official_form_route:row.official_form_route}));
  }
  async listManualOfficialRoutes(query = {}) {
    return this.repository.listManualOfficialRoutes({status:query.status,limit:query.limit});
  }
  async reconcileManualOfficialRoutes(user) {
    void user;
    const error=new Error('Official route manual reconciliation is retired');error.code='RETIRED_POLICY';error.status=410;throw error;
  }
  async recordManualOfficialRouteAction(id,body,user){
    const route=await this.repository.recordManualOfficialRouteAction(id,{
      status:upper(body?.status),ownerIdentity:text(body?.owner_identity,160)||null,
      outcome:text(body?.outcome,2000)||null,actor:user.identity,requestId:text(body?.request_id,120)||null
    });
    return{route,provider_calls:0,automatic_submissions:0,messages_sent:0,management_approvals_created:0};
  }

  async manageOpportunity(reference, action, body, user) {
    const mapping = {
      MANAGEMENT_APPROVED:'MANAGEMENT_APPROVED', HOLD:'HOLD',
      REQUEST_EVIDENCE:'NOT_REVIEWED', REOPEN:'NOT_REVIEWED'
    };
    if (!mapping[action]) { const error=new Error('Unsupported opportunity action');error.code='OPPORTUNITY_ACTION_INVALID';error.status=400;throw error; }
    if (!['MANAGEMENT','MANAGEMENT_APPROVER'].includes(user.role)) { const error=new Error('Opportunity management role required');error.code='MANAGEMENT_ROLE_FORBIDDEN';error.status=403;throw error; }
    const reason=text(body?.reason,1000)||null;
    const current=await this.repository.resolveOpportunity(reference);
    if(!current)throw notFound('Opportunity decision not found','OPPORTUNITY_DECISION_NOT_FOUND');
    const idempotencyKey=digestCanonical({decision_snapshot_id:current.id,event_type:action,actor:user.identity,
      reason,request_id:text(body?.request_id,120)||null});
    const result=await this.repository.recordOpportunityManagement(reference,{event_type:action,
      management_contact_status:mapping[action],actor:user.identity,role:user.role,reason,idempotency_key:idempotencyKey,
      owner_identity:text(body?.owner_identity,160)||null,reason_codes:arrays(body?.reason_codes),
      expected_decision_snapshot_id:current.id,expected_assessment_revision:current.assessment_revision,
      verification_ttl_days:Number(this.env.CONTACT_VERIFICATION_TTL_DAYS || this.env.OUTREACH_VERIFICATION_TTL_DAYS || 30)});
    return {...result,recipients_created:Number(result.recipients_created||0),provider_calls:0,messages_approved:0};
  }

  async enqueueContactVerification(id, user) {
    const contact = await this.repository.findContact(id);
    if (!contact) throw notFound('Contact not found','CONTACT_NOT_FOUND');
    const queueJobId = await this.queue.enqueue('verify-outreach-contact', { contact_id:id, actor:user.identity },
      { singletonKey:`phase7:verify-contact:${id}` });
    return { status:'QUEUED',contact_id:id,queue_job_id:queueJobId };
  }

  async verifyContactWork({ contact_id }) {
    const contact = await this.repository.findContact(contact_id);
    if (!contact) throw notFound('Contact not found','CONTACT_NOT_FOUND');
    const email = contact.contact_value_normalized || contact.business_email || contact.normalized_value;
    if (!email || !String(email).includes('@')) return { status:'BLOCKED',reason_code:'BUSINESS_EMAIL_REQUIRED',network_calls:0 };
    if (!this.hunter?.capabilities?.enabled || !contact.research_job_id) {
      return { status:'BLOCKED',reason_code:'HUNTER_DISABLED_OR_RESEARCH_JOB_REQUIRED',network_calls:0 };
    }
    const provider = await this.hunter.verifyEmail({ researchJobId:contact.research_job_id,companyId:contact.company_id,email,
      persistResults:async(results,{capturedAt})=>{
        const result=results?.[0];
        if(!result)return{referenceIds:[]};
        const updated=await this.repository.updateContactVerification(contact,{
          verification_status:result.verification_status,verification_score:result.verification_score,
          provider:'HUNTER',captured_at:capturedAt||new Date()
        });
        return{referenceIds:updated?.id?[updated.id]:[]};
      },
      loadPersistedResults:async({referenceIds})=>{
        if(!referenceIds.includes(String(contact.id)))return[];
        const restored=await this.repository.findContact(contact.id);
        if(!restored)return[];
        const verificationStatus=restored.contact_record_type==='DECISION_MAKER_CONTACT'
          ? restored.verification_status
          : restored.email_verification_status==='valid'?'VALID'
            : restored.email_verification_status==='invalid'?'INVALID':'UNKNOWN';
        return[{email,verification_status:verificationStatus,
          verification_score:restored.verification_score===null?null:Number(restored.verification_score)}];
      }
    });
    if(provider.status==='REPLAY_LOOKUP_REQUIRED')return{status:'RETRYABLE_ERROR',
      reason_code:'HUNTER_BUSINESS_RESULT_LOOKUP_REQUIRED',network_calls:0,credits:provider.credits};
    const result = provider.results?.[0] || { verification_status:provider.status === 'TEMPORARY_ERROR' ? 'TEMPORARY_ERROR' : 'UNKNOWN',verification_score:null };
    const updated = await this.repository.updateContactVerification(contact, {
      verification_status:result.verification_status, verification_score:result.verification_score,
      provider:'HUNTER',captured_at:provider.captured_at || new Date()
    });
    const capturedAt=provider.captured_at||new Date();
    if(contact.contact_record_type==='DECISION_MAKER_CONTACT'){
      const inputDigest=sha256(String(email).trim().toLowerCase());
      const usageEventId=provider.usage_event?.id||null;
      if(usageEventId)await this.pool.query(`INSERT INTO leadgen.contact_verification_events
        (research_job_id,company_id,decision_maker_contact_id,provider_usage_event_id,provider,endpoint,
         verification_status,verification_score,verified_at,captured_at,expires_at,recipient_hash,input_digest,idempotency_key)
        VALUES ($1,$2,$3,$4,'HUNTER','email-verifier',$5,$6,$7,$7,$7+($8::int*interval '1 day'),$9,$9,$10)
        ON CONFLICT (idempotency_key) DO NOTHING`,[
        contact.research_job_id,contact.company_id,contact.id,usageEventId,result.verification_status,
        result.verification_score,capturedAt,Number(this.env.CONTACT_VERIFICATION_TTL_DAYS||30),inputDigest,
        sha256(`${contact.research_job_id}|${contact.id}|${usageEventId}|${result.verification_status}`)
      ]);
    }
    if(result.verification_status==='INVALID'){
      await this.pool.query(`INSERT INTO leadgen.contact_suppressions
        (company_id,contact_id,decision_maker_contact_id,suppression_type,reason,recorded_by)
        VALUES ($1,$2,$3,'INVALID_EMAIL','Email verification returned INVALID','CONTACT_VERIFICATION')
        ON CONFLICT DO NOTHING`,[contact.company_id,contact.contact_record_type==='CONTACT'?contact.id:null,
        contact.contact_record_type==='DECISION_MAKER_CONTACT'?contact.id:null]);
    }
    const recipients = result.verification_status === 'VALID'
      ? await this.repository.createEligibleRecipients({ companyId:contact.company_id, contactId:contact.id,
        verificationTtlDays:Number(this.env.CONTACT_VERIFICATION_TTL_DAYS || this.env.OUTREACH_VERIFICATION_TTL_DAYS || 30) })
      : [];
    return { status:provider.status,contact:updated,recipients_created:recipients.length,
      credits:provider.credits,network_calls:provider.status === 'SKIPPED' ? 0 : 1 };
  }

  async createDraft(body, user) {
    const products = (Array.isArray(body?.products) ? body.products : []).slice(0,20).map((item,index)=>({
      product_master_id:requiredUuid(item.product_master_id,'product_master_id'),approved_claim_ids:arrays(item.approved_claim_ids),display_order:index+1
    }));
    const evidence = (Array.isArray(body?.evidence) ? body.evidence : []).slice(0,40).map(item => ({
      prospect_category_observation_id:item?.prospect_category_observation_id ? requiredUuid(item.prospect_category_observation_id,'prospect_category_observation_id') : null,
      decision_maker_source_id:item?.decision_maker_source_id ? requiredUuid(item.decision_maker_source_id,'decision_maker_source_id') : null,
      company_source_id:item?.company_source_id ? requiredUuid(item.company_source_id,'company_source_id') : null
    }));
    const evidenceIds=evidence.flatMap(item=>[item.prospect_category_observation_id,item.decision_maker_source_id,item.company_source_id]).filter(Boolean);
    const productIds=products.map(item=>item.product_master_id);
    const output = {
      language:text(body?.language,12).toLowerCase(),subject:text(body?.subject,240),body_text:text(body?.body_text,12000),
      followups:Array.isArray(body?.followups)?body.followups:[],personalization_reason:text(body?.personalization_reason,1000),
      used_evidence_ids:arrays(body?.used_evidence_ids),recommended_product_ids:arrays(body?.recommended_product_ids),
      approved_claim_ids:arrays(body?.approved_claim_ids),template_version:text(body?.template_version,80)||'phase7-manual-v1',
      skill_versions:body?.skill_versions && typeof body.skill_versions==='object'?body.skill_versions:{},
      generation_version:text(body?.generation_version,80)||'dpv-b2b-outreach-v1',input_digest:text(body?.input_digest,64),
      policy_warnings:arrays(body?.policy_warnings)
    };
    const contextResult = await this.pool.query(`SELECT v.* FROM leadgen.marketing_context_versions v
      WHERE v.version=$1 AND (SELECT a.decision FROM leadgen.marketing_context_approvals a
        WHERE a.marketing_context_version_id=v.id AND a.content_hash=v.content_hash
        ORDER BY a.approved_at DESC,a.id DESC LIMIT 1)='APPROVED'`,
    [text(body?.marketing_context_version,80)]);
    if (!contextResult.rowCount) throw notFound('Approved marketing context not found','MARKETING_CONTEXT_NOT_APPROVED');
    const context = contextResult.rows[0];
    const claimDefinitions = Array.isArray(context.content?.approved_claims) ? context.content.approved_claims : [];
    const validation = validateOutreachDraft(output, {
      target_language:output.language,input_digest:output.input_digest,
      available_evidence_ids:evidenceIds,available_product_ids:productIds,
      approved_claims:claimDefinitions,message_policy:context.content?.message_policy || {}
    });
    return this.repository.createDraft({
      eligibility_snapshot_id:requiredUuid(body?.eligibility_snapshot_id,'eligibility_snapshot_id'),
      recipient_id:requiredUuid(body?.recipient_id,'recipient_id'),supersedes_draft_id:null,version:1,
      ...validation.draft,draft_status:validation.draft_status,content_hash:validation.content_hash,
      marketing_context_version:context.version,policy_warnings:[...validation.draft.policy_warnings,...validation.reason_codes],
      created_by:user.identity,products,evidence,
      verification_ttl_days:Math.max(1,Number(this.env.OUTREACH_VERIFICATION_TTL_DAYS||30))
    });
  }

  async reviseDraft(id, body, user) {
    const current = await this.repository.getDraft(id);
    if (!current) throw notFound('Draft not found','OUTREACH_DRAFT_NOT_FOUND');
    const contract = await this.repository.getDraftValidationContract(id);
    const output = { ...current,...body,input_digest:current.input_digest,language:body.language || current.language,
      subject:body.subject ?? current.subject,body_text:body.body_text ?? current.body_text,
      followups:body.followups ?? current.followups,template_version:body.template_version || current.template_version,
      used_evidence_ids:body.used_evidence_ids ?? contract?.authoritative_evidence_ids ?? [],
      recommended_product_ids:body.recommended_product_ids ?? contract?.authoritative_product_ids ?? [],
      approved_claim_ids:body.approved_claim_ids ?? contract?.authoritative_claim_ids ?? [] };
    const claimDefinitions=Array.isArray(contract?.marketing_context_content?.approved_claims)?contract.marketing_context_content.approved_claims:[];
    const validation = validateOutreachDraft(output, { target_language:output.language,input_digest:current.input_digest,
      available_evidence_ids:contract?.authoritative_evidence_ids || [],available_product_ids:contract?.authoritative_product_ids || [],
      approved_claims:claimDefinitions,message_policy:contract?.marketing_context_content?.message_policy || {} });
    return this.repository.reviseDraft(id,{...validation.draft,draft_status:validation.draft_status,
      content_hash:validation.content_hash,policy_warnings:[...validation.draft.policy_warnings,...validation.reason_codes],created_by:user.identity,
      verification_ttl_days:Math.max(1,Number(this.env.OUTREACH_VERIFICATION_TTL_DAYS||30))});
  }

  async #validateStoredDraft(id) {
    const draft=await this.repository.getDraftValidationContract(id);
    if(!draft)throw notFound('Draft not found','OUTREACH_DRAFT_NOT_FOUND');
    const claims=Array.isArray(draft.marketing_context_content?.approved_claims)
      ? draft.marketing_context_content.approved_claims.filter(claim =>
        (!Array.isArray(claim.allowed_markets)||claim.allowed_markets.includes(draft.country_code))
        &&(!Array.isArray(claim.allowed_product_profiles)||claim.allowed_product_profiles.includes(draft.product_profile))
        &&(!claim.expires_at||new Date(claim.expires_at)>new Date())) : [];
    const validation=validateOutreachDraft({
      ...draft,input_digest:draft.input_digest,
      used_evidence_ids:draft.authoritative_evidence_ids,
      recommended_product_ids:draft.authoritative_product_ids,
      approved_claim_ids:draft.authoritative_claim_ids
    },{
      target_language:draft.language,input_digest:draft.eligibility_input_digest,
      available_evidence_ids:draft.authoritative_evidence_ids,available_product_ids:draft.authoritative_product_ids,
      approved_claims:claims,company_id:draft.company_id,product_profile:draft.product_profile,
      decision_maker_contact_id:draft.decision_maker_contact_id,
      eligibility_snapshot:{company_id:draft.eligibility_company_id,product_profile:draft.product_profile,
        decision_maker_contact_id:draft.decision_maker_contact_id},
      message_policy:draft.marketing_context_content?.message_policy||{}
    });
    if(!draft.reference_integrity_valid
      ||draft.current_opportunity_status!=='MANAGEMENT_APPROVED'
      ||!draft.current_contact_work_queue_id||draft.current_queue_status!=='ACTIVE'
      ||draft.current_eligibility_matches_opportunity!==true||draft.is_latest_eligibility_snapshot!==true
      ||draft.current_eligibility_status!=='ELIGIBLE'
      ||draft.current_relationship_status!=='NEW_PROSPECT'
      ||new Date(draft.current_eligibility_expires_at)<=new Date()
      ||draft.current_recipient_verification_status!=='VALID'
      ||draft.current_recipient_lifecycle_status!=='ACTIVE'
      ||!draft.current_recipient_verified_at
      ||Date.now()-new Date(draft.current_recipient_verified_at).getTime()>Math.max(1,Number(this.env.OUTREACH_VERIFICATION_TTL_DAYS||30))*86_400_000
      ||draft.current_company_verification_status!=='VERIFIED'||draft.current_company_lifecycle_status!=='ACTIVE'
      ||draft.current_company_suppressed===true||draft.current_contact_suppressed===true
      ||draft.marketing_context_current_decision!=='APPROVED'
      ||(draft.marketing_context_allowed_markets?.length&&!draft.marketing_context_allowed_markets.includes(draft.country_code))
      ||(draft.marketing_context_allowed_profiles?.length&&!draft.marketing_context_allowed_profiles.includes(draft.product_profile))
      ||(draft.marketing_context_target_languages?.length&&!draft.marketing_context_target_languages.includes(draft.language))
      ||(draft.marketing_context_expires_at&&new Date(draft.marketing_context_expires_at)<=new Date())) {
      validation.valid=false;
      validation.reason_codes=[...new Set([...validation.reason_codes,'DRAFT_DATABASE_ALLOWLIST_MISMATCH'])];
      validation.draft_status='INVALID_DRAFT';
    }
    return {draft,validation};
  }

  async submitDraft(id) {
    const {draft,validation}=await this.#validateStoredDraft(id);
    if(['INVALID_DRAFT','NEEDS_CHANGES'].includes(draft.draft_status)||!validation.valid||validation.content_hash!==draft.content_hash){
      if(!['INVALID_DRAFT','NEEDS_CHANGES'].includes(draft.draft_status))await this.repository.setDraftStatus(id,[draft.draft_status],'INVALID_DRAFT');
      const error=new Error('Draft must pass current deterministic database validation before submission');
      error.code='DRAFT_SUBMIT_VALIDATION_FAILED';error.status=409;error.details=validation.reason_codes;throw error;
    }
    return this.repository.submitDraft(id,{contentHash:draft.content_hash,
      verificationTtlDays:Math.max(1,Number(this.env.OUTREACH_VERIFICATION_TTL_DAYS||30))});
  }
  async rejectDraft(id, body) { return this.repository.setDraftStatus(id,['PENDING_REVIEW','APPROVED'],'REJECTED'); }
  async supersedeDraft(id) { return this.repository.setDraftStatus(id,['DRAFT','INVALID_DRAFT','NEEDS_CHANGES','PENDING_REVIEW','APPROVED'],'SUPERSEDED'); }

  async approveDraft(id, body, user) {
    const checked=await this.#validateStoredDraft(id);const draft=checked.draft;
    if (!['PENDING_REVIEW','APPROVED'].includes(draft.draft_status)) {
      const error=new Error('Draft must be pending review');error.code='DRAFT_APPROVAL_FORBIDDEN';error.status=409;throw error;
    }
    if (!checked.validation.valid||checked.validation.content_hash!==draft.content_hash||buildContentHash(draft) !== draft.content_hash) {
      const error=new Error('Draft content changed after validation');error.code='DRAFT_CONTENT_HASH_MISMATCH';error.status=409;throw error;
    }
    const fromIdentity=text(body?.from_identity,320);
    const replyTo=text(body?.reply_to,320).toLowerCase();
    const claims=draft.authoritative_claim_ids||[];
    const evidenceSnapshotHash=digestCanonical({input_digest:draft.input_digest,
      evidence_ids:draft.authoritative_evidence_ids,product_ids:draft.authoritative_product_ids,
      approved_claim_ids:draft.authoritative_claim_ids});
    const digest=buildApprovalDigest({draft_id:draft.id,draft_version:draft.version,...draft,
      recipient_id:draft.recipient_id,normalized_email:draft.normalized_recipient,company_id:draft.company_id,
      product_profile:draft.product_profile,from_identity:fromIdentity,reply_to:replyTo,channel:'EMAIL',
      approved_claim_ids:claims,evidence_snapshot_hash:evidenceSnapshotHash});
    return this.repository.createDraftApproval({draft_id:id,approval_digest:digest.approval_digest,
      evidence_snapshot_hash:evidenceSnapshotHash,from_identity:fromIdentity,reply_to:replyTo,decision:'APPROVED',
      actor:user.identity,role:user.role,reason:text(body?.reason,1000)||null,
      verification_ttl_days:Math.max(1,Number(this.env.OUTREACH_VERIFICATION_TTL_DAYS||30))});
  }

  async rejectDraftApproval(id, body, user) {
    const draft=await this.repository.getDraft(id);if(!draft)throw notFound('Draft not found','OUTREACH_DRAFT_NOT_FOUND');
    const fromIdentity=text(body?.from_identity||'rejected@invalid.local',320);
    const replyTo=text(body?.reply_to||'rejected@invalid.local',320);
    const digest=buildApprovalDigest({draft_id:draft.id,draft_version:draft.version,...draft,recipient_id:draft.recipient_id,
      normalized_email:draft.normalized_recipient,company_id:draft.company_id,product_profile:draft.product_profile,
      from_identity:fromIdentity,reply_to:replyTo,channel:'EMAIL',evidence_snapshot_hash:draft.input_digest});
    return this.repository.createDraftApproval({draft_id:id,approval_digest:digest.approval_digest,
      evidence_snapshot_hash:draft.input_digest,from_identity:fromIdentity,reply_to:replyTo,decision:'REJECTED',
      actor:user.identity,role:user.role,reason:text(body?.reason,1000)||null});
  }

  async currentOutboundGate(approval, purpose) {
    const reasons=[];const provider=upper(this.env.OUTBOUND_EMAIL_PROVIDER||'NONE');
    if (!bool(this.env.OUTREACH_ENABLED,false)) reasons.push('OUTREACH_DISABLED');
    if (!bool(this.env.LIVE_PROSPECT_SEND_APPROVED,false)) reasons.push('LIVE_PROSPECT_SEND_NOT_APPROVED');
    if (approval.approval_decision && approval.approval_decision!=='APPROVED') reasons.push('EXACT_VERSION_APPROVAL_REQUIRED');
    if (approval.draft_status!=='APPROVED') reasons.push('EXACT_VERSION_APPROVAL_REQUIRED');
    if (approval.company_verification_status!=='VERIFIED') reasons.push('COMPANY_NOT_VERIFIED');
    if (approval.company_lifecycle_status!=='ACTIVE') reasons.push('COMPANY_NOT_ACTIVE');
    if (approval.eligibility_status!=='ELIGIBLE'||new Date(approval.eligibility_expires_at)<=new Date()) reasons.push('ELIGIBILITY_EXPIRED_OR_BLOCKED');
    if (approval.recipient_lifecycle_status!=='ACTIVE'||approval.recipient_verification_status!=='VALID') reasons.push('RECIPIENT_NOT_SEND_READY');
    const verifiedAt=approval.verified_at?new Date(approval.verified_at):null;
    const ttlDays=Math.max(1,Number(this.env.CONTACT_VERIFICATION_TTL_DAYS||this.env.OUTREACH_VERIFICATION_TTL_DAYS||30));
    if(!verifiedAt||Number.isNaN(verifiedAt.getTime())||Date.now()-verifiedAt.getTime()>ttlDays*86_400_000)reasons.push('CONTACT_VERIFICATION_EXPIRED');
    if(approval.company_suppressed)reasons.push('COMPANY_SUPPRESSED');
    if(approval.contact_suppressed)reasons.push('CONTACT_SUPPRESSED');
    if(approval.confirmed_existing_customer)reasons.push('EXISTING_CUSTOMER');
    if(approval.current_contact_queue_active!==true)reasons.push('CURRENT_CONTACT_QUEUE_REQUIRED');
    if(approval.display_opportunity_status!=='MANAGEMENT_APPROVED')reasons.push('CURRENT_MANAGEMENT_APPROVAL_REQUIRED');
    if(approval.current_buyer_result_id!==approval.buyer_business_model_result_id
      ||approval.current_category_result_id!==approval.category_procurement_match_result_id
      ||String(approval.current_product_result_id||'')!==String(approval.product_opportunity_result_id||'')
      ||approval.current_cooperation_result_id!==approval.cooperation_feasibility_result_id)reasons.push('ELIGIBILITY_FACTS_STALE');
    if(approval.decision_maker_verification_status!=='VERIFIED'||approval.decision_maker_lifecycle_status!=='ACTIVE')reasons.push('VERIFIED_BUYER_ROUTE_REQUIRED');
    try{
      const claims=(approval.draft_product_claim_sets||[]).flatMap(value=>Array.isArray(value)?value:[]);
      const exact=buildApprovalDigest({draft_id:approval.draft_id,draft_version:approval.draft_version||approval.version,
        language:approval.language,subject:approval.subject,body_text:approval.body_text,followups:approval.followups,
        template_version:approval.template_version,content_hash:approval.content_hash,recipient_id:approval.recipient_id,
        normalized_email:approval.normalized_recipient,company_id:approval.company_id,product_profile:approval.product_profile,
        from_identity:approval.from_identity,reply_to:approval.reply_to,channel:approval.channel||'EMAIL',
        approved_claim_ids:claims,evidence_snapshot_hash:approval.evidence_snapshot_hash});
      if(exact.approval_digest!==approval.approval_digest)reasons.push('APPROVAL_DIGEST_MISMATCH');
    }catch{reasons.push('APPROVAL_DIGEST_MISMATCH');}
    const providerPurpose=this.outboundProvider.validatePurpose({purpose,consent_status:approval.consent_status,
      to:approval.normalized_recipient,normalized_recipient:approval.normalized_recipient});
    if(!providerPurpose.allowed)reasons.push(providerPurpose.code);
    const rateFacts=approval.sent_today===undefined?await this.#rateFacts(approval.company_id):approval;
    const minuteCap=Math.max(0,Number(this.env.OUTREACH_MAX_SENDS_PER_MINUTE||0));
    const dayCap=Math.max(0,Number(this.env.OUTREACH_MAX_SENDS_PER_DAY||0));
    const companyCap=Math.max(0,Number(this.env.OUTREACH_MAX_SENDS_PER_COMPANY_30D||0));
    if(!minuteCap||!dayCap||!companyCap)reasons.push('SEND_RATE_CAP_NOT_CONFIGURED');
    else if(Number(rateFacts.sent_last_minute)>=minuteCap||Number(rateFacts.sent_today)>=dayCap||Number(rateFacts.company_sent_30d)>=companyCap)reasons.push('SEND_RATE_CAP_BLOCKED');
    return {provider,purpose,reasons:[...new Set(reasons)]};
  }

  async #rateFacts(companyId){const result=await this.pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=now()-interval '1 minute') sent_last_minute,
    (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=date_trunc('day',now())) sent_today,
    (SELECT count(*)::int FROM leadgen.outbound_messages x WHERE x.company_id=$1 AND x.send_status IN('PROVIDER_ACCEPTED','DELIVERED') AND x.sent_at>=now()-interval '30 days') company_sent_30d`,[companyId]);return result.rows[0];}

  async enqueueMessage(id, body) {
    const approval=await this.repository.getApprovalForEnqueue(id);
    if(!approval)throw notFound('Approved exact draft not found','OUTREACH_APPROVAL_NOT_FOUND');
    const purpose=upper(body?.provider_purpose||'COLD_OUTREACH');const gate=await this.currentOutboundGate(approval,purpose);
    const idempotencyKey=buildOutboundIdempotencyKey({approval_id:approval.id,approved_content_hash:approval.content_hash,
      recipient:approval.normalized_recipient,from_identity:approval.from_identity});
    const message=await this.repository.createOutboundMessage({company_id:approval.company_id,recipient_id:approval.recipient_id,
      approval_id:approval.id,provider:gate.provider,provider_purpose:purpose,idempotency_key:idempotencyKey,
      send_status:gate.reasons.length?'BLOCKED':'QUEUED',reason_codes:gate.reasons});
    let queueJobId=null;
    if(!gate.reasons.length)queueJobId=await this.queue.enqueue('send-outreach-email',{message_id:message.id},{singletonKey:`phase7:send:${message.id}`});
    return {message,queue_job_id:queueJobId,network_calls:0};
  }

  async sendMessageWork({message_id}) {
    const message=await this.repository.getOutboundMessage(message_id);if(!message)throw notFound('Message not found','OUTBOUND_MESSAGE_NOT_FOUND');
    if(message.send_status==='BLOCKED')return {status:'BLOCKED',reason_codes:message.reason_codes,network_calls:0};
    if(message.send_status==='AMBIGUOUS'){
      const queueJobId=await this.queue.enqueue('reconcile-gmail-ambiguous-send',{message_id:message.id},
        {singletonKey:`phase10:gmail-reconcile:${message.id}`,startAfter:Number(this.env.GMAIL_AMBIGUOUS_WAIT_SECONDS||120)});
      return{status:'AMBIGUOUS',code:'GMAIL_RECONCILIATION_REQUIRED',reconcile_queue_job_id:queueJobId,network_calls:0};
    }
    const gate=await this.currentOutboundGate(message,message.provider_purpose);
    if(gate.reasons.length){
      const attempt=await this.repository.beginOutboundAttempt(message.id,{providerCallStarted:false});
      await this.repository.completeOutboundAttempt({messageId:message.id,attemptId:attempt.id,attemptStatus:'BLOCKED',sendStatus:'BLOCKED',reasonCodes:gate.reasons});
      return {status:'BLOCKED',reason_codes:gate.reasons,network_calls:0};
    }
    const health=await this.outboundProvider.health();
    if(!health.ready){const attempt=await this.repository.beginOutboundAttempt(message.id,{providerCallStarted:false});
      await this.repository.completeOutboundAttempt({messageId:message.id,attemptId:attempt.id,attemptStatus:'BLOCKED',sendStatus:'BLOCKED',reasonCodes:['PROVIDER_NOT_CONFIGURED']});
      return{status:'BLOCKED',code:'PROVIDER_NOT_CONFIGURED',network_calls:0};}
    const attempt=await this.repository.beginOutboundAttempt(message.id,{providerCallStarted:true});
    if(attempt.idempotent_replay)return{status:'PROVIDER_ACCEPTED',code:'IDEMPOTENT_REPLAY',provider_message_id:attempt.provider_message_id,network_calls:0};
    let result;
    try{result=await this.outboundProvider.send({from:message.from_identity,to:message.normalized_recipient,
      reply_to:message.reply_to,subject:message.subject,body_text:message.body_text,purpose:message.provider_purpose,
      consent_status:message.consent_status},message.idempotency_key);}catch(error){result={status:'FAILED',code:'PROVIDER_NETWORK_ERROR',error_type:'NETWORK_ERROR',network_calls:1};}
    const accepted=result.status==='PROVIDER_ACCEPTED';const blocked=result.status==='BLOCKED';const ambiguous=result.status==='AMBIGUOUS';
    const retryDecision=providerRetryDecision({http_status:result.http_status,error_type:result.error_type,
      attempt:attempt.attempt_number,max_attempts:Number(this.env.OUTREACH_PROVIDER_MAX_ATTEMPTS||3)});
    const retryable=!accepted&&!blocked&&!ambiguous&&retryDecision.retry;
    await this.repository.completeOutboundAttempt({messageId:message.id,attemptId:attempt.id,
      attemptStatus:accepted?'ACCEPTED':blocked?'BLOCKED':ambiguous?'AMBIGUOUS':retryable?'RETRYABLE_ERROR':'PERMANENT_ERROR',
      sendStatus:accepted?'PROVIDER_ACCEPTED':blocked?'BLOCKED':ambiguous?'AMBIGUOUS':retryable?'QUEUED':'FAILED',reasonCodes:[result.code],
      responseCode:result.code,responseDigest:responseDigest(result),providerMessageId:result.provider_message_id,
      providerThreadId:result.provider_thread_id,rfcMessageId:result.rfc_message_id,sendExecutionKey:result.send_execution_key});
    if(ambiguous){await this.repository.recordGmailAmbiguousEvent(message.id,{eventType:'AMBIGUOUS',rfcMessageId:result.rfc_message_id});
      const queueJobId=await this.queue.enqueue('reconcile-gmail-ambiguous-send',{message_id:message.id},
        {singletonKey:`phase10:gmail-reconcile:${message.id}`,startAfter:Number(this.env.GMAIL_AMBIGUOUS_WAIT_SECONDS||120)});
      return{...result,reconcile_queue_job_id:queueJobId};}
    if(retryable){const error=new Error(`Retryable provider failure: ${result.code}`);error.code=result.code;
      error.retry_delay_seconds=retryDecision.next_delay_seconds;throw error;}
    return result;
  }

  async gmailHealth({verify_oauth=false}={}){
    if(upper(this.env.OUTBOUND_EMAIL_PROVIDER||'NONE')!=='GMAIL_API')return{provider:'GMAIL_API',configured:false,enabled:false,ready:false,code:'GMAIL_PROVIDER_NOT_SELECTED',network_calls:0};
    return this.outboundProvider.healthCheck({verifyOAuth:verify_oauth===true});
  }

  async reconcileGmailAmbiguousSendWork({message_id}){
    const message=await this.repository.getOutboundMessage(message_id);if(!message)return{status:'MISSING',network_calls:0};
    if(message.provider!=='GMAIL_API'||message.send_status!=='AMBIGUOUS')return{status:message.send_status,code:'GMAIL_RECONCILE_NOT_REQUIRED',network_calls:0};
    const result=await this.outboundProvider.reconcileAmbiguousSend({rfcMessageId:message.rfc_message_id});
    await this.repository.recordGmailAmbiguousEvent(message.id,{eventType:result.status==='PROVIDER_ACCEPTED'?'RECONCILED':'NOT_FOUND',
      rfcMessageId:message.rfc_message_id,providerMessageId:result.provider_message_id,providerThreadId:result.provider_thread_id});
    if(result.status==='PROVIDER_ACCEPTED')await this.repository.resolveGmailAmbiguousSend(message.id,result);
    return result;
  }

  async syncGmailInboundWork(){
    if(upper(this.env.OUTBOUND_EMAIL_PROVIDER||'NONE')!=='GMAIL_API')return{status:'DISABLED',code:'GMAIL_PROVIDER_NOT_SELECTED',messages:0,network_calls:0};
    const mailbox=String(this.env.GMAIL_SENDER_EMAIL||'').trim().toLowerCase();const checkpoint=await this.repository.getGmailCheckpoint(mailbox);
    const changes=await this.outboundProvider.readMailboxChanges({historyId:checkpoint?.history_id||null});
    if(changes.status==='DISABLED'){await this.repository.saveGmailCheckpoint(mailbox,{historyId:checkpoint?.history_id,status:'DISABLED'});return{...changes,messages:0};}
    let queued=0;
    for(const item of changes.messages){
      const payload={provider:'GMAIL_API',provider_event_id:item.provider_message_id,provider_message_id:item.provider_message_id,
        event_type:item.dsn?(item.dsn_details?.bounce_class==='HARD'?'HARD_BOUNCED':'SOFT_BOUNCED'):'INBOUND_RECEIVED',direction:'INBOUND',occurred_at:item.occurred_at,
        metadata:{from:item.from,to:[item.to],subject:item.subject},subject:sanitizeInboundText(item.subject,500),
        body_text:sanitizeInboundText(item.body_text,20000),from:text(item.from,320),in_reply_to:item.in_reply_to,
        references:item.references,attachment_status:item.attachments.length?'REVIEW':'NONE',automatic:item.automatic,dsn:item.dsn,
        dsn_details:item.dsn_details||null};
      const row=await this.repository.persistWebhook({provider:'GMAIL_API',provider_event_id:item.provider_message_id,signature_status:'VERIFIED',
        event_type:payload.event_type,raw_body_digest:digestCanonical(payload),sanitized_payload:payload,processing_status:'RECEIVED'});
      await this.queue.enqueue('process-inbound-message',{webhook_id:row.id},{singletonKey:`phase10:gmail-inbound:${item.provider_message_id}`});queued+=1;
    }
    await this.repository.saveGmailCheckpoint(mailbox,{historyId:changes.history_id,status:'COMPLETED'});
    return{status:'COMPLETED',messages:changes.messages.length,queued,history_id_advanced:Boolean(changes.history_id),network_calls:changes.network_calls};
  }

  async acceptWebhook(providerName, rawBody, headers) {
    const provider=upper(providerName);const rawDigest=digestBuffer(rawBody);let normalized;
    if(provider==='RESEND') normalized=this.resendInbound.normalizeEvent(rawBody,headers);
    else normalized=this.#normalizeCorporateWebhook(rawBody,headers);
    const providerEventId=normalized.provider_event_id || `invalid-${rawDigest}`;
    const payload=normalized.verified?this.#sanitizedWebhookPayload(normalized,rawBody):{code:normalized.code};
    const row=await this.repository.persistWebhook({provider,provider_event_id:providerEventId,
      signature_status:normalized.verified?'VERIFIED':(normalized.code==='WEBHOOK_SIGNATURE_MISSING'?'MISSING':'INVALID'),
      event_type:normalized.event_type||null,raw_body_digest:rawDigest,sanitized_payload:payload,
      processing_status:normalized.verified?'RECEIVED':'REJECTED'});
    if(!normalized.verified){const error=new Error('Webhook signature verification failed');error.code=normalized.code||'WEBHOOK_SIGNATURE_INVALID';error.status=401;throw error;}
    const queueName=normalized.direction==='INBOUND'?'process-inbound-message':'process-email-provider-event';
    const queueJobId=await this.queue.enqueue(queueName,{webhook_id:row.id},{singletonKey:`phase7:webhook:${provider}:${providerEventId}`});
    return {accepted:true,webhook_id:row.id,queue_job_id:queueJobId};
  }

  #normalizeCorporateWebhook(rawBody,headers){
    const secret=String(this.env.CORPORATE_EMAIL_WEBHOOK_SECRET||'');const signature=String(headers['x-dpv-signature']||headers['X-DPV-Signature']||'');
    if(!secret||!signature)return{verified:false,code:'WEBHOOK_SIGNATURE_MISSING'};
    const expected=createHmac('sha256',secret).update(rawBody).digest('hex');const a=Buffer.from(signature);const b=Buffer.from(expected);
    if(a.length!==b.length||!timingSafeEqual(a,b))return{verified:false,code:'WEBHOOK_SIGNATURE_INVALID'};
    let body;try{body=JSON.parse(rawBody.toString('utf8'));}catch{return{verified:false,code:'WEBHOOK_JSON_INVALID'};}
    return{verified:true,provider:'CORPORATE',provider_event_id:text(body.event_id,200)||sha256(rawBody),
      provider_message_id:text(body.message_id,300)||null,event_type:mapProviderEventType(body.event_type),
      direction:upper(body.direction)==='INBOUND'?'INBOUND':'OUTBOUND',occurred_at:body.occurred_at||new Date().toISOString(),
      metadata:{from:text(body.from,320),to:Array.isArray(body.to)?body.to.map(String):[],subject:text(body.subject,500)},network_calls:0};
  }

  #sanitizedWebhookPayload(normalized,rawBody){
    let body={};try{body=JSON.parse(rawBody.toString('utf8'));}catch{}
    const data=body?.data&&typeof body.data==='object'?body.data:body;
    return{provider:normalized.provider,provider_event_id:normalized.provider_event_id,
      provider_message_id:normalized.provider_message_id,event_type:mapProviderEventType(normalized.event_type),
      direction:normalized.direction,occurred_at:normalized.occurred_at,metadata:normalized.metadata,
      subject:sanitizeInboundText(data.subject||normalized.metadata?.subject,500),
      body_text:sanitizeInboundText(data.text||data.body_text||'',20000),
      from:text(data.from||normalized.metadata?.from,320),
      in_reply_to:text(data.in_reply_to||data.headers?.['in-reply-to']||data.headers?.['In-Reply-To'],500)||null,
      references:text(data.references||data.headers?.references||data.headers?.References,1000)||null,
      reply_to_token:text(data.reply_to_token,300)||null,
      company_wide:data.company_wide===true||upper(data.opt_out_scope)==='COMPANY',
      attachment_status:Array.isArray(data.attachments)&&data.attachments.length?'REVIEW':'NONE'};
  }

  async processProviderEventWork({webhook_id}){
    const webhook=await this.repository.getWebhook(webhook_id);if(!webhook)return{status:'MISSING'};const payload=webhook.sanitized_payload||{};
    const outbound=payload.provider_message_id?await this.repository.findOutboundByProvider(webhook.provider,payload.provider_message_id):null;
    const eventType=mapProviderEventType(payload.event_type||webhook.event_type);
    const event=await this.repository.recordProviderEvent({outbound_message_id:outbound?.id||null,webhook_inbox_id:webhook.id,event_type:eventType,
      occurred_at:payload.occurred_at||webhook.received_at,provider_sequence:payload.provider_event_id,event_digest:digestCanonical({provider:webhook.provider,id:webhook.provider_event_id,type:eventType})});
    const state=mapOutboundState(eventType);if(outbound&&state){const events=await this.repository.getOutboundEvents(outbound.id);
      await this.repository.updateOutboundState(outbound.id,deriveDeliveryState(events,outbound.send_status));}
    const suppressionType=({HARD_BOUNCED:'HARD_BOUNCE',COMPLAINED:'COMPLAINT',OPTED_OUT:'OPT_OUT'})[eventType];
    if(outbound&&suppressionType)await this.repository.suppressRecipientForMessage(outbound.id,suppressionType,event.id,
      {companyWide:suppressionType==='OPT_OUT'&&payload.company_wide===true});
    await this.repository.markWebhookProcessed(webhook.id);return{status:'PROCESSED',event_id:event.id};
  }

  async processInboundWork({webhook_id}){
    const webhook=await this.repository.getWebhook(webhook_id);if(!webhook)return{status:'MISSING'};const payload=webhook.sanitized_payload||{};
    const senderRaw=String(payload.from||payload.metadata?.from||'').trim().toLowerCase();
    const sender=(senderRaw.match(/<([^<>@\s]+@[^<>\s]+)>/)?.[1]||senderRaw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i)?.[0]||'').toLowerCase();
    const references=[payload.in_reply_to,payload.references].filter(Boolean).flatMap(value=>String(value).match(/<[^>]+>|[^\s,]+/g)||[]);
    const correlated=await this.repository.findInboundThread({references,replyToken:payload.reply_to_token,sender});
    const inbound=await this.repository.createInboundMessage({provider:webhook.provider,provider_message_id:payload.provider_message_id||webhook.provider_event_id,
      webhook_inbox_id:webhook.id,thread_id:correlated?.id||null,correlation_status:correlated?'MATCHED':'REVIEW',from_address_hash:sha256(sender),
      subject_sanitized:sanitizeInboundText(payload.subject,500),body_text_sanitized:sanitizeInboundText(payload.body_text,20000),
      attachment_status:payload.attachment_status||'NONE',received_at:payload.occurred_at||webhook.received_at});
    if(payload.dsn===true&&payload.dsn_details?.status){
      const outbound=await this.repository.findOutboundByRfcReferences(references);
      if(outbound){const eventType=String(payload.dsn_details.status).startsWith('5.')?'HARD_BOUNCED':'SOFT_BOUNCED';
        const event=await this.repository.recordProviderEvent({outbound_message_id:outbound.id,webhook_inbox_id:webhook.id,event_type:eventType,
          occurred_at:payload.occurred_at||webhook.received_at,provider_sequence:payload.provider_event_id,
          event_digest:digestCanonical({provider:webhook.provider,id:webhook.provider_event_id,type:eventType})});
        const events=await this.repository.getOutboundEvents(outbound.id);await this.repository.updateOutboundState(outbound.id,deriveDeliveryState(events,outbound.send_status));
        if(eventType==='HARD_BOUNCED')await this.repository.suppressRecipientForMessage(outbound.id,'HARD_BOUNCE',event.id);
      }
    }
    await this.repository.markWebhookProcessed(webhook.id);const queueJobId=await this.queue.enqueue('classify-inbound-reply',{inbound_message_id:inbound.id},{singletonKey:`phase7:classify-inbound:${inbound.id}`});
    return{status:'PROCESSED',inbound_message_id:inbound.id,queue_job_id:queueJobId};
  }

  async classifyInboundWork({inbound_message_id}){
    const result=await this.pool.query(`SELECT i.*,
      coalesce((w.sanitized_payload->'company_wide')='true'::jsonb,false) company_wide_opt_out,
      coalesce((w.sanitized_payload->'automatic')='true'::jsonb,false) gmail_automatic,
      coalesce((w.sanitized_payload->'dsn')='true'::jsonb,false) gmail_dsn
      FROM leadgen.inbound_messages i LEFT JOIN leadgen.email_webhook_inbox w ON w.id=i.webhook_inbox_id
      WHERE i.id=$1`,[requiredUuid(inbound_message_id,'inbound_message_id')]);
    if(!result.rowCount)return{status:'MISSING'};const inbound=result.rows[0];
    const classified=inbound.gmail_automatic?{intent:'AUTO_REPLY',confidence:0.99,confidence_basis:'GMAIL_AUTOMATIC_HEADER',actions:[]}
      :inbound.gmail_dsn?{intent:'IRRELEVANT',confidence:0.99,confidence_basis:'STRUCTURED_DSN',actions:[]}
      :classifyInboundReply({subject:inbound.subject_sanitized,body_text:inbound.body_text_sanitized});
    const stored=await this.repository.createReplyClassification({inbound_message_id:inbound.id,intent:mapReplyIntent(classified.intent),
      confidence:classified.confidence,review_status:'PENDING_REVIEW',classifier_version:'dpv-inbound-rules-v1',reason_codes:[classified.confidence_basis]});
    if(stored.intent==='OPT_OUT')await this.repository.suppressRecipientForInbound(inbound.id,
      {companyWide:inbound.company_wide_opt_out===true});
    let queueJobId=null;if(classified.actions?.some(action=>action.action==='CREATE_SALES_TASK'))queueJobId=await this.queue.enqueue('create-sales-followup',{inbound_message_id:inbound.id},{singletonKey:`phase7:sales-followup:${inbound.id}`});
    return{status:'CLASSIFIED',classification_id:stored.id,intent:stored.intent,automatic_send_allowed:false,queue_job_id:queueJobId};
  }

  async createSalesFollowupWork({inbound_message_id}) {
    const inbound=await this.repository.getInboundForTask(inbound_message_id);
    if(!inbound)return{status:'MISSING',automatic_send_allowed:false};
    if(!inbound.company_id||!inbound.thread_id)return{status:'REVIEW_REQUIRED',reason:'UNMATCHED_INBOUND',automatic_send_allowed:false};
    const built=buildSalesTaskFromReply({
      classification:{intent:mapReplyIntent(inbound.intent),confidence:Number(inbound.confidence||0),
        sanitized_subject:inbound.subject_sanitized,sanitized_body_text:inbound.body_text_sanitized},
      company_id:inbound.company_id,thread_id:inbound.thread_id,message_id:inbound.id
    });
    if(!built.create_task)return{status:'NO_TASK_REQUIRED',intent:inbound.intent,automatic_send_allowed:false};
    const type=({CATALOGUE:'FOLLOW_UP',SAMPLE:'SAMPLE',QUOTATION:'QUOTATION',MEETING:'MEETING',DEFER:'FOLLOW_UP',REVIEW:'REPLY_REVIEW'})[built.task.intent]||'REPLY_REVIEW';
    const task=await this.repository.createSalesTask({company_id:inbound.company_id,thread_id:inbound.thread_id,
      inbound_message_id:inbound.id,task_type:type,owner:null,due_at:built.task.due_at,details:built.task});
    const crm=await this.repository.createCrmOutbox({company_id:inbound.company_id,task_id:task.id,operation:'CREATE_TASK',
      payload:validateCrmPayload('CREATE_TASK',{task_id:task.id,task_type:task.task_type,due_at:task.due_at,source:'PHASE7_INBOUND_FOLLOWUP'}),
      idempotency_key:digestCanonical({operation:'CREATE_TASK',task_id:task.id})});
    let crmQueueJobId=null;
    if(this.queue){try{crmQueueJobId=await this.queue.enqueue('sync-outreach-to-crm',{outbox_id:crm.outbox.id},{singletonKey:`phase7:crm:${crm.outbox.id}`});}catch(error){this.audit('phase7_crm_enqueue_pending',{outbox_id:crm.outbox.id,error:String(error?.message||error).slice(0,240)});}}
    return{status:'TASK_CREATED',task_id:task.id,task_type:task.task_type,automatic_send_allowed:false,
      crm_outbox_id:crm.outbox.id,crm_sync_status:crm.outbox.sync_status,crm_queue_job_id:crmQueueJobId};
  }

  async createCrmOutbox(body) {
    const topLevel=body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body):[];
    const unknownTopLevel=topLevel.filter(key=>!['company_id','task_id','operation','payload','idempotency_key'].includes(key)||CRM_FORBIDDEN_FIELD.test(key));
    if(unknownTopLevel.length){const error=new Error('CRM outbox request contains unsupported fields');error.code='CRM_REQUEST_FIELD_FORBIDDEN';error.status=400;error.details={fields:unknownTopLevel};throw error;}
    const operation=upper(body?.operation);
    if(!['CREATE_LEAD','UPDATE_ACTIVITY','CREATE_TASK','UPDATE_OPPORTUNITY','SUPPRESSION_NOTICE'].includes(operation)){
      const error=new Error('Unsupported CRM operation');error.code='CRM_OPERATION_INVALID';error.status=400;throw error;
    }
    const companyId=requiredUuid(body?.company_id,'company_id');
    const taskId=body?.task_id?requiredUuid(body.task_id,'task_id'):null;
    const payload=validateCrmPayload(operation,body?.payload||{});
    const suppliedKey=text(body?.idempotency_key,200);
    if(suppliedKey&&!/^[A-Za-z0-9:_-]{8,200}$/.test(suppliedKey)){const error=new Error('CRM idempotency key has an invalid format');error.code='CRM_IDEMPOTENCY_KEY_INVALID';error.status=400;throw error;}
    return this.repository.createCrmOutbox({company_id:companyId,task_id:taskId,operation,payload,
      idempotency_key:suppliedKey||digestCanonical({company_id:companyId,task_id:taskId,operation,payload})});
  }

  async getCrmOutbox(id,user){const row=await this.repository.getCrmOutbox(id);if(!row)throw notFound('CRM outbox item not found','CRM_OUTBOX_NOT_FOUND');return crmOutboxProjection(row,user?.role);}

  async enqueueCrmOutbox(id){const row=await this.getCrmOutbox(id);const queueJobId=await this.queue.enqueue('sync-outreach-to-crm',
    {outbox_id:row.id},{singletonKey:`phase7:crm:${row.id}:${row.attempt_count}`});
    return{status:'QUEUED',outbox_id:row.id,sync_status:row.sync_status,queue_job_id:queueJobId};}

  async processCrmSyncWork({outbox_id}){
    const claim=await this.repository.claimCrmOutbox(outbox_id);
    if(!claim.claimed)return{status:claim.outbox.sync_status,outbox_id:claim.outbox.id,replay:claim.outbox.sync_status==='SYNCED',network_calls:0};
    let outboundPayload;
    try{outboundPayload=validateCrmPayload(claim.outbox.operation,claim.outbox.payload||{});}catch(error){
      const failed=await this.repository.failCrmOutbox(claim.outbox.id,{retryable:false,error:error.code||'CRM_PAYLOAD_UNSAFE'});
      return{status:failed.sync_status,outbox_id:failed.id,error_code:error.code||'CRM_PAYLOAD_UNSAFE',network_calls:0};
    }
    const baseUrl=String(this.env.CRM_BASE_URL||'').trim().replace(/\/$/,'');
    const apiKey=String(this.env.CRM_API_KEY||'').trim();
    const configured=baseUrl&&apiKey&&!/REPLACE_WITH|NOT_CONFIGURED/i.test(`${baseUrl}|${apiKey}`);
    if(!configured){
      const failed=await this.repository.failCrmOutbox(claim.outbox.id,{retryable:true,error:'CRM_ADAPTER_NOT_CONFIGURED',retryAfterSeconds:3600});
      return{status:failed.sync_status,configuration_status:'ADAPTER_NOT_CONFIGURED',outbox_id:failed.id,
        attempt_count:failed.attempt_count,next_attempt_at:failed.next_attempt_at,network_calls:0};
    }
    try{
      const response=await fetch(`${baseUrl}/sync`,{method:'POST',headers:{'content-type':'application/json',
        authorization:`Bearer ${apiKey}`,'idempotency-key':claim.outbox.idempotency_key},
        body:JSON.stringify({operation:claim.outbox.operation,company_id:claim.outbox.company_id,
          task_id:claim.outbox.task_id,payload:outboundPayload}),signal:AbortSignal.timeout(Number(this.env.CRM_TIMEOUT_MS||10000))});
      if(!response.ok){
        const retryable=response.status===429||response.status>=500;
        const failed=await this.repository.failCrmOutbox(claim.outbox.id,{retryable,error:`CRM_HTTP_${response.status}`,
          retryAfterSeconds:Number(response.headers.get('retry-after'))||300});
        return{status:failed.sync_status,outbox_id:failed.id,http_status:response.status,network_calls:1};
      }
      const synced=await this.repository.completeCrmOutbox(claim.outbox.id);
      return{status:synced.sync_status,outbox_id:synced.id,attempt_count:synced.attempt_count,network_calls:1};
    }catch(error){
      const failed=await this.repository.failCrmOutbox(claim.outbox.id,{retryable:true,error:`CRM_TRANSPORT_ERROR:${String(error?.message||error)}`,retryAfterSeconds:300});
      return{status:failed.sync_status,outbox_id:failed.id,error_code:'CRM_TRANSPORT_ERROR',network_calls:1};
    }
  }

  async createImportDryRun(body,user){
    const importType=upper(body?.import_type);const filename=cleanFilename(body?.filename);const extension=path.extname(filename).toLowerCase();
    let buffer;try{buffer=Buffer.from(String(body?.content_base64||''),'base64');}catch{buffer=Buffer.alloc(0);}
    validateUploadMetadata({filename,mimeType:text(body?.mime_type,160),byteLength:buffer.length,passwordProtected:false,hasMacros:false,hasExternalLinks:false,hasEmbeddedObjects:false});
    const parsedRows=extension==='.csv'?parseCsvUtf8(buffer,{importType}):(await parseXlsxImportBuffer(buffer,{importType,extension})).rows;
    const rows=await this.repository.resolveImportRows(importType,parsedRows);
    const sourceSha256=sha256Bytes(buffer);const prior=await this.pool.query(`SELECT coalesce(max(import_version),0)::int latest_version
      FROM leadgen.reference_data_imports WHERE import_type=$1 AND lower(source_filename)=lower($2)`,[importType,filename]);
    const record=createImportDryRun({importType,rows,sourceSha256,createdBy:user.identity,latestVersion:prior.rows[0].latest_version});
    const persisted=await this.repository.createImport(record,{sourceFilename:filename});
    if(!persisted.replay){await mkdir(this.importDir,{recursive:true});const stagingPath=path.join(this.importDir,`${record.importId}${extension}`);await writeFile(stagingPath,buffer,{flag:'wx'});}
    return{...persisted,staging_copy_created:!persisted.replay,source_file_modified:false};
  }

  async discoverSharedImportFilesWork(data){
    if(!data?.manifest||!data?.import_type){return{status:'MANIFEST_PAYLOAD_REQUIRED',manifest_id:data?.manifest_id||null,
      source_files_modified:0,source_files_created:0,auto_commit:false};}
    const stagingRoots=String(this.env.DATA_EXCHANGE_STAGING_DIR||this.importDir).split(';').map(value=>value.trim()).filter(Boolean);
    const manifest=validateReadOnlyManifest(data.manifest,{allowlistedRoot:this.env.DPV_SHARED_FOLDER_PATH,
      allowlistedStagingRoots:stagingRoots});
    let bytes;try{bytes=await readFile(manifest.stagedPath);}catch{const error=new Error('Validated staged copy is unavailable');
      error.code='SHARED_STAGED_COPY_UNAVAILABLE';error.status=409;throw error;}
    if(sha256Bytes(bytes)!==manifest.sourceSha256){const error=new Error('Staged copy hash changed after host manifest validation');
      error.code='SHARED_STAGED_HASH_CHANGED';error.status=409;throw error;}
    const importType=upper(data.import_type);const extension=path.extname(manifest.sourceFilename).toLowerCase();
    const parsedRows=extension==='.csv'?parseCsvUtf8(bytes,{importType}):(await parseXlsxImportBuffer(bytes,{importType,extension})).rows;
    const rows=await this.repository.resolveImportRows(importType,parsedRows);
    const prior=await this.pool.query(`SELECT coalesce(max(import_version),0)::int latest_version
      FROM leadgen.reference_data_imports WHERE import_type=$1 AND lower(source_filename)=lower($2)`,[importType,manifest.sourceFilename]);
    const record=createImportDryRun({importType,rows,sourceSha256:manifest.sourceSha256,
      createdBy:'phase7-read-only-shared-folder-worker',latestVersion:prior.rows[0].latest_version});
    const persisted=await this.repository.createImport(record,{sourceFilename:manifest.sourceFilename});
    return{status:persisted.import.api_status,import:persisted.import,replay:persisted.replay,parse_local_copy_only:true,
      source_files_modified:0,source_files_created:0,auto_commit:false};
  }

  async enqueueSharedImportDiscovery(body){
    const importType=upper(body?.import_type);
    if(!['PROSPECT_LEADS','PRODUCT_MASTER_UPDATE','CUSTOMER_DEALS','CUSTOMER_DEAL_LINES'].includes(importType)){
      const error=new Error('Unsupported shared-folder import type');error.code='IMPORT_TYPE_UNKNOWN';error.status=400;throw error;
    }
    const manifest=canonicalSharedManifest(body?.manifest);
    const stagingRoots=String(this.env.DATA_EXCHANGE_STAGING_DIR||this.importDir).split(';').map(value=>value.trim()).filter(Boolean);
    const validated=validateReadOnlyManifest(manifest,{allowlistedRoot:this.env.DPV_SHARED_FOLDER_PATH,
      allowlistedStagingRoots:stagingRoots});
    const manifestDigest=digestCanonical({import_type:importType,source_sha256:validated.sourceSha256,
      source_filename:validated.sourceFilename,source_mutations:manifest.sourceMutations});
    const queueJobId=await this.queue.enqueue('discover-shared-import-files',{import_type:importType,manifest,
      manifest_id:manifestDigest},{singletonKey:`phase7:shared-import:${manifestDigest}`});
    return{status:'QUEUED',action:'IMPORT_DISCOVER',import_type:importType,manifest_digest:manifestDigest,
      queue_job_id:queueJobId,parse_local_copy_only:true,auto_commit:false,source_files_modified:0};
  }

  async getImport(id){const record=await this.repository.getImport(id);if(!record)throw notFound('Import not found','IMPORT_NOT_FOUND');return record;}
  async submitImport(id){return this.repository.submitImport(id);}
  async approveImport(id,body,user){const decision=upper(body?.decision||'APPROVED');return this.repository.approveImport({id,decision,actor:user.identity,role:user.role,
    reason:text(body?.reason,1000)||null,idempotency_key:digestCanonical({id,decision,actor:user.identity,dry_run_digest:body?.dry_run_digest||null})});}
  async commitImportWork({import_id,actor}){
    const result=await this.repository.commitImport(import_id,actor||'phase7-data-worker');
    const effects=await this.repository.pendingImportEffects(import_id);
    const dispatch=[];
    for(const effect of effects){
      const payload=effect.payload||{};
      const queueName=effect.effect_type==='REBUILD_ICP_PROFILE'?'rebuild-icp-profile':'recalculate-customer-match';
      try{
        const companyIds=effect.effect_type==='RECALCULATE_CUSTOMER_MATCH'?(payload.company_ids||[]):[null];
        const queueJobIds=[];
        for(const companyId of companyIds){
          const queueJobId=await this.queue.enqueue(queueName,{...payload,company_id:companyId||undefined,
            actor:actor||'phase7-data-worker'},
          {singletonKey:`phase7:import-effect:${effect.id}:${effect.effect_version}:${companyId||'profile'}`});
          queueJobIds.push(queueJobId);
        }
        if(!queueJobIds.length)throw new Error('No affected company was available for Customer Match recalculation');
        await this.repository.markImportEffectDispatched(effect.id,queueJobIds.join(','));
        dispatch.push({effect_id:effect.id,effect_type:effect.effect_type,status:'DISPATCHED',queue_job_ids:queueJobIds});
      }catch(error){
        await this.repository.markImportEffectRetryable(effect.id,error?.message||error);
        dispatch.push({effect_id:effect.id,effect_type:effect.effect_type,status:'RETRYABLE_ERROR'});
      }
    }
    let autoEvidenceJobId=null;
    let autoEvidenceScheduleStatus='QUEUED';
    const affectedCompanyIds=[...new Set([
      ...(result.affected_company_ids||[]),
      ...effects.flatMap(effect=>Array.isArray(effect.payload?.company_ids)?effect.payload.company_ids:[])
    ].map(value=>String(value||'').trim()).filter(Boolean))];
    try{
      autoEvidenceJobId=await this.queue.enqueue('schedule-auto-evidence',{
        schedule_source:'IMPORT',import_id,company_ids:affectedCompanyIds,actor:actor||'phase7-data-worker'
      },{singletonKey:`phase10:auto-evidence:import:${import_id}`});
    }catch(error){
      autoEvidenceScheduleStatus='RETRYABLE_ERROR';
      dispatch.push({effect_type:'AUTO_EVIDENCE_SCHEDULE',status:'RETRYABLE_ERROR',error_code:error?.code||'QUEUE_UNAVAILABLE'});
    }
    return{...result,downstream_effects:dispatch,auto_evidence_schedule_job_id:autoEvidenceJobId,
      auto_evidence_schedule_status:autoEvidenceScheduleStatus};
  }
  async enqueueImportCommit(id,user){const record=await this.getImport(id);if(record.api_status!=='APPROVED'){const error=new Error('Approved import required');error.code='IMPORT_COMMIT_FORBIDDEN';error.status=409;throw error;}
    const queueJobId=await this.queue.enqueue('commit-reference-import',{import_id:id,actor:user.identity},{singletonKey:`phase7:commit-import:${id}:${record.dry_run_digest}`});return{status:'QUEUED',import_id:id,queue_job_id:queueJobId};}
  async importErrorReport(id){const record=await this.getImport(id);const rows=await this.repository.getImportRows(id,{limit:1000});const report=buildImportErrorReport({
    importId:record.id,importType:record.import_type,status:record.api_status,sourceSha256:record.content_sha256,dryRun:{rows:rows.map(row=>({rowNumber:row.row_number,rowStatus:row.row_status,errorCodes:row.error_codes,warningCodes:[],reviewReasons:[]}))}
    });const normalized=report.map(row=>({...row,error_codes:(row.error_codes||[]).join('; '),warning_codes:(row.warning_codes||[]).join('; '),review_reasons:(row.review_reasons||[]).join('; ')}));
    const headers=['row_number','row_status','error_codes','warning_codes','review_reasons'];const buffer=await buildXlsxExportBuffer({worksheetName:'Import Errors',headers,rows:normalized});
    return{buffer,filename:`DPV_Import_Errors_${record.id}.xlsx`,row_count:normalized.length};}

  async createDataExport(body,user){const request={exportType:upper(body?.export_type),format:upper(body?.format||'XLSX'),mode:upper(body?.mode||'CURRENT_FILTER'),
    requesterRole:user.role,requesterIdentity:user.identity,financeAuthorized:user.role==='FINANCE'&&body?.finance_authorized===true,
    columns:body?.columns,filters:body?.filters||{},selectedEntityIds:body?.selected_entity_ids||[]};
    const created=createExportJob(request,{tokenTtlSeconds:Number(this.env.DATA_EXPORT_DOWNLOAD_TTL_SECONDS||900),fileTtlSeconds:Number(this.env.DATA_EXPORT_FILE_TTL_SECONDS||3600)});
    const row=await this.repository.createExportJob(created.job);const queueJobId=await this.queue.enqueue('export-business-data',{export_id:row.id},{singletonKey:`phase7:export:${row.id}`});
    return{job:safeExportJob(row),download_token:created.downloadToken,queue_job_id:queueJobId};}

  async queryExportRows(resolved){
    if(resolved.exportType==='RESEARCH_JOB_PROVIDER_USAGE'){
      const params=[];const clauses=[];
      if(resolved.filters?.job_id){params.push(resolved.filters.job_id);clauses.push(`j.id=$${params.length}`);}
      if(resolved.filters?.status){params.push(String(resolved.filters.status).toUpperCase());clauses.push(`j.status=$${params.length}`);}
      if(resolved.filters?.market){params.push(String(resolved.filters.market).toUpperCase());clauses.push(`($${params.length}=ANY(j.market_codes) OR j.country_code=$${params.length})`);}
      if(resolved.mode==='SELECTED_ROWS'){
        params.push(resolved.selectedEntityIds);clauses.push(`j.id=ANY($${params.length}::uuid[])`);
      }
      const rows=await this.pool.query(`SELECT j.id research_job_id,j.job_type,j.status,
        coalesce(j.country_code,j.market_codes[1]) market,coalesce(j.product_profile,j.product_profiles[1]) product_profile,
        pu.provider_call_count,pu.provider_completed_count,pu.provider_not_found_count,
        pu.provider_temporary_error_count,pu.provider_failed_count,pu.reserved_units,pu.used_units,
        pu.released_units,pu.last_provider_event_at,pu.projection_updated_at
        FROM leadgen.research_jobs j
        LEFT JOIN leadgen.research_job_provider_usage_summary pu ON pu.research_job_id=j.id
        ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''}
        ORDER BY j.created_at DESC,j.id DESC LIMIT 5000`,params);
      return rows.rows;
    }
    if(['LEAD_MASTER_INTERNAL','SALES_OPPORTUNITY'].includes(resolved.exportType)){
      if(!this.opportunityQuery)throw new Error('Opportunity query is not configured');const rows=await this.opportunityQuery(resolved.filters);
      return rows.filter(row=>resolved.mode!=='SELECTED_ROWS'||resolved.selectedEntityIds.includes(row.company_id)).map(row=>{
        const {sku_readiness_status:_skuReadiness,catalog_enrichment_required:_catalogEnrichment,
          product_opportunity_status:_productOpportunityStatus,product_opportunity_count:_productOpportunityCount,
          top_product_opportunity:_topProductOpportunity,...businessRow}=row;
        return {
        ...businessRow,market:row.country_code,
        matched_categories:exportBusinessList(row.matched_scopes),
        category_evidence:exportBusinessList(row.observed_customer_categories||row.observed_categories),
        company_verification:row.verification_status,
        buyer_type:row.buyer_business_model,
        named_buyer:row.decision_maker_status==='VERIFIED'&&row.buyer_name?row.buyer_name:'',
        official_email:row.official_email_route||'',
        official_phone:row.official_phone_route||'',
        official_whatsapp:row.official_whatsapp_route||'',
        official_contact_page:row.official_form_route||'',
        opportunity_status:row.display_opportunity_status||row.system_recommendation_status,
        primary_blocker:(row.opportunity_decision_reason_codes||[])[0]||'',
        next_action:['RECOMMENDED','MANAGEMENT_APPROVED'].includes(row.display_opportunity_status||row.system_recommendation_status)
          ?'PREPARE_MANUAL_CONTACT':(row.display_opportunity_status||row.system_recommendation_status)==='NOT_SUITABLE'
            ?'NO_FOLLOW_UP':'COMPLETE_PRIMARY_EVIDENCE',
        latest_evidence_time:row.latest_evidence_time||row.latest_route_verified_at||row.last_verified_at,
        evidence_url:row.category_evidence_url||row.contact_source_url||'',
        buyer_business_model:row.buyer_business_model,
        product_profile:row.product_profile,product_category_score:row.category_procurement_match_score,
        product_category_score_band:row.category_procurement_match_band,
        target_category_match:row.category_procurement_match_status,
        observed_company_categories:exportBusinessList(row.observed_customer_categories||row.observed_categories),
        dpv_supply_categories:exportBusinessList(row.matched_scopes||row.dpv_category_scopes),
        category_opportunity_basis:row.match_basis,
        readiness_blockers:(row.readiness_blockers||[]).join?.('; ')||'',
        decision_maker:row.buyer_name,buying_department:row.buyer_department,business_contact:row.best_contact,
        contact_verification:row.contact_verification,management_baseline_match:row.customer_match,
        mexico_historical_reference_match:row.historical_customer_match,last_assessed_at:row.feasibility_calculated_at,
        source_reference_urls:row.contact_source_url||''
      };});
    }
    if(resolved.exportType==='PRODUCT_CATALOG_INTERNAL'){
      const rows=await this.pool.query(`SELECT pm.id,pm.product_name company_name,pm.product_profile market,
        pm.category country_code,pm.sku external_lead_id,pm.source_system,pm.moq dpv_score,
        coalesce(r.catalog_status,'UNKNOWN') lifecycle_status,r.approved_at last_assessed_at
        FROM leadgen.product_master pm LEFT JOIN leadgen.product_master_current_revisions r ON r.product_master_id=pm.id
        ORDER BY pm.product_name LIMIT 5000`);return rows.rows;
    }
    if(resolved.exportType==='CUSTOMER_DEAL_HISTORY'){
      const rows=await this.pool.query(`SELECT hc.company_name,hc.country_code,hc.website_url,ho.external_order_id external_lead_id,
        ho.order_status lifecycle_status,ho.order_value customer_sales_price,ho.currency,ho.order_date last_assessed_at,
        ho.source_system FROM leadgen.historical_orders ho LEFT JOIN leadgen.historical_customers hc ON hc.id=ho.historical_customer_id
        ORDER BY ho.order_date DESC NULLS LAST LIMIT 5000`);return rows.rows;
    }
    if(resolved.exportType==='IMPORT_ERROR_REPORT'){
      const id=resolved.filters.import_id;return this.repository.getImportRows(id,{limit:5000});
    }
    return[];
  }

  async processExportWork({export_id}){
    const row=await this.repository.getExport(export_id);if(!row)throw notFound('Export not found','EXPORT_NOT_FOUND');
    try{const resolved=resolveExportRequest({exportType:row.export_type,format:row.export_format,mode:row.export_mode,
      requesterRole:row.requester_role,requesterIdentity:row.requester_identity,financeAuthorized:row.requester_role==='FINANCE',
      columns:row.applied_columns,filters:row.filters,selectedEntityIds:row.selected_entity_ids});const sourceRows=await this.queryExportRows(resolved);
      const rows=sourceRows.map(item=>projectExportRow(item,resolved));const bytes=row.export_format==='CSV'
        ?Buffer.from(serializeCsv(resolved.columns,rows),'utf8'):await buildXlsxExportBuffer({worksheetName:'Export',headers:resolved.columns,rows});
      await mkdir(this.exportDir,{recursive:true});const extension=row.export_format.toLowerCase();const filePath=path.join(this.exportDir,`${row.id}.${extension}`);await writeFile(filePath,bytes,{flag:'wx'});
      const final=await this.repository.finalizeExport(row.id,{storage_key:path.basename(filePath),row_count:rows.length,file_sha256:digestBuffer(bytes),internal_file_path:filePath});
      return{status:'READY',job:safeExportJob(final)};
    }catch(error){await this.repository.failExport(row.id,error.code||'EXPORT_FAILED');throw error;}
  }

  async downloadExport(id,user,token){
    const row=await this.repository.getExport(id);if(!row)throw notFound('Export not found','EXPORT_NOT_FOUND');const model=exportJobModel(row);let authorizationStatus='DENIED';
    try{if(row.export_status!=='READY')throw Object.assign(new Error('Export is not ready'),{code:'EXPORT_NOT_READY',status:409});
      if(row.requester_identity!==user.identity)throw Object.assign(new Error('Export owner mismatch'),{code:'DOWNLOAD_FORBIDDEN',status:403});
      const now=new Date();if(new Date(row.download_token_expires_at)<=now||new Date(row.file_expires_at)<=now){authorizationStatus='EXPIRED';throw Object.assign(new Error('Export expired'),{code:'EXPORT_EXPIRED',status:410});}
      if(sha256(String(token||''))!==row.download_token_hash)throw Object.assign(new Error('Download token invalid'),{code:'DOWNLOAD_TOKEN_INVALID',status:403});
      const resolved=path.resolve(row.internal_file_path);const relative=path.relative(this.exportDir,resolved);if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Export path invalid'),{code:'EXPORT_PATH_INVALID',status:500});
      const bytes=await readFile(resolved);authorizationStatus='AUTHORIZED';const audit=buildDownloadAuditEvent({job:{id:row.id},requesterIdentity:user.identity,authorizationStatus,downloadToken:token});await this.repository.auditDownload(audit);
      return{bytes,filename:`DPV_${row.export_type}_${row.id}.${row.export_format.toLowerCase()}`,mimeType:row.export_format==='CSV'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    }catch(error){const audit=buildDownloadAuditEvent({job:{id:row.id},requesterIdentity:user.identity,authorizationStatus,downloadToken:token});await this.repository.auditDownload(audit);throw error;}
  }

  async getExport(id,user){const row=await this.repository.getExport(id);if(!row)throw notFound('Export not found','EXPORT_NOT_FOUND');if(row.requester_identity!==user.identity&&!['MANAGEMENT','DATA_ADMIN'].includes(user.role)){const error=new Error('Export access denied');error.code='DOWNLOAD_FORBIDDEN';error.status=403;throw error;}return safeExportJob(row);}
  async getTemplate(type){return buildTemplateWorkbook(upper(type));}
}

export { bool, mapProviderEventType, mapReplyIntent, safeExportJob };
