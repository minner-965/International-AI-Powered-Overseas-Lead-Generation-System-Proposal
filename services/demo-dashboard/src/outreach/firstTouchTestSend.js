// B2: "发测试首封 / Send test first email". Renders the real approved first-touch template (A/B/C)
// with a company's variables or fixed sample variables and sends it at once, subject prefixed
// "[TEST]", to the sender's own mailbox or (SIM only) an address on TEST_RECIPIENT_ALLOWLIST.
// It ignores the market send window and writes only leadgen.first_touch_test_sends: no first-touch
// reservation, no outbound message, no quota use, no change to "already contacted". At most
// FIRST_TOUCH_TEST_DAILY_LIMIT (default 10) per sender per day, checked on the server.
import {loadPhase13EmailEligibilityFacts} from './Phase13EmailFactLoader.js';
import {FIRST_TOUCH_SENDER_NAME,renderFirstTouchTemplate,selectFirstTouchTemplate} from './firstTouchTemplates.js';
import {manualTemplateKey,manualTemplateVariables} from './manualFirstTouch.js';
import {companyVisible} from '../merchant/scope.js';
import {TEMPLATE_KEYS,contentHash,fail,isAdmin,normalizeEmail,ownerOf,parseAllowlist,transaction,uuidOf} from '../companies/common.js';

export const TEST_SUBJECT_PREFIX='[TEST] ';
// Clearly fictitious values used when no company is chosen (or a company lacks a value).
export const SAMPLE_VARIABLES=Object.freeze({company:'Sample Trading LLC',market:'United Arab Emirates',category:'Dresses',
  target_category:'Dresses',matched_category:'Dresses',first_name:'Alex'});

export class FirstTouchTestSendService{
  constructor({pool,outboundProvider,merchantSending=null,env=process.env,audit=()=>{}}={}){Object.assign(this,{pool,outboundProvider,merchantSending,env,audit});}

  dailyLimit(){const value=Number.parseInt(this.env.FIRST_TOUCH_TEST_DAILY_LIMIT,10);return Number.isInteger(value)&&value>0?value:10;}

  async senderContext(scope){
    const owner=ownerOf(scope);
    if(!owner){
      const provider=this.outboundProvider;
      if(!provider?.senderEmail)throw fail('SENDER_NOT_CONFIGURED','The sending mailbox is not set up',409);
      return{owner:null,provider,sender:null,fromName:FIRST_TOUCH_SENDER_NAME,own:[provider.senderEmail,provider.replyToEmail]};
    }
    if(!this.merchantSending)throw fail('MERCHANT_MAILBOX_NOT_VERIFIED','Bind and test the sending mailbox first',409);
    const allowance=await this.merchantSending.emailAllowance(owner);
    if(['MERCHANT_READ_ONLY','MERCHANT_FEATURE_DISABLED'].includes(allowance.code))throw fail(allowance.code,'Email sending is not available for this account',403);
    const context=await this.merchantSending.providerFor(owner);
    return{owner,provider:context.provider,sender:context.sender,fromName:context.fromName,own:[context.mailbox?.from_email,context.mailbox?.reply_to]};
  }

  // The sender's own mailbox; SIM may also use the test recipient list.
  allowedRecipients(scope,ctx){
    const list=new Set(ctx.own.map(normalizeEmail).filter(Boolean));
    if(isAdmin(scope))for(const email of parseAllowlist(this.env.TEST_RECIPIENT_ALLOWLIST))list.add(email);
    return[...list];
  }

  async usedToday(queryable,owner){
    return Number((await queryable.query(`SELECT count(*)::int count FROM leadgen.first_touch_test_sends
      WHERE merchant_id IS NOT DISTINCT FROM $1::uuid AND created_at>=date_trunc('day',now())`,[owner])).rows[0]?.count||0);
  }

  async variablesFor(companyId,scope,ctx){
    if(!companyId)return{variables:{...SAMPLE_VARIABLES,reply_to:ctx.provider.replyToEmail},source:'SAMPLE',templateKey:'C_OFFICIAL_GENERIC_MAILBOX',companyId:null};
    const id=uuidOf(companyId,'company_id');
    if(!await companyVisible(this.pool,scope,id))throw fail('COMPANY_NOT_FOUND','Company not found',404);
    const manual=(await this.pool.query(`SELECT c.id,c.company_name,e.company_type,m.country_name,s.normalized_category,
        (SELECT jsonb_build_object('email',lower(dc.contact_value_normalized),'contact_type',dc.contact_type,'is_generic',dc.is_generic,'person_name',dm.person_name)
          FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dc.company_id=c.id AND dc.evidence_origin='MANUAL_ENTRY' ORDER BY dc.created_at LIMIT 1) contact
      FROM leadgen.companies c JOIN leadgen.manual_company_entries e ON e.company_id=c.id
      JOIN leadgen.research_market_registry m ON m.market_code=e.market_code JOIN leadgen.dpv_product_category_scopes s ON s.id=e.category_scope_id
      WHERE c.id=$1`,[id])).rows[0];
    let variables;let templateKey;
    if(manual){
      variables=manualTemplateVariables({company:manual,contact:manual.contact,replyTo:ctx.provider.replyToEmail}).variables;
      templateKey=manualTemplateKey({contact:manual.contact||{},companyType:manual.company_type});
    }else{
      const facts=await loadPhase13EmailEligibilityFacts(this.pool,id,{replyToEmail:ctx.provider.replyToEmail,merchantId:ctx.owner});
      const verified=new Set(facts.verified_template_fields||[]);
      variables=Object.fromEntries(Object.entries(facts.template_variables||{}).filter(([key,value])=>verified.has(key)&&value));
      templateKey=selectFirstTouchTemplate({recipient:facts.recipient||{},company_types:facts.company_types||[]})||'C_OFFICIAL_GENERIC_MAILBOX';
    }
    return{variables:{...SAMPLE_VARIABLES,...variables,reply_to:ctx.provider.replyToEmail},own:variables,source:'COMPANY',templateKey,companyId:id};
  }

