import {createHash} from 'node:crypto';
import {classifySnapshot} from './classifier.js';
import {classifySnapshotV2,OPPORTUNITY_POOL_V2_VERSION} from './classifierV2.js';
import {classifyContactReadiness} from './contactReadiness.js';
import {LeadUsabilityService} from './leadUsability.js';

// v2_MC08 is the live rule (Simon's decision 2026-10-27 #1). v1_MC04 stays importable from ./classifier.js
// for history and comparison; stored v1 decisions are never rewritten (the decision table is append-only).
export const OPPORTUNITY_POOL_V1_VERSION='v1_MC04';
export const OPPORTUNITY_POOL_VERSION=OPPORTUNITY_POOL_V2_VERSION;
export const OPPORTUNITY_POOL_BANDS=['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'];
const activeBands=new Set(OPPORTUNITY_POOL_BANDS.slice(0,3));
const unique=values=>[...new Set(values.filter(Boolean))];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const independentEmailEligibility=contact=>({...contact.email_eligibility,
  reason_codes:unique([...(contact.email_eligibility.reason_codes||[]),'EXISTING_EMAIL_AUTHORIZATION_REQUIRES_EVALUATION']),
  policy:'EXISTING_OUTREACH_GATES_REQUIRED',send_authorized:false});
const contactTables=['company_contact_route_current','contacts','company_suppressions','contact_suppressions','outreach_recipient_suppressions','outbound_messages','decision_makers','decision_maker_contacts','outreach_recipients'];
const businessTables=['prospect_category_observations','prospect_category_sources','business_opportunity_current','buyer_business_model_results','buyer_business_model_evidence','category_procurement_match_results','dpv_product_category_scope_current','company_verification_evidence','dpv_product_category_scope_aliases'];

/** Uses the existing immutable evidence; never invokes a provider or an outreach mutation. */
export async function readOpportunityPoolSnapshot(queryable,{companyIds=null,contactsOnly=false}={}){
  const observed=(await queryable.query('SELECT clock_timestamp() AS observed_at')).rows[0].observed_at;
  const tables={companies:(await queryable.query(`SELECT * FROM leadgen.companies${companyIds?' WHERE id=ANY($1::uuid[])':''}`,companyIds?[companyIds]:[])).rows};
  for(const name of [...(contactsOnly?['business_opportunity_current']:businessTables),...contactTables]){
    // Static identifiers only; no caller-supplied SQL identifiers or provider payloads.
    const columns=name==='outbound_messages'?'company_id,sent_at,transport_status,send_status':'*';
    tables[name==='company_contact_route_current'?'company_contact_routes':name]=(await queryable.query(`SELECT ${columns} FROM leadgen.${name}`)).rows;
  }
  tables.outreach_approvals=(await queryable.query('SELECT id,company_id,draft_id,decision FROM leadgen.outreach_approvals')).rows;
  tables.outreach_drafts=(await queryable.query('SELECT id,company_id,draft_status,version FROM leadgen.outreach_drafts')).rows;
  return{observed_at:new Date(observed).toISOString(),tables};
}

