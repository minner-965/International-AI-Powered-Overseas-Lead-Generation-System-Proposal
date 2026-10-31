import {evaluateContactVerification} from './eligibility.js';
import {companyRootDomain,emailMatchesCompanyDomain,isFreeWebmail,sourceOnCompanySite} from '../verification/contactVerificationPolicy.js';
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


const bool=value=>value===true||value==='t'||value==='true';
// Routes come from the single fact query as a JSON array. A row without it (older callers and unit
// doubles) carries one route in flat columns.
export function recipientRoutesFromRow(row={}){
  if(Array.isArray(row.recipient_routes))return row.recipient_routes;
  if(!row.recipient_id&&!row.decision_maker_contact_id)return[];
  return[{outreach_recipient_id:row.recipient_id||null,contact_id:row.contact_id||null,decision_maker_contact_id:row.decision_maker_contact_id||null,
    normalized_recipient:row.normalized_recipient,verification_status:row.recipient_verification_status,verification_score:row.recipient_verification_score??null,
    verified_at:row.verified_at,lifecycle_status:row.recipient_lifecycle_status,recipient_type:row.recipient_type,
    recipient_source_class:row.recipient_source_class,recipient_domain_verified:row.recipient_domain_verified,
    evidence_origin:row.contact_evidence_origin,source_url:row.contact_source_url,is_generic:row.is_generic,is_department:row.is_department,
    person_name:row.person_name,maker_verification_status:row.maker_verification_status,
    contact_suppressed:row.contact_suppressed,opted_out:row.opted_out,hard_bounced:row.hard_bounced,recipient_recently_contacted:row.recipient_recently_contacted}];
}
const OFFICIAL_SOURCE_CLASSES=new Set(['OFFICIAL_WEBSITE','OFFICIAL_COMPANY_SOURCE']);
/** Recipient facts for one route. Domain-verified only when the address is on the company's root domain. */
export function recipientFromRoute(route={},{rootDomain=null}={}){
  const email=String(route.normalized_recipient||'').trim().toLowerCase();
  const publishedOnSite=OFFICIAL_SOURCE_CLASSES.has(String(route.recipient_source_class||'').toUpperCase())
    ||(String(route.evidence_origin||'').toUpperCase()==='OFFICIAL_SITE_OBSERVED'&&sourceOnCompanySite(route.source_url,rootDomain));
  return{
    id:route.outreach_recipient_id||route.decision_maker_contact_id,outreach_recipient_id:route.outreach_recipient_id||null,
    decision_maker_contact_id:route.decision_maker_contact_id||null,normalized_recipient:email,
    verification_status:route.verification_status,verification_score:route.verification_score==null?null:Number(route.verification_score),
    verified_at:route.verified_at,lifecycle_status:route.lifecycle_status,recipient_type:route.recipient_type,
    official_source_verified:publishedOnSite,
    domain_verified:emailMatchesCompanyDomain(email,rootDomain),
    free_webmail:isFreeWebmail(email),generic_mailbox:bool(route.is_generic),
    named_person_verified:Boolean(route.person_name)&&String(route.maker_verification_status||'').toUpperCase()==='VERIFIED',
  };
}
const ROUTE_TYPES=new Set(['NAMED_BUYER_EMAIL','OFFICIAL_COMPANY_EMAIL','OFFICIAL_DEPARTMENT_EMAIL']);
function routeBlocks(route,recipient,{now,ttlDays}){
  const codes=[];
  if(bool(route.opted_out))codes.push('OPTED_OUT');
  if(bool(route.contact_suppressed))codes.push('SUPPRESSED');
  if(bool(route.hard_bounced))codes.push('HARD_BOUNCED');
  if(bool(route.recipient_recently_contacted))codes.push('RECIPIENT_RECENTLY_CONTACTED');
  if(!EMAIL.test(recipient.normalized_recipient))codes.push('RECIPIENT_IDENTITY_INVALID');
  if(String(recipient.lifecycle_status||'').toUpperCase()!=='ACTIVE')codes.push('RECIPIENT_NOT_ACTIVE');
  if(!ROUTE_TYPES.has(String(recipient.recipient_type||'').toUpperCase())||!(recipient.domain_verified||recipient.official_source_verified))codes.push('RECIPIENT_ROUTE_NOT_VERIFIED');
  if(recipient.free_webmail&&!recipient.official_source_verified)codes.push('WEBMAIL_NOT_PUBLISHED_ON_COMPANY_SITE');
  codes.push(...evaluateContactVerification({verification_status:recipient.verification_status,verification_score:recipient.verification_score,
    last_verified_at:recipient.verified_at},{now,ttlDays}).reason_codes);
  return codes;
}
const STOP=new Set(['OPTED_OUT','SUPPRESSED','HARD_BOUNCED','RECIPIENT_RECENTLY_CONTACTED']);
/**
 * C3: evaluate the company's addresses in order and use the first one that can receive a first touch.
 * A suppressed, opted-out, bounced or recently contacted address is skipped, not fatal for the company.
 * When none is usable the best-ranked one is returned so the gate reports its exact reason.
 */
