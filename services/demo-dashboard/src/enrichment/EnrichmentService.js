import { createHash } from 'node:crypto';
import { createSearchProvider } from '../search/discoveryService.js';
import { TavilyUsageAudit } from '../search/TavilyUsageAudit.js';
import { WebsiteReachabilityChecker } from '../contact/WebsiteReachabilityChecker.js';
import { extractPublicContacts } from '../contact/ContactExtractor.js';
import { domainService } from '../platform/DomainService.js';
import { getMarketProfile } from '../market/marketProfiles.js';
import { productScopeForCategory } from '../market/productProfiles.js';
import { generateDecisionMakerQueries } from './decisionMakerQueryGenerator.js';
import { discoverProcurementLinks, extractProcurementPage } from './procurementExtractor.js';
import { CooperationFeasibilityEngine, targetFitBand } from './cooperationFeasibilityEngine.js';
import { HunterProvider } from './HunterProvider.js';
import { LinkedInDiscoveryAdapter } from './LinkedInDiscoveryAdapter.js';
import { normalizedIdentity, normalizeDecisionRole, productRoleRelevance, roleRelevance } from './roleNormalizer.js';

const clean = (value,max=1000) => String(value || '').replace(/\s+/g,' ').trim().slice(0,max);
const nowIso = () => new Date().toISOString();
const isHunterBudgetError = error => ['HUNTER_CREDIT_CAP','HUNTER_DAILY_CREDIT_CAP'].includes(String(error?.code||''));

