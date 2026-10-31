// Persistence for model assist (migration 075). Every write is an INSERT: switches, allowances, the call
// ledger, evidence and review decisions are append-only; the latest settings row wins.
// SqlLlmStore is used by the server; MemoryLlmStore has the same interface for unit tests.
import crypto from 'node:crypto';

export const CNY_PER_USD=7.1; // only for comparing CNY-priced calls with the USD monthly budget

const monthStart=now=>{const date=new Date(now);return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));};
const owner=merchantId=>merchantId?{owner_scope:'MERCHANT',merchant_id:merchantId}:{owner_scope:'SIM',merchant_id:null};

export class SqlLlmStore{
  constructor({pool,now=()=>Date.now()}){this.pool=pool;this.now=now;}
  async latestSettings(merchantId){
    const o=owner(merchantId);
    return (await this.pool.query(`SELECT * FROM leadgen.llm_assist_settings WHERE owner_scope=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid ORDER BY set_at DESC,id DESC LIMIT 1`,[o.owner_scope,o.merchant_id])).rows[0]||null;
  }
  async insertSettings(merchantId,row){
    const o=owner(merchantId);
    return (await this.pool.query(`INSERT INTO leadgen.llm_assist_settings(owner_scope,merchant_id,enabled,mode,tasks,monthly_budget_usd,set_by,change_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[o.owner_scope,o.merchant_id,row.enabled,row.mode,JSON.stringify(row.tasks),row.monthly_budget_usd,row.set_by,row.change_reason||null])).rows[0];
  }
  async merchantExists(merchantId){return (await this.pool.query('SELECT 1 FROM leadgen.merchants WHERE id=$1',[merchantId])).rowCount===1;}
  async latestAllowance(merchantId){
    return (await this.pool.query(`SELECT * FROM leadgen.llm_merchant_allowances WHERE merchant_id=$1 ORDER BY set_at DESC,id DESC LIMIT 1`,[merchantId])).rows[0]||null;
  }
  async allowances(){
    return (await this.pool.query(`SELECT DISTINCT ON (merchant_id) merchant_id,sim_key_allowed,set_by,set_at FROM leadgen.llm_merchant_allowances ORDER BY merchant_id,set_at DESC,id DESC`)).rows;
  }
  async insertAllowance(merchantId,allowed,actor){
    return (await this.pool.query(`INSERT INTO leadgen.llm_merchant_allowances(merchant_id,sim_key_allowed,set_by) VALUES($1,$2,$3) RETURNING *`,[merchantId,allowed,actor])).rows[0];
  }
  async findReusableCall({merchantId,inputDigest,promptVersion,provider,model}){
    const o=owner(merchantId);
    return (await this.pool.query(`SELECT * FROM leadgen.llm_calls WHERE status='OK' AND input_digest=$1 AND prompt_version=$2 AND provider=$3 AND model=$4
      AND owner_scope=$5 AND merchant_id IS NOT DISTINCT FROM $6::uuid AND output IS NOT NULL ORDER BY created_at DESC LIMIT 1`,[inputDigest,promptVersion,provider,model,o.owner_scope,o.merchant_id])).rows[0]||null;
  }
  async insertCall(row){
    const o=owner(row.merchant_id);
    return (await this.pool.query(`INSERT INTO leadgen.llm_calls(request_id,owner_scope,merchant_id,billed_to,credential_source,provider,model,task,standard_version,prompt_version,
      input_digest,status,error_code,attempts,input_tokens,output_tokens,cost_amount,cost_currency,latency_ms,output,cached_from)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [row.request_id,o.owner_scope,o.merchant_id,row.billed_to,row.credential_source,row.provider,row.model,row.task,row.standard_version,row.prompt_version,
        row.input_digest,row.status,row.error_code||null,row.attempts??1,row.input_tokens??null,row.output_tokens??null,row.cost_amount??null,row.cost_currency??null,
        row.latency_ms??null,row.output?JSON.stringify(row.output):null,row.cached_from||null])).rows[0];
  }
  async insertEvidence(rows){
    const out=[];
    for(const row of rows){
      const o=owner(row.merchant_id);
      out.push((await this.pool.query(`INSERT INTO leadgen.llm_evidence(call_id,request_id,owner_scope,merchant_id,task,mode,subject_type,company_id,subject_ref,provider,model,
        standard_version,prompt_version,extraction_version,input_digest,response_status,item_index,item,quote,confidence,status,reject_reason,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
        [row.call_id,row.request_id,o.owner_scope,o.merchant_id,row.task,row.mode,row.subject_type,row.company_id||null,row.subject_ref||null,row.provider,row.model,
          row.standard_version,row.prompt_version,row.extraction_version,row.input_digest,row.response_status,row.item_index??null,row.item?JSON.stringify(row.item):null,
          row.quote??null,row.confidence??null,row.status,row.reject_reason||null,JSON.stringify(row.notes||[])])).rows[0]);
    }
    return out;
  }
  /** Spend this month in USD-equivalent for calls billed to `billedTo` (SIM: every SIM-billed call). */
  async monthSpendUsd({billedTo,merchantId=null}){
    const params=[monthStart(this.now()),billedTo,CNY_PER_USD];
    let filter='';
    if(billedTo==='MERCHANT'){params.push(merchantId);filter='AND merchant_id=$4';}
    const row=(await this.pool.query(`SELECT COALESCE(sum(CASE WHEN cost_currency='CNY' THEN cost_amount/$3 ELSE cost_amount END),0)::float8 spent
      FROM leadgen.llm_calls WHERE created_at>=$1 AND billed_to=$2 ${filter}`,params)).rows[0];
    return Number(row.spent)||0;
  }
  async usage({merchantId=null,all=false}={}){
    const params=[monthStart(this.now())];let filter='';
    if(!all){const o=owner(merchantId);params.push(o.owner_scope,o.merchant_id);filter='AND owner_scope=$2 AND merchant_id IS NOT DISTINCT FROM $3::uuid';}
    const rows=(await this.pool.query(`SELECT billed_to,task,status,count(*)::int calls,COALESCE(sum(input_tokens),0)::bigint input_tokens,COALESCE(sum(output_tokens),0)::bigint output_tokens,
      cost_currency,COALESCE(sum(cost_amount),0)::float8 cost,count(*) FILTER (WHERE cost_amount IS NULL AND status IN ('OK','INVALID_OUTPUT'))::int unknown_cost
      FROM leadgen.llm_calls WHERE created_at>=$1 ${filter} GROUP BY billed_to,task,status,cost_currency`,params)).rows;
    return summarizeUsage(rows,monthStart(this.now()));
  }
  async reviewQueue({merchantId=null,all=false,limit=50}={}){
    const params=[Math.max(1,Math.min(200,Number(limit)||50))];let filter='';
    if(!all){const o=owner(merchantId);params.push(o.owner_scope,o.merchant_id);filter='AND e.owner_scope=$2 AND e.merchant_id IS NOT DISTINCT FROM $3::uuid';}
    return (await this.pool.query(`SELECT e.id,e.task,e.mode,e.subject_type,e.company_id,e.subject_ref,e.item,e.quote,e.confidence,e.model,e.created_at,e.merchant_id,c.company_name
      FROM leadgen.llm_evidence e LEFT JOIN leadgen.companies c ON c.id=e.company_id
      WHERE e.status='REVIEW' AND NOT EXISTS (SELECT 1 FROM leadgen.llm_review_decisions d WHERE d.evidence_id=e.id) ${filter}
      ORDER BY e.created_at DESC LIMIT $1`,params)).rows;
  }
  async getEvidence(id){return (await this.pool.query('SELECT * FROM leadgen.llm_evidence WHERE id=$1',[id])).rows[0]||null;}
  async decisionFor(id){return (await this.pool.query('SELECT * FROM leadgen.llm_review_decisions WHERE evidence_id=$1 ORDER BY decided_at DESC LIMIT 1',[id])).rows[0]||null;}
  async insertDecision({evidenceId,decision,note,actor}){
    return (await this.pool.query(`INSERT INTO leadgen.llm_review_decisions(evidence_id,decision,note,decided_by) VALUES($1,$2,$3,$4) RETURNING *`,[evidenceId,decision,note||null,actor])).rows[0];
  }
  /** Evidence a rule may read in ASSIST mode: accepted, or reviewed and confirmed by a person. */
  async usableEvidence({companyId,task,merchantId=null}){
    const o=owner(merchantId);
    return (await this.pool.query(`SELECT e.* FROM leadgen.llm_evidence e WHERE e.company_id=$1 AND e.task=$2 AND e.owner_scope=$3 AND e.merchant_id IS NOT DISTINCT FROM $4::uuid AND e.mode='ASSIST'
      AND (e.status='ACCEPTED' OR (e.status='REVIEW' AND (SELECT d.decision FROM leadgen.llm_review_decisions d WHERE d.evidence_id=e.id ORDER BY d.decided_at DESC LIMIT 1)='CONFIRMED'))
      AND NOT EXISTS (SELECT 1 FROM leadgen.llm_review_decisions d WHERE d.evidence_id=e.id AND d.decision='REJECTED')
      ORDER BY e.created_at DESC`,[companyId,task,o.owner_scope,o.merchant_id])).rows;
  }
}

export function summarizeUsage(rows,since){
  const out={since:since.toISOString(),calls:0,cached_calls:0,failed_calls:0,input_tokens:0,output_tokens:0,cost:{},unknown_cost_calls:0,by_task:{},by_billing:{}};
  for(const row of rows){
    const calls=Number(row.calls)||0;
    out.calls+=calls;
    if(row.status==='CACHED')out.cached_calls+=calls;
    if(!['OK','CACHED'].includes(row.status))out.failed_calls+=calls;
    out.input_tokens+=Number(row.input_tokens)||0;out.output_tokens+=Number(row.output_tokens)||0;
    out.unknown_cost_calls+=Number(row.unknown_cost)||0;
    if(row.cost_currency)out.cost[row.cost_currency]=Math.round(((out.cost[row.cost_currency]||0)+Number(row.cost))*1e6)/1e6;
    out.by_task[row.task]=(out.by_task[row.task]||0)+calls;
    out.by_billing[row.billed_to]=(out.by_billing[row.billed_to]||0)+calls;
  }
  return out;
}

/** In-memory store with the same interface (unit tests, no database). */
export class MemoryLlmStore{
  constructor({now=()=>Date.now(),merchants=[]}={}){this.now=now;this.settings=[];this.allowanceRows=[];this.calls=[];this.evidence=[];this.decisions=[];this.merchants=new Set(merchants);}
  stamp(row){return{id:crypto.randomUUID(),...row,created_at:new Date(this.now()),set_at:new Date(this.now())};}
  async latestSettings(merchantId){return this.settings.filter(row=>(row.merchant_id||null)===(merchantId||null)).at(-1)||null;}
  async insertSettings(merchantId,row){const saved=this.stamp({...owner(merchantId),...row});this.settings.push(saved);return saved;}
  async merchantExists(merchantId){return this.merchants.has(merchantId);}
  async latestAllowance(merchantId){return this.allowanceRows.filter(row=>row.merchant_id===merchantId).at(-1)||null;}
  async allowances(){const map=new Map();for(const row of this.allowanceRows)map.set(row.merchant_id,row);return [...map.values()];}
  async insertAllowance(merchantId,allowed,actor){const saved=this.stamp({merchant_id:merchantId,sim_key_allowed:allowed,set_by:actor});this.allowanceRows.push(saved);return saved;}
  async findReusableCall({merchantId,inputDigest,promptVersion,provider,model}){
    return this.calls.filter(row=>row.status==='OK'&&row.output&&row.input_digest===inputDigest&&row.prompt_version===promptVersion&&row.provider===provider&&row.model===model&&(row.merchant_id||null)===(merchantId||null)).at(-1)||null;
  }
  async insertCall(row){const saved=this.stamp({...row,...owner(row.merchant_id)});this.calls.push(saved);return saved;}
  async insertEvidence(rows){const saved=rows.map(row=>this.stamp({...row,...owner(row.merchant_id)}));this.evidence.push(...saved);return saved;}
  async monthSpendUsd({billedTo,merchantId=null}){
    const since=monthStart(this.now());
    return this.calls.filter(row=>row.created_at>=since&&row.billed_to===billedTo&&(billedTo!=='MERCHANT'||row.merchant_id===merchantId))
      .reduce((sum,row)=>sum+(row.cost_amount==null?0:row.cost_currency==='CNY'?row.cost_amount/CNY_PER_USD:row.cost_amount),0);
  }
  async usage({merchantId=null,all=false}={}){
    const since=monthStart(this.now());
    const rows=this.calls.filter(row=>row.created_at>=since&&(all||(row.merchant_id||null)===(merchantId||null))).map(row=>({billed_to:row.billed_to,task:row.task,status:row.status,calls:1,
      input_tokens:row.input_tokens||0,output_tokens:row.output_tokens||0,cost_currency:row.cost_currency||null,cost:row.cost_amount||0,unknown_cost:row.cost_amount==null&&['OK','INVALID_OUTPUT'].includes(row.status)?1:0}));
    return summarizeUsage(rows,since);
  }
  async reviewQueue({merchantId=null,all=false}={}){
    const decided=new Set(this.decisions.map(row=>row.evidence_id));
    return this.evidence.filter(row=>row.status==='REVIEW'&&!decided.has(row.id)&&(all||(row.merchant_id||null)===(merchantId||null))).reverse();
  }
  async getEvidence(id){return this.evidence.find(row=>row.id===id)||null;}
  async decisionFor(id){return this.decisions.filter(row=>row.evidence_id===id).at(-1)||null;}
  async insertDecision({evidenceId,decision,note,actor}){const saved=this.stamp({evidence_id:evidenceId,decision,note,decided_by:actor});this.decisions.push(saved);return saved;}
  async usableEvidence({companyId,task,merchantId=null}){
    return this.evidence.filter(row=>row.company_id===companyId&&row.task===task&&(row.merchant_id||null)===(merchantId||null)&&row.mode==='ASSIST'&&
      !this.decisions.some(d=>d.evidence_id===row.id&&d.decision==='REJECTED')&&
      (row.status==='ACCEPTED'||(row.status==='REVIEW'&&this.decisions.filter(d=>d.evidence_id===row.id).at(-1)?.decision==='CONFIRMED')));
  }
}
