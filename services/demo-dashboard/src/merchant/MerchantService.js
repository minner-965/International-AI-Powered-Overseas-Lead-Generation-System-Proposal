import {randomBytes,randomInt} from 'node:crypto';
import {hash as argonHash,verify as argonVerify} from '@node-rs/argon2';
import {SmtpImapProviderAdapter} from '../outreach/smtpImapProvider.js';
import {createSecretBox} from './secretBox.js';
import {MAILBOX_PRESETS,presetByKey} from './mailboxPresets.js';
import {categoryNames,marketNames} from './referenceNames.js';
import {isMarketVisible} from '../../public/market-visibility.js';

export const MERCHANT_STATUSES=Object.freeze(['TRIAL','ACTIVE','EXPIRED','DISABLED']);
export const DEFAULT_FEATURES=Object.freeze({research:true,email:true,crm_sync:false});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DAY=86_400_000;

export const fail=(code,message,status=400,extra={})=>Object.assign(new Error(message),{code,status,...extra});
const clean=(value,max=200)=>{const text=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();return text?text.slice(0,max):null;};
const email=value=>{const text=String(value??'').trim().toLowerCase();if(!EMAIL.test(text)||text.length>320)throw fail('EMAIL_INVALID','A valid email address is required',422);return text;};
const nonNegativeInt=(value,label)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>1_000_000)throw fail('MERCHANT_QUOTA_INVALID',`${label} must be a whole number`,422);return n;};
const timestamp=(value,label)=>{if(value===null)return null;const d=new Date(value);if(Number.isNaN(d.getTime()))throw fail('MERCHANT_DATE_INVALID',`${label} must be a valid date`,422);return d.toISOString();};
export const merchantUuid=(value,label='merchant_id')=>{const text=String(value||'').trim();if(!UUID.test(text))throw fail('MERCHANT_INVALID_ID',`${label} must be a UUID`,400);return text;};

// Effective status from the stored status and the dates. A lapsed trial or paid period is
// EXPIRED: reads stay available, writes are refused until SIM extends or converts it.
export function effectiveMerchantStatus(merchant,now=new Date()){
  if(!merchant)return null;
  const at=now.getTime();
  if(merchant.status==='DISABLED')return 'DISABLED';
  if(merchant.status==='EXPIRED')return 'EXPIRED';
  if(merchant.status==='TRIAL'&&(!merchant.trial_ends_at||new Date(merchant.trial_ends_at).getTime()<=at))return 'EXPIRED';
  if(merchant.status==='ACTIVE'&&merchant.paid_until&&new Date(merchant.paid_until).getTime()<=at)return 'EXPIRED';
  return merchant.status;
}
export const featuresOf=merchant=>({...DEFAULT_FEATURES,...(merchant?.features||{})});

export function temporaryPassword(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({length:14},()=>alphabet[randomInt(alphabet.length)]).join('');
}
function referralCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join('');
}
export function validatePassword(value){
  const text=String(value??'');
  if(text.length<10||text.length>200)throw fail('PASSWORD_TOO_WEAK','Password must be 10–200 characters',422);
  if(!/[A-Za-z]/.test(text)||!/[0-9]/.test(text))throw fail('PASSWORD_TOO_WEAK','Password must contain letters and digits',422);
  return text;
}
// Argon2id with the library defaults (OWASP-recommended parameters).
export const hashPassword=password=>argonHash(password);
export const verifyPassword=async(hash,password)=>{try{return await argonVerify(hash,String(password??''));}catch{return false;}};

// Count used by both the follow-up quota display and the sending gate for a merchant.
export async function countMerchantEmailsToday(queryable,merchantId){
  return Number((await queryable.query(`SELECT count(*)::int count FROM leadgen.outbound_messages
    WHERE merchant_id=$1 AND provider_purpose='COLD_OUTREACH' AND send_status IN('QUEUED','SENDING','PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS')
      AND coalesce(sent_at,send_reserved_at,queued_at)>=date_trunc('day',now())`,[merchantId])).rows[0]?.count||0);
}
// Executed searches (any provider, SearXNG included; zero-cost reuse excluded) this UTC month
// for research jobs created by the merchant's batches.
export async function countMerchantSearchesThisMonth(queryable,merchantId){
  return Number((await queryable.query(`SELECT count(*)::int count FROM leadgen.provider_usage_events e
    JOIN leadgen.research_jobs j ON j.id=e.research_job_id
    WHERE j.merchant_id=$1 AND e.billing_period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM') AND e.status<>'SKIPPED'
      AND (e.status IN('COMPLETED','NOT_FOUND','RESERVED') OR e.used_units>0)`,[merchantId])).rows[0]?.count||0);
}

