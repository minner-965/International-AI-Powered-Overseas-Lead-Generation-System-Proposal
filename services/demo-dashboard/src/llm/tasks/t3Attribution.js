// T3_ATTRIBUTION (standard 4.3): is one stored evidence text the company's own statement, or an
// article, directory, visitor question, description of customers or isolated navigation words?
// Server use: anything other than OWN_STATEMENT may only mark the evidence "needs review";
// OWN_STATEMENT never revives evidence the rules excluded (downgradeOnly below).
import {STANDARD_VERSION,DELIMITERS} from '../standard.js';
import {maskPii,wrapData,cleanText} from '../textSafety.js';
import {envelopeSchema,enumOf,QUOTE,CONFIDENCE,SHORT_TEXT,newRequestId,uuidOrNull,text,fail} from './common.js';

export const TASK='T3_ATTRIBUTION';

export const schema=envelopeSchema(TASK,{evidence_id:SHORT_TEXT(64),attribution:enumOf('attribution'),quote:QUOTE,confidence:CONFIDENCE});

/** args: {company, evidence:{evidence_id, source_url, evidence_text}, company_id?, names_to_mask?} */
export function buildRequest(args={}){
  const evidence=args.evidence||{};
  const body=maskPii(cleanText(evidence.evidence_text,8000),{names:args.names_to_mask||[]});
  if(!body.trim())throw fail('LLM_INPUT_EMPTY','The evidence has no text');
  const evidenceId=text(evidence.evidence_id,64);
  if(!evidenceId)throw fail('LLM_INPUT_INVALID','evidence_id is required');
  const input={
    task:TASK,standard_version:STANDARD_VERSION,request_id:args.request_id||newRequestId(),
    company:{display_name:text(args.company?.display_name,200),official_domain:text(args.company?.official_domain,200),market:text(args.company?.market,8)},
    evidence:{evidence_id:evidenceId,source_url:text(evidence.source_url,1000),evidence_text:wrapData(body,DELIMITERS.evidence)}
  };
  return{input,quoteSources:[body],evidenceId,subject:{subject_type:'EVIDENCE',company_id:uuidOrNull(args.company_id),subject_ref:evidenceId}};
}

export function items(output,request){
  return[{item:{evidence_id:output.evidence_id,attribution:output.attribution},quote:output.quote,confidence:output.confidence,
    check:()=>output.evidence_id===request.evidenceId?null:'EVIDENCE_ID_MISMATCH'}];
}

/** Rule-side use: true when the evidence should be marked "needs review" (never an upgrade). */
export const downgradeOnly=item=>Boolean(item&&item.attribution!=='OWN_STATEMENT');
