import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
const migration = read('database/migrations/022_phase5_v231_okki_crm_history.sql');
const stage = read('scripts/phase5-v231-okki-stage.py');
const service = read('services/demo-dashboard/src/referenceData/okkiHistoryService.js');
const server = read('services/demo-dashboard/src/server.js');
const icp = read('services/demo-dashboard/src/matching/icpProfileService.js');

test('OKKI migration reuses import provenance and adds narrow CRM contact and activity entities', () => {
  assert.match(migration,/ALTER TABLE leadgen\.reference_data_imports/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS leadgen\.historical_customer_contacts/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS leadgen\.historical_customer_activities/);
  assert.match(migration,/source_customer_id_raw text/);
  assert.match(migration,/source_customer_id_type text/);
  assert.match(migration,/source_customer_id_key text/);
  assert.match(migration,/HISTORICAL_OPEN_LEAD/);
  assert.match(migration,/INTERNAL_EXISTING_CUSTOMER/);
});

test('OKKI stage adapter preserves raw typed IDs and handles duplicate headers by position', () => {
  assert.match(stage,/positions\[header\]\.append\(index\)/);
  assert.match(stage,/source_type = "int"/);
  assert.match(stage,/source_type = "text"/);
  assert.match(stage,/raw = str\(value or ""\)\.strip\(\)/);
  assert.match(stage,/token = f"'\{semantic\}" if semantic\.isdigit\(\) else semantic/);
  assert.match(stage,/shutil\.copy2\(source, local\)/);
  assert.match(stage,/before != after or before\["sha256"\] != local_hash/);
});

test('OKKI semantic gates keep outreach, outcomes and orders separate', () => {
  assert.match(stage,/"OUTBOUND_MARKETING_EMAIL_SENT"/);
  assert.match(stage,/"MANUAL_FOLLOW_UP"/);
  assert.match(stage,/"orders": 0, "products": 0, "outcomes": 0/);
  assert.match(stage,/"win_loss_coverage": "NONE"/);
  assert.doesNotMatch(stage,/activity_type[^\n]+(?:WON|LOST|REPLIED|QUOTED)/);
});

test('OKKI import requires the actual 46/248/83 profile and both typed collision fixtures', () => {
  assert.match(service,/HISTORICAL_CUSTOMERS: 46/);
  assert.match(service,/HISTORICAL_CONTACTS: 248/);
  assert.match(service,/HISTORICAL_ACTIVITIES: 83/);
  assert.match(service,/OKKI:int:1/);
  assert.match(service,/OKKI:text:'0001/);
});

test('historical CRM read APIs whitelist fields and never project private links or source paths', () => {
  assert.match(server,/app\.get\('\/api\/crm-history'/);
  assert.match(server,/app\.get\('\/api\/crm-history\/:id'/);
  assert.match(server,/app\.get\('\/api\/companies\/:id\/crm-history'/);
  const readApi = service.slice(service.indexOf('async list({'),service.indexOf('async importSummary()'));
  assert.doesNotMatch(readApi,/internal_related_link|internal_attachment_reference|source_unc_path|local_staging_path|source_sha256|raw_payload/);
});

test('only confirmed converted customers suppress prospects and OKKI imports do not alter the MX ICP key', () => {
  assert.match(server,/hc\.customer_role='INTERNAL_EXISTING_CUSTOMER'/);
  assert.match(icp,/supportingImportsUnchanged/);
  assert.match(icp,/customer_role='INTERNAL_EXISTING_CUSTOMER'/);
  assert.match(icp,/return \{ \.\.\.current,idempotent_replay:true \}/);
});
