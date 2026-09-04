import { htmlService } from '../platform/HtmlService.js';
import { WebsiteReachabilityChecker } from '../contact/WebsiteReachabilityChecker.js';
import { createSearchProvider } from '../search/discoveryService.js';
import { TavilyUsageAudit } from '../search/TavilyUsageAudit.js';
import { searchCountryCode } from '../search/queryGenerator.js';
import { extractRootDomain, normalizeUrl } from '../search/resultNormalizer.js';
import { marketLocationText, marketProfileForJob, marketSearchLanguage } from '../market/marketProfiles.js';
import {
  assessBusinessTypes, assessCompanySize, assessPartnershipAccessibility, assessSmeRelevance,
  classifySocialUrl, extractBusinessSocialLinks, extractVerificationEvidence, matchExistingCompany,
  normalizeCompanyName, resolveOfficialWebsite, strategicAccountAssessment
  , socialResultMatchesCompany
} from './verificationRules.js';

const HIGH_VALUE_LINK = /about|company|who[-\s]?we[-\s]?are|products?|brands?|wholesale|distribut|partners?|locations?|stores?|contact|enquir|inquir/i;
const REJECTED_TYPES = new Set(['ARTICLE', 'MARKETPLACE']);

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function uniqueUrls(values) {
  const seen = new Set();
  return values.map(normalizeUrl).filter(value => value && !seen.has(value) && seen.add(value));
}

export function selectVerificationLinks(html, baseUrl, officialRootDomain, limit = 8, marketProfile = {}) {
  const $ = htmlService.load(html);
  const ranked = [];
  const addRanked = (rawHref, label, navigationLink = false) => {
    try {
      const href = new URL(rawHref, baseUrl).href;
      if (extractRootDomain(href) !== officialRootDomain) return;
      const lower = `${label} ${href}`.toLowerCase();
      const profileMatch = (marketProfile.pageRoleTerms || []).some(term => lower.includes(String(term).toLowerCase()));
      if (!HIGH_VALUE_LINK.test(lower) && !profileMatch && !navigationLink) return;
      const weight = /contact|enquir|inquir/i.test(lower) ? 1
        : /about|company|who[-\s]?we[-\s]?are/i.test(lower) ? 2
          : /wholesale|distribut|partners?/i.test(lower) ? 3
            : /products?|brands?/i.test(lower) ? 4
              : /locations?|stores?|branches?/i.test(lower) ? 5 : profileMatch ? 6 : 7;
      ranked.push({ href, weight });
    } catch {}
  };
  $('a[href]').each((_index, node) => {
    const label = `${$(node).text()} ${$(node).attr('aria-label') || ''} ${$(node).attr('title') || ''}`;
    addRanked($(node).attr('href'), label, $(node).closest('nav,header,footer').length > 0);
  });
  for (const item of htmlService.jsonLdItems($)) {
    const points = Array.isArray(item?.contactPoint) ? item.contactPoint : item?.contactPoint ? [item.contactPoint] : [];
    for (const point of points) if (point?.url) addRanked(point.url, 'contact structured data');
    const pages = [item?.aboutPage, item?.hasOfferCatalog, item?.url].flat().filter(Boolean);
    for (const page of pages) {
      const href = typeof page === 'string' ? page : page?.url || page?.['@id'];
      if (href) addRanked(href, `${page === item?.aboutPage ? 'about company' : 'products brands'} structured data`);
    }
  }
  return uniqueUrls(ranked.sort((a, b) => a.weight - b.weight).map(item => item.href)).slice(0, limit);
}

