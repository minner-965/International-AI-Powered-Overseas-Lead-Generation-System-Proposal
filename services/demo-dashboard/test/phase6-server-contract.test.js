import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hiddenMarketCodes, visibleMarketCodes } from '../public/market-visibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = fs.readFileSync(path.join(root,'services/demo-dashboard/src/server.js'),'utf8');
const queue = fs.readFileSync(path.join(root,'services/demo-dashboard/src/jobs/phase5Queue.js'),'utf8');
const opportunitySource = fs.readFileSync(path.join(root,'services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js'),'utf8');
const envExample = fs.readFileSync(path.join(root,'.env.example'),'utf8');
const workflow = fs.readFileSync(path.join(root,'workflows/02-phase6-enrichment.json'),'utf8');
const enrichmentSources = fs.readdirSync(path.join(root,'services/demo-dashboard/src/enrichment'))
  .filter(name=>name.endsWith('.js'))
  .map(name=>fs.readFileSync(path.join(root,'services/demo-dashboard/src/enrichment',name),'utf8'))
  .join('\n');

function routeBlock(start, next) {
  const from = server.indexOf(start);
  const to = server.indexOf(next,from+start.length);
  assert.ok(from >= 0, `missing ${start}`);
  return server.slice(from,to > from ? to : from+12000);
}

test('Phase 6 API surface exists and preserves Express as the browser boundary', () => {
  for (const route of [
    '/api/enrichment/jobs',
    '/api/enrichment/jobs/:id',
    '/api/enrichment/jobs/:id/results',
    '/api/leads/:id/decision-makers',
    '/api/leads/:id/contact-routes',
    '/api/companies/:id/cooperation-feasibility',
    '/api/opportunities'
  ]) assert.match(server,new RegExp(route.replaceAll('/','\\/').replace(':id',':id')));
  assert.match(server,/N8N_ENRICHMENT_WEBHOOK_URL/);
  assert.match(server,/triggerEnrichmentWorkflow\(job\)/);
});

test('POST creates a queued enrichment ResearchJob before n8n dispatch', () => {
  const block = routeBlock("app.post('/api/enrichment/jobs'","app.get('/api/enrichment/jobs'");
  assert.match(block, /'QUEUED',\$13/);
  assert.match(block, /researchWave\?'REAL_OPPORTUNITY_RESEARCH':'DECISION_MAKER_ENRICHMENT'/);
  assert.match(block, /res\.status\(202\)\.json\(\{ job_id:job\.id,id:job\.id,status:'QUEUED',dispatch:'accepted' \}\)/);
  assert.match(block, /marketCodes\.some\(code=>!\['AE','MX'\]\.includes\(code\)\)/);
  assert.match(block, /productProfiles\.some\(value=>!\['WOMENSWEAR','GENERAL_MERCHANDISE'\]\.includes\(value\)\)/);
});

test('internal enrichment execution and status callbacks require the internal token', () => {
  assert.match(server,/app\.post\('\/api\/internal\/enrichment\/jobs\/:id\/run', requireInternalToken/);
  assert.match(server,/app\.patch\('\/api\/internal\/enrichment\/jobs\/:id\/status', requireInternalToken/);
  assert.match(workflow,/Bearer ' \+ \$env\.INTERNAL_API_TOKEN/);
  assert.match(workflow,/APP_INTERNAL_BASE_URL/);
});

test('pg-boss retains its bounded policy and adds a dedicated enrichment queue', () => {
  assert.match(queue,/ENRICH_DECISION_MAKERS: 'enrich-decision-makers'/);
  assert.match(queue,/retryLimit: 3/);
  assert.match(queue,/deadLetter: `\$\{name\}-dead-letter`/);
  assert.match(queue,/localConcurrency: 1/);
  assert.match(server,/PHASE5_QUEUES\.ENRICH_DECISION_MAKERS/);
});

test('opportunities keep scoring matrices separate while allowing a company-level contact route', () => {
  const block = routeBlock("app.get('/api/opportunities'","app.get('/api/internal/data-cleanup/dry-run'");
  assert.match(`${block}\n${opportunitySource}`,/mr\.opportunity_matrix/);
  assert.match(opportunitySource,/f\.access_opportunity_matrix cooperation_matrix/);
  assert.match(opportunitySource,/f\.product_access_matrix/);
  assert.match(opportunitySource,/CATEGORY_PROCUREMENT_MATCH/);
  assert.match(opportunitySource,/DIRECT_END_BUYER/);
  assert.match(opportunitySource,/mr\.match_score DESC NULLS LAST,hmr\.match_score DESC NULLS LAST,sr\.final_score DESC NULLS LAST/);
  assert.match(opportunitySource,/dx\.company_id=c\.id/);
  assert.match(opportunitySource,/contact_owner\.company_id=c\.id/);
  assert.doesNotMatch(opportunitySource,/dx\.research_job_id=f\.research_job_id/);
});

test('decision-maker API exposes traceable business fields but not hashes or shared-folder internals', () => {
  const block = routeBlock("app.get('/api/leads/:id/decision-makers'","app.get('/api/leads/:id/contact-routes'");
  for (const field of ['person_name','department_name','raw_title','normalized_role','role_relevance','source_url','captured_at','verification_status']) {
    assert.match(block,new RegExp(field));
  }
  assert.doesNotMatch(block,/evidence_hash|source_hash|unc_path|local_staging_path|activity_body/i);
});

test('AE and MX remain visible while BD remains configured but hidden', () => {
  assert.deepEqual(visibleMarketCodes(),['AE','MX']);
  assert.deepEqual(hiddenMarketCodes(),['BD']);
  assert.match(server,/hiddenMarketCodes\(\)/);
  assert.match(workflow,/!\['AE','MX'\]\.includes\(value\)/);
});

test('Phase 6 environment defaults are free-first safe and LinkedIn discovery-only', () => {
  assert.match(envExample,/HUNTER_MODE=DISABLED/);
  assert.match(envExample,/MAX_HUNTER_CREDITS_PER_RUN_UNITS=20000/);
  assert.match(envExample,/MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS=20000/);
  assert.match(envExample,/LINKEDIN_DISCOVERY_MODE=SEARCH_DISCOVERY_ONLY/);
  assert.match(envExample,/LINKEDIN_OFFICIAL_API_APPROVED=false/);
});

test('Phase 6 code and workflow contain no outreach or message-sending engine', () => {
  assert.doesNotMatch(enrichmentSources,/HunterSequences|createSequence|sendEmail|sendWhatsApp|submitSupplier|submitVendor|SMTP_HOST|nodemailer/i);
  const parsed = JSON.parse(workflow);
  const nodeTypes = parsed.nodes.map(node=>node.type);
  assert.equal(nodeTypes.some(type=>/email|smtp|linkedin|whatsapp/i.test(type)),false);
  assert.equal(parsed.nodes.some(node=>/send email|send message|submit form|submit supplier/i.test(node.name)),false);
});
