import pg from 'pg';
import { CustomerMatchService } from './customerMatchService.js';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'leadgen',
  user: process.env.POSTGRES_USER || 'leadgen',
  password: process.env.POSTGRES_PASSWORD
});
const service = new CustomerMatchService({ pool });

try {
  const companies = await pool.query(`SELECT c.id,c.research_job_id FROM leadgen.companies c
    WHERE c.country_code='AE' AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
      AND c.explicit_exclusion_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM leadgen.historical_customer_company_links l
        JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
        WHERE l.company_id=c.id AND l.link_status='CONFIRMED'
          AND h.customer_role='INTERNAL_EXISTING_CUSTOMER')
    ORDER BY c.id LIMIT 500`);
  const results = [];
  for (const company of companies.rows) {
    results.push(await service.evaluateAndPersistDual({
      companyId: company.id,
      researchJobId: company.research_job_id,
      productScope: 'WOMENSWEAR',
      executionKey: `phase5-v2.3-acceptance:${company.id}`
    }));
  }
  console.log(JSON.stringify({
    companies: results.length,
    management_baseline_results: results.filter(row => row.management_baseline).length,
    mx_historical_reference_results: results.filter(row => row.mx_historical_reference).length,
    idempotent_management: results.filter(row => row.management_baseline?.idempotent_replay).length,
    idempotent_historical: results.filter(row => row.mx_historical_reference?.idempotent_replay).length
  }));
} finally {
  service.engine.dispose();
  await pool.end();
}
