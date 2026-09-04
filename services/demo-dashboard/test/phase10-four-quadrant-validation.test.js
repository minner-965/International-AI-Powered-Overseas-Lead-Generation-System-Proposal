import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCategoryProcurementDimensions,
  calculateCategoryProcurementMatch,
  resolveApprovedCategoryScopeMatch
} from '../src/categoryProcurement/categoryProcurementMatch.js';
import { calculateProductOpportunity } from '../src/categoryProcurement/productOpportunity.js';
import { AutoEvidenceOrchestrator } from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import { EnrichmentService } from '../src/enrichment/EnrichmentService.js';
import { HunterProvider } from '../src/enrichment/HunterProvider.js';
import { PHASE5_QUEUES } from '../src/jobs/phase5Queue.js';
import {
  buildApprovalDigest,
  buildOutboundIdempotencyKey,
  buildSalesTaskFromReply,
  classifyInboundReply,
  deriveSuppressionActions,
  evaluateOutreachEligibility,
  matchesApproval
} from '../src/outreach/index.js';
import { deriveOpportunityDecision } from '../src/phase7/opportunityDecision.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(testDirectory, 'fixtures', 'phase10-four-quadrant-validation-manifest-v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const NOW = new Date('2026-09-01T00:00:00.000Z');
const revision = {
  id: '00000000-0000-4000-8000-000000001000',
  revision: 2,
  approval_status: 'APPROVED',
  effective_from: '2026-08-01T00:00:00.000Z'
};
const dresses = {
  id: '00000000-0000-4000-8000-000000001001',
  scope_revision_id: revision.id,
  product_profile: 'WOMENSWEAR',
  normalized_category: 'DRESSES',
  taxonomy_node_id: '00000000-0000-4000-8000-000000001099',
  scope_status: 'ACTIVE'
};
const observed = (points, maximum, evidenceIds = ['00000000-0000-4000-8000-000000001002']) => ({
  state: 'OBSERVED', points, maximum, evidence_ids: evidenceIds, reason_codes: []
});
const unknown = maximum => ({ state: 'UNKNOWN', points: null, maximum, evidence_ids: [], reason_codes: [] });
const dimensions = {
  target_category_procurement_evidence: observed(45, 45),
  buyer_business_model_fit: observed(25, 25),
  assortment_depth: unknown(15),
  external_sourcing_import: unknown(10),
  recent_category_activity: unknown(5)
};

function recommendationInput(overrides = {}) {
  return {
    company: { verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' },
    buyer: { buyer_model: 'DIRECT_END_BUYER', eligibility_status: 'ELIGIBLE' },
    category: {
      id: '00000000-0000-4000-8000-000000001010',
      product_profile: 'WOMENSWEAR',
      match_status: 'CATEGORY_PROCUREMENT_MATCH',
      calculation_version: 'category-procurement-match-v2',
      scope_revision_id: revision.id,
      match_basis: 'SIMILAR_CATEGORY'
    },
    cooperation: { opportunity_readiness: 'SALES_READY', supplier_access_band: 'UNKNOWN' },
    relationship_status: 'NEW_PROSPECT',
    profile_relevant_buyer_count: 1,
    verified_buyer_role_count: 1,
    business_email_route_count: 1,
    active_valid_email_route_count: 1,
    ...overrides
  };
}

function eligibleSendInput(overrides = {}) {
  return {
    outreach_enabled: true,
    live_prospect_send_approved: true,
    company: { verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' },
    relationship_status: 'NEW_PROSPECT',
    buyer_model: 'DIRECT_END_BUYER',
    category_procurement_match_status: 'CATEGORY_PROCUREMENT_MATCH',
    opportunity_readiness: 'SALES_READY',
    has_verified_profile_relevant_named_buyer: true,
    has_active_business_email_route: true,
    contact: {
      contact_type: 'BUSINESS_EMAIL',
      normalized_email: 'buyer@synthetic.invalid',
      verification_status: 'VALID',
      last_verified_at: '2026-08-25T00:00:00.000Z'
    },
    company_suppressed: false,
    contact_suppressed: false,
    approval: { status: 'APPROVED' },
    approval_digest_matches: true,
    provider_purpose_allowed: true,
    rate_caps_permit: true,
    ...overrides
  };
}

test('Phase 10 validation manifest freezes all four quadrants and all twelve hard scenarios with zero skips', () => {
  assert.equal(manifest.schema_version, 'phase10-four-quadrant-validation-manifest-v1');
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.release_blocking, true);
  assert.equal(manifest.selection_policy, 'ALL_SCENARIOS_MANDATORY');
  assert.equal(manifest.conditional_skips_allowed, 0);
  assert.equal(manifest.warning_downgrade_allowed, false);
  assert.deepEqual(Object.keys(manifest.quadrants), manifest.required_quadrants);

  const scenarios = Object.entries(manifest.quadrants).flatMap(([quadrant, entries]) => {
    assert.ok(entries.length > 0, `${quadrant} must not be empty`);
    return entries.map(entry => ({ ...entry, quadrant }));
  });
  assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length);
  assert.deepEqual(
    scenarios.map(item => item.hard_scenario).filter(Number.isInteger).sort((a, b) => a - b),
    manifest.required_hard_scenario_numbers
  );
  assert.equal(scenarios.some(item => /skip|warning|optional/i.test(String(item.status || ''))), false);
  assert.ok(scenarios.every(item => Array.isArray(item.test_evidence) && item.test_evidence.length > 0));
});

