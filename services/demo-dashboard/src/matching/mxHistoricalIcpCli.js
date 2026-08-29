import pg from 'pg';
import { IcpProfileService } from './icpProfileService.js';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'leadgen',
  user: process.env.POSTGRES_USER || 'leadgen',
  password: process.env.POSTGRES_PASSWORD
});

try {
  const profile = await new IcpProfileService({ pool }).buildMexicoHistoricalReference();
  console.log(JSON.stringify({
    id: profile.id, name: profile.name, version: profile.version, status: profile.status,
    reference_market: profile.reference_market, application_markets: profile.application_markets,
    sample_size_customers: profile.sample_size_customers, sample_size_orders: profile.sample_size_orders,
    feature_coverage: profile.feature_coverage, win_loss_coverage_status: profile.win_loss_coverage_status,
    idempotent_replay: profile.idempotent_replay === true
  }));
} finally {
  await pool.end();
}
