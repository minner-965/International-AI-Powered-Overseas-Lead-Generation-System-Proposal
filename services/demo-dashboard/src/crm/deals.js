// Deal value, customer grade, health, key customers, reminder rules and sales reports (migration 079).
// Everything is per owner: SIM (merchant_id NULL) or one merchant, the same owner rule as the CRM
// pipeline state. Pipeline items come from CrmRepository.listPipeline, which already merges assessed
// opportunities and manually added companies.
import {PIPELINE_STAGES} from './repository.js';
import {companyVisible} from '../merchant/scope.js';
export {stageChangeNeedsReason} from './stageRules.js';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const DAY=86_400_000;
const ACTIVE_STAGES=Object.freeze(['CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING']);
const FUNNEL_STAGES=Object.freeze(['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON']);
export const CUSTOMER_GRADES=Object.freeze(['A','B','C','D']);
export const TASK_PRIORITIES=Object.freeze(['LOW','NORMAL','HIGH']);
// Default chance of winning by stage, used until a person sets one.
export const STAGE_WIN_PROBABILITY=Object.freeze({NEW:5,CONTACTED:10,REPLIED:20,QUOTED:40,SAMPLE:60,NEGOTIATING:75,WON:100,LOST:0});
/** Reminder tasks created per owner in one hourly run; the rest wait for the next run. */
export const MAX_REMINDERS_PER_RUN=100;
export const DEFAULT_REMINDER_RULES=Object.freeze({enabled:true,no_follow_up_days:7,quoted_no_reply_days:3,sample_no_confirm_days:7});

const days=(from,now)=>from?Math.floor((now.getTime()-new Date(from).getTime())/DAY):null;
const latest=(...values)=>values.filter(Boolean).map(value=>new Date(value)).sort((a,b)=>b-a)[0]||null;

/**
 * Health 0-100 from four parts (separate from the grade a person gives):
 * profile complete 25 · followed up on time 35 · deal moving 25 · customer has answered 15.
 */
export function customerHealth(item,now=new Date()){
  const profile=(item.website_url?8:0)+(item.country_code?5:0)+(item.has_email?12:0);
  const since=days(item.last_touch_at,now);
  let timely=since===null?0:since<=7?35:since<=14?20:since<=30?10:0;
  if(item.overdue)timely=Math.max(0,timely-10);
  const moving=({NEW:5,CONTACTED:10,REPLIED:15,QUOTED:20,SAMPLE:20,NEGOTIATING:25,WON:25,LOST:0})[item.pipeline_stage]??0;
  const answered=item.last_inbound_at?15:item.activity_count>0?8:0;
  const score=profile+timely+moving+answered;
  return{score,level:score>=70?'GOOD':score>=40?'FAIR':'POOR',parts:{profile,timely,moving,answered},days_since_touch:since};
}

/**
 * Suggested win probability (1-99; WON 100, LOST 0) from five weighted parts, each scored 0-100:
 * stage default 35% · this customer's past win rate 20% (50 without history) · follow-ups in the last
 * 7 days 20% (20 each, max 100) · amount against the average won deal in the same currency 10%
 * (80 within 0.5-2x, 60 within 0.3-3x, else 30; 50 without data) · days in the current stage 15%
 * (100 minus 5 a day, at least 10). Advice codes say what pulls it down.
 */
export const WIN_ESTIMATE_WEIGHTS=Object.freeze({stage:0.35,history:0.2,follow_ups:0.2,amount:0.1,dwell:0.15});
export function estimateWinProbability(item,history={},now=new Date()){
  const stage=item.pipeline_stage||'NEW';
  if(stage==='WON'||stage==='LOST'){const score=stage==='WON'?100:0;return{score,parts:[],advice:[]};}
  const past=history.companies?.get?.(item.company_id)||history.companies?.[item.company_id]||null;
  const closed=past?(past.won||0)+(past.lost||0):0;
  const historyPoints=closed?Math.round((past.won||0)/closed*100):50;
  const recent=Number(item.recent_activity_7d||0);
  const followPoints=Math.min(100,recent*20);
  const average=item.deal_currency?(history.averageWon?.get?.(item.deal_currency)??history.averageWon?.[item.deal_currency]??null):null;
  let amountPoints=50;
  if(item.deal_amount!==null&&item.deal_amount!==undefined&&average){
    const ratio=item.deal_amount/average;
    amountPoints=ratio>=0.5&&ratio<=2?80:ratio>=0.3&&ratio<=3?60:30;
  }
  const inStage=Math.max(0,days(item.stage_changed_at,now)??0);
  const dwellPoints=Math.max(10,100-5*inStage);
  const points={stage:STAGE_WIN_PROBABILITY[stage]??0,history:historyPoints,follow_ups:followPoints,amount:amountPoints,dwell:dwellPoints};
  const parts=Object.entries(WIN_ESTIMATE_WEIGHTS).map(([key,weight])=>({key,points:points[key],weight}));
  const raw=parts.reduce((total,part)=>total+part.points*part.weight,0);
  const advice=[];
  if(inStage>=14)advice.push('STALLED_IN_STAGE');
  if(!recent)advice.push('NO_RECENT_FOLLOW_UP');
  if(closed&&historyPoints<30)advice.push('LOW_PAST_WIN_RATE');
  if(amountPoints===30)advice.push('AMOUNT_UNUSUAL');
  return{score:Math.min(99,Math.max(1,Math.round(raw))),parts,advice};
}