test('every frozen manifest scenario maps to a named automated test that is part of the repository suite', () => {
  const scenarios = Object.values(manifest.quadrants).flat();
  const sourceCache = new Map();
  for (const scenario of scenarios) {
    for (const evidence of scenario.test_evidence) {
      const sourcePath = path.resolve(testDirectory, '..', evidence.file);
      assert.equal(sourcePath.startsWith(testDirectory), true, `${scenario.id} test path escaped the test directory`);
      assert.equal(fs.existsSync(sourcePath), true, `${scenario.id} evidence file is missing: ${evidence.file}`);
      const source = sourceCache.get(sourcePath) || fs.readFileSync(sourcePath, 'utf8');
      sourceCache.set(sourcePath, source);
      assert.equal(
        source.includes(`test('${evidence.title}'`) || source.includes(`test(\"${evidence.title}\"`),
        true,
        `${scenario.id} evidence test title is missing: ${evidence.title}`
      );
    }
  }
});

test('hard 1: similar approved category passes category-only without an internal SKU or catalog task', () => {
  const observation = {
    id: '00000000-0000-4000-8000-000000001002',
    normalized_profile: 'WOMENSWEAR',
    normalized_category: 'CASUAL_DRESSES',
    taxonomy_ancestor_ids: [dresses.taxonomy_node_id],
    verification_status: 'VERIFIED',
    source_authority: 'OFFICIAL'
  };
  const category = calculateCategoryProcurementMatch({
    product_profile: 'WOMENSWEAR',
    buyer_model: 'DIRECT_END_BUYER',
    dimensions,
    scope_revision: revision,
    approved_category_scopes: [dresses],
    observed_customer_categories: [observation]
  });
  assert.equal(category.match_status, 'CATEGORY_PROCUREMENT_MATCH');
  assert.equal(category.match_basis, 'SIMILAR_CATEGORY');
  assert.equal(category.similarity_rule, 'APPROVED_TAXONOMY_PARENT_CHILD');

  const product = calculateProductOpportunity({
    category_procurement_match: { ...category, id: 'category-result', product_profile: 'WOMENSWEAR' },
    products: [{id:'product-master-must-not-enter',product_profile:'WOMENSWEAR',normalized_category:'DRESSES',
      normalized_subcategory:'CASUAL_DRESS',assignment_status:'CONFIRMED',catalog_status:'CURRENT_CONFIRMED'}],
    observations: [observation],
    catalog_snapshot: { eligible_product_count: 0, classified_product_count: 0, unknown_product_count: 0 }
  });
  assert.equal(product.recommendation_status, 'CATEGORY_SCOPE_QUALIFIED');
  assert.equal(product.sku_readiness_status, 'NO_EXACT_SKU');
  assert.equal(product.candidate_count, 0);
  assert.deepEqual(product.candidates, []);
  assert.equal('catalog_enrichment_required' in product, false);
  assert.ok(product.reason_codes.includes('EXACT_SKU_NOT_REQUIRED'));
  assert.ok(!product.reason_codes.includes('INTERNAL_CATALOG_UPLOAD_REQUIRED'));
  assert.equal(product.category_procurement_match_status, 'CATEGORY_PROCUREMENT_MATCH');
});

