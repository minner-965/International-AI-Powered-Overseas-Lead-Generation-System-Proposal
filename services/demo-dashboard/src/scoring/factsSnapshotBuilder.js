import { createFactsSnapshot } from './evidenceContract.js';
import { getProductCategoryProfile } from '../market/productProfiles.js';

// Batch 3 C4 (facts for dpv-score-v2):
//  - product terms match whole words only ("address" / "laptop" no longer hit dress / top) and come
//    from the company's own product categories (womenswear terms only as the fallback);
//  - Hunter's upper-case VALID is a mailbox-verified contact, like the legacy lower-case "valid";
//  - company size keeps its band (MICRO..ENTERPRISE) so the rule can rank medium highest.
const FALLBACK_TARGET_TERMS = ['women', 'womenswear', 'ladies', 'dress', 'dresses', 'top', 'tops', 'skirt', 'skirts',
  'trousers', 'outerwear', 'knitwear', 'abaya', 'abayas'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function wholeWordPattern(terms) {
  const values = [...new Set((terms || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
  if (!values.length) return /$^/;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${values.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}
export function targetProductTerms(company = {}) {
  const terms = (company.product_categories || []).flatMap(category => {
    const profile = getProductCategoryProfile(category, { languages: ['es', 'pt', 'ar'] });
    return [...profile.evidenceTerms, String(category || '').toLowerCase()];
  }).filter(Boolean);
  return terms.length ? terms : FALLBACK_TARGET_TERMS;
}

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
  if (verification.retail_chain_status === 'VERIFIED') return 'RETAIL_CHAIN';
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

const upper = value => String(value || '').trim().toUpperCase();
export function contactValidityValue(contact = {}) {
  const raw = String(contact.verification_status || contact.email_verification_status || '').trim();
  const status = upper(raw);
  const routeStatus = upper(contact.contact_verification_status);
  // Legacy lower-case "valid" on leadgen.contacts means domain/MX checked only; Hunter writes upper-case VALID.
  if (raw === 'valid') return 'DOMAIN_MX_VERIFIED';
  if (status === 'VALID') return 'MAILBOX_VERIFIED';
  if (status === 'ACCEPT_ALL' && Number(contact.verification_score) >= 85) return 'ACCEPT_ALL_HIGH';
  if (status === 'DOMAIN_MX_VERIFIED' || routeStatus === 'DOMAIN_MX_VERIFIED') return 'DOMAIN_MX_VERIFIED';
  if (status === 'PUBLICLY_OBSERVED' || routeStatus === 'PUBLICLY_OBSERVED') return 'PUBLICLY_OBSERVED';
  if (upper(contact.contact_type).includes('PHONE') || contact.business_phone) return 'FORM_OR_PHONE';
  return null;
}
const CONTACT_RANK = { MAILBOX_VERIFIED: 6, ACCEPT_ALL_HIGH: 5, DOMAIN_MX_VERIFIED: 4, PUBLICLY_OBSERVED: 3, FORM_OR_PHONE: 2 };
const SIZES = new Set(['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE']);

export function buildCompanyFactsSnapshot({ company = {}, verification = {}, evidence = [], contacts = [], sources = [], asOf = new Date().toISOString() }) {
  const targetPattern = wholeWordPattern(targetProductTerms(company));
  const productEvidence = rowsFor(evidence, ['PRODUCT_CATEGORY', 'BRANDS']);
  // Sources: only their human-readable text, never JSON keys of the payload.
  const sourceText = row => [row.provider_reference, row.raw_payload?.evidence, row.raw_payload?.title, row.raw_payload?.snippet]
    .filter(value => typeof value === 'string').join(' ');
  const sourceProductEvidence = sources.filter(row => targetPattern.test(sourceText(row)));
  const allProductEvidence = [...productEvidence, ...sourceProductEvidence];
  const locationEvidence = rowsFor(evidence, ['LOCATION']);
  const buyerEvidence = rowsFor(evidence, ['IMPORTER', 'WHOLESALER', 'DISTRIBUTOR', 'GENERAL_TRADING', 'RETAIL_CHAIN', 'DEPARTMENT_STORE']);
  const chainEvidence = rowsFor(evidence, ['RETAIL_CHANNEL', 'REGIONAL_COVERAGE', 'WAREHOUSE', 'LOCATIONS', 'RETAIL_CHAIN', 'DEPARTMENT_STORE']);
  const scaleEvidence = rowsFor(evidence, ['EMPLOYEE_SIZE', 'COMPANY_SCALE', 'LOCATIONS', 'WAREHOUSE']);
  const recentEvidence = rowsFor(evidence, ['RECENT_ACTIVITY']);
  const recentObservedAt = observedDate(recentEvidence, asOf);
  const targetProduct = productEvidence.some(row => targetPattern.test(`${row.evidence_text || ''} ${row.evidence_value || ''}`))
    || targetPattern.test(`${company.company_description || ''}`);
  const size = upper(verification.company_size || company.company_size_band || 'UNKNOWN');
  const scaleValue = SIZES.has(size) ? size : 'UNKNOWN';
  const ranked = contacts.map(contact => ({ contact, value: contactValidityValue(contact) }))
    .filter(item => item.value)
    .sort((a, b) => CONTACT_RANK[b.value] - CONTACT_RANK[a.value]);
  const best = ranked[0];
  const contactValue = best?.value || (company.website_url ? 'WEBSITE_ONLY' : 'UNKNOWN');
  const contactIds = best?.contact?.id ? [best.contact.id] : [];

  return createFactsSnapshot({
    verification_status: verification.verification_status || company.phase4_verification_status || 'UNKNOWN',
    as_of: asOf,
    facts: {
      product_fit: support(allProductEvidence, targetProduct ? 'VERIFIED' : 'SUPPORTED'),
      market_fit: support(locationEvidence, 'TARGET'),
      importer_wholesaler_fit: support(buyerEvidence, bestBuyerStatus(verification)),
      chain_supply_evidence: support(chainEvidence, chainEvidence.length >= 2 ? 'VERIFIED' : 'SUPPORTED'),
      distribution_scale: support(scaleValue === 'UNKNOWN' ? [] : scaleEvidence, scaleValue),
      recent_buying_signal: support(recentObservedAt ? recentEvidence : [], recentObservedAt ? 'VERIFIED_RECENT' : 'UNKNOWN', 0.75, recentObservedAt),
      decision_maker_quality: { value: 'UNKNOWN', confidence: 0, evidence_ids: [], captured_at: null },
      contact_validity: {
        value: contactIds.length ? contactValue : 'UNKNOWN',
        confidence: contactIds.length ? 0.8 : 0,
        evidence_ids: contactIds,
        captured_at: best?.contact?.captured_at || best?.contact?.verification_checked_at || best?.contact?.last_verified_at || null
      }
    }
  });
}