  async build(body={},scope){
    const ctx=await this.senderContext(scope);
    const resolved=await this.variablesFor(body.company_id||null,scope,ctx);
    const requested=String(body.template_key||'AUTO').trim().toUpperCase();
    const templateKey=requested==='AUTO'?resolved.templateKey:requested;
    if(!TEMPLATE_KEYS.includes(templateKey))throw fail('TEMPLATE_INVALID','Choose template A, B or C',422,{field:'template_key'});
    const fields=Object.keys(resolved.variables);
    // Values the chosen template uses that the company does not have come from the sample set.
    const needed=['category','target_category','matched_category','company','market',...(templateKey==='A_NAMED_BUYER'?['first_name']:[])];
    if(resolved.own&&needed.some(key=>!resolved.own[key]))resolved.source='COMPANY_WITH_SAMPLE';
    const draft=renderFirstTouchTemplate({template_key:templateKey,variables:resolved.variables,verified_fields:fields,sender:ctx.sender});
    const subject=`${TEST_SUBJECT_PREFIX}${draft.subject}`;
    const recipients=this.allowedRecipients(scope,ctx);
    return{ctx,recipients,preview:{template_key:templateKey,template_set_key:draft.template_set_key,subject,body_text:draft.body_text,
      content_hash:contentHash(`${subject}\n${draft.body_text}`),variables_source:resolved.source,company_id:resolved.companyId,
      sender_email:ctx.provider.senderEmail,allowed_recipients:recipients,daily_limit:this.dailyLimit()}};
  }

  async preview(body,scope){
    const {preview,ctx}=await this.build(body,scope);
    const used=await this.usedToday(this.pool,ctx.owner);
    return{...preview,used_today:used,remaining_today:Math.max(0,this.dailyLimit()-used)};
  }

  async status(scope){
    const ctx=await this.senderContext(scope);
    const used=await this.usedToday(this.pool,ctx.owner);
    const recent=(await this.pool.query(`SELECT t.id,t.recipient,t.template_key,t.subject,t.send_status,t.result_code,t.variables_source,t.created_at,t.requested_by,c.company_name
      FROM leadgen.first_touch_test_sends t LEFT JOIN leadgen.companies c ON c.id=t.company_id
      WHERE t.merchant_id IS NOT DISTINCT FROM $1::uuid ORDER BY t.created_at DESC LIMIT 20`,[ctx.owner])).rows;
    return{allowed_recipients:this.allowedRecipients(scope,ctx),sender_email:ctx.provider.senderEmail,daily_limit:this.dailyLimit(),used_today:used,
      remaining_today:Math.max(0,this.dailyLimit()-used),items:recent};
  }

  async send(body={},actor,scope){
    const {ctx,preview,recipients}=await this.build(body,scope);
    const recipient=normalizeEmail(body.recipient);
    if(!recipients.includes(recipient))throw fail('TEST_RECIPIENT_NOT_ALLOWED','Send the test only to your own mailbox or an address on the test list',422,{field:'recipient'});
    if(body.content_hash&&body.content_hash!==preview.content_hash)throw fail('PREVIEW_CHANGED','The email changed since the preview; check it again',409);
    const row=await transaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`first-touch-test:${ctx.owner||'sim'}`]);
      if(await this.usedToday(client,ctx.owner)>=this.dailyLimit())throw fail('TEST_SEND_DAILY_LIMIT',`At most ${this.dailyLimit()} test emails per day`,429);
      return(await client.query(`INSERT INTO leadgen.first_touch_test_sends(merchant_id,requested_by,recipient,sender_identity,company_id,template_set_key,template_key,variables_source,subject,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [ctx.owner,actor,recipient,ctx.provider.senderEmail,preview.company_id,preview.template_set_key,preview.template_key,preview.variables_source,preview.subject,preview.content_hash])).rows[0];
    });
    let result;
    try{result=await ctx.provider.send({from:`${ctx.fromName} <${ctx.provider.senderEmail}>`,to:recipient,reply_to:ctx.provider.replyToEmail,
      subject:preview.subject,body_text:preview.body_text,purpose:'TRANSACTIONAL'},`first-touch-test:${row.id}`);}
    catch{result={status:'AMBIGUOUS',code:'SMTP_SEND_AMBIGUOUS'};}
    const status=['PROVIDER_ACCEPTED','FAILED','BLOCKED'].includes(result?.status)?result.status:'AMBIGUOUS';
    const code=String(result?.code||status).toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,80);
    const saved=(await this.pool.query(`UPDATE leadgen.first_touch_test_sends SET send_status=$2,result_code=$3,provider_message_id=$4,completed_at=now()
      WHERE id=$1 RETURNING *`,[row.id,status,code,status==='PROVIDER_ACCEPTED'?String(result.provider_message_id||'').slice(0,500)||null:null])).rows[0];
    this.audit('first_touch_test_send',{id:row.id,merchant_id:ctx.owner,status});
    const used=await this.usedToday(this.pool,ctx.owner);
    return{test_send:saved,ok:status==='PROVIDER_ACCEPTED',code,remaining_today:Math.max(0,this.dailyLimit()-used)};
  }
}
