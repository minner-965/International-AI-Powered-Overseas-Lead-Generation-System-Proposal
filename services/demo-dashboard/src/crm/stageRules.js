// Stage-change rule shared by the CRM pipeline and manually added companies (migration 079).
const FORWARD=Object.freeze(['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON']);
/** A move to LOST, back to an earlier stage, or out of WON/LOST needs a written reason. */
export function stageChangeNeedsReason(from,to){
  if(!from||from===to)return false;
  if(to==='LOST')return true;
  if(from==='WON'||from==='LOST')return true;
  return FORWARD.indexOf(to)<FORWARD.indexOf(from);
}

/** Lost-deal categories (stored in lost_reason; older free-text reasons stay as they were). */
export const LOST_REASON_CODES=Object.freeze(['PRICE','PRODUCT_MISMATCH','MOQ','LEAD_TIME','PAYMENT_TERMS','COMPETITOR','PROJECT_CANCELLED','NO_RESPONSE','OPTED_OUT','OTHER']);

/** Optional revisit date for a lost deal: a calendar day after today, within two years. */
export function revisitDateOf(value,stage,today=new Date()){
  if(value===undefined||value===null||value==='')return null;
  const fail=(code,message)=>Object.assign(new Error(message),{code,status:422});
  if(stage!=='LOST')throw fail('REVISIT_ONLY_WHEN_LOST','A revisit date is only for a lost deal');
  const text=String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text)))throw fail('REVISIT_DATE_INVALID','Revisit date must be a date');
  const day=Date.parse(text),start=Date.parse(today.toISOString().slice(0,10));
  if(day<=start||day>start+731*86_400_000)throw fail('REVISIT_DATE_INVALID','Revisit date must be after today and within two years');
  return text;
}

/** One revisit task for a lost deal, due 09:00 UTC on the chosen day. No outbox row: like reminder tasks it stays inside SIM. */
export async function createRevisitTask(queryable,{companyId,merchantId=null,revisitDate,reason=null,actor}){
  return(await queryable.query(`INSERT INTO leadgen.sales_tasks(company_id,task_type,task_status,owner,due_at,details,updated_by,merchant_id,priority)
    VALUES($1,'FOLLOW_UP','OPEN',$2,($3::date+time '09:00') AT TIME ZONE 'UTC',$4::jsonb,$2,$5,'NORMAL') RETURNING id,due_at`,
    [companyId,actor,revisitDate,JSON.stringify({title:'回访流失客户',title_en:'Revisit a lost customer',next_action:'Ask whether the situation has changed',
      source:'LOST_REVISIT',lost_reason:reason,notes:[]}),merchantId])).rows[0];
}

/** How a customer confirmed a won deal (crm_deal_profiles.won_confirmation, migration 081). */
export const WON_CONFIRMATIONS=Object.freeze(['PO','DEPOSIT','CONTRACT','PAYMENT','OTHER']);
/** Stages from which the deal needs an expected close date (WON uses today when none is given). */
export const CLOSE_DATE_STAGES=Object.freeze(['QUOTED','SAMPLE','NEGOTIATING']);

/**
 * Gate for a person moving a deal to `to` (automatic changes such as a reply are not gated).
 * `deal` holds what is saved or sent with the change: expected_close_date, won_confirmation, won_confirmation_note.
 * Returns an error code, or null when the move may be saved.
 */
export function stageGateProblem(from,to,deal={}){
  if(!to||from===to)return null;
  if(CLOSE_DATE_STAGES.includes(to)&&!deal.expected_close_date)return 'CLOSE_DATE_REQUIRED';
  if(to==='WON'){
    if(!WON_CONFIRMATIONS.includes(deal.won_confirmation))return 'WON_CONFIRMATION_REQUIRED';
    if(deal.won_confirmation==='OTHER'&&!String(deal.won_confirmation_note||'').trim())return 'WON_CONFIRMATION_NOTE_REQUIRED';
  }
  return null;
}