test('hard 2: two product profiles remain separately auditable while identical contact activity deduplicates', () => {
  const womenswear = deriveOpportunityDecision(recommendationInput());
  const generalMerchandise = deriveOpportunityDecision(recommendationInput({
    category: {
      ...recommendationInput().category,
      id: '00000000-0000-4000-8000-000000001011',
      product_profile: 'GENERAL_MERCHANDISE',
      match_basis: 'PROFILE_SCOPE'
    }
  }));
  assert.equal(womenswear.system_recommendation_status, 'RECOMMENDED');
  assert.equal(generalMerchandise.system_recommendation_status, 'RECOMMENDED');
  assert.notEqual(womenswear.input_digest, generalMerchandise.input_digest);

  const activity = {
    approval_id: 'approval-1',
    approved_content_hash: 'content-hash-1',
    recipient: 'Buyer@Synthetic.Invalid',
    from_identity: 'sales@dpv.example'
  };
  assert.equal(buildOutboundIdempotencyKey(activity), buildOutboundIdempotencyKey({ ...activity, recipient: 'buyer@synthetic.invalid' }));
});

test('multiple verified sources normalize to one category match without losing evidence lineage', () => {
  const observations = [
    {
      id: '00000000-0000-4000-8000-000000001021', observation_type: 'PRODUCT_CATEGORY',
      normalized_profile: 'WOMENSWEAR', normalized_category: 'DRESSES', raw_product_name: 'Midi dress',
      source_authority: 'OFFICIAL', verification_status: 'VERIFIED'
    },
    {
      id: '00000000-0000-4000-8000-000000001022', observation_type: 'PRODUCT_ITEM',
      normalized_profile: 'WOMENSWEAR', normalized_category: 'DRESSES', raw_product_name: 'Summer dress',
      source_authority: 'OFFICIAL_CATALOG', verification_status: 'VERIFIED'
    }
  ];
  const built = buildCategoryProcurementDimensions({
    observations,
    product_profile: 'WOMENSWEAR',
    buyer_business_model: { buyer_model: 'DIRECT_END_BUYER', evidence_ids: ['buyer-source'] }
  });
  assert.deepEqual(built.observed_categories, ['DRESSES']);
  assert.deepEqual(built.dimensions.target_category_procurement_evidence.evidence_ids, observations.map(item => item.id));
  const result = calculateCategoryProcurementMatch({
    product_profile: 'WOMENSWEAR',
    buyer_model: 'DIRECT_END_BUYER',
    ...built,
    scope_revision: revision,
    approved_category_scopes: [dresses],
    observed_customer_categories: observations
  });
  assert.equal(result.match_status, 'CATEGORY_PROCUREMENT_MATCH');
  assert.equal(result.match_basis, 'EXACT_CATEGORY');
  assert.deepEqual(result.dimensions.target_category_procurement_evidence.evidence_ids, observations.map(item => item.id));
});

test('hard 3: conflicting buyer evidence never reaches a recommended opportunity', () => {
  const decision = deriveOpportunityDecision(recommendationInput({ evidence_conflict: true }));
  assert.equal(decision.business_fit_status, 'EVIDENCE_REQUIRED');
  assert.equal(decision.system_recommendation_status, 'EVIDENCE_REQUIRED');
  assert.notEqual(decision.system_recommendation_status, 'RECOMMENDED');
  assert.ok(decision.reason_codes.includes('BUSINESS_EVIDENCE_CONFLICT'));
});

