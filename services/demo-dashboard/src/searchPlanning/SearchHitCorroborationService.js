const text=value=>String(value??'').trim();
const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeSearchHit(input={}) {
 const hit={research_candidate_id:text(input.research_candidate_id),query_fingerprint:text(input.query_fingerprint).toLowerCase(),
  strategy_version:text(input.strategy_version),strategy_id:text(input.strategy_id),lane:text(input.lane),provider:text(input.provider).toLowerCase(),
  rank:Number(input.rank),market_id:text(input.market_id).toUpperCase(),category_id:text(input.category_id),language:text(input.language).toLowerCase()};
 if(!uuid.test(hit.research_candidate_id)||!/^[0-9a-f]{64}$/.test(hit.query_fingerprint)
  ||!['PRECISION_LANE','COVERAGE_LANE'].includes(hit.lane)||!Number.isInteger(hit.rank)||hit.rank<1
  ||['strategy_version','strategy_id','provider','market_id','category_id','language'].some(k=>!hit[k]||hit[k].length>240))throw fail('SEARCH_HIT_INVALID');
 // A real hit must supply its observation time; missing times are never invented.
 const date=new Date(input.observed_at);if(!input.observed_at||Number.isNaN(date.getTime()))throw fail('SEARCH_HIT_OBSERVATION_TIME_REQUIRED');
 hit.observed_at=date.toISOString();return hit;
}

export class SearchHitCorroborationService {
 constructor({pool}={}){if(!pool)throw new TypeError('SearchHitCorroborationService requires a PostgreSQL pool');this.pool=pool;}
 async record(input,queryable=this.pool){
  const hit=normalizeSearchHit(input);
  const candidate=(await queryable.query(`SELECT c.root_domain,v.company_id FROM leadgen.research_candidates c
   LEFT JOIN leadgen.research_candidate_verifications v ON v.research_candidate_id=c.id AND v.verification_status='VERIFIED_BUSINESS'
   WHERE c.id=$1`,[hit.research_candidate_id])).rows[0];
  if(!candidate)throw fail('SEARCH_HIT_CANDIDATE_NOT_FOUND',404);
  const rootDomain=text(candidate.root_domain).toLowerCase().replace(/^www\./,'');
  if(!rootDomain)throw fail('SEARCH_HIT_DOMAIN_REQUIRED');
  const values=[hit.research_candidate_id,candidate.company_id||null,rootDomain,hit.query_fingerprint,hit.strategy_version,
   hit.strategy_id,hit.lane,hit.provider,hit.rank,hit.market_id,hit.category_id,hit.language,hit.observed_at];
  const result=await queryable.query(`INSERT INTO leadgen.research_search_hit_provenance AS existing
   (research_candidate_id,company_id,root_domain,query_fingerprint,strategy_version,strategy_id,lane,provider,rank,market_id,category_id,language,first_seen,last_seen)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
   ON CONFLICT(research_candidate_id,query_fingerprint,provider) DO UPDATE
   SET first_seen=least(existing.first_seen,EXCLUDED.first_seen),last_seen=greatest(existing.last_seen,EXCLUDED.last_seen),rank=least(existing.rank,EXCLUDED.rank)
   WHERE existing.strategy_version=EXCLUDED.strategy_version AND existing.strategy_id=EXCLUDED.strategy_id
    AND existing.lane=EXCLUDED.lane AND existing.market_id=EXCLUDED.market_id AND existing.category_id=EXCLUDED.category_id
    AND existing.language=EXCLUDED.language AND existing.root_domain=EXCLUDED.root_domain
   RETURNING *`,values);
  if(!result.rowCount)throw fail('SEARCH_HIT_FINGERPRINT_CONFLICT',409);
  return result.rows[0];
 }
 async projection({company_id=null,root_domain=null}={}){
  if(company_id&&!uuid.test(company_id))throw fail('SEARCH_HIT_COMPANY_INVALID');
  const where=[],values=[];
  if(company_id){values.push(company_id);where.push(`company_id=$${values.length}`);}
  if(root_domain){values.push(text(root_domain).toLowerCase().replace(/^www\./,''));where.push(`$${values.length}=ANY(root_domains)`);}
  return (await this.pool.query(`SELECT * FROM leadgen.search_discovery_corroboration ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY identity_key`,values)).rows;
 }
}
