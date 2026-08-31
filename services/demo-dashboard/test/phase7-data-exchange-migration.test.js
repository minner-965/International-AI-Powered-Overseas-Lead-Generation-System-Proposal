import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/025_phase7_outreach_and_data_exchange.sql'), 'utf8');
const hardeningSql = fs.readFileSync(path.join(root, 'database/migrations/026_phase7_data_exchange_crm_hardening.sql'), 'utf8');
const roleHardeningSql = fs.readFileSync(path.join(root, 'database/migrations/027_phase7_management_role_hardening.sql'), 'utf8');

test('Phase 7 migration is transactional, additive, and adds marketing-context approval entities', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  for (const table of ['marketing_context_versions', 'marketing_context_approvals']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS leadgen\\.${table}`));
  }
  for (const table of ['business_opportunity_decision_snapshots', 'business_opportunity_management_events', 'contact_work_queue']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS leadgen\\.${table}`));
  }
  assert.match(sql, /CREATE OR REPLACE VIEW leadgen\.business_opportunity_current/);
  assert.match(sql, /active contact queue requires the current MANAGEMENT_APPROVED decision snapshot/);
  assert.match(sql, /DECISION_SNAPSHOT_SUPERSEDED/);
  assert.match(sql, /context_status text NOT NULL DEFAULT 'DRAFT'/);
  assert.match(sql, /allowed_product_profiles text\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /content_hash text NOT NULL CHECK \(content_hash ~ '\^\[0-9A-Fa-f\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /DROP TABLE\s+leadgen\./i);
});

test('eligibility snapshots allow nullable decision-maker linkage and keep relationship status explicit', () => {
  assert.match(sql, /decision_maker_id uuid REFERENCES leadgen\.decision_makers\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /decision_maker_id uuid NOT NULL REFERENCES leadgen\.decision_makers\(id\)/);
  for (const status of ['NEW_PROSPECT', 'EXISTING_CUSTOMER', 'HISTORICAL_REVIEW', 'SUPPRESSED', 'UNKNOWN']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
});

test('draft and approval snapshot fields match the immutable approval contract', () => {
  assert.match(sql, /draft_status text NOT NULL DEFAULT 'DRAFT'/);
  for (const status of ['DRAFT', 'INVALID_DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  for (const field of [
    'draft_version integer NOT NULL',
    'normalized_recipient text NOT NULL',
    'company_id uuid NOT NULL',
    'product_profile text NOT NULL',
    'approval_digest text NOT NULL',
    'evidence_snapshot_hash text NOT NULL',
    'reply_to text NOT NULL'
  ]) {
    assert.match(sql, new RegExp(field.replace(/[()[\]{}.?+^$|\\]/g, '\\$&')));
  }
  assert.match(sql, /idx_outreach_approval_digest/);
});

test('outbound delivery and reply entities keep mutable lifecycle rows outside the append-only trigger list', () => {
  assert.match(sql, /provider_call_started_at timestamptz/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_provider_message_id[\s\S]*WHERE provider_message_id IS NOT NULL;/);
  assert.doesNotMatch(sql, /UNIQUE NULLS NOT DISTINCT \(provider,provider_message_id\)/);
  const immutableBlock = sql.match(/FOREACH t IN ARRAY ARRAY\[(?<tables>[\s\S]*?)\]\s+LOOP/);
  assert.ok(immutableBlock?.groups?.tables);
  const immutableTables = immutableBlock.groups.tables;
  assert.match(immutableTables, /marketing_context_approvals/);
  assert.match(immutableTables, /email_message_events/);
  assert.doesNotMatch(immutableTables, /email_webhook_inbox/);
  assert.doesNotMatch(immutableTables, /outbound_message_attempts/);
  assert.doesNotMatch(immutableTables, /inbound_messages/);
  assert.doesNotMatch(immutableTables, /reply_classifications/);
  assert.doesNotMatch(immutableTables, /marketing_context_versions/);
  assert.doesNotMatch(immutableTables, /product_master_revisions/);
  assert.match(sql, /trg_marketing_context_versions_payload_guard/);
  assert.match(sql, /trg_product_master_revisions_payload_guard/);
});

test('database enums match the shared Phase 7 outreach contract', () => {
  for (const state of ['PROVIDER_ACCEPTED', 'SOFT_BOUNCED', 'HARD_BOUNCED']) {
    assert.match(sql, new RegExp(`'${state}'`));
  }
  for (const intent of ['CATALOGUE', 'SAMPLE', 'QUOTATION', 'MEETING', 'DEFER', 'DECLINE', 'OPT_OUT', 'AUTO_REPLY', 'IRRELEVANT', 'REVIEW']) {
    assert.match(sql, new RegExp(`'${intent}'`));
  }
  for (const reason of ['INVALID_EMAIL', 'HARD_BOUNCE', 'SOFT_BOUNCE_LIMIT', 'OPT_OUT', 'COMPLAINT', 'MANUAL', 'PROVIDER_SUPPRESSED']) {
    assert.match(sql, new RegExp(`'${reason}'`));
  }
});

test('product revisions remain append-only while preserving product_master.id and enforcing superseded lineage', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.product_master_revisions/);
  assert.match(sql, /product_master_id uuid NOT NULL REFERENCES leadgen\.product_master\(id\)/);
  assert.match(sql, /superseded_by_revision_id uuid REFERENCES leadgen\.product_master_revisions\(id\)/);
  assert.match(sql, /approval_status text NOT NULL DEFAULT 'REVIEW' CHECK \(approval_status IN \('REVIEW','APPROVED','REJECTED','SUPERSEDED'\)\)/);
  assert.match(sql, /CHECK \(\(approval_status='SUPERSEDED'\) = \(superseded_by_revision_id IS NOT NULL\)\)/);
  assert.match(sql, /approval_status IN \('APPROVED','SUPERSEDED'\) AND approved_by IS NOT NULL AND approved_at IS NOT NULL/);
});

