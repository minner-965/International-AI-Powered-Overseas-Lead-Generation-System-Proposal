// T2_BUYER_TYPE (standard 4.2): which kind of buyer the company itself is, whether it runs its own
// store network and how many stores it states.
import {STANDARD_VERSION,DELIMITERS} from '../standard.js';
import {maskPii,wrapData,htmlToText,cleanText} from '../textSafety.js';
import {envelopeSchema,objectOf,enumOf,QUOTE,NULLABLE_QUOTE,CONFIDENCE,SHORT_TEXT,newRequestId,uuidOrNull,text,fail,quoteFound} from './common.js';

export const TASK='T2_BUYER_TYPE';

export const schema=envelopeSchema(TASK,{
  buyer_types:{type:'array',maxItems:10,items:objectOf({buyer_type:enumOf('buyer_type'),quote:QUOTE,confidence:CONFIDENCE,source_url:SHORT_TEXT(1000)})},
  own_store_network:{type:['boolean','null']},
  store_count:{type:['integer','null'],minimum:0,maximum:100000},
  store_count_quote:NULLABLE_QUOTE,
  exclusion_facts:{type:'array',maxItems:10,items:objectOf({fact:SHORT_TEXT(200),quote:QUOTE,confidence:CONFIDENCE,source_url:SHORT_TEXT(1000)})}
});

/** args: {company, pages:[{url, html?|text?}] (1-3), company_id?, names_to_mask?} */
export function buildRequest(args={}){
  const pages=(args.pages||[]).slice(0,3).map(page=>{
    const raw=page.text!==undefined?cleanText(page.text,30_000):htmlToText(page.html||'',{maxWords:2500});
    return{url:text(page.url,1000),text:maskPii(raw,{names:args.names_to_mask||[]})};
  }).filter(page=>page.text.trim());
  if(!pages.length)throw fail('LLM_INPUT_EMPTY','No readable page text');
  const input={
    task:TASK,standard_version:STANDARD_VERSION,request_id:args.request_id||newRequestId(),
    company:{display_name:text(args.company?.display_name,200),official_domain:text(args.company?.official_domain,200),market:text(args.company?.market,8)},
    pages:pages.map(page=>({url:page.url,page_text:wrapData(page.text,DELIMITERS.page)}))
  };
  return{input,quoteSources:pages.map(page=>page.text),pageUrls:new Set(pages.map(page=>page.url)),
    subject:{subject_type:'COMPANY',company_id:uuidOrNull(args.company_id),subject_ref:pages[0].url||null}};
}

const digitsIn=value=>String(value??'').match(/\d[\d.,\s]*/g)?.map(match=>Number(match.replace(/[.,\s]/g,'')))||[];

export function items(output,request){
  const urlCheck=entry=>request.pageUrls.has(entry.source_url)?null:'SOURCE_URL_NOT_IN_INPUT';
  const list=[
    ...(output.buyer_types||[]).map(entry=>({item:{kind:'BUYER_TYPE',...entry},quote:entry.quote,confidence:entry.confidence,check:()=>urlCheck(entry)})),
    ...(output.exclusion_facts||[]).map(entry=>({item:{kind:'EXCLUSION_FACT',...entry},quote:entry.quote,confidence:entry.confidence,check:()=>urlCheck(entry)}))
  ];
  if(output.own_store_network===true||output.store_count!==null&&output.store_count!==undefined){
    const best=(output.buyer_types||[]).filter(entry=>['RETAIL_CHAIN','DEPARTMENT_STORE','SUPERMARKET_HYPERMARKET'].includes(entry.buyer_type)).map(entry=>entry.confidence);
    list.push({item:{kind:'STORE_NETWORK',own_store_network:output.own_store_network===true,store_count:output.store_count??null},
      quote:output.store_count_quote,confidence:best.length?Math.max(...best):null,
      check:()=>{
        if(!quoteFound(output.store_count_quote,request.quoteSources))return'QUOTE_NOT_IN_INPUT';
        // No invented numbers: a stated store count must be written in its own quote.
        if(output.store_count!==null&&output.store_count!==undefined&&!digitsIn(output.store_count_quote).includes(Number(output.store_count)))return'STORE_COUNT_NOT_IN_QUOTE';
        return null;
      }});
  }
  return list;
}