export function projectPoolDecision(business,contact,snapshot=null){
  const flags=unique(business.notes||[]);
  // Warnings explain uncertainty but do not change the approved business classification.
  if(business.new_opportunity_pool_band==='GENERAL_RELEVANT'&&business.category_basis==='NO_CURRENT_CATEGORY_EVIDENCE')flags.push('BROAD_SCOPE_CATEGORY_REVIEW');
  const evidence=(snapshot?.tables?.company_verification_evidence||[]).filter(row=>row.company_id===business.company_id);
  if(evidence.some(row=>/\b(?:refrigeraci[oó]n|refrigeration|industrial equipment)\b/i.test(row.evidence_text||'')))flags.push('BUSINESS_SCOPE_REVIEW');
  if(evidence.some(row=>/\bare you\b[^?]{0,180}\?/i.test(row.evidence_text||'')))flags.push('BUSINESS_ATTRIBUTION_REVIEW');
  if(business.company_type_basis?.suitable_by_evidence&&evidence.some(row=>/\b(?:manufacturer|manufacturing|OEM)\b/i.test(row.evidence_text||'')))flags.push('MIXED_MANUFACTURING_BUYER_ROLE_REVIEW');
  return{
    company_id:business.company_id,rule_version:business.rule_version||OPPORTUNITY_POOL_V1_VERSION,
    opportunity_pool_band:business.new_opportunity_pool_band,
    is_active_business_opportunity:activeBands.has(business.new_opportunity_pool_band),
    opportunity_pool_reason_codes:unique([business.category_basis,...flags]),
    category_relation:business.category_basis,company_fit_relation:business.company_type_basis,
    contact_readiness_labels:contact.contact_readiness,
    email_send_eligibility:independentEmailEligibility(contact),
    review_flags:flags,profile_results:business.profile_results,evidence_references:business.evidence_references,
  };
}
export function publicPoolFields(row){
  if(!row)return{};
  return{
    opportunity_pool_decision_id:row.id||row.opportunity_pool_decision_id||null,
    opportunity_pool_revision:row.revision||null,opportunity_pool_rule_version:row.rule_version,
    opportunity_pool_band:row.opportunity_pool_band,
    is_active_business_opportunity:row.is_active_business_opportunity,
    active_opportunity_pool:row.is_active_business_opportunity,
    opportunity_pool_reason_codes:row.opportunity_pool_reason_codes||[],
    category_relation:row.category_relation,category_basis:row.category_relation,
    company_fit_relation:row.company_fit_relation,
    contact_readiness_labels:row.contact_readiness_labels||[],
    email_send_eligibility:row.email_send_eligibility,email_eligibility:row.email_send_eligibility,
    review_flags:row.review_flags||[],data_quality_flags:row.review_flags||[],review_warning:Boolean(row.review_flags?.length),
    opportunity_pool_profile_results:row.profile_results||[],opportunity_pool_evidence_references:row.evidence_references||[],
    opportunity_pool_observed_at:row.observed_at||null,
  };
}
export function summarizePoolRows(rows){
  const counts=Object.fromEntries(OPPORTUNITY_POOL_BANDS.map(band=>[band,0]));
  for(const row of rows)if(Object.hasOwn(counts,row.opportunity_pool_band))counts[row.opportunity_pool_band]++;
  const active=rows.filter(row=>row.is_active_business_opportunity);
  return{...counts,total:rows.length,active:active.length,active_business_opportunities:active.length,
    contact_ready:active.filter(row=>(row.contact_readiness_labels||[]).some(label=>['EMAIL_READY','PHONE_READY','WHATSAPP_READY','FORM_READY','NAMED_BUYER_READY'].includes(label))).length,
    email_ready:active.filter(row=>(row.contact_readiness_labels||[]).includes('EMAIL_READY')).length,
    email_eligible:active.filter(row=>row.email_send_eligibility?.send_authorized===true&&['READY','ELIGIBLE'].includes(row.email_send_eligibility?.status)).length};
}

export const decisionDigest=row=>hash(row);
/** Pool decisions for a snapshot with the live (v2) or historical (v1) classifier. */
export function projectSnapshot(snapshot,{ruleVersion=OPPORTUNITY_POOL_VERSION}={}){
  const companies=new Map(snapshot.tables.companies.map(row=>[row.id,row]));
  const classified=ruleVersion===OPPORTUNITY_POOL_V1_VERSION?classifySnapshot(snapshot):classifySnapshotV2(snapshot);
  return classified.map(row=>projectPoolDecision(row,classifyContactReadiness(companies.get(row.company_id),snapshot),snapshot));
}
const INSERT_DECISION_SQL=`INSERT INTO leadgen.opportunity_pool_decisions
  (company_id,research_job_id,rule_version,input_digest,opportunity_pool_band,is_active_business_opportunity,
  opportunity_pool_reason_codes,category_relation,company_fit_relation,contact_readiness_labels,email_send_eligibility,
  review_flags,profile_results,evidence_references,change_reason,observed_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15,$16) RETURNING *`;
const decisionParams=(row,digest,{researchJobId=null,reason,observedAt})=>[row.company_id,researchJobId,row.rule_version,digest,row.opportunity_pool_band,row.is_active_business_opportunity,
  row.opportunity_pool_reason_codes,row.category_relation,JSON.stringify(row.company_fit_relation),row.contact_readiness_labels,
  JSON.stringify(row.email_send_eligibility),row.review_flags,JSON.stringify(row.profile_results),JSON.stringify(row.evidence_references),
  String(reason).slice(0,160),observedAt];

