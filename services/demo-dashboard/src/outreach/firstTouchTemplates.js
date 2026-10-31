import {buildContentHash} from './approvalDigest.js';
import {validateOutreachDraft} from './draftValidator.js';
import {applySenderSignature} from '../crm/followupTemplates.js';
import {acceptAllDecision} from '../verification/contactVerificationPolicy.js';

export const FIRST_TOUCH_TEMPLATE_SET='DPV_FIRST_TOUCH_V1';
export const FIRST_TOUCH_SENDER_NAME='Simon';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// Exact texts explicitly approved in MC07 Simon Template Set sections 14–16.
export const FIRST_TOUCH_TEMPLATES=freeze({
 A_NAMED_BUYER:{subject:'[Category] supply for [Company]',body_text:`Hi [First Name],

I’m Simon from SIM International. We supply [Target Category] for overseas retailers, importers and distributors.

I came across [Company] while researching businesses active in [Matched Category] in [Market].

Our focus is on commercially relevant products with reliable quality and competitive pricing, offering buyers a strong balance between quality and cost.

If this category is relevant to your team, I’d be happy to send a concise catalogue for review.

Would you be the right person to discuss this with?

Best regards,
Simon
SIM International
[Reply-To]`},
 B_IMPORTER_WHOLESALER_DISTRIBUTOR:{subject:'Competitive [Category] range for [Company]',body_text:`Hi [First Name or Team],

I’m Simon from SIM International. We supply [Target Category] to international importers, wholesalers and retail businesses.

I noticed that [Company] is active in [Matched Category] in [Market], so I wanted to introduce our range.

We focus on practical, commercially relevant products with reliable quality and competitive pricing. Our aim is to offer buyers a strong balance between product quality and cost.

If you are currently reviewing this category, I’d be glad to send you a short catalogue for consideration.

Would this be relevant to your business?

Best regards,
Simon
SIM International
[Reply-To]`},
 C_OFFICIAL_GENERIC_MAILBOX:{subject:'[Category] enquiry for [Company]',body_text:`Hello,

I’m Simon from SIM International. We supply [Target Category] for overseas retail, wholesale and distribution customers.

We found [Company] while researching businesses active in [Matched Category] in [Market].

Our range focuses on reliable quality and competitive pricing, offering a strong balance between quality and cost for B2B buyers.

Could you please direct this email to the person responsible for [Target Category] buying, sourcing or imports?

If relevant, I can send a concise catalogue for review.

Best regards,
Simon
SIM International
[Reply-To]`}
});
// Shared company and department mailboxes (en/es/pt). Any business mailbox of the company is an
// acceptable first-touch route (Simon 2026-10-26); generic ones get the "please forward" template C.
const genericNames=new Set(['info','sales','contact','enquiries','enquiry','inquiries','inquiry','office','hello','support','admin',
 'purchasing','purchase','buying','procurement','sourcing','import','imports','export','trade','orders','order',
 'compras','ventas','venta','contacto','comercial','atencion','vendas','contato','atendimento','comercio']);
