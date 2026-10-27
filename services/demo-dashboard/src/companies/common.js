// Shared rules for manually added companies (B1) and first-touch test sends (B2).
import {createHash} from 'node:crypto';
import {parse as parseHost} from 'tldts';

export const fail=(code,message,status=400,details=undefined)=>Object.assign(new Error(message),{code,status,...(details?{details}:{})});
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const COMPANY_TYPES=Object.freeze({IMPORTER:'Importer',WHOLESALER:'Wholesaler',DISTRIBUTOR:'Distributor',RETAIL_CHAIN:'Retail chain',
  DEPARTMENT_STORE:'Department store',RETAILER:'Retailer',ONLINE_RETAILER:'Online retailer',BRAND:'Brand',OTHER:'Other'});
// Company general mailbox, a department mailbox, or a named person. A named decision maker is
// not required: any business mailbox of the company is acceptable (Simon, 2026-10).
export const CONTACT_KINDS=Object.freeze({GENERAL:'GENERIC_BUSINESS_EMAIL',DEPARTMENT:'DEPARTMENT_EMAIL',PERSON:'BUSINESS_EMAIL'});
export const TEMPLATE_KEYS=Object.freeze(['A_NAMED_BUYER','B_IMPORTER_WHOLESALER_DISTRIBUTOR','C_OFFICIAL_GENERIC_MAILBOX']);
export const RECIPIENT_COOLDOWN_DAYS=30;

export function cleanText(value,label,{required=false,max=500}={}){
  const text=String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
  if(required&&!text)throw fail('FIELD_REQUIRED',`${label} is required`,422,{field:label});
  if(text.length>max)throw fail('FIELD_TOO_LONG',`${label} is too long`,422,{field:label});
  return text||null;
}
export const normalizeEmail=value=>String(value??'').trim().toLowerCase();
export function requireEmail(value,label='email'){
  const email=normalizeEmail(value);
  if(!EMAIL.test(email)||email.length>254)throw fail('EMAIL_INVALID',`${label} is not a valid email address`,422,{field:label});
  return email;
}
export function uuidOf(value,label='id'){
  const text=String(value??'').trim();
  if(!UUID.test(text))throw fail('INVALID_ID',`${label} must be a UUID`,400,{field:label});
  return text.toLowerCase();
}
// sha256 of the trimmed lower-case address: the key of every suppression table.
export const recipientHash=email=>createHash('sha256').update(normalizeEmail(email)).digest('hex');
export const contentHash=value=>createHash('sha256').update(String(value)).digest('hex');

/** TEST_RECIPIENT_ALLOWLIST: comma-separated addresses that may receive mail for test companies. */
export function parseAllowlist(value){
  return new Set(String(value||'').split(/[,;\s]+/).map(normalizeEmail).filter(email=>EMAIL.test(email)));
}

/** Website or bare domain -> {hostname, domain, website_url}. Uses the public suffix list (tldts). */
export function parseWebsite(value){
  const raw=String(value??'').trim();
  if(!raw||raw.length>300)throw fail('WEBSITE_INVALID','Enter the company website or domain',422,{field:'website'});
  const url=/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)?raw:`https://${raw}`;
  let parsed;try{parsed=new URL(url);}catch{throw fail('WEBSITE_INVALID','Enter the company website or domain',422,{field:'website'});}
  if(!['http:','https:'].includes(parsed.protocol))throw fail('WEBSITE_INVALID','The website must start with http or https',422,{field:'website'});
  const info=parseHost(parsed.hostname);
  if(!info.domain||info.isIp)throw fail('WEBSITE_INVALID','Enter a public company domain',422,{field:'website'});
  const hostname=info.hostname.replace(/^www\./,'');
  return{hostname,domain:info.domain,website_url:`${parsed.protocol}//${info.hostname}${parsed.pathname==='/'?'':parsed.pathname}`.slice(0,300)};
}
export const emailDomain=email=>parseHost(String(email).split('@')[1]||'').domain||null;
export function sourceUrlOf(value){
  const text=cleanText(value,'source_url',{max:500});
  if(!text)return null;
  let parsed;try{parsed=new URL(text);}catch{throw fail('SOURCE_URL_INVALID','The source page must be a web address',422,{field:'source_url'});}
  if(!['http:','https:'].includes(parsed.protocol))throw fail('SOURCE_URL_INVALID','The source page must be a web address',422,{field:'source_url'});
  return parsed.toString();
}
/**
 * Business mailbox rule for a real (non-test) company: the address uses the company's own domain,
 * or a person recorded the page where the company publishes it (source_url).
 * A test company accepts only addresses on TEST_RECIPIENT_ALLOWLIST.
 */
export function recipientProblem({email,companyDomain,sourceUrl=null,isTest=false,allowlist=new Set()}){
  if(isTest)return allowlist.has(normalizeEmail(email))?null:'TEST_RECIPIENT_NOT_ALLOWED';
  const domain=emailDomain(email);
  const company=parseHost(String(companyDomain||'')).domain||String(companyDomain||'').toLowerCase();
  if(domain&&company&&domain===company)return null;
  return sourceUrl?null:'RECIPIENT_DOMAIN_MISMATCH';
}

// Owner of CRM state and sender of mail for the caller: SIM (null) or a merchant (same rule as the CRM).
export const ownerOf=scope=>scope?.merchantId??null;
export const actorOf=req=>String(req?.workspaceUser?.email||req?.managementUser?.identity||'dpv-workspace').slice(0,320);
export const isAdmin=scope=>!scope||scope.admin===true;
export const humanCategory=code=>String(code||'').toLowerCase().replace(/_/g,' ').replace(/\b\w/g,char=>char.toUpperCase());

export async function transaction(pool,fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