export class MerchantService{
  constructor({pool,env=process.env,now=()=>new Date(),providerFactory=config=>new SmtpImapProviderAdapter(config)}={}){
    if(!pool)throw new Error('MerchantService requires a PostgreSQL pool');
    Object.assign(this,{pool,env,now,providerFactory});
    this.secretBox=createSecretBox(env.MERCHANT_SECRET_KEY);
    this.defaultTrialDays=Math.max(1,Math.min(365,Number(env.MERCHANT_TRIAL_DAYS||7)));
    this.defaultMonthlySearches=Math.max(0,Number(env.MERCHANT_DEFAULT_MONTHLY_SEARCHES||300));
    this.defaultDailyEmails=Math.max(0,Number(env.MERCHANT_DEFAULT_DAILY_EMAILS||30));
  }

  async transaction(fn){
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async getMerchant(id,queryable=this.pool){return (await queryable.query('SELECT * FROM leadgen.merchants WHERE id=$1',[merchantUuid(id)])).rows[0]||null;}
  async requireMerchant(id,queryable){const row=await this.getMerchant(id,queryable);if(!row)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);return row;}

  async usage(merchantId){
    const [searches,emails,leads,login]=await Promise.all([
      countMerchantSearchesThisMonth(this.pool,merchantId),countMerchantEmailsToday(this.pool,merchantId),
      this.pool.query('SELECT count(*)::int count FROM leadgen.merchant_companies WHERE merchant_id=$1',[merchantId]),
      this.pool.query('SELECT max(last_login_at) at FROM leadgen.workspace_users WHERE merchant_id=$1',[merchantId])]);
    return{searches_this_month:searches,emails_today:emails,leads:Number(leads.rows[0]?.count||0),last_login_at:login.rows[0]?.at||null};
  }

  merchantView(row,usage=null){
    if(!row)return null;
    const status=effectiveMerchantStatus(row,this.now());
    return{id:row.id,company_name:row.company_name,sender_name:row.sender_name||row.contact_name||null,status,
      trial_ends_at:row.trial_ends_at,paid_until:row.paid_until,read_only:status==='EXPIRED'||status==='DISABLED',
      quotas:{monthly_searches:row.monthly_search_quota,daily_emails:row.daily_email_quota},
      usage:usage?{searches_this_month:usage.searches_this_month,emails_today:usage.emails_today}:null,
      features:featuresOf(row),referral_code:row.referral_code};
  }

  async userView(user,{withUsage=true}={}){
    if(!user)return null;
    let merchant=null;
    if(user.merchant_id){const row=await this.getMerchant(user.merchant_id);merchant=this.merchantView(row,withUsage?await this.usage(row.id):null);}
    return{id:user.id,email:user.email,display_name:user.display_name||null,role:user.role,must_change_password:user.must_change_password===true,merchant};
  }

  async findUserById(id){return (await this.pool.query('SELECT * FROM leadgen.workspace_users WHERE id=$1',[id])).rows[0]||null;}

  // ---- authentication ----
  async authenticate({email:login,password}){
    const address=String(login??'').trim().toLowerCase();
    const user=EMAIL.test(address)?(await this.pool.query('SELECT * FROM leadgen.workspace_users WHERE lower(email)=$1',[address])).rows[0]:null;
    // Hash work happens even for unknown users so timing does not reveal accounts.
    this.dummyHash??=await hashPassword(randomBytes(16).toString('hex'));
    const valid=user?await verifyPassword(user.password_hash,password):(await verifyPassword(this.dummyHash,password),false);
    if(!user||!valid||user.disabled_at)throw fail('AUTH_INVALID_CREDENTIALS','Email or password is incorrect',401);
    if(user.merchant_id){
      const merchant=await this.getMerchant(user.merchant_id);
      if(effectiveMerchantStatus(merchant,this.now())==='DISABLED')throw fail('MERCHANT_DISABLED','This account is disabled',403);
    }
    await this.pool.query('UPDATE leadgen.workspace_users SET last_login_at=now() WHERE id=$1',[user.id]);
    return user;
  }

  async changePassword(userId,{current_password,new_password}){
    const user=await this.findUserById(userId);
    if(!user||!await verifyPassword(user.password_hash,current_password))throw fail('AUTH_INVALID_CREDENTIALS','Current password is incorrect',401);
    const next=validatePassword(new_password);
    if(next===String(current_password))throw fail('PASSWORD_UNCHANGED','Choose a new password',422);
    await this.pool.query(`UPDATE leadgen.workspace_users SET password_hash=$2,must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=$1`,
      [userId,await hashPassword(next)]);
    return this.findUserById(userId);
  }

