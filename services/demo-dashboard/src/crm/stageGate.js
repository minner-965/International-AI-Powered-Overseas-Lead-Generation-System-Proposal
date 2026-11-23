// Stage gate inside the stage-change transaction (migration 081): close date from the quote stage on,
// customer confirmation for a won deal. Used by CrmRepository.setStage and ManualCompanyService.setStage,
// i.e. only for changes a person makes; automatic changes (a reply arriving) do not pass through here.
import {stageGateProblem,WON_CONFIRMATIONS} from './stageRules.js';

const fail=(code,message,status=422,extra={})=>Object.assign(new Error(message),{code,status,...extra});
const MESSAGES=Object.freeze({CLOSE_DATE_REQUIRED:'Enter the expected close date from the quote stage on',
  WON_CONFIRMATION_REQUIRED:'Choose how the customer confirmed before marking the deal won',
  WON_CONFIRMATION_NOTE_REQUIRED:'Explain how the customer confirmed'});

/** Request fields that may come with a stage change; undefined = not sent. Throws on a malformed value. */
export function stageGateInput(body={}){
  const out={};
  if(body.expected_close_date!==undefined&&body.expected_close_date!==null&&body.expected_close_date!==''){
    const text=String(body.expected_close_date).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text)))throw fail('CRM_DATE_INVALID','Expected close date must be a date',422,{field:'expected_close_date'});
    out.expected_close_date=text;
  }
  if(body.won_confirmation!==undefined&&body.won_confirmation!==null&&body.won_confirmation!==''){
    const code=String(body.won_confirmation).trim().toUpperCase();
    if(!WON_CONFIRMATIONS.includes(code))throw fail('CRM_VALUE_INVALID','Unknown confirmation',422,{field:'won_confirmation'});
    out.won_confirmation=code;
  }
  if(body.won_confirmation_note!==undefined&&body.won_confirmation_note!==null&&String(body.won_confirmation_note).trim()){
    const note=String(body.won_confirmation_note).trim();
    if(note.length>500)throw fail('CRM_VALUE_INVALID','Confirmation note is too long',422,{field:'won_confirmation_note'});
    out.won_confirmation_note=note;
  }
  return out;
}

/**
 * Checks the gate for from -> to with the saved deal plus `input`, then saves what came with the change
 * (and, for WON, today's date when no close date exists, the confirmation and its time) in the same transaction.
 * `client` must already be inside BEGIN. Returns the deal fields written, or null when nothing was written.
 */
export async function applyStageGate(client,{companyId,merchantId=null,from,to,input={},actor,today=new Date()}){
  if(!to||from===to)return null;
  const current=(await client.query(`SELECT * FROM leadgen.crm_deal_profiles WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`,
    [companyId,merchantId])).rows[0]||null;
  const saved=current?{expected_close_date:current.expected_close_date?new Date(current.expected_close_date).toISOString().slice(0,10):null,
    won_confirmation:current.won_confirmation,won_confirmation_note:current.won_confirmation_note}:{};
  const merged={...saved,...input};
  const problem=stageGateProblem(from,to,merged);
  if(problem)throw fail(problem,MESSAGES[problem],422,{field:problem==='CLOSE_DATE_REQUIRED'?'expected_close_date':'won_confirmation'});
  const changes={...input};
  if(to==='WON'){
    if(!merged.expected_close_date)changes.expected_close_date=today.toISOString().slice(0,10);
    changes.won_confirmed_at=today.toISOString();
  }
  if(!Object.keys(changes).length)return null;
  const columns=['expected_close_date','won_confirmation','won_confirmation_note','won_confirmed_at'].filter(key=>key in changes);
  let row;
  if(current){
    row=(await client.query(`UPDATE leadgen.crm_deal_profiles SET ${columns.map((key,index)=>`${key}=$${index+2}`).join(',')},
        version=version+1,updated_by=$${columns.length+2},updated_at=now() WHERE id=$1 RETURNING *`,
      [current.id,...columns.map(key=>changes[key]),actor])).rows[0];
  }else{
    row=(await client.query(`INSERT INTO leadgen.crm_deal_profiles(company_id,merchant_id,${columns.join(',')},updated_by)
        VALUES($1,$2,${columns.map((_,index)=>`$${index+3}`).join(',')},$${columns.length+3}) RETURNING *`,
      [companyId,merchantId,...columns.map(key=>changes[key]),actor])).rows[0];
  }
  await client.query(`INSERT INTO leadgen.crm_deal_profile_events(deal_profile_id,company_id,merchant_id,changes,changed_by) VALUES($1,$2,$3,$4::jsonb,$5)`,
    [row.id,companyId,merchantId,JSON.stringify({...changes,stage_change:`${from}->${to}`}),actor]);
  return changes;
}
