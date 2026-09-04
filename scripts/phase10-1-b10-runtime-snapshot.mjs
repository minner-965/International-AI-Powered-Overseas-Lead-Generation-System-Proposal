import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const workspacePackage=new URL('../services/demo-dashboard/package.json',import.meta.url);
const runtimePackage=new URL('../package.json',import.meta.url);
const require=createRequire(existsSync(fileURLToPath(workspacePackage))?workspacePackage:runtimePackage);
const {Pool}=require('pg');

const pool=new Pool({
  host:process.env.POSTGRES_HOST||'postgres',
  port:Number(process.env.POSTGRES_PORT||5432),
  database:process.env.POSTGRES_DB,
  user:process.env.POSTGRES_USER,
  password:process.env.POSTGRES_PASSWORD,
  max:2
});

try{
  const result=await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.companies) companies,
    (SELECT count(*)::int FROM leadgen.sources) sources,
    (SELECT count(*)::int FROM leadgen.contacts) contacts,
    (SELECT count(*)::int FROM leadgen.lead_reviews) lead_reviews,
    (SELECT count(*)::int FROM leadgen.collection_runs) collection_runs,
    (SELECT count(*)::int FROM leadgen.research_jobs) research_jobs,
    (SELECT count(*)::int FROM leadgen.decision_makers) decision_makers,
    (SELECT count(*)::int FROM leadgen.decision_maker_contacts) decision_maker_contacts,
    (SELECT count(*)::int FROM leadgen.auto_evidence_tasks) auto_evidence_tasks,
    (SELECT count(*)::int FROM leadgen.provider_usage_events) provider_usage_events,
    (SELECT count(*)::int FROM leadgen.commercial_product_fit_results) commercial_fit_results,
    (SELECT count(*)::int FROM leadgen.official_route_manual_tasks) manual_route_history_revisions,
    (SELECT count(*)::int FROM leadgen.official_route_manual_task_current) manual_route_current_history,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE display_opportunity_status='RECOMMENDED') recommended,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE display_opportunity_status='EVIDENCE_REQUIRED') evidence_required,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE display_opportunity_status='NOT_SUITABLE') not_suitable,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE display_opportunity_status='MANAGEMENT_APPROVED') management_approved,
    (SELECT count(*)::int FROM leadgen.outbound_messages) outbound_messages,
    (SELECT count(*)::int FROM leadgen.outbound_message_attempts) outbound_attempts,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm_outbox,
    (SELECT count(*)::int FROM leadgen.outreach_drafts) outreach_drafts,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current) opportunities,
    (SELECT coalesce(sum(used_units),0)::int FROM leadgen.provider_usage_events) provider_units,
    (SELECT count(*)::int FROM leadgen.company_contact_route_current) distinct_contact_routes,
    (SELECT count(*)::int FROM leadgen.official_route_manual_task_current WHERE retired_policy=false) active_manual_routes,
    (SELECT count(*)::int FROM leadgen.research_jobs
      WHERE status IN('QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING')) active_jobs,
    (SELECT count(*)::int FROM leadgen.research_job_dispatch_outbox
      WHERE dispatch_state='PENDING' AND created_at<now()-interval '10 minutes') stale_dispatch_pending,
    (SELECT count(*)::int FROM leadgen.category_procurement_match_results
      WHERE match_status='CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'
        AND created_at>=(SELECT applied_at FROM leadgen.schema_migrations
          WHERE migration_key='049_phase10_1_category_contact_simplification.sql')) legacy_buying_status_new,
    (SELECT count(*)::int FROM leadgen.auto_evidence_tasks
      WHERE task_status NOT IN('COMPLETED','CANCELLED','EVIDENCE_EXHAUSTED')
        AND business_blocker~'(PRODUCT|SUPPLIER|PROCUREMENT)') legacy_hard_blockers_active,
    (SELECT count(*)::int FROM (
      SELECT company_id,canonical_route_key FROM leadgen.decision_maker_contacts
      GROUP BY company_id,canonical_route_key HAVING count(*)>1) duplicate_routes) duplicate_contact_routes,
    (SELECT count(*)::int FROM (
      SELECT company_id,product_profile FROM leadgen.business_opportunity_current
      GROUP BY company_id,product_profile HAVING count(*)>1) duplicate_opportunities) duplicate_opportunities`);
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
}finally{
  await pool.end();
}
