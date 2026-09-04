import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { createSearchProvider } from '../search/discoveryService.js';
import { TavilyUsageAudit } from '../search/TavilyUsageAudit.js';
import { WebsiteReachabilityChecker } from '../contact/WebsiteReachabilityChecker.js';
import { domainService } from '../platform/DomainService.js';
import { getMarketProfile } from '../market/marketProfiles.js';
import { normalizeProductObservation } from '../productMatch/productTaxonomy.js';
import { extractCategoryBuyerObservations } from './categoryObservationExtractor.js';

const clean=(value,max=2000)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const upper=value=>String(value||'').trim().toUpperCase();
const unique=(items,key)=>{const seen=new Set();return(items||[]).filter(item=>{const value=key(item);if(!value||seen.has(value))return false;seen.add(value);return true;});};

function fallbackTerms(market,profile){return {category:market.productDiscoveryTerms?.[profile]||[],directBuyer:[...(market.retailTerms||[]),...(market.departmentStoreTerms||[]),...(market.supermarketTerms||[])],distribution:[...(market.importerTerms||[]),...(market.wholesalerTerms||[]),...(market.distributorTerms||[])],exclusion:['sourcing agent','broker','OEM-only manufacturer']};}
function queryType(group,term){const value=String(term).toLowerCase();if(group==='category')return'category_assortment';if(group==='directBuyer')return/store|tienda|retail|minorista/.test(value)?'store_network':'retail_channel';if(group==='exclusion')return'intermediary_exclusion';if(/warehouse|almac[eé]n|inventory/.test(value))return'inventory_warehouse';if(/import/.test(value))return'import_activity';if(/wholesale|mayor/.test(value))return'wholesale_activity';return'distribution_network';}

export function buildCategoryBuyerDiscoveryQueries({company={},product_profile,market_profile=null,max_queries=4}={}){
  const profile=upper(product_profile);const market=market_profile||getMarketProfile(company.country_code,company.country_name);const configured=market.categoryBuyerDiscoveryTerms?.[profile];
  const terms=configured&&typeof configured==='object'?configured:fallbackTerms(market,profile);const domain=String(company.official_root_domain||company.normalized_domain||'').trim();const name=clean(company.company_name||company.name,240);
  const rows=[];for(const group of ['category','directBuyer','distribution','exclusion'])for(const term of terms[group]||[]){const query=domain?`site:${domain} ${term}`:`"${name}" ${term}`;rows.push({query,query_text:query,query_type:queryType(group,term),product_profile:profile,term_group:group});}
  const selected=[];for(const group of ['category','directBuyer','distribution','exclusion']){const item=rows.find(row=>row.term_group===group);if(item)selected.push(item);}
  for(const row of rows)if(selected.length<Math.max(1,Math.min(8,Number(max_queries)||4))&&!selected.some(item=>item.query===row.query))selected.push(row);
  return selected.slice(0,Math.max(1,Math.min(8,Number(max_queries)||4)));
}

function discoverLinks(html,baseUrl){const $=cheerio.load(String(html||''));const pattern=/product|categor|collection|brand|store|location|wholesale|distribut|import|warehouse|supplier|tienda|marca|mayor|almac[eé]n/i;
  return unique($('a[href]').map((_i,node)=>{try{const url=new URL($(node).attr('href'),baseUrl);return pattern.test(`${$(node).text()} ${url.pathname}`)?url.href:null;}catch{return null;}}).get().filter(Boolean),String).slice(0,30);}
function authorityFor(url){const pathname=new URL(url).pathname.toLowerCase();if(/\.pdf$|report|supplier/.test(pathname))return'OFFICIAL_DOCUMENT';if(/catalog/.test(pathname))return'OFFICIAL_CATALOG';if(/shop|store|tienda|product|categor|collection|brand/.test(pathname))return'OFFICIAL_STOREFRONT';return'OFFICIAL';}