test('import and export persistence enforce digests, approvals, token expiry and local storage metadata', () => {
  for (const importType of ['PROSPECT_LEADS', 'PRODUCT_MASTER_UPDATE', 'CUSTOMER_DEALS', 'CUSTOMER_DEAL_LINES']) {
    assert.match(sql, new RegExp(`'${importType}'`));
  }
  for (const role of ['PROSPECT_IMPORT', 'PRODUCT_CATALOG_UPDATE', 'CONVERTED_ORDER_HISTORY']) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
  for (const field of ['request_digest text NOT NULL', 'storage_provider text NOT NULL', 'storage_key text', 'download_token_issued_at timestamptz', 'last_downloaded_at timestamptz']) {
    assert.match(sql, new RegExp(field.replace(/[()[\]{}.?+^$|\\]/g, '\\$&')));
  }
  assert.match(sql, /Phase 7 import requires exact dry-run and source-hash approval/);
  assert.match(sql, /download_token_hash IS NOT NULL/);
  assert.match(sql, /storage_key IS NOT NULL/);
  assert.match(hardeningSql, /row_status IN \('ACCEPTED','REVIEW','REJECTED','DUPLICATE','COMMITTED'\)/);
  assert.match(hardeningSql, /CREATE TABLE IF NOT EXISTS leadgen\.data_import_effect_outbox/);
  for (const effect of ['REBUILD_ICP_PROFILE','RECALCULATE_CUSTOMER_MATCH']) assert.match(hardeningSql,new RegExp(`'${effect}'`));
});

test('applied migration 025 stays checksum-stable and hardening is additive in 026',()=>{
  assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),'e0bc7c3b8f618415953e5d6a2434c18fc1ec12a1a98b34c533ac13b2c580c9b3');
  assert.match(hardeningSql,/^BEGIN;/);assert.match(hardeningSql,/COMMIT;\s*$/);
  assert.doesNotMatch(hardeningSql,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('management role hardening is additive in 027 and preserves the bound audit role',()=>{
  assert.match(roleHardeningSql,/^BEGIN;/);assert.match(roleHardeningSql,/COMMIT;\s*$/);
  assert.match(roleHardeningSql,/DROP CONSTRAINT IF EXISTS business_opportunity_management_events_actor_role_check/);
  assert.match(roleHardeningSql,/actor_role IN \('MANAGEMENT','SALES','MANAGEMENT_APPROVER'\)/);
  assert.doesNotMatch(roleHardeningSql,/DROP TABLE|DELETE FROM|TRUNCATE|UPDATE\s+leadgen\./i);
});

test('CRM outbox has an honest retryable processing state machine',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS leadgen\.crm_sync_outbox/);
  for(const status of ['PENDING','PROCESSING','SYNCED','RETRYABLE_ERROR','PERMANENT_ERROR','CANCELLED'])assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/idempotency_key text NOT NULL UNIQUE/);
  assert.match(sql,/next_attempt_at timestamptz/);
});

test('migration remains schema-only without inserting prospect, order, approval or export fixtures', () => {
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+leadgen\.(?:outreach_|marketing_context_|data_export_|reference_data_imports)/i);
});
