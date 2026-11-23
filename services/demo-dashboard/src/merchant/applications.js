// Merchant self-service application (migration 082): a company asks for a trial on the public page
// /apply.html; the SIM administrator approves it (the usual createMerchant: trial, temporary password
// shown once to SIM) or rejects it with a reason. Applications are never deleted or changed once decided.
import crypto from 'node:crypto';
import {fail,merchantUuid,normalizeLoginEmail} from './MerchantService.js';

export const APPLICATION_STATUSES=Object.freeze(['PENDING','APPROVED','REJECTED']);
const clean=(value,max)=>{const text=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();return text?text.slice(0,max):null;};
const cleanBlock=(value,max)=>{const text=String(value??'').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').trim();return text?text.slice(0,max):null;};

/** Validated application fields from the public form; throws a 422 with the field name. */
export function applicationInput(body={}){
  const company_name=clean(body.company_name,200);
  if(!company_name)throw fail('APPLICATION_COMPANY_REQUIRED','Company name is required',422,{field:'company_name'});
  const contact_name=clean(body.contact_name,120);
  if(!contact_name)throw fail('APPLICATION_CONTACT_REQUIRED','Contact name is required',422,{field:'contact_name'});
  let email;
  try{email=normalizeLoginEmail(body.email);}catch{throw fail('APPLICATION_EMAIL_INVALID','A valid email address is required',422,{field:'email'});}
  const phone=clean(body.phone,40);
  if(phone&&!/^[+\d][\d\s().-]{2,39}$/.test(phone))throw fail('APPLICATION_PHONE_INVALID','Phone number is not valid',422,{field:'phone'});
  return{company_name,contact_name,email,phone,country:clean(body.country,80),referrer:clean(body.referrer,200),message:cleanBlock(body.message,2000)};
}
/** A filled hidden field means an automated sender; it is answered like a success and not stored. */
export const looksAutomated=body=>Boolean(String(body?.website_url2??'').trim());

export class MerchantApplicationService{
  constructor({pool,merchants,salt=process.env.SESSION_SECRET||'sim-applications'}){Object.assign(this,{pool,merchants,salt});}
  ipHash(ip){return ip?crypto.createHash('sha256').update(`${this.salt}:${ip}`).digest('hex'):null;}

  /** Stores one application; a second one from the same email while the first is open is not stored again. */
  async submit(body={},{ip=null}={}){
    if(looksAutomated(body))return{status:'RECEIVED'};
    const input=applicationInput(body);
    const row=(await this.pool.query(`INSERT INTO leadgen.merchant_applications(company_name,contact_name,email,phone,country,referrer,message,source_ip_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
      [input.company_name,input.contact_name,input.email,input.phone,input.country,input.referrer,input.message,this.ipHash(ip)])).rows[0];
    return{status:'RECEIVED',stored:Boolean(row)};
  }

  async list({status}={}){
    const filter=status?String(status).toUpperCase():null;
    if(filter&&!APPLICATION_STATUSES.includes(filter))throw fail('APPLICATION_STATUS_INVALID','Unsupported status',422);
    const rows=(await this.pool.query(`SELECT a.id,a.company_name,a.contact_name,a.email,a.phone,a.country,a.referrer,a.message,a.status,
        a.decision_reason,a.decided_by,a.decided_at,a.merchant_id,a.created_at,
        EXISTS(SELECT 1 FROM leadgen.workspace_users u WHERE lower(u.email)=lower(a.email)) email_in_use
      FROM leadgen.merchant_applications a WHERE ($1::text IS NULL OR a.status=$1) ORDER BY (a.status='PENDING') DESC,a.created_at DESC LIMIT 200`,[filter])).rows;
    const counts=(await this.pool.query(`SELECT status,count(*)::int n FROM leadgen.merchant_applications GROUP BY status`)).rows;
    return{items:rows,counts:Object.fromEntries(APPLICATION_STATUSES.map(key=>[key,counts.find(row=>row.status===key)?.n||0]))};
  }

  /** Approve: open the merchant account (trial) and record the decision; the temporary password is shown once. */
  async approve(id,input={},actor){
    const applicationId=merchantUuid(id,'application_id');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const application=(await client.query('SELECT * FROM leadgen.merchant_applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
      if(!application)throw fail('APPLICATION_NOT_FOUND','Application not found',404);
      if(application.status!=='PENDING')throw fail('APPLICATION_DECIDED','This application was already decided',409);
      let created;
      try{
        created=await this.merchants.createMerchant({company_name:application.company_name,contact_name:application.contact_name,login_email:application.email,
          ...(input.trial_days!==undefined?{trial_days:input.trial_days}:{})},actor);
      }catch(error){
        if(error.code==='USER_EMAIL_TAKEN')throw fail('APPLICATION_EMAIL_TAKEN','This email already has an account',409);
        throw error;
      }
      const decided=(await client.query(`UPDATE leadgen.merchant_applications SET status='APPROVED',decided_by=$2,decided_at=now(),merchant_id=$3
        WHERE id=$1 RETURNING id,status,merchant_id,decided_at`,[applicationId,actor,created.merchant.id])).rows[0];
      await client.query('COMMIT');
      return{application:decided,...created};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }

  async reject(id,{reason}={},actor){
    const applicationId=merchantUuid(id,'application_id');
    const text=clean(reason,500);
    if(!text)throw fail('APPLICATION_REASON_REQUIRED','Write why the application is rejected',422,{field:'reason'});
    const row=(await this.pool.query(`UPDATE leadgen.merchant_applications SET status='REJECTED',decision_reason=$2,decided_by=$3,decided_at=now()
      WHERE id=$1 AND status='PENDING' RETURNING id,status,decision_reason,decided_at`,[applicationId,text,actor])).rows[0];
    if(row)return{application:row};
    const exists=(await this.pool.query('SELECT status FROM leadgen.merchant_applications WHERE id=$1',[applicationId])).rows[0];
    if(!exists)throw fail('APPLICATION_NOT_FOUND','Application not found',404);
    throw fail('APPLICATION_DECIDED','This application was already decided',409);
  }
}
