import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../../../',import.meta.url);
const source=relative=>readFile(new URL(relative,root),'utf8');

test('migration 028 adds the V2 business-fit contract without rewriting immutable Phase 7 snapshots',async()=>{
  const sql=await source('database/migrations/028_phase8_contact_ready_recommendation.sql');
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS business_fit_status text/);
  assert.match(sql,/business_fit_status IS NULL OR business_fit_status IN \('FIT','EVIDENCE_REQUIRED','NOT_SUITABLE'\)/);
  assert.match(sql,/business-opportunity-decision-v2/);
  assert.match(sql,/system_recommendation_status <> 'RECOMMENDED'/);
  assert.match(sql,/business_fit_status='FIT' AND contact_readiness='READY' AND policy_contact_status='OPEN'/);
  assert.match(sql,/CREATE OR REPLACE VIEW leadgen\.business_opportunity_current/);
  assert.match(sql,/s\.business_fit_status/);
  assert.doesNotMatch(sql,/UPDATE\s+leadgen\.business_opportunity_decision_snapshots/i);
  assert.match(sql,/COMMIT;/);
});

test('V2 refresh persists business fit and only makes contact-ready decisions eligible',async()=>{
  const repository=await source('services/demo-dashboard/src/phase7/repository.js');
  const refresh=repository.slice(repository.indexOf('async refreshOpportunityDecisions'),repository.indexOf('async findContact'));
  assert.match(refresh,/profile_relevant_buyer_count/);
  assert.match(refresh,/verified_buyer_role_count/);
  assert.match(refresh,/active_valid_email_route_count/);
  assert.match(refresh,/business_fit_status,system_recommendation_status,contact_readiness/);
  assert.match(refresh,/decision\.business_fit_status,decision\.system_recommendation_status/);
  assert.match(refresh,/decision\.system_recommendation_status==='RECOMMENDED'&&decision\.contact_readiness==='READY'/);
  assert.doesNotMatch(refresh,/INSERT INTO leadgen\.outreach_recipients/);
});

test('opportunity API projects business fit separately from contact readiness',async()=>{
  const route=await source('services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js');
  assert.match(route,/bod\.business_fit_status/);
  assert.match(route,/bod\.contact_readiness/);
  assert.match(route,/bod\.system_recommendation_status/);
});
