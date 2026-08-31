import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const CATEGORY_PROCUREMENT_MIGRATION_KEY='024_phase6_1_category_procurement_match.sql';
const projectRoot=process.env.DPV_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const defaultPath=path.resolve(projectRoot,'database/migrations',CATEGORY_PROCUREMENT_MIGRATION_KEY);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

function migrationBody(sql){return sql.replace(/^\s*BEGIN\s*;?/i,'').replace(/COMMIT\s*;?\s*$/i,'').trim();}

export async function verifyCategoryProcurementMigration(client){
  const tables=['product_profile_catalog_snapshots','product_taxonomy_nodes','product_taxonomy_aliases','product_master_taxonomy_assignments','prospect_category_sources','prospect_category_observations','buyer_business_model_results','category_procurement_match_results','category_procurement_match_dimensions','category_procurement_match_evidence','product_opportunity_results','product_opportunity_candidates','product_opportunity_gaps','product_opportunity_gap_evidence'];
  const result=await client.query(`SELECT name,to_regclass('leadgen.'||name) relation FROM unnest($1::text[])name ORDER BY name`,[tables]);
  const missing=result.rows.filter(row=>!row.relation).map(row=>row.name);if(missing.length)throw new Error(`Migration verification failed; missing tables: ${missing.join(', ')}`);
  const constraints=await client.query(`SELECT conname FROM pg_constraint WHERE connamespace='leadgen'::regnamespace AND conname IN('research_jobs_job_type_check','research_search_queries_query_type_check','cooperation_feasibility_results_product_access_matrix_check','cooperation_feasibility_results_phase61_v3_contract_check')`);
  if(constraints.rowCount!==4)throw new Error('Migration verification failed; required V3 constraints are incomplete');
  return {tables_verified:tables.length,constraints_verified:constraints.rowCount};
}

export async function applyCategoryProcurementMigration({pool,migrationPath=defaultPath,expectedDatabase=null,appliedBy='dpv-explicit-migration-runner'}={}){
  if(!pool)throw new Error('applyCategoryProcurementMigration requires a PostgreSQL pool');const sql=await fs.readFile(migrationPath,'utf8');const checksum=sha(sql);const migrationKey=path.basename(migrationPath);const client=await pool.connect();
  try{await client.query('BEGIN');const database=await client.query('SELECT current_database() database,current_user username');if(expectedDatabase&&database.rows[0].database!==expectedDatabase)throw new Error(`Migration target mismatch: expected ${expectedDatabase}`);
    await client.query('CREATE SCHEMA IF NOT EXISTS leadgen');await client.query(`CREATE TABLE IF NOT EXISTS leadgen.schema_migrations(migration_key text PRIMARY KEY,checksum_sha256 text NOT NULL CHECK(checksum_sha256~'^[0-9A-Fa-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL DEFAULT current_user)`);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`leadgen:migration:${migrationKey}`]);const prior=await client.query('SELECT * FROM leadgen.schema_migrations WHERE migration_key=$1 FOR UPDATE',[migrationKey]);
    if(prior.rowCount){if(prior.rows[0].checksum_sha256!==checksum)throw new Error(`Migration checksum mismatch for ${migrationKey}`);const verification=await verifyCategoryProcurementMigration(client);await client.query('COMMIT');return{migration_key:migrationKey,checksum_sha256:checksum,status:'SKIPPED_ALREADY_APPLIED',database:database.rows[0].database,...verification};}
    await client.query(migrationBody(sql));await client.query('INSERT INTO leadgen.schema_migrations(migration_key,checksum_sha256,applied_by)VALUES($1,$2,$3)',[migrationKey,checksum,appliedBy]);const verification=await verifyCategoryProcurementMigration(client);await client.query('COMMIT');return{migration_key:migrationKey,checksum_sha256:checksum,status:'APPLIED',database:database.rows[0].database,...verification};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

if(process.argv.includes('--apply')){
  const pool=new pg.Pool({
    host:process.env.POSTGRES_HOST||'postgres',
    port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',
    user:process.env.POSTGRES_USER||'leadgen',
    password:process.env.POSTGRES_PASSWORD
  });
  try{
    const result=await applyCategoryProcurementMigration({pool,expectedDatabase:process.env.POSTGRES_DB||null});
    console.log(JSON.stringify(result));
  }finally{
    await pool.end();
  }
}