// Business part of a decision: band, reasons, category/company fit, flags, profiles and evidence. Contact readiness
// and email eligibility are excluded on purpose: they are recomputed live on every read (refreshReadiness), so
// a contact-policy change alone (e.g. a verification TTL) is not a reason to append a business decision.
const plain=value=>JSON.parse(JSON.stringify(value??null));
export const businessDigest=row=>hash(plain({band:row.opportunity_pool_band,reasons:row.opportunity_pool_reason_codes||[],category:row.category_relation,
  fit:row.company_fit_relation||null,flags:row.review_flags||[],profiles:row.profile_results||[],evidence:row.evidence_references||[]}));

/**
 * Re-evaluation decision for one company against its stored current decision:
 *  NEW            no stored decision;
 *  UNCHANGED      the stored decision equals this v2 decision, or has the same band and the same business inputs
 *                 (a v1 decision is compared with the v1 projection recomputed now, a v2 decision with v2);
 *  BAND_CHANGED   the v2 band differs from the stored band;  INPUTS_CHANGED otherwise.
 */
export function reevaluationChange(prior,{v2Row,v2Digest,v1Row=null}){
  if(!prior)return'NEW';
  if(prior.input_digest===v2Digest)return'UNCHANGED';
  if(prior.opportunity_pool_band!==v2Row.opportunity_pool_band)return'BAND_CHANGED';
  const comparable=prior.rule_version===v2Row.rule_version?v2Row:v1Row;
  if(comparable&&businessDigest(prior)===businessDigest(comparable))return'UNCHANGED';
  return'INPUTS_CHANGED';
}

export const MODEL_ATTRIBUTION_REVIEW_FLAG='MODEL_ATTRIBUTION_REVIEW';
const MODEL_ATTRIBUTION_ROWS_PER_COMPANY=25;
/**
 * Evidence the model marked "needs review" (T3, ASSIST mode only) is left out of the tier and the company
 * gets a review flag. Without such evidence the snapshot and the decision are exactly the rule result.
 */
export function applyAttributionReview(snapshot,review){
  if(!review?.ids?.size)return snapshot;
  const keep=row=>!review.ids.has(String(row.id));
  return{...snapshot,tables:{...snapshot.tables,
    prospect_category_observations:(snapshot.tables.prospect_category_observations||[]).filter(keep),
    company_verification_evidence:(snapshot.tables.company_verification_evidence||[]).filter(keep)}};
}
const flagAttributionReview=(rows,review)=>!review?.companies?.size?rows:rows.map(row=>review.companies.has(String(row.company_id))
  ?{...row,review_flags:unique([...(row.review_flags||[]),MODEL_ATTRIBUTION_REVIEW_FLAG]),
    opportunity_pool_reason_codes:unique([...(row.opportunity_pool_reason_codes||[]),MODEL_ATTRIBUTION_REVIEW_FLAG])}:row);

