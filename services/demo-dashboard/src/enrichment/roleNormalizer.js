const clean = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9&/]+/g, ' ').replace(/\s+/g, ' ').trim();

const RULES = Object.freeze([
  // Department routes must be classified before individual-role keywords such as
  // "compras", "procurement" or "sourcing" consume the same phrase.
  ['BUYING_DEPARTMENT', /\bbuying department\b|\bdepartamento de compras\b|\bequipo de compras\b/],
  ['PROCUREMENT_DEPARTMENT', /\bprocurement department\b|\bpurchasing department\b|\bdepartamento de adquisiciones\b|\barea de abastecimiento\b/],
  ['HEAD_OF_BUYING', /\b(?:head|director) of buying\b|\bhead buyer\b|\bbuying director\b|\bdirector de compras\b/],
  ['SENIOR_BUYER', /\bsenior (?:fashion |womens?wear |apparel |home |household |general merchandise )?buyer\b|\bcomprador(?:a)? senior\b/],
  ['BUYER', /\b(?:fashion|womens?wear|women s wear|apparel|home|household|general merchandise)?\s*buyer\b|\bhead buyer\b|\bcomprador(?:a)?\b/],
  ['PROCUREMENT', /\b(?:head of )?procurement\b|\bprocurement (?:manager|director|lead)\b|\badquisiciones\b/],
  ['PURCHASING', /\bpurchasing (?:manager|director|lead)\b|\b(?:gerente|director|jefe) de compras\b|\bcompras\b/],
  ['CATEGORY_MANAGEMENT', /\b(?:senior )?category (?:manager|director|lead|buyer)\b|\bgerente de categoria\b/],
  ['MERCHANDISING', /\b(?:head of )?merchandising\b|\bmerchandising (?:manager|director|lead)\b/],
  ['SOURCING', /\b(?:head of )?sourcing\b|\bsourcing (?:manager|director|lead)\b|\babastecimiento\b/],
  ['IMPORT', /\bimport (?:manager|director|lead)\b|\bgerente de importaciones\b/],
  ['COMMERCIAL', /\bcommercial (?:manager|director|lead)\b|\bdirector comercial\b|\bgerente comercial\b/]
]);

const HIGH = new Set([
  'BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT',
  'CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING','BUYING_DEPARTMENT','PROCUREMENT_DEPARTMENT'
]);

export function normalizeDecisionRole(rawTitle = '') {
  const value = clean(rawTitle);
  if (!value) return 'UNKNOWN';
  for (const [role, pattern] of RULES) if (pattern.test(value)) return role;
  if (/\b(?:ceo|chief executive|marketing|human resources|finance|accounting|sales)\b/.test(value)) return 'UNKNOWN';
  if (/\b(?:vendor|supplier|category|buying|procurement|purchasing|sourcing|merchandis|commercial|import)\b/.test(value)) return 'OTHER_RELEVANT';
  return 'UNKNOWN';
}

export function roleRelevance(normalizedRole) {
  if (HIGH.has(normalizedRole)) return 'HIGH';
  if (['IMPORT','COMMERCIAL','OTHER_RELEVANT'].includes(normalizedRole)) return 'MEDIUM';
  return normalizedRole === 'UNKNOWN' ? 'UNKNOWN' : 'LOW';
}

export function productRoleRelevance(rawTitle, normalizedRole, productProfile, companyEvidence = '') {
  const value = clean(`${rawTitle} ${companyEvidence}`);
  const profile = String(productProfile || '').toUpperCase();
  const fashion = /\b(?:women s wear|womenswear|ladies|fashion|apparel|clothing|garment|dress|skirt)\b/.test(value);
  const general = /\b(?:home & living|home and living|homeware|household|general merchandise|daily use|non food)\b/.test(value);
  if (profile === 'WOMENSWEAR') {
    if (fashion) return { relevance:'HIGH', reason:'Explicit womenswear/apparel buying scope' };
    if (general) return { relevance:'LOW', reason:'Explicit home/general-merchandise scope' };
  }
  if (profile === 'GENERAL_MERCHANDISE') {
    if (general) return { relevance:'HIGH', reason:'Explicit home/general-merchandise buying scope' };
    if (fashion) return { relevance:'LOW', reason:'Explicit fashion/apparel scope' };
  }
  if (HIGH.has(normalizedRole)) return { relevance:'MEDIUM', reason:'Relevant buying role; product scope requires confirmation' };
  if (['IMPORT','COMMERCIAL','OTHER_RELEVANT'].includes(normalizedRole)) return { relevance:'LOW', reason:'Commercial/import role is a fallback route' };
  return { relevance:'UNKNOWN', reason:'Buying responsibility is not established' };
}

export function normalizedIdentity(value = '') {
  return clean(value).replace(/\s+/g, ' ');
}

export const TARGET_DECISION_ROLES = Object.freeze([...HIGH,'IMPORT','COMMERCIAL','OTHER_RELEVANT']);