test('hard 4: Hunter temporary failure then success records real calls only and keeps decision replay idempotent', async () => {
  let networkCalls = 0;
  const businessRows=new Map();
  const referenceId='11111111-1111-4111-8111-111111111174';
  const provider = new HunterProvider({
    apiKey: 'synthetic-key',
    fetchImpl: async () => {
      networkCalls += 1;
      if (networkCalls === 1) return new Response(JSON.stringify({ errors: [{ details: 'temporary' }] }), { status: 503 });
      return new Response(JSON.stringify({ data: { status: 'valid', score: 97 } }), { status: 200 });
    }
  });
  const input = {
    researchJobId: 'phase10-hard-4', companyId: 'company-hard-4', email: 'buyer@synthetic.invalid',
    persistResults:async results=>{businessRows.set(referenceId,results[0]);return{referenceIds:[referenceId]};},
    loadPersistedResults:async({referenceIds})=>referenceIds.map(id=>businessRows.get(id)).filter(Boolean)
  };
  const first = await provider.verifyEmail(input);
  const second = await provider.verifyEmail(input);
  const replay = await provider.verifyEmail(input);
  assert.equal(first.status, 'TEMPORARY_ERROR');
  assert.equal(first.credits.used, 0);
  assert.equal(second.status, 'COMPLETED');
  assert.equal(second.results[0].verification_status, 'VALID');
  assert.equal(replay.status, 'SKIPPED');
  assert.equal(replay.error_code, 'IDEMPOTENT_REPLAY');
  assert.equal(networkCalls, 2);

  const firstDecision = deriveOpportunityDecision(recommendationInput());
  const replayDecision = deriveOpportunityDecision(recommendationInput());
  assert.equal(firstDecision.input_digest, replayDecision.input_digest);
});

test('hard 5: ACCEPT_ALL or UNKNOWN buyer email advances to an alternate named buyer before human exception', async () => {
  const contacts = [];
  const calls = [];
  const client = {
    async query() { return { rows: [{ id: `00000000-0000-4000-8000-${String(contacts.length + 1).padStart(12, '0')}` }], rowCount: 1 }; },
    release() {}
  };
  const hunter = {
    mode: 'FREE_FIRST',
    capabilities: { enabled: true, mode: 'FREE_FIRST' },
    async findEmail({ firstName }) {
      calls.push(`finder:${firstName}`);
      return {
        status: 'COMPLETED', credits: { used: 1000 },
        results: [{ email: `${firstName.toLowerCase()}@synthetic.invalid` }]
      };
    },
    async verifyEmail({ email }) {
      calls.push(`verifier:${email}`);
      const isAlternate = email.startsWith('blair@');
      return {
        status: 'COMPLETED', captured_at: NOW, credits: { used: 500 },
        usage_event: { id: isAlternate ? 'usage-valid' : 'usage-unknown' },
        results: [{ verification_status: isAlternate ? 'VALID' : 'UNKNOWN', verification_score: isAlternate ? 96 : null }]
      };
    }
  };
  const service = new EnrichmentService({
    pool: { connect: async () => client }, hunter, provider: { name: 'fixture' }, checker: {}, linkedIn: {}
  });
  service.upsertContact = async (_client, _jobId, decisionMakerId, contact) => {
    contacts.push({ decision_maker_id: decisionMakerId, ...contact });
    return { id: `00000000-0000-4000-8000-${String(contacts.length).padStart(12, '0')}` };
  };
  const result = await service.applyHunter(
    { id: '00000000-0000-4000-8000-000000002001' },
    { id: '00000000-0000-4000-8000-000000002002', official_root_domain: 'synthetic.invalid' },
    { decision_makers: [
      { id: 'buyer-a', person_name: 'Avery Buyer', verification_status: 'VERIFIED', normalized_role: 'SENIOR_BUYER' },
      { id: 'buyer-b', person_name: 'Blair Buyer', verification_status: 'VERIFIED', normalized_role: 'PROCUREMENT' }
    ] }
  );
  assert.deepEqual(calls, [
    'finder:Avery', 'verifier:avery@synthetic.invalid',
    'finder:Blair', 'verifier:blair@synthetic.invalid'
  ]);
  assert.deepEqual(contacts.map(item => item.verification_status), ['UNKNOWN', 'VALID']);
  assert.equal(result.valid_contact_found, true);
  assert.equal(result.decision_maker_id, 'buyer-b');
  assert.equal(result.calls, 4);
  assert.equal(result.used_units, 3000);
});