export class CategoryEvidenceService{
  constructor({pool,searchConfig={},crawlerConfig={},provider=null,checker=null,searchAudit=null,tavilyUsageConfig={},maxQueriesPerProfile=4,maxQueriesPerCompany=8,maxPagesPerCompany=12,maxDiscoveryDepth=2}={}){
    if(!pool)throw new Error('CategoryEvidenceService requires a PostgreSQL pool');this.pool=pool;this.provider=provider||createSearchProvider(searchConfig);
    this.searchAudit=searchAudit||new TavilyUsageAudit({provider:this.provider,pool,...tavilyUsageConfig});
    this.checker=checker||new WebsiteReachabilityChecker({...crawlerConfig,blockedDomains:['linkedin.com']});this.maxQueriesPerProfile=Math.max(1,Math.min(4,Number(maxQueriesPerProfile)||4));
    this.maxQueriesPerCompany=Math.max(1,Math.min(8,Number(maxQueriesPerCompany)||8));this.maxPagesPerCompany=Math.max(1,Math.min(12,Number(maxPagesPerCompany)||12));this.maxDiscoveryDepth=Math.max(0,Math.min(2,Number(maxDiscoveryDepth)||2));
  }
  async findFreshReusableEvidence(companyId,productProfile,sourceTtlDays){const ttl=Math.max(1,Math.min(3650,Number(sourceTtlDays)||90));const result=await this.pool.query(`WITH eligible AS (
      SELECT s.research_job_id,s.id source_id,o.id observation_id,s.captured_at
      FROM leadgen.prospect_category_sources s JOIN leadgen.prospect_category_observations o ON o.source_id=s.id
      WHERE s.company_id=$1 AND o.normalized_profile=$2 AND s.content_fetched=true
        AND s.fetch_status='FETCHED' AND s.verification_status='VERIFIED' AND o.verification_status='VERIFIED'
        AND s.captured_at>=now()-($3::int*interval '1 day')
    ) SELECT research_job_id,source_id,observation_id,
      (SELECT count(DISTINCT source_id)::int FROM eligible) sources,
      (SELECT count(DISTINCT observation_id)::int FROM eligible) observations
      FROM eligible ORDER BY captured_at DESC,source_id DESC LIMIT 1`,[companyId,upper(productProfile),ttl]);return result.rows[0]||null;}
  async persistSource({researchJobId,companyId,url,sourceType,authority,capturedAt,pageTitle=null,publishedAt=null,contentFetched=true,fetchStatus='FETCHED',verificationStatus='VERIFIED'}){
    const normalized=domainService.normalizeUrl(url)||url;const evidenceHash=sha(`${normalized}|${authority}`);const saved=await this.pool.query(`INSERT INTO leadgen.prospect_category_sources
      (research_job_id,company_id,source_url,source_type,source_authority,page_title,captured_at,published_at,evidence_hash,content_fetched,fetch_status,verification_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(research_job_id,company_id,evidence_hash)
      DO UPDATE SET captured_at=GREATEST(leadgen.prospect_category_sources.captured_at,EXCLUDED.captured_at) RETURNING *`,[researchJobId,companyId,normalized,sourceType,authority,pageTitle,capturedAt,publishedAt,evidenceHash,contentFetched,fetchStatus,verificationStatus]);return saved.rows[0];
  }
  async persistObservation(source,item){const verification=source.source_authority==='SEARCH_DISCOVERY'?'REVIEW':item.verification_status||'REVIEW';const saved=await this.pool.query(`INSERT INTO leadgen.prospect_category_observations
      (research_job_id,company_id,source_id,observation_type,raw_category,raw_product_name,raw_brand_or_department,normalized_profile,normalized_category,normalized_subcategory,business_activity_role,evidence_text,source_authority,verification_status,captured_at,published_at,evidence_hash,extraction_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT(source_id,evidence_hash) DO NOTHING RETURNING id`,[source.research_job_id,source.company_id,source.id,item.observation_type,item.raw_category||null,item.raw_product_name||null,item.raw_brand_or_department||null,item.normalized_profile||'UNKNOWN',item.normalized_category||null,item.normalized_subcategory||null,item.business_activity_role||'UNKNOWN',clean(item.evidence_text),source.source_authority,verification,item.captured_at||source.captured_at,item.published_at||source.published_at,item.evidence_hash,item.extraction_version]);return saved.rowCount;}
  async backfillPhase4Evidence(researchJobId,companyId,productProfile){const result=await this.pool.query(`SELECT source_url,source_type,source_page_title,evidence_value,evidence_text,captured_at FROM leadgen.company_verification_evidence
      WHERE company_id=$1 AND evidence_type='PRODUCT_CATEGORY' AND source_url ~ '^https?://' ORDER BY captured_at,id`,[companyId]);let sources=0,observations=0;
    for(const row of result.rows){const isOfficial=upper(row.source_type)==='OFFICIAL_WEBSITE';const source=await this.persistSource({researchJobId,companyId,url:row.source_url,sourceType:'PHASE4_PRODUCT_CATEGORY',authority:isOfficial?'OFFICIAL':'OTHER_PUBLIC',capturedAt:row.captured_at,pageTitle:row.source_page_title,verificationStatus:isOfficial?'VERIFIED':'REVIEW'});sources+=1;const normalized=normalizeProductObservation({raw_category:row.evidence_value});
      observations+=await this.persistObservation(source,{observation_type:'PRODUCT_CATEGORY',raw_category:row.evidence_value,normalized_profile:normalized.normalized_profile,normalized_category:normalized.normalized_category,normalized_subcategory:normalized.normalized_subcategory,business_activity_role:'UNKNOWN',evidence_text:row.evidence_text,evidence_hash:sha(`${source.id}|${row.evidence_value}|${row.evidence_text}`),extraction_version:'phase4-category-backfill-v1',verification_status:isOfficial&&['CONFIRMED','SUPPORTED'].includes(normalized.assignment_status)?'VERIFIED':'REVIEW'});}return{sources,observations};}
  async collect({researchJobId,companyId,productProfile,tavilyEnabled=true,reuseFreshEvidence=false,sourceTtlDays=90,strategy=null}){
    const found=await this.pool.query(`SELECT id,company_name,country_code,country_name,website_url,official_root_domain,normalized_domain FROM leadgen.companies WHERE id=$1`,[companyId]);if(!found.rowCount)throw new Error('Company not found');const company=found.rows[0];
    if(reuseFreshEvidence){const fresh=await this.findFreshReusableEvidence(companyId,productProfile,sourceTtlDays);if(fresh)return{reused_fresh_evidence:true,reused_research_job_id:fresh.research_job_id,prospect_category_source_id:fresh.source_id,prospect_category_observation_id:fresh.observation_id,sources:Number(fresh.sources||0),observations:Number(fresh.observations||0),queries:0,search_skipped:true,search_failures:0,pages_fetched:0,observations_inserted:0,timeouts:0,partials:0};}
    const market=getMarketProfile(company.country_code,company.country_name);const root=company.official_root_domain||domainService.getRegistrableDomain(company.website_url);const queries=strategy?.query_text?[{query:strategy.query_text,query_text:strategy.query_text,query_type:strategy.query_type||'auto_evidence_strategy',product_profile:upper(productProfile),term_group:'strategy'}]:buildCategoryBuyerDiscoveryQueries({company,product_profile:productProfile,market_profile:market,max_queries:this.maxQueriesPerProfile});const urls=[];if(company.website_url)urls.push({url:company.website_url,depth:0});let failures=0;
    const backfill=await this.backfillPhase4Evidence(researchJobId,companyId,productProfile);
    const searchEnabled=tavilyEnabled||String(this.provider.name||'').toLowerCase()!=='tavily';
    for(const query of searchEnabled?queries.slice(0,this.maxQueriesPerCompany):[]){const stored=await this.pool.query(`INSERT INTO leadgen.research_search_queries
        (research_job_id,company_id,query_text,query_type,country,country_code,country_name,preferred_language,market_profile,product_category,provider,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING') ON CONFLICT(research_job_id,company_id,query_text) WHERE company_id IS NOT NULL DO UPDATE SET provider=EXCLUDED.provider RETURNING *`,[researchJobId,companyId,query.query_text,query.query_type,company.country_name||company.country_code,company.country_code,company.country_name||company.country_code,market.defaultLanguage,market.profileKey,upper(productProfile),this.provider.name]);
      try{const response=await this.searchAudit.search({researchJobId,companyId,productProfile,purpose:'CATEGORY_BUYER_EVIDENCE',request:{query:query.query_text,count:5,country:company.country_code,countryName:company.country_name},
        persistResults:async results=>{const referenceIds=[];for(const item of results){const source=await this.persistSource({researchJobId,companyId,url:item.url,sourceType:'SEARCH_RESULT_HINT',authority:'SEARCH_DISCOVERY',capturedAt:new Date(),pageTitle:item.title,contentFetched:false,fetchStatus:'NOT_FETCHED',verificationStatus:'REVIEW'});referenceIds.push(source.id);}return{referenceIds};},
        loadPersistedResults:async({referenceIds})=>{const params=[researchJobId,companyId];let filter="AND source_type='SEARCH_RESULT_HINT'";if(referenceIds.length){params.push(referenceIds);filter='AND id=ANY($3::uuid[])';}const result=await this.pool.query(`SELECT id,source_url,page_title FROM leadgen.prospect_category_sources WHERE research_job_id=$1 AND company_id=$2 ${filter} ORDER BY captured_at,id`,params);return result.rows.map((row,index)=>({title:row.page_title||'',url:row.source_url,snippet:'',provider_score:null,rank:index+1}));}
      });await this.pool.query(`UPDATE leadgen.research_search_queries SET status='COMPLETED',result_count=$2,executed_at=now(),error_message=NULL WHERE id=$1`,[stored.rows[0].id,response.result_count??response.results.length]);
        for(const item of response.results)if(root&&domainService.getRegistrableDomain(item.url)===root)urls.push({url:item.url,depth:0});}
      catch(error){if(['TAVILY_CREDIT_CAP','PROVIDER_CREDIT_EXHAUSTED','PROVIDER_AUTH_ERROR'].includes(error?.code)||error?.retryable===true)throw error;failures+=1;await this.pool.query(`UPDATE leadgen.research_search_queries SET status='FAILED',error_message=$2,executed_at=now() WHERE id=$1`,[stored.rows[0].id,clean(error.message,500)]);}}
    const queue=unique(urls,item=>domainService.normalizeUrl(item.url)||item.url);const seen=new Set();let pages_fetched=0,observations=0,timeouts=0,partials=0;
    while(queue.length&&pages_fetched<this.maxPagesPerCompany){const next=queue.shift();const normalized=domainService.normalizeUrl(next.url)||next.url;if(seen.has(normalized)||!root||domainService.getRegistrableDomain(normalized)!==root||/linkedin\.com$/i.test(root))continue;seen.add(normalized);
      try{if(!await this.checker.robotsAllows(normalized)){partials+=1;continue;}const page=await this.checker.fetchPage(normalized,{robotsAllowed:true});if(!page.reachable||!page.html){page.fetch_status==='TIMEOUT'?timeouts+=1:partials+=1;continue;}const finalUrl=page.final_url||normalized;if(domainService.getRegistrableDomain(finalUrl)!==root){partials+=1;continue;}const authority=authorityFor(finalUrl);const source=await this.persistSource({researchJobId,companyId,url:finalUrl,sourceType:authority,authority,capturedAt:page.captured_at||new Date(),pageTitle:page.page_title,verificationStatus:'VERIFIED'});pages_fetched+=1;
        const extracted=extractCategoryBuyerObservations({html:page.html,source_url:finalUrl,source_authority:authority,captured_at:source.captured_at,company_name:company.company_name,product_profile:upper(productProfile)});for(const item of extracted)observations+=await this.persistObservation(source,item);if(next.depth<this.maxDiscoveryDepth)for(const link of discoverLinks(page.html,finalUrl))queue.push({url:link,depth:next.depth+1});}
      catch(error){error?.code==='TIMEOUT'?timeouts+=1:partials+=1;}}
    const counts=await this.pool.query(`SELECT (SELECT count(*)::int FROM leadgen.prospect_category_sources WHERE research_job_id=$1 AND company_id=$2)sources,(SELECT count(*)::int FROM leadgen.prospect_category_observations WHERE research_job_id=$1 AND company_id=$2)observations`,[researchJobId,companyId]);
    return {...backfill,queries:searchEnabled?queries.length:0,search_skipped:!searchEnabled,search_failures:failures,pages_fetched,observations_inserted:observations,timeouts,partials,...counts.rows[0]};
  }
}
