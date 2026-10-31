// Batch 3 accuracy (C1/C3/C4/C5) against a throwaway PostgreSQL database with every migration
// (074 included). Zero external calls.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch3-accuracy-postgres.test.js
// Skipped when no admin URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { verifyScoringAccuracyMigration } from '../src/verification/scoringAccuracyMigration.js';
import { loadPhase13EmailEligibilityFacts } from '../src/outreach/Phase13EmailFactLoader.js';
import { SIM_FIRST_TOUCH_CANDIDATES_SQL } from '../src/outreach/firstTouchCandidates.js';
import { ScoringService } from '../src/scoring/scoringService.js';

const adminUrl = process.env.MERCHANT_TEST_ADMIN_URL || process.env.GLOBAL_MARKETS_TEST_ADMIN_URL || '';
const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');
const hash = value => crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
async function admin(sql) { const client = new pg.Client({ connectionString: adminUrl }); await client.connect(); try { return await client.query(sql); } finally { await client.end(); } }
function dbUrl(name) { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.toString(); }

async function withDatabase(run) {
  const name = `batch3_accuracy_${crypto.randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const pool = new pg.Pool({ connectionString: dbUrl(name), max: 6 });
  try {
    for (const file of (await readdir(migrations)).filter(file => /^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    return await run(pool);
  } finally { await pool.end(); await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
}

async function company(pool, name, domain, extra = {}) {
  const { rows } = await pool.query(`INSERT INTO leadgen.companies(company_name,normalized_domain,country_code,country_name,website_url,official_root_domain,
      verification_status,lifecycle_status,company_size_band,phase4_verification_status,product_categories)
    VALUES($1,$2,'AE','United Arab Emirates',$3,$4,'VERIFIED','ACTIVE',$5,'VERIFIED_BUSINESS',ARRAY['Women''s Apparel']) RETURNING id`,
  [name, `test:${domain}`, `https://${domain}`, domain, extra.size || 'medium']);
  return rows[0].id;
}
async function mailbox(pool, companyId, address, { status = 'VALID', origin = 'OFFICIAL_SITE_OBSERVED', source = null } = {}) {
  const maker = (await pool.query(`SELECT id FROM leadgen.decision_makers WHERE company_id=$1`, [companyId])).rows[0]?.id
    || (await pool.query(`INSERT INTO leadgen.decision_makers(company_id,department_name,normalized_role,market_code,verification_status,lifecycle_status)
    VALUES($1,'Purchasing','PURCHASING','AE','VERIFIED','ACTIVE') RETURNING id`, [companyId])).rows[0].id;
  return (await pool.query(`INSERT INTO leadgen.decision_maker_contacts(decision_maker_id,company_id,contact_type,contact_value_raw,contact_value_normalized,
      evidence_origin,verification_status,verification_provider,verification_score,last_verified_at,source_url,is_generic)
    VALUES($1,$2,'GENERIC_BUSINESS_EMAIL',$3,$3,$4,$5,'HUNTER',99,now()-interval '5 days',$6,true) RETURNING id`,
  [maker, companyId, address, origin, status, source || `https://${address.split('@')[1]}/contact`])).rows[0].id;
}

test('batch 3 accuracy on PostgreSQL: 074, per-address recipient choice, candidate pre-filter, v2 score appended', { skip: !adminUrl }, async () => {
  await withDatabase(async pool => {
    // C1 / 074
    assert.deepEqual(await verifyScoringAccuracyMigration(pool), { retail_chain_evidence_types: true, retail_chain_status_column: true });
    await pool.query(await readFile(path.join(migrations, '074_scoring_accuracy.sql'), 'utf8')); // re-runnable
    const col = (await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_schema='leadgen'
      AND table_name='research_candidate_verifications' AND column_name='retail_chain_status'`)).rows[0];
    assert.match(col.column_default, /UNKNOWN/);

    // C3: first address suppressed, second hard-bounced, third used; hard bounce does not block the company.
    const buyer = await company(pool, 'Buyer Retail LLC', 'buyer-retail.example');
    await mailbox(pool, buyer, 'sales@buyer-retail.example');
    await mailbox(pool, buyer, 'info@buyer-retail.example');
    await mailbox(pool, buyer, 'compras@buyer-retail.example');
    await pool.query(`INSERT INTO leadgen.outreach_recipient_suppressions(company_id,normalized_recipient_hash,suppression_type,recorded_by)
      VALUES($1,$2,'OPT_OUT','test'),($1,$3,'HARD_BOUNCE','test')`, [buyer, hash('sales@buyer-retail.example'), hash('info@buyer-retail.example')]);
    const facts = await loadPhase13EmailEligibilityFacts(pool, buyer, {});
    assert.equal(facts.recipient.normalized_recipient, 'compras@buyer-retail.example');
    assert.equal(facts.hard_bounced, false);
    assert.equal(facts.opted_out, false);
    assert.equal(facts.recipient.domain_verified, true);
    assert.equal(facts.recipient.official_source_verified, true);
    const skipped = Object.fromEntries(facts.recipient_candidates.map(row => [row.normalized_recipient, row.reason_codes]));
    assert.ok(skipped['sales@buyer-retail.example'].includes('OPTED_OUT'));
    assert.ok(skipped['info@buyer-retail.example'].includes('HARD_BOUNCED'));

    // C3: an address found off the company domain and not published on its site is not domain-verified.
    const other = await company(pool, 'Other Trading', 'other-trading.example');
    await mailbox(pool, other, 'buyer@reseller.example', { origin: 'PROVIDER_FOUND', source: 'https://directory.example/x' });
    const offDomain = await loadPhase13EmailEligibilityFacts(pool, other, {});
    assert.equal(offDomain.recipient.domain_verified, false);
    assert.equal(offDomain.recipient.official_source_verified, false);

    // C5: only companies with a usable mailbox enter the candidate batch.
    const noMail = await company(pool, 'No Mail Co', 'nomail.example');
    for (const id of [buyer, other, noMail]) {
      await pool.query(`INSERT INTO leadgen.opportunity_pool_decisions(company_id,rule_version,input_digest,opportunity_pool_band,
          is_active_business_opportunity,category_relation,company_fit_relation,email_send_eligibility,change_reason,observed_at)
        VALUES($1,'test',$2,'RELEVANT',true,'TEST','{}'::jsonb,'{"send_authorized":false}'::jsonb,'test',now())`, [id, hash(id)])
        .catch(error => { throw new Error(`pool row: ${error.message}`); });
    }
    const candidates = (await pool.query(SIM_FIRST_TOUCH_CANDIDATES_SQL, [['PRECISION', 'RELEVANT', 'GENERAL_RELEVANT'], 50])).rows.map(row => row.company_id);
    assert.ok(candidates.includes(buyer));
    assert.ok(candidates.includes(other), 'domain checks stay in the gate; the pre-filter only needs a verified mailbox');
    assert.equal(candidates.includes(noMail), false);

    // C4: a v2 score run is appended; earlier runs are never rewritten.
    const scoring = new ScoringService({ pool });
    const run = await scoring.scoreCompany({ companyId: buyer, executionKey: 'batch3-test' });
    assert.equal(run.rule_version, 'dpv-score-v2');
    assert.equal(run.facts_snapshot.facts.facts.contact_validity.value, 'MAILBOX_VERIFIED');
    const again = await scoring.scoreCompany({ companyId: buyer, executionKey: 'batch3-test-2' });
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.company_score_runs WHERE company_id=$1', [buyer])).rows[0].n, 2);
    assert.notEqual(again.id, run.id);
  });
});
