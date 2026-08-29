import { getMarketProfile } from '../market/marketProfiles.js';

function quote(value) {
  return `"${String(value || '').replaceAll('"', '').trim()}"`;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 390);
}

export function generateDecisionMakerQueries(company, { maxQueries = 5 } = {}) {
  const profile = getMarketProfile(company.country_code, company.country_name);
  const name = String(company.company_name || '').trim();
  const domain = String(company.official_root_domain || company.normalized_domain || '').trim().toLowerCase();
  const isMx = profile.countryCode === 'MX';
  const roleTerms = isMx
    ? ['comprador','gerente de compras','abastecimiento','adquisiciones','buyer']
    : ['buyer','procurement manager','purchasing manager','category manager','sourcing manager'];
  const accessTerms = isMx
    ? ['registro de proveedores','alta de proveedores','portal de proveedores','compras']
    : ['supplier registration','vendor registration','procurement','become a supplier'];
  const barrierTerms = isMx
    ? ['proveedores aprobados','precalificación','solo por invitación']
    : ['approved vendor','prequalification','invitation only'];
  const rows = [];
  if (domain) rows.push({
    query_type:'procurement_route',
    query_text:compact(`site:${domain} (${accessTerms.map(quote).join(' OR ')})`)
  });
  rows.push({
    query_type:'decision_maker_role',
    query_text:compact(`${quote(name)} (${roleTerms.map(quote).join(' OR ')})`)
  });
  rows.push({
    query_type:'supplier_access',
    query_text:compact(`${quote(name)} (${accessTerms.map(quote).join(' OR ')})`)
  });
  rows.push({
    query_type:'barrier_evidence',
    query_text:compact(`${quote(name)} (${barrierTerms.map(quote).join(' OR ')})`)
  });
  rows.push({
    query_type:'linkedin_reference',
    query_text:compact(`site:linkedin.com/in ${quote(name)} (${roleTerms.slice(0,3).map(quote).join(' OR ')})`)
  });
  return rows.filter(row=>row.query_text && !row.query_text.includes('""')).slice(0,Math.max(1,Math.min(5,maxQueries)));
}