export class OpportunityPoolService{
  constructor({pool,leadUsability=null,modelAssistHooks=null}={}){if(!pool)throw Error('OpportunityPoolService pool required');this.pool=pool;
    this.leadUsability=leadUsability||new LeadUsabilityService({pool});this.modelAssistHooks=modelAssistHooks;}
  async preview({companyIds=null,queryable=this.pool,attribution=null}={}){
    const snapshot=applyAttributionReview(await readOpportunityPoolSnapshot(queryable,{companyIds}),attribution);
    const rows=flagAttributionReview(projectSnapshot(snapshot),attribution);
    return{observed_at:snapshot.observed_at,rows,summary:summarizePoolRows(rows)};
  }
  /**
   * T3 attribution check (llm/hooks.js checkAttribution) for the evidence of the companies being refreshed,
   * run before the tiering transaction so no lock is held during model calls. Only for a refresh of named
   * companies (research commits), at most 25 evidence rows per company. Stops at the first answer that says
   * model assist is off, unconfigured or out of budget. Returns null when nothing needs review.
   */
  async attributionReview(companyIds){
    if(!this.modelAssistHooks?.checkAttribution||!Array.isArray(companyIds)||!companyIds.length)return null;
    try{
      const companies=new Map((await this.pool.query(`SELECT id,company_name,country_code,official_root_domain,website_url
        FROM leadgen.companies WHERE id=ANY($1::uuid[])`,[companyIds])).rows.map(row=>[String(row.id),row]));
      const evidence=[...(await this.pool.query(`SELECT o.id,o.company_id,o.evidence_text,s.source_url FROM leadgen.prospect_category_observations o
          JOIN leadgen.prospect_category_sources s ON s.id=o.source_id
          WHERE o.company_id=ANY($1::uuid[]) AND o.verification_status<>'REJECTED' ORDER BY o.company_id,o.captured_at DESC,o.id`,[companyIds])).rows,
        ...(await this.pool.query(`SELECT id,company_id,evidence_text,source_url FROM leadgen.company_verification_evidence
          WHERE company_id=ANY($1::uuid[]) AND evidence_type<>'PUBLIC_CONTACT' ORDER BY company_id,captured_at DESC,id`,[companyIds])).rows];
      const ids=new Set(),flagged=new Set(),perCompany=new Map();
      for(const row of evidence){
        const companyId=String(row.company_id);const count=perCompany.get(companyId)||0;
        if(count>=MODEL_ATTRIBUTION_ROWS_PER_COMPANY||!String(row.evidence_text||'').trim())continue;
        perCompany.set(companyId,count+1);
        const company=companies.get(companyId)||{};
        const result=await this.modelAssistHooks.checkAttribution({merchantId:null,companyId,
          company:{display_name:company.company_name,official_domain:company.official_root_domain||company.website_url||null,market:company.country_code},
          evidence:{evidence_id:String(row.id),source_url:row.source_url,evidence_text:row.evidence_text}});
        if(!result?.ran&&!/^LLM_INPUT/.test(String(result?.code||'')))break;
        if(result?.needs_review===true){ids.add(String(row.id));flagged.add(companyId);}
      }
      return ids.size?{ids,companies:flagged}:null;
    }catch{return null;}
  }
  /**
   * Rule-version re-evaluation (v1_MC04 -> v2_MC08). Dry run by default (READ ONLY transaction, no writes).
   * With apply=true it appends a v2 decision only for companies whose band or inputs changed; history is kept.
   */
  async reevaluate({apply=false,companyIds=null,reason='RULE_VERSION_V2_MC08_REEVALUATION'}={}){
    const client=await this.pool.connect();
    try{
      await client.query(apply?'BEGIN':'BEGIN READ ONLY');
      if(apply)await client.query("SELECT pg_advisory_xact_lock(hashtextextended('MC04_OPPORTUNITY_POOL',0))");
      const snapshot=await readOpportunityPoolSnapshot(client,{companyIds});
      const v1=new Map(projectSnapshot(snapshot,{ruleVersion:OPPORTUNITY_POOL_V1_VERSION}).map(row=>[row.company_id,row]));
      const v2Rows=projectSnapshot(snapshot);
      const stored=new Map((await client.query(`SELECT * FROM leadgen.opportunity_pool_current${companyIds?' WHERE company_id=ANY($1::uuid[])':''}`,companyIds?[companyIds]:[])).rows.map(row=>[row.company_id,row]));
      const names=new Map(snapshot.tables.companies.map(row=>[row.id,row.company_name]));
      const changes=[];const counts={UNCHANGED:0,NEW:0,BAND_CHANGED:0,INPUTS_CHANGED:0};let appended=0;
      for(const row of v2Rows){
        const prior=stored.get(row.company_id);const v2Digest=hash(row);
        const change=reevaluationChange(prior,{v2Row:row,v2Digest,v1Row:v1.get(row.company_id)||null});
        counts[change]++;
        if(change==='UNCHANGED')continue;
        changes.push({company_id:row.company_id,company_name:names.get(row.company_id)||null,change,
          from_band:prior?.opportunity_pool_band||null,from_rule_version:prior?.rule_version||null,to_band:row.opportunity_pool_band,to_rule_version:row.rule_version});
        if(apply){await client.query(INSERT_DECISION_SQL,decisionParams(row,v2Digest,{reason:`${reason}:${change}`,observedAt:snapshot.observed_at}));appended++;}
      }
      await client.query(apply?'COMMIT':'ROLLBACK');
      return{dry_run:!apply,rule_version:OPPORTUNITY_POOL_VERSION,observed_at:snapshot.observed_at,total:v2Rows.length,counts,appended,changes,
        summary_before:summarizePoolRows([...stored.values()]),summary_after:summarizePoolRows(v2Rows)};
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }
  async refreshAll(options={}){return this.refresh({...options,companyIds:null});}
  async refreshCompany(companyId,options={}){return this.refresh({...options,companyIds:[companyId]});}
  async refresh({companyIds=null,reason='EVIDENCE_CHANGED',researchJobId=null}={}){
    const attribution=await this.attributionReview(companyIds);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // Serialize reads and inserts. A replay is only reused if it is still current (A→B→A appends A).
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('MC04_OPPORTUNITY_POOL',0))");
      const preview=await this.preview({companyIds,queryable:client,attribution});
      const inserted=[];const replayed=[];
      for(const row of preview.rows){
        const digest=hash(row);
        const prior=(await client.query('SELECT * FROM leadgen.opportunity_pool_current WHERE company_id=$1',[row.company_id])).rows[0];
        if(prior?.input_digest===digest){replayed.push(prior);continue;}
        const saved=await client.query(INSERT_DECISION_SQL,decisionParams(row,digest,{researchJobId,reason,observedAt:preview.observed_at}));
        inserted.push(saved.rows[0]);
      }
      await client.query('COMMIT');
      return{...preview,inserted:inserted.length,replayed:replayed.length,decisions:[...inserted,...replayed]};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async current(companyId){return(await this.list({companyIds:[companyId]}))[0]||null;}
  async list({band='ALL',companyIds=null}={}){
    if(!['ALL','ACTIVE',...OPPORTUNITY_POOL_BANDS].includes(band))throw Error('Invalid opportunity pool band');
    const result=await this.pool.query(`SELECT c.*,p.company_id,to_jsonb(p) AS pool_projection
      FROM leadgen.opportunity_pool_current p JOIN leadgen.companies c ON c.id=p.company_id
      WHERE ($1='ALL' OR ($1='ACTIVE' AND p.is_active_business_opportunity) OR p.opportunity_pool_band=$1)
      AND ($2::uuid[] IS NULL OR p.company_id=ANY($2::uuid[])) ORDER BY c.company_name,p.company_id`,[band,companyIds]);
    const rows=result.rows.map(({pool_projection,...company})=>({...company,...publicPoolFields(pool_projection)}));
    return this.refreshReadiness(rows);
  }
  async refreshReadiness(rows){
    if(!rows.length)return rows;
    // Address suppression, freshness and sent history are live reads, never stale stored permission.
    const snapshot=await readOpportunityPoolSnapshot(this.pool,{companyIds:unique(rows.map(row=>row.company_id||row.id)),contactsOnly:true});
    const companies=new Map(snapshot.tables.companies.map(row=>[row.id,row]));
    return rows.map(row=>{
      const company=companies.get(row.company_id||row.id);if(!company)return row;
      const contact=classifyContactReadiness(company,snapshot);
      const email=independentEmailEligibility(contact);
      return{...row,contact_readiness_labels:contact.contact_readiness,email_send_eligibility:email,email_eligibility:email};
    });
  }
  async decorateRows(rows){
    if(!rows.length)return rows;
    const ids=unique(rows.map(row=>row.company_id||row.id));
    const result=await this.pool.query('SELECT * FROM leadgen.opportunity_pool_current WHERE company_id=ANY($1::uuid[])',[ids]);
    const byId=new Map(result.rows.map(row=>[row.company_id,publicPoolFields(row)]));
    const decorated=await this.refreshReadiness(rows.map(row=>({...row,...(byId.get(row.company_id||row.id)||{})})));
    // 无用线索 status (migration 073) travels with every list row; pages hide UNUSABLE rows by default.
    return this.leadUsability?this.leadUsability.decorate(decorated):decorated;
  }
  async summary(){return summarizePoolRows(await this.list());}
}
