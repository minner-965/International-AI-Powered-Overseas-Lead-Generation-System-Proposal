import test from 'node:test';
import assert from 'node:assert/strict';
import {FIRST_TOUCH_TEMPLATES,selectFirstTouchTemplate,renderFirstTouchTemplate} from '../src/outreach/firstTouchTemplates.js';
import {evaluateBusinessSendWindow,evaluatePhase13EmailEligibility,phase13EmailQueueState} from '../src/outreach/phase13EmailEligibility.js';
const now=new Date('2026-09-08T08:00:00Z');
const recipient={normalized_recipient:'buyer@example.test',verification_status:'VALID',verified_at:'2026-09-07T00:00:00Z',recipient_type:'NAMED_BUYER_EMAIL',official_source_verified:true,domain_verified:true,named_person_verified:true,lifecycle_status:'ACTIVE'};
const facts={company:{verification_status:'VERIFIED',lifecycle_status:'ACTIVE'},recipient,company_types:['IMPORTER'],opportunity_pool_band:'GENERAL_RELEVANT',is_active_business_opportunity:true,category_id:'dresses',market:{market_code:'AE',status:'ACTIVE',search_enabled:true,timezone:'Asia/Dubai',business_send_window:{days:[1,2,3,4,5],start:'09:00',end:'17:00'}}};
const policy={mode:'AUTO_FIRST_TOUCH',automated_acquisition:true,auto_first_touch_email:true,template_set_key:'DPV_FIRST_TOUCH_V1',template_set_status:'APPROVED',policy_revision:'V1',sender_ready:true,allowed_markets:['AE'],allowed_category_ids:['dresses']};
test('approved A/B/C deterministic precedence and generic identity separation',()=>{
 assert.equal(selectFirstTouchTemplate({recipient,company_types:['IMPORTER']}),'A_NAMED_BUYER');
 assert.equal(selectFirstTouchTemplate({recipient:{...recipient,named_person_verified:false,recipient_type:'OFFICIAL_DEPARTMENT_EMAIL'},company_types:['IMPORTER']}),'B_IMPORTER_WHOLESALER_DISTRIBUTOR');
 assert.equal(selectFirstTouchTemplate({recipient:{...recipient,normalized_recipient:'info@example.test',recipient_type:'OFFICIAL_COMPANY_EMAIL'},company_types:['IMPORTER']}),'C_OFFICIAL_GENERIC_MAILBOX');
 assert.equal(selectFirstTouchTemplate({recipient:{...recipient,normalized_recipient:'info@example.test'},company_types:['IMPORTER']}),null);
 assert.equal(selectFirstTouchTemplate({recipient:{...recipient,official_source_verified:false}}),null);
 assert.equal(selectFirstTouchTemplate({recipient:{...recipient,verification_status:'ACCEPT_ALL'}}),null);
});
test('exact approved immutable template renders Simon and verified variables only',()=>{
 const variables={category:'Dresses',target_category:'dresses',company:'Example',matched_category:'dresses',market:'UAE',reply_to:'sender@example.test',first_name:'Alice'},verified_fields=Object.keys(variables);
 const draft=renderFirstTouchTemplate({template_key:'A_NAMED_BUYER',variables,verified_fields});
 assert.equal(draft.sender_display_name,'Simon');assert.equal(draft.subject,'Dresses supply for Example');assert.match(draft.body_text,/Hi Alice,/);assert.match(draft.body_text,/Best regards,\nSimon\nDPV International\nsender@example.test$/);assert.deepEqual(draft.followups,[]);
 assert.equal(Object.isFrozen(FIRST_TOUCH_TEMPLATES.A_NAMED_BUYER),true);assert.equal(Object.isFrozen(draft),true);
 assert.throws(()=>renderFirstTouchTemplate({template_key:'E04',variables,verified_fields}),{code:'FIRST_TOUCH_TEMPLATE_NOT_APPROVED'});
 assert.throws(()=>renderFirstTouchTemplate({template_key:'A_NAMED_BUYER',variables,verified_fields:[]}),{code:'FIRST_TOUCH_VERIFIED_VARIABLE_REQUIRED'});
 assert.throws(()=>renderFirstTouchTemplate({template_key:'A_NAMED_BUYER',variables:{...variables,company:'Example\nFake claim'},verified_fields}),{code:'FIRST_TOUCH_VERIFIED_VARIABLE_REQUIRED'});
 const b=renderFirstTouchTemplate({template_key:'B_IMPORTER_WHOLESALER_DISTRIBUTOR',variables,verified_fields});assert.match(b.body_text,/Hi Team,/);assert.match(b.body_text,/If you are currently reviewing this category/);
});
test('positive MC04 bands independently permit current verified route without manual rows',()=>{
 for(const band of ['PRECISION','RELEVANT','GENERAL_RELEVANT'])assert.equal(evaluatePhase13EmailEligibility({...facts,opportunity_pool_band:band},policy,now).eligible,true);
 for(const band of ['EXPLORATORY','NOT_SUITABLE'])assert.ok(evaluatePhase13EmailEligibility({...facts,opportunity_pool_band:band},policy,now).reason_codes.includes('BUSINESS_OPPORTUNITY_NOT_ELIGIBLE'));
 assert.equal(evaluatePhase13EmailEligibility({...facts,review_flags:['REVIEW_WARNING']},policy,now).eligible,true);
});
test('manual mode and master OFF do not authorize automatic sends',()=>{
 assert.ok(evaluatePhase13EmailEligibility(facts,{...policy,mode:'REVIEW_EACH'},now).reason_codes.includes('MANUAL_REVIEW_MODE'));
 assert.ok(evaluatePhase13EmailEligibility(facts,{...policy,automated_acquisition:false},now).reason_codes.includes('AUTOMATED_ACQUISITION_OFF'));
});
test('suppression bounce previous contact and sender health fail closed',()=>{
 for(const [field,reason] of [['company_suppressed','SUPPRESSED'],['contact_suppressed','SUPPRESSED'],['hard_bounced','HARD_BOUNCED'],['has_prior_first_touch','ALREADY_FIRST_CONTACTED']])assert.ok(evaluatePhase13EmailEligibility({...facts,[field]:true},policy,now).reason_codes.includes(reason));
 assert.ok(evaluatePhase13EmailEligibility(facts,{...policy,sender_ready:false},now).reason_codes.includes('SENDER_UNAVAILABLE'));
 assert.ok(evaluatePhase13EmailEligibility({...facts,recipient:{...recipient,verified_at:'2020-01-01'}},policy,now).reason_codes.includes('CONTACT_VERIFICATION_EXPIRED'));
 assert.ok(evaluatePhase13EmailEligibility({...facts,recipient:{...recipient,verification_status:'DOMAIN_MX_VERIFIED'}},policy,now).reason_codes.includes('MAILBOX_LEVEL_VERIFICATION_REQUIRED'));
});
test('market/category allowlist and explicit local sendwindow required',()=>{
 assert.ok(evaluatePhase13EmailEligibility(facts,{...policy,allowed_markets:[]},now).reason_codes.includes('MARKET_NOT_ALLOWED'));
 assert.ok(evaluatePhase13EmailEligibility(facts,{...policy,allowed_category_ids:[]},now).reason_codes.includes('CATEGORY_NOT_ALLOWED'));
 assert.equal(evaluateBusinessSendWindow({},now).reason,'EMAIL_AUTO_SEND_PAUSED_MISSING_TIMEZONE');
 assert.equal(evaluateBusinessSendWindow({...facts.market,timezone:'Unknown/Timezone'},now).allowed,false);
 assert.equal(evaluateBusinessSendWindow(facts.market,new Date('2026-09-08T20:00:00Z')).reason,'EMAIL_AUTO_SEND_PAUSED_OUTSIDE_WINDOW');
});
test('queue UI reasons separate missing email, verification, queued and actual sent',()=>{
 assert.equal(phase13EmailQueueState({eligibility:{eligible:false},has_email:false}),'NO_VERIFIED_EMAIL_FOUND');
 assert.equal(phase13EmailQueueState({eligibility:{reason_codes:['CONTACT_VERIFICATION_EXPIRED']},has_email:true}),'RECIPIENT_VERIFICATION_PENDING');
 assert.equal(phase13EmailQueueState({eligibility:{eligible:true},reservation:{status:'RESERVED'},has_email:true}),'AUTO_FIRST_TOUCH_QUEUED');
 assert.equal(phase13EmailQueueState({reservation:{status:'PROVIDER_ACCEPTED'},has_email:true}),'SENT_NO_REPLY');
 assert.equal(phase13EmailQueueState({eligibility:{reason_codes:['SUPPRESSED']},reservation:{status:'PROVIDER_ACCEPTED'},has_email:true}),'SUPPRESSED');
});