async function crawlCandidate(candidate, job, marketProfile, config, checker) {
  const initialUrl = normalizeUrl(candidate.discovered_external_website || candidate.final_url || candidate.url);
  let officialRoot = extractRootDomain(initialUrl || '');
  let officialWebsiteUrl = initialUrl;
  if (!initialUrl || !officialRoot) return { pages: [], socialAccounts: [], attempted: 0 };
  const queue = uniqueUrls([initialUrl, new URL('/', initialUrl).href]);
  const pages = [];
  const socialAccounts = [];
  const seen = new Set();
  while (queue.length && pages.length < config.maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    if (pages.length && extractRootDomain(url) !== officialRoot) continue;
    seen.add(url);
    const allowed = await checker.robotsAllows(url);
    if (!allowed) continue;
    if (pages.length) await delay(config.delayMs);
    const fetched = await checker.fetchPage(url, { robotsAllowed: true });
    if (!fetched.reachable || !fetched.html) continue;
    if (!pages.length) {
      const finalUrl = normalizeUrl(fetched.final_url || url);
      const finalRoot = extractRootDomain(finalUrl || '');
      if (finalUrl && finalRoot) {
        officialWebsiteUrl = finalUrl;
        officialRoot = finalRoot;
      }
    }
    const page = {
      url: fetched.final_url || url,
      title: fetched.page_title,
      captured_at: fetched.captured_at,
      html: fetched.html,
      source_type: extractRootDomain(fetched.final_url || url) === officialRoot ? 'OFFICIAL_WEBSITE' : 'CANDIDATE_PAGE'
    };
    const extraction = extractVerificationEvidence(page, {
      candidateTitle: candidate.title,
      country: job.country_name || job.country,
      city: job.city,
      region: job.region,
      category: job.product_category,
      marketProfile
    });
    pages.push({ ...page, ...extraction });
    for (const social of extractBusinessSocialLinks(fetched.html, page.url)) {
      socialAccounts.push({ ...social, profile_url: social.normalized_profile_url, source_url: page.url, source_type: 'OFFICIAL_WEBSITE', captured_at: fetched.captured_at });
    }
    for (const link of selectVerificationLinks(fetched.html, page.url, officialRoot, config.maxPages, marketProfile)) {
      if (!seen.has(link) && queue.length + pages.length < config.maxPages * 2) queue.push(link);
    }
  }
  return { pages, socialAccounts, attempted: seen.size, officialWebsiteUrl };
}

async function loadCandidateContacts(pool, candidateId) {
  const { rows } = await pool.query(`
    SELECT id,contact_type,contact_value,normalized_value,source_url,source_page_title,
      verification_status,verification_method,syntax_valid,mx_present,captured_at,
      phone_country_context,normalization_status
    FROM leadgen.research_candidate_contacts WHERE research_candidate_id=$1
    ORDER BY contact_type,contact_value`, [candidateId]);
  return rows;
}

async function insertEvidence(client, verificationId, candidate, evidence) {
  const inserted = [];
  for (const item of evidence) {
    const { rows } = await client.query(`
      INSERT INTO leadgen.company_verification_evidence
        (research_job_id,research_candidate_id,verification_id,evidence_type,evidence_value,evidence_text,
         source_type,source_url,source_page_title,confidence,verification_method,captured_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (research_candidate_id,evidence_type,source_url,evidence_text)
      DO UPDATE SET confidence=EXCLUDED.confidence,verification_method=EXCLUDED.verification_method,
        source_page_title=EXCLUDED.source_page_title,captured_at=EXCLUDED.captured_at,verification_id=EXCLUDED.verification_id
      RETURNING *`, [candidate.research_job_id, candidate.id, verificationId, item.evidence_type,
      item.evidence_value, item.evidence_text, item.source_type, item.source_url, item.source_page_title,
      item.confidence, item.verification_method, item.captured_at]);
    inserted.push(rows[0]);
  }
  return inserted;
}

