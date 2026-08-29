import { domainService } from '../platform/DomainService.js';
import { phoneService } from '../platform/PhoneService.js';
import { getMarketProfile } from '../market/marketProfiles.js';
import { normalizeCompanyName } from '../verification/verificationRules.js';

export const VERIFICATION_STATUSES = Object.freeze(['VERIFIED', 'REVIEW', 'REJECTED']);
export const LIFECYCLE_STATUSES = Object.freeze(['ACTIVE', 'STALE', 'SUPERSEDED', 'DUPLICATE', 'INVALID', 'ARCHIVED']);

const WEAK_LEGACY_ORIGINS = new Set(['osm_live', 'directory_live', 'legacy_public_web', 'seed']);

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function clean(value) {
  return String(value || '').trim();
}

function emailDomain(value) {
  const match = clean(value).toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return match ? domainService.getRegistrableDomain(`https://${match[1]}`) : null;
}

function contactIdentity(contact, countryCode) {
  const email = clean(contact.business_email || (contact.contact_type === 'EMAIL' ? contact.contact_value : '')).toLowerCase();
  if (email) return `email:${email}`;
  const rawPhone = contact.business_phone || (contact.contact_type === 'PHONE' ? contact.contact_value : '');
  const phone = phoneService.normalize(rawPhone, { countryCode });
  return phone ? `phone:${phone.normalized_e164 || phone.compatibility_value}` : null;
}

export function verificationFreshness(lastVerifiedAt, now = new Date()) {
  const verified = asDate(lastVerifiedAt);
  const reference = asDate(now);
  if (!verified || !reference) return 'UNKNOWN';
  const days = Math.max(0, (reference.getTime() - verified.getTime()) / 86_400_000);
  if (days <= 180) return 'CURRENT';
  if (days <= 365) return 'AGING';
  return 'STALE';
}

export function isActiveOpportunity(company = {}) {
  return company.verification_status === 'VERIFIED'
    && company.lifecycle_status === 'ACTIVE'
    && !clean(company.explicit_exclusion_reason);
}

export function companyIdentity(record = {}) {
  const market = getMarketProfile(record.country_code, record.country_name);
  const officialDomain = domainService.getRegistrableDomain(record.official_root_domain || record.website_url || '');
  const emailDomains = new Set((record.contacts || []).flatMap(contact => {
    const value = contact.business_email || (contact.contact_type === 'EMAIL' ? contact.contact_value : null);
    const domain = emailDomain(value);
    return domain ? [domain] : [];
  }));
  const phones = new Set((record.contacts || []).flatMap(contact => {
    const raw = contact.business_phone || (contact.contact_type === 'PHONE' ? contact.contact_value : null);
    const normalized = phoneService.normalize(raw, { countryCode: record.country_code });
    const value = normalized?.normalized_e164 || normalized?.compatibility_value;
    return value ? [value] : [];
  }));
  return {
    official_domain: officialDomain,
    normalized_name: normalizeCompanyName(record.company_name, market),
    country_code: clean(record.country_code).toUpperCase(),
    email_domains: emailDomains,
    phones,
    normalized_address: clean(record.address).toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  };
}

function intersects(left, right) {
  return [...left].some(value => right.has(value));
}

export function strongCompanySignals(left, right) {
  const a = companyIdentity(left);
  const b = companyIdentity(right);
  const signals = [];
  if (a.official_domain && a.official_domain === b.official_domain) signals.push('EXACT_REGISTRABLE_DOMAIN');
  if (a.normalized_name && a.normalized_name === b.normalized_name
    && a.country_code && a.country_code === b.country_code) signals.push('EXACT_NORMALIZED_NAME_AND_COUNTRY');
  if (intersects(a.phones, b.phones)) signals.push('SAME_PUBLIC_PHONE');
  if (intersects(a.email_domains, b.email_domains)) signals.push('SAME_BUSINESS_EMAIL_DOMAIN');
  if (a.normalized_address && a.normalized_address === b.normalized_address
    && a.country_code === b.country_code) signals.push('SAME_ADDRESS_AND_COUNTRY');
  return signals;
}

