// CRM outbox payload builders. Every builder returns only fields that are on the
// operation allowlist in phase7/service.js (CRM_OPERATION_FIELDS); internal record
// identifiers travel as one opaque `source_reference` string.

const ACTIVITY_SUMMARIES=Object.freeze({
  CONTACTED:'First-touch email sent',
  REPLIED:'Reply received',
  AUTO_REPLY:'Automatic reply received',
  OPTED_OUT:'Recipient opted out',
  BOUNCED:'Email bounced',
  FOLLOW_UP_REQUIRED:'Follow-up required',
  CALL:'Call logged',
  WHATSAPP:'WhatsApp logged',
  MEETING:'Meeting logged',
  NOTE:'Note logged',
  EMAIL_MANUAL:'Manual email logged',
  STAGE_CHANGED:'Pipeline stage changed',
});

export function crmSourceReference(parts){
  return Object.entries(parts||{})
    .filter(([,value])=>value!==null&&value!==undefined&&value!=='')
    .map(([key,value])=>`${key}=${String(value).replace(/[;\s]/g,'')}`)
    .join(';').slice(0,500)||null;
}

function iso(value){
  const date=value instanceof Date?value:new Date(value||Date.now());
  return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();
}

export function activityOutboxPayload({activity_type,occurred_at,summary,owner,references}){
  const type=String(activity_type||'').toUpperCase();
  const payload={
    activity_type:type,
    occurred_at:iso(occurred_at),
    summary:String(summary||ACTIVITY_SUMMARIES[type]||type).slice(0,1000),
  };
  if(owner)payload.owner=String(owner).slice(0,500);
  const reference=crmSourceReference(references);
  if(reference)payload.source_reference=reference;
  return payload;
}

/** CREATE_LEAD payload. website_url is the site's origin (scheme + host): CRM_OPERATION_FIELDS.CREATE_LEAD
 *  accepts only an http(s) origin there, so a page path can never carry anything path-like into the CRM. */
export function leadOutboxPayload({company_name,country_code,website_url,owner,references}){
  const payload={company_name:String(company_name||'').slice(0,500),country_code:String(country_code||'').toUpperCase().slice(0,8)};
  const origin=websiteOrigin(website_url);
  if(origin)payload.website_url=origin;
  if(owner)payload.owner=String(owner).slice(0,500);
  const reference=crmSourceReference(references);
  if(reference)payload.source_reference=reference;
  return payload;
}

export function websiteOrigin(value){
  try{const url=new URL(String(value||'').trim());
    return['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?`${url.protocol}//${url.host}`.toLowerCase():null;}
  catch{return null;}
}

export function opportunityOutboxPayload({stage,status,owner,external_crm_id}){
  const payload={stage:String(stage||'').toUpperCase()};
  if(status)payload.status=String(status).toUpperCase();
  if(owner)payload.owner=String(owner).slice(0,500);
  if(external_crm_id)payload.external_crm_id=String(external_crm_id).slice(0,500);
  return payload;
}

// Rows queued before the builders above carried internal identifiers directly.
// Fold exactly those known keys into source_reference so the allowlist check can
// pass; any other unexpected key is left in place and still rejected.
const LEGACY_REFERENCE_KEYS=Object.freeze({
  activity_id:'activity',inbound_message_id:'inbound',classification_id:'classification',
  opportunity_snapshot_id:'opportunity',outbound_message_id:'outbound',funnel_status:'funnel',due_at:'due',
});

export function normalizeLegacyCrmPayload(operation,payload){
  if(String(operation||'').toUpperCase()!=='UPDATE_ACTIVITY'||!payload||typeof payload!=='object'||Array.isArray(payload))return payload;
  const legacy=Object.keys(payload).filter(key=>key in LEGACY_REFERENCE_KEYS);
  if(!legacy.length)return payload;
  const next={...payload};const references={};
  for(const key of legacy){references[LEGACY_REFERENCE_KEYS[key]]=payload[key];delete next[key];}
  const merged=[next.source_reference,crmSourceReference(references)].filter(Boolean).join(';').slice(0,500);
  if(merged)next.source_reference=merged;
  return next;
}