test('hard 6: concurrent schedulers converge on one singleton delivery', async () => {
  const task = {
    id: '00000000-0000-4000-8000-000000003001',
    company_id: '00000000-0000-4000-8000-000000003002',
    product_profile: 'WOMENSWEAR', business_blocker: 'NAMED_BUYER_EVIDENCE', evidence_revision: 4,
    execution_key: 'auto-evidence:v1:concurrent', task_status: 'QUEUED', attempt_count: 0
  };
  let schedules = 0;
  const repository = {
    async schedule() {
      schedules += 1;
      return { task, outcome: schedules === 1 ? 'SCHEDULED' : 'DEDUPLICATED', dispatch_required: true };
    }
  };
  const requested = [];
  const effectiveSingletons = new Set();
  const queue = {
    async enqueue(name, data, options) {
      requested.push({ name, data, options });
      effectiveSingletons.add(options.singletonKey);
      return `job-${effectiveSingletons.size}`;
    }
  };
  const service = new AutoEvidenceOrchestrator({ repository, queue, env: { AUTO_EVIDENCE_ENABLED: 'true' } });
  const input = {
    company_id: task.company_id, product_profile: task.product_profile,
    business_blocker: task.business_blocker, evidence_revision: task.evidence_revision
  };
  const [first, second] = await Promise.all([
    service.scheduleEvent({ ...input, event_id: 'scheduler-a' }),
    service.scheduleEvent({ ...input, event_id: 'scheduler-b' })
  ]);
  assert.deepEqual([first.status, second.status].sort(), ['DEDUPLICATED', 'SCHEDULED']);
  assert.equal(requested.length, 2);
  assert.equal(effectiveSingletons.size, 1);
  assert.match([...effectiveSingletons][0], /:1:ready:DISCOVERING_SOURCES:p0:w0:r0$/);
});

test('hard 7: history or suppression arriving after queueing invalidates contact eligibility immediately', () => {
  const queuedSnapshot = eligibleSendInput();
  assert.equal(evaluateOutreachEligibility(queuedSnapshot, { now: NOW }).eligible, true);

  const historical = evaluateOutreachEligibility({ ...queuedSnapshot, relationship_status: 'HISTORICAL_CRM_LEAD' }, { now: NOW });
  assert.equal(historical.eligible, false);
  assert.ok(historical.reason_codes.includes('RELATIONSHIP_NOT_NEW_PROSPECT'));

  const suppressed = evaluateOutreachEligibility({ ...queuedSnapshot, contact_suppressed: true }, { now: NOW });
  assert.equal(suppressed.eligible, false);
  assert.ok(suppressed.reason_codes.includes('CONTACT_SUPPRESSED'));
});

test('hard 8: stale approval and withdrawn category scope block send without changing historical facts', () => {
  const observation = {
    id: '00000000-0000-4000-8000-000000004001', normalized_profile: 'WOMENSWEAR',
    normalized_category: 'DRESSES', verification_status: 'VERIFIED', source_authority: 'OFFICIAL'
  };
  const current = resolveApprovedCategoryScopeMatch({
    product_profile: 'WOMENSWEAR', scope_revision: revision,
    approved_category_scopes: [dresses], observed_customer_categories: [observation], assessed_at: NOW
  });
  const withdrawnRevision = { ...revision, effective_to: '2026-08-31T23:59:59.000Z' };
  const withdrawn = resolveApprovedCategoryScopeMatch({
    product_profile: 'WOMENSWEAR', scope_revision: withdrawnRevision,
    approved_category_scopes: [dresses], observed_customer_categories: [observation], assessed_at: NOW
  });
  assert.equal(current.scope_status, 'MATCHED');
  assert.equal(withdrawn.scope_status, 'APPROVAL_REQUIRED');
  assert.equal(observation.normalized_category, 'DRESSES');

  const approvalInput = {
    draft_id: 'draft-1', draft_version: 1, language: 'en', subject: 'Introduction', body_text: 'Hello',
    followups: [], template_version: 'v1', recipient_id: 'buyer-1', recipient_email: 'buyer@synthetic.invalid',
    company_id: 'company-1', product_profile: 'WOMENSWEAR', from_identity: 'sales@dpv.example',
    reply_to: 'sales@dpv.example', channel: 'EMAIL', approved_claim_ids: ['claim-1'], evidence_snapshot_hash: 'evidence-v1'
  };
  const approved = buildApprovalDigest(approvalInput);
  const stale = matchesApproval({ status: 'APPROVED', approval_digest: approved.approval_digest }, {
    ...approvalInput, evidence_snapshot_hash: 'evidence-v2'
  });
  assert.equal(stale.matches, false);
  assert.ok(stale.reason_codes.includes('APPROVAL_DIGEST_MISMATCH'));

  const send = evaluateOutreachEligibility(eligibleSendInput({ approval_digest_matches: stale.matches }), { now: NOW });
  assert.equal(send.eligible, false);
  assert.ok(send.reason_codes.includes('APPROVAL_DIGEST_MISMATCH'));
});

