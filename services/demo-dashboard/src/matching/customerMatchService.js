import { CustomerMatchEngine } from './customerMatchEngine.js';
import { normalizeManagementProductScope } from './managementIcpProfiles.js';

function featureMap(rows) {
  return Object.fromEntries(rows.map(row => [row.feature_key, row]));
}

function fact(values, evidenceRows) {
  return {
    values: Array.isArray(values) ? values : values ? [values] : [],
    evidence_ids: evidenceRows.map(row => row.id).filter(Boolean)
  };
}

function requestedProductScope(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = [...new Set(values.map(normalizeManagementProductScope).filter(Boolean))];
  if (normalized.length > 1) {
    throw Object.assign(new Error('One Customer Match run must target exactly one product scope'), { code: 'MULTIPLE_PRODUCT_SCOPES' });
  }
  return normalized[0] || null;
}

function inferredProductScope(companyFacts = {}) {
  return requestedProductScope(companyFacts.product_scope?.values || companyFacts.product_scope?.value
    || companyFacts.product_categories?.values || companyFacts.product_categories?.value);
}

export class CustomerMatchService {
  constructor({ pool, engine = new CustomerMatchEngine() }) {
    if (!pool) throw new Error('CustomerMatchService requires a PostgreSQL pool');
    this.pool = pool;
    this.engine = engine;
  }

  async getProfile(profileId) {
    const result = await this.pool.query(`
      SELECT p.*,coalesce(jsonb_agg(f ORDER BY f.feature_key) FILTER (WHERE f.id IS NOT NULL),'[]'::jsonb) AS feature_rows
      FROM leadgen.icp_profiles p LEFT JOIN leadgen.icp_profile_features f ON f.profile_id=p.id
      WHERE p.id=$1 GROUP BY p.id`, [profileId]);
    if (!result.rowCount) return null;
    const profile = result.rows[0];
    profile.features = featureMap(profile.feature_rows || []);
    return profile;
  }

  async selectActiveProfile({ productScope, marketCode = null } = {}) {
    const scope = requestedProductScope(productScope);
    if (!scope) {
      throw Object.assign(new Error('Customer Match requires WOMENSWEAR or GENERAL_MERCHANDISE'), { code: 'PRODUCT_SCOPE_REQUIRED' });
    }
    const result = await this.pool.query(`
      SELECT id FROM leadgen.icp_profiles
      WHERE status='ACTIVE'
        AND $1=ANY(product_scope)
        AND ($2::text IS NULL OR $2=ANY(market_scope) OR 'GENERIC'=ANY(market_scope))
      ORDER BY (profile_type='HISTORICAL_CUSTOMER_ICP' AND feature_coverage>=60) DESC,
               (profile_type='MANAGEMENT_BASELINE') DESC,activated_at DESC NULLS LAST LIMIT 1`,
    [scope, marketCode ? String(marketCode).trim().toUpperCase() : null]);
    return result.rowCount ? this.getProfile(result.rows[0].id) : null;
  }

  async selectActiveProfiles({ productScope, marketCode = null } = {}) {
    const scope = requestedProductScope(productScope);
    if (!scope) {
      throw Object.assign(new Error('Customer Match requires WOMENSWEAR or GENERAL_MERCHANDISE'), { code: 'PRODUCT_SCOPE_REQUIRED' });
    }
    const market = marketCode ? String(marketCode).trim().toUpperCase() : null;
    const result = await this.pool.query(`SELECT id,profile_type FROM leadgen.icp_profiles
      WHERE status='ACTIVE' AND $1=ANY(product_scope) AND (
        (profile_type='MANAGEMENT_BASELINE' AND ($2::text IS NULL OR $2=ANY(market_scope) OR 'GENERIC'=ANY(market_scope)))
        OR (profile_type='HISTORICAL_CUSTOMER_ICP' AND ($2::text IS NULL OR $2=ANY(application_markets)))
      ) ORDER BY profile_type,activated_at DESC NULLS LAST,id DESC`, [scope, market]);
    const selected = {};
    for (const row of result.rows) {
      if (!selected[row.profile_type]) selected[row.profile_type] = await this.getProfile(row.id);
    }
    return {
      management_baseline: selected.MANAGEMENT_BASELINE || null,
      mx_historical_reference: selected.HISTORICAL_CUSTOMER_ICP || null
    };
  }