/**
 * Reminder plan for one owner, without writing anything. Each reminder counts from an event:
 * a quote or samples from the stage change, "gone quiet" from the last contact, a missed next contact
 * from its planned date. Per rule and company: never while one is open, never twice for the same event,
 * not within the rule's days after a person closed one, and at most `limit` new ones per run.
 */
export function planReminders(items,rules,existing=[],now=new Date(),{limit=MAX_REMINDERS_PER_RUN}={}){
  const toTime=value=>value?new Date(value).getTime():null;
  const tasks=new Map();
  for(const task of existing){const key=`${task.company_id}|${task.source_rule}`;if(!tasks.has(key))tasks.set(key,[]);tasks.get(key).push(task);}
  const windowDays=rule=>({NO_FOLLOW_UP:rules.no_follow_up_days,QUOTED_NO_REPLY:rules.quoted_no_reply_days,SAMPLE_NO_CONFIRM:rules.sample_no_confirm_days,NEXT_ACTION_DUE:1})[rule];
  const create=[],skipped=[];
  for(const item of items){
    const candidates=keyCustomerFlags(item,rules,now).filter(flag=>flag!=='HIGH_INTENT')
      .map(rule=>({rule,event_at:rule==='NO_FOLLOW_UP'?item.last_touch_at:item.stage_changed_at}));
    if(ACTIVE_STAGES.includes(item.pipeline_stage)&&item.next_action_due_at&&toTime(item.next_action_due_at)<now.getTime())
      candidates.push({rule:'NEXT_ACTION_DUE',event_at:item.next_action_due_at});
    for(const {rule,event_at} of candidates){
      const prior=tasks.get(`${item.company_id}|${rule}`)||[];
      const eventTime=toTime(event_at);
      let reason=null;
      if(prior.some(task=>['OPEN','IN_PROGRESS'].includes(task.task_status)))reason='open';
      else if(eventTime!==null&&prior.some(task=>toTime(task.source_event_at)===eventTime))reason='same_event';
      else if(prior.some(task=>task.closed_at&&toTime(task.closed_at)>now.getTime()-windowDays(rule)*DAY))reason='recently_closed';
      else if(create.length>=limit)reason='over_limit';
      const entry={company_id:item.company_id,company_name:item.company_name,rule,event_at:event_at?new Date(event_at).toISOString():null,item};
      if(reason)skipped.push({...entry,reason});else create.push(entry);
    }
  }
  return{create,skipped};
}

/** Per-rule summary of a plan for the preview: matched, creatable, skipped by reason, up to 3 examples. */
export function summarizeReminderPlan(plan){
  const out={};
  for(const rule of REMINDER_RULES){
    const made=plan.create.filter(row=>row.rule===rule),left=plan.skipped.filter(row=>row.rule===rule);
    const count=reason=>left.filter(row=>row.reason===reason).length;
    out[rule]={matched:made.length+left.length,creatable:made.length,
      skipped:{open:count('open'),same_event:count('same_event'),recently_closed:count('recently_closed'),over_limit:count('over_limit')},
      examples:made.slice(0,3).map(row=>row.company_name)};
  }
  return out;
}

/** Grade suggested from health when a person has not graded the customer: 85+ A, 70+ B, 55+ C, else D. */
export function suggestedGrade(health){
  if(!health)return null;
  return health.score>=85?'A':health.score>=70?'B':health.score>=55?'C':'D';
}

/** Why an active deal needs attention now (for the report's risk list). */
export function dealRisks(item,rules=DEFAULT_REMINDER_RULES,now=new Date()){
  if(!ACTIVE_STAGES.includes(item.pipeline_stage))return[];
  const risks=[];
  if(item.overdue)risks.push('OVERDUE_TASK');
  if(customerHealth(item,now).level==='POOR')risks.push('LOW_HEALTH');
  if(item.expected_close_date&&new Date(item.expected_close_date).toISOString().slice(0,10)<now.toISOString().slice(0,10))risks.push('CLOSE_DATE_PASSED');
  for(const flag of keyCustomerFlags(item,rules,now))if(flag!=='HIGH_INTENT')risks.push(flag);
  return risks;
}

