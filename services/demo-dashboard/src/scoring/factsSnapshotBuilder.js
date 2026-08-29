import { createFactsSnapshot } from './evidenceContract.js';

const TARGET_PRODUCT = /women|womenswear|ladies|dress|top|skirt|trouser|outerwear|knitwear|abaya/i;

function rowsFor(evidence, types) {
  const allowed = new Set(types);
  return evidence.filter(row => allowed.has(row.evidence_type));
}

function support(rows, value, confidence = 0.75, observedAt = null) {
  const ids = rows.map(row => row.id).filter(Boolean);
  const dates = rows.map(row => row.captured_at).filter(Boolean).sort();
  return {
    value: ids.length ? value : 'UNKNOWN',
    confidence: ids.length ? Math.max(...rows.map(row => Number(row.confidence || confidence))) : 0,
    evidence_ids: ids,
    captured_at: dates.at(-1) || null,
    ...(observedAt ? { observed_at: observedAt } : {})
  };
}

function bestBuyerStatus(verification = {}) {
  const statuses = [verification.importer_status, verification.wholesaler_status, verification.distributor_status];
  if (statuses.includes('VERIFIED')) return 'VERIFIED';
  if (statuses.includes('SUPPORTED')) return 'SUPPORTED';
  if (verification.general_trading_status === 'VERIFIED' || verification.general_trading_status === 'SUPPORTED') return 'BUSINESS_TRADING';
  return 'UNKNOWN';
}

function observedDate(rows, asOf) {
  const dated = rows.flatMap(row => String(row.evidence_value || row.evidence_text || '').match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [])
    .map(value => new Date(`${value}T00:00:00Z`)).filter(value => Number.isFinite(value.getTime()))
    .sort((a, b) => b - a)[0];
  if (!dated) return null;
  const ageDays = (new Date(asOf).getTime() - dated.getTime()) / 86400000;
  return ageDays >= 0 && ageDays <= 365 ? dated.toISOString() : null;
}

export function buildCompanyFactsSnapshot({ company = {}, verification = {}, evidence = [], contacts = [], sources = [], asOf = new Date().toISOString() }) {
  const productEvidence = rowsFor(evidence, ['PRODUCT_CATEGORY','BRANDS']);
  const sourceProductEvidence = sources.filter(row => TARGET_PRODUCT.test(JSON.stringify(row.raw_payload || {}) + ' ' + (row.provider_reference || '')));
  const allProductEvidence = [...productEvidence, ...sourceProductEvidence];
  const locationEvidence = rowsFor(evidence, ['LOCATION']);
  const buyerEvidence = rowsFor(evidence, ['IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING']);
  const chainEvidence = rowsFor(evidence, ['RETAIL_CHANNEL','REGIONAL_COVERAGE','WAREHOUSE','LOCATIONS']);
  const scaleEvidence = rowsFor(evidence, ['EMPLOYEE_SIZE','COMPANY_SCALE','LOCATIONS','WAREHOUSE']);
  const recentEvidence = rowsFor(evidence, ['RECENT_ACTIVITY']);
  const recentObservedAt = observedDate(recentEvidence, asOf);
  const targetProduct = TARGET_PRODUCT.test((company.product_categories || []).join(' ') + ' ' + (company.company_description || ''));
  const size = String(verification.company_size || company.company_size_band || 'UNKNOWN').toUpperCase();
  const scaleValue = ['LARGE','ENTERPRISE'].includes(size) ? 'STRONG' : size === 'MEDIUM' ? 'MEDIUM' : ['MICRO','SMALL'].includes(size) ? 'SMALL' : 'UNKNOWN';
  const rankedContacts = [...contacts].sort((a, b) => {
    const rank = value => value === 'DOMAIN_MX_VERIFIED' || value === 'valid' ? 4 : value === 'PUBLICLY_OBSERVED' ? 3 : 1;
    return rank(b.verification_status || b.email_verification_status) - rank(a.verification_status || a.email_verification_status);
  });
  const contact = rankedContacts[0];
  const contactStatus = contact?.verification_status || contact?.email_verification_status;
  const contactValue = contactStatus === 'DOMAIN_MX_VERIFIED' || contactStatus === 'valid' ? 'DOMAIN_MX_VERIFIED'
    : contactStatus === 'PUBLICLY_OBSERVED' ? 'PUBLICLY_OBSERVED'
      : contact?.contact_type === 'PHONE' || contact?.business_phone ? 'FORM_OR_PHONE'
        : company.website_url ? 'WEBSITE_ONLY' : 'UNKNOWN';
  const contactIds = contact?.id ? [contact.id] : [];

  return createFactsSnapshot({
    verification_status: verification.verification_status || company.phase4_verification_status || 'UNKNOWN',
    as_of: asOf,
    facts: {
      product_fit: support(allProductEvidence, targetProduct ? 'VERIFIED' : 'SUPPORTED'),
      market_fit: support(locationEvidence, 'TARGET'),
      importer_wholesaler_fit: support(buyerEvidence, bestBuyerStatus(verification)),
      chain_supply_evidence: support(chainEvidence, chainEvidence.length >= 2 ? 'VERIFIED' : 'SUPPORTED'),
      distribution_scale: support(scaleEvidence, scaleValue),
      recent_buying_signal: support(recentObservedAt ? recentEvidence : [], recentObservedAt ? 'VERIFIED_RECENT' : 'UNKNOWN', 0.75, recentObservedAt),
      decision_maker_quality: { value: 'UNKNOWN', confidence: 0, evidence_ids: [], captured_at: null },
      contact_validity: {
        value: contactIds.length ? contactValue : 'UNKNOWN',
        confidence: contactIds.length ? 0.8 : 0,
        evidence_ids: contactIds,
        captured_at: contact?.captured_at || contact?.verification_checked_at || null
      }
    }
  });
}
