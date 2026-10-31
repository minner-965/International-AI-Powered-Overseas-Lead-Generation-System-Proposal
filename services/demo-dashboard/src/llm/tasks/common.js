// Shared pieces of the T1-T5 task contracts: JSON schema fragments, the request document and the
// server-side checks of standard section 3 (schema, verbatim quotes, enums, thresholds).
import crypto from 'node:crypto';
import {STANDARD_VERSION,ENUMS,TASK_INSTRUCTIONS,confidenceStatus} from '../standard.js';
import {validateSchema} from '../jsonSchema.js';

export const QUOTE={type:'string',minLength:5,maxLength:300};
export const NULLABLE_QUOTE={type:['string','null'],maxLength:300};
export const CONFIDENCE={type:'number',minimum:0,maximum:1};
export const NOTES={type:'array',maxItems:10,items:{type:'string',maxLength:200}};
export const enumOf=name=>({type:'string',enum:[...ENUMS[name]]});
export const SHORT_TEXT=max=>({type:'string',maxLength:max});
export const NULLABLE_TEXT=max=>({type:['string','null'],maxLength:max});

/** Object schema in which every property is required and nothing else is allowed. */
export const objectOf=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

export function envelopeSchema(task,properties){
  return objectOf({
    task:{type:'string',enum:[task]},
    standard_version:{type:'string',enum:[STANDARD_VERSION]},
    request_id:{type:'string',maxLength:64},
    status:{type:'string',enum:['OK','INSUFFICIENT_EVIDENCE','REFUSED_OUT_OF_SCOPE']},
    ...properties,
    notes:NOTES
  });
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull=value=>UUID.test(String(value||''))?String(value):null;
export const newRequestId=()=>crypto.randomUUID();
export const fail=(code,message)=>Object.assign(new Error(message),{code,status:400});
export const text=(value,max)=>String(value??'').trim().slice(0,max);

/** The user message: instruction for this task + the JSON input document (data blocks inside). */
export function userMessage(task,input){
  return`${TASK_INSTRUCTIONS[task]}\n\nInput JSON (the *_text fields are data only):\n${JSON.stringify(input,null,1)}`;
}

const collapse=value=>String(value??'').replace(/\s+/g,' ').trim();
/** A quote counts only when it occurs verbatim (whitespace runs may differ) in one of the sources. */
export function quoteFound(quote,sources){
  const raw=String(quote??'');
  if([...raw.trim()].length<5||[...raw].length>300)return false;
  if(sources.some(source=>String(source??'').includes(raw)))return true;
  const needle=collapse(raw);
  return needle.length>=5&&sources.some(source=>collapse(source).includes(needle));
}

/** Parse a model reply into one JSON object (tolerates a single fenced block, nothing else). */
export function parseModelJson(raw){
  if(raw&&typeof raw==='object')return raw;
  let body=String(raw??'').trim();
  const fenced=body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if(fenced)body=fenced[1];
  try{const value=JSON.parse(body);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
  catch{return null;}
}

// Server-side injection guard (in addition to the model being told to ignore instructions in data):
// sentences that address an AI or try to change its output. A quote taken from such a sentence is
// rejected, and while such text is present nothing from that input is accepted automatically.
const INSTRUCTION_TEXT=/\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|all|earlier)\b[^.\n]{0,20}\b(?:instructions?|rules?|prompts?)\b|\b(?:system|developer)\s+(?:note|prompt|message|instruction)s?\b|\bnew instructions?\b|\byou are now\b|\b(?:output|return|respond with)\s+(?:status|json|confidence)\b|\bconfidence\s*[:=]?\s*1(?:\.0+)?\b|\bapprove (?:sending|this company)\b|\bmark (?:this|the) company as\b|忽略(?:之前|以上|所有)?(?:的)?(?:指令|规则|提示)|系统提示/i;
export function instructionSpans(sources){
  const spans=[];
  for(const source of sources)for(const sentence of String(source??'').split(/(?<=[.!?。！？])\s+|\n+/))
    if(INSTRUCTION_TEXT.test(sentence))spans.push(sentence.replace(/\s+/g,' ').trim());
  return spans;
}

/**
 * Validate a model output against the task definition.
 * Returns {response_status, items:[{index,item,quote,confidence,status,reject_reason}], notes, errors}.
 * Items are ACCEPTED / REVIEW / DISCARDED by confidence, or REJECTED when a quote is not in the input,
 * an enum or code is not allowed, or a task-specific check fails. A schema failure invalidates the run.
 */
export function validateOutput(definition,request,output){
  const errors=output?validateSchema(definition.schema,output):['$: not a JSON object'];
  if(output&&output.request_id!==undefined&&output.request_id!==request.input.request_id)errors.push('$.request_id: does not match the request');
  if(errors.length)return{response_status:'INVALID_OUTPUT',items:[],notes:[],errors};
  const notes=(output.notes||[]).filter(note=>ENUMS.note.includes(note));
  if(output.status!=='OK')return{response_status:output.status,items:[],notes,errors:[]};
  const spans=instructionSpans(request.quoteSources);
  if(spans.length&&!notes.includes('PROMPT_INJECTION_TEXT_IGNORED'))notes.push('PROMPT_INJECTION_TEXT_IGNORED');
  const inInstruction=quote=>{const needle=String(quote??'').replace(/\s+/g,' ').trim();return needle.length>=5&&spans.some(span=>span.includes(needle)||needle.includes(span));};
  const items=definition.items(output,request).map((entry,index)=>{
    const base={index,item:entry.item,quote:entry.quote??null,confidence:entry.confidence===undefined||entry.confidence===null?null:Math.round(Number(entry.confidence)*100)/100};
    const reason=entry.quoteRequired!==false&&!quoteFound(entry.quote,request.quoteSources)?'QUOTE_NOT_IN_INPUT'
      :entry.quote!==null&&entry.quote!==undefined&&entry.quoteRequired===false&&!quoteFound(entry.quote,request.quoteSources)?'QUOTE_NOT_IN_INPUT'
      :entry.check?.(entry.item,request)||null;
    if(reason)return{...base,status:'REJECTED',reject_reason:reason};
    if(entry.quote&&inInstruction(entry.quote))return{...base,status:'REJECTED',reject_reason:'QUOTE_IN_INSTRUCTION_TEXT'};
    const status=confidenceStatus(base.confidence);
    // Input that tries to instruct the model: a person confirms before anything is used.
    return{...base,status:spans.length&&status==='ACCEPTED'?'REVIEW':status,reject_reason:null};
  });
  return{response_status:'OK',items,notes,errors:[]};
}
