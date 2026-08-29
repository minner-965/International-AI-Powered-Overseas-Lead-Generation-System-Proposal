import { extractPublicContacts } from './ContactExtractor.js';
import { discoverCompanyPages, discoverExternalWebsite } from './pageDiscovery.js';
import { WebsiteReachabilityChecker } from './WebsiteReachabilityChecker.js';
import { extractRootDomain, normalizeUrl } from '../search/resultNormalizer.js';
import { marketProfileForJob } from '../market/marketProfiles.js';

const crawlableTypes = new Set(['POSSIBLE_COMPANY_SITE', 'OFFICIAL_SITE_CANDIDATE']);
const profileTypes = new Set(['DIRECTORY_PROFILE', 'TRADE_SHOW_PROFILE']);

function looksLikeBusinessProfile(candidate) {
  if (profileTypes.has(candidate.candidate_type)) return true;
  return /(?:business\s+directory|merchant\s+listing|companies\s+in|suppliers?\s+in|distributors?\s+in|\/listing\/|\/directory\/|\/distributor\/)/i
    .test(`${candidate.title || ''} ${candidate.url || ''}`);
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function candidatePriority(candidate) {
  const type = { POSSIBLE_COMPANY_SITE: 0, OFFICIAL_SITE_CANDIDATE: 0, TRADE_SHOW_PROFILE: 1, DIRECTORY_PROFILE: 2 }[candidate.candidate_type] ?? 9;
  return type * 100000 - Math.round((Number(candidate.provider_score) || 0) * 10000) + Number(candidate.rank || 999);
}

function auditRow(result) {
  return {
    requested_url: result.requested_url,
    final_url: result.final_url,
    http_status: result.http_status,
    reachable: result.reachable,
    content_type: result.content_type,
    page_title: result.page_title,
    robots_allowed: result.robots_allowed,
    fetch_status: result.fetch_status,
    error_message: result.error_message,
    captured_at: result.captured_at
  };
}

async function extractFromResult(result, options) {
  if (!result.reachable || !result.html) return { title: result.page_title, contacts: [] };
  return extractPublicContacts(result.html, result.final_url || result.requested_url, {
    capturedAt: result.captured_at,
    resolveMxImpl: options.resolveMxImpl,
    marketProfile: options.marketProfile,
    phoneCountryCode: options.marketProfile?.phoneCountryCode || null
  });
}

function addUniqueTarget(targets, url) {
  const normalized = normalizeUrl(url);
  if (normalized && !targets.some(item => normalizeUrl(item) === normalized)) targets.push(normalized);
}

async function inspectCandidate(candidate, checker, config, options) {
  const fetches = [];
  const contacts = [];
  let discoveredExternalWebsite = null;
  const primary = await checker.fetchPage(candidate.url);
  fetches.push(auditRow(primary));
  const primaryExtracted = await extractFromResult(primary, options);
  const aggregateDirectory = looksLikeBusinessProfile(candidate)
    && (/\/brand-description\/.*\/all\//i.test(candidate.url)
      || /top dealers?\s*&\s*suppliers?|business directory|merchant listing|companies in|suppliers in|distributors? in/i.test(candidate.title));
  if (!aggregateDirectory) contacts.push(...primaryExtracted.contacts);

  if (primary.reachable && looksLikeBusinessProfile(candidate)) {
    discoveredExternalWebsite = discoverExternalWebsite(primary.html, primary.final_url || candidate.url);
  }

  if (primary.reachable && crawlableTypes.has(candidate.candidate_type) && contacts.length === 0) {
    const maxPages = Math.max(1, Number(config.maxPagesPerCandidate || 4));
    const targets = [];
    const primaryUrl = primary.final_url || candidate.url;
    const primaryParsed = new URL(primaryUrl);
    const homepage = `${primaryParsed.origin}/`;
    if (normalizeUrl(primaryUrl) !== normalizeUrl(homepage)) addUniqueTarget(targets, homepage);
    const discovered = discoverCompanyPages(primary.html, primaryUrl);
    addUniqueTarget(targets, discovered.contactUrl);
    if (!discovered.contactUrl) {
      addUniqueTarget(targets, new URL('/contact', primaryUrl).href);
      addUniqueTarget(targets, new URL('/contact-us', primaryUrl).href);
    }
    addUniqueTarget(targets, discovered.aboutUrl);

    let targetIndex = 0;
    while (targetIndex < targets.length && fetches.length < maxPages) {
      const target = targets[targetIndex];
      targetIndex += 1;
      const allowed = await checker.robotsAllows(target);
      if (!allowed) {
        fetches.push({
          requested_url: target, final_url: null, http_status: null, reachable: false, content_type: null,
          page_title: null, robots_allowed: false, fetch_status: 'BLOCKED_BY_ROBOTS',
          error_message: 'Disallowed by robots.txt', captured_at: new Date()
        });
        continue;
      }
      await delay(config.delayMs);
      const result = await checker.fetchPage(target, { robotsAllowed: true });
      fetches.push(auditRow(result));
      const extracted = await extractFromResult(result, options);
      contacts.push(...extracted.contacts);
      if (result.reachable && result.html && contacts.length === 0) {
        const nextPages = discoverCompanyPages(result.html, result.final_url || target);
        addUniqueTarget(targets, nextPages.contactUrl);
        addUniqueTarget(targets, nextPages.aboutUrl);
      }
      if (contacts.length) break;
    }
  }

  const reachableFetches = fetches.filter(item => item.reachable);
  const uniqueContacts = [];
  const seen = new Set();
  for (const contact of contacts) {
    const key = `${contact.contact_type}|${contact.normalized_value}|${contact.source_url}`;
    if (!seen.has(key)) { seen.add(key); uniqueContacts.push(contact); }
  }
  const contactability = uniqueContacts.length ? 'CONTACTABLE'
    : reachableFetches.length ? 'REACHABLE_NO_PUBLIC_CONTACT'
      : fetches.every(item => item.fetch_status === 'HTTP_ERROR') ? 'UNREACHABLE' : 'CHECK_FAILED';
  return {
    fetches,
    contacts: uniqueContacts,
    discoveredExternalWebsite,
    websiteReachable: reachableFetches.length > 0,
    httpStatus: primary.http_status,
    finalUrl: reachableFetches[0]?.final_url || primary.final_url || null,
    contactability
  };
}

async function persistCandidateInspection(pool, candidate, inspection) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM leadgen.research_candidate_contacts WHERE research_candidate_id=$1', [candidate.id]);
    await client.query('DELETE FROM leadgen.research_candidate_fetches WHERE research_candidate_id=$1', [candidate.id]);
    for (const fetchResult of inspection.fetches) {
      await client.query(`
        INSERT INTO leadgen.research_candidate_fetches
          (research_candidate_id,requested_url,final_url,http_status,reachable,content_type,page_title,
           robots_allowed,fetch_status,error_message,captured_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        candidate.id, fetchResult.requested_url, fetchResult.final_url, fetchResult.http_status,
        fetchResult.reachable, fetchResult.content_type, fetchResult.page_title, fetchResult.robots_allowed,
        fetchResult.fetch_status, fetchResult.error_message, fetchResult.captured_at
      ]);
    }
    for (const contact of inspection.contacts) {
      await client.query(`
        INSERT INTO leadgen.research_candidate_contacts
          (research_candidate_id,contact_type,contact_value,normalized_value,source_url,source_page_title,
           verification_status,verification_method,syntax_valid,mx_present,captured_at,
           phone_country_context,normalization_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (research_candidate_id,contact_type,normalized_value,source_url) DO NOTHING`, [
        candidate.id, contact.contact_type, contact.contact_value, contact.normalized_value,
        contact.source_url, contact.source_page_title, contact.verification_status,
        contact.verification_method, contact.syntax_valid, contact.mx_present, contact.captured_at,
        contact.phone_country_context || null,
        contact.normalization_status || (contact.contact_type === 'EMAIL' ? 'NOT_APPLICABLE' : 'LEGACY_UNSPECIFIED')
      ]);
    }
    await client.query(`
      UPDATE leadgen.research_candidates SET
        website_reachable=$2,http_status=$3,final_url=$4,checked_at=now(),contactability_status=$5,
        discovered_external_website=$6,updated_at=now()
      WHERE id=$1`, [candidate.id, inspection.websiteReachable, inspection.httpStatus,
      inspection.finalUrl, inspection.contactability, inspection.discoveredExternalWebsite]);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function checkResearchCandidateContacts(pool, jobId, config = {}, overrides = {}) {
  const checker = overrides.checker || new WebsiteReachabilityChecker({
    timeoutMs: config.timeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    userAgent: config.userAgent,
    maxRedirects: config.maxRedirects,
    fetchImpl: overrides.fetchImpl,
    lookupImpl: overrides.lookupImpl
  });
  const jobResult = await pool.query('SELECT * FROM leadgen.research_jobs WHERE id=$1', [jobId]);
  if (!jobResult.rowCount) throw new Error('Research job not found');
  const marketProfile = marketProfileForJob(jobResult.rows[0]);
  const candidateResult = await pool.query(`
    SELECT * FROM leadgen.research_candidates
    WHERE research_job_id=$1 AND candidate_type = ANY($2::text[])
    ORDER BY rank,title`, [jobId, [...crawlableTypes, ...profileTypes]]);
  const selected = candidateResult.rows.sort((a, b) => candidatePriority(a) - candidatePriority(b))
    .slice(0, Math.max(1, Number(config.maxCandidates || 5)));

  for (const candidate of selected) {
    let inspection;
    try { inspection = await inspectCandidate(candidate, checker, config, { ...overrides, marketProfile }); }
    catch (error) {
      inspection = {
        fetches: [{
          requested_url: candidate.url, final_url: null, http_status: null, reachable: false,
          content_type: null, page_title: null, robots_allowed: null, fetch_status: 'NETWORK_ERROR',
          error_message: String(error.message || 'Candidate check failed').slice(0, 500), captured_at: new Date()
        }],
        contacts: [], discoveredExternalWebsite: null, websiteReachable: false,
        httpStatus: null, finalUrl: null, contactability: 'CHECK_FAILED'
      };
    }
    await persistCandidateInspection(pool, candidate, inspection);
  }

  const summary = await pool.query(`
    SELECT
      count(DISTINCT c.id) FILTER (WHERE checked_at IS NOT NULL)::int AS candidates_checked,
      count(DISTINCT c.id) FILTER (WHERE website_reachable)::int AS reachable_candidates,
      count(DISTINCT c.id) FILTER (WHERE contactability_status='CONTACTABLE')::int AS contactable_candidates,
      count(ct.id) FILTER (WHERE ct.contact_type='EMAIL')::int AS public_emails_found,
      count(ct.id) FILTER (WHERE ct.contact_type='PHONE')::int AS public_phones_found,
      count(ct.id) FILTER (WHERE ct.contact_type='WHATSAPP')::int AS public_whatsapp_found,
      count(ct.id) FILTER (WHERE ct.contact_type='CONTACT_FORM')::int AS contact_forms_found
    FROM leadgen.research_candidates c
    LEFT JOIN leadgen.research_candidate_contacts ct ON ct.research_candidate_id=c.id
    WHERE c.research_job_id=$1`, [jobId]);
  const counters = summary.rows[0];
  await pool.query(`
    UPDATE leadgen.research_jobs SET
      candidates_checked=$2,reachable_candidates=$3,contactable_candidates=$4,
      public_emails_found=$5,public_phones_found=$6,public_whatsapp_found=$7,contact_forms_found=$8
    WHERE id=$1`, [jobId, counters.candidates_checked, counters.reachable_candidates,
    counters.contactable_candidates, counters.public_emails_found, counters.public_phones_found,
    counters.public_whatsapp_found, counters.contact_forms_found]);
  return counters;
}

export function candidateRootDomain(value) {
  return extractRootDomain(value);
}
