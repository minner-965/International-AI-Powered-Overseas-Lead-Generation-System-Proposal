import {createHash} from 'node:crypto';
import {classifySnapshot} from './classifier.js';
import {classifyContactReadiness} from './contactReadiness.js';

export const OPPORTUNITY_POOL_VERSION='v1_MC04';
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
    company_id:business.company_id,rule_version:OPPORTUNITY_POOL_VERSION,
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

export class OpportunityPoolService{
  constructor({pool}={}){if(!pool)throw Error('OpportunityPoolService pool required');this.pool=pool;}
  async preview({companyIds=null,queryable=this.pool}={}){
    const snapshot=await readOpportunityPoolSnapshot(queryable,{companyIds});
    const companies=new Map(snapshot.tables.companies.map(row=>[row.id,row]));
    const rows=classifySnapshot(snapshot).map(row=>projectPoolDecision(row,classifyContactReadiness(companies.get(row.company_id),snapshot),snapshot));
    return{observed_at:snapshot.observed_at,rows,summary:summarizePoolRows(rows)};
  }
  async refreshAll(options={}){return this.refresh({...options,companyIds:null});}
  async refreshCompany(companyId,options={}){return this.refresh({...options,companyIds:[companyId]});}
  async refresh({companyIds=null,reason='EVIDENCE_CHANGED',researchJobId=null}={}){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // Serialize reads and inserts. A replay is only reused if it is still current (A→B→A appends A).
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('MC04_OPPORTUNITY_POOL',0))");
      const preview=await this.preview({companyIds,queryable:client});
      const inserted=[];const replayed=[];
      for(const row of preview.rows){
        const digest=hash(row);
        const prior=(await client.query('SELECT * FROM leadgen.opportunity_pool_current WHERE company_id=$1',[row.company_id])).rows[0];
        if(prior?.input_digest===digest){replayed.push(prior);continue;}
        const saved=await client.query(`INSERT INTO leadgen.opportunity_pool_decisions
          (company_id,research_job_id,rule_version,input_digest,opportunity_pool_band,is_active_business_opportunity,
          opportunity_pool_reason_codes,category_relation,company_fit_relation,contact_readiness_labels,email_send_eligibility,
          review_flags,profile_results,evidence_references,change_reason,observed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15,$16) RETURNING *`,
        [row.company_id,researchJobId,row.rule_version,digest,row.opportunity_pool_band,row.is_active_business_opportunity,
          row.opportunity_pool_reason_codes,row.category_relation,JSON.stringify(row.company_fit_relation),row.contact_readiness_labels,
          JSON.stringify(row.email_send_eligibility),row.review_flags,JSON.stringify(row.profile_results),JSON.stringify(row.evidence_references),
          String(reason).slice(0,160),preview.observed_at]);
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
    return this.refreshReadiness(rows.map(row=>({...row,...(byId.get(row.company_id||row.id)||{})})));
  }
  async summary(){return summarizePoolRows(await this.list());}
}
