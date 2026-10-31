import {evaluateContactVerification} from './eligibility.js';
import {FIRST_TOUCH_TEMPLATE_SET,recipientRouteVerified,selectFirstTouchTemplate} from './firstTouchTemplates.js';
import {isFreeWebmail} from '../verification/contactVerificationPolicy.js';
const upper=value=>String(value??'').trim().toUpperCase();
export const AUTO_FIRST_TOUCH_BANDS=Object.freeze(['PRECISION','RELEVANT','GENERAL_RELEVANT']);
export const AUTO_FIRST_TOUCH_RECIPIENT_TYPES=Object.freeze(['NAMED_BUYER_EMAIL','OFFICIAL_COMPANY_EMAIL','OFFICIAL_DEPARTMENT_EMAIL']);
const stopped=new Set(['SENT_NO_REPLY','REPLIED','OPTED_OUT','BOUNCED','STOP_CONTACT','DO_NOT_CONTACT','SEND_AMBIGUOUS']);
export function evaluateBusinessSendWindow(market={},now=new Date()){
 if(!market.timezone)return{allowed:false,reason:'EMAIL_AUTO_SEND_PAUSED_MISSING_TIMEZONE'};
 let parts;try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:market.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));}
 catch{return{allowed:false,reason:'EMAIL_AUTO_SEND_PAUSED_MISSING_TIMEZONE'};}
 const window=market.business_send_window||{},days=window.days;
 const minute=value=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||'')))return null;const[h,m]=value.split(':').map(Number);return h*60+m;};
 const start=minute(window.start),end=minute(window.end);
 if(!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<1||d>7)||start===null||end===null||end<=start)return{allowed:false,reason:'EMAIL_AUTO_SEND_PAUSED_MISSING_SEND_WINDOW'};
 const day={Sun:7,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[parts.weekday],time=Number(parts.hour)*60+Number(parts.minute);
 return days.includes(day)&&time>=start&&time<end?{allowed:true,reason:null}:{allowed:false,reason:'EMAIL_AUTO_SEND_PAUSED_OUTSIDE_WINDOW'};
}
// Independent Phase13 projection: never fabricates legacy approval/FIT rows.
export function evaluatePhase13EmailEligibility(facts={},policy={},now=new Date()){
 const reasons=[],recipient=facts.recipient||{},company=facts.company||{},market=facts.market||{};
 const template=selectFirstTouchTemplate({recipient,company_types:facts.company_types||[]});
 const add=(condition,code)=>{if(condition)reasons.push(code);};
 add(policy.mode!=='AUTO_FIRST_TOUCH','MANUAL_REVIEW_MODE');
 add(policy.automated_acquisition!==true,'AUTOMATED_ACQUISITION_OFF');
 add(policy.auto_first_touch_email!==true,'AUTO_FIRST_TOUCH_PAUSED');
 add(policy.template_set_key!==FIRST_TOUCH_TEMPLATE_SET||policy.template_set_status!=='APPROVED','TEMPLATE_SET_NOT_APPROVED');
 add(!policy.policy_revision,'FIRST_TOUCH_POLICY_REVISION_REQUIRED');
 const band=upper(facts.opportunity_pool_band);
 add(!AUTO_FIRST_TOUCH_BANDS.includes(band)||!(policy.allowed_bands||AUTO_FIRST_TOUCH_BANDS).includes(band)||facts.is_active_business_opportunity!==true,'BUSINESS_OPPORTUNITY_NOT_ELIGIBLE');
 add(upper(company.verification_status)!=='VERIFIED','COMPANY_NOT_VERIFIED');add(upper(company.lifecycle_status)!=='ACTIVE','COMPANY_NOT_ACTIVE');
 add(facts.confirmed_existing_customer===true,'EXISTING_CUSTOMER');
 add(!Array.isArray(policy.allowed_markets)||!policy.allowed_markets.includes(market.market_code),'MARKET_NOT_ALLOWED');
 add(!Array.isArray(policy.allowed_category_ids)||!policy.allowed_category_ids.includes(facts.category_id),'CATEGORY_NOT_ALLOWED');
 add(market.status!=='ACTIVE'||market.search_enabled!==true,'MARKET_NOT_ACTIVE');
 const email=String(recipient.normalized_recipient||recipient.email||'').trim().toLowerCase();
 add(!email,'NO_VERIFIED_EMAIL_FOUND');
 add(Boolean(email)&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email),'RECIPIENT_IDENTITY_INVALID');
 // C3/C7: any business mailbox of the company is acceptable (named person not required) when it is on the
 // company's own domain or published on the company's own website; a free webmail address only in the latter case.
 add(Boolean(email)&&(!AUTO_FIRST_TOUCH_RECIPIENT_TYPES.includes(upper(recipient.recipient_type))||!recipientRouteVerified(recipient)),'RECIPIENT_ROUTE_NOT_VERIFIED');
 add(Boolean(email)&&isFreeWebmail(email)&&recipient.official_source_verified!==true,'WEBMAIL_NOT_PUBLISHED_ON_COMPANY_SITE');
 add(Boolean(email)&&upper(recipient.lifecycle_status)!=='ACTIVE','RECIPIENT_NOT_ACTIVE');
 if(email){const result=evaluateContactVerification({verification_status:recipient.verification_status,verification_score:recipient.verification_score,last_verified_at:recipient.verified_at||recipient.last_verified_at},{now,ttlDays:policy.verification_ttl_days||null,allowAcceptAllSend:false});reasons.push(...result.reason_codes);}
 add(facts.company_suppressed===true||facts.contact_suppressed===true||facts.opted_out===true,'SUPPRESSED');
 add(facts.hard_bounced===true,'HARD_BOUNCED');
 add(facts.has_prior_first_touch===true||facts.has_prior_company_contact===true||stopped.has(upper(facts.contact_progress_status)),'ALREADY_FIRST_CONTACTED');
 // Cross-sender protection: SIM leaves merchant-assigned companies alone, and one address gets at
 // most one first touch per cooldown period from SIM and all merchants together.
 add(facts.recipient_recently_contacted===true,'RECIPIENT_RECENTLY_CONTACTED');
 add(facts.company_assigned_to_merchant===true,'COMPANY_ASSIGNED_TO_MERCHANT');
 add(policy.sender_ready!==true,'SENDER_UNAVAILABLE');
 if(!template)add(true,'RECIPIENT_TEMPLATE_RESOLUTION_REQUIRED');
 const window=evaluateBusinessSendWindow(market,now);if(!window.allowed)reasons.push(window.reason);
 const unique=[...new Set(reasons)];
 return{status:unique.length?'AUTO_FIRST_TOUCH_BLOCKED':'AUTO_FIRST_TOUCH_ELIGIBLE',eligible:unique.length===0,
  reason_codes:unique,template_key:template,template_set_key:FIRST_TOUCH_TEMPLATE_SET,policy_revision:policy.policy_revision||null,
  opportunity_pool_band:band,is_active_business_opportunity:facts.is_active_business_opportunity===true,
  normalized_recipient:email||null,send_window:window,automatic_followup_allowed:false};
}
export function phase13EmailQueueState({eligibility={},reservation=null,contact_progress_status=null,has_email=false}={}){
 const reasons=eligibility.reason_codes||[],progress=upper(contact_progress_status),state=upper(reservation?.status);
 if(reasons.includes('SUPPRESSED')||progress==='OPTED_OUT')return'SUPPRESSED';
 if(reasons.includes('HARD_BOUNCED')||progress==='BOUNCED')return'HARD_BOUNCED';
 if(progress==='REPLIED')return'REPLIED';
 if(progress==='SENT_NO_REPLY'||state==='PROVIDER_ACCEPTED')return'SENT_NO_REPLY';
 if(state==='AMBIGUOUS'||progress==='SEND_AMBIGUOUS')return'SEND_AMBIGUOUS';
 if(reasons.includes('ALREADY_FIRST_CONTACTED'))return'ALREADY_FIRST_CONTACTED';
 if(!has_email||reasons.includes('NO_VERIFIED_EMAIL_FOUND'))return'NO_VERIFIED_EMAIL_FOUND';
 if(reasons.some(r=>r.startsWith('CONTACT_VERIFICATION')||r.startsWith('CONTACT_ACCEPT_ALL')||r==='MAILBOX_LEVEL_VERIFICATION_REQUIRED'))return'RECIPIENT_VERIFICATION_PENDING';
 if(state==='SENDING')return'SENDING';
 if(['RESERVED','QUEUED'].includes(state))return'AUTO_FIRST_TOUCH_QUEUED';
 if(eligibility.eligible)return'AUTO_FIRST_TOUCH_ELIGIBLE';
 return reasons[0]||'CONTACT_RESEARCH';
}
