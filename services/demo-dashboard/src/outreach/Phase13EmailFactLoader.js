// A recipient address that received a first touch from any sender (SIM or any merchant) in
// this many days is not contacted again by anyone. Same value as migration 069.
export const RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS=30;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const human=value=>String(value||'').trim().toLowerCase().replace(/_/g,' ').replace(/\b\w/g,char=>char.toUpperCase());
const companyTypes=value=>{
  const text=String(value||'').toUpperCase();
  return ['IMPORTER','WHOLESALER','DISTRIBUTOR','RETAILER','DEPARTMENT_STORE']
    .filter(type=>text.includes(type.replace('_',' ')));
};

/**
 * Reads only persisted, independently verifiable facts used by the MC07 gate.
 * It never creates a recipient, opportunity, category match, or authorization.
 */
// merchantId: earlier contact is counted per sender (SIM = NULL, or one merchant); suppressions stay global,
// and so does the recipient cooldown: a first touch from any sender blocks the address for every sender.
export async function loadPhase13EmailEligibilityFacts(pool,companyId,{reservationId=null,client=pool,replyToEmail=null,merchantId=null}={}){
  if(!pool?.query||!client?.query)throw new TypeError('queryable pool and client are required');
  if(!UUID.test(String(companyId||'')))throw Object.assign(new Error('company_id must be a UUID'),{code:'PHASE13_INVALID_COMPANY_ID'});
  if(reservationId!==null&&!UUID.test(String(reservationId)))throw Object.assign(new Error('reservation_id must be a UUID'),{code:'PHASE13_INVALID_RESERVATION_ID'});
  const result=await client.query(`WITH candidate AS (
    SELECT c.id,c.company_name,c.company_type,c.country_code,c.verification_status,c.lifecycle_status,
      p.opportunity_pool_band,p.is_active_business_opportunity,p.profile_results,
      market.market_code,market.country_name,market.status market_status,market.search_enabled,
      market.timezone,market.business_send_window,
      recipient.outreach_recipient_id recipient_id,recipient.normalized_recipient,recipient.verification_status recipient_verification_status,
      recipient.verified_at,recipient.lifecycle_status recipient_lifecycle_status,recipient.recipient_type,
      recipient.recipient_source_class,recipient.recipient_domain_verified,
      recipient.contact_id,recipient.decision_maker_contact_id,
      contact.evidence_origin contact_evidence_origin,contact.source_url contact_source_url,
      contact.is_generic,contact.is_department,maker.person_name,maker.verification_status maker_verification_status,
      category.id category_id,category.normalized_category,profile.product_profile,
      existing.reply_to existing_reply_to
    FROM leadgen.companies c
    LEFT JOIN leadgen.opportunity_pool_current p ON p.company_id=c.id
    LEFT JOIN leadgen.research_market_registry market ON market.market_code=c.country_code
    LEFT JOIN LATERAL (
      SELECT route.* FROM (
        SELECT r.id outreach_recipient_id,r.contact_id,r.decision_maker_contact_id,r.normalized_recipient,
          r.verification_status,r.verified_at,r.lifecycle_status,r.recipient_type,
          r.recipient_source_class,r.recipient_domain_verified
        FROM leadgen.outreach_recipients r
        WHERE r.company_id=c.id AND r.channel='EMAIL'
        UNION ALL
        SELECT NULL::uuid outreach_recipient_id,NULL::uuid contact_id,dc.id decision_maker_contact_id,
          lower(btrim(dc.contact_value_normalized)) normalized_recipient,dc.verification_status,
          dc.last_verified_at verified_at,dm.lifecycle_status,
          CASE WHEN dc.is_generic THEN 'OFFICIAL_COMPANY_EMAIL'
               WHEN dc.is_department THEN 'OFFICIAL_DEPARTMENT_EMAIL'
               WHEN dm.person_name IS NOT NULL AND dm.verification_status='VERIFIED' THEN 'NAMED_BUYER_EMAIL'
               ELSE 'OFFICIAL_COMPANY_EMAIL' END recipient_type,
          'VERIFIED_DECISION_MAKER_CONTACT' recipient_source_class,true recipient_domain_verified
        FROM leadgen.decision_maker_contacts dc
        JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
        WHERE dm.company_id=c.id
          AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
      ) route
      ORDER BY (route.verification_status='VALID') DESC,(route.lifecycle_status='ACTIVE') DESC,
        route.recipient_domain_verified DESC,route.verified_at DESC NULLS LAST,
        route.outreach_recipient_id NULLS LAST,route.decision_maker_contact_id
      LIMIT 1
    ) recipient ON true
    LEFT JOIN leadgen.decision_maker_contacts contact ON contact.id=recipient.decision_maker_contact_id
    LEFT JOIN leadgen.decision_makers maker ON maker.id=contact.decision_maker_id
    LEFT JOIN LATERAL (
      SELECT item.value FROM jsonb_array_elements(coalesce(p.profile_results,'[]'::jsonb)) item(value)
      WHERE item.value->>'band' IN('PRECISION','RELEVANT','GENERAL_RELEVANT')
        AND jsonb_array_length(coalesce(item.value->'scope_ids','[]'::jsonb))>0
      ORDER BY CASE item.value->>'band' WHEN 'PRECISION' THEN 1 WHEN 'RELEVANT' THEN 2 ELSE 3 END,
        item.value->>'product_profile' LIMIT 1
    ) profile_row ON true
    LEFT JOIN LATERAL (
      SELECT scope_id::uuid id FROM jsonb_array_elements_text(coalesce(profile_row.value->'scope_ids','[]'::jsonb)) scope_id LIMIT 1
    ) scope_ref ON true
    LEFT JOIN leadgen.dpv_product_category_scope_current category ON category.id=scope_ref.id
    LEFT JOIN LATERAL (SELECT profile_row.value->>'product_profile' product_profile) profile ON true
    LEFT JOIN leadgen.phase13_first_touch_reservations existing ON existing.id=$2 AND existing.company_id=c.id
    WHERE c.id=$1
  ) SELECT candidate.*,
    EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links link JOIN leadgen.historical_customers customer
      ON customer.id=link.historical_customer_id WHERE link.company_id=candidate.id AND link.link_status='CONFIRMED'
      AND customer.customer_role='INTERNAL_EXISTING_CUSTOMER') confirmed_existing_customer,
    EXISTS(SELECT 1 FROM leadgen.company_suppressions suppression
      WHERE suppression.company_id=candidate.id AND suppression.lifted_at IS NULL) company_suppressed,
    EXISTS(SELECT 1 FROM leadgen.contact_suppressions suppression
      WHERE suppression.company_id=candidate.id AND suppression.lifted_at IS NULL AND (
        (candidate.contact_id IS NOT NULL AND suppression.contact_id=candidate.contact_id) OR
        (candidate.decision_maker_contact_id IS NOT NULL AND suppression.decision_maker_contact_id=candidate.decision_maker_contact_id) OR
        (suppression.normalized_recipient_hash IS NOT NULL AND suppression.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(candidate.normalized_recipient)),'UTF8')),'hex'))
      )) OR EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions suppression
        WHERE suppression.company_id=candidate.id AND suppression.lifted_at IS NULL
        AND suppression.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(candidate.normalized_recipient)),'UTF8')),'hex')) contact_suppressed,
    EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions suppression
      WHERE suppression.company_id=candidate.id AND suppression.lifted_at IS NULL AND suppression.suppression_type='OPT_OUT'
      AND suppression.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(candidate.normalized_recipient)),'UTF8')),'hex')) opted_out,
    EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions suppression
      WHERE suppression.company_id=candidate.id AND suppression.lifted_at IS NULL AND suppression.suppression_type='HARD_BOUNCE'
      AND suppression.normalized_recipient_hash=encode(sha256(convert_to(lower(btrim(candidate.normalized_recipient)),'UTF8')),'hex'))
      OR EXISTS(SELECT 1 FROM leadgen.outbound_messages message WHERE message.company_id=candidate.id
        AND message.send_status='HARD_BOUNCED' AND ($2::uuid IS NULL OR message.first_touch_reservation_id IS DISTINCT FROM $2)) hard_bounced,
    EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations reservation WHERE reservation.company_id=candidate.id
      AND reservation.merchant_id IS NOT DISTINCT FROM $3::uuid AND ($2::uuid IS NULL OR reservation.id<>$2) AND reservation.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')) has_prior_first_touch,
    EXISTS(SELECT 1 FROM leadgen.outbound_messages message WHERE message.company_id=candidate.id
      AND message.merchant_id IS NOT DISTINCT FROM $3::uuid AND ($2::uuid IS NULL OR message.first_touch_reservation_id IS DISTINCT FROM $2)
      AND (message.sent_at IS NOT NULL OR message.transport_status='SMTP_ACCEPTED' OR message.send_status IN('PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS'))) has_prior_company_contact,
    EXISTS(SELECT 1 FROM leadgen.inbound_messages inbound WHERE inbound.correlation_outbound_message_id IN(
      SELECT message.id FROM leadgen.outbound_messages message WHERE message.company_id=candidate.id AND message.merchant_id IS NOT DISTINCT FROM $3::uuid)
      AND inbound.correlation_status='MATCHED') has_reply,
    EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations reservation
      WHERE lower(btrim(reservation.normalized_recipient))=lower(btrim(candidate.normalized_recipient))
        AND ($2::uuid IS NULL OR reservation.id<>$2) AND reservation.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
        AND reservation.reserved_at>=now()-make_interval(days=>${RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS})) recipient_recently_contacted,
    ($3::uuid IS NULL AND EXISTS(SELECT 1 FROM leadgen.merchant_companies assignment WHERE assignment.company_id=candidate.id)) company_assigned_to_merchant
  FROM candidate`,[companyId,reservationId,merchantId]);
  if(!result.rowCount)return{company:{id:companyId},recipient:null,market:{},company_types:[],verified_template_fields:[],template_variables:{}};
  const row=result.rows[0];
  const recipient=row.decision_maker_contact_id||row.recipient_id?{
    id:row.recipient_id||row.decision_maker_contact_id,outreach_recipient_id:row.recipient_id,
    decision_maker_contact_id:row.decision_maker_contact_id,
    normalized_recipient:String(row.normalized_recipient||'').trim().toLowerCase(),
    verification_status:row.recipient_verification_status,verified_at:row.verified_at,
    lifecycle_status:row.recipient_lifecycle_status,recipient_type:row.recipient_type,
    official_source_verified:['VERIFIED_DECISION_MAKER_CONTACT','OFFICIAL_WEBSITE','OFFICIAL_COMPANY_SOURCE'].includes(row.recipient_source_class)
      ||(row.contact_evidence_origin==='OFFICIAL_SITE_OBSERVED'&&Boolean(row.contact_source_url)),
    domain_verified:row.recipient_domain_verified===true,generic_mailbox:row.is_generic===true,
    named_person_verified:Boolean(row.person_name)&&row.maker_verification_status==='VERIFIED',
  }:null;
  const category=human(row.normalized_category);const replyTo=String(replyToEmail||row.existing_reply_to||'').trim().toLowerCase();
  const variables={category,target_category:category,company:row.company_name,matched_category:category,
    market:row.country_name,reply_to:replyTo,first_name:String(row.person_name||'').trim().split(/\s+/)[0]||null};
  const verified=[];
  if(row.company_name)verified.push('company');
  if(row.market_code&&row.country_name&&row.market_status==='ACTIVE')verified.push('market');
  if(row.category_id&&category)verified.push('category','target_category','matched_category');
  if(EMAIL.test(replyTo))verified.push('reply_to');
  if(recipient?.named_person_verified&&variables.first_name)verified.push('first_name');
  const progress=row.opted_out?'OPTED_OUT':row.hard_bounced?'BOUNCED':row.has_reply?'REPLIED':row.has_prior_company_contact?'SENT_NO_REPLY':null;
  return{
    company:{id:row.id,company_name:row.company_name,verification_status:row.verification_status,lifecycle_status:row.lifecycle_status},
    company_types:companyTypes(row.company_type),recipient,
    market:{market_code:row.market_code,country_name:row.country_name,status:row.market_status,search_enabled:row.search_enabled,timezone:row.timezone,business_send_window:row.business_send_window},
    category_id:row.category_id,product_profile:row.product_profile,opportunity_pool_band:row.opportunity_pool_band,
    is_active_business_opportunity:row.is_active_business_opportunity===true,
    confirmed_existing_customer:row.confirmed_existing_customer===true,company_suppressed:row.company_suppressed===true,
    contact_suppressed:row.contact_suppressed===true,opted_out:row.opted_out===true,hard_bounced:row.hard_bounced===true,
    has_prior_first_touch:row.has_prior_first_touch===true,has_prior_company_contact:row.has_prior_company_contact===true,
    recipient_recently_contacted:row.recipient_recently_contacted===true,company_assigned_to_merchant:row.company_assigned_to_merchant===true,
    contact_progress_status:progress,template_variables:variables,verified_template_fields:verified,
  };
}

export function createPhase13EmailEligibilityFactLoader({pool,replyToEmail=null}={}){
  if(!pool?.query)throw new TypeError('pool.query is required');
  return(companyId,options={})=>loadPhase13EmailEligibilityFacts(pool,companyId,{...options,replyToEmail:options.replyToEmail??replyToEmail});
}