export function selectRecipientRoute(routes=[],{rootDomain=null,now=new Date(),ttlDays=null}={}){
  const seen=new Set();
  const rows=[];
  for(const route of Array.isArray(routes)?routes:[]){
    const recipient=recipientFromRoute(route,{rootDomain});
    const key=`${recipient.normalized_recipient}|${recipient.outreach_recipient_id||''}|${recipient.decision_maker_contact_id||''}`;
    if(!recipient.normalized_recipient||seen.has(key))continue;seen.add(key);
    const reasons=routeBlocks(route,recipient,{now,ttlDays});
    rows.push({route,recipient,reasons,stopped:reasons.some(code=>STOP.has(code))});
  }
  const status=value=>String(value||'').toUpperCase()==='VALID'?0:String(value||'').toUpperCase()==='ACCEPT_ALL'?1:2;
  const time=value=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:0;};
  rows.sort((a,b)=>(a.reasons.length?1:0)-(b.reasons.length?1:0)||(a.stopped?1:0)-(b.stopped?1:0)
    ||status(a.recipient.verification_status)-status(b.recipient.verification_status)
    ||Number(b.recipient.domain_verified||b.recipient.official_source_verified)-Number(a.recipient.domain_verified||a.recipient.official_source_verified)
    ||time(b.recipient.verified_at)-time(a.recipient.verified_at)
    ||(a.recipient.outreach_recipient_id?0:1)-(b.recipient.outreach_recipient_id?0:1)
    ||a.recipient.normalized_recipient.localeCompare(b.recipient.normalized_recipient));
  const chosen=rows[0]||null;
  return{recipient:chosen?.recipient||null,route:chosen?.route||null,
    evaluated:rows.map(row=>({normalized_recipient:row.recipient.normalized_recipient,usable:row.reasons.length===0,reason_codes:row.reasons}))};
}

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
      c.official_root_domain,c.website_url,route_set.routes recipient_routes,
      category.id category_id,category.normalized_category,profile.product_profile,
      existing.reply_to existing_reply_to
    FROM leadgen.companies c
    LEFT JOIN leadgen.opportunity_pool_current p ON p.company_id=c.id
    LEFT JOIN leadgen.research_market_registry market ON market.market_code=c.country_code
    LEFT JOIN LATERAL (
      -- C3: every email route of the company with its own address-level stop flags; the loader picks
      -- the first usable one, so one suppressed or bounced address no longer blocks the company.
      SELECT coalesce(jsonb_agg(to_jsonb(flagged) ORDER BY flagged.route_order),'[]'::jsonb) routes FROM (
        SELECT route.*,row_number() OVER (ORDER BY route.outreach_recipient_id NULLS LAST,route.decision_maker_contact_id,route.normalized_recipient) route_order,
          encode(sha256(convert_to(lower(btrim(route.normalized_recipient)),'UTF8')),'hex') recipient_hash
        FROM (
          SELECT r.id outreach_recipient_id,r.contact_id,r.decision_maker_contact_id,lower(btrim(r.normalized_recipient)) normalized_recipient,
            r.verification_status,dc.verification_score,r.verified_at,r.lifecycle_status,r.recipient_type,
            r.recipient_source_class,r.recipient_domain_verified,dc.evidence_origin,dc.source_url,
            coalesce(dc.is_generic,false) is_generic,coalesce(dc.is_department,false) is_department,
            dm.person_name,dm.verification_status maker_verification_status
          FROM leadgen.outreach_recipients r
          LEFT JOIN leadgen.decision_maker_contacts dc ON dc.id=r.decision_maker_contact_id
          LEFT JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE r.company_id=c.id AND r.channel='EMAIL'
          UNION ALL
          SELECT NULL::uuid,NULL::uuid,dc.id,lower(btrim(dc.contact_value_normalized)),dc.verification_status,dc.verification_score,
            dc.last_verified_at,dm.lifecycle_status,
            CASE WHEN dc.is_generic THEN 'OFFICIAL_COMPANY_EMAIL'
                 WHEN dc.is_department THEN 'OFFICIAL_DEPARTMENT_EMAIL'
                 WHEN dm.person_name IS NOT NULL AND dm.verification_status='VERIFIED' THEN 'NAMED_BUYER_EMAIL'
                 ELSE 'OFFICIAL_COMPANY_EMAIL' END,
            'VERIFIED_DECISION_MAKER_CONTACT',NULL::boolean,dc.evidence_origin,dc.source_url,dc.is_generic,dc.is_department,
            dm.person_name,dm.verification_status
          FROM leadgen.decision_maker_contacts dc
          JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id
            AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
            AND NOT EXISTS(SELECT 1 FROM leadgen.outreach_recipients r WHERE r.company_id=c.id AND r.channel='EMAIL' AND r.decision_maker_contact_id=dc.id)
        ) route WHERE coalesce(route.normalized_recipient,'')<>''
      ) base
      CROSS JOIN LATERAL (SELECT base.*,
        (EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL AND (
            (base.contact_id IS NOT NULL AND s.contact_id=base.contact_id) OR
            (base.decision_maker_contact_id IS NOT NULL AND s.decision_maker_contact_id=base.decision_maker_contact_id) OR
            s.normalized_recipient_hash=base.recipient_hash))
          OR EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL
            AND s.normalized_recipient_hash=base.recipient_hash)) contact_suppressed,
        EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL
          AND s.suppression_type='OPT_OUT' AND s.normalized_recipient_hash=base.recipient_hash) opted_out,
        (EXISTS(SELECT 1 FROM leadgen.outreach_recipient_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL
            AND s.suppression_type='HARD_BOUNCE' AND s.normalized_recipient_hash=base.recipient_hash)
          OR EXISTS(SELECT 1 FROM leadgen.outbound_messages m
            LEFT JOIN leadgen.outreach_recipients mr ON mr.id=m.recipient_id
            LEFT JOIN leadgen.phase13_first_touch_reservations mt ON mt.id=m.first_touch_reservation_id
            WHERE m.company_id=c.id AND m.send_status='HARD_BOUNCED'
              AND ($2::uuid IS NULL OR m.first_touch_reservation_id IS DISTINCT FROM $2)
              AND lower(btrim(coalesce(mr.normalized_recipient,mt.normalized_recipient,'')))=base.normalized_recipient)) hard_bounced,
        EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations reservation
          WHERE lower(btrim(reservation.normalized_recipient))=base.normalized_recipient
            AND ($2::uuid IS NULL OR reservation.id<>$2) AND reservation.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')
            AND reservation.reserved_at>=now()-make_interval(days=>${RECIPIENT_FIRST_TOUCH_COOLDOWN_DAYS})) recipient_recently_contacted
      ) flagged
    ) route_set ON true
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
    EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations reservation WHERE reservation.company_id=candidate.id
      AND reservation.merchant_id IS NOT DISTINCT FROM $3::uuid AND ($2::uuid IS NULL OR reservation.id<>$2) AND reservation.status IN('RESERVED','SENDING','PROVIDER_ACCEPTED','AMBIGUOUS')) has_prior_first_touch,
    EXISTS(SELECT 1 FROM leadgen.outbound_messages message WHERE message.company_id=candidate.id
      AND message.merchant_id IS NOT DISTINCT FROM $3::uuid AND ($2::uuid IS NULL OR message.first_touch_reservation_id IS DISTINCT FROM $2)
      AND (message.sent_at IS NOT NULL OR message.transport_status='SMTP_ACCEPTED' OR message.send_status IN('PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS'))) has_prior_company_contact,
    EXISTS(SELECT 1 FROM leadgen.inbound_messages inbound WHERE inbound.correlation_outbound_message_id IN(
      SELECT message.id FROM leadgen.outbound_messages message WHERE message.company_id=candidate.id AND message.merchant_id IS NOT DISTINCT FROM $3::uuid)
      AND inbound.correlation_status='MATCHED') has_reply,
    ($3::uuid IS NULL AND EXISTS(SELECT 1 FROM leadgen.merchant_companies assignment WHERE assignment.company_id=candidate.id)) company_assigned_to_merchant
  FROM candidate`,[companyId,reservationId,merchantId]);
  if(!result.rowCount)return{company:{id:companyId},recipient:null,market:{},company_types:[],verified_template_fields:[],template_variables:{}};
  const row=result.rows[0];
  const choice=selectRecipientRoute(recipientRoutesFromRow(row),{rootDomain:companyRootDomain(row)});
  const recipient=choice.recipient;
  Object.assign(row,{person_name:choice.route?.person_name||null,contact_suppressed:choice.route?.contact_suppressed===true,
    opted_out:choice.route?.opted_out===true,hard_bounced:choice.route?.hard_bounced===true,
    recipient_recently_contacted:choice.route?.recipient_recently_contacted===true});
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
    recipient_candidates:choice.evaluated,
  };
}

export function createPhase13EmailEligibilityFactLoader({pool,replyToEmail=null}={}){
  if(!pool?.query)throw new TypeError('pool.query is required');
  return(companyId,options={})=>loadPhase13EmailEligibilityFacts(pool,companyId,{...options,replyToEmail:options.replyToEmail??replyToEmail});
}