const upper=value=>String(value??'').trim().toUpperCase();
export function isGenericMailbox(recipient={}){
 const local=String(recipient.normalized_recipient||recipient.email||'').trim().toLowerCase().split('@')[0];
 return recipient.generic_mailbox===true||recipient.generic_forward_only===true||genericNames.has(local);
}
const OFFICIAL_ROUTE_TYPES=['OFFICIAL_COMPANY_EMAIL','OFFICIAL_DEPARTMENT_EMAIL'];
const DISTRIBUTION_TYPES=['IMPORTER','WHOLESALER','DISTRIBUTOR'];
const RETAIL_TYPES=['RETAILER','RETAIL_CHAIN','DEPARTMENT_STORE'];
/** Mailbox-level verification good enough for an automatic first touch (VALID, or catch-all with a Hunter score >= 85). */
export function mailboxVerifiedForFirstTouch(recipient={}){
 const status=upper(recipient.verification_status);
 return status==='VALID'||(status==='ACCEPT_ALL'&&acceptAllDecision(recipient.verification_score)==='AUTO_SEND');
}
/** The address is on the company's own domain, or the company publishes it on its own website. */
export function recipientRouteVerified(recipient={}){
 return recipient.domain_verified===true||recipient.official_source_verified===true;
}
export function selectFirstTouchTemplate({recipient={},company_types=[]}={}){
 if(!mailboxVerifiedForFirstTouch(recipient)||!recipientRouteVerified(recipient))return null;
 const types=company_types.map(upper),type=upper(recipient.recipient_type);
 const generic=isGenericMailbox(recipient);
 const named=!generic&&recipient.named_person_verified===true&&type==='NAMED_BUYER_EMAIL';
 if(named)return'A_NAMED_BUYER';
 // Retail chains and department stores: their company / purchasing mailboxes get template C (Simon 2026-10-26);
 // a verified named buyer keeps the personal template A.
 const retailChain=types.some(value=>RETAIL_TYPES.includes(value))&&!types.some(value=>DISTRIBUTION_TYPES.includes(value));
 if(retailChain&&OFFICIAL_ROUTE_TYPES.includes(type))return'C_OFFICIAL_GENERIC_MAILBOX';
 if(!generic&&OFFICIAL_ROUTE_TYPES.includes(type)&&types.some(value=>DISTRIBUTION_TYPES.includes(value)))return'B_IMPORTER_WHOLESALER_DISTRIBUTOR';
 if(OFFICIAL_ROUTE_TYPES.includes(type))return'C_OFFICIAL_GENERIC_MAILBOX';
 return null;
}
// `sender` ({sender_name,company_name}) signs a merchant's email; SIM's own mail is unchanged.
export function renderFirstTouchTemplate({template_key,variables={},verified_fields=[],sender=null}={}){
 const template=FIRST_TOUCH_TEMPLATES[template_key];if(!template)throw Object.assign(new Error('FIRST_TOUCH_TEMPLATE_NOT_APPROVED'),{code:'FIRST_TOUCH_TEMPLATE_NOT_APPROVED'});
 const verified=new Set(verified_fields),required=['category','target_category','company','matched_category','market','reply_to'];
 if(template_key==='A_NAMED_BUYER')required.push('first_name');
 const values={};
 for(const key of required){const value=String(variables[key]??'').trim();
  if(!verified.has(key)||!value||value.length>240||/[\r\n\u0000-\u001f\[\]]/.test(value))throw Object.assign(new Error('FIRST_TOUCH_VERIFIED_VARIABLE_REQUIRED'),{code:'FIRST_TOUCH_VERIFIED_VARIABLE_REQUIRED',field:key});
  values[key]=value;
 }
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.reply_to))throw Object.assign(new Error('FIRST_TOUCH_REPLY_TO_INVALID'),{code:'FIRST_TOUCH_REPLY_TO_INVALID'});
 const map={'Category':values.category,'Target Category':values.target_category,'Company':values.company,'Matched Category':values.matched_category,'Market':values.market,'Reply-To':values.reply_to,'First Name':values.first_name,'First Name or Team':'Team'};
 const render=value=>value.replace(/\[([^\]]+)\]/g,(_,key)=>map[key]);
 const draft={template_set_key:FIRST_TOUCH_TEMPLATE_SET,template_key,template_version:`${FIRST_TOUCH_TEMPLATE_SET}:${template_key}`,sender_display_name:sender?.sender_name||FIRST_TOUCH_SENDER_NAME,language:'en',subject:render(template.subject),body_text:applySenderSignature(render(template.body_text),sender),followups:[]};
 if(draft.subject.length>240)throw Object.assign(new Error('FIRST_TOUCH_SUBJECT_TOO_LONG'),{code:'FIRST_TOUCH_SUBJECT_TOO_LONG'});
 const validation=validateOutreachDraft(draft,{target_language:'en'});
 if(!validation.valid)throw Object.assign(new Error('FIRST_TOUCH_FORBIDDEN_CLAIM'),{code:'FIRST_TOUCH_FORBIDDEN_CLAIM',reason_codes:validation.reason_codes});
 return freeze({...draft,content_hash:buildContentHash(draft)});
}