test('hard 11: confirmed provider-credit pause resumes from the preserved checkpoint after provider recovery', async () => {
  const paused = {
    id: '00000000-0000-4000-8000-000000005001',
    company_id: '00000000-0000-4000-8000-000000005002',
    product_profile: 'WOMENSWEAR', business_blocker: 'VERIFIED_EMAIL_EVIDENCE', evidence_revision: 7,
    execution_key: 'auto-evidence:v1:provider-capacity', task_status: 'PROVIDER_CAPACITY_WAIT',
    current_stage: 'VERIFYING_EMAIL',attempt_count:1,strategy_attempt_count:1,max_attempts:10,
    current_strategy_code:'S04_OFFICIAL_LEADERSHIP',provider_retry_count:0,worker_retry_count:0,
    checkpoint_replay_count:0,budget_state:'NOT_REQUIRED'
  };
  const repository = {
    async resumeProviderCapacityWait(taskId) {
      assert.equal(taskId, paused.id);
      return {
        resumed: true,
        task: { ...paused,task_status:'RETRY_SCHEDULED',checkpoint_replay_count:1,budget_state:'NOT_REQUIRED' }
      };
    }
  };
  const calls = [];
  const queue = { async enqueue(name, data, options) { calls.push({ name, data, options }); return 'budget-resume-job'; } };
  const service = new AutoEvidenceOrchestrator({
    repository, queue,
    env: { AUTO_EVIDENCE_ENABLED: 'false', AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED: 'true' }
  });
  const result = await service.runControlledBatch({ resume_task_id: paused.id }, {
    trusted_management: true,
    operator_identity: 'management.fixture', operator_role: 'MANAGEMENT', approval_reference: 'provider-restored-1'
  });
  assert.equal(result.status, 'PROVIDER_CAPACITY_RECOVERY_QUEUED');
  assert.equal(result.stage, 'VERIFYING_EMAIL');
  assert.equal(result.attempt_number,1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, PHASE5_QUEUES.VERIFY_PROFILE_BUYER_EMAIL);
  assert.match(calls[0].options.singletonKey, /:1:S04_OFFICIAL_LEADERSHIP:VERIFYING_EMAIL:p0:w0:r1$/);
});

test('hard 12: reply opt-out hard bounce and complaint derive exact CRM and suppression actions', () => {
  const reply = classifyInboundReply({ subject: 'Catalogue', body_text: 'Please send your catalogue.' });
  const task = buildSalesTaskFromReply({
    classification: reply, company_id: 'company-12', sender_email: 'buyer@synthetic.invalid',
    correlation: { thread_id: 'thread-12' }, provider_message_id: 'message-12'
  }, { now: NOW });
  assert.equal(reply.intent, 'CATALOGUE');
  assert.equal(task.create_task, true);
  assert.equal(task.task.requires_human_review, true);
  assert.equal(task.task.automatic_send_allowed, false);

  assert.deepEqual(deriveSuppressionActions({ event_type: 'OPT_OUT' }), [
    { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'OPT_OUT' }
  ]);
  assert.deepEqual(deriveSuppressionActions({ event_type: 'HARD_BOUNCE' }), [
    { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'HARD_BOUNCE' }
  ]);
  assert.deepEqual(deriveSuppressionActions({ event_type: 'COMPLAINT' }), [
    { action: 'CREATE_CONTACT_SUPPRESSION', reason: 'COMPLAINT' },
    { action: 'CREATE_COMPANY_SUPPRESSION', reason: 'DO_NOT_CONTACT' }
  ]);
  assert.deepEqual(deriveSuppressionActions({ event_type: 'INBOUND_REPLY' }), [
    { action: 'STOP_THREAD_AUTOMATION', reason: 'RECIPIENT_REPLIED' }
  ]);
});
