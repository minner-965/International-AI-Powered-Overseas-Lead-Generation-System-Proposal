// T4_RULE_CHECKLIST (standard 4.4): for stored, already validated evidence rows, mark each rule
// clause MET / NOT_MET / NO_EVIDENCE. Output is a review checklist for people only; the tier is
// still computed by src/opportunityPool/classifier*.js.
import {STANDARD_VERSION,DELIMITERS,RULE_CLAUSES,ENUMS} from '../standard.js';
import {maskPii,wrapData,cleanText} from '../textSafety.js';
import {envelopeSchema,objectOf,enumOf,NULLABLE_QUOTE,CONFIDENCE,SHORT_TEXT,newRequestId,uuidOrNull,text,fail} from './common.js';

export const TASK='T4_RULE_CHECKLIST';

export const schema=envelopeSchema(TASK,{
  results:{type:'array',maxItems:ENUMS.rule.length,items:objectOf({rule:enumOf('rule'),result:enumOf('rule_result'),
    evidence_ids:{type:'array',maxItems:30,items:SHORT_TEXT(64)},quote:NULLABLE_QUOTE,confidence:CONFIDENCE})}
});

/** args: {company, evidence:[{evidence_id,type,text,source_url}], rules?:[rule codes], company_id?} */
export function buildRequest(args={}){
  const rows=(args.evidence||[]).slice(0,40).map(row=>({evidence_id:text(row.evidence_id,64),type:text(row.type,60),source_url:text(row.source_url,1000),
    text:maskPii(cleanText(row.text,1500),{names:args.names_to_mask||[]})})).filter(row=>row.evidence_id&&row.text);
  if(!rows.length)throw fail('LLM_INPUT_EMPTY','No evidence rows');
  const rules=(args.rules||ENUMS.rule).filter(rule=>RULE_CLAUSES[rule]);
  const input={
    task:TASK,standard_version:STANDARD_VERSION,request_id:args.request_id||newRequestId(),
    // Company identity only: no history, decisions or internal notes (standard 4.4).
    company:{display_name:text(args.company?.display_name,200),official_domain:text(args.company?.official_domain,200),market:text(args.company?.market,8)},
    evidence:rows.map(row=>({evidence_id:row.evidence_id,type:row.type,source_url:row.source_url,text:wrapData(row.text,DELIMITERS.evidence)})),
    checklist:rules.map(rule=>({rule,clause:RULE_CLAUSES[rule]}))
  };
  return{input,quoteSources:rows.map(row=>row.text),rows,rules:new Set(rules),
    subject:{subject_type:'COMPANY',company_id:uuidOrNull(args.company_id),subject_ref:null}};
}

export function items(output,request){
  const seen=new Set();
  return (output.results||[]).map(entry=>{
    const needsQuote=entry.result!=='NO_EVIDENCE';
    return{item:entry,quote:entry.quote,confidence:entry.confidence,quoteRequired:needsQuote,
      check:()=>{
        if(!request.rules.has(entry.rule))return'RULE_NOT_REQUESTED';
        if(seen.has(entry.rule))return'DUPLICATE_RULE';seen.add(entry.rule);
        if(!needsQuote)return null;
        if(!entry.evidence_ids.length)return'EVIDENCE_IDS_REQUIRED';
        const cited=request.rows.filter(row=>entry.evidence_ids.includes(row.evidence_id));
        if(cited.length!==new Set(entry.evidence_ids).size)return'EVIDENCE_ID_NOT_IN_INPUT';
        // The quote must come from one of the cited rows, not from anywhere in the input.
        if(!cited.some(row=>row.text.replace(/\s+/g,' ').includes(String(entry.quote||'').replace(/\s+/g,' ').trim())))return'QUOTE_NOT_IN_CITED_EVIDENCE';
        return null;
      }};
  });
}