  async loadCompanyFacts(companyId) {
    const [companyResult, verificationResult, evidenceResult] = await Promise.all([
      this.pool.query('SELECT * FROM leadgen.companies WHERE id=$1', [companyId]),
      this.pool.query(`SELECT * FROM leadgen.research_candidate_verifications
        WHERE company_id=$1 ORDER BY verified_at DESC NULLS LAST,updated_at DESC LIMIT 1`, [companyId]),
      this.pool.query(`SELECT * FROM leadgen.company_verification_evidence
        WHERE company_id=$1 ORDER BY captured_at DESC`, [companyId])
    ]);
    if (!companyResult.rowCount) {
      const error = new Error('Company not found');
      error.code = 'COMPANY_NOT_FOUND';
      throw error;
    }
    const company = companyResult.rows[0];
    const verification = verificationResult.rows[0] || {};
    const evidence = evidenceResult.rows;
    const byType = (...types) => evidence.filter(row => types.includes(row.evidence_type));
    const buyerTypes = [];
    if (['VERIFIED','SUPPORTED'].includes(verification.importer_status)) buyerTypes.push('IMPORTER');
    if (['VERIFIED','SUPPORTED'].includes(verification.wholesaler_status)) buyerTypes.push('WHOLESALER');
    if (['VERIFIED','SUPPORTED'].includes(verification.distributor_status)) buyerTypes.push('DISTRIBUTOR');
    if (['VERIFIED','SUPPORTED'].includes(verification.general_trading_status)) buyerTypes.push('GENERAL_TRADING');
    const marketEvidence = byType('LOCATION');
    const productEvidence = byType('PRODUCT_CATEGORY','BRANDS');
    const buyerEvidence = byType('IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING');
    const scaleEvidence = byType('EMPLOYEE_SIZE','COMPANY_SCALE','LOCATIONS','WAREHOUSE');
    const distributionEvidence = byType('RETAIL_CHANNEL','REGIONAL_COVERAGE','WAREHOUSE','LOCATIONS');
    return {
      buyer_types: fact(buyerTypes, buyerEvidence),
      product_categories: fact(company.product_categories || [], productEvidence),
      markets: fact(company.country_code, marketEvidence),
      channels: fact([], []),
      company_sizes: fact(String(verification.company_size || company.company_size_band || '').toUpperCase(), scaleEvidence),
      distribution_patterns: fact(distributionEvidence.map(row => row.evidence_value).filter(Boolean), distributionEvidence),
      commercial_moq: { values: [], evidence_ids: [] },
      historical_win_similarity: { values: [], evidence_ids: [] }
    };
  }

  async evaluate({ companyFacts, profile, dpvScore = 0 }) {
    return this.engine.evaluate({ companyFacts, profile, dpvScore });
  }

