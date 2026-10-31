// Retry of CRM outbox rows that failed permanently because of the website-address false positive
// (acceptance bug 2026-10-27: "https:/" matched the drive-letter pattern -> CRM_PAYLOAD_PATH_FORBIDDEN).
// The failed row is kept as history; a NEW PENDING row with the rebuilt payload is appended
// (idempotency key "<old key>:retry:<old id>"), so the regular CRM outbox dispatch sends it.
// Rows whose rebuilt payload still fails validation are reported and not appended.
import {leadOutboxPayload} from './outboxPayloads.js';
import {validateCrmPayload} from '../phase7/service.js';

export const RETRYABLE_PAYLOAD_ERRORS=Object.freeze(['CRM_PAYLOAD_PATH_FORBIDDEN']);

export function rebuiltPayload(row){
  const payload=row.payload||{};
  if(row.operation==='CREATE_LEAD'){
    const reference=String(payload.source_reference||'');
    const references=Object.fromEntries(reference.split(';').map(part=>part.split('=')).filter(([key,value])=>key&&value));
    return leadOutboxPayload({company_name:payload.company_name,country_code:payload.country_code,website_url:payload.website_url,owner:payload.owner,references});
  }
  return payload;
}

export async function retryFailedCrmOutbox({pool,apply=false,ids=[],limit=100}={}){
  const rows=(await pool.query(`SELECT o.* FROM leadgen.crm_sync_outbox o
    WHERE o.record_scope='PROSPECT' AND o.sync_status='PERMANENT_ERROR' AND o.last_error=ANY($1::text[])
      AND ($2::uuid[] IS NULL OR o.id=ANY($2::uuid[]))
      AND NOT EXISTS(SELECT 1 FROM leadgen.crm_sync_outbox r WHERE r.idempotency_key=o.idempotency_key||':retry:'||o.id::text)
    ORDER BY o.created_at LIMIT $3`,[RETRYABLE_PAYLOAD_ERRORS,ids&&ids.length?ids:null,Math.max(1,Math.min(500,Number(limit)||100))])).rows;
  const planned=[];const rejected=[];
  for(const row of rows){
    let payload;
    try{payload=validateCrmPayload(row.operation,rebuiltPayload(row));}
    catch(error){rejected.push({outbox_id:row.id,operation:row.operation,code:error.code||'CRM_PAYLOAD_INVALID'});continue;}
    planned.push({failed_outbox_id:row.id,company_id:row.company_id,operation:row.operation,payload,idempotency_key:`${row.idempotency_key}:retry:${row.id}`,task_id:row.task_id,merchant_id:row.merchant_id});
  }
  if(apply)for(const item of planned){
    const inserted=(await pool.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,task_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
      VALUES($1,$2,$3,$4::jsonb,$5,'PENDING',now(),$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,sync_status`,
      [item.company_id,item.task_id,item.operation,JSON.stringify(item.payload),item.idempotency_key,item.merchant_id])).rows[0];
    item.new_outbox_id=inserted?.id||null;item.new_sync_status=inserted?.sync_status||'ALREADY_RETRIED';
  }
  return{dry_run:!apply,found:rows.length,planned,rejected};
}