/** Key-customer flags: very interested, too long without follow-up, quote or samples unanswered. */
export function keyCustomerFlags(item,rules=DEFAULT_REMINDER_RULES,now=new Date()){
  const flags=[];
  const stage=item.pipeline_stage;
  if(['REPLIED','QUOTED','SAMPLE','NEGOTIATING'].includes(stage)||item.customer_grade==='A')flags.push('HIGH_INTENT');
  const since=days(item.last_touch_at,now);
  if(ACTIVE_STAGES.includes(stage)&&since!==null&&since>rules.no_follow_up_days)flags.push('NO_FOLLOW_UP');
  const answeredAfterStage=item.last_inbound_at&&item.stage_changed_at&&new Date(item.last_inbound_at)>new Date(item.stage_changed_at);
  const inStage=days(item.stage_changed_at,now);
  if(stage==='QUOTED'&&!answeredAfterStage&&inStage!==null&&inStage>=rules.quoted_no_reply_days)flags.push('QUOTED_NO_REPLY');
  if(stage==='SAMPLE'&&!answeredAfterStage&&inStage!==null&&inStage>=rules.sample_no_confirm_days)flags.push('SAMPLE_NO_CONFIRM');
  return flags;
}

function money(value,label){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0||amount>=1e12)throw fail('CRM_VALUE_INVALID',`${label} must be a positive number`);
  return Math.round(amount*100)/100;
}
function currency(value){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const code=String(value).trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(code))throw fail('CRM_VALUE_INVALID','Currency must be a 3-letter code such as USD');
  return code;
}
function dateOnly(value){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const text=String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text)))throw fail('CRM_DATE_INVALID','Expected close date must be a date');
  return text;
}
function percent(value){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<0||n>100)throw fail('CRM_VALUE_INVALID','Win probability must be a whole number from 0 to 100');
  return n;
}
function grade(value){
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const g=String(value).trim().toUpperCase();
  if(!CUSTOMER_GRADES.includes(g))throw fail('CRM_VALUE_INVALID','Grade must be A, B, C or D');
  return g;
}
function dayCount(value,label){
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>90)throw fail('CRM_VALUE_INVALID',`${label} must be a whole number of days from 1 to 90`);
  return n;
}

export class DealService{
  constructor({pool,repository,now=()=>new Date()}){Object.assign(this,{pool,repository,now});}
  owner(scope){return scope?.merchantId??null;}

  async profile(companyId,scope=null,queryable=this.pool){
    return(await queryable.query(`SELECT * FROM leadgen.crm_deal_profiles WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid`,
      [companyId,this.owner(scope)])).rows[0]||null;
  }

  /** The deal card for one company: saved values, the stage default probability, health and flags. */
  async dealView(companyId,scope=null){
    if(!await companyVisible(this.pool,scope,companyId))throw fail('CRM_COMPANY_NOT_FOUND','Company not found',404);
    const [saved,items,rules]=await Promise.all([this.profile(companyId,scope),this.items(scope,[companyId],{allStages:true}),this.rules(scope)]);
    const item=items[0]||null;
    const stage=item?.pipeline_stage||'NEW';
    return{company_id:companyId,pipeline_stage:stage,
      deal_amount:saved?.deal_amount===null||saved?.deal_amount===undefined?null:Number(saved.deal_amount),deal_currency:saved?.deal_currency||null,
      expected_close_date:saved?.expected_close_date?new Date(saved.expected_close_date).toISOString().slice(0,10):null,
      win_probability:saved?.win_probability??null,default_win_probability:STAGE_WIN_PROBABILITY[stage],
      estimated_win_probability:item?.estimate?.score??STAGE_WIN_PROBABILITY[stage],estimate:item?.estimate||null,
      effective_win_probability:saved?.win_probability??item?.estimate?.score??STAGE_WIN_PROBABILITY[stage],
      won_confirmation:saved?.won_confirmation||null,won_confirmation_note:saved?.won_confirmation_note||null,won_confirmed_at:saved?.won_confirmed_at||null,
      customer_grade:saved?.customer_grade||null,suggested_grade:saved?.customer_grade?null:suggestedGrade(item?customerHealth(item,this.now()):null),version:saved?.version||0,updated_by:saved?.updated_by||null,updated_at:saved?.updated_at||null,
      health:item?customerHealth(item,this.now()):null,flags:item?keyCustomerFlags(item,rules,this.now()):[]};
  }