  async createAdmin({email:login,password,display_name=null,actor='create-admin-script'}){
    const address=email(login);const secret=validatePassword(password);
    const existing=(await this.pool.query('SELECT * FROM leadgen.workspace_users WHERE lower(email)=$1',[address])).rows[0];
    if(existing&&existing.role!=='ADMIN')throw fail('USER_EMAIL_TAKEN','This email belongs to a merchant user',409);
    const hash=await hashPassword(secret);
    if(existing){
      return (await this.pool.query(`UPDATE leadgen.workspace_users SET password_hash=$2,display_name=coalesce($3,display_name),
        must_change_password=false,disabled_at=NULL,password_changed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[existing.id,hash,clean(display_name)])).rows[0];
    }
    return (await this.pool.query(`INSERT INTO leadgen.workspace_users(email,display_name,password_hash,role,must_change_password,created_by,password_changed_at)
      VALUES($1,$2,$3,'ADMIN',false,$4,now()) RETURNING *`,[address,clean(display_name),hash,actor])).rows[0];
  }

  // ---- admin ----
  async listMerchants(){
    const rows=(await this.pool.query(`SELECT m.*,r.company_name referred_by_company,u.email login_email
      FROM leadgen.merchants m LEFT JOIN leadgen.merchants r ON r.id=m.referred_by_merchant_id
      LEFT JOIN LATERAL(SELECT email FROM leadgen.workspace_users w WHERE w.merchant_id=m.id ORDER BY created_at LIMIT 1) u ON true
      ORDER BY m.created_at DESC`)).rows;
    const items=[];
    for(const row of rows)items.push(await this.adminMerchantView(row));
    return{items};
  }

  async adminMerchantView(row){
    const usage=await this.usage(row.id);
    return{id:row.id,company_name:row.company_name,contact_name:row.contact_name,sender_name:row.sender_name,login_email:row.login_email||null,
      status:effectiveMerchantStatus(row,this.now()),stored_status:row.status,trial_ends_at:row.trial_ends_at,paid_until:row.paid_until,
      referral_code:row.referral_code,referred_by:row.referred_by_merchant_id?{id:row.referred_by_merchant_id,company_name:row.referred_by_company||null}:null,
      quotas:{monthly_searches:row.monthly_search_quota,daily_emails:row.daily_email_quota},usage,features:featuresOf(row),created_at:row.created_at};
  }

  async adminMerchant(id){
    const row=(await this.pool.query(`SELECT m.*,r.company_name referred_by_company,u.email login_email FROM leadgen.merchants m
      LEFT JOIN leadgen.merchants r ON r.id=m.referred_by_merchant_id
      LEFT JOIN LATERAL(SELECT email FROM leadgen.workspace_users w WHERE w.merchant_id=m.id ORDER BY created_at LIMIT 1) u ON true
      WHERE m.id=$1`,[merchantUuid(id)])).rows[0];
    if(!row)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
    return this.adminMerchantView(row);
  }

  normalizeFeatures(input,base=DEFAULT_FEATURES){
    if(input===undefined)return{...base};
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('MERCHANT_FEATURES_INVALID','features must be an object',422);
    const next={...base};
    for(const key of Object.keys(DEFAULT_FEATURES))if(input[key]!==undefined)next[key]=input[key]===true;
    return next;
  }

  async createMerchant(input={},actor){
    const company=clean(input.company_name);if(!company)throw fail('MERCHANT_COMPANY_REQUIRED','Company name is required',422);
    const contact=clean(input.contact_name);const login=email(input.login_email);
    const days=input.trial_days===undefined?this.defaultTrialDays:Number(input.trial_days);
    if(!Number.isInteger(days)||days<1||days>365)throw fail('MERCHANT_TRIAL_DAYS_INVALID','trial_days must be 1–365',422);
    const quotas=input.quotas||{};
    const monthly=quotas.monthly_searches===undefined?this.defaultMonthlySearches:nonNegativeInt(quotas.monthly_searches,'monthly_searches');
    const daily=quotas.daily_emails===undefined?this.defaultDailyEmails:nonNegativeInt(quotas.daily_emails,'daily_emails');
    const features=this.normalizeFeatures(input.features);
    const referrer=input.referred_by_merchant_id?merchantUuid(input.referred_by_merchant_id,'referred_by_merchant_id'):null;
    const password=temporaryPassword();const hash=await hashPassword(password);
    return this.transaction(async client=>{
      if(referrer&&!(await client.query('SELECT 1 FROM leadgen.merchants WHERE id=$1',[referrer])).rowCount)throw fail('MERCHANT_REFERRER_NOT_FOUND','Referring merchant not found',404);
      if((await client.query('SELECT 1 FROM leadgen.workspace_users WHERE lower(email)=$1',[login])).rowCount)throw fail('USER_EMAIL_TAKEN','This login email is already used',409);
      let merchant=null;
      for(let attempt=0;attempt<5&&!merchant;attempt++){
        merchant=(await client.query(`INSERT INTO leadgen.merchants(company_name,contact_name,sender_name,status,trial_ends_at,referral_code,referred_by_merchant_id,
            monthly_search_quota,daily_email_quota,features,created_by)
          VALUES($1,$2,$2,'TRIAL',now()+make_interval(days=>$3),$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(referral_code) DO NOTHING RETURNING *`,
          [company,contact,days,referralCode(),referrer,monthly,daily,JSON.stringify(features),actor])).rows[0]||null;
      }
      if(!merchant)throw fail('MERCHANT_REFERRAL_CODE_FAILED','Could not allocate a referral code',500);
      const user=(await client.query(`INSERT INTO leadgen.workspace_users(email,display_name,password_hash,role,merchant_id,must_change_password,created_by)
        VALUES($1,$2,$3,'MERCHANT',$4,true,$5) RETURNING *`,[login,contact,hash,merchant.id,actor])).rows[0];
      return{merchant:this.merchantView(merchant),user:{id:user.id,email:user.email,display_name:user.display_name,role:user.role,must_change_password:true},
        temporary_password:password};
    });
  }

  async updateMerchant(id,input={},actor){
    const merchantId=merchantUuid(id);
    return this.transaction(async client=>{
      const current=(await client.query('SELECT * FROM leadgen.merchants WHERE id=$1 FOR UPDATE',[merchantId])).rows[0];
      if(!current)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
      const next={...current};
      if(input.company_name!==undefined){next.company_name=clean(input.company_name);if(!next.company_name)throw fail('MERCHANT_COMPANY_REQUIRED','Company name is required',422);}
      if(input.contact_name!==undefined)next.contact_name=clean(input.contact_name);
      if(input.sender_name!==undefined)next.sender_name=clean(input.sender_name,120);
      if(input.trial_ends_at!==undefined)next.trial_ends_at=timestamp(input.trial_ends_at,'trial_ends_at');
      if(input.paid_until!==undefined)next.paid_until=timestamp(input.paid_until,'paid_until');
      if(input.extend_trial_days!==undefined){
        const days=Number(input.extend_trial_days);
        if(!Number.isInteger(days)||days<1||days>365)throw fail('MERCHANT_TRIAL_DAYS_INVALID','extend_trial_days must be 1–365',422);
        const base=Math.max(this.now().getTime(),next.trial_ends_at?new Date(next.trial_ends_at).getTime():0);
        next.trial_ends_at=new Date(base+days*DAY).toISOString();
        if(input.status===undefined&&['TRIAL','EXPIRED'].includes(current.status))next.status='TRIAL';
      }
      if(input.status!==undefined){
        const status=String(input.status||'').toUpperCase();
        if(!MERCHANT_STATUSES.includes(status))throw fail('MERCHANT_STATUS_INVALID','Unsupported status',422);
        next.status=status;
      }
      if(input.quotas!==undefined){
        if(!input.quotas||typeof input.quotas!=='object')throw fail('MERCHANT_QUOTA_INVALID','quotas must be an object',422);
        if(input.quotas.monthly_searches!==undefined)next.monthly_search_quota=nonNegativeInt(input.quotas.monthly_searches,'monthly_searches');
        if(input.quotas.daily_emails!==undefined)next.daily_email_quota=nonNegativeInt(input.quotas.daily_emails,'daily_emails');
      }
      if(input.features!==undefined)next.features=this.normalizeFeatures(input.features,featuresOf(current));
      const row=(await client.query(`UPDATE leadgen.merchants SET company_name=$2,contact_name=$3,sender_name=$4,status=$5,trial_ends_at=$6,paid_until=$7,
          monthly_search_quota=$8,daily_email_quota=$9,features=$10::jsonb,updated_at=now() WHERE id=$1 RETURNING *`,
        [merchantId,next.company_name,next.contact_name,next.sender_name,next.status,next.trial_ends_at,next.paid_until,
          next.monthly_search_quota,next.daily_email_quota,JSON.stringify(featuresOf(next))])).rows[0];
      void actor;
      return row;
    }).then(()=>this.adminMerchant(merchantId));
  }

  async resetPassword(id){
    const merchantId=merchantUuid(id);
    const password=temporaryPassword();
    const updated=await this.pool.query(`UPDATE leadgen.workspace_users SET password_hash=$2,must_change_password=true,updated_at=now()
      WHERE merchant_id=$1 RETURNING id`,[merchantId,await hashPassword(password)]);
    if(!updated.rowCount)throw fail('MERCHANT_NOT_FOUND','Merchant user not found',404);
    return{temporary_password:password};
  }

  async assignCompanies(id,companyIds,actor){
    const merchantId=merchantUuid(id);await this.requireMerchant(merchantId);
    if(!Array.isArray(companyIds)||!companyIds.length||companyIds.length>500)throw fail('MERCHANT_COMPANIES_INVALID','company_ids must list 1–500 companies',422);
    const ids=[...new Set(companyIds.map(value=>merchantUuid(value,'company_id')))];
    const result=await this.pool.query(`INSERT INTO leadgen.merchant_companies(merchant_id,company_id,source,assigned_by)
      SELECT $1,c.id,'ADMIN',$3 FROM leadgen.companies c WHERE c.id=ANY($2::uuid[]) ON CONFLICT DO NOTHING RETURNING company_id`,[merchantId,ids,actor]);
    return{assigned:result.rowCount};
  }

  // ---- feedback ----
  async createFeedback({page,message},user){
    const text=clean(message,4000);if(!text)throw fail('FEEDBACK_MESSAGE_REQUIRED','Message is required',422);
    const row=(await this.pool.query(`INSERT INTO leadgen.merchant_feedback(merchant_id,user_id,user_email,page,message)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[user?.merchant_id||null,user?.id||null,user?.email||null,clean(page,500),text])).rows[0];
    return{id:row.id,status:row.status,created_at:row.created_at};
  }
  async listFeedback({status}={}){
    const filter=status===undefined||status===''||status==='ALL'?null:String(status).toUpperCase();
    if(filter&&!['OPEN','DONE'].includes(filter))throw fail('FEEDBACK_STATUS_INVALID','status must be OPEN or DONE',422);
    const rows=(await this.pool.query(`SELECT f.*,m.company_name FROM leadgen.merchant_feedback f LEFT JOIN leadgen.merchants m ON m.id=f.merchant_id
      WHERE ($1::text IS NULL OR f.status=$1) ORDER BY f.created_at DESC LIMIT 500`,[filter])).rows;
    return{items:rows.map(row=>({id:row.id,merchant:row.merchant_id?{id:row.merchant_id,company_name:row.company_name}:null,user_email:row.user_email,
      page:row.page,message:row.message,status:row.status,created_at:row.created_at,handled_at:row.handled_at,handled_by:row.handled_by}))};
  }
  async updateFeedback(id,{status},actor){
    const next=String(status||'').toUpperCase();if(!['OPEN','DONE'].includes(next))throw fail('FEEDBACK_STATUS_INVALID','status must be OPEN or DONE',422);
    const row=(await this.pool.query(`UPDATE leadgen.merchant_feedback SET status=$2,handled_by=CASE WHEN $2='DONE' THEN $3 ELSE NULL END,
      handled_at=CASE WHEN $2='DONE' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,[merchantUuid(id,'feedback_id'),next,actor])).rows[0];
    if(!row)throw fail('FEEDBACK_NOT_FOUND','Feedback not found',404);
    return{id:row.id,status:row.status,handled_at:row.handled_at};
  }

  // ---- merchant self-service ----
  async profile(merchantId){
    const row=await this.requireMerchant(merchantId);
    return{...this.merchantView(row,await this.usage(merchantId)),contact_name:row.contact_name};
  }
  async updateProfile(merchantId,input={}){
    const patch={};
    if(input.company_name!==undefined){patch.company_name=clean(input.company_name);if(!patch.company_name)throw fail('MERCHANT_COMPANY_REQUIRED','Company name is required',422);}
    if(input.sender_name!==undefined){patch.sender_name=clean(input.sender_name,120);if(!patch.sender_name)throw fail('MERCHANT_SENDER_REQUIRED','Sender name is required',422);}
    if(!Object.keys(patch).length)throw fail('MERCHANT_NO_CHANGE','Nothing to update',422);
    if(/[\r\n<>\[\]]/.test(`${patch.company_name||''}${patch.sender_name||''}`))throw fail('MERCHANT_NAME_INVALID','Names cannot contain line breaks or brackets',422);
    await this.pool.query(`UPDATE leadgen.merchants SET company_name=coalesce($2,company_name),sender_name=coalesce($3,sender_name),updated_at=now() WHERE id=$1`,
      [merchantUuid(merchantId),patch.company_name??null,patch.sender_name??null]);
    return this.profile(merchantId);
  }

  presets(){return{items:MAILBOX_PRESETS.map(item=>({...item}))};}

  async mailboxRow(merchantId,queryable=this.pool){return (await queryable.query('SELECT * FROM leadgen.merchant_mailboxes WHERE merchant_id=$1',[merchantUuid(merchantId)])).rows[0]||null;}
  mailboxView(row){
    if(!row)return{configured:false,from_email:null,from_name:null,reply_to:null,smtp_host:null,smtp_port:587,imap_host:null,imap_port:993,username:null,
      verified_at:null,last_test:{smtp:null,imap:null,at:null},password_set:false};
    return{configured:true,preset_key:row.preset_key,from_email:row.from_email,from_name:row.from_name,reply_to:row.reply_to,smtp_host:row.smtp_host,smtp_port:row.smtp_port,
      imap_host:row.imap_host,imap_port:row.imap_port,username:row.username,verified_at:row.verified_at,
      last_test:{smtp:row.last_test?.smtp||null,imap:row.last_test?.imap||null,at:row.last_test?.at||null},password_set:Boolean(row.password_ciphertext)};
  }
  async mailbox(merchantId){return this.mailboxView(await this.mailboxRow(merchantId));}

  async saveMailbox(merchantId,input={},actor){
    const id=merchantUuid(merchantId);await this.requireMerchant(id);
    const preset=input.preset_key?presetByKey(String(input.preset_key)):null;
    if(input.preset_key&&!preset)throw fail('MAILBOX_PRESET_INVALID','Unknown mailbox preset',422);
    const host=value=>{const text=String(value??'').trim().toLowerCase();if(!/^[a-z0-9.-]{3,255}$/.test(text)||!text.includes('.'))throw fail('MAILBOX_HOST_INVALID','A valid server host is required',422);return text;};
    const smtpHost=host(input.smtp_host??preset?.smtp_host);const imapHost=host(input.imap_host??preset?.imap_host);
    const smtpPort=Number(input.smtp_port??preset?.smtp_port??587);const imapPort=Number(input.imap_port??preset?.imap_port??993);
    // Transport contract kept from SIM's own mailbox: SMTP 587 STARTTLS, IMAP 993 TLS.
    if(smtpPort!==587)throw fail('SMTP_STARTTLS_587_REQUIRED','SMTP must use port 587 (STARTTLS)',422);
    if(imapPort!==993)throw fail('IMAP_TLS_993_REQUIRED','IMAP must use port 993 (TLS)',422);
    const username=email(input.username);const fromEmail=email(input.from_email??username);const replyTo=email(input.reply_to??username);
    // Sender and reply address must be the bound mailbox: replies are read from that inbox.
    if(fromEmail!==username||replyTo!==username)throw fail('MAILBOX_ADDRESS_MISMATCH','Sender and reply-to must be the mailbox login address',422);
    const fromName=clean(input.from_name,120);
    if(fromName&&/[<>"\r\n]/.test(fromName))throw fail('MAILBOX_FROM_NAME_INVALID','Sender name contains unsupported characters',422);
    const existing=await this.mailboxRow(id);
    let ciphertext=existing?.password_ciphertext||null;
    if(input.password!==undefined&&input.password!==null&&input.password!==''){
      const password=String(input.password);if(password.length>500)throw fail('MAILBOX_PASSWORD_INVALID','Password is too long',422);
      ciphertext=this.secretBox.encrypt(password,`merchant-mailbox:${id}`);
    }
    if(!ciphertext)throw fail('MAILBOX_PASSWORD_REQUIRED','Mailbox password (or app password) is required',422);
    const changed=!existing||existing.smtp_host!==smtpHost||existing.imap_host!==imapHost||existing.username!==username||ciphertext!==existing.password_ciphertext;
    await this.pool.query(`INSERT INTO leadgen.merchant_mailboxes(merchant_id,preset_key,smtp_host,smtp_port,imap_host,imap_port,username,password_ciphertext,
        from_email,from_name,reply_to,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(merchant_id) DO UPDATE SET preset_key=EXCLUDED.preset_key,smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,
        imap_host=EXCLUDED.imap_host,imap_port=EXCLUDED.imap_port,username=EXCLUDED.username,password_ciphertext=EXCLUDED.password_ciphertext,
        from_email=EXCLUDED.from_email,from_name=EXCLUDED.from_name,reply_to=EXCLUDED.reply_to,updated_by=EXCLUDED.updated_by,updated_at=now(),
        verified_at=CASE WHEN $13 THEN NULL ELSE leadgen.merchant_mailboxes.verified_at END,
        last_test=CASE WHEN $13 THEN '{}'::jsonb ELSE leadgen.merchant_mailboxes.last_test END`,
      [id,preset?.key||null,smtpHost,smtpPort,imapHost,imapPort,username,ciphertext,fromEmail,fromName,replyTo,actor,changed]);
    return this.mailbox(id);
  }

  // SMTP/IMAP adapter for a merchant mailbox. `verified` gates production sending.
  providerConfig(row,merchant,{controlledRecipient=null}={}){
    const password=this.secretBox.decrypt(row.password_ciphertext,`merchant-mailbox:${row.merchant_id}`);
    return{enabled:true,inboundEnabled:true,controlledTestMode:Boolean(controlledRecipient),controlledRecipientAllowlist:controlledRecipient||'',
      useCaseApproved:Boolean(row.verified_at),smtpHost:row.smtp_host,smtpPort:row.smtp_port,smtpSecure:false,smtpRequireTls:true,
      smtpUser:row.username,smtpPassword:password,senderEmail:row.from_email,replyToEmail:row.reply_to,
      imapHost:row.imap_host,imapPort:row.imap_port,imapTls:true,imapUser:row.username,imapPassword:password,
      imapInbox:'INBOX',messageIdDomain:String(row.from_email).split('@')[1],senderDisplayName:row.from_name||merchant?.sender_name||null};
  }

  async testConnection(merchantId){
    const id=merchantUuid(merchantId);const row=await this.mailboxRow(id);
    if(!row)throw fail('MERCHANT_MAILBOX_NOT_CONFIGURED','Mailbox is not configured',409);
    const provider=this.providerFactory(this.providerConfig(row,await this.getMerchant(id)));
    const result=await provider.testConnections();
    const at=this.now().toISOString();
    const ok=result.smtp?.ok===true&&result.imap?.ok===true;
    await this.pool.query(`UPDATE leadgen.merchant_mailboxes SET last_test=$2::jsonb,verified_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now() WHERE merchant_id=$1`,
      [id,JSON.stringify({smtp:result.smtp,imap:result.imap,at}),ok]);
    return{smtp:result.smtp,imap:result.imap};
  }

  async testEmail(merchantId){
    const id=merchantUuid(merchantId);const row=await this.mailboxRow(id);
    if(!row)throw fail('MERCHANT_MAILBOX_NOT_CONFIGURED','Mailbox is not configured',409);
    const merchant=await this.getMerchant(id);
    const provider=this.providerFactory(this.providerConfig(row,merchant,{controlledRecipient:row.from_email}));
    const name=row.from_name||merchant.sender_name||merchant.company_name;
    const result=await provider.send({from:`${name} <${row.from_email}>`,to:row.from_email,reply_to:row.reply_to,
      subject:'SIM workspace test email',body_text:`This test message confirms that ${merchant.company_name} can send email from ${row.from_email}.`,
      purpose:'TRANSACTIONAL'},`merchant-test-email:${id}:${randomBytes(8).toString('hex')}`);
    return{ok:result.status==='PROVIDER_ACCEPTED',code:result.code||result.status};
  }

  // Production provider for a merchant's sending and inbound sync.
  async providerFor(merchantId,{requireVerified=true}={}){
    const id=merchantUuid(merchantId);
    const merchant=await this.requireMerchant(id);
    const row=await this.mailboxRow(id);
    if(!row||(requireVerified&&!row.verified_at))throw fail('MERCHANT_MAILBOX_NOT_VERIFIED','Bind and test the sending mailbox first',409);
    const provider=this.providerFactory(this.providerConfig(row,merchant));
    return{provider,merchant,mailbox:row,sender:{sender_name:merchant.sender_name||merchant.contact_name||merchant.company_name,company_name:merchant.company_name},
      fromName:row.from_name||merchant.sender_name||merchant.company_name};
  }

  async senderFor(merchantId){
    const merchant=await this.requireMerchant(merchantId);
    return{sender_name:merchant.sender_name||merchant.contact_name||merchant.company_name,company_name:merchant.company_name};
  }

  async scope(merchantId){
    const row=(await this.pool.query('SELECT * FROM leadgen.merchant_scope WHERE merchant_id=$1',[merchantUuid(merchantId)])).rows[0];
    const [markets,categories]=await Promise.all([
      this.pool.query(`SELECT market_code,country_name FROM leadgen.research_market_registry WHERE status='ACTIVE' AND search_enabled=true ORDER BY market_code`),
      this.pool.query(`SELECT id,normalized_category,product_profile FROM leadgen.dpv_product_category_scope_current
        WHERE scope_status='ACTIVE' AND approval_status='APPROVED' ORDER BY product_profile,normalized_category,id`)]);
    // Choices: SIM-approved categories and active markets (merchants cannot read the SIM registries).
    return{category_scope_ids:row?.category_scope_ids||[],market_codes:row?.market_codes||[],updated_at:row?.updated_at||null,
      available_markets:markets.rows.filter(m=>isMarketVisible(m.market_code)).map(m=>({code:m.market_code,...marketNames(m.market_code,m.country_name)})),
      available_categories:categories.rows.map(c=>{const names=categoryNames(c.normalized_category);
        return{id:c.id,code:c.normalized_category,product_profile:c.product_profile,name_en:names.name_en,name_zh:names.name_zh};})};
  }
  async saveScope(merchantId,input={},actor){
    const id=merchantUuid(merchantId);
    if(!Array.isArray(input.category_scope_ids)||!Array.isArray(input.market_codes))throw fail('MERCHANT_SCOPE_INVALID','category_scope_ids and market_codes must be lists',422);
    const categories=[...new Set(input.category_scope_ids.map(value=>merchantUuid(value,'category_scope_id').toLowerCase()))];
    const markets=[...new Set(input.market_codes.map(value=>String(value||'').trim().toUpperCase()))];
    if(markets.some(code=>!/^[A-Z]{2}$/.test(code)))throw fail('MERCHANT_SCOPE_INVALID','market_codes must be ISO country codes',422);
    const approved=new Set((await this.pool.query(`SELECT id::text FROM leadgen.dpv_product_category_scope_current
      WHERE scope_status='ACTIVE' AND approval_status='APPROVED' AND id=ANY($1::uuid[])`,[categories])).rows.map(row=>row.id));
    const active=new Set((await this.pool.query(`SELECT market_code FROM leadgen.research_market_registry
      WHERE status='ACTIVE' AND search_enabled=true AND market_code=ANY($1::text[])`,[markets])).rows.map(row=>row.market_code));
    const badCategory=categories.find(value=>!approved.has(value));const badMarket=markets.find(value=>!active.has(value));
    if(badCategory)throw fail('MERCHANT_CATEGORY_NOT_APPROVED','Choose categories approved by SIM',422,{details:{category_scope_id:badCategory}});
    if(badMarket)throw fail('MERCHANT_MARKET_NOT_ACTIVE','Choose active markets',422,{details:{market_code:badMarket}});
    await this.pool.query(`INSERT INTO leadgen.merchant_scope(merchant_id,category_scope_ids,market_codes,updated_by) VALUES($1,$2::uuid[],$3::text[],$4)
      ON CONFLICT(merchant_id) DO UPDATE SET category_scope_ids=EXCLUDED.category_scope_ids,market_codes=EXCLUDED.market_codes,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [id,categories,markets,actor]);
    return this.scope(id);
  }

  async onboarding(merchantId){
    const id=merchantUuid(merchantId);
    const [mailbox,scope,batch]=await Promise.all([this.mailboxRow(id),this.scope(id),
      this.pool.query('SELECT 1 FROM leadgen.research_batches WHERE merchant_id=$1 LIMIT 1',[id])]);
    return{steps:[{key:'mailbox',done:Boolean(mailbox?.verified_at)},{key:'categories',done:scope.category_scope_ids.length>0},
      {key:'markets',done:scope.market_codes.length>0},{key:'first_search',done:batch.rowCount>0}]};
  }

  // ---- quotas ----
  async assertSearchQuota(merchantId,plannedQueries,queryable=this.pool){
    const merchant=await this.requireMerchant(merchantId,queryable);
    const used=await countMerchantSearchesThisMonth(queryable,merchant.id);
    const planned=Math.max(0,Number(plannedQueries)||0);
    if(used+planned>merchant.monthly_search_quota)throw fail('MERCHANT_SEARCH_QUOTA_EXCEEDED','Monthly search quota reached',409,
      {details:{searches_this_month:used,planned_queries:planned,monthly_searches:merchant.monthly_search_quota}});
    return{searches_this_month:used,monthly_searches:merchant.monthly_search_quota,remaining:merchant.monthly_search_quota-used};
  }
  // Execution guard for a queued research job created by a merchant batch.
  async searchAllowedForJob(jobId){
    const job=(await this.pool.query('SELECT merchant_id FROM leadgen.research_jobs WHERE id=$1',[jobId])).rows[0];
    if(!job?.merchant_id)return{allowed:true};
    const merchant=await this.getMerchant(job.merchant_id);
    const status=effectiveMerchantStatus(merchant,this.now());
    if(status!=='TRIAL'&&status!=='ACTIVE')return{allowed:false,code:'MERCHANT_READ_ONLY'};
    if(!featuresOf(merchant).research)return{allowed:false,code:'MERCHANT_FEATURE_DISABLED'};
    const used=await countMerchantSearchesThisMonth(this.pool,merchant.id);
    return used<merchant.monthly_search_quota?{allowed:true}:{allowed:false,code:'MERCHANT_SEARCH_QUOTA_EXCEEDED'};
  }
  // Sending gate shared by first touch and follow-ups.
  async emailAllowance(merchantId,queryable=this.pool){
    const merchant=await this.requireMerchant(merchantId,queryable);
    const status=effectiveMerchantStatus(merchant,this.now());
    if(status!=='TRIAL'&&status!=='ACTIVE')return{allowed:false,code:'MERCHANT_READ_ONLY',merchant};
    if(!featuresOf(merchant).email)return{allowed:false,code:'MERCHANT_FEATURE_DISABLED',merchant};
    const sent=await countMerchantEmailsToday(queryable,merchant.id);
    return{allowed:sent<merchant.daily_email_quota,code:sent<merchant.daily_email_quota?'ALLOWED':'MERCHANT_EMAIL_QUOTA_EXCEEDED',merchant,
      sent_today:sent,daily_limit:merchant.daily_email_quota,remaining:Math.max(0,merchant.daily_email_quota-sent)};
  }
  async sendingMerchants(){
    return (await this.pool.query(`SELECT m.* FROM leadgen.merchants_current m JOIN leadgen.merchant_mailboxes b ON b.merchant_id=m.id
      WHERE m.effective_status IN('TRIAL','ACTIVE') AND b.verified_at IS NOT NULL AND coalesce((m.features->>'email')::boolean,true)
      ORDER BY m.created_at`)).rows;
  }
}
