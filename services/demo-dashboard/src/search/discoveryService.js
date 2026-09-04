import { BraveSearchProvider } from './BraveSearchProvider.js';
import { DataForSeoSearchProvider } from './DataForSeoSearchProvider.js';
import { TavilySearchProvider } from './TavilySearchProvider.js';
import { TavilyUsageAudit } from './TavilyUsageAudit.js';
import { generateResearchQueries, searchCountryCode } from './queryGenerator.js';
import { normalizeSearchResult } from './resultNormalizer.js';
import { mergeSearchCandidates } from './resultFilter.js';
import { marketProfileForJob, marketProviderLocationName, marketSearchLanguage } from '../market/marketProfiles.js';
import { getProductCategoryProfile } from '../market/productProfiles.js';

export function createSearchProvider(config = {}, overrides = {}) {
  const providerName = String(config.provider || 'brave').toLowerCase();
  if (overrides.provider) return overrides.provider;
  if (providerName === 'brave') return new BraveSearchProvider({
    apiKey: config.braveApiKey,
    timeoutMs: config.timeoutMs,
    fetchImpl: overrides.fetchImpl
  });
  if (providerName === 'dataforseo') return new DataForSeoSearchProvider({
    login: config.dataForSeoLogin,
    password: config.dataForSeoPassword,
    timeoutMs: config.timeoutMs,
    fetchImpl: overrides.fetchImpl
  });
  if (providerName === 'tavily') return new TavilySearchProvider({
    apiKey: config.tavilyApiKey,
    endpoint: config.tavilyEndpoint,
    searchDepth: config.tavilySearchDepth,
    timeoutMs: config.timeoutMs,
    fetchImpl: overrides.fetchImpl
  });
  throw new Error(`Unsupported search provider: ${providerName}`);
}

export async function persistGeneratedQueries(client, job, config) {
  const generated = generateResearchQueries(job);
  const rows = [];
  for (const query of generated) {
    const result = await client.query(`
      INSERT INTO leadgen.research_search_queries
        (research_job_id,query_text,query_type,country,country_code,country_name,city,region,
         preferred_language,market_profile,product_category,buyer_type,provider,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING')
      ON CONFLICT (research_job_id,query_text) WHERE company_id IS NULL
      DO UPDATE SET provider=EXCLUDED.provider
      RETURNING *`, [job.id, query.query_text, query.query_type, query.country, query.country_code,
      query.country_name, query.city, query.region, query.preferred_language, query.market_profile,
      query.product_category, query.buyer_type, config.provider]);
    rows.push(result.rows[0]);
  }
  return rows;
}

