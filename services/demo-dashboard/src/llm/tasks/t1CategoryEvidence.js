// T1_CATEGORY_EVIDENCE (standard 4.1): which product categories the company itself sells,
// wholesales or distributes, from one page of its own website.
import {STANDARD_VERSION,DELIMITERS} from '../standard.js';
import {maskPii,wrapData,htmlToText,cleanText} from '../textSafety.js';
import {envelopeSchema,objectOf,enumOf,QUOTE,CONFIDENCE,SHORT_TEXT,NULLABLE_TEXT,newRequestId,uuidOrNull,text,fail} from './common.js';

export const TASK='T1_CATEGORY_EVIDENCE';

const item=objectOf({
  code:SHORT_TEXT(80),raw_category:NULLABLE_TEXT(200),profile:SHORT_TEXT(80),activity:enumOf('activity'),
  product_examples:{type:'array',maxItems:5,items:SHORT_TEXT(200)},quote:QUOTE,confidence:CONFIDENCE,note:NULLABLE_TEXT(200)
});
export const schema=envelopeSchema(TASK,{
  page_language:NULLABLE_TEXT(8),page_is_own_operation:{type:['boolean','null']},items:{type:'array',maxItems:30,items:item}
});

/**
 * args: {company:{display_name,official_domain,market}, page:{url,page_role_hint?,html?|text?},
 *        approved_categories:[{code,profile,names[]}], company_id?, names_to_mask?}
 */
export function buildRequest(args={}){
  const page=args.page||{};
  const raw=page.text!==undefined?cleanText(page.text,60_000):htmlToText(page.html||'');
  if(!raw.trim())throw fail('LLM_INPUT_EMPTY','The page has no readable text');
  const pageText=maskPii(raw,{names:args.names_to_mask||[]});
  const approved=(args.approved_categories||[]).slice(0,60).map(entry=>({code:text(entry.code,80),profile:text(entry.profile,80),names:(entry.names||[]).slice(0,12).map(name=>text(name,80))}));
  const input={
    task:TASK,standard_version:STANDARD_VERSION,request_id:args.request_id||newRequestId(),
    company:{display_name:text(args.company?.display_name,200),official_domain:text(args.company?.official_domain,200),market:text(args.company?.market,8)},
    page:{url:text(page.url,1000),page_role_hint:text(page.page_role_hint||'UNKNOWN',40)},
    approved_categories:approved,
    page_text:wrapData(pageText,DELIMITERS.page)
  };
  return{input,quoteSources:[pageText],subject:{subject_type:'COMPANY_PAGE',company_id:uuidOrNull(args.company_id),subject_ref:text(page.url,500)||null},approvedCodes:new Set(approved.map(entry=>entry.code))};
}

export function items(output,request){
  const seen=new Set();
  return (output.items||[]).map(entry=>({item:entry,quote:entry.quote,confidence:entry.confidence,
    check:()=>{
      if(entry.code!=='OTHER'&&!request.approvedCodes.has(entry.code))return'CODE_NOT_APPROVED';
      if(entry.code==='OTHER'&&!String(entry.raw_category||'').trim())return'RAW_CATEGORY_REQUIRED';
      if(output.page_is_own_operation===false)return'PAGE_NOT_OWN_OPERATION';
      if((entry.product_examples||[]).some(example=>!request.quoteSources.some(source=>source.includes(example))))return'PRODUCT_EXAMPLE_NOT_IN_INPUT';
      const key=entry.code==='OTHER'?`OTHER:${String(entry.raw_category).toLowerCase()}`:entry.code;
      if(seen.has(key))return'DUPLICATE_CATEGORY';
      seen.add(key);return null;
    }}));
}
