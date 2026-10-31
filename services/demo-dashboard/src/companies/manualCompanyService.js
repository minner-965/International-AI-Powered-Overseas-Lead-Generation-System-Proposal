// B1: companies and business contacts added by a person (trade fair, referral, existing lead).
// A manual company is stored with data_origin='manual' and a leadgen.manual_company_entries row;
// its contacts carry evidence_origin='MANUAL_ENTRY'. It never enters automatic first touch (the
// database refuses such a reservation, migration 070); first touch goes through a human-approved
// draft (src/outreach/manualFirstTouch.js). Follow-up work (calls, notes, stage) is recorded as
// normal CRM activities and queued for the Feishu table through leadgen.crm_sync_outbox.
import {randomUUID} from 'node:crypto';
import {activityOutboxPayload,leadOutboxPayload,opportunityOutboxPayload} from '../crm/outboxPayloads.js';
import {MANUAL_ACTIVITY_TYPES,PIPELINE_STAGES} from '../crm/repository.js';
import {companyScopeSql,companyVisible} from '../merchant/scope.js';
import {categoryNames,marketNames} from '../merchant/referenceNames.js';
import {COMPANY_TYPES,CONTACT_KINDS,cleanText,fail,isAdmin,ownerOf,parseAllowlist,parseWebsite,recipientProblem,
  requireEmail,sourceUrlOf,transaction,uuidOf} from './common.js';

export const CRM_SYNC_QUEUE='sync-outreach-to-crm';