async function persistSocialAccounts(client, candidate, companyId, accounts) {
  let count = 0;
  const seen = new Set();
  for (const account of accounts) {
    const key = account.normalized_profile_url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if(companyId){
      const existingCompanyAccount=await client.query(`UPDATE leadgen.company_social_accounts SET
        profile_url=$3,verification_status=$4,source_url=$5,source_type=$6,captured_at=$7
        WHERE company_id=$1 AND normalized_profile_url=$2 RETURNING id`,[companyId,key,
        account.profile_url,account.verification_status,account.source_url,account.source_type,account.captured_at]);
      if(existingCompanyAccount.rowCount){
        await client.query(`DELETE FROM leadgen.company_social_accounts
          WHERE research_candidate_id=$1 AND normalized_profile_url=$2 AND id<>$3`,[
          candidate.id,key,existingCompanyAccount.rows[0].id]);
        count+=existingCompanyAccount.rowCount;continue;
      }
    }
    const updated=await client.query(`UPDATE leadgen.company_social_accounts SET
      company_id=coalesce(company_id,$1),profile_url=$3,verification_status=$5,
      source_url=$6,source_type=$7,captured_at=$8
      WHERE research_candidate_id=$2 AND normalized_profile_url=$4`,[
      companyId,candidate.id,account.profile_url,account.normalized_profile_url,
      account.verification_status,account.source_url,account.source_type,account.captured_at
    ]);
    if(updated.rowCount){count+=updated.rowCount;continue;}
    const inserted=await client.query(`
      INSERT INTO leadgen.company_social_accounts
        (company_id,research_candidate_id,platform,profile_url,normalized_profile_url,account_type,
         verification_status,source_url,source_type,captured_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING`, [
      companyId, candidate.id, account.platform, account.profile_url, account.normalized_profile_url,
      account.account_type, account.verification_status, account.source_url, account.source_type, account.captured_at
    ]);
    if(!inserted.rowCount&&companyId){
      await client.query(`UPDATE leadgen.company_social_accounts SET
        profile_url=$3,verification_status=$4,source_url=$5,source_type=$6,captured_at=$7
        WHERE company_id=$1 AND normalized_profile_url=$2`,[companyId,account.normalized_profile_url,
        account.profile_url,account.verification_status,account.source_url,account.source_type,account.captured_at]);
    }
    count += inserted.rowCount;
  }
  return count;
}

async function existingCompaniesForMatch(client) {
  const { rows } = await client.query(`
    SELECT c.id,c.company_name,c.country_code,c.city,c.website_url,c.official_root_domain,c.research_job_id,
      coalesce(array_agg(DISTINCT x.value) FILTER (WHERE x.value IS NOT NULL),'{}') AS contact_values
    FROM leadgen.companies c
    LEFT JOIN leadgen.contacts ct ON ct.company_id=c.id
    LEFT JOIN LATERAL (VALUES (lower(ct.business_email)),(ct.business_phone),(ct.normalized_value)) x(value) ON true
    GROUP BY c.id`);
  return rows;
}

function companyTypeSummary(types) {
  return [
    types.importer.status !== 'UNKNOWN' ? `Importer ${types.importer.status}` : null,
    types.wholesaler.status !== 'UNKNOWN' ? `Wholesaler ${types.wholesaler.status}` : null,
    types.distributor.status !== 'UNKNOWN' ? `Distributor ${types.distributor.status}` : null,
    types.generalTrading.status !== 'UNKNOWN' ? `General Trading ${types.generalTrading.status}` : null
  ].filter(Boolean).join(' / ') || 'Business activity confirmed';
}

async function attachPromotedContacts(client, companyId, contacts) {
  let promoted = 0;
  for (const contact of contacts.filter(item => item.contact_type === 'EMAIL' || item.contact_type === 'PHONE')) {
    const isEmail = contact.contact_type === 'EMAIL';
    const verification = isEmail && contact.verification_status === 'DOMAIN_MX_VERIFIED' ? 'valid' : 'unknown';
    const { rowCount } = await client.query(`
      INSERT INTO leadgen.contacts
        (company_id,business_email,email_verification_status,business_phone,source_url,
         verification_method,verification_detail,verification_checked_at,
         contact_type,contact_value,normalized_value,captured_at,research_candidate_contact_id,
         phone_country_context,normalization_status,contact_verification_status,lifecycle_status,last_verified_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVE',$12)
      ON CONFLICT DO NOTHING`, [
      companyId, isEmail ? contact.contact_value : null, verification,
      isEmail ? null : contact.contact_value, contact.source_url, contact.verification_method,
      contact.verification_status, contact.captured_at, contact.contact_type, contact.contact_value,
      contact.normalized_value, contact.captured_at, contact.id,
      contact.phone_country_context || null,
      contact.normalization_status || (isEmail ? 'NOT_APPLICABLE' : 'LEGACY_UNSPECIFIED'),
      contact.verification_status === 'DOMAIN_MX_VERIFIED' ? 'DOMAIN_MX_VERIFIED' : 'PUBLICLY_OBSERVED'
    ]);
    promoted += rowCount;
  }
  return promoted;
}

