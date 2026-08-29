import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/023_phase6_decision_maker_enrichment.sql'), 'utf8');
const phase5Sql = fs.readFileSync(path.join(root, 'database/migrations/017_phase5_scoring_customer_match.sql'), 'utf8');

test('Phase 6 migration is transactional and extends ResearchJob without replacing legacy discovery jobs', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /job_type text NOT NULL DEFAULT 'COMPANY_DISCOVERY'/);
  assert.match(sql, /'COMPANY_DISCOVERY','DECISION_MAKER_ENRICHMENT'/);
  for (const status of ['QUEUED','DISCOVERING','RESOLVING','VERIFYING','PERSISTING','COMPLETE','PARTIAL','FAILED']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.enrichment_job_companies/);
  assert.doesNotMatch(sql, /DROP TABLE\s+leadgen\.research_jobs/i);
});

test('decision-maker records preserve roles, product-specific relevance, evidence, contacts and lifecycle history', () => {
  for (const table of [
    'decision_makers',
    'decision_maker_product_relevance',
    'decision_maker_sources',
    'decision_maker_contacts'
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS leadgen\\.${table}`));

  for (const role of [
    'BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT',
    'MERCHANDISING','SOURCING','IMPORT','COMMERCIAL','BUYING_DEPARTMENT','PROCUREMENT_DEPARTMENT','UNKNOWN'
  ]) assert.match(sql, new RegExp(`'${role}'`));
  assert.match(sql, /CHECK \(person_name IS NOT NULL OR department_name IS NOT NULL\)/);
  assert.match(sql, /'ACTIVE','STALE','SUPERSEDED','DUPLICATE','INVALID','ARCHIVED'/);
  assert.match(sql, /product_profile IN \('WOMENSWEAR','GENERAL_MERCHANDISE'\)/);
  for (const field of ['source_url','source_type','source_authority','captured_at','evidence_text','evidence_hash']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
  }
});

test('contact verification keeps evidence origin and deliverability states separate', () => {
  for (const type of [
    'BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL','BUSINESS_PHONE','BUSINESS_WHATSAPP',
    'CONTACT_FORM','SUPPLIER_PORTAL','VENDOR_REGISTRATION','PUBLIC_PROFILE_URL'
  ]) assert.match(sql, new RegExp(`'${type}'`));
  for (const origin of ['OFFICIAL_SITE_OBSERVED','PROVIDER_FOUND','PATTERN_CANDIDATE']) {
    assert.match(sql, new RegExp(`'${origin}'`));
  }
  for (const status of ['VALID','ACCEPT_ALL','UNKNOWN','INVALID','TEMPORARY_ERROR','NOT_VERIFIED']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
});

test('LinkedIn references are discovery hints with no fetched content by default', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.enrichment_public_references/);
  assert.match(sql, /verification_status text NOT NULL DEFAULT 'REVIEW'/);
  assert.match(sql, /evidence_strength text NOT NULL DEFAULT 'DISCOVERY_HINT'/);
  assert.match(sql, /content_fetched boolean NOT NULL DEFAULT false/);
});

test('cooperation feasibility has a separate matrix and retains explainable dimensions', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.cooperation_feasibility_results/);
  assert.match(sql, /cooperation_feasibility_score integer NOT NULL CHECK \(cooperation_feasibility_score BETWEEN 0 AND 100\)/);
  assert.match(sql, /access_opportunity_matrix text NOT NULL/);
  for (const value of ['HIGH_FIT_HIGH_ACCESS','HIGH_FIT_LOW_ACCESS','STRATEGIC_LONG_SHOT','SALES_READY']) {
    assert.match(sql, new RegExp(`'${value}'`));
  }
  for (const dimension of [
    'external_supplier_openness','supplier_onboarding_accessibility','buying_procurement_accessibility',
    'product_category_buying_fit','commercial_operational_feasibility','supplier_lock_in_barrier'
  ]) assert.match(sql, new RegExp(`'${dimension}'`));

  assert.match(phase5Sql, /opportunity_matrix text NOT NULL CHECK \(opportunity_matrix IN \([\s\S]*'PRIORITY_OPPORTUNITY'/);
  assert.doesNotMatch(sql, /ALTER TABLE leadgen\.customer_match_results[\s\S]*opportunity_matrix/i);
});

test('Hunter budget ledger enforces period cap and idempotent provider events', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.provider_credit_ledger/);
  assert.match(sql, /CHECK \(reserved_units \+ used_units <= credit_limit_units\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS leadgen\.provider_usage_events/);
  assert.match(sql, /UNIQUE \(provider,request_fingerprint\)/);
  for (const field of ['reserved_units','used_units','credits_before_units','credits_after_units','provider_request_id']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
  }
});

test('migration contains schema only and no production prospect or contact fixtures', () => {
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+leadgen\.(?:companies|contacts|decision_makers|decision_maker_contacts)/i);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*(?:outreach|sequence|message_send|email_send)/i);
});