export function conservativeDuplicateDecision(left, right) {
  const signals = strongCompanySignals(left, right);
  const exactDomain = signals.includes('EXACT_REGISTRABLE_DOMAIN');
  // Exact domain is decisive. Without it, require two independent exact signals.
  // A fuzzy-name recall result is never an auto-merge signal.
  return { duplicate: exactDomain || signals.length >= 2, signals };
}

function canonicalRank(record) {
  const identity = companyIdentity(record);
  const verified = record.verification_status === 'VERIFIED' ? 1 : 0;
  const coverage = Number(record.source_count || 0) + Number(record.contact_count || 0)
    + Number(record.business_evidence_count || 0);
  return [
    verified && identity.official_domain ? 1 : 0,
    verified,
    coverage,
    asDate(record.last_verified_at)?.getTime() || 0,
    asDate(record.created_at)?.getTime() || 0
  ];
}

export function chooseCanonical(records = []) {
  return [...records].sort((left, right) => {
    const a = canonicalRank(left);
    const b = canonicalRank(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return clean(left.id).localeCompare(clean(right.id));
  })[0] || null;
}

function dependencyCount(record, key) {
  return Number(record.dependencies?.[key] || 0);
}

function uniqueValues(record, canonical, key) {
  if (key === 'sources') {
    const existing = new Set((canonical.sources || []).map(item => clean(item.source_url)).filter(Boolean));
    return (record.sources || []).filter(item => !existing.has(clean(item.source_url))).length;
  }
  const existing = new Set((canonical.contacts || []).map(item => contactIdentity(item, canonical.country_code)).filter(Boolean));
  return (record.contacts || []).filter(item => {
    const value = contactIdentity(item, record.country_code);
    return value && !existing.has(value);
  }).length;
}

export function cleanupProposal(record, canonical = null, signals = []) {
  const dependencies = record.dependencies || {};
  if (canonical && canonical.id !== record.id) {
    const uniqueSources = uniqueValues(record, canonical, 'sources');
    const uniqueContacts = uniqueValues(record, canonical, 'contacts');
    const protectedHistory = ['lead_reviews', 'score_runs', 'match_runs', 'facts_snapshots', 'research_jobs']
      .reduce((total, key) => total + dependencyCount(record, key), 0);
    const auditEvidence = dependencyCount(record, 'verification_evidence')
      + dependencyCount(record, 'candidate_verifications') + dependencyCount(record, 'social_accounts');
    const safeForHardDelete = uniqueSources === 0 && uniqueContacts === 0
      && protectedHistory === 0 && auditEvidence === 0;
    return {
      proposed_action: safeForHardDelete ? 'DELETED' : 'SUPERSEDED',
      reason_code: safeForHardDelete ? 'DUPLICATE_WITHOUT_UNIQUE_VALUE' : 'CANONICAL_REPLACEMENT_HISTORY_PRESERVED',
      reason_text: safeForHardDelete
        ? 'Duplicate database row has no unique source, contact, evidence, or historical relationship.'
        : 'A stronger canonical row exists; preserve this row and its relationships as superseded history.',
      canonical_entity_id: canonical.id,
      strong_signals: signals,
      safe_for_hard_delete: safeForHardDelete,
      dependency_counts: { ...dependencies, unique_sources: uniqueSources, unique_contacts: uniqueContacts }
    };
  }

  const hasWebsite = Boolean(domainService.getRegistrableDomain(record.official_root_domain || record.website_url || ''));
  const hasContact = Number(record.contact_count || 0) > 0;
  const hasBusinessEvidence = Number(record.business_evidence_count || 0) > 0;
  const weakLegacy = WEAK_LEGACY_ORIGINS.has(record.data_origin) && !hasWebsite && !hasContact && !hasBusinessEvidence;
  if (record.verification_status === 'VERIFIED') {
    return {
      proposed_action: 'RETAINED', reason_code: 'VERIFIED_CANONICAL_RECORD',
      reason_text: 'Verified company remains the preferred database record.', canonical_entity_id: null,
      strong_signals: [], safe_for_hard_delete: false, dependency_counts: dependencies
    };
  }
  if (record.verification_status === 'REJECTED') {
    return {
      proposed_action: 'ARCHIVED', reason_code: 'REJECTED_RECORD_REQUIRES_AUDIT_RETENTION',
      reason_text: 'Rejected record is excluded from opportunities and retained for audit review.', canonical_entity_id: null,
      strong_signals: [], safe_for_hard_delete: false, dependency_counts: dependencies
    };
  }
  return {
    proposed_action: weakLegacy ? 'REVIEW' : 'RETAINED',
    reason_code: weakLegacy ? 'LEGACY_WEAK_EVIDENCE' : 'REVIEW_RECORD_WITH_TRACEABLE_DATA',
    reason_text: weakLegacy
      ? 'Legacy database row has no official domain, contact, or material target-business evidence; manual review is required.'
      : 'Record remains outside the opportunity pool while its traceable data is retained for review.',
    canonical_entity_id: null, strong_signals: [], safe_for_hard_delete: false, dependency_counts: dependencies
  };
}

function duplicateClusters(records) {
  const parent = new Map(records.map(record => [record.id, record.id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(right, left);
  };
  const pairSignals = new Map();
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const decision = conservativeDuplicateDecision(records[left], records[right]);
      if (!decision.duplicate) continue;
      union(records[left].id, records[right].id);
      pairSignals.set(`${records[left].id}:${records[right].id}`, decision.signals);
      pairSignals.set(`${records[right].id}:${records[left].id}`, decision.signals);
    }
  }
  const groups = new Map();
  for (const record of records) {
    const root = find(record.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  }
  return { groups: [...groups.values()], pairSignals };
}

function sumDependencies(plans) {
  const totals = {};
  for (const plan of plans) {
    for (const [key, value] of Object.entries(plan.dependency_counts || {})) {
      if (Number.isFinite(Number(value))) totals[key] = (totals[key] || 0) + Number(value);
    }
  }
  return totals;
}

function countActions(plans) {
  return plans.reduce((counts, plan) => {
    const key = plan.proposed_action.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export class CompanyLifecycleService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async refreshVerificationMetadata(client = this.pool) {
    await client.query(`
      UPDATE leadgen.companies c SET
        verification_source_count=(SELECT count(*)::int FROM leadgen.sources s WHERE s.company_id=c.id),
        last_verified_at=(SELECT max(v.verified_at) FROM leadgen.research_candidate_verifications v
          WHERE v.company_id=c.id AND v.verification_status='VERIFIED_BUSINESS'),
        verification_freshness=CASE
          WHEN (SELECT max(v.verified_at) FROM leadgen.research_candidate_verifications v
            WHERE v.company_id=c.id AND v.verification_status='VERIFIED_BUSINESS') IS NULL THEN 'UNKNOWN'
          WHEN (SELECT max(v.verified_at) FROM leadgen.research_candidate_verifications v
            WHERE v.company_id=c.id AND v.verification_status='VERIFIED_BUSINESS') >= now()-interval '180 days' THEN 'CURRENT'
          WHEN (SELECT max(v.verified_at) FROM leadgen.research_candidate_verifications v
            WHERE v.company_id=c.id AND v.verification_status='VERIFIED_BUSINESS') >= now()-interval '365 days' THEN 'AGING'
          ELSE 'STALE' END`);
  }

  async loadCleanupScope(client = this.pool) {
    const { rows } = await client.query(`
      SELECT c.*,
        v.address,
        coalesce(src.source_count,0)::int AS source_count,
        coalesce(src.items,'[]'::json) AS sources,
        coalesce(ct.contact_count,0)::int AS contact_count,
        coalesce(ct.items,'[]'::json) AS contacts,
        coalesce(ev.business_evidence_count,0)::int AS business_evidence_count,
        jsonb_build_object(
          'sources',coalesce(src.source_count,0)::int,
          'contacts',coalesce(ct.contact_count,0)::int,
          'lead_reviews',(SELECT count(*)::int FROM leadgen.lead_reviews x WHERE x.company_id=c.id),
          'score_runs',(SELECT count(*)::int FROM leadgen.company_score_runs x WHERE x.company_id=c.id),
          'match_runs',(SELECT count(*)::int FROM leadgen.customer_match_results x WHERE x.company_id=c.id),
          'facts_snapshots',(SELECT count(*)::int FROM leadgen.company_facts_snapshots x WHERE x.company_id=c.id),
          'research_jobs',CASE WHEN c.research_job_id IS NULL THEN 0 ELSE 1 END,
          'candidate_verifications',(SELECT count(*)::int FROM leadgen.research_candidate_verifications x WHERE x.company_id=c.id),
          'verification_evidence',(SELECT count(*)::int FROM leadgen.company_verification_evidence x WHERE x.company_id=c.id),
          'social_accounts',(SELECT count(*)::int FROM leadgen.company_social_accounts x WHERE x.company_id=c.id)
        ) AS dependencies
      FROM leadgen.companies c
      LEFT JOIN LATERAL (
        SELECT address FROM leadgen.research_candidate_verifications vx
        WHERE vx.company_id=c.id ORDER BY vx.verified_at DESC NULLS LAST,vx.updated_at DESC LIMIT 1
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS source_count,
          json_agg(json_build_object('id',s.id,'source_url',s.source_url,'provider_name',s.provider_name)) AS items
        FROM leadgen.sources s WHERE s.company_id=c.id
      ) src ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS contact_count,
          json_agg(json_build_object('id',x.id,'business_email',x.business_email,'business_phone',x.business_phone,
            'contact_type',x.contact_type,'contact_value',x.contact_value,'normalized_value',x.normalized_value)) AS items
        FROM leadgen.contacts x WHERE x.company_id=c.id
      ) ct ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE e.evidence_type IN (
          'IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING','PRODUCT_CATEGORY','RETAIL_CHANNEL'
        )) AS business_evidence_count
        FROM leadgen.company_verification_evidence e WHERE e.company_id=c.id
      ) ev ON true
      ORDER BY c.created_at,c.id`);
    return rows;
  }

  createPlan(records) {
    const { groups, pairSignals } = duplicateClusters(records);
    const plans = [];
    for (const group of groups) {
      const canonical = group.length > 1 ? chooseCanonical(group) : null;
      for (const record of group) {
        const replacement = canonical && canonical.id !== record.id ? canonical : null;
        const signals = replacement ? (pairSignals.get(`${record.id}:${canonical.id}`) || strongCompanySignals(record, canonical)) : [];
        plans.push({ record, ...cleanupProposal(record, replacement, signals) });
      }
    }
    return plans.sort((a, b) => clean(a.record.company_name).localeCompare(clean(b.record.company_name)));
  }

  async dryRun({ cleanupBatchId, performedBy = 'phase5-v2-management-review', backupReference }) {
    const batchId = clean(cleanupBatchId);
    if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(batchId)) {
      throw Object.assign(new Error('cleanup_batch_id must contain 3-80 safe characters'), { code: 'CLEANUP_BATCH_INVALID' });
    }
    if (!clean(backupReference)) {
      throw Object.assign(new Error('A validated database backup reference is required'), { code: 'CLEANUP_BACKUP_REQUIRED' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await this.refreshVerificationMetadata(client);
      const records = await this.loadCleanupScope(client);
      const plans = this.createPlan(records);
      const proposedCounts = countActions(plans);
      const dependencyTotals = sumDependencies(plans);
      const inserted = await client.query(`
        INSERT INTO leadgen.data_cleanup_batches
          (cleanup_batch_id,backup_reference,reviewed_count,proposed_counts,dependency_totals,created_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (cleanup_batch_id) DO NOTHING RETURNING *`, [batchId, clean(backupReference), records.length,
        JSON.stringify(proposedCounts), JSON.stringify(dependencyTotals), clean(performedBy) || 'phase5-v2-management-review']);
      if (!inserted.rowCount) {
        throw Object.assign(new Error('Cleanup batch already exists'), { code: 'CLEANUP_BATCH_EXISTS' });
      }
      for (const plan of plans) {
        await client.query(`
          INSERT INTO leadgen.data_cleanup_plan_items
            (cleanup_batch_id,old_entity_id,canonical_entity_id,proposed_action,reason_code,reason_text,
             old_data_origin,new_data_origin,strong_signals,dependency_counts,safe_for_hard_delete)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [batchId, plan.record.id,
          plan.canonical_entity_id, plan.proposed_action, plan.reason_code, plan.reason_text,
          plan.record.data_origin, plan.canonical_entity_id ? records.find(item => item.id === plan.canonical_entity_id)?.data_origin || null : null,
          JSON.stringify(plan.strong_signals), JSON.stringify(plan.dependency_counts), plan.safe_for_hard_delete]);
      }
      await client.query('COMMIT');
      return {
        cleanup_batch_id: batchId,
        scope: 'DPV_DATABASE_ONLY',
        status: 'DRY_RUN',
        reviewed: records.length,
        proposed_counts: proposedCounts,
        dependency_totals: dependencyTotals,
        safe_hard_delete_candidates: plans.filter(item => item.safe_for_hard_delete).map(item => ({
          company_id: item.record.id, company_name: item.record.company_name,
          canonical_company_id: item.canonical_entity_id, reason_code: item.reason_code,
          dependency_counts: item.dependency_counts
        })),
        replacements: plans.filter(item => item.canonical_entity_id).map(item => ({
          old_company_id: item.record.id, old_company_name: item.record.company_name,
          canonical_company_id: item.canonical_entity_id,
          strong_signals: item.strong_signals, proposed_action: item.proposed_action
        }))
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBatch(cleanupBatchId) {
    const batch = await this.pool.query('SELECT * FROM leadgen.data_cleanup_batches WHERE cleanup_batch_id=$1', [cleanupBatchId]);
    if (!batch.rowCount) return null;
    const items = await this.pool.query(`
      SELECT p.*,c.company_name AS old_company_name,canonical.company_name AS canonical_company_name
      FROM leadgen.data_cleanup_plan_items p
      LEFT JOIN leadgen.companies c ON c.id=p.old_entity_id
      LEFT JOIN leadgen.companies canonical ON canonical.id=p.canonical_entity_id
      WHERE p.cleanup_batch_id=$1 ORDER BY p.proposed_action,c.company_name,p.old_entity_id`, [cleanupBatchId]);
    return { ...batch.rows[0], items: items.rows };
  }

  async getLifecycleHistory(companyId) {
    const company = await this.pool.query(`
      SELECT id,company_name,verification_status,lifecycle_status,last_verified_at,
        verification_source_count,verification_freshness,explicit_exclusion_reason,replaced_by_company_id,
        created_at,updated_at FROM leadgen.companies WHERE id=$1`, [companyId]);
    if (!company.rowCount) return null;
    const [audit, replacements, scoreChanges, matchChanges] = await Promise.all([
      this.pool.query(`SELECT id,action,reason_code,reason_text,old_entity_id,canonical_entity_id,
        performed_at,performed_by,cleanup_batch_id FROM leadgen.data_cleanup_audit
        WHERE entity_type='COMPANY' AND (old_entity_id=$1 OR canonical_entity_id=$1)
        ORDER BY performed_at,id`, [companyId]),
      this.pool.query(`SELECT id,company_name,verification_status,lifecycle_status,replaced_by_company_id,updated_at
        FROM leadgen.companies WHERE replaced_by_company_id=$1 ORDER BY updated_at,id`, [companyId]),
      this.pool.query(`SELECT id,final_score,tier,qualification_status,rule_version,calculated_at
        FROM leadgen.company_score_runs WHERE company_id=$1 ORDER BY calculated_at,id`, [companyId]),
      this.pool.query(`SELECT id,match_score,coverage_percent,display_status,opportunity_matrix,profile_version,calculated_at
        FROM leadgen.customer_match_results WHERE company_id=$1 ORDER BY calculated_at,id`, [companyId])
    ]);
    const row = company.rows[0];
    const lifecycleEvents = [
      { event_type: 'CREATED', occurred_at: row.created_at, details: {} },
      ...(row.last_verified_at ? [{ event_type: 'VERIFIED', occurred_at: row.last_verified_at, details: { freshness: row.verification_freshness } }] : []),
      ...audit.rows.map(item => ({ event_type: item.action, occurred_at: item.performed_at, details: item })),
      ...scoreChanges.rows.map(item => ({ event_type: 'SCORE_CHANGED', occurred_at: item.calculated_at, details: item })),
      ...matchChanges.rows.map(item => ({ event_type: 'MATCH_CHANGED', occurred_at: item.calculated_at, details: item }))
    ].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    return {
      company_id: companyId,
      current: row,
      lifecycle_events: lifecycleEvents,
      cleanup_audit: audit.rows,
      replaced_records: replacements.rows
    };
  }
}

export function createCompanyLifecycleService(options) {
  return new CompanyLifecycleService(options);
}
