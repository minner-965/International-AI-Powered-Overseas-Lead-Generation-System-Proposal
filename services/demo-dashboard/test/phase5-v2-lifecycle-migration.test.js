import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/018_phase5_v2_company_lifecycle.sql'), 'utf8');

test('migration adds explicit verification, lifecycle, freshness, and replacement fields', () => {
  assert.match(sql, /verification_status text NOT NULL DEFAULT 'REVIEW'/);
  assert.match(sql, /lifecycle_status text NOT NULL DEFAULT 'ACTIVE'/);
  assert.match(sql, /last_verified_at timestamptz/);
  assert.match(sql, /verification_source_count integer NOT NULL DEFAULT 0/);
  assert.match(sql, /verification_freshness text NOT NULL DEFAULT 'UNKNOWN'/);
  assert.match(sql, /replaced_by_company_id uuid REFERENCES leadgen\.companies/);
  assert.match(sql, /'VERIFIED','REVIEW','REJECTED'/);
  assert.match(sql, /'ACTIVE','STALE','SUPERSEDED','DUPLICATE','INVALID','ARCHIVED'/);
});

test('legacy verification backfill is conservative and source/freshness facts are derived', () => {
  assert.match(sql, /WHEN 'VERIFIED_BUSINESS' THEN 'VERIFIED'/);
  assert.match(sql, /ELSE 'REVIEW'/);
  assert.match(sql, /count\(\*\)::integer AS source_count/);
  assert.match(sql, /max\(verified_at\) AS last_verified_at/);
  assert.doesNotMatch(sql, /last_verified_at\s*=\s*created_at/i);
});

test('contact values remain historical and receive a separate lifecycle status', () => {
  assert.match(sql, /contact_verification_status/);
  assert.match(sql, /superseded_by_contact_id/);
  assert.match(sql, /'PUBLICLY_OBSERVED','VALID_FORMAT','DOMAIN_MX_VERIFIED','STALE','INVALID','SUPERSEDED'/);
  assert.doesNotMatch(sql, /DELETE FROM leadgen\.contacts/i);
});

test('cleanup dry-run and performed audit data are separate', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.data_cleanup_batches/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.data_cleanup_plan_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.data_cleanup_audit/);
  assert.match(sql, /scope = 'DPV_DATABASE_ONLY'/);
  assert.match(sql, /safe_for_hard_delete boolean NOT NULL DEFAULT false/);
});

test('blind company deletion is blocked unless an approved audited batch is set', () => {
  assert.match(sql, /guard_company_hard_delete/);
  assert.match(sql, /current_setting\('leadgen\.cleanup_batch_id', true\)/);
  assert.match(sql, /b\.status IN \('APPROVED','EXECUTING'\)/);
  assert.match(sql, /a\.action = 'DELETED'/);
  assert.doesNotMatch(sql, /DELETE FROM leadgen\.companies/i);
});