  async saveDeal(companyId,body={},actor,scope=null){
    if(!await companyVisible(this.pool,scope,companyId))throw fail('CRM_COMPANY_NOT_FOUND','Company not found',404);
    const input={deal_amount:money(body.deal_amount,'Amount'),deal_currency:currency(body.deal_currency),expected_close_date:dateOnly(body.expected_close_date),
      win_probability:percent(body.win_probability),customer_grade:grade(body.customer_grade)};
    const changes=Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined));
    if(!Object.keys(changes).length)throw fail('CRM_NO_CHANGE','Nothing to update');
    const owner=this.owner(scope);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`SELECT * FROM leadgen.crm_deal_profiles WHERE company_id=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`,[companyId,owner])).rows[0];
      if(body.expected_version!==undefined&&body.expected_version!==null&&Number(body.expected_version)!==Number(current?.version||0))
        throw fail('CRM_VERSION_CONFLICT','The deal was changed by someone else',409);
      const next={...Object.fromEntries(Object.keys(input).map(key=>[key,current?.[key]??null])),...changes};
      if(next.deal_amount!==null&&next.deal_amount!==undefined&&!next.deal_currency)throw fail('CRM_CURRENCY_REQUIRED','Choose a currency for the amount');
      const row=current
        ?(await client.query(`UPDATE leadgen.crm_deal_profiles SET deal_amount=$2,deal_currency=$3,expected_close_date=$4,win_probability=$5,customer_grade=$6,
            version=version+1,updated_by=$7,updated_at=now() WHERE id=$1 RETURNING *`,
            [current.id,next.deal_amount,next.deal_currency,next.expected_close_date,next.win_probability,next.customer_grade,actor])).rows[0]
        :(await client.query(`INSERT INTO leadgen.crm_deal_profiles(company_id,merchant_id,deal_amount,deal_currency,expected_close_date,win_probability,customer_grade,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [companyId,owner,next.deal_amount,next.deal_currency,next.expected_close_date,next.win_probability,next.customer_grade,actor])).rows[0];
      await client.query(`INSERT INTO leadgen.crm_deal_profile_events(deal_profile_id,company_id,merchant_id,changes,changed_by) VALUES($1,$2,$3,$4::jsonb,$5)`,
        [row.id,companyId,owner,JSON.stringify(changes),actor]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return this.dealView(companyId,scope);
  }

  // ---- pipeline items with the signals health and reminders need ----
  /** Pipeline items for this owner (active stages by default), joined with deal values and recent contact. */
  async items(scope=null,companyIds=null,{allStages=false}={}){
    const stages=allStages?[null]:ACTIVE_STAGES;
    let rows=[];
    for(const stage of stages)rows.push(...(await this.repository.listPipeline({stage,limit:500,scope})).items);
    if(companyIds)rows=rows.filter(row=>companyIds.includes(row.company_id));
    // One row per company: an assessed company may hold more than one product profile.
    const byCompany=new Map();
    for(const row of rows){const kept=byCompany.get(row.company_id);if(!kept||FUNNEL_STAGES.indexOf(row.pipeline_stage)>FUNNEL_STAGES.indexOf(kept.pipeline_stage))byCompany.set(row.company_id,row);}
    rows=[...byCompany.values()];
    if(!rows.length)return[];
    const signals=(await this.pool.query(`SELECT c.id company_id,
        (SELECT max(coalesce(a.occurred_at,a.created_at)) FROM leadgen.opportunity_activities a WHERE a.company_id=c.id AND a.merchant_id IS NOT DISTINCT FROM $2::uuid) last_activity_at,
        (SELECT count(*)::int FROM leadgen.opportunity_activities a WHERE a.company_id=c.id AND a.merchant_id IS NOT DISTINCT FROM $2::uuid) activity_count,
        (SELECT count(*)::int FROM leadgen.opportunity_activities a WHERE a.company_id=c.id AND a.merchant_id IS NOT DISTINCT FROM $2::uuid
          AND coalesce(a.occurred_at,a.created_at)>$3::timestamptz-interval '7 days') recent_activity_7d,
        (SELECT max(m.sent_at) FROM leadgen.outbound_messages m WHERE m.company_id=c.id AND m.merchant_id IS NOT DISTINCT FROM $2::uuid AND m.sent_at IS NOT NULL) last_sent_at,
        (SELECT max(coalesce(i.received_at,i.created_at)) FROM leadgen.inbound_messages i JOIN leadgen.outreach_threads t ON t.id=i.thread_id
          WHERE t.company_id=c.id AND t.merchant_id IS NOT DISTINCT FROM $2::uuid) last_inbound_at,
        EXISTS(SELECT 1 FROM leadgen.outreach_recipients r WHERE r.company_id=c.id) has_email,
        d.deal_amount,d.deal_currency,d.expected_close_date,d.win_probability,d.customer_grade
      FROM leadgen.companies c
      LEFT JOIN leadgen.crm_deal_profiles d ON d.company_id=c.id AND d.merchant_id IS NOT DISTINCT FROM $2::uuid
      WHERE c.id=ANY($1::uuid[])`,[rows.map(row=>row.company_id),this.owner(scope),this.now().toISOString()])).rows;
    const byId=new Map(signals.map(row=>[row.company_id,row]));
    const history=await this.winHistory(scope);
    const now=this.now();
    return rows.map(row=>{
      const s=byId.get(row.company_id)||{};
      const item={...row,...s,deal_amount:s.deal_amount===null||s.deal_amount===undefined?null:Number(s.deal_amount),
        last_touch_at:latest(s.last_activity_at,s.last_sent_at,s.last_inbound_at,row.stage_changed_at)?.toISOString()||null};
      item.estimate=estimateWinProbability(item,history,now);
      item.effective_win_probability=s.win_probability??item.estimate.score;
      return item;
    });
  }

  /** Won/lost per company (from both stage histories) and the average won amount per currency, for this owner. */
  async winHistory(scope=null){
    const owner=this.owner(scope);
    const rows=(await this.pool.query(`SELECT company_id,count(*) FILTER(WHERE stage='WON')::int won,count(*) FILTER(WHERE stage='LOST')::int lost FROM(
        SELECT h.company_id,h.to_stage stage FROM leadgen.opportunity_stage_history h WHERE h.merchant_id IS NOT DISTINCT FROM $1::uuid AND h.to_stage IN('WON','LOST')
        UNION ALL SELECT e.company_id,e.stage FROM leadgen.manual_company_stage_events e WHERE e.merchant_id IS NOT DISTINCT FROM $1::uuid AND e.stage IN('WON','LOST')) x
      GROUP BY company_id`,[owner])).rows;
    const averages=(await this.pool.query(`SELECT d.deal_currency currency,avg(d.deal_amount)::float8 average FROM leadgen.crm_deal_profiles d
      WHERE d.merchant_id IS NOT DISTINCT FROM $1::uuid AND d.deal_amount IS NOT NULL AND d.deal_currency IS NOT NULL AND EXISTS(
        SELECT 1 FROM leadgen.opportunity_stage_history h WHERE h.company_id=d.company_id AND h.merchant_id IS NOT DISTINCT FROM $1::uuid AND h.to_stage='WON'
        UNION ALL SELECT 1 FROM leadgen.manual_company_stage_events e WHERE e.company_id=d.company_id AND e.merchant_id IS NOT DISTINCT FROM $1::uuid AND e.stage='WON')
      GROUP BY d.deal_currency`,[owner])).rows;
    return{companies:new Map(rows.map(row=>[row.company_id,{won:row.won,lost:row.lost}])),averageWon:new Map(averages.map(row=>[row.currency.trim(),row.average]))};
  }

  /** 重点客户 for the workbench: very interested, too long without follow-up, quote or samples unanswered. */
  async keyCustomers(scope=null){
    const [items,rules]=await Promise.all([this.items(scope),this.rules(scope)]);
    const now=this.now();
    const out=items.map(item=>({company_id:item.company_id,company_name:item.company_name,country_code:item.country_code,
      pipeline_stage:item.pipeline_stage,customer_grade:item.customer_grade||null,deal_amount:item.deal_amount,deal_currency:item.deal_currency||null,
      last_touch_at:item.last_touch_at,health:customerHealth(item,now),flags:keyCustomerFlags(item,rules,now)})).filter(item=>item.flags.length);
    const weight=item=>(item.flags.includes('QUOTED_NO_REPLY')||item.flags.includes('SAMPLE_NO_CONFIRM')?3:0)+(item.flags.includes('NO_FOLLOW_UP')?2:0)+(item.customer_grade==='A'?1:0);
    out.sort((a,b)=>weight(b)-weight(a)||(b.deal_amount||0)-(a.deal_amount||0));
    const count=flag=>out.filter(item=>item.flags.includes(flag)).length;
    return{items:out.slice(0,50),counts:{high_intent:count('HIGH_INTENT'),no_follow_up:count('NO_FOLLOW_UP'),
      quoted_no_reply:count('QUOTED_NO_REPLY'),sample_no_confirm:count('SAMPLE_NO_CONFIRM')},rules};
  }

  // ---- reminder rules ----
  async rules(scope=null){
    const row=(await this.pool.query(`SELECT enabled,no_follow_up_days,quoted_no_reply_days,sample_no_confirm_days,updated_by,updated_at
      FROM leadgen.crm_reminder_rules WHERE merchant_id IS NOT DISTINCT FROM $1::uuid`,[this.owner(scope)])).rows[0];
    return row?{...row}:{...DEFAULT_REMINDER_RULES,updated_by:null,updated_at:null};
  }
  async saveRules(body={},actor,scope=null){
    const next={enabled:body.enabled===undefined?true:body.enabled===true,no_follow_up_days:dayCount(body.no_follow_up_days,'Days without follow-up'),
      quoted_no_reply_days:dayCount(body.quoted_no_reply_days,'Days after a quote'),sample_no_confirm_days:dayCount(body.sample_no_confirm_days,'Days after samples')};
    await this.pool.query(`INSERT INTO leadgen.crm_reminder_rules(merchant_id,enabled,no_follow_up_days,quoted_no_reply_days,sample_no_confirm_days,updated_by)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_key) DO UPDATE SET enabled=EXCLUDED.enabled,no_follow_up_days=EXCLUDED.no_follow_up_days,
        quoted_no_reply_days=EXCLUDED.quoted_no_reply_days,sample_no_confirm_days=EXCLUDED.sample_no_confirm_days,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [this.owner(scope),next.enabled,next.no_follow_up_days,next.quoted_no_reply_days,next.sample_no_confirm_days,actor]);
    return this.rules(scope);
  }

  /** Hourly: open one reminder task per rule and company (never a second while one is open, and
   *  not again within the rule's days after a person closed it). SIM and each active merchant. */
  async scanReminders(){
    const owners=[{merchantId:null,restrict:false}];
    for(const row of(await this.pool.query(`SELECT id FROM leadgen.merchants_current WHERE effective_status IN('TRIAL','ACTIVE')`)).rows)
      owners.push({merchantId:row.id,restrict:true});
    let created=0,checked=0;
    const skipped={open:0,same_event:0,recently_closed:0,over_limit:0};
    for(const scope of owners){
      const rules=await this.rules(scope);
      if(!rules.enabled)continue;
      const {items,plan}=await this.reminderPlan(scope,rules);
      checked+=items.length;
      for(const row of plan.skipped)skipped[row.reason]++;
      const now=this.now();
      for(const entry of plan.create){
        const spec=REMINDER_TASKS[entry.rule];
        const item=entry.item;
        const high=['QUOTED_NO_REPLY','SAMPLE_NO_CONFIRM'].includes(entry.rule)||item.customer_grade==='A'||customerHealth(item,now).level==='POOR';
        // The 079 partial unique index keeps one open task per company, owner and rule even under a race.
        const inserted=await this.pool.query(`INSERT INTO leadgen.sales_tasks(company_id,task_type,task_status,owner,due_at,details,updated_by,merchant_id,priority,source_rule,source_event_at)
            VALUES($1,$2,'OPEN',$3,now(),$4::jsonb,'reminder-rules',$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
          [item.company_id,spec.task_type,item.owner_identity||'reminder-rules',JSON.stringify({title:spec.title,title_en:spec.title_en,next_action:spec.next_action,source:'REMINDER_RULE',notes:[]}),
            scope.merchantId,high?'HIGH':'NORMAL',entry.rule,entry.event_at]);
        created+=inserted.rowCount;
        if(!inserted.rowCount)skipped.open++;
      }
    }
    return{status:'COMPLETED',owners:owners.length,checked,created,skipped};
  }

  /** Items and the reminder plan for one owner (no writes). */
  async reminderPlan(scope,rules=null){
    rules=rules||await this.rules(scope);
    const items=await this.items(scope);
    const existing=items.length?(await this.pool.query(`SELECT company_id,source_rule,task_status,closed_at,source_event_at FROM leadgen.sales_tasks
      WHERE source_rule IS NOT NULL AND merchant_id IS NOT DISTINCT FROM $1::uuid AND company_id=ANY($2::uuid[])`,[this.owner(scope),items.map(item=>item.company_id)])).rows:[];
    return{items,plan:planReminders(items,rules,existing,this.now())};
  }

  /** 试运行 / Preview: what the next hourly run would create for this owner, with the current rules. */
  async previewReminders(scope=null){
    const rules=await this.rules(scope);
    const {items,plan}=await this.reminderPlan(scope,rules);
    return{enabled:rules.enabled,checked:items.length,rules:summarizeReminderPlan(plan),limit:MAX_REMINDERS_PER_RUN};
  }

  // ---- reports ----
  async reports(scope=null){
    const owner=this.owner(scope);
    const all=await this.items(scope,null,{allStages:true});
    // Furthest stage each company reached (from both stage histories), for conversion between stages.
    const reached=new Map((await this.pool.query(`SELECT company_id,array_agg(DISTINCT stage) stages FROM(
        SELECT h.company_id,h.to_stage stage FROM leadgen.opportunity_stage_history h WHERE h.merchant_id IS NOT DISTINCT FROM $1::uuid
        UNION ALL SELECT e.company_id,e.stage FROM leadgen.manual_company_stage_events e WHERE e.merchant_id IS NOT DISTINCT FROM $1::uuid) x
      GROUP BY company_id`,[owner])).rows.map(row=>[row.company_id,row.stages]));
    const furthest=item=>{
      const stages=[...(reached.get(item.company_id)||[]),item.pipeline_stage].filter(stage=>FUNNEL_STAGES.includes(stage));
      return Math.max(0,...stages.map(stage=>FUNNEL_STAGES.indexOf(stage)));
    };
    const currencyOf=items=>{const counts={};for(const item of items)if(item.deal_currency)counts[item.deal_currency]=(counts[item.deal_currency]||0)+1;
      return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;};
    const mainCurrency=currencyOf(all);
    const sum=items=>Math.round(items.filter(item=>item.deal_currency===mainCurrency).reduce((total,item)=>total+(item.deal_amount||0),0)*100)/100;
    const funnel=FUNNEL_STAGES.map((stage,index)=>{
      const at=all.filter(item=>item.pipeline_stage===stage);
      const reachedCount=all.filter(item=>furthest(item)>=index).length;
      return{stage,count:at.length,amount:sum(at),reached:reachedCount};
    });
    funnel.forEach((row,index)=>{row.conversion=index===0||!funnel[index-1].reached?null:Math.round(row.reached/funnel[index-1].reached*1000)/10;});
    const lost=all.filter(item=>item.pipeline_stage==='LOST');
    const countries=new Map();
    for(const item of all){
      const key=item.country_code||'—';const row=countries.get(key)||{country_code:key,customers:0,active:0,won:0,amount:0};
      row.customers++;if(ACTIVE_STAGES.includes(item.pipeline_stage))row.active++;if(item.pipeline_stage==='WON')row.won++;
      if(item.deal_currency===mainCurrency)row.amount=Math.round((row.amount+(item.deal_amount||0))*100)/100;
      countries.set(key,row);
    }
    const tasks=(await this.pool.query(`SELECT count(*) FILTER(WHERE task_status IN('OPEN','IN_PROGRESS'))::int open,
        count(*) FILTER(WHERE task_status IN('OPEN','IN_PROGRESS') AND due_at<now())::int overdue
      FROM leadgen.sales_tasks WHERE record_scope='PROSPECT' AND merchant_id IS NOT DISTINCT FROM $1::uuid`,[owner])).rows[0];
    // Hours from a customer's reply to the next thing done for that company (email, activity, stage), last 90 days.
    const response=(await this.pool.query(`SELECT avg(extract(epoch FROM next_at-replied_at)/3600)::numeric(10,1) hours,count(*)::int replies FROM(
        SELECT coalesce(i.received_at,i.created_at) replied_at,(SELECT min(x) FROM(
            SELECT min(m.sent_at) x FROM leadgen.outbound_messages m WHERE m.company_id=t.company_id AND m.merchant_id IS NOT DISTINCT FROM $1::uuid AND m.sent_at>coalesce(i.received_at,i.created_at)
            UNION ALL SELECT min(coalesce(a.occurred_at,a.created_at)) FROM leadgen.opportunity_activities a WHERE a.company_id=t.company_id
              AND a.merchant_id IS NOT DISTINCT FROM $1::uuid AND a.activity_type IN('CALL','WHATSAPP','MEETING','NOTE','EMAIL_MANUAL') AND coalesce(a.occurred_at,a.created_at)>coalesce(i.received_at,i.created_at)) n) next_at
        FROM leadgen.inbound_messages i JOIN leadgen.outreach_threads t ON t.id=i.thread_id
        WHERE t.merchant_id IS NOT DISTINCT FROM $1::uuid AND coalesce(i.received_at,i.created_at)>now()-interval '90 days') r WHERE next_at IS NOT NULL`,[owner])).rows[0];
    const rules=await this.rules(scope);const now=this.now();
    // Every currency on its own line: amounts are never converted or silently dropped.
    const byCurrency=new Map();
    for(const item of all.filter(item=>item.deal_currency&&item.deal_amount!==null)){
      const row=byCurrency.get(item.deal_currency)||{currency:item.deal_currency,deals:0,pipeline_amount:0,weighted_amount:0,won_amount:0};
      row.deals++;
      if(ACTIVE_STAGES.includes(item.pipeline_stage)){row.pipeline_amount+=item.deal_amount;row.weighted_amount+=item.deal_amount*item.effective_win_probability/100;}
      if(item.pipeline_stage==='WON')row.won_amount+=item.deal_amount;
      byCurrency.set(item.deal_currency,row);
    }
    const round=value=>Math.round(value*100)/100;
    const currencies=[...byCurrency.values()].map(row=>({...row,pipeline_amount:round(row.pipeline_amount),weighted_amount:round(row.weighted_amount),won_amount:round(row.won_amount)}))
      .sort((a,b)=>(a.currency===mainCurrency?-1:b.currency===mainCurrency?1:b.deals-a.deals));
    // This calendar month (UTC): deals closed won or lost, and deals expected to close.
    const month=now.toISOString().slice(0,7);
    const inMonth=value=>value&&new Date(value).toISOString().slice(0,7)===month;
    const wonMonth=all.filter(item=>item.pipeline_stage==='WON'&&inMonth(item.stage_changed_at)).length;
    const lostMonth=all.filter(item=>item.pipeline_stage==='LOST'&&inMonth(item.stage_changed_at)).length;
    const expected=all.filter(item=>ACTIVE_STAGES.includes(item.pipeline_stage)&&inMonth(item.expected_close_date));
    const risks=all.map(item=>({item,risks:dealRisks(item,rules,now)})).filter(row=>row.risks.length)
      .sort((a,b)=>b.risks.length-a.risks.length||(b.item.deal_amount||0)-(a.item.deal_amount||0)).slice(0,10)
      .map(({item,risks})=>({company_id:item.company_id,company_name:item.company_name,country_code:item.country_code,pipeline_stage:item.pipeline_stage,
        deal_amount:item.deal_amount,deal_currency:item.deal_currency||null,risks}));
    const report={currency:mainCurrency,generated_at:now.toISOString(),currencies,
      this_month:{month,won:wonMonth,lost:lostMonth,win_rate:wonMonth+lostMonth?Math.round(wonMonth/(wonMonth+lostMonth)*1000)/10:null,
        expected_close:{count:expected.length,amounts:[...expected.reduce((map,item)=>{if(item.deal_currency&&item.deal_amount!==null)map.set(item.deal_currency,round((map.get(item.deal_currency)||0)+item.deal_amount));return map;},new Map())]
          .map(([currency,amount])=>({currency,amount}))}},
      risks,
      totals:{customers:all.length,active:all.filter(item=>ACTIVE_STAGES.includes(item.pipeline_stage)).length,won:funnel.at(-1).count,lost:lost.length,
        pipeline_amount:sum(all.filter(item=>ACTIVE_STAGES.includes(item.pipeline_stage))),
        weighted_amount:Math.round(all.filter(item=>ACTIVE_STAGES.includes(item.pipeline_stage)&&item.deal_currency===mainCurrency)
          .reduce((total,item)=>total+(item.deal_amount||0)*item.effective_win_probability/100,0)*100)/100,
        won_amount:sum(all.filter(item=>item.pipeline_stage==='WON'))},
      funnel,
      lost_reasons:Object.entries(lost.reduce((acc,item)=>{const key=item.lost_reason||'—';acc[key]=(acc[key]||0)+1;return acc;},{})).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,10),
      countries:[...countries.values()].sort((a,b)=>b.customers-a.customers).slice(0,20),
      follow_up:{open_tasks:tasks.open,overdue_tasks:tasks.overdue,overdue_rate:tasks.open?Math.round(tasks.overdue/tasks.open*1000)/10:0,
        avg_response_hours:response.hours===null?null:Number(response.hours),replies_90d:response.replies,
        quoted_no_reply:all.filter(item=>keyCustomerFlags(item,rules,now).includes('QUOTED_NO_REPLY')).length,
        no_follow_up:all.filter(item=>keyCustomerFlags(item,rules,now).includes('NO_FOLLOW_UP')).length}};
    if(!scope?.restrict)report.merchants=await this.merchantRanking();
    return report;
  }

  /** SIM administrator only: each merchant's last 30 days and pipeline. */
  async merchantRanking(){
    const rows=(await this.pool.query(`SELECT m.id,m.company_name,m.effective_status status,
        (SELECT count(*)::int FROM leadgen.merchant_companies mc WHERE mc.merchant_id=m.id AND mc.assigned_at>now()-interval '30 days') new_customers,
        (SELECT count(*)::int FROM leadgen.opportunity_activities a WHERE a.merchant_id=m.id AND coalesce(a.occurred_at,a.created_at)>now()-interval '30 days'
          AND a.activity_type IN('CALL','WHATSAPP','MEETING','NOTE','EMAIL_MANUAL')) follow_ups,
        (SELECT count(*)::int FROM leadgen.outbound_messages o WHERE o.merchant_id=m.id AND o.sent_at>now()-interval '30 days') emails_sent,
        (SELECT count(*)::int FROM leadgen.opportunity_stage_history h WHERE h.merchant_id=m.id AND h.to_stage='WON' AND h.changed_at>now()-interval '30 days') won
      FROM leadgen.merchants_current m ORDER BY m.created_at`)).rows;
    return rows.sort((a,b)=>b.won-a.won||b.follow_ups-a.follow_ups||b.emails_sent-a.emails_sent);
  }
}

const REMINDER_RULES=Object.freeze(['NO_FOLLOW_UP','QUOTED_NO_REPLY','SAMPLE_NO_CONFIRM','NEXT_ACTION_DUE']);
const REMINDER_TASKS=Object.freeze({
  NEXT_ACTION_DUE:{task_type:'FOLLOW_UP',title:'计划的下次联系日已过，请跟进',title_en:'The planned next contact date has passed; follow up',next_action:'Contact the customer as planned'},
  NO_FOLLOW_UP:{task_type:'FOLLOW_UP',title:'跟进提醒：已经很久没有联系这家客户',title_en:'Follow-up reminder: no contact for a while',next_action:'Call, message or email the customer'},
  QUOTED_NO_REPLY:{task_type:'QUOTATION',title:'报价后客户还没回复，请跟进',title_en:'No reply after the quote; follow up',next_action:'Ask whether the quote works and what is missing'},
  SAMPLE_NO_CONFIRM:{task_type:'SAMPLE',title:'寄样后客户还没确认，请跟进',title_en:'No confirmation after samples; follow up',next_action:'Check the samples arrived and ask for feedback'}
});
export {PIPELINE_STAGES};