export async function discoverResearchCandidates(pool, jobId, config, overrides = {}) {
  if (String(config.provider || '').toLowerCase() === 'brave' && !config.storageRightsConfirmed) {
    const error = new Error('Search provider storage rights are not confirmed');
    error.code = 'STORAGE_RIGHTS_NOT_CONFIRMED';
    throw error;
  }
  const started = Date.now();
  const provider = createSearchProvider(config, overrides);
  const searchAudit=String(provider.name||'').toLowerCase()==='tavily'
    ?new TavilyUsageAudit({provider,pool,...(overrides.tavilyUsageConfig||{})}):null;
  const client = await pool.connect();
  try {
    const jobResult = await client.query('SELECT * FROM leadgen.research_jobs WHERE id=$1', [jobId]);
    if (!jobResult.rowCount) throw new Error('Research job not found');
    const job = jobResult.rows[0];
    await client.query('BEGIN');
    await persistGeneratedQueries(client, job, config);
    await client.query('COMMIT');
    const queryResult = await client.query('SELECT * FROM leadgen.research_search_queries WHERE research_job_id=$1 ORDER BY created_at,id', [jobId]);

    const discoveries = [];
    let requests = 0;
    let successful = 0;
    let failed = 0;
    let rawResults = 0;
    let creditsUsed = 0;
    const capturedAt = new Date();
    const marketProfile = marketProfileForJob(job);
    const productProfile = getProductCategoryProfile(job.product_category);
    const locationName = marketProviderLocationName(job, marketProfile);
    const targetResults = Math.max(1, Number(job.max_results) || 1);
    const resultDepth = Math.min(20, targetResults);
    let targetReached = false;
    for (const query of queryResult.rows) {
      requests += 1;
      await client.query("UPDATE leadgen.research_search_queries SET status='RUNNING',error_message=NULL WHERE id=$1", [query.id]);
      try {
        const request={
          query: query.query_text,
          count: resultDepth,
          country: searchCountryCode(job.country_name || job.country, marketProfile.countryCode),
          countryName: marketProfile.countryName,
          locationName,
          searchLang: marketSearchLanguage(job, marketProfile),
          tag: `dpv-phase4:${jobId}`
        };
        const response=searchAudit?await searchAudit.search({researchJobId:job.id,purpose:'NEW_COMPANY_DISCOVERY',
          budgetPool:'DISCOVERY',request,persistResults:async()=>({referenceIds:[]}),
          loadPersistedResults:async()=>{const cached=await client.query(`SELECT DISTINCT ON(c.normalized_url)
            c.title,c.url,c.snippet,c.provider_score,c.rank FROM leadgen.research_candidates c
            LEFT JOIN leadgen.research_candidate_queries cq ON cq.research_candidate_id=c.id
            WHERE c.research_job_id=$1 AND (c.search_query_id=$2 OR cq.research_search_query_id=$2)
            ORDER BY c.normalized_url,c.rank,c.id`,[job.id,query.id]);return cached.rows;}}):await provider.search(request);
        successful += 1;
        creditsUsed += Number(response.credits || 0);
        rawResults += response.results.length;
        await client.query(`UPDATE leadgen.research_search_queries SET status='COMPLETED',result_count=$2,error_message=NULL,executed_at=now() WHERE id=$1`, [query.id, response.results.length]);
        for (const result of response.results) {
          const normalized = normalizeSearchResult(result, {
            provider: provider.name,
            queryId: query.id,
            queryType: query.query_type,
            capturedAt
          });
          if (normalized) discoveries.push(normalized);
        }
        targetReached = mergeSearchCandidates(discoveries, targetResults, { marketProfile, productProfile }).candidates.length >= targetResults;
        if (targetReached) break;
      } catch (error) {
        failed += 1;
        const safeError = String(error.message || 'Search request failed').replace(/\s+/g, ' ').slice(0, 500);
        await client.query(`UPDATE leadgen.research_search_queries SET status='FAILED',result_count=0,error_message=$2,executed_at=now() WHERE id=$1`, [query.id, safeError]);
      }
    }
    if (!successful) {
      await client.query(`
        UPDATE leadgen.research_jobs SET
          error_count=$2,
          search_raw_results=0,
          search_runtime_ms=$3,
          search_api_requests=$2,
          search_successful_requests=0,
          search_failed_requests=$2
        WHERE id=$1`, [jobId, failed, Date.now() - started]);
      const error = new Error('All search queries failed');
      error.code = 'ALL_SEARCH_QUERIES_FAILED';
      throw error;
    }

    const merged = mergeSearchCandidates(discoveries, targetResults, { marketProfile, productProfile });
    await client.query('BEGIN');
    await client.query("DELETE FROM leadgen.research_search_queries WHERE research_job_id=$1 AND status='PENDING'", [jobId]);
    await client.query('DELETE FROM leadgen.research_candidates WHERE research_job_id=$1', [jobId]);
    for (const candidate of merged.candidates) {
      const inserted = await client.query(`
        INSERT INTO leadgen.research_candidates
          (research_job_id,search_query_id,provider,title,url,normalized_url,root_domain,snippet,provider_score,rank,candidate_type,candidate_status,captured_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id`, [jobId, candidate.search_query_id, candidate.provider, candidate.title, candidate.url,
        candidate.normalized_url, candidate.root_domain, candidate.snippet, candidate.provider_score, candidate.rank,
        candidate.candidate_type, candidate.candidate_status, candidate.captured_at]);
      for (const match of candidate.query_matches) {
        await client.query(`
          INSERT INTO leadgen.research_candidate_queries (research_candidate_id,research_search_query_id,rank)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [inserted.rows[0].id, match.search_query_id, match.rank]);
      }
    }
    const runtimeMs = Date.now() - started;
    await client.query(`
      UPDATE leadgen.research_jobs SET
        candidates_found=$2,
        error_count=$3,
        search_raw_results=$4,
        search_noise_rejected=$5,
        search_duplicates_removed=$6,
        search_runtime_ms=$7,
        search_api_requests=$8,
        search_successful_requests=$9,
        search_failed_requests=$10
      WHERE id=$1`, [jobId, merged.candidates.length, failed,
      rawResults, merged.rejected, merged.duplicates, runtimeMs, requests, successful, failed]);
    await client.query('COMMIT');
    return {
      job_id: jobId,
      provider: provider.name,
      query_count: queryResult.rows.length,
      strategies_executed: requests,
      api_requests: requests,
      successful_requests: successful,
      failed_requests: failed,
      raw_results: rawResults,
      noise_rejected: merged.rejected,
      duplicates_removed: merged.duplicates,
      candidates_found: merged.candidates.length,
      target_results: targetResults,
      completion_reason: targetReached ? 'TARGET_REACHED' : 'SEARCH_STRATEGIES_EXHAUSTED',
      credits_used: creditsUsed,
      runtime_ms: Date.now() - started
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}
