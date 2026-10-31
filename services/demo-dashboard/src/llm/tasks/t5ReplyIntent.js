// T5_REPLY_INTENT (standard 4.5): what a (masked) reply asks for.
// Merge rule (standard 4.5, evaluation guardrail 6): if either the rule classifier or the model sees
// OPT_OUT the reply is treated as an opt-out (suppress first, then human review); the model can never
// remove an opt-out found by the rules. Other intents create a task automatically only when both agree
// and the model confidence is >= 0.85; everything else goes to review.
import {STANDARD_VERSION,DELIMITERS,THRESHOLDS} from '../standard.js';
import {maskPii,wrapData,cleanText} from '../textSafety.js';
import {envelopeSchema,objectOf,enumOf,QUOTE,CONFIDENCE,SHORT_TEXT,NULLABLE_TEXT,newRequestId,uuidOrNull,text,fail} from './common.js';

export const TASK='T5_REPLY_INTENT';

export const schema=envelopeSchema(TASK,{
  reply_language:NULLABLE_TEXT(8),
  intents:{type:'array',maxItems:10,items:objectOf({intent:enumOf('intent'),quote:QUOTE,confidence:CONFIDENCE})},
  summary_zh:SHORT_TEXT(60)
});

/** args: {reply:{subject, body_text}, our_language?, reply_id?, company_id?, names_to_mask?} */
export function buildRequest(args={}){
  const names=args.names_to_mask||[];
  const subject=maskPii(cleanText(args.reply?.subject,500),{names});
  const body=maskPii(cleanText(args.reply?.body_text,8000),{names});
  if(!`${subject}${body}`.trim())throw fail('LLM_INPUT_EMPTY','The reply has no text');
  const input={
    task:TASK,standard_version:STANDARD_VERSION,request_id:args.request_id||newRequestId(),
    our_language:text(args.our_language||'en',8),
    reply:{subject:wrapData(subject,DELIMITERS.reply),body_text:wrapData(body,DELIMITERS.reply)}
  };
  return{input,quoteSources:[subject,body],subject:{subject_type:'REPLY',company_id:uuidOrNull(args.company_id),subject_ref:text(args.reply_id,500)||null}};
}

export function items(output){
  const seen=new Set();
  return (output.intents||[]).map(entry=>({item:entry,quote:entry.quote,confidence:entry.confidence,
    check:()=>{if(seen.has(entry.intent))return'DUPLICATE_INTENT';seen.add(entry.intent);return null;}}));
}

const BUSINESS=new Set(['QUOTATION','SAMPLE','CATALOGUE','MEETING','DEFER','DECLINE']);
/**
 * Combine the rule classification (src/outreach/inbound.js classifyInboundReply result) with
 * validated T5 items. Returns {intent, opt_out, create_task, review_required, source, model_intents}.
 * Only items that passed the quote check (status ACCEPTED or REVIEW) are passed in by the caller.
 */
export function mergeReplyIntent(ruleResult={},modelItems=[]){
  const ruleIntent=String(ruleResult.intent||'REVIEW');
  const usable=modelItems.filter(entry=>entry&&['ACCEPTED','REVIEW'].includes(entry.status));
  const modelOptOut=usable.find(entry=>entry.item?.intent==='OPT_OUT');
  if(ruleIntent==='OPT_OUT'||modelOptOut)
    return{intent:'OPT_OUT',opt_out:true,create_task:false,review_required:true,source:ruleIntent==='OPT_OUT'?(modelOptOut?'BOTH':'RULES'):'MODEL',model_intents:usable.map(entry=>entry.item.intent)};
  if(['AUTO_REPLY','IRRELEVANT'].includes(ruleIntent))
    return{intent:ruleIntent,opt_out:false,create_task:false,review_required:false,source:'RULES',model_intents:usable.map(entry=>entry.item.intent)};
  const agreeing=usable.find(entry=>entry.item.intent===ruleIntent&&Number(entry.confidence)>=THRESHOLDS.replyTask);
  if(BUSINESS.has(ruleIntent)&&agreeing)
    return{intent:ruleIntent,opt_out:false,create_task:true,review_required:false,source:'BOTH',model_intents:usable.map(entry=>entry.item.intent)};
  return{intent:ruleIntent,opt_out:false,create_task:false,review_required:true,source:'RULES',model_intents:usable.map(entry=>entry.item.intent),
    model_suggestion:usable.slice().sort((a,b)=>b.confidence-a.confidence)[0]?.item.intent||null};
}
