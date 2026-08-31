import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const PHASE7_MIGRATION_KEY = '025_phase7_outreach_and_data_exchange.sql';
export const PHASE7_HARDENING_MIGRATION_KEY = '026_phase7_data_exchange_crm_hardening.sql';
export const PHASE7_ROLE_HARDENING_MIGRATION_KEY = '027_phase7_management_role_hardening.sql';
const projectRoot = process.env.DPV_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const defaultPath = path.resolve(projectRoot, 'database/migrations', PHASE7_MIGRATION_KEY);
const hardeningPath = path.resolve(projectRoot, 'database/migrations', PHASE7_HARDENING_MIGRATION_KEY);
const roleHardeningPath = path.resolve(projectRoot, 'database/migrations', PHASE7_ROLE_HARDENING_MIGRATION_KEY);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function migrationBody(sql) {
  return sql
    .replace(/^\s*BEGIN\s*;?/i, '')
    .replace(/COMMIT\s*;?\s*$/i, '')
    .trim();
}

export async function verifyPhase7Migration(client) {
  const tables = [
    'marketing_context_versions',
    'marketing_context_approvals',
    'business_opportunity_decision_snapshots',
    'business_opportunity_management_events',
    'contact_work_queue',
    'outreach_eligibility_snapshots',
    'outreach_recipients',
    'outreach_drafts',
    'outreach_draft_evidence',
    'outreach_draft_products',
    'outreach_approvals',
    'outbound_messages',
    'outbound_message_attempts',
    'email_webhook_inbox',
    'email_message_events',
    'outreach_threads',
    'inbound_messages',
    'reply_classifications',
    'contact_suppressions',
    'sales_tasks',
    'crm_sync_outbox',
    'product_master_revisions',
    'data_export_jobs',
    'data_export_download_events',
    'import_approvals'
  ];
  const relations = await client.query(
    `SELECT name,to_regclass('leadgen.'||name) relation
       FROM unnest($1::text[]) name
      ORDER BY name`,
    [tables]
  );
  const missing = relations.rows.filter(row => !row.relation).map(row => row.name);
  if (missing.length) {
    throw new Error(`Phase 7 migration verification failed; missing tables: ${missing.join(', ')}`);
  }

  const indexes = await client.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname='leadgen'
        AND indexname = ANY($1::text[])`,
    [[
      'idx_outbound_messages_provider_message_id',
      'idx_contact_suppressions_active_contact',
      'idx_contact_work_queue_one_active'
    ]]
  );
  if (indexes.rowCount !== 3) {
    throw new Error('Phase 7 migration verification failed; required partial unique indexes are incomplete');
  }
  return { tables_verified: tables.length, indexes_verified: indexes.rowCount };
}

export async function verifyPhase7HardeningMigration(client) {
  const result=await client.query(`SELECT to_regclass('leadgen.data_import_effect_outbox') effect_outbox,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='leadgen.reference_data_import_rows'::regclass
      AND conname='reference_data_import_rows_row_status_check' AND pg_get_constraintdef(oid) LIKE '%REVIEW%') review_status`);
  if(!result.rows[0]?.effect_outbox||result.rows[0]?.review_status!==true){
    throw new Error('Phase 7 hardening migration verification failed');
  }
  return{hardening_tables_verified:1,review_row_status_verified:true};
}

export async function verifyPhase7RoleHardeningMigration(client) {
  const result=await client.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
    WHERE conrelid='leadgen.business_opportunity_management_events'::regclass
      AND conname='business_opportunity_management_events_actor_role_check'`);
  if(!result.rowCount||!result.rows[0].definition.includes('MANAGEMENT_APPROVER')){
    throw new Error('Phase 7 management role hardening migration verification failed');
  }
  return{management_role_constraint_verified:true};
}

export async function applyPhase7Migrations(options = {}) {
  const base=await applyPhase7Migration(options);
  const hardening=await applyPhase7Migration({...options,migrationPath:options.hardeningMigrationPath||hardeningPath,
    appliedBy:options.appliedBy||'dpv-phase7-explicit-migration-runner'});
  const roleHardening=await applyPhase7Migration({...options,migrationPath:options.roleHardeningMigrationPath||roleHardeningPath,
    appliedBy:options.appliedBy||'dpv-phase7-explicit-migration-runner'});
  return {base,hardening,roleHardening,status:roleHardening.status,database:roleHardening.database};
}

export async function applyPhase7Migration({
  pool,
  migrationPath = defaultPath,
  expectedDatabase = null,
  appliedBy = 'dpv-phase7-explicit-migration-runner'
} = {}) {
  if (!pool) throw new Error('applyPhase7Migration requires a PostgreSQL pool');
  const sql = await fs.readFile(migrationPath, 'utf8');
  const checksum = sha256(sql);
  const migrationKey = path.basename(migrationPath);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const database = await client.query(
      'SELECT current_database() database,current_user username'
    );
    if (expectedDatabase && database.rows[0].database !== expectedDatabase) {
      throw new Error(`Migration target mismatch: expected ${expectedDatabase}`);
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS leadgen');
    await client.query(
      `CREATE TABLE IF NOT EXISTS leadgen.schema_migrations(
        migration_key text PRIMARY KEY,
        checksum_sha256 text NOT NULL CHECK(checksum_sha256~'^[0-9A-Fa-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text NOT NULL DEFAULT current_user
      )`
    );
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`leadgen:migration:${migrationKey}`]
    );
    const prior = await client.query(
      'SELECT * FROM leadgen.schema_migrations WHERE migration_key=$1 FOR UPDATE',
      [migrationKey]
    );
    if (prior.rowCount) {
      if (prior.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Migration checksum mismatch for ${migrationKey}`);
      }
      const verification = migrationKey===PHASE7_HARDENING_MIGRATION_KEY
        ? await verifyPhase7HardeningMigration(client)
        :migrationKey===PHASE7_ROLE_HARDENING_MIGRATION_KEY
          ?await verifyPhase7RoleHardeningMigration(client):await verifyPhase7Migration(client);
      await client.query('COMMIT');
      return {
        migration_key: migrationKey,
        checksum_sha256: checksum,
        status: 'SKIPPED_ALREADY_APPLIED',
        database: database.rows[0].database,
        ...verification
      };
    }
    await client.query(migrationBody(sql));
    await client.query(
      `INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by)
       VALUES($1,$2,$3)`,
      [migrationKey, checksum, appliedBy]
    );
    const verification = migrationKey===PHASE7_HARDENING_MIGRATION_KEY
      ? await verifyPhase7HardeningMigration(client)
      :migrationKey===PHASE7_ROLE_HARDENING_MIGRATION_KEY
        ?await verifyPhase7RoleHardeningMigration(client):await verifyPhase7Migration(client);
    await client.query('COMMIT');
    return {
      migration_key: migrationKey,
      checksum_sha256: checksum,
      status: 'APPLIED',
      database: database.rows[0].database,
      ...verification
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv.includes('--apply')) {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'leadgen',
    user: process.env.POSTGRES_USER || 'leadgen',
    password: process.env.POSTGRES_PASSWORD
  });
  try {
    const result = await applyPhase7Migrations({
      pool,
      expectedDatabase: process.env.POSTGRES_DB || null
    });
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}