  async evaluateAndPersist({ companyId, researchJobId = null, profileId = null, productScope = null, companyFacts = null, dpvScore = null, executionKey = null }) {
    const facts = companyFacts || await this.loadCompanyFacts(companyId);
    const scope = requestedProductScope(productScope) || inferredProductScope(facts);
    if (!scope) {
      throw Object.assign(new Error('Customer Match requires an explicit or deterministically mapped product scope'), { code: 'PRODUCT_SCOPE_REQUIRED' });
    }
    const marketCode = facts.markets?.values?.[0] || null;
    const profile = profileId ? await this.getProfile(profileId) : await this.selectActiveProfile({ productScope: scope, marketCode });
    if (!profile) throw Object.assign(new Error(`No active ICP profile for ${scope}`), { code: 'ICP_PROFILE_NOT_FOUND' });
    if (!profile.product_scope?.includes(scope)) {
      throw Object.assign(new Error('Selected ICP profile does not match the requested product scope'), { code: 'ICP_PRODUCT_SCOPE_MISMATCH' });
    }
    let score = dpvScore;
    if (score == null) {
      const result = await this.pool.query(`SELECT final_score FROM leadgen.company_score_runs
        WHERE company_id=$1 ORDER BY calculated_at DESC,id DESC LIMIT 1`, [companyId]);
      score = result.rows[0]?.final_score || 0;
    }
    const match = await this.evaluate({ companyFacts: facts, profile, dpvScore: score });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (executionKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`match:${companyId}:${executionKey}`]);
        const existing = await client.query(`SELECT * FROM leadgen.customer_match_results
          WHERE company_id=$1 AND reference_profile_id=$2 AND execution_key=$3`, [companyId,profile.id,executionKey]);
        if (existing.rowCount) {
          await client.query('COMMIT');
          return { ...existing.rows[0], product_scope: profile.product_scope, idempotent_replay: true };
        }
      }
      const saved = await client.query(`
        INSERT INTO leadgen.customer_match_results
          (company_id,research_job_id,execution_key,reference_profile_id,reference_profile_type,profile_version,
           match_score,coverage_percent,display_status,opportunity_matrix,dimension_scores,
           reason_codes,evidence_ids,trace)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::uuid[],$14::jsonb)
        RETURNING *`, [
        companyId, researchJobId, executionKey, profile.id, profile.profile_type, profile.version,
        match.match_score, match.coverage_percent, match.display_status, match.opportunity_matrix,
        JSON.stringify(match.dimension_scores), JSON.stringify(match.reason_codes), match.evidence_ids,
        JSON.stringify({ zen: match.zen_trace, performance: match.zen_performance, product_scope: scope })
      ]);
      await client.query('COMMIT');
      return { ...saved.rows[0], product_scope: profile.product_scope };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async evaluateAndPersistDual(options) {
    const facts = options.companyFacts || await this.loadCompanyFacts(options.companyId);
    const scope = requestedProductScope(options.productScope) || inferredProductScope(facts);
    if (!scope) {
      throw Object.assign(new Error('Customer Match requires an explicit or deterministically mapped product scope'), { code: 'PRODUCT_SCOPE_REQUIRED' });
    }
    const profiles = await this.selectActiveProfiles({ productScope: scope, marketCode: facts.markets?.values?.[0] || null });
    const result = { management_baseline: null, mx_historical_reference: null };
    if (profiles.management_baseline) {
      result.management_baseline = await this.evaluateAndPersist({
        ...options, companyFacts: facts, productScope: scope, profileId: profiles.management_baseline.id,
        executionKey: options.executionKey ? `${options.executionKey}:management` : null
      });
    }
    if (profiles.mx_historical_reference) {
      result.mx_historical_reference = await this.evaluateAndPersist({
        ...options, companyFacts: facts, productScope: scope, profileId: profiles.mx_historical_reference.id,
        executionKey: options.executionKey ? `${options.executionKey}:mx-history` : null
      });
    }
    if (!result.management_baseline && !result.mx_historical_reference) {
      throw Object.assign(new Error(`No active ICP profile for ${scope}`), { code: 'ICP_PROFILE_NOT_FOUND' });
    }
    return result;
  }

  async getLatest(companyId, { productScope = null } = {}) {
    const scope = requestedProductScope(productScope);
    const result = await this.pool.query(`SELECT r.*,p.product_scope FROM leadgen.customer_match_results r
      JOIN leadgen.icp_profiles p ON p.id=r.reference_profile_id
      WHERE r.company_id=$1 AND ($2::text IS NULL OR $2=ANY(p.product_scope))
      ORDER BY r.calculated_at DESC,r.id DESC LIMIT 1`, [companyId, scope]);
    return result.rows[0] || null;
  }

  async getLatestReferences(companyId, { productScope = null } = {}) {
    const scope = requestedProductScope(productScope);
    const result = await this.pool.query(`SELECT DISTINCT ON (r.reference_profile_type) r.*,p.product_scope
      FROM leadgen.customer_match_results r JOIN leadgen.icp_profiles p ON p.id=r.reference_profile_id
      WHERE r.company_id=$1 AND ($2::text IS NULL OR $2=ANY(p.product_scope))
      ORDER BY r.reference_profile_type,r.calculated_at DESC,r.id DESC`, [companyId, scope]);
    return {
      management_baseline: result.rows.find(row => row.reference_profile_type === 'MANAGEMENT_BASELINE') || null,
      mx_historical_reference: result.rows.find(row => row.reference_profile_type === 'HISTORICAL_CUSTOMER_ICP') || null
    };
  }

  async getHistory(companyId, { limit = 50, productScope = null } = {}) {
    const scope = requestedProductScope(productScope);
    const result = await this.pool.query(`SELECT r.*,p.product_scope FROM leadgen.customer_match_results r
      JOIN leadgen.icp_profiles p ON p.id=r.reference_profile_id
      WHERE r.company_id=$1 AND ($2::text IS NULL OR $2=ANY(p.product_scope))
      ORDER BY r.calculated_at DESC,r.id DESC LIMIT $3`, [companyId, scope, Math.max(1, Math.min(200, limit))]);
    return result.rows;
  }
}
