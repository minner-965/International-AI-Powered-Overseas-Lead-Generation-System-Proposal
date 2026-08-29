import { createHash } from 'node:crypto';

function distribution(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(row[field] || '').trim().toUpperCase();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count, share: total ? Number((count / total).toFixed(4)) : 0 }));
}

function featureMap(rows = []) {
  return Object.fromEntries(rows.map(row => [row.feature_key, row]));
}

const MX_HISTORICAL_PROFILE_VERSION = 'mx-historical-v2';
const MX_HISTORICAL_CALCULATION_VERSION = 'mx-historical-stats-v2';

function percent(sample, total) {
  return total ? Number((sample / total * 100).toFixed(2)) : 0;
}

export function explicitCustomerPriceBand(rows = []) {
  const byCurrency = new Map();
  for (const row of rows) {
    if (row.customer_unit_price === null || row.customer_unit_price === undefined || row.customer_unit_price === '') continue;
    const value = Number(row.customer_unit_price);
    const currency = String(row.customer_sales_currency || '').trim().toUpperCase();
    if (!Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(currency) || currency === 'UNKNOWN') continue;
    if (!byCurrency.has(currency)) byCurrency.set(currency, []);
    byCurrency.get(currency).push(value);
  }
  const bands = [...byCurrency].sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => {
    values.sort((a, b) => a - b);
    return { currency, min: values[0], max: values.at(-1), sample_size: values.length };
  });
  const sampleSize = bands.reduce((sum, band) => sum + band.sample_size, 0);
  if (!sampleSize) return { sampleSize: 0, value: { status: 'UNAVAILABLE', currency: 'UNKNOWN', bands: [], source: 'INTERNAL_BUSINESS' } };
  if (bands.length === 1) {
    const [band] = bands;
    return { sampleSize, value: { status: 'AVAILABLE', currency: band.currency, min: band.min, max: band.max, bands, source: 'INTERNAL_BUSINESS' } };
  }
  return { sampleSize, value: { status: 'AVAILABLE_MULTICURRENCY', currency: 'MULTIPLE', min: null, max: null, bands, source: 'INTERNAL_BUSINESS' } };
}

export function weightedHistoricalCoverage(featureCoverage) {
  const weights = {
    buyer_types: 10,
    markets: 10,
    product_categories: 15,
    order_quantity: 15,
    customer_price_band: 15,
    repeat_orders: 10,
    commercial_moq: 10,
    company_sizes: 5,
    channels: 3,
    distribution_patterns: 2,
    historical_win_similarity: 5
  };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const covered = Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Number(featureCoverage[key] || 0) / 100, 0);
  return Number((covered / totalWeight * 100).toFixed(2));
}

export class IcpProfileService {
  constructor({ pool }) {
    if (!pool) throw new Error('IcpProfileService requires a PostgreSQL pool');
    this.pool = pool;
  }

  async listProfiles() {
    const result = await this.pool.query(`
      SELECT p.*,coalesce(jsonb_agg(f ORDER BY f.feature_key)
        FILTER (WHERE f.id IS NOT NULL),'[]'::jsonb) AS feature_rows
      FROM leadgen.icp_profiles p
      LEFT JOIN leadgen.icp_profile_features f ON f.profile_id=p.id
      GROUP BY p.id
      ORDER BY p.status='ACTIVE' DESC,p.profile_type,p.created_at DESC`);
    return result.rows.map(profile => ({
      ...profile,
      features: featureMap(profile.feature_rows || [])
    }));
  }

