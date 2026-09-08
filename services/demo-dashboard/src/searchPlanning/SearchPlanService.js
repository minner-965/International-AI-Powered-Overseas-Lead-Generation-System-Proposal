import {loadSearchPlanningConfig} from './config.js';
import {planSearchQueries} from './queryPlanner.js';

// Planning never imports a provider, executor, queue or opportunity classifier.
export class SearchPlanService {
  constructor({pool,config=loadSearchPlanningConfig()}={}) {this.pool=pool;this.config=structuredClone(config);}
  plan(snapshot) {return planSearchQueries(snapshot,{config:this.config,providerPurpose:'COMPANY_DISCOVERY'});}
  present(plan,persisted=false) {
    const {queries,skipped,...summary}=plan;
    return {...summary,persisted,status:'PLANNED'};
  }
  preview(snapshot) {return this.present(this.plan(snapshot));}
  async store(client,{batchId=null,jobId=null,snapshot}) {
    const plan=this.plan(snapshot);
    // Existing rows are immutable. A version is never silently regenerated.
    const prior=await client.query(`SELECT * FROM leadgen.research_query_plans
      WHERE strategy_version=$1 AND (batch_id=$2 OR research_job_id=$3)`,[plan.strategy_version,batchId,jobId]);
    if(prior.rowCount){
      if(prior.rows[0].config_digest!==plan.config_digest||prior.rows[0].scope_digest!==plan.scope_digest)
        throw Object.assign(new Error('SEARCH_PLAN_VERSION_CONFLICT'),{status:409});
      return prior.rows[0].plan;
    }
    const inserted=await client.query(`INSERT INTO leadgen.research_query_plans
      (batch_id,research_job_id,strategy_version,scope_digest,config_digest,scope_snapshot,config_snapshot,plan)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[
      batchId,jobId,plan.strategy_version,plan.scope_digest,plan.config_digest,
      JSON.stringify(snapshot),JSON.stringify(this.config),JSON.stringify(plan)]);
    if(!inserted.rowCount){
      const existing=await client.query(`SELECT * FROM leadgen.research_query_plans
        WHERE strategy_version=$1 AND (batch_id=$2 OR research_job_id=$3)`,[plan.strategy_version,batchId,jobId]);
      if(!existing.rowCount||existing.rows[0].config_digest!==plan.config_digest||existing.rows[0].scope_digest!==plan.scope_digest)
        throw Object.assign(new Error('SEARCH_PLAN_VERSION_CONFLICT'),{status:409});
      return existing.rows[0].plan;
    }
    return plan;
  }
  async freezeBatch(client,batchId,snapshot,children) {
    await this.store(client,{batchId,snapshot});
    for(const {scope,child} of children)if(child.inserted){
      await this.store(client,{jobId:child.id,snapshot:{version:1,scopes:[scope]}});
    }
  }
  async forBatch(batch) {
    const saved=await this.pool.query('SELECT plan FROM leadgen.research_query_plans WHERE batch_id=$1 ORDER BY created_at,id LIMIT 1',[batch.batch_id||batch.id]);
    return saved.rowCount?this.present(saved.rows[0].plan,true):this.preview(batch.research_scope_snapshot);
  }
  async forJob(id) {
    const saved=await this.pool.query('SELECT plan FROM leadgen.research_query_plans WHERE research_job_id=$1 ORDER BY created_at,id LIMIT 1',[id]);
    if(saved.rowCount)return this.present(saved.rows[0].plan,true);
    // A reused child must retain its effective scope, never another batch's requested overrides.
    const job=await this.pool.query('SELECT * FROM leadgen.research_jobs WHERE id=$1',[id]);
    if(!job.rowCount)throw Object.assign(new Error('RESEARCH_JOB_NOT_FOUND'),{status:404});
    const j=job.rows[0];
    const scope={market_code:j.country_code,country_code:j.country_code,country_name:j.country_name||j.country,
      category_scope_id:j.target_category_scope_id||`legacy:${j.product_category}`,category_code:j.product_category,
      product_category:j.product_category,buyer_types:j.buyer_types||[],languages:j.preferred_language?[j.preferred_language]:[],
      preferred_language:j.preferred_language,city:j.city,region:j.region};
    return {...this.preview({version:1,scopes:[scope]}),scope_source:'LEGACY_STORED_JOB'};
  }
}
