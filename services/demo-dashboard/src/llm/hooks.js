// Hook points the research and reply pipelines call when model assist may run. Every hook:
//  - returns quickly with {ran:false, code} when the switch for that owner/task is off (the default);
//  - never throws into the pipeline (a model problem is logged and the rules continue alone);
//  - in SHADOW mode only records (usable = [] and no change to the rule result);
//  - in ASSIST mode offers ACCEPTED (>= 0.80) items that the caller may use ONLY to add evidence or
//    to downgrade; nothing here can verify a company, raise a tier, make an address sendable or lift
//    a suppression. Exact call sites for the pipeline owners are listed in docs/llm/LOCAL_MODEL_SETUP.md
//    (section "接入点") and in the batch-3 report.
import {mergeReplyIntent,downgradeOnly} from './tasks/index.js';

const OFF=code=>({ran:false,code,usable:[]});

export function createModelAssistHooks({assist=null,log=console}={}){
  const guard=async(name,run)=>{
    if(!assist)return OFF('MODEL_ASSIST_NOT_CONFIGURED');
    try{return await run();}
    catch(error){log?.warn?.(JSON.stringify({event:'LLM_HOOK_FAILED',hook:name,code:error?.code||null}));return OFF('LLM_HOOK_ERROR');}
  };
  return Object.freeze({
    /**
     * T1 after an official page was fetched (CategoryEvidenceService.collect, after
     * extractCategoryBuyerObservations). usable items: {code, raw_category, activity, product_examples,
     * quote, confidence, evidence_id} - add as extra observations with extraction_version from the row,
     * verification_status REVIEW unless status ACCEPTED.
     */
    afterPageCrawl:({merchantId=null,companyId,company,url,html,text,pageRoleHint,approvedCategories=[]})=>guard('afterPageCrawl',async()=>{
      const result=await assist.run('T1_CATEGORY_EVIDENCE',{company_id:companyId,company,page:{url,html,text,page_role_hint:pageRoleHint},approved_categories:approvedCategories},{merchantId});
      return{...result,usable:(result.usable||[]).map(row=>({...row.item,quote:row.quote,confidence:row.confidence,evidence_id:row.evidence_id,extraction_version:result.extraction_version||null}))};
    }),
    /** T2 buyer type from 1-3 own pages. usable items are additional evidence rows for buyerBusinessModel / C1. */
    checkBuyerType:({merchantId=null,companyId,company,pages})=>guard('checkBuyerType',async()=>{
      const result=await assist.run('T2_BUYER_TYPE',{company_id:companyId,company,pages},{merchantId});
      return{...result,usable:(result.usable||[]).map(row=>({...row.item,quote:row.quote,confidence:row.confidence,evidence_id:row.evidence_id,extraction_version:result.extraction_version||null}))};
    }),
    /**
     * T3 for one stored evidence row. needs_review=true (ASSIST only) means: mark the evidence "needs
     * review" and leave it out of the tier. needs_review=false never revives excluded evidence.
     */
    checkAttribution:({merchantId=null,companyId,company,evidence})=>guard('checkAttribution',async()=>{
      const result=await assist.run('T3_ATTRIBUTION',{company_id:companyId,company,evidence},{merchantId});
      const item=result.usable?.[0]?.item||null;
      return{...result,needs_review:result.mode==='ASSIST'&&downgradeOnly(item),attribution:item?.attribution||null};
    }),
    /** T4 checklist for people only; rules never read it. */
    ruleChecklist:({merchantId=null,companyId,company,evidence,rules})=>guard('ruleChecklist',async()=>{
      const result=await assist.run('T4_RULE_CHECKLIST',{company_id:companyId,company,evidence,rules},{merchantId});
      return{...result,usable:[]};
    }),
    /**
     * T5 next to the rule classifier (classifyInboundReply). Returns {merged, ...run result}.
     * SHADOW: merged === rule result unchanged. ASSIST: mergeReplyIntent (opt-out can only be added).
     */
    classifyReply:async({merchantId=null,replyId=null,companyId=null,subject,bodyText,ourLanguage='en',namesToMask=[],ruleResult={}})=>{
      const ruleOnly={intent:ruleResult.intent||'REVIEW',opt_out:ruleResult.intent==='OPT_OUT',source:'RULES',changed:false};
      const result=await guard('classifyReply',()=>assist.run('T5_REPLY_INTENT',{reply_id:replyId,company_id:companyId,reply:{subject,body_text:bodyText},our_language:ourLanguage,names_to_mask:namesToMask},{merchantId}));
      if(!result.ran||result.mode!=='ASSIST')return{...result,usable:[],merged:ruleOnly};
      const merged=mergeReplyIntent(ruleResult,[...(result.items||[]).filter(row=>['ACCEPTED','REVIEW'].includes(row.status))]);
      return{...result,merged:{...merged,changed:merged.intent!==ruleOnly.intent||merged.create_task===true}};
    }
  });
}