function timestamp(value,label){
  if(value===undefined||value===null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw fail('DATE_INVALID',`${label} must be a valid date`,422,{field:label});
  return date.toISOString();
}

export class ManualCompanyService{
  constructor({pool,env=process.env,queue=null,audit=()=>{}}={}){Object.assign(this,{pool,env,queue,audit});}

  allowlist(){return parseAllowlist(this.env.TEST_RECIPIENT_ALLOWLIST);}

  async options(scope){
    const owner=ownerOf(scope);
    const [markets,categories,merchantScope,merchants]=await Promise.all([
      this.pool.query(`SELECT market_code,country_name FROM leadgen.research_market_registry WHERE status='ACTIVE' ORDER BY market_code`),
      this.pool.query(`SELECT id,normalized_category,product_profile FROM leadgen.dpv_product_category_scope_current
        WHERE scope_status='ACTIVE' AND approval_status='APPROVED' ORDER BY product_profile,normalized_category,id`),
      owner?this.pool.query('SELECT category_scope_ids FROM leadgen.merchant_scope WHERE merchant_id=$1',[owner]):{rows:[]},
      isAdmin(scope)?this.pool.query(`SELECT id,company_name FROM leadgen.merchants_current WHERE effective_status<>'DISABLED' ORDER BY company_name`):{rows:[]}]);
    const allowed=new Set((merchantScope.rows[0]?.category_scope_ids||[]).map(String));
    return{
      is_admin:isAdmin(scope),
      markets:markets.rows.map(row=>({code:row.market_code,...marketNames(row.market_code,row.country_name)})),
      categories:categories.rows.filter(row=>!allowed.size||allowed.has(String(row.id))).map(row=>({id:row.id,code:row.normalized_category,product_profile:row.product_profile,...categoryNames(row.normalized_category)})),
      company_types:Object.keys(COMPANY_TYPES),contact_kinds:Object.keys(CONTACT_KINDS),
      merchants:merchants.rows.map(row=>({id:row.id,company_name:row.company_name})),
      test_recipients:isAdmin(scope)?[...this.allowlist()]:[]
    };
  }

  async requireManualCompany(client,companyId,scope,{lock=false}={}){
    const id=uuidOf(companyId,'company_id');
    if(!await companyVisible(client,scope,id))throw fail('COMPANY_NOT_FOUND','Company not found',404);
    const row=(await client.query(`SELECT c.id,c.company_name,c.normalized_domain,c.official_root_domain,c.website_url,c.country_code,c.lifecycle_status,
        e.market_code,e.company_type,e.category_scope_id,e.notes,e.created_by,e.created_at,e.created_by_merchant_id,
        m.country_name,m.timezone,s.normalized_category,s.product_profile,
        coalesce((SELECT f.is_test FROM leadgen.company_test_flags f WHERE f.company_id=c.id ORDER BY f.set_at DESC,f.id DESC LIMIT 1),false) is_test
      FROM leadgen.companies c JOIN leadgen.manual_company_entries e ON e.company_id=c.id
      JOIN leadgen.research_market_registry m ON m.market_code=e.market_code
      JOIN leadgen.dpv_product_category_scopes s ON s.id=e.category_scope_id
      WHERE c.id=$1 ${lock?'FOR UPDATE OF c':''}`,[id])).rows[0];
    if(!row)throw fail('MANUAL_COMPANY_NOT_FOUND','This company was not added manually',404);
    return row;
  }

  async assertCategory(client,categoryScopeId,owner){
    const category=(await client.query(`SELECT id,normalized_category,product_profile FROM leadgen.dpv_product_category_scope_current
      WHERE id=$1 AND scope_status='ACTIVE' AND approval_status='APPROVED'`,[categoryScopeId])).rows[0];
    if(!category)throw fail('CATEGORY_NOT_APPROVED','Choose an approved product category',422,{field:'category_scope_id'});
    if(owner){
      const ids=(await client.query('SELECT category_scope_ids FROM leadgen.merchant_scope WHERE merchant_id=$1',[owner])).rows[0]?.category_scope_ids||[];
      if(ids.length&&!ids.map(String).includes(String(categoryScopeId)))throw fail('CATEGORY_OUTSIDE_MERCHANT_SCOPE','Choose one of your business categories',422,{field:'category_scope_id'});
    }
    return category;
  }

  /**
   * body: {company_name, website, market_code, company_type, category_scope_id, notes?,
   *        is_test? (admin), merchant_id? (admin: assign on creation), contact?: {...addContact body}}
   * A merchant may add companies to its own account (assigned to it, source MANUAL); test flags
   * and assignment to another merchant are SIM-only.
   */
  async create(body={},actor,scope){
    const admin=isAdmin(scope);
    const creator=admin?null:ownerOf(scope);
    const name=cleanText(body.company_name,'company_name',{required:true,max:200});
    const site=parseWebsite(body.website??body.domain);
    const market=String(body.market_code||'').trim().toUpperCase();
    const type=String(body.company_type||'').trim().toUpperCase();
    if(!COMPANY_TYPES[type])throw fail('COMPANY_TYPE_INVALID','Choose the company type',422,{field:'company_type'});
    const notes=cleanText(body.notes,'notes',{max:2000});
    const categoryId=uuidOf(body.category_scope_id,'category_scope_id');
    const isTest=body.is_test===true;
    if(isTest&&!admin)throw fail('ADMIN_REQUIRED','Only the SIM administrator can mark a test company',403);
    const assignTo=admin?(body.merchant_id?uuidOf(body.merchant_id,'merchant_id'):(scope?.restrict?scope.merchantId:null)):creator;
    if(body.merchant_id&&!admin)throw fail('ADMIN_REQUIRED','Only the SIM administrator can assign companies',403);
    const result=await transaction(this.pool,async client=>{
      const registry=(await client.query(`SELECT market_code,country_name FROM leadgen.research_market_registry WHERE market_code=$1 AND status='ACTIVE'`,[market])).rows[0];
      if(!registry)throw fail('MARKET_NOT_ACTIVE','Choose an active market',422,{field:'market_code'});
      await this.assertCategory(client,categoryId,assignTo);
      if(assignTo&&!(await client.query(`SELECT 1 FROM leadgen.merchants_current WHERE id=$1 AND effective_status<>'DISABLED'`,[assignTo])).rowCount)
        throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`manual-company:domain:${site.hostname}`]);
      const existing=(await client.query(`SELECT id FROM leadgen.companies WHERE lower(normalized_domain)=ANY($1::text[])`,[[site.hostname,`www.${site.hostname}`]])).rows[0];
      // Never reveal another owner's company to a merchant; SIM sees which record it is.
      if(existing)throw fail('COMPANY_ALREADY_LISTED','This company is already in the company directory',409,admin?{company_id:existing.id}:undefined);
      const company=(await client.query(`INSERT INTO leadgen.companies(company_name,normalized_domain,official_root_domain,country_code,country_name,website_url,company_type,data_origin)
        VALUES($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING id`,[name,site.hostname,site.domain,market,registry.country_name,site.website_url,COMPANY_TYPES[type]])).rows[0];
      await client.query(`INSERT INTO leadgen.manual_company_entries(company_id,created_by_merchant_id,category_scope_id,market_code,company_type,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[company.id,creator,categoryId,market,type,notes,actor]);
      if(isTest)await client.query(`INSERT INTO leadgen.company_test_flags(company_id,is_test,reason,set_by) VALUES($1,true,'Marked when added',$2)`,[company.id,actor]);
      if(assignTo)await client.query(`INSERT INTO leadgen.merchant_companies(merchant_id,company_id,source,assigned_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [assignTo,company.id,creator?'MANUAL':'ADMIN',actor]);
      const outbox=(await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
        VALUES($1,'CREATE_LEAD',$2::jsonb,$3,'PENDING',now(),$4) RETURNING id,sync_status`,
        [company.id,JSON.stringify(leadOutboxPayload({company_name:name,country_code:market,website_url:site.website_url,owner:actor,references:{manual_company:company.id}})),
          `manual-company:${company.id}:lead`,assignTo])).rows[0];
      let contact=null;
      if(body.contact&&(body.contact.email||body.contact.address))
        contact=await this.insertContact(client,{id:company.id,normalized_domain:site.hostname,market_code:market,is_test:isTest},body.contact,actor);
      return{company_id:company.id,contact,outbox};
    });
    await this.dispatch([result.outbox]);
    this.audit('manual_company_created',{company_id:result.company_id,merchant_id:assignTo,test:isTest});
    return{...await this.get(result.company_id,admin?{admin:true,merchantId:null,restrict:false}:scope),contact:result.contact};
  }

  async insertContact(client,company,input={},actor){
    const email=requireEmail(input.email??input.address,'email');
    const kind=String(input.contact_kind||input.kind||'GENERAL').trim().toUpperCase();
    if(!CONTACT_KINDS[kind])throw fail('CONTACT_KIND_INVALID','Choose the mailbox type',422,{field:'contact_kind'});
    const person=cleanText(input.person_name,'person_name',{max:160});
    const department=cleanText(input.department_name,'department_name',{max:160});
    const title=cleanText(input.job_title,'job_title',{max:160});
    if(kind==='PERSON'&&!person)throw fail('FIELD_REQUIRED','Enter the person\'s name',422,{field:'person_name'});
    const sourceUrl=sourceUrlOf(input.source_url);
    const problem=recipientProblem({email,companyDomain:company.normalized_domain,sourceUrl,isTest:company.is_test,allowlist:this.allowlist()});
    if(problem==='TEST_RECIPIENT_NOT_ALLOWED')throw fail(problem,'A test company can only use an address on the test recipient list',422,{field:'email'});
    if(problem)throw fail(problem,'Use a mailbox on the company domain, or add the page where the company publishes it',422,{field:'source_url'});
    const duplicate=(await client.query(`SELECT 1 FROM leadgen.decision_maker_contacts WHERE company_id=$1 AND lower(contact_value_normalized)=$2
      AND contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')`,[company.id,email])).rowCount;
    if(duplicate)throw fail('CONTACT_ALREADY_LISTED','This address is already listed for the company',409,{field:'email'});
    // One decision-maker row per person / mailbox group (unique canonical key); reuse it if present.
    const makerArgs=[company.id,kind==='PERSON'?person:null,kind==='PERSON'?department:(department||(kind==='GENERAL'?'Company mailbox':'Department mailbox')),title||'',company.market_code];
    const maker=(await client.query(`SELECT id FROM leadgen.decision_makers WHERE company_id=$1 AND coalesce(person_name_normalized,'')=coalesce(lower($2),'')
        AND coalesce(department_name_normalized,'')=coalesce(lower($3),'') AND normalized_role='UNKNOWN' AND raw_title=$4 LIMIT 1`,makerArgs.slice(0,4))).rows[0]
      ||(await client.query(`INSERT INTO leadgen.decision_makers(company_id,person_name,person_name_normalized,department_name,department_name_normalized,raw_title,normalized_role,market_code,verification_status,evidence_strength)
      VALUES($1,$2,lower($2),$3,lower($3),$4,'UNKNOWN',$5,'REVIEW','NONE') RETURNING id`,makerArgs)).rows[0];
    return(await client.query(`INSERT INTO leadgen.decision_maker_contacts(decision_maker_id,company_id,contact_type,contact_value_raw,contact_value_normalized,
        evidence_origin,verification_status,source_url,is_generic,is_department)
      VALUES($1,$2,$3,$4,$4,'MANUAL_ENTRY','NOT_VERIFIED',$5,$6,$7)
      RETURNING id,contact_type,contact_value_normalized email,source_url,is_generic,is_department,created_at`,
      [maker.id,company.id,CONTACT_KINDS[kind],email,sourceUrl||'',kind==='GENERAL',kind==='DEPARTMENT'])).rows[0];
  }

  async addContact(companyId,body,actor,scope){
    const contact=await transaction(this.pool,async client=>{
      const company=await this.requireManualCompany(client,companyId,scope,{lock:true});
      return this.insertContact(client,company,body,actor);
    });
    return{contact};
  }

  async setTestFlag(companyId,body={},actor,scope){
    if(!isAdmin(scope))throw fail('ADMIN_REQUIRED','Only the SIM administrator can mark a test company',403);
    if(typeof body.is_test!=='boolean')throw fail('FIELD_REQUIRED','is_test must be true or false',422,{field:'is_test'});
    const reason=cleanText(body.reason,'reason',{max:500});
    return transaction(this.pool,async client=>{
      const company=await this.requireManualCompany(client,companyId,scope,{lock:true});
      if(company.is_test===body.is_test)return{company_id:company.id,is_test:company.is_test,changed:false};
      await client.query('INSERT INTO leadgen.company_test_flags(company_id,is_test,reason,set_by) VALUES($1,$2,$3,$4)',[company.id,body.is_test,reason,actor]);
      return{company_id:company.id,is_test:body.is_test,changed:true};
    });
  }

  async assign(companyId,body={},actor,scope){
    if(!isAdmin(scope))throw fail('ADMIN_REQUIRED','Only the SIM administrator can assign companies',403);
    const merchantId=uuidOf(body.merchant_id,'merchant_id');
    return transaction(this.pool,async client=>{
      const company=await this.requireManualCompany(client,companyId,null,{lock:true});
      if(!(await client.query(`SELECT 1 FROM leadgen.merchants_current WHERE id=$1 AND effective_status<>'DISABLED'`,[merchantId])).rowCount)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
      // SIM's own first touch for the company blocks handing it over (one buyer, one sender).
      if((await client.query(`SELECT 1 FROM leadgen.phase13_first_touch_reservations WHERE company_id=$1 AND merchant_id IS NULL`,[company.id])).rowCount)
        throw fail('COMPANY_ALREADY_CONTACTED_BY_SIM','SIM has already contacted this company',409);
      const inserted=await client.query(`INSERT INTO leadgen.merchant_companies(merchant_id,company_id,source,assigned_by) VALUES($1,$2,'ADMIN',$3) ON CONFLICT DO NOTHING`,[merchantId,company.id,actor]);
      return{company_id:company.id,merchant_id:merchantId,assigned:inserted.rowCount>0};
    });
  }

  async addActivity(companyId,body={},actor,scope){
    const type=String(body.activity_type||'').trim().toUpperCase();
    if(!MANUAL_ACTIVITY_TYPES.includes(type))throw fail('ACTIVITY_TYPE_INVALID','Choose the activity type',422,{field:'activity_type'});
    const summary=cleanText(body.summary,'summary',{required:true,max:2000});
    const result=cleanText(body.result,'result',{max:200});
    const occurredAt=timestamp(body.occurred_at,'occurred_at')||new Date().toISOString();
    if(new Date(occurredAt).getTime()>Date.now()+5*60_000)throw fail('DATE_INVALID','An activity cannot be recorded in the future',422,{field:'occurred_at'});
    const nextFollowUp=timestamp(body.next_follow_up_at,'next_follow_up_at');
    const owner=ownerOf(scope);
    const written=await transaction(this.pool,async client=>{
      const company=await this.requireManualCompany(client,companyId,scope);
      const activity=(await client.query(`INSERT INTO leadgen.opportunity_activities
          (company_id,opportunity_snapshot_id,activity_type,owner_identity,due_at,details,idempotency_key,occurred_at,recorded_by,merchant_id)
        VALUES($1,NULL,$2,$3,$4,$5::jsonb,$6,$7,$3,$8) RETURNING *`,
        [company.id,type,actor,nextFollowUp,JSON.stringify({summary,result,channel:type,source:'MANUAL_COMPANY'}),`manual-company:activity:${randomUUID()}`,occurredAt,owner])).rows[0];
      const outbox=(await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
        VALUES($1,'UPDATE_ACTIVITY',$2::jsonb,$3,'PENDING',now(),$4) RETURNING id,sync_status`,
        [company.id,JSON.stringify(activityOutboxPayload({activity_type:type,occurred_at:occurredAt,summary,owner:actor,references:{activity:activity.id}})),`crm:activity:${activity.id}`,owner])).rows[0];
      return{activity,outbox};
    });
    await this.dispatch([written.outbox]);
    return{activity:written.activity,crm_outbox_id:written.outbox.id};
  }

  async currentStage(client,companyId,owner){
    return(await client.query(`SELECT stage FROM leadgen.manual_company_stage_events WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid
      ORDER BY changed_at DESC,id DESC LIMIT 1`,[companyId,owner])).rows[0]?.stage||'NEW';
  }

  // Appends a stage event and its Feishu row; used by the stage endpoint and after a first touch.
  async appendStage(client,{companyId,owner,stage,lostReason=null,note=null,actor}){
    const event=(await client.query(`INSERT INTO leadgen.manual_company_stage_events(company_id,merchant_id,stage,lost_reason,note,changed_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[companyId,owner,stage,stage==='LOST'?lostReason:null,note,actor])).rows[0];
    const outbox=(await client.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,next_attempt_at,merchant_id)
      VALUES($1,'UPDATE_OPPORTUNITY',$2::jsonb,$3,'PENDING',now(),$4) RETURNING id,sync_status`,
      [companyId,JSON.stringify(opportunityOutboxPayload({stage,status:stage==='LOST'?'LOST':stage==='WON'?'WON':'OPEN',owner:actor})),`manual-company:stage:${event.id}`,owner])).rows[0];
    return{event,outbox};
  }

  async setStage(companyId,body={},actor,scope){
    const stage=String(body.stage||'').trim().toUpperCase();
    if(!PIPELINE_STAGES.includes(stage))throw fail('STAGE_INVALID','Choose the pipeline stage',422,{field:'stage'});
    const lostReason=cleanText(body.lost_reason,'lost_reason',{max:500});
    if(stage==='LOST'&&!lostReason)throw fail('LOST_REASON_REQUIRED','A reason is required when an opportunity is lost',422,{field:'lost_reason'});
    const note=cleanText(body.note,'note',{max:1000});
    const owner=ownerOf(scope);
    const written=await transaction(this.pool,async client=>{
      const company=await this.requireManualCompany(client,companyId,scope,{lock:true});
      if(await this.currentStage(client,company.id,owner)===stage)throw fail('STAGE_UNCHANGED','The opportunity is already at this stage',409);
      return this.appendStage(client,{companyId:company.id,owner,stage,lostReason,note,actor});
    });
    await this.dispatch([written.outbox]);
    return{stage:written.event.stage,event:written.event,crm_outbox_id:written.outbox.id};
  }

  // Rows are durable in the outbox; the queue only speeds delivery up (the CRM dispatcher retries).
  async dispatch(outboxes){
    if(!this.queue?.enqueue)return;
    for(const row of outboxes.filter(item=>item&&item.sync_status==='PENDING')){
      try{await this.queue.enqueue(CRM_SYNC_QUEUE,{outbox_id:row.id},{singletonKey:`crm:dispatch:${row.id}:0`});}
      catch(error){this.audit('manual_company_crm_enqueue_pending',{outbox_id:row.id,error:String(error?.message||error).slice(0,200)});}
    }
  }

  listSql(scope,params,where='TRUE'){
    const visible=companyScopeSql(scope,'c',params);
    params.push(ownerOf(scope));const owner=`$${params.length}::uuid`;
    return`SELECT c.id,c.company_name,c.website_url,c.normalized_domain,c.country_code,c.lifecycle_status,
        e.market_code,m.country_name,e.company_type,e.notes,e.category_scope_id,s.normalized_category,s.product_profile,e.created_by,e.created_at,
        coalesce((SELECT f.is_test FROM leadgen.company_test_flags f WHERE f.company_id=c.id ORDER BY f.set_at DESC,f.id DESC LIMIT 1),false) is_test,
        coalesce((SELECT st.stage FROM leadgen.manual_company_stage_events st WHERE st.company_id=c.id AND st.merchant_id IS NOT DISTINCT FROM ${owner}
          ORDER BY st.changed_at DESC,st.id DESC LIMIT 1),'NEW') stage,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('merchant_id',mc.merchant_id,'company_name',mm.company_name) ORDER BY mm.company_name),'[]'::jsonb)
          FROM leadgen.merchant_companies mc JOIN leadgen.merchants mm ON mm.id=mc.merchant_id WHERE mc.company_id=c.id) merchants,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('id',dc.id,'email',dc.contact_value_normalized,'contact_type',dc.contact_type,'source_url',nullif(dc.source_url,''),
            'person_name',dm.person_name,'department_name',dm.department_name,'job_title',nullif(dm.raw_title,'')) ORDER BY dc.created_at),'[]'::jsonb)
          FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dc.company_id=c.id AND dc.evidence_origin='MANUAL_ENTRY') contacts,
        (SELECT to_jsonb(d) FROM (SELECT id,draft_status,template_key,normalized_recipient,subject,body_text,reason_codes,created_by,created_at,decided_by,decided_at,outbound_message_id
          FROM leadgen.manual_first_touch_drafts WHERE company_id=c.id AND merchant_id IS NOT DISTINCT FROM ${owner} ORDER BY created_at DESC LIMIT 1) d) latest_draft,
        (SELECT max(coalesce(a.occurred_at,a.created_at)) FROM leadgen.opportunity_activities a WHERE a.company_id=c.id AND a.merchant_id IS NOT DISTINCT FROM ${owner}) last_activity_at
      FROM leadgen.companies c JOIN leadgen.manual_company_entries e ON e.company_id=c.id
      JOIN leadgen.research_market_registry m ON m.market_code=e.market_code
      JOIN leadgen.dpv_product_category_scopes s ON s.id=e.category_scope_id
      WHERE ${visible} AND ${where}`;
  }

  view(row,scope){
    const names=categoryNames(row.normalized_category);
    return{...row,category:{id:row.category_scope_id,code:row.normalized_category,product_profile:row.product_profile,name_en:names.name_en,name_zh:names.name_zh},
      market:{code:row.market_code,...marketNames(row.market_code,row.country_name)},merchants:isAdmin(scope)?row.merchants:undefined};
  }

  async list(query={},scope){
    const params=[];const where=[];
    const q=cleanText(query.q,'q',{max:200});
    if(q){params.push(`%${q}%`);where.push(`(c.company_name ILIKE $${params.length} OR c.normalized_domain ILIKE $${params.length})`);}
    const stage=String(query.stage||'').trim().toUpperCase();
    const sql=this.listSql(scope,params,where.length?where.join(' AND '):'TRUE');
    params.push(Math.min(Math.max(Number.parseInt(query.limit,10)||200,1),500));
    const rows=(await this.pool.query(`SELECT * FROM (${sql}) x ${PIPELINE_STAGES.includes(stage)?`WHERE x.stage='${stage}'`:''} ORDER BY x.created_at DESC LIMIT $${params.length}`,params)).rows;
    return{items:rows.map(row=>this.view(row,scope))};
  }

  async get(companyId,scope){
    const id=uuidOf(companyId,'company_id');
    if(!await companyVisible(this.pool,scope,id))throw fail('COMPANY_NOT_FOUND','Company not found',404);
    const params=[id];
    const row=(await this.pool.query(this.listSql(scope,params,'c.id=$1'),params)).rows[0];
    if(!row)throw fail('MANUAL_COMPANY_NOT_FOUND','This company was not added manually',404);
    const stages=(await this.pool.query(`SELECT stage,lost_reason,note,changed_by,changed_at FROM leadgen.manual_company_stage_events
      WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid ORDER BY changed_at DESC,id DESC LIMIT 50`,[id,ownerOf(scope)])).rows;
    return{company:this.view(row,scope),stage_history:stages};
  }
}