  async buildHistoricalDraft({ name = 'DPV Historical Customer ICP', marketScope = [], productScope = [], actor = null } = {}) {
    const [customers, orders, outcomes, channels, imports] = await Promise.all([
      this.pool.query('SELECT buyer_type,country_code,company_size FROM leadgen.historical_customers'),
      this.pool.query('SELECT product_category,moq,revenue FROM leadgen.historical_orders'),
      this.pool.query('SELECT outcome,country_code,sales_cycle_days FROM leadgen.historical_lead_outcomes'),
      this.pool.query('SELECT channel_type,market_code FROM leadgen.historical_customer_channels'),
      this.pool.query("SELECT id FROM leadgen.reference_data_imports WHERE status='COMMITTED' ORDER BY committed_at")
    ]);
    const wins = outcomes.rows.filter(row => row.outcome === 'WIN');
    const losses = outcomes.rows.filter(row => row.outcome === 'LOSS');
    const features = [
      ['buyer_types', { distribution: distribution(customers.rows, 'buyer_type') }, customers.rowCount],
      ['markets', { distribution: distribution([...customers.rows, ...outcomes.rows], 'country_code') }, customers.rowCount + outcomes.rowCount],
      ['company_sizes', { distribution: distribution(customers.rows, 'company_size') }, customers.rowCount],
      ['channels', { distribution: distribution(channels.rows, 'channel_type') }, channels.rowCount],
      ['distribution_patterns', { distribution: distribution(channels.rows, 'channel_type') }, channels.rowCount],
      ['product_categories', { distribution: distribution(orders.rows, 'product_category') }, orders.rowCount],
      ['commercial_moq', {
        values: orders.rows.map(row => Number(row.moq)).filter(Number.isFinite),
        status: orders.rows.some(row => row.moq != null) ? 'CALCULATED' : 'MISSING'
      }, orders.rows.filter(row => row.moq != null).length],
      ['historical_win_similarity', {
        win_distribution: distribution(wins, 'country_code'),
        loss_distribution: distribution(losses, 'country_code')
      }, wins.length + losses.length]
    ];
    const coverageWeights = { buyer_types: 20, product_categories: 20, markets: 15, channels: 0, commercial_moq: 15, company_sizes: 10, distribution_patterns: 10, historical_win_similarity: 10 };
    const featureCoverage = features.reduce((sum, [key, _value, sample]) => sum + (sample > 0 ? coverageWeights[key] || 0 : 0), 0);
    const version = `historical-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query(`
        INSERT INTO leadgen.icp_profiles
          (name,profile_type,version,status,market_scope,product_scope,source_import_ids,
           sample_size_wins,sample_size_losses,sample_size_orders,feature_coverage,calculation_version)
        VALUES ($1,'HISTORICAL_CUSTOMER_ICP',$2,'DRAFT',$3::text[],$4::text[],$5::uuid[],$6,$7,$8,$9,'historical-stats-v1')
        RETURNING *`, [name, version, marketScope, productScope, imports.rows.map(row => row.id), wins.length, losses.length, orders.rowCount, featureCoverage]);
      for (const [key, value, sampleSize] of features) {
        const coverage = sampleSize > 0 ? 100 : 0;
        await client.query(`INSERT INTO leadgen.icp_profile_features
          (profile_id,feature_key,feature_value,coverage,sample_size,calculation_version)
          VALUES ($1,$2,$3::jsonb,$4,$5,'historical-stats-v1')`, [profile.rows[0].id, key, JSON.stringify(value), coverage, sampleSize]);
      }
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('ICP_PROFILE_CREATED','icp_profile',$1,$2,$3::jsonb)`, [profile.rows[0].id, actor, JSON.stringify({ version, feature_coverage: featureCoverage })]);
      await client.query('COMMIT');
      return profile.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async buildMexicoHistoricalReference({ actor = 'phase5-v2.3-import' } = {}) {
    const [customers, orders, lines, imports] = await Promise.all([
      this.pool.query(`SELECT id,buyer_type,company_size,product_profiles,repeat_order_count
        FROM leadgen.historical_customers
        WHERE market_code='MX' AND customer_role='INTERNAL_EXISTING_CUSTOMER'
          AND identity_resolution_status='CONFIRMED'`),
      this.pool.query(`WITH latest AS (
          SELECT o.*,row_number() OVER (
            PARTITION BY o.source_system,o.external_order_id ORDER BY o.source_version DESC,o.created_at DESC,o.id DESC
          ) AS version_rank
          FROM leadgen.historical_orders o
          WHERE o.customer_resolution_status='RESOLVED'
        ) SELECT * FROM latest WHERE version_rank=1 AND order_status='CONFIRMED' AND product_profile='WOMENSWEAR'`),
      this.pool.query(`WITH latest AS (
          SELECT o.id,row_number() OVER (
            PARTITION BY o.source_system,o.external_order_id ORDER BY o.source_version DESC,o.created_at DESC,o.id DESC
          ) AS version_rank,o.order_status,o.customer_resolution_status
          FROM leadgen.historical_orders o
        ) SELECT l.product_profile,l.quantity,l.customer_unit_price,l.customer_sales_currency
          FROM leadgen.historical_order_lines l JOIN latest o ON o.id=l.historical_order_id
          WHERE o.version_rank=1 AND o.order_status='CONFIRMED' AND o.customer_resolution_status='RESOLVED'`),
      this.pool.query(`SELECT DISTINCT i.id,i.content_sha256
        FROM leadgen.reference_data_imports i
        WHERE i.status='COMMITTED' AND i.id IN (
          SELECT h.source_import_id FROM leadgen.historical_customers h
            WHERE h.market_code='MX' AND h.customer_role='INTERNAL_EXISTING_CUSTOMER'
              AND h.identity_resolution_status='CONFIRMED'
          UNION
          SELECT o.source_import_id FROM leadgen.historical_orders o
            JOIN leadgen.historical_customers h ON h.id=o.historical_customer_id
            WHERE h.market_code='MX' AND h.customer_role='INTERNAL_EXISTING_CUSTOMER'
              AND h.identity_resolution_status='CONFIRMED' AND o.customer_resolution_status='RESOLVED'
          UNION
          SELECT l.source_import_id FROM leadgen.historical_order_lines l
            JOIN leadgen.historical_orders o ON o.id=l.historical_order_id
            JOIN leadgen.historical_customers h ON h.id=o.historical_customer_id
            WHERE h.market_code='MX' AND h.customer_role='INTERNAL_EXISTING_CUSTOMER'
              AND h.identity_resolution_status='CONFIRMED' AND o.customer_resolution_status='RESOLVED'
        ) ORDER BY i.id`)
    ]);
    if (!customers.rowCount || !orders.rowCount) {
      throw Object.assign(new Error('Mexico historical reference requires confirmed customers and orders'), { code: 'MX_HISTORY_EMPTY' });
    }
    const currentProfile = await this.pool.query(`SELECT * FROM leadgen.icp_profiles
      WHERE profile_type='HISTORICAL_CUSTOMER_ICP' AND version=$1 AND status='ACTIVE'
      ORDER BY created_at DESC LIMIT 1`, [MX_HISTORICAL_PROFILE_VERSION]);
    if (currentProfile.rowCount) {
      const current = currentProfile.rows[0];
      const recordedImports = new Set((current.source_import_ids || []).map(String));
      const supportingImportsUnchanged = imports.rows.every(row => recordedImports.has(String(row.id)));
      if (supportingImportsUnchanged && Number(current.sample_size_customers) === customers.rowCount
        && Number(current.sample_size_orders) === orders.rowCount) {
        return { ...current,idempotent_replay:true };
      }
    }
    const quantities = lines.rows.map(row => Number(row.quantity)).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const priceBand = explicitCustomerPriceBand(lines.rows);
    const knownProfiles = lines.rows.map(row => row.product_profile).filter(value => value && value !== 'UNKNOWN');
    const productCoverage = percent(knownProfiles.length, lines.rowCount);
    const quantityCoverage = percent(quantities.length, lines.rowCount);
    const customerPriceCoverage = percent(priceBand.sampleSize, lines.rowCount);
    const repeatKnown = customers.rows.filter(row => row.repeat_order_count != null).length;
    const repeatCoverage = percent(repeatKnown, customers.rowCount);
    const features = [
      ['buyer_types', { values: [...new Set(customers.rows.map(row => row.buyer_type).filter(Boolean))], status: 'AVAILABLE', source: 'INTERNAL_BUSINESS' }, customers.rowCount, 100],
      ['markets', { values: ['MX','AE'], reference_market: 'MX', status: 'AVAILABLE', source: 'INTERNAL_BUSINESS' }, customers.rowCount, 100],
      ['company_sizes', { values: [...new Set(customers.rows.map(row => row.company_size).filter(Boolean))], status: customers.rows.some(row => row.company_size) ? 'AVAILABLE' : 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, customers.rows.filter(row => row.company_size).length, percent(customers.rows.filter(row => row.company_size).length, customers.rowCount)],
      ['channels', { values: [], status: 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, 0, 0],
      ['distribution_patterns', { values: [], status: 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, 0, 0],
      ['product_categories', { values: [...new Set(knownProfiles)], status: knownProfiles.length ? 'AVAILABLE' : 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, knownProfiles.length, productCoverage],
      ['commercial_moq', { min: null, max: null, status: 'UNAVAILABLE', coverage_note: 'NO_EXPLICIT_MOQ_SOURCE', source: 'INTERNAL_BUSINESS' }, 0, 0],
      ['historical_win_similarity', { values: [], status: 'UNAVAILABLE', coverage_note: 'NO_WIN_LOSS_FUNNEL', source: 'INTERNAL_BUSINESS' }, 0, 0],
      ['order_quantity', { min: quantities[0] ?? null, max: quantities.at(-1) ?? null, status: quantities.length ? 'AVAILABLE' : 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, quantities.length, quantityCoverage],
      ['customer_price_band', priceBand.value, priceBand.sampleSize, customerPriceCoverage],
      ['repeat_orders', { values: customers.rows.map(row => Number(row.repeat_order_count)).filter(Number.isFinite), status: repeatKnown ? 'AVAILABLE' : 'UNAVAILABLE', source: 'INTERNAL_BUSINESS' }, repeatKnown, repeatCoverage]
    ];
    const featureCoverage = weightedHistoricalCoverage(Object.fromEntries(features.map(([key, _value, _sample, coverage]) => [key, coverage])));
    const buildKey = createHash('sha256').update(JSON.stringify({
      version: MX_HISTORICAL_PROFILE_VERSION, calculation_version: MX_HISTORICAL_CALCULATION_VERSION,
      customers: customers.rows.map(row => row.id).sort(),
      orders: orders.rows.map(row => row.source_identity_key).sort(), imports: imports.rows.map(row => row.content_sha256).sort()
    })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`icp:${MX_HISTORICAL_PROFILE_VERSION}`]);
      const existing = await client.query('SELECT * FROM leadgen.icp_profiles WHERE build_key=$1', [buildKey]);
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { ...existing.rows[0], idempotent_replay: true };
      }
      await client.query(`UPDATE leadgen.icp_profiles SET status='RETIRED',retired_at=now()
        WHERE profile_type='HISTORICAL_CUSTOMER_ICP' AND status='ACTIVE'`);
      const profile = await client.query(`INSERT INTO leadgen.icp_profiles
        (name,profile_type,version,status,market_scope,product_scope,source_import_ids,
         sample_size_wins,sample_size_losses,sample_size_orders,feature_coverage,calculation_version,
         activated_at,reference_market,application_markets,profile_basis,source_classification,
         sample_size_customers,win_loss_coverage_status,rebuilt_at,build_key)
        VALUES ('DPV Mexico Historical Customer ICP','HISTORICAL_CUSTOMER_ICP',$6,'ACTIVE',
          ARRAY['MX','AE'],ARRAY['WOMENSWEAR'],$1::uuid[],0,0,$2,$3,$7,now(),
          'MX',ARRAY['MX','AE'],'CONVERTED_ORDER_HISTORY','INTERNAL_BUSINESS',$4,'NONE',now(),$5)
        RETURNING *`, [imports.rows.map(row => row.id),orders.rowCount,featureCoverage,customers.rowCount,buildKey,
          MX_HISTORICAL_PROFILE_VERSION,MX_HISTORICAL_CALCULATION_VERSION]);
      for (const [key, value, sampleSize, coverage] of features) {
        await client.query(`INSERT INTO leadgen.icp_profile_features
          (profile_id,feature_key,feature_value,coverage,sample_size,calculation_version)
          VALUES ($1,$2,$3::jsonb,$4,$5,$6)`, [profile.rows[0].id,key,JSON.stringify(value),coverage,sampleSize,MX_HISTORICAL_CALCULATION_VERSION]);
      }
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('MX_HISTORICAL_ICP_BUILT','icp_profile',$1,$2,$3::jsonb)`, [profile.rows[0].id,actor,
        JSON.stringify({ sample_customers: customers.rowCount, sample_orders: orders.rowCount,
          product_profile_coverage: productCoverage, repeat_order_coverage: repeatCoverage,
          channel_coverage: 0, win_loss_coverage: 'NONE', reference_market: 'MX', application_markets: ['MX','AE'] })]);
      await client.query('COMMIT');
      return profile.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async activateProfile(profileId, { actor = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT * FROM leadgen.icp_profiles WHERE id=$1 FOR UPDATE', [profileId]);
      if (!target.rowCount) throw new Error('ICP profile not found');
      const profile = target.rows[0];
      await client.query(`UPDATE leadgen.icp_profiles SET status='RETIRED',retired_at=now()
        WHERE status='ACTIVE' AND profile_type=$1 AND market_scope=$2::text[] AND product_scope=$3::text[] AND id<>$4`,
      [profile.profile_type, profile.market_scope, profile.product_scope, profileId]);
      const activated = await client.query(`UPDATE leadgen.icp_profiles
        SET status='ACTIVE',activated_at=now(),retired_at=NULL WHERE id=$1 RETURNING *`, [profileId]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('ICP_PROFILE_ACTIVATED','icp_profile',$1,$2,$3::jsonb)`, [profileId, actor, JSON.stringify({ version: profile.version })]);
      await client.query('COMMIT');
      return activated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
