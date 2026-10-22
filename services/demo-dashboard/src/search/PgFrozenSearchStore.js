import {randomUUID} from 'node:crypto';
import {normalizeSearchResult} from './resultNormalizer.js';
import {classifySearchResult} from './resultFilter.js';
import {evaluateDomainPolicy} from '../searchPlanning/domainPolicy.js';
import {SearchHitCorroborationService} from '../searchPlanning/SearchHitCorroborationService.js';
import {searchRequestFingerprint,providerCostUsd} from './SearchUsageAudit.js';

export class PgFrozenSearchStore {
 constructor({pool}={}){this.pool=pool;this.hits=new SearchHitCorroborationService({pool});}
 async load(jobId){return (await this.pool.query('SELECT * FROM leadgen.research_query_plans WHERE research_job_id=$1 ORDER BY created_at,id LIMIT 1',[jobId])).rows[0];}
 async lookup(plan,q){return (await this.pool.query(`SELECT * FROM leadgen.research_query_executions WHERE research_query_plan_id=$1 AND query_fingerprint=$2 ORDER BY CASE WHEN status IN('PERSISTED','NOT_FOUND') THEN 0 WHEN status='PROVIDER_COMPLETED' AND response_snapshot IS NOT NULL THEN 1 WHEN status IN('CLAIMED','REVIEW_REQUIRED','FAILED','TEMPORARY_ERROR') THEN 2 ELSE 3 END,updated_at DESC,created_at DESC,id DESC LIMIT 1`,[plan.id,q.fingerprint])).rows[0];}
 request(plan,q){
  const scope=plan.scope_snapshot.scopes.find(s=>(s.market_code||s.country_code)===q.market_id&&(s.category_scope_id||s.category_id)===q.category_id);
  return {query:q.normalized_query,count:Math.min(20,Number(scope?.max_results)||10),country:q.market_id,countryName:scope?.country_name,searchLang:q.language};
 }
 async claim(plan,q,selection,reason=selection.reason){
  const request=this.request(plan,q);
  return (await this.pool.query(`INSERT INTO leadgen.research_query_executions
   (research_query_plan_id,research_job_id,query_fingerprint,provider,purpose,status,request_snapshot,selection_reason,claim_token,claimed_by,attempt_count,started_at,lease_expires_at)
   VALUES($1,$2,$3,$4,$5,'CLAIMED',$6::jsonb,$7,$8,'frozen-plan-worker',1,now(),now()+interval '5 minutes')
   ON CONFLICT(research_query_plan_id,query_fingerprint,provider) DO UPDATE SET status='CLAIMED',claim_token=EXCLUDED.claim_token,attempt_count=research_query_executions.attempt_count+1,started_at=now(),lease_expires_at=EXCLUDED.lease_expires_at,updated_at=now()
   WHERE research_query_executions.status IN('RATE_LIMITED','AUTH_ERROR','PENDING') AND (research_query_executions.retry_after_at IS NULL OR research_query_executions.retry_after_at<=now()) RETURNING *`,
   [plan.id,plan.research_job_id,q.fingerprint,selection.provider.toUpperCase(),q.provider_purpose,JSON.stringify(request),reason,randomUUID()])).rows[0];
 }
 // A completed execution of the same query text, market, language and provider in another
 // plan, recent enough to reuse and holding at least as many results as this request needs.
 async findReusable(plan,q,selection,{days=30}={}){
  const request=this.request(plan,q);
  return (await this.pool.query(`SELECT e.* FROM leadgen.research_query_executions e
   WHERE e.provider=$1 AND e.status IN('PERSISTED','NOT_FOUND') AND e.response_snapshot IS NOT NULL
     AND lower(e.request_snapshot->>'query')=lower($2) AND upper(coalesce(e.request_snapshot->>'country','ALL'))=upper($3)
     AND coalesce(e.request_snapshot->>'searchLang','en')=$4 AND coalesce((e.request_snapshot->>'count')::int,10)>=$5
     AND e.research_query_plan_id<>$6 AND e.provider_completed_at>=now()-make_interval(days=>$7::int)
   ORDER BY e.provider_completed_at DESC,e.id DESC LIMIT 1`,
   [selection.provider.toUpperCase(),request.query,request.country,request.searchLang||'en',request.count,plan.id,Math.max(1,Math.floor(days))])).rows[0]||null;
 }
 // Reuse is recorded as a zero-cost SKIPPED usage event; earlier ledger rows are never changed.
 async reuse(plan,q,selection,source){
  const execution=await this.claim(plan,q,selection,'CROSS_RUN_REUSE');
  if(!execution)return null;
  const results=(source.response_snapshot?.results||[]).slice(0,Number(execution.request_snapshot?.count)||10);
  const event=(await this.pool.query(`INSERT INTO leadgen.provider_usage_events
   (research_job_id,provider,billing_period,endpoint,request_fingerprint,status,used_units,budget_pool,result_payload,completed_at)
   VALUES($1,$2,to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),'cross-run-reuse',$3,'SKIPPED',0,'DISCOVERY',$4::jsonb,now()) RETURNING id`,
   [plan.research_job_id,execution.provider,`reuse:${execution.id}:${execution.claim_token}`,JSON.stringify({audit:{
    purpose:'NEW_COMPANY_DISCOVERY',usage_group:'DISCOVERY',reuse:true,reused_from_execution_id:source.id,
    reused_from_usage_event_id:source.provider_usage_event_id||null,result_count:results.length,provider_used_units:0,provider_cost_usd:0}})])).rows[0];
  const snapshot={results,credits:0,requestId:null,costDollars:{total:0},reused_from_execution_id:source.id};
  const updated=(await this.pool.query(`UPDATE leadgen.research_query_executions SET status='PROVIDER_COMPLETED',response_snapshot=$2::jsonb,
   provider_completed_at=$3,provider_usage_event_id=$4,updated_at=now() WHERE id=$1 AND claim_token=$5 RETURNING *`,
   [execution.id,JSON.stringify(snapshot),source.provider_completed_at,event.id,execution.claim_token])).rows[0];
  if(!updated)return null;
  await this.persist(plan,q,updated,{results});
  return {execution_id:updated.id,usage_event_id:event.id,reused_from_execution_id:source.id,result_count:results.length};
 }
 async recordResponse(execution,response){
  const safe={results:(response.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.snippet,rank:r.rank,provider_score:r.provider_score})),credits:response.credits||0,requestId:response.requestId||null,costDollars:response.costDollars||null};
  const fingerprint=searchRequestFingerprint({provider:execution.provider,researchJobId:execution.research_job_id,purpose:'NEW_COMPANY_DISCOVERY',request:execution.request_snapshot});
  await this.pool.query(`UPDATE leadgen.research_query_executions SET status='PROVIDER_COMPLETED',response_snapshot=$2::jsonb,provider_completed_at=now(),provider_usage_event_id=(SELECT id FROM leadgen.provider_usage_events WHERE provider=$4 AND request_fingerprint=$5),updated_at=now() WHERE id=$1 AND claim_token=$3`,[execution.id,JSON.stringify(safe),execution.claim_token,execution.provider,fingerprint]);
 }
 async persist(plan,q,execution,response){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[plan.research_job_id]);
   const saved=(await client.query('SELECT * FROM leadgen.research_query_executions WHERE id=$1 FOR UPDATE',[execution.id])).rows[0];
   const scope=plan.scope_snapshot.scopes.find(s=>(s.market_code||s.country_code)===q.market_id&&(s.category_scope_id||s.category_id)===q.category_id);
   const queryRow=(await client.query(`INSERT INTO leadgen.research_search_queries (research_job_id,query_text,query_type,country,product_category,buyer_type,provider,status,result_count,executed_at)
    VALUES($1,$2,'buyer_category',$3,$4,$5,$6,'COMPLETED',$7,$8)
    ON CONFLICT(research_job_id,query_text) WHERE company_id IS NULL DO UPDATE SET status='COMPLETED' RETURNING id`,[plan.research_job_id,q.normalized_query,scope.country_name,scope.category_code||scope.product_category,q.buyer_type,execution.provider.toLowerCase(),(response.results||[]).length,saved.provider_completed_at])).rows[0];
   const refs=[];
   for(const raw of response.results||[]){
    const observed=saved.provider_completed_at;
    const item=normalizeSearchResult(raw,{provider:execution.provider,capturedAt:observed});
    if(!item||!evaluateDomainPolicy(item.url,{config:plan.config_snapshot.domainPolicy}).keep)continue;
    let candidate=(await client.query('SELECT id FROM leadgen.research_candidates WHERE research_job_id=$1 AND normalized_url=$2 ORDER BY id LIMIT 1',[plan.research_job_id,item.normalized_url])).rows[0];
    const classified=classifySearchResult(item);
    if(!candidate)candidate=(await client.query(`INSERT INTO leadgen.research_candidates
     (research_job_id,provider,title,url,normalized_url,root_domain,snippet,provider_score,rank,candidate_type,candidate_status,captured_at,search_query_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
     [plan.research_job_id,item.provider.toLowerCase(),item.title,item.url,item.normalized_url,item.root_domain,item.snippet,item.provider_score,item.rank,classified.candidate_type,classified.candidate_status,observed,queryRow.id])).rows[0];
    await client.query('INSERT INTO leadgen.research_candidate_queries(research_candidate_id,research_search_query_id,rank) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[candidate.id,queryRow.id,item.rank]);
    await this.hits.record({research_candidate_id:candidate.id,query_fingerprint:q.fingerprint,strategy_version:q.strategy_version,strategy_id:q.strategy_id,lane:q.lane,provider:execution.provider,rank:item.rank,market_id:q.market_id,category_id:q.category_id,language:q.language,observed_at:observed},client);
    refs.push(candidate.id);
   }
   await client.query(`UPDATE leadgen.research_query_executions SET status=$2,reference_ids=$3::text[],result_count=$4,persisted_at=now(),completed_at=now(),updated_at=now() WHERE id=$1`,[execution.id,(response.results||[]).length?'PERSISTED':'NOT_FOUND',refs,(response.results||[]).length]);
   if(saved.provider_usage_event_id&&!saved.response_snapshot?.reused_from_execution_id)await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,used_units=$3,completed_at=now(),result_payload=jsonb_set(coalesce(result_payload,'{}'::jsonb),'{audit}',coalesce(result_payload->'audit','{}'::jsonb)||$4::jsonb) WHERE id=$1`,[saved.provider_usage_event_id,(response.results||[]).length?'COMPLETED':'NOT_FOUND',Number(saved.response_snapshot?.credits||0),JSON.stringify({result_count:(response.results||[]).length,results:saved.response_snapshot?.results||response.results||[],reference_ids:refs,provider_used_units:Number(saved.response_snapshot?.credits||0),provider_cost_usd:providerCostUsd(saved.response_snapshot?.costDollars??response.costDollars)})]);
   await client.query(`UPDATE leadgen.research_jobs SET candidates_found=(SELECT count(*) FROM leadgen.research_candidates WHERE research_job_id=$1) WHERE id=$1`,[plan.research_job_id]);
   await client.query('COMMIT');return refs;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async results(execution){return (await this.pool.query('SELECT title,url,snippet,rank,provider_score FROM leadgen.research_candidates WHERE id::text=ANY($1::text[])',[execution.reference_ids||[]])).rows;}
 async attachUsage(execution,event){if(event?.id)await this.pool.query('UPDATE leadgen.research_query_executions SET provider_usage_event_id=$2,updated_at=now() WHERE id=$1',[execution.id,event.id]);}
 async fail(execution,error){
  const code=String(error.code||'SEARCH_ERROR');
  const status=/RATE_LIMIT|CREDIT_EXHAUSTED|PROVIDER_CREDIT_EXHAUSTED/.test(code)?'RATE_LIMITED':/AUTH|API_KEY/.test(code)?'AUTH_ERROR':'REVIEW_REQUIRED';
  await this.pool.query(`UPDATE leadgen.research_query_executions SET status=CASE WHEN response_snapshot IS NOT NULL THEN 'REVIEW_REQUIRED' ELSE $2 END,last_error_code=$3,completed_at=now(),retry_after_at=now()+($4::int*interval '1 second'),updated_at=now() WHERE id=$1 AND status NOT IN('PERSISTED','NOT_FOUND')`,[execution.id,status,code.slice(0,120),Math.max(1,Math.min(86400,Number(error.retryAfterSeconds)||60))]);
 }
}
