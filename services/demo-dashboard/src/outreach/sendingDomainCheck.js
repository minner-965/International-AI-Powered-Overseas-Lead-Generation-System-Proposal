// SPF, DKIM and DMARC lookup for a sending domain (optimization plan batch 4, D2).
// Advisory only: the result is shown on the mailbox page with setup hints; sending is not blocked.
// Uses Node's built-in DNS resolver (no new dependency). DKIM keys sit under a selector the
// sender chooses, so only common selectors are tried; "not found" there means "not confirmed".
import {Resolver} from 'node:dns/promises';

export const DKIM_SELECTORS=Object.freeze(['default','google','selector1','selector2','s1','s2','k1','k2','dkim','mail','smtp','email','zoho','zmail','qq','aliyun','mx','key1','sig1']);
const DOMAIN=/^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function sendingDomainOf(value){
  const text=String(value||'').trim().toLowerCase();
  const domain=text.includes('@')?text.split('@').pop():text;
  return DOMAIN.test(domain)?domain:null;
}
const joined=records=>(records||[]).map(parts=>Array.isArray(parts)?parts.join(''):String(parts));
async function txt(resolver,name){
  try{return{records:joined(await resolver.resolveTxt(name)),error:null};}
  catch(error){return{records:[],error:['ENODATA','ENOTFOUND','NXDOMAIN'].includes(error?.code)?null:(error?.code||'DNS_ERROR')};}
}

export async function checkSendingDomain(value,{resolver=null,selectors=DKIM_SELECTORS,now=()=>new Date()}={}){
  const domain=sendingDomainOf(value);
  if(!domain)return{domain:null,status:'INVALID_DOMAIN',spf:null,dkim:null,dmarc:null,checked_at:now().toISOString()};
  const dns=resolver||new Resolver({timeout:3000,tries:1});
  // All lookups run at once so a slow resolver costs one timeout, not one per selector.
  const [spfTxt,dmarcTxt,...dkimTxt]=await Promise.all([txt(dns,domain),txt(dns,`_dmarc.${domain}`),
    ...selectors.map(selector=>txt(dns,`${selector}._domainkey.${domain}`))]);
  const spfRecords=spfTxt.records.filter(record=>/^v=spf1(\s|$)/i.test(record));
  const spf=spfTxt.error?{status:'LOOKUP_FAILED',code:spfTxt.error}
    :spfRecords.length===1?{status:'FOUND',record:spfRecords[0]}
    :spfRecords.length>1?{status:'MULTIPLE',records:spfRecords}:{status:'MISSING'};
  const dmarcRecord=dmarcTxt.records.find(record=>/^v=DMARC1(;|\s|$)/i.test(record));
  const policy=dmarcRecord?.match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i)?.[1]?.toLowerCase()||null;
  const dmarc=dmarcTxt.error?{status:'LOOKUP_FAILED',code:dmarcTxt.error}
    :dmarcRecord?{status:'FOUND',record:dmarcRecord,policy}:{status:'MISSING'};
  const dkimIndex=dkimTxt.findIndex(found=>found.records.some(value=>/(^|;)\s*(v=DKIM1|k=|p=)/i.test(value)));
  const dkim=dkimIndex>=0?{status:'FOUND',selector:selectors[dkimIndex]}
    :{status:'NOT_FOUND_COMMON_SELECTORS',selectors_checked:selectors.length};
  const ok=spf.status==='FOUND'&&dmarc.status==='FOUND'&&dkim.status==='FOUND';
  return{domain,status:ok?'OK':'NEEDS_ATTENTION',spf,dkim,dmarc,checked_at:now().toISOString()};
}