async function attachCompanySources(client, companyId, evidence) {
  const byUrl = new Map();
  for (const item of evidence) {
    if (!byUrl.has(item.source_url)) byUrl.set(item.source_url, item);
  }
  for (const item of byUrl.values()) {
    await client.query(`
      INSERT INTO leadgen.sources (company_id,provider_name,source_url,provider_reference,captured_at,raw_payload,evidence_kind)
      VALUES ($1,'Phase 4 company verification',$2,$3,$4,$5,'company_verification')
      ON CONFLICT (company_id,provider_name,source_url) DO UPDATE SET
        captured_at=EXCLUDED.captured_at,raw_payload=EXCLUDED.raw_payload`, [companyId, item.source_url,
      item.source_page_title, item.captured_at, JSON.stringify({ evidence_id: item.id, evidence_type: item.evidence_type })]);
  }
  await client.query(`UPDATE leadgen.companies SET
    source_record_count=(SELECT count(*) FROM leadgen.sources WHERE company_id=$1),
    verification_source_count=(SELECT count(*) FROM leadgen.sources WHERE company_id=$1)
    WHERE id=$1`, [companyId]);
}

async function promoteCandidate(client, candidate, job, marketProfile, assessment, evidence, contacts, socialAccounts) {
  const existing = matchExistingCompany(assessment, await existingCompaniesForMatch(client), contacts, marketProfile);
  const sizeBand = assessment.company_size.toLowerCase();
  let companyId;
  let promotionStatus;
  if (existing) {
    companyId = existing.company.id;
    promotionStatus = existing.company.research_job_id === job.id ? 'PROMOTED_NEW' : 'ENRICHED_EXISTING';
    await client.query(`
      UPDATE leadgen.companies SET
        website_url=coalesce(website_url,$2),official_root_domain=coalesce(official_root_domain,$3),
        company_size_band=CASE WHEN company_size_band='unknown' THEN $4 ELSE company_size_band END,
        procurement_access_fit=procurement_access_fit OR $5,
        sme_relevance=CASE WHEN sme_relevance='UNKNOWN' THEN $6 ELSE sme_relevance END,
        partnership_accessibility=CASE WHEN partnership_accessibility='UNKNOWN' THEN $7 ELSE partnership_accessibility END,
        strategic_account=strategic_account OR $8,phase4_verification_status='VERIFIED_BUSINESS',
        verification_status='VERIFIED',lifecycle_status='ACTIVE',last_verified_at=now(),
        verification_freshness='CURRENT',explicit_exclusion_reason=NULL,updated_at=now()
      WHERE id=$1`, [companyId, assessment.official_website, assessment.official_root_domain, sizeBand,
      ['HIGH','MEDIUM'].includes(assessment.partnership_accessibility), assessment.sme_relevance,
      assessment.partnership_accessibility, assessment.strategic_account]);
  } else {
    const identityKey = assessment.official_root_domain || normalizeCompanyName(assessment.resolved_company_name, marketProfile).replace(/\s+/g, '-');
    const { rows } = await client.query(`
      INSERT INTO leadgen.companies
        (company_name,normalized_domain,country_code,country_name,city,region,service_region,website_url,official_root_domain,
         company_type,company_description,product_categories,qualification_status,data_origin,research_job_id,
         last_collected_at,company_size_band,procurement_access_fit,size_evidence,sme_relevance,
         partnership_accessibility,strategic_account,phase4_verification_status,
         verification_status,lifecycle_status,last_verified_at,verification_freshness)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'needs_review','live_discovered',$13,now(),$14,$15,$16,$17,$18,$19,'VERIFIED_BUSINESS',
        'VERIFIED','ACTIVE',now(),'CURRENT')
      RETURNING id`, [assessment.resolved_company_name, `live:${marketProfile.countryCode.toLowerCase()}:${identityKey}`,
      marketProfile.countryCode, marketProfile.countryName || job.country_name || job.country,
      job.city, job.region, job.region || job.city || marketProfile.countryName,
      assessment.official_website, assessment.official_root_domain, companyTypeSummary(assessment.business_types),
      'Company identity and buyer activity confirmed.', [job.product_category], job.id,
      sizeBand, ['HIGH','MEDIUM'].includes(assessment.partnership_accessibility), assessment.company_size_method,
      assessment.sme_relevance, assessment.partnership_accessibility, assessment.strategic_account]);
    companyId = rows[0].id;
    promotionStatus = 'PROMOTED_NEW';
  }
  await attachCompanySources(client, companyId, evidence);
  await attachPromotedContacts(client, companyId, contacts);
  await persistSocialAccounts(client, candidate, companyId, socialAccounts);
  await client.query('UPDATE leadgen.company_verification_evidence SET company_id=$2 WHERE research_candidate_id=$1', [candidate.id, companyId]);
  return { companyId, promotionStatus, duplicateMethod: existing?.method || null };
}

