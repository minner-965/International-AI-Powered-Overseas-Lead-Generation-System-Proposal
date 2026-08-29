import { BraveSearchProvider } from './BraveSearchProvider.js';
import { DataForSeoSearchProvider } from './DataForSeoSearchProvider.js';
import { TavilySearchProvider } from './TavilySearchProvider.js';
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
  const generated = generateResearchQueries(job, { maxQueries: config.maxQueries });
  const rows = [];
  for (const query of generated) {
    const result = await client.query(`
      INSERT INTO leadgen.research_search_queries
        (research_job_id,query_text,query_type,country,country_code,country_name,city,region,
         preferred_language,market_profile,product_category,buyer_type,provider,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING')
      ON CONFLICT (research_job_id,query_text) DO UPDATE SET provider=EXCLUDED.provider
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
  const client = await pool.connect();
  try {
    const jobResult = await client.query('SELECT * FROM leadgen.research_jobs WHERE id=$1', [jobId]);
    if (!jobResult.rowCount) throw new Error('Research job not found');
    const job = jobResult.rows[0];
    let queryResult = await client.query('SELECT * FROM leadgen.research_search_queries WHERE research_job_id=$1 ORDER BY created_at,id', [jobId]);
    if (!queryResult.rowCount) {
      await client.query('BEGIN');
      await persistGeneratedQueries(client, job, config);
      await client.query('COMMIT');
      queryResult = await client.query('SELECT * FROM leadgen.research_search_queries WHERE research_job_id=$1 ORDER BY created_at,id', [jobId]);
    }

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
    const resultDepth = String(config.provider).toLowerCase() === 'tavily'
      ? config.resultsPerQuery
      : Math.max(config.resultsPerQuery, Math.min(20, job.max_results));
    for (const query of queryResult.rows.slice(0, config.maxQueries)) {
      requests += 1;
      await client.query("UPDATE leadgen.research_search_queries SET status='RUNNING',error_message=NULL WHERE id=$1", [query.id]);
      try {
        const response = await provider.search({
          query: query.query_text,
          count: resultDepth,
          country: searchCountryCode(job.country_name || job.country, marketProfile.countryCode),
          countryName: marketProfile.countryName,
          locationName,
          searchLang: marketSearchLanguage(job, marketProfile),
          tag: `dpv-phase4:${jobId}`
        });
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
          search_api_requests=$3,
          search_successful_requests=0,
          search_failed_requests=$2,
          search_raw_results=0,
          search_credits_used=$5,
          search_runtime_ms=$4
        WHERE id=$1`, [jobId, failed, requests, Date.now() - started, creditsUsed]);
      const error = new Error('All search queries failed');
      error.code = 'ALL_SEARCH_QUERIES_FAILED';
      throw error;
    }

    const merged = mergeSearchCandidates(discoveries, job.max_results, { marketProfile, productProfile });
    await client.query('BEGIN');
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
        search_api_requests=$4,
        search_successful_requests=$5,
        search_failed_requests=$6,
        search_raw_results=$7,
        search_noise_rejected=$8,
        search_duplicates_removed=$9,
        search_runtime_ms=$10,
        search_credits_used=$11
      WHERE id=$1`, [jobId, merged.candidates.length, failed, requests, successful, failed,
      rawResults, merged.rejected, merged.duplicates, runtimeMs, creditsUsed]);
    await client.query('COMMIT');
    return {
      job_id: jobId,
      provider: provider.name,
      query_count: queryResult.rows.length,
      api_requests: requests,
      successful_requests: successful,
      failed_requests: failed,
      raw_results: rawResults,
      noise_rejected: merged.rejected,
      duplicates_removed: merged.duplicates,
      candidates_found: merged.candidates.length,
      credits_used: creditsUsed,
      runtime_ms: Date.now() - started
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}