function unique(items,keyFn) {
  const seen = new Set();
  return items.filter(item=>{
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function sha(...parts) {
  return createHash('sha256').update(parts.map(value=>String(value || '')).join('|')).digest('hex');
}

export function inferCompanyProductProfiles(company) {
  const values = Array.isArray(company.product_categories) ? company.product_categories : [];
  const profiles = new Set();
  for (const value of values) {
    const mapped = productScopeForCategory(value);
    if (mapped) profiles.add(mapped);
    const text = String(value || '');
    if (/女装|连衣|上衣|半身裙|裤装|套装|外套|针织|内搭|women|apparel|fashion|dress|skirt/i.test(text)) profiles.add('WOMENSWEAR');
    if (/日用|百货|家居|家用|home|household|general merchandise|daily.use|non.food/i.test(text)) profiles.add('GENERAL_MERCHANDISE');
  }
  return [...profiles].filter(value=>['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(value));
}

function contactType(contact) {
  if (contact.contact_type === 'WHATSAPP') return 'BUSINESS_WHATSAPP';
  if (contact.contact_type === 'CONTACT_FORM') return 'CONTACT_FORM';
  if (contact.contact_type === 'PHONE') return 'BUSINESS_PHONE';
  if (contact.contact_type !== 'EMAIL') return 'OTHER_BUSINESS_ROUTE';
  const local = String(contact.normalized_value || '').split('@')[0].toLowerCase();
  if (/^(procurement|purchasing|buying|buyers?|supplier|vendors?|sourcing|compras|proveedores)([._+-]|$)/.test(local)) return 'DEPARTMENT_EMAIL';
  if (/^(info|contact|hello|sales|support|office|admin|enquiries|inquiries)([._+-]|$)/.test(local)) return 'GENERIC_BUSINESS_EMAIL';
  return 'BUSINESS_EMAIL';
}

function mapObservedContact(contact) {
  const type = contactType(contact);
  return {
    contact_type:type,
    contact_value_raw:clean(contact.contact_value,1000),
    contact_value_normalized:clean(contact.normalized_value || contact.contact_value,1000),
    evidence_origin:'OFFICIAL_SITE_OBSERVED',
    verification_status:type === 'BUSINESS_WHATSAPP' ? 'BUSINESS_WHATSAPP_OBSERVED'
      : type === 'BUSINESS_PHONE' ? 'FORMAT_VALID'
        : ['CONTACT_FORM','SUPPLIER_PORTAL','VENDOR_REGISTRATION'].includes(type) ? 'PUBLICLY_OBSERVED'
          : 'NOT_VERIFIED',
    verification_provider:type.includes('EMAIL') ? 'LOCAL_SYNTAX_DNS' : 'PUBLIC_PAGE',
    verification_score:null,
    last_verified_at:contact.captured_at || new Date(),
    source_url:contact.source_url,
    is_generic:type === 'GENERIC_BUSINESS_EMAIL',
    is_department:['DEPARTMENT_EMAIL','SUPPLIER_PORTAL','VENDOR_REGISTRATION'].includes(type)
  };
}

export function boundedObservedContacts(pages, company) {
  const marketPrefix = ({ AE:'+971',MX:'+52' })[String(company.country_code || '').toUpperCase()] || '';
  const mapped = unique(pages.flatMap(page=>page.contacts || []).map(mapObservedContact),contact=>`${contact.contact_type}|${contact.contact_value_normalized}`);
  const order = new Map([
    ['DEPARTMENT_EMAIL',1],['BUSINESS_EMAIL',2],['GENERIC_BUSINESS_EMAIL',3],
    ['BUSINESS_WHATSAPP',4],['CONTACT_FORM',5],['BUSINESS_PHONE',6]
  ]);
  mapped.sort((a,b)=>{
    const aLocal = a.contact_type === 'BUSINESS_PHONE' && marketPrefix && a.contact_value_normalized.startsWith(marketPrefix) ? 0 : 1;
    const bLocal = b.contact_type === 'BUSINESS_PHONE' && marketPrefix && b.contact_value_normalized.startsWith(marketPrefix) ? 0 : 1;
    return (order.get(a.contact_type) || 99) - (order.get(b.contact_type) || 99) || aLocal-bLocal;
  });
  const limits = { DEPARTMENT_EMAIL:3,BUSINESS_EMAIL:4,GENERIC_BUSINESS_EMAIL:3,BUSINESS_WHATSAPP:3,CONTACT_FORM:3,BUSINESS_PHONE:3 };
  const counts = new Map();
  const phoneNumbers = new Set();
  return mapped.filter(contact=>{
    if (['BUSINESS_PHONE','BUSINESS_WHATSAPP'].includes(contact.contact_type)) {
      const phoneKey = String(contact.contact_value_normalized || contact.contact_value_raw || '').replace(/\D/g,'');
      if (!phoneKey || phoneNumbers.has(phoneKey) || phoneNumbers.size >= 3) return false;
      phoneNumbers.add(phoneKey);
    }
    const limit = limits[contact.contact_type] || 1;
    const used = counts.get(contact.contact_type) || 0;
    if (used >= limit) return false;
    counts.set(contact.contact_type,used+1);
    return true;
  }).slice(0,12);
}

function bestRelationship(company) {
  if (company.suppressed) return 'SUPPRESSED';
  if (company.existing_customer) return 'INTERNAL_EXISTING_CUSTOMER';
  if (company.historical_customer_id && Number(company.prior_activity_count || 0) > 0) return 'HISTORICAL_CONTACTED_LEAD';
  if (company.historical_customer_id) return 'HISTORICAL_CRM_LEAD';
  return 'NEW_PROSPECT';
}

function productFitState(companyProfiles,productProfile,managementMatch) {
  if (companyProfiles.includes(productProfile)) return 'HIGH';
  const band = targetFitBand(managementMatch);
  return band === 'HIGH' ? 'MEDIUM' : band;
}

export class EnrichmentService {
  constructor({
    pool, searchConfig = {}, crawlerConfig = {}, hunterConfig = {}, linkedInConfig = {},
    provider = null, checker = null, hunter = null, linkedIn = null, feasibilityEngine = null,
    searchAudit = null, tavilyUsageConfig = {},
    maxCompanies = 100, maxQueriesPerCompany = 5, maxPagesPerCompany = 6,
    providerTemporaryErrorThreshold = 3, audit = () => {}
  } = {}) {
    this.pool = pool;
    this.searchConfig = searchConfig;
    this.provider = provider || createSearchProvider(searchConfig);
    this.searchAudit = searchAudit || new TavilyUsageAudit({ provider:this.provider,pool,...tavilyUsageConfig });
    this.checker = checker || new WebsiteReachabilityChecker({ ...crawlerConfig,blockedDomains:['linkedin.com'] });
    this.hunter = hunter || new HunterProvider({ ...hunterConfig,pool });
    this.linkedIn = linkedIn || new LinkedInDiscoveryAdapter(linkedInConfig);
    this.feasibilityEngine = feasibilityEngine || new CooperationFeasibilityEngine();
    this.maxCompanies = Math.max(1,Math.min(200,Number(maxCompanies)||100));
    this.maxQueriesPerCompany = Math.max(1,Math.min(5,Number(maxQueriesPerCompany)||5));
    this.maxPagesPerCompany = Math.max(1,Math.min(10,Number(maxPagesPerCompany)||6));
    this.providerTemporaryErrorThreshold = Math.max(1,Math.min(10,Number(providerTemporaryErrorThreshold)||3));
    this.audit = audit;
  }

  async getJob(jobId) {
    const result = await this.pool.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1
      AND job_type IN('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH')`,[jobId]);
    return result.rows[0] || null;
  }

  async listEligibleCompanies(job) {
    const marketCodes = job.market_codes?.length ? job.market_codes : ['AE','MX'];
    const requestedIds = job.requested_company_ids?.length ? job.requested_company_ids : null;
    const params = [marketCodes];
    let requestedClause = '';
    if (requestedIds) { params.push(requestedIds); requestedClause=`AND c.id=ANY($${params.length}::uuid[])`; }
    const requestedLimit = Math.max(1,Math.min(this.maxCompanies,Number(job.max_results) || this.maxCompanies));
    params.push(requestedLimit);
    const result = await this.pool.query(`
      SELECT c.id,c.company_name,c.country_code,c.country_name,c.city,c.website_url,c.official_root_domain,
        c.normalized_domain,c.product_categories,c.company_size_band,c.partnership_accessibility,
        c.verification_status,c.lifecycle_status,c.last_verified_at,
        sr.final_score AS dpv_score,sr.tier,
        mr.match_score AS management_match,hmr.match_score AS mexico_historical_match,
        hc.id AS historical_customer_id,
        coalesce(hist.prior_activity_count,0) AS prior_activity_count,hist.latest_prior_activity,
        coalesce(existing.existing_customer,false) AS existing_customer,
        EXISTS (SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL) AS suppressed
      FROM leadgen.companies c
      LEFT JOIN LATERAL (SELECT * FROM leadgen.company_score_runs x WHERE x.company_id=c.id ORDER BY calculated_at DESC,id DESC LIMIT 1) sr ON true
      LEFT JOIN LATERAL (SELECT * FROM leadgen.customer_match_results x WHERE x.company_id=c.id AND x.reference_profile_type='MANAGEMENT_BASELINE' ORDER BY calculated_at DESC,id DESC LIMIT 1) mr ON true
      LEFT JOIN LATERAL (SELECT * FROM leadgen.customer_match_results x WHERE x.company_id=c.id AND x.reference_profile_type='HISTORICAL_CUSTOMER_ICP' ORDER BY calculated_at DESC,id DESC LIMIT 1) hmr ON true
      LEFT JOIN LATERAL (SELECT hcl.historical_customer_id FROM leadgen.historical_customer_company_links hcl
        WHERE hcl.company_id=c.id AND hcl.link_status='CONFIRMED' ORDER BY hcl.created_at DESC LIMIT 1) link ON true
      LEFT JOIN leadgen.historical_customers hc ON hc.id=link.historical_customer_id
      LEFT JOIN LATERAL (SELECT count(*)::integer prior_activity_count,max(a.activity_at) latest_prior_activity
        FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=hc.id) hist ON true
      LEFT JOIN LATERAL (SELECT bool_or(h.customer_role='INTERNAL_EXISTING_CUSTOMER') existing_customer
        FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
        WHERE l.company_id=c.id AND l.link_status='CONFIRMED') existing ON true
      WHERE c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND c.explicit_exclusion_reason IS NULL AND upper(c.country_code)=ANY($1::text[])
        AND coalesce(existing.existing_customer,false)=false
        AND NOT EXISTS (SELECT 1 FROM leadgen.company_suppressions sx
          WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
        ${requestedClause}
      ORDER BY c.country_code,c.company_name LIMIT $${params.length}`,params);
    const productScope = new Set(job.product_profiles?.length ? job.product_profiles : ['WOMENSWEAR','GENERAL_MERCHANDISE']);
    const requestedSingleProfile=requestedIds&&productScope.size===1?[...productScope][0]:null;
    const frozen = await this.pool.query(`SELECT company_id,product_profile FROM leadgen.research_job_cohort_items
      WHERE research_job_id=$1 ORDER BY selection_rank`,[job.id]);
    const frozenProfiles = new Map(frozen.rows.map(item=>[String(item.company_id),item.product_profile]));
    return result.rows.map(company=>({ ...company,active_product_profiles:frozenProfiles.has(String(company.id))
      ? [frozenProfiles.get(String(company.id))]
      : requestedSingleProfile ? [requestedSingleProfile]
      : inferCompanyProductProfiles(company).filter(value=>productScope.has(value)) }))
      .filter(company=>company.active_product_profiles.length);
  }

  async persistQuery(job,company,query) {
    const result = await this.pool.query(`INSERT INTO leadgen.research_search_queries
      (research_job_id,company_id,query_text,query_type,country,country_code,country_name,city,region,
       preferred_language,market_profile,product_category,buyer_type,provider,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,NULL,$12,'PENDING')
      ON CONFLICT (research_job_id,company_id,query_text) WHERE company_id IS NOT NULL
      DO UPDATE SET provider=EXCLUDED.provider
      RETURNING *`,[
      job.id,company.id,query.query_text,query.query_type,company.country_name || company.country_code,
      company.country_code,company.country_name || company.country_code,company.city || null,
      getMarketProfile(company.country_code,company.country_name).defaultLanguage,
      getMarketProfile(company.country_code,company.country_name).profileKey,
      company.active_product_profiles.join(' / '),this.provider.name
    ]);
    return result.rows[0];
  }

  async runSearchQueries(job,company,{tavilyEnabled=true,strategy=null}={}) {
    if(!tavilyEnabled&&String(this.provider.name||'').toLowerCase()==='tavily') {
      return {queries:0,results:[],failures:0,search_skipped:true};
    }
    const queries = strategy?.query_text?[{query_text:strategy.query_text,query_type:strategy.query_type||'auto_evidence_strategy'}]
      :generateDecisionMakerQueries(company,{ maxQueries:this.maxQueriesPerCompany });
    const results = [];
    let failures = 0;
    for (const query of queries) {
      const stored = await this.persistQuery(job,company,query);
      await this.pool.query(`UPDATE leadgen.research_search_queries SET status='RUNNING',error_message=NULL WHERE id=$1`,[stored.id]);
      try {
        const response = await this.searchAudit.search({ researchJobId:job.id,companyId:company.id,
          productProfile:company.active_product_profiles?.length===1?company.active_product_profiles[0]:null,
          purpose:'DECISION_MAKER_DISCOVERY',
          request:{ query:stored.query_text,count:5,country:company.country_code,countryName:company.country_name },
          persistResults:async results=>{const referenceIds=[];for(const item of results){const discovered=this.linkedIn.discoverReference({url:item.url,title:item.title,snippet:item.snippet,provider:this.provider.name,capturedAt:new Date()});const saved=await this.persistReference(job.id,company.id,discovered?{...discovered,discovered_via:`TAVILY_QUERY:${stored.id}`}:{platform:'PUBLIC_WEB',profile_url:item.url,profile_kind:'SEARCH_RESULT',title_hint:item.title,snippet_hint:item.snippet,discovered_via:`TAVILY_QUERY:${stored.id}`,verification_status:'REVIEW',evidence_strength:'DISCOVERY_HINT',content_fetched:false,captured_at:new Date()});if(saved?.id)referenceIds.push(saved.id);}return{referenceIds};},
          loadPersistedResults:async({referenceIds})=>{const params=[job.id,company.id];let filter='AND discovered_via=$3';if(referenceIds.length){params.push(referenceIds);filter='AND id=ANY($3::uuid[])';}else params.push(`TAVILY_QUERY:${stored.id}`);const found=await this.pool.query(`SELECT id,profile_url,title_hint,snippet_hint FROM leadgen.enrichment_public_references WHERE research_job_id=$1 AND company_id=$2 ${filter} ORDER BY captured_at,id`,params);return found.rows.map((row,index)=>({title:row.title_hint||'',url:row.profile_url,snippet:row.snippet_hint||'',provider_score:null,rank:index+1}));}
        });
        await this.pool.query(`UPDATE leadgen.research_search_queries SET status='COMPLETED',result_count=$2,executed_at=now() WHERE id=$1`,[stored.id,response.result_count??response.results.length]);
        results.push(...response.results.map(item=>({ ...item,query_id:stored.id,query_type:stored.query_type,provider:response.provider || this.provider.name })));
      } catch (error) {
        if(['TAVILY_CREDIT_CAP','PROVIDER_CREDIT_EXHAUSTED','PROVIDER_AUTH_ERROR'].includes(error?.code)||error?.retryable===true)throw error;
        failures += 1;
        await this.pool.query(`UPDATE leadgen.research_search_queries SET status='FAILED',result_count=0,error_message=$2,executed_at=now() WHERE id=$1`,[stored.id,clean(error.message,500)]);
      }
    }
    return { queries:queries.length,results,failures };
  }

  async persistReference(jobId,companyId,reference) {
    const result=await this.pool.query(`INSERT INTO leadgen.enrichment_public_references
      (research_job_id,company_id,platform,profile_url,profile_kind,title_hint,snippet_hint,discovered_via,
       verification_status,evidence_strength,content_fetched,captured_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (research_job_id,company_id,profile_url) DO UPDATE SET
        title_hint=coalesce(EXCLUDED.title_hint,leadgen.enrichment_public_references.title_hint),
        snippet_hint=coalesce(EXCLUDED.snippet_hint,leadgen.enrichment_public_references.snippet_hint),
        captured_at=greatest(leadgen.enrichment_public_references.captured_at,EXCLUDED.captured_at)
      RETURNING *`,[
      jobId,companyId,reference.platform,reference.profile_url,reference.profile_kind,reference.title_hint,
      reference.snippet_hint,reference.discovered_via,reference.verification_status,reference.evidence_strength,
      reference.content_fetched,reference.captured_at
    ]);
    return result.rows[0]||null;
  }

  async fetchAllowedPage(url, { officialRootDomain = '' } = {}) {
    if (this.linkedIn.isLinkedInUrl(url)) return { blocked:true,url };
    const allowed = await this.checker.robotsAllows(url);
    if (!allowed) return { blocked:true,url,fetch_status:'ROBOTS_BLOCKED' };
    const fetched = await this.checker.fetchPage(url,{ robotsAllowed:true });
    if (fetched.final_url && this.linkedIn.isLinkedInUrl(fetched.final_url)) return { ...fetched,reachable:false,html:null,fetch_status:'POLICY_BLOCKED' };
    if (officialRootDomain && fetched.final_url && domainService.getRegistrableDomain(fetched.final_url) !== officialRootDomain) {
      return { ...fetched,reachable:false,html:null,fetch_status:'CROSS_DOMAIN_REDIRECT' };
    }
    return fetched;
  }

  async collectPages(company,searchResults) {
    const root = company.official_root_domain || domainService.getRegistrableDomain(company.website_url);
    const queue = [];
    if (company.website_url) queue.push({ url:company.website_url,official:true });
    for (const result of searchResults) {
      const reference = this.linkedIn.discoverReference({ url:result.url,title:result.title,snippet:result.snippet,provider:result.provider,capturedAt:new Date() });
      if (reference) continue;
      const resultRoot = domainService.getRegistrableDomain(result.url);
      if (root && resultRoot === root) queue.push({ url:result.url,official:true });
    }
    const pages = [];
    const seen = new Set();
    while (queue.length && pages.length < this.maxPagesPerCompany) {
      const next = queue.shift();
      const normalized = domainService.normalizeUrl(next.url) || next.url;
      if (seen.has(normalized) || this.linkedIn.isLinkedInUrl(normalized)) continue;
      seen.add(normalized);
      const fetched = await this.fetchAllowedPage(normalized,{ officialRootDomain:next.official?root:'' });
      if (!fetched.reachable || !fetched.html) { pages.push({ ...fetched,official:next.official }); continue; }
      const profile = getMarketProfile(company.country_code,company.country_name);
      const extracted = extractProcurementPage(fetched.html,fetched.final_url || normalized,{
        officialRootDomain:root,marketProfile:profile,productProfiles:company.active_product_profiles,capturedAt:fetched.captured_at
      });
      const contacts = next.official ? await extractPublicContacts(fetched.html,fetched.final_url || normalized,{ marketProfile:profile,capturedAt:fetched.captured_at }) : { contacts:[] };
      pages.push({ ...fetched,official:next.official,extracted,contacts:contacts.contacts });
      if (next.official) {
        for (const link of discoverProcurementLinks(fetched.html,fetched.final_url || normalized,profile)) {
          if (domainService.getRegistrableDomain(link.url) === root) queue.push({ url:link.url,official:true });
        }
      }
    }
    return pages;
  }

  async upsertDecisionMaker(client,job,company,candidate) {
    const normalizedRole = candidate.normalized_role || normalizeDecisionRole(candidate.raw_title);
    const values = [company.id,job.id,candidate.person_name || null,candidate.person_name_normalized || (candidate.person_name ? normalizedIdentity(candidate.person_name):null),
      candidate.department_name || null,candidate.department_name_normalized || (candidate.department_name?normalizedIdentity(candidate.department_name):null),
      clean(candidate.raw_title,500),normalizedRole,candidate.role_relevance || roleRelevance(normalizedRole),company.country_code,
      candidate.verification_status || 'REVIEW',candidate.evidence_strength || 'DISCOVERY_HINT',candidate.verification_status === 'VERIFIED' ? new Date():null];
    let result = await client.query(`INSERT INTO leadgen.decision_makers
      (company_id,research_job_id,person_name,person_name_normalized,department_name,department_name_normalized,
       raw_title,normalized_role,role_relevance,market_code,verification_status,evidence_strength,last_verified_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING RETURNING *`,values);
    if (!result.rowCount) result = await client.query(`SELECT * FROM leadgen.decision_makers WHERE company_id=$1
      AND coalesce(person_name_normalized,'')=coalesce($2,'') AND coalesce(department_name_normalized,'')=coalesce($3,'')
      AND normalized_role=$4 AND raw_title=$5 LIMIT 1`,[company.id,values[3],values[5],normalizedRole,values[6]]);
    const decisionMaker = result.rows[0];
    if (!decisionMaker) throw new Error('Decision-maker upsert did not return a row');
    await client.query(`UPDATE leadgen.decision_makers SET research_job_id=$2,
      verification_status=CASE WHEN verification_status='VERIFIED' OR $3='VERIFIED' THEN 'VERIFIED' ELSE $3 END,
      evidence_strength=CASE WHEN evidence_strength='STRONG' OR $4='STRONG' THEN 'STRONG' ELSE $4 END,
      role_relevance=$5,last_verified_at=CASE WHEN $3='VERIFIED' THEN now() ELSE last_verified_at END,updated_at=now() WHERE id=$1`,[
      decisionMaker.id,job.id,candidate.verification_status || 'REVIEW',candidate.evidence_strength || 'DISCOVERY_HINT',candidate.role_relevance || roleRelevance(normalizedRole)
    ]);
    const sourceIds = [];
    if (candidate.source) {
      const source = candidate.source;
      const inserted = await client.query(`INSERT INTO leadgen.decision_maker_sources
        (decision_maker_id,research_job_id,source_url,source_type,source_authority,captured_at,published_at,
         evidence_text,evidence_hash,evidence_status,is_primary,content_fetched)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (decision_maker_id,evidence_hash) DO UPDATE SET
          research_job_id=EXCLUDED.research_job_id,captured_at=EXCLUDED.captured_at,
          published_at=EXCLUDED.published_at,evidence_status=EXCLUDED.evidence_status,
          is_primary=EXCLUDED.is_primary,content_fetched=EXCLUDED.content_fetched
        RETURNING id`,[
        decisionMaker.id,job.id,source.source_url,source.source_type,source.source_authority,source.captured_at || new Date(),
        source.published_at || null,clean(source.evidence_text,4000),source.evidence_hash || sha(source.source_url,source.evidence_text),
        source.evidence_status || 'REVIEW',source.is_primary === true,source.content_fetched !== false
      ]);
      sourceIds.push(inserted.rows[0].id);
    }
    for (const profile of company.active_product_profiles) {
      const relevance = candidate.product_relevance?.[profile] || productRoleRelevance(candidate.raw_title,normalizedRole,profile,'');
      await client.query(`INSERT INTO leadgen.decision_maker_product_relevance(decision_maker_id,product_profile,relevance,reason)
        VALUES ($1,$2,$3,$4) ON CONFLICT (decision_maker_id,product_profile) DO UPDATE SET relevance=EXCLUDED.relevance,reason=EXCLUDED.reason,updated_at=now()`,[
        decisionMaker.id,profile,relevance.relevance,relevance.reason
      ]);
    }
    return { ...decisionMaker,id:decisionMaker.id,source_ids:sourceIds };
  }

  async upsertContact(client,jobId,decisionMakerId,contact) {
    const value = clean(contact.contact_value_normalized || contact.contact_value_raw,1000);
    if (!value) return null;
    const result = await client.query(`INSERT INTO leadgen.decision_maker_contacts
      (decision_maker_id,research_job_id,contact_type,contact_value_raw,contact_value_normalized,evidence_origin,
       verification_status,verification_provider,verification_score,last_verified_at,source_url,is_generic,is_department)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (decision_maker_id,contact_type,contact_value_normalized) DO UPDATE SET
        research_job_id=EXCLUDED.research_job_id,contact_value_raw=EXCLUDED.contact_value_raw,
        evidence_origin=EXCLUDED.evidence_origin,source_url=EXCLUDED.source_url,
        is_generic=EXCLUDED.is_generic,is_department=EXCLUDED.is_department,
        verification_status=CASE
          WHEN EXCLUDED.verification_provider='HUNTER' THEN EXCLUDED.verification_status
          WHEN EXCLUDED.verification_status='VALID' THEN 'VALID'
          ELSE leadgen.decision_maker_contacts.verification_status END,
        verification_provider=EXCLUDED.verification_provider,
        verification_score=CASE WHEN EXCLUDED.verification_provider='HUNTER' THEN EXCLUDED.verification_score
          ELSE leadgen.decision_maker_contacts.verification_score END,
        last_verified_at=EXCLUDED.last_verified_at,updated_at=now()
      RETURNING *`,[
      decisionMakerId,jobId,contact.contact_type,contact.contact_value_raw,value,contact.evidence_origin || 'OFFICIAL_SITE_OBSERVED',
      contact.verification_status || 'NOT_VERIFIED',contact.verification_provider || null,contact.verification_score ?? null,
      contact.last_verified_at || null,contact.source_url,contact.is_generic === true,contact.is_department === true
    ]);
    return result.rows[0];
  }

  async persistHunterContactCheckpoint({job,company,named,domain,result,capturedAt,verificationCompleted=false}) {
    if(!result?.email)return{referenceIds:[]};
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const contact=await this.upsertContact(client,job.id,named.id,{
        contact_type:'BUSINESS_EMAIL',contact_value_raw:result.email,contact_value_normalized:result.email,
        evidence_origin:'PROVIDER_FOUND',verification_status:verificationCompleted
          ? result.verification_status||'NOT_VERIFIED':'NOT_VERIFIED',
        verification_provider:'HUNTER',verification_score:result.verification_score??null,
        last_verified_at:capturedAt||new Date(),source_url:`https://${domain}`,is_generic:false,is_department:false
      });
      await client.query('COMMIT');
      return{referenceIds:contact?.id?[contact.id]:[]};
    }catch(error){
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    }finally{client.release();}
  }

  async loadHunterContactCheckpoint({company,named,referenceIds}) {
    if(!Array.isArray(referenceIds)||!referenceIds.length)return[];
    const found=await this.pool.query(`SELECT c.id,c.contact_value_normalized,c.verification_status,c.verification_score
      FROM leadgen.decision_maker_contacts c JOIN leadgen.decision_makers d ON d.id=c.decision_maker_id
      WHERE c.id=ANY($1::uuid[]) AND c.decision_maker_id=$2 AND d.company_id=$3
        AND c.contact_type='BUSINESS_EMAIL'
      ORDER BY c.updated_at DESC,c.id`,[referenceIds,named.id,company.id]);
    return found.rows.map(row=>({email:row.contact_value_normalized,person_name:named.person_name||null,
      raw_title:named.raw_title||null,verification_status:row.verification_status,
      verification_score:row.verification_score===null?null:Number(row.verification_score),sources:[]}));
  }

  async persistCompanyFindings(job,company,pages) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pageResults = pages.filter(page=>page.extracted).map(page=>page.extracted);
      const candidates = unique(pageResults.flatMap(page=>page.decision_makers),candidate=>`${candidate.person_name_normalized || ''}|${candidate.department_name_normalized || ''}|${candidate.normalized_role}|${candidate.raw_title}`);
      const routes = unique(pageResults.flatMap(page=>page.supplier_routes),route=>`${route.contact_type}|${route.contact_value_normalized}`);
      const observedContacts = boundedObservedContacts(pages,company);
      let corporateRoute = null;
      if (!candidates.length && (routes.length || observedContacts.length)) {
        const sourceUrl = routes[0]?.source_url || observedContacts[0]?.source_url || company.website_url;
        corporateRoute = {
          person_name:null,department_name:routes.length?'Procurement Department':'Corporate Contact Route',raw_title:routes.length?'Procurement Department':'Corporate Contact Route',
          normalized_role:routes.length?'PROCUREMENT_DEPARTMENT':'OTHER_RELEVANT',role_relevance:routes.length?'HIGH':'MEDIUM',
          verification_status:routes.length?'VERIFIED':'REVIEW',evidence_strength:routes.length?'STRONG':'SUPPORTED',
          source:{ source_url:sourceUrl,source_type:'OFFICIAL_COMPANY_PAGE',source_authority:'OFFICIAL',captured_at:new Date(),
            evidence_text:routes.length?(routes[0].label || 'Supplier registration route'):'Corporate business contact route',
            evidence_hash:sha(sourceUrl,routes.length?'supplier_route':'corporate_contact'),evidence_status:routes.length?'VERIFIED':'REVIEW',is_primary:true,content_fetched:true }
        };
        candidates.push(corporateRoute);
      }
      const persisted = [];
      for (const candidate of candidates) persisted.push(await this.upsertDecisionMaker(client,job,company,candidate));
      const departmentTarget = persisted.find(item=>item.department_name) || persisted[0] || null;
      if (departmentTarget) {
        for (const route of routes) await this.upsertContact(client,job.id,departmentTarget.id,{ ...route,evidence_origin:'OFFICIAL_SITE_OBSERVED',verification_provider:'PUBLIC_PAGE',last_verified_at:new Date() });
        for (const contact of observedContacts) await this.upsertContact(client,job.id,departmentTarget.id,contact);
      }
      await client.query(`UPDATE leadgen.decision_makers d SET source_count=(SELECT count(*) FROM leadgen.decision_maker_sources s WHERE s.decision_maker_id=d.id)
        WHERE d.company_id=$1`,[company.id]);
      await client.query('COMMIT');
      return { decision_makers:persisted,routes,observed_contacts:observedContacts,page_results:pageResults };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }

  async applyHunter(job,company,findings,{hunterEnabled=true}={}) {
    if(!hunterEnabled)return {calls:0,used_units:0,mode:'AUTO_EVIDENCE_POLICY_DISABLED'};
    if (!this.hunter.capabilities.enabled) return { calls:0,used_units:0,mode:'DISABLED' };
    let calls = 0;
    let usedUnits = 0;
    const namedCandidates = findings.decision_makers.filter(item=>item.person_name && item.verification_status === 'VERIFIED'
      && ['BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING']
        .includes(item.normalized_role));
    const domain = company.official_root_domain || domainService.getRegistrableDomain(company.website_url);
    for (const named of domain ? namedCandidates : []) {
      const parts = named.person_name.trim().split(/\s+/);
      if (parts.length < 2) continue;
      let result;
      try {
        result = await this.hunter.findEmail({ researchJobId:job.id,companyId:company.id,domain,firstName:parts[0],lastName:parts.at(-1),
          persistResults:async(results,{capturedAt})=>this.persistHunterContactCheckpoint({
            job,company,named,domain,result:results[0],capturedAt,verificationCompleted:false
          }),
          loadPersistedResults:async({referenceIds})=>this.loadHunterContactCheckpoint({job,company,named,referenceIds})
        });
      } catch (error) {
        if (isHunterBudgetError(error)) return { calls,used_units:usedUnits,mode:this.hunter.mode,budget_reached:true,stop_reason:'HUNTER_BUDGET_CAP' };
        throw error;
      }
      calls += result.status === 'SKIPPED' ? 0 : 1;
      usedUnits += Number(result.credits?.used || 0);
      if (result.error_code === 'AUTHENTICATION_FAILED') {
        return { calls,used_units:usedUnits,mode:this.hunter.mode,stop_reason:'HUNTER_AUTHENTICATION_FAILED' };
      }
      if (result.status === 'TEMPORARY_ERROR') {
        return { calls,used_units:usedUnits,mode:this.hunter.mode,temporary_error:true };
      }
      if(result.status==='REPLAY_LOOKUP_REQUIRED')return{calls,used_units:usedUnits,mode:this.hunter.mode,
        temporary_error:true,stop_reason:'HUNTER_BUSINESS_RESULT_LOOKUP_REQUIRED'};
      const found = result.results?.[0];
      if (!found?.email) continue;
      let verification;
      try {
        verification = await this.hunter.verifyEmail({ researchJobId:job.id,companyId:company.id,email:found.email,
          persistResults:async(results,{capturedAt})=>this.persistHunterContactCheckpoint({
            job,company,named,domain,result:{...results[0],email:found.email},capturedAt,verificationCompleted:true
          }),
          loadPersistedResults:async({referenceIds})=>this.loadHunterContactCheckpoint({job,company,named,referenceIds})
        });
      } catch (error) {
        if (isHunterBudgetError(error)) {
          return { calls,used_units:usedUnits,mode:this.hunter.mode,budget_reached:true,stop_reason:'HUNTER_BUDGET_CAP' };
        }
        throw error;
      }
      calls += verification.status === 'SKIPPED' ? 0 : 1;
      usedUnits += Number(verification.credits?.used || 0);
      if (verification.error_code === 'AUTHENTICATION_FAILED') {
        return { calls,used_units:usedUnits,mode:this.hunter.mode,stop_reason:'HUNTER_AUTHENTICATION_FAILED' };
      }
      if(verification.status==='REPLAY_LOOKUP_REQUIRED')return{calls,used_units:usedUnits,mode:this.hunter.mode,
        temporary_error:true,stop_reason:'HUNTER_BUSINESS_RESULT_LOOKUP_REQUIRED'};
      const verified = verification.results?.[0];
      const verificationStatus = verification.status === 'TEMPORARY_ERROR'
        ? 'TEMPORARY_ERROR'
        : verified?.verification_status || 'NOT_VERIFIED';
      const capturedAt = verification.captured_at || new Date();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const contact = await this.upsertContact(client,job.id,named.id,{ contact_type:'BUSINESS_EMAIL',contact_value_raw:found.email,contact_value_normalized:found.email,
          evidence_origin:'PROVIDER_FOUND',verification_status:verificationStatus,verification_provider:'HUNTER',
          verification_score:verified?.verification_score ?? found.verification_score,last_verified_at:capturedAt,
          source_url:`https://${domain}`,is_generic:false,is_department:false });
        if (contact) {
          const inputDigest = sha(String(found.email).trim().toLowerCase());
          const usageEventId = verification.usage_event?.id || null;
          if(usageEventId)await client.query(`INSERT INTO leadgen.contact_verification_events
              (research_job_id,company_id,decision_maker_contact_id,provider_usage_event_id,provider,endpoint,
               verification_status,verification_score,verified_at,captured_at,expires_at,recipient_hash,input_digest,idempotency_key)
              VALUES ($1,$2,$3,$4,'HUNTER','email-verifier',$5,$6,$7,$7,$7+($8::int*interval '1 day'),$9,$9,$10)
              ON CONFLICT (idempotency_key) DO NOTHING`,[
              job.id,company.id,contact.id,usageEventId,verificationStatus,verified?.verification_score ?? found.verification_score ?? null,
              capturedAt,Math.max(1,Number(process.env.CONTACT_VERIFICATION_TTL_DAYS || 30)),inputDigest,
              sha(job.id,contact.id,usageEventId,verificationStatus)
            ]);
          if (verificationStatus === 'INVALID') {
            await client.query(`INSERT INTO leadgen.contact_suppressions
              (company_id,decision_maker_contact_id,suppression_type,reason,recorded_by)
              VALUES ($1,$2,'INVALID_EMAIL','Email verification returned INVALID','CONTACT_VERIFICATION')
              ON CONFLICT DO NOTHING`,[company.id,contact.id]);
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally { client.release(); }
      if (verification.status === 'TEMPORARY_ERROR') {
        return { calls,used_units:usedUnits,mode:this.hunter.mode,temporary_error:true };
      }
      if (verificationStatus === 'VALID') {
        return { calls,used_units:usedUnits,mode:this.hunter.mode,valid_contact_found:true,decision_maker_id:named.id };
      }
      // ACCEPT_ALL, UNKNOWN/NOT_VERIFIED and INVALID are evidence, but not a send-ready route.
      // Continue through the bounded, already verified candidate list before opening a human exception.
    }
    return { calls,used_units:usedUnits,mode:this.hunter.mode,alternatives_exhausted:namedCandidates.length > 0 };
  }

  async persistFeasibility(job,company,findings) {
    const decisions = await this.pool.query(`SELECT d.*,coalesce(ct.routes,0)::integer routes
      FROM leadgen.decision_makers d LEFT JOIN LATERAL (SELECT count(*) routes FROM leadgen.decision_maker_contacts c
        WHERE c.decision_maker_id=d.id AND c.research_job_id=$2 AND c.verification_status NOT IN ('INVALID','TEMPORARY_ERROR')) ct ON true
      WHERE d.company_id=$1 AND d.research_job_id=$2 AND d.lifecycle_status='ACTIVE'`,[company.id,job.id]);
    const sources = await this.pool.query(`SELECT s.id,s.source_authority,s.source_url FROM leadgen.decision_maker_sources s
      JOIN leadgen.decision_makers d ON d.id=s.decision_maker_id WHERE d.company_id=$1 AND d.research_job_id=$2 AND s.research_job_id=$2`,[company.id,job.id]);
    const contacts = await this.pool.query(`SELECT c.* FROM leadgen.decision_maker_contacts c
      JOIN leadgen.decision_makers d ON d.id=c.decision_maker_id WHERE d.company_id=$1 AND d.research_job_id=$2
        AND c.research_job_id=$2 AND d.lifecycle_status='ACTIVE'`,[company.id,job.id]);
    const barrierSignals = unique(findings.page_results.flatMap(page=>page.barrier_signals),value=>value);
    const unknownBarrier = barrierSignals.length ? barrierSignals : ['UNKNOWN_BARRIER'];
    const verifiedNamed = decisions.rows.filter(item=>item.person_name && item.verification_status==='VERIFIED');
    const verifiedDepartments = decisions.rows.filter(item=>item.department_name && item.verification_status==='VERIFIED');
    const usableContacts = contacts.rows.filter(item=>!['INVALID','TEMPORARY_ERROR'].includes(item.verification_status));
    const supplierRoutes = contacts.rows.filter(item=>['SUPPLIER_PORTAL','VENDOR_REGISTRATION'].includes(item.contact_type));
    const relationship = bestRelationship(company);
    const opennessStates = findings.page_results.map(page=>page.supplier_openness);
    const operationalStates = findings.page_results.map(page=>page.operational_feasibility);
    const hasClosed = opennessStates.includes('CLOSED');
    const hasOpen = opennessStates.includes('OPEN');
    const highBarrier = barrierSignals.some(code=>['FIXED_SUPPLIER_NETWORK','EXCLUSIVE_SUPPLY','CENTRALIZED_GLOBAL_PROCUREMENT','LOCAL_SOURCE_ONLY'].includes(code));
    const moderateBarrier = barrierSignals.some(code=>['INVITATION_ONLY','PREQUALIFICATION_REQUIRED','LONG_TENDER_CYCLE','HIGH_COMPLIANCE_GATE'].includes(code));
    const allEvidenceIds = sources.rows.map(item=>item.id);
    const outputs = [];
    for (const profile of company.active_product_profiles) {
      const targetFit = targetFitBand(company.management_match);
      const input = {
        target_fit:targetFit,relationship_status:relationship,
        has_verified_decision_route:Boolean(verifiedNamed.length || verifiedDepartments.length),
        has_usable_contact_route:Boolean(usableContacts.length),has_traceable_evidence:Boolean(sources.rowCount),
        role_review_required:!verifiedNamed.length && !verifiedDepartments.length,
        dimensions:{
          external_supplier_openness:{ state:hasClosed?'CLOSED':hasOpen?'OPEN':'UNKNOWN',reason:hasClosed?'Explicit supplier restriction evidence found':hasOpen?'External supplier openness is published':'Supplier openness requires confirmation',evidence_ids:allEvidenceIds,unknown_fields:hasClosed||hasOpen?[]:['external_supplier_openness'] },
          supplier_onboarding_accessibility:{ state:barrierSignals.includes('INVITATION_ONLY')?'INVITATION_ONLY':supplierRoutes.length?'OPEN':usableContacts.length?'CONTACT_ROUTE':'UNKNOWN',reason:supplierRoutes.length?'A supplier or vendor route is published':usableContacts.length?'A business contact route is available':'Supplier onboarding route requires confirmation',evidence_ids:allEvidenceIds,unknown_fields:supplierRoutes.length||usableContacts.length?[]:['supplier_onboarding_process'] },
          buying_procurement_accessibility:{ state:verifiedNamed.length?'NAMED_VERIFIED':verifiedDepartments.length?'DEPARTMENT_VERIFIED':usableContacts.length?'ROUTE_ONLY':'UNKNOWN',reason:verifiedNamed.length?'A named buying role is verified':verifiedDepartments.length?'A buying/procurement department is verified':usableContacts.length?'A corporate route is available':'Buying responsibility requires confirmation',evidence_ids:allEvidenceIds,unknown_fields:verifiedNamed.length||verifiedDepartments.length||usableContacts.length?[]:['buyer_or_procurement_department'] },
          product_category_buying_fit:{ state:productFitState(company.active_product_profiles,profile,company.management_match),reason:`Company product scope evaluated for ${profile}`,evidence_ids:allEvidenceIds,unknown_fields:[] },
          commercial_operational_feasibility:{ state:operationalStates.includes('BARRIER')?'BARRIER':operationalStates.includes('SUPPORTED')?'SUPPORTED':'UNKNOWN',reason:operationalStates.includes('BARRIER')?'Published requirements indicate an operational gate':operationalStates.includes('SUPPORTED')?'Published operational/supplier requirements are available':'Commercial and operational compatibility requires confirmation',evidence_ids:allEvidenceIds,unknown_fields:operationalStates.some(value=>value!=='UNKNOWN')?[]:['moq_capacity_compliance_logistics'] },
          supplier_lock_in_barrier:{ state:highBarrier?'HIGH':moderateBarrier?'MODERATE':hasOpen?'LOW':'UNKNOWN',reason:highBarrier?'Explicit supplier lock-in evidence found':moderateBarrier?'A documented supplier-entry gate exists':hasOpen?'Published supplier access reduces lock-in concern':'Supplier lock-in requires confirmation',evidence_ids:allEvidenceIds,unknown_fields:highBarrier||moderateBarrier||hasOpen?[]:['supplier_lock_in'] }
        }
      };
      const evaluated = await this.feasibilityEngine.evaluate(input);
      const inserted = await this.pool.query(`INSERT INTO leadgen.cooperation_feasibility_results
        (research_job_id,company_id,product_profile,cooperation_feasibility_score,feasibility_band,
         access_opportunity_matrix,opportunity_readiness,relationship_status,management_match,
         mexico_historical_match,dpv_score,dimension_breakdown,reason_codes,barrier_signals,missing_evidence,
         supplier_route_count,verified_decision_maker_count,usable_contact_route_count,evidence_source_count,rule_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (research_job_id,company_id,product_profile) DO UPDATE SET
          cooperation_feasibility_score=EXCLUDED.cooperation_feasibility_score,feasibility_band=EXCLUDED.feasibility_band,
          access_opportunity_matrix=EXCLUDED.access_opportunity_matrix,opportunity_readiness=EXCLUDED.opportunity_readiness,
          relationship_status=EXCLUDED.relationship_status,dimension_breakdown=EXCLUDED.dimension_breakdown,
          reason_codes=EXCLUDED.reason_codes,barrier_signals=EXCLUDED.barrier_signals,missing_evidence=EXCLUDED.missing_evidence,
          supplier_route_count=EXCLUDED.supplier_route_count,verified_decision_maker_count=EXCLUDED.verified_decision_maker_count,
          usable_contact_route_count=EXCLUDED.usable_contact_route_count,evidence_source_count=EXCLUDED.evidence_source_count,calculated_at=now()
        RETURNING *`,[
        job.id,company.id,profile,evaluated.cooperation_feasibility_score,evaluated.feasibility_band,
        evaluated.access_opportunity_matrix,evaluated.opportunity_readiness,relationship,
        company.management_match,company.mexico_historical_match,company.dpv_score,JSON.stringify(evaluated.dimension_breakdown),
        evaluated.reason_codes,unknownBarrier,evaluated.missing_evidence,supplierRoutes.length,verifiedNamed.length+verifiedDepartments.length,
        usableContacts.length,sources.rowCount,evaluated.rule_version
      ]);
      const pageByUrl = new Map(findings.page_results.map(page=>[domainService.normalizeUrl(page.source_url || '') || page.source_url,page]));
      for (const source of sources.rows) {
        const sourcePage = pageByUrl.get(domainService.normalizeUrl(source.source_url || '') || source.source_url);
        const dimensions = new Set(['buying_procurement_accessibility','product_category_buying_fit']);
        if (sourcePage?.supplier_openness && sourcePage.supplier_openness !== 'UNKNOWN') dimensions.add('external_supplier_openness');
        if (sourcePage?.supplier_access_evidence) dimensions.add('supplier_onboarding_accessibility');
        if (sourcePage?.operational_feasibility && sourcePage.operational_feasibility !== 'UNKNOWN') dimensions.add('commercial_operational_feasibility');
        if (sourcePage?.barrier_signals?.length || (sourcePage?.supplier_openness && sourcePage.supplier_openness !== 'UNKNOWN')) dimensions.add('supplier_lock_in_barrier');
        for (const dimension of dimensions) {
        await this.pool.query(`INSERT INTO leadgen.cooperation_feasibility_sources(feasibility_result_id,decision_maker_source_id,dimension)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[inserted.rows[0].id,source.id,dimension]);
        }
      }
      outputs.push(inserted.rows[0]);
    }
    return outputs;
  }

  async recordCompanyStageEvents(job,company,{findings,hunter,feasibility}) {
    const profile=company.active_product_profiles?.[0];
    if(!profile)return [];
    const cohort=await this.pool.query(`SELECT id FROM leadgen.research_job_cohort_items
      WHERE research_job_id=$1 AND company_id=$2 AND product_profile=$3`,[job.id,company.id,profile]);
    if(!cohort.rowCount)return [];
    const context=await this.pool.query(`SELECT o.id opportunity_snapshot_id,o.reason_codes,
      o.buyer_business_model_result_id,o.category_procurement_match_result_id,o.product_opportunity_result_id,
      o.cooperation_feasibility_result_id,bbm.buyer_model,cpm.match_status,cpm.coverage_percent,
      f.supplier_access_band,f.supplier_access_coverage,f.opportunity_readiness,
      dm.id decision_maker_id,dm.verification_status decision_maker_status,
      dc.id decision_maker_contact_id,dc.verification_status contact_status,
      p.id provider_usage_event_id
      FROM leadgen.business_opportunity_current o
      LEFT JOIN leadgen.buyer_business_model_results bbm ON bbm.id=o.buyer_business_model_result_id
      LEFT JOIN leadgen.category_procurement_match_results cpm ON cpm.id=o.category_procurement_match_result_id
      LEFT JOIN leadgen.cooperation_feasibility_results f ON f.id=o.cooperation_feasibility_result_id
      LEFT JOIN LATERAL(SELECT d.id,d.verification_status FROM leadgen.decision_makers d
        JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id AND pr.product_profile=o.product_profile
        WHERE d.company_id=o.company_id AND d.person_name IS NOT NULL AND d.verification_status='VERIFIED'
          AND d.lifecycle_status='ACTIVE' AND pr.relevance IN('HIGH','MEDIUM')
        ORDER BY d.last_verified_at DESC NULLS LAST,d.id DESC LIMIT 1) dm ON true
      LEFT JOIN LATERAL(SELECT x.id,x.verification_status FROM leadgen.decision_maker_contacts x
        WHERE x.decision_maker_id=dm.id AND x.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
        ORDER BY x.last_verified_at DESC NULLS LAST,x.id DESC LIMIT 1) dc ON true
      LEFT JOIN LATERAL(SELECT x.id FROM leadgen.provider_usage_events x
        WHERE x.research_job_id=$1 AND x.company_id=$2 AND x.provider='HUNTER' AND x.endpoint='email-verifier'
        ORDER BY x.created_at DESC,x.id DESC LIMIT 1)p ON true
      WHERE o.company_id=$2 AND o.product_profile=$3`,[job.id,company.id,profile]);
    if(!context.rowCount)return [];
    const row=context.rows[0];
    const sourceCount=Number(findings?.decision_makers?.reduce((sum,item)=>sum+Number(item.source_ids?.length||0),0)||0);
    const currentFeasibility=feasibility?.find(item=>item.product_profile===profile)||null;
    const supplierReady=['OPEN','ACCESSIBLE','SUPPORTED'].includes(String(currentFeasibility?.supplier_access_band||row.supplier_access_band||'').toUpperCase())
      || Number(currentFeasibility?.supplier_access_coverage||row.supplier_access_coverage||0)>0;
    const currentFeasibilityId=currentFeasibility?.id || row.cooperation_feasibility_result_id;
    const stages=[
      ['IDENTITY','IDENTITY_READY',null,null,null,null,null,null,null],
      ['BUYER_MODEL',['DIRECT_END_BUYER','DISTRIBUTION_BUYER'].includes(row.buyer_model)?'BUYER_MODEL_READY':'EVIDENCE_REQUIRED_BUYER_MODEL',row.buyer_business_model_result_id,null,null,null,null,null,null],
      ['CATEGORY_PROCUREMENT',row.match_status==='CATEGORY_PROCUREMENT_MATCH'?'CATEGORY_PROCUREMENT_MATCH':'EVIDENCE_REQUIRED_CATEGORY',null,row.category_procurement_match_result_id,null,null,null,null,null],
      ['SUPPLIER_ACCESS',supplierReady?'SUPPLIER_ACCESS_SUPPORTED':'EVIDENCE_REQUIRED_SUPPLIER_ACCESS',null,null,null,currentFeasibilityId,null,null,null],
      ['BUYER_ROLE',row.decision_maker_status==='VERIFIED'?'PROFILE_BUYER_VERIFIED':'EVIDENCE_REQUIRED_BUYER_ROLE',null,null,null,null,row.decision_maker_id,null,null],
      ['EMAIL_VERIFICATION',row.contact_status==='VALID'?'VALID':row.contact_status||hunter?.stop_reason||'EVIDENCE_REQUIRED_EMAIL',null,null,null,null,row.decision_maker_id,row.decision_maker_contact_id,row.provider_usage_event_id]
    ];
    const inserted=[];
    for(const [stage,outcome,buyerId,categoryId,productId,cooperationId,decisionMakerId,contactId,usageId] of stages){
      const inputDigest=sha(job.id,company.id,profile,stage,outcome,buyerId,categoryId,productId,cooperationId,decisionMakerId,contactId,usageId);
      const event=await this.pool.query(`INSERT INTO leadgen.research_job_stage_events
        (research_job_id,cohort_item_id,stage,event_type,outcome_code,reason_codes,retry_number,source_count,
         input_digest,idempotency_key,buyer_business_model_result_id,category_procurement_match_result_id,
         product_opportunity_result_id,cooperation_feasibility_result_id,decision_maker_id,
         decision_maker_contact_id,business_opportunity_decision_snapshot_id,provider_usage_event_id,occurred_at)
        VALUES ($1,$2,$3,'STAGE_EVALUATED',$4,$5,0,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,[
        job.id,cohort.rows[0].id,stage,String(outcome).slice(0,160),row.reason_codes||[],sourceCount,inputDigest,
        buyerId,categoryId,productId,cooperationId,decisionMakerId,contactId,row.opportunity_snapshot_id,usageId
      ]);
      if(event.rowCount)inserted.push(event.rows[0].id);
    }
    return inserted;
  }

  async enrichCompany(job,company,{tavilyEnabled=true,hunterEnabled=true,strategy=null}={}) {
    await this.pool.query(`INSERT INTO leadgen.enrichment_job_companies(research_job_id,company_id,market_code,product_profiles,attempt_status,started_at)
      VALUES ($1,$2,$3,$4,'DISCOVERING',now()) ON CONFLICT (research_job_id,company_id) DO UPDATE SET attempt_status='DISCOVERING',started_at=coalesce(leadgen.enrichment_job_companies.started_at,now()),updated_at=now()`,[
      job.id,company.id,company.country_code,company.active_product_profiles
    ]);
    try {
      const search = await this.runSearchQueries(job,company,{tavilyEnabled,strategy});
      for (const result of String(this.provider.name||'').toLowerCase()==='tavily'?[]:search.results) {
        const linkedIn = this.linkedIn.discoverReference({ url:result.url,title:result.title,snippet:result.snippet,provider:result.provider,capturedAt:new Date() });
        if (linkedIn) await this.persistReference(job.id,company.id,linkedIn);
      }
      await this.pool.query(`UPDATE leadgen.enrichment_job_companies SET attempt_status='RESOLVING',queries_executed=$3,updated_at=now() WHERE research_job_id=$1 AND company_id=$2`,[job.id,company.id,search.queries]);
      const pages = await this.collectPages(company,search.results);
      const findings = await this.persistCompanyFindings(job,company,pages);
      await this.pool.query(`UPDATE leadgen.enrichment_job_companies SET attempt_status='VERIFYING',sources_found=$3,decision_makers_found=$4,contact_routes_found=$5,updated_at=now() WHERE research_job_id=$1 AND company_id=$2`,[
        job.id,company.id,pages.filter(page=>page.reachable).length,findings.decision_makers.length,findings.routes.length+findings.observed_contacts.length
      ]);
      const hunter = await this.applyHunter(job,company,findings,{hunterEnabled});
      const feasibility = await this.persistFeasibility(job,company,findings);
      await this.recordCompanyStageEvents(job,company,{findings,hunter,feasibility});
      const partial = search.failures > 0 || pages.some(page=>['TIMEOUT','NETWORK_ERROR'].includes(page.fetch_status))
        || hunter.temporary_error === true || Boolean(hunter.stop_reason);
      await this.pool.query(`UPDATE leadgen.enrichment_job_companies SET attempt_status=$3,provider_calls=$4,
        timeout_count=$5,completed_at=now(),updated_at=now() WHERE research_job_id=$1 AND company_id=$2`,[
        job.id,company.id,partial?'PARTIAL':'COMPLETE',hunter.calls,pages.filter(page=>page.fetch_status==='TIMEOUT').length
      ]);
      return { company_id:company.id,status:partial?'PARTIAL':'COMPLETE',pages,findings,hunter,feasibility };
    } catch (error) {
      await this.pool.query(`UPDATE leadgen.enrichment_job_companies SET attempt_status='FAILED',last_error=$3,completed_at=now(),updated_at=now() WHERE research_job_id=$1 AND company_id=$2`,[
        job.id,company.id,clean(error.message,500)
      ]);
      if(['TAVILY_CREDIT_CAP','PROVIDER_CREDIT_EXHAUSTED'].includes(error?.code))return {company_id:company.id,status:'PARTIAL',
        stop_reason:error.code,error:clean(error.message,500)};
      return { company_id:company.id,status:'FAILED',error:clean(error.message,500) };
    }
  }

  async runJob(jobId,{tavilyEnabled=true,hunterEnabled=true,strategy=null}={}) {
    const claimed = await this.pool.query(`UPDATE leadgen.research_jobs
      SET status='DISCOVERING',started_at=coalesce(started_at,now()),completed_at=NULL,last_error=NULL
      WHERE id=$1 AND job_type IN('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH')
        AND status IN ('QUEUED','FAILED') RETURNING *`,[jobId]);
    if (!claimed.rowCount) {
      const current = await this.getJob(jobId);
      if (!current) throw Object.assign(new Error('Enrichment job not found'),{ code:'ENRICHMENT_JOB_NOT_FOUND' });
      return { job_id:current.id,status:current.status,idempotent_replay:true,in_progress:!['COMPLETE','COMPLETED','PARTIAL','FAILED'].includes(current.status) };
    }
    const job = claimed.rows[0];
    try {
      const companies = await this.listEligibleCompanies(job);
      if (!companies.length) {
        const message = 'No eligible verified active companies matched this job scope';
        await this.pool.query(`UPDATE leadgen.research_jobs SET status='PARTIAL',completed_at=now(),companies_attempted=0,
          error_count=error_count+1,last_error=$2 WHERE id=$1`,[job.id,message]);
        return { job_id:job.id,status:'PARTIAL',companies_attempted:0,failed:0,partial:0,reason:'NO_ELIGIBLE_COMPANIES' };
      }
      const results = [];
      let stopReason = null;
      let consecutiveProviderTemporaryErrors = 0;
      for (const company of companies) {
        const result = await this.enrichCompany(job,company,{tavilyEnabled,hunterEnabled,strategy});
        results.push(result);
        if (result.hunter?.temporary_error === true) consecutiveProviderTemporaryErrors += 1;
        else consecutiveProviderTemporaryErrors = 0;
        if (result.stop_reason || result.hunter?.stop_reason) stopReason = result.stop_reason || result.hunter.stop_reason;
        if (!stopReason && consecutiveProviderTemporaryErrors >= this.providerTemporaryErrorThreshold) {
          stopReason = 'PROVIDER_TEMPORARY_ERROR_THRESHOLD';
        }
        if (stopReason) break;
      }
      await this.pool.query(`UPDATE leadgen.research_jobs SET status='PERSISTING' WHERE id=$1`,[job.id]);
      const failed = results.filter(result=>result.status==='FAILED').length;
      const partial = results.filter(result=>result.status==='PARTIAL').length;
      const counters = await this.pool.query(`SELECT
        (SELECT coalesce(sum(e.decision_makers_found),0)::integer FROM leadgen.enrichment_job_companies e WHERE e.research_job_id=$1) decision_makers,
        (SELECT count(DISTINCT d.id)::integer FROM leadgen.enrichment_job_companies e JOIN leadgen.decision_makers d ON d.company_id=e.company_id
          WHERE e.research_job_id=$1 AND d.department_name IS NOT NULL AND d.verification_status='VERIFIED' AND d.lifecycle_status='ACTIVE') departments,
        (SELECT coalesce(sum(e.contact_routes_found),0)::integer FROM leadgen.enrichment_job_companies e WHERE e.research_job_id=$1) contacts,
        (SELECT coalesce(sum(e.sources_found),0)::integer FROM leadgen.enrichment_job_companies e WHERE e.research_job_id=$1) sources,
        (SELECT coalesce(sum(e.timeout_count),0)::integer FROM leadgen.enrichment_job_companies e WHERE e.research_job_id=$1) timeouts,
        (SELECT count(*) FROM leadgen.cooperation_feasibility_results f WHERE f.research_job_id=$1 AND f.opportunity_readiness='SALES_READY')::integer sales_ready,
        (SELECT count(*) FROM leadgen.cooperation_feasibility_results f WHERE f.research_job_id=$1 AND f.opportunity_readiness='STRATEGIC_LONG_SHOT')::integer long_shot`,[job.id]);
      const count = counters.rows[0];
      const attempted = results.length;
      const status = attempted > 0 && failed === attempted ? 'FAILED' : failed || partial || stopReason ? 'PARTIAL' : 'COMPLETE';
      await this.pool.query(`UPDATE leadgen.research_jobs SET status=$2,completed_at=now(),companies_attempted=$3,
        decision_makers_found=$4,verified_departments=$5,contact_routes_found=$6,enrichment_sources_found=$7,
        sales_ready_count=$8,strategic_long_shot_count=$9,
        enrichment_timeouts=$10,error_count=$11,last_error=$12,stop_reason_code=$13 WHERE id=$1`,[
        job.id,status,attempted,count.decision_makers,count.departments,count.contacts,count.sources,count.sales_ready,count.long_shot,
        count.timeouts,failed,stopReason || (failed?`${failed} company enrichment attempts failed`:null),stopReason
      ]);
      this.audit('PHASE6_ENRICHMENT_COMPLETED',{ job_id:job.id,status,companies_attempted:attempted,failed,partial,stop_reason:stopReason });
      return { job_id:job.id,status,companies_attempted:attempted,failed,partial,stop_reason:stopReason,
        results:results.map(result=>({ company_id:result.company_id,status:result.status })) };
    } catch (error) {
      const message = clean(error.message,500) || 'Enrichment job failed';
      await this.pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),error_count=error_count+1,last_error=$2 WHERE id=$1`,[job.id,message]);
      this.audit('PHASE6_ENRICHMENT_FAILED',{ job_id:job.id,error:message });
      throw error;
    }
  }
}