async function verifyOne(pool, candidate, job, config, checker) {
  const marketProfile = marketProfileForJob(job);
  const contacts = await loadCandidateContacts(pool, candidate.id);
  const crawl = await crawlCandidate(candidate, job, marketProfile, config, checker);
  const pageEvidence = crawl.pages.flatMap(page => page.evidence);
  const contactEvidence = contacts.map(contact => ({
    evidence_type: 'PUBLIC_CONTACT', evidence_value: contact.contact_value,
    evidence_text: `${contact.contact_type}: ${contact.contact_value}`,
    source_type: 'PUBLIC_CONTACT_PAGE', source_url: contact.source_url,
    source_page_title: contact.source_page_title, confidence: 0.95,
    verification_method: contact.verification_method, captured_at: contact.captured_at
  }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seed = await client.query(`
      INSERT INTO leadgen.research_candidate_verifications
        (research_candidate_id,research_job_id,verification_status,promotion_status)
      VALUES ($1,$2,'REVIEW','NOT_READY')
      ON CONFLICT (research_candidate_id) DO UPDATE SET
        verification_status='REVIEW',promotion_status='NOT_READY',company_id=NULL,
        rejection_reason_codes='{}',updated_at=now(),verified_at=NULL
      RETURNING id`, [candidate.id, candidate.research_job_id]);
    const verificationId = seed.rows[0].id;
    await client.query('DELETE FROM leadgen.company_verification_evidence WHERE research_candidate_id=$1', [candidate.id]);
    await client.query("DELETE FROM leadgen.company_social_accounts WHERE research_candidate_id=$1 AND source_type<>'TAVILY_BASIC_SEARCH'", [candidate.id]);
    const evidence = await insertEvidence(client, verificationId, candidate, [...pageEvidence, ...contactEvidence]);
    const pageBundles = crawl.pages.map(page => ({ evidence: evidence.filter(item => item.source_url === page.url) }));
    const officialCandidate = {
      ...candidate,
      final_url: crawl.officialWebsiteUrl || candidate.final_url,
      discovered_external_website: candidate.discovered_external_website ? crawl.officialWebsiteUrl : candidate.discovered_external_website
    };
    const official = resolveOfficialWebsite(officialCandidate, pageBundles, marketProfile);
    const resolvedName = crawl.pages.map(page => page.resolvedName).find(name => name && !/^(?:home|about|contact)/i.test(name)) || candidate.title;
    const businessTypes = assessBusinessTypes(evidence);
    const size = assessCompanySize(evidence);
    const regionalEvidence = evidence.some(item => ['LOCATION','REGIONAL_COVERAGE'].includes(item.evidence_type));
    const consumerOnly = evidence.some(item => item.evidence_type === 'RETAIL_CHANNEL')
      && !Object.values(businessTypes).some(item => ['VERIFIED','SUPPORTED'].includes(item.status));
    const accessibility = assessPartnershipAccessibility({
      companySize: size.company_size, businessTypes, contacts, regionalEvidence, consumerOnly
    });
    const sme = assessSmeRelevance({
      companySize: size.company_size, businessTypes, directContacts: contacts.length, regionalEvidence
    });
    const strategic = strategicAccountAssessment(size.company_size, evidence);
    const identityEvidence = evidence.filter(item => item.evidence_type === 'COMPANY_IDENTITY');
    const locationEvidence = evidence.filter(item => item.evidence_type === 'LOCATION');
    const businessEvidenceIds = Object.values(businessTypes).flatMap(item => item.evidenceIds);
    const materialBusiness = Object.values(businessTypes).some(item => ['VERIFIED','SUPPORTED'].includes(item.status));
    const rejected = REJECTED_TYPES.has(candidate.candidate_type);
    const mandatory = identityEvidence.length > 0 && locationEvidence.length > 0
      && official.confidence >= 0.7 && materialBusiness;
    const verificationStatus = rejected ? 'REJECTED' : mandatory ? 'VERIFIED_BUSINESS' : 'REVIEW';
    const rejectionReasons = rejected ? ['NON_BUSINESS_RESULT_TYPE']
      : consumerOnly ? ['CONSUMER_ONLY_RETAIL']
        : !identityEvidence.length ? ['BUSINESS_IDENTITY_NOT_RESOLVED']
          : !locationEvidence.length ? ['TARGET_MARKET_EVIDENCE_MISSING']
            : !materialBusiness ? ['TARGET_BUSINESS_ACTIVITY_NOT_SUPPORTED']
              : official.confidence < 0.7 ? ['OFFICIAL_WEBSITE_NOT_RESOLVED'] : [];
    const socialAccounts = crawl.socialAccounts.filter(item => item.account_type === 'BUSINESS');
    await persistSocialAccounts(client, candidate, null, socialAccounts);
    const socialCount = await client.query('SELECT count(*)::int AS count FROM leadgen.company_social_accounts WHERE research_candidate_id=$1', [candidate.id]);
    const persistedSocialCount = socialCount.rows[0].count;
    const assessment = {
      resolved_company_name: resolvedName,
      normalized_company_name: normalizeCompanyName(resolvedName, marketProfile),
      official_website: official.website,
      official_root_domain: official.root_domain,
      country_code: marketProfile.countryCode,
      country_name: marketProfile.countryName || job.country_name || job.country,
      market_profile: marketProfile.profileKey,
      city: job.city,
      region: job.region,
      business_types: businessTypes,
      company_size: size.company_size,
      company_size_confidence: size.confidence,
      company_size_method: size.method,
      sme_relevance: sme.value,
      partnership_accessibility: accessibility.value,
      partnership_accessibility_confidence: accessibility.confidence,
      strategic_account: strategic.strategic_account
    };
    let promotion = { companyId: null, promotionStatus: rejected ? 'REJECTED' : 'NOT_READY', duplicateMethod: null };
    if (verificationStatus === 'VERIFIED_BUSINESS' && config.promote) {
      promotion = await promoteCandidate(client, candidate, job, marketProfile, assessment, evidence, contacts, socialAccounts);
    } else if (verificationStatus === 'VERIFIED_BUSINESS') promotion.promotionStatus = 'READY_TO_PROMOTE';
    await client.query(`
      UPDATE leadgen.research_candidate_verifications SET
        company_id=$2,verification_status=$3,resolved_company_name=$4,normalized_company_name=$5,
        official_website=$6,official_root_domain=$7,official_website_confidence=$8,
        country_code=$9,country_name=$10,market_profile=$11,city=$12,region=$13,
        importer_status=$14,wholesaler_status=$15,distributor_status=$16,general_trading_status=$17,
        company_size=$18,company_size_confidence=$19,company_size_method=$20,size_evidence_ids=$21,
        sme_relevance=$22,sme_reason_codes=$23,partnership_accessibility=$24,
        partnership_accessibility_confidence=$25,accessibility_reason_codes=$26,
        accessibility_evidence_ids=$27,business_type_evidence_ids=$28,strategic_account=$29,
        strategic_reason_codes=$30,social_enrichment_status=$31,promotion_status=$32,
        rejection_reason_codes=$33,updated_at=now(),verified_at=now()
      WHERE id=$1`, [verificationId, promotion.companyId, verificationStatus, resolvedName,
      assessment.normalized_company_name, official.website, official.root_domain, official.confidence,
      assessment.country_code, assessment.country_name, assessment.market_profile, job.city, job.region,
      businessTypes.importer.status, businessTypes.wholesaler.status,
      businessTypes.distributor.status, businessTypes.generalTrading.status, size.company_size,
      size.confidence, size.method, size.evidenceIds, sme.value, sme.reasonCodes, accessibility.value,
      accessibility.confidence, accessibility.reasonCodes,
      evidence.filter(item => ['PUBLIC_CONTACT','REGIONAL_COVERAGE','LOCATION','WHOLESALER','DISTRIBUTOR','IMPORTER','GENERAL_TRADING'].includes(item.evidence_type)).map(item => item.id),
      businessEvidenceIds, strategic.strategic_account, strategic.reasonCodes,
      socialAccounts.length ? 'COMPLETED' : 'NO_PUBLIC_ACCOUNT', promotion.promotionStatus, rejectionReasons]);
    await client.query('COMMIT');
    return {
      candidate_id: candidate.id, verification_status: verificationStatus,
      promotion_status: promotion.promotionStatus, company_id: promotion.companyId,
      pages_fetched: crawl.pages.length, social_accounts: persistedSocialCount,
      company_size: size.company_size, sme_relevance: sme.value,
      partnership_accessibility: accessibility.value, strategic_account: strategic.strategic_account
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function socialFallback(pool, job, results, config) {
  if (!config.allowSocialSearch || !config.searchConfig?.tavilyApiKey) return { requests: 0, credits: 0, accounts: 0 };
  const marketProfile = marketProfileForJob(job);
  const provider = createSearchProvider({ ...config.searchConfig, provider: 'tavily' });
  const selected = results.filter(item => item.verification_status !== 'REJECTED' && item.social_accounts === 0);
  const searchAudit=String(provider.name||'').toLowerCase()==='tavily'
    ?new TavilyUsageAudit({provider,pool,...(config.tavilyUsageConfig||{})}):null;
  let requests = 0;
  let credits = 0;
  let accounts = 0;
  for (const item of selected) {
    const verification = await pool.query('SELECT * FROM leadgen.research_candidate_verifications WHERE research_candidate_id=$1', [item.candidate_id]);
    const row = verification.rows[0];
    if (!row?.resolved_company_name) continue;
    requests += 1;
    let candidateAccounts = 0;
    try {
      const request={
        query: `"${row.resolved_company_name}" ${marketLocationText(job, marketProfile)} ${marketProfile.preferredSocialPlatforms.join(' ')}`,
        count: 5,
        country: searchCountryCode(job.country_name || job.country, marketProfile.countryCode),
        locationName: marketLocationText(job, marketProfile),
        searchLang: marketSearchLanguage(job, marketProfile),
        tag: `dpv-phase4-social:${job.id}`
      };
      const response = searchAudit?await searchAudit.search({researchJobId:job.id,companyId:row.company_id,
        productProfile:job.product_profile,purpose:'COMPANY_SOCIAL_EVIDENCE',budgetPool:'EVIDENCE',request}):await provider.search(request);
      credits += Number(response.credits || 0);
      for (const result of response.results) {
        const social = classifySocialUrl(result.url);
        if (!social || social.account_type !== 'BUSINESS'
          || !socialResultMatchesCompany(row.resolved_company_name, result, marketProfile)) continue;
        const { rowCount } = await pool.query(`
          INSERT INTO leadgen.company_social_accounts
            (company_id,research_candidate_id,platform,profile_url,normalized_profile_url,account_type,
             verification_status,source_url,source_type,captured_at)
          VALUES ($1,$2,$3,$4,$5,'BUSINESS','PUBLIC_SEARCH_MATCH',$4,'TAVILY_BASIC_SEARCH',now())
          ON CONFLICT (research_candidate_id,normalized_profile_url) DO NOTHING`, [
          row.company_id, item.candidate_id, social.platform, result.url, social.normalized_profile_url]);
        accounts += rowCount;
        candidateAccounts += rowCount;
      }
      if (candidateAccounts) await pool.query("UPDATE leadgen.research_candidate_verifications SET social_enrichment_status='PARTIAL',updated_at=now() WHERE id=$1", [row.id]);
    } catch {}
  }
  return { requests, credits, accounts };
}

export async function verifyResearchCandidates(pool, jobId, config = {}, overrides = {}) {
  const jobResult = await pool.query('SELECT * FROM leadgen.research_jobs WHERE id=$1', [jobId]);
  if (!jobResult.rowCount) throw new Error('Research job not found');
  const job = jobResult.rows[0];
  const { rows: candidates } = await pool.query(`
    SELECT * FROM leadgen.research_candidates WHERE research_job_id=$1 ORDER BY rank,title`, [jobId]);
  const effective = {
    maxPages: Math.max(1, Math.min(8, Number(config.maxPages || 8))),
    timeoutMs: Math.max(1000, Number(config.timeoutMs || 10000)),
    maxResponseBytes: Math.max(10000, Number(config.maxResponseBytes || 2000000)),
    delayMs: Math.max(0, Number(config.delayMs || 350)),
    userAgent: config.userAgent || 'DPVLeadResearchDemo/1.0',
    maxRedirects: 5,
    promote: config.promote !== false,
    allowSocialSearch: config.allowSocialSearch === true,
    searchConfig: config.searchConfig,
    tavilyUsageConfig:config.tavilyUsageConfig
  };
  const checker = overrides.checker || new WebsiteReachabilityChecker({
    timeoutMs: effective.timeoutMs, maxResponseBytes: effective.maxResponseBytes,
    userAgent: effective.userAgent, maxRedirects: effective.maxRedirects,
    fetchImpl: overrides.fetchImpl, lookupImpl: overrides.lookupImpl
  });
  const results = [];
  for (const candidate of candidates) {
    try { results.push(await verifyOne(pool, candidate, job, effective, checker)); }
    catch (error) {
      await pool.query(`
        INSERT INTO leadgen.research_candidate_verifications
          (research_candidate_id,research_job_id,verification_status,promotion_status,rejection_reason_codes,verified_at)
        VALUES ($1,$2,'REVIEW','NOT_READY',$3,now())
        ON CONFLICT (research_candidate_id) DO UPDATE SET verification_status='REVIEW',promotion_status='NOT_READY',
          rejection_reason_codes=EXCLUDED.rejection_reason_codes,updated_at=now(),verified_at=now()`, [
        candidate.id, jobId, ['CANDIDATE_VERIFICATION_FAILED']]);
      results.push({ candidate_id: candidate.id, verification_status: 'REVIEW', promotion_status: 'NOT_READY',
        pages_fetched: 0, social_accounts: 0, company_size: 'UNKNOWN', sme_relevance: 'UNKNOWN',
        partnership_accessibility: 'UNKNOWN', strategic_account: false, error: String(error.message || 'Verification failed').slice(0, 300) });
    }
  }
  const fallback = await socialFallback(pool, job, results, effective);
  const counts = {
    verified: results.filter(item => item.verification_status === 'VERIFIED_BUSINESS').length,
    review: results.filter(item => item.verification_status === 'REVIEW').length,
    rejected: results.filter(item => item.verification_status === 'REJECTED').length,
    strategic: results.filter(item => item.strategic_account).length,
    sme: results.filter(item => ['HIGH','MEDIUM'].includes(item.sme_relevance)).length,
    pages: results.reduce((sum, item) => sum + item.pages_fetched, 0),
    social: results.reduce((sum, item) => sum + item.social_accounts, 0) + fallback.accounts,
    promotedNew: results.filter(item => item.promotion_status === 'PROMOTED_NEW').length,
    enrichedExisting: results.filter(item => item.promotion_status === 'ENRICHED_EXISTING').length
  };
  await pool.query(`
    UPDATE leadgen.research_jobs SET
      candidates_verified=$2,candidates_in_review=$3,candidates_rejected_phase4=$4,
      strategic_accounts_found=$5,sme_opportunities_found=$6,verification_pages_fetched=$7,
      social_accounts_found=$8,
      companies_promoted_new=$9,companies_enriched_existing=$10,
      companies_crawled=$11,companies_qualified=$2,companies_review=$3,companies_rejected=$4
    WHERE id=$1`, [jobId, counts.verified, counts.review, counts.rejected, counts.strategic,
    counts.sme, counts.pages, counts.social,
    counts.promotedNew, counts.enrichedExisting, candidates.length]);
  return { job_id: jobId, candidates_checked: candidates.length, ...counts,
    social_provider_calls: fallback.requests, social_provider_credits: fallback.credits, results };
}
