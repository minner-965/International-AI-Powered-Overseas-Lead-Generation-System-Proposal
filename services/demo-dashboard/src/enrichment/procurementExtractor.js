import { createHash } from 'node:crypto';
import { htmlService } from '../platform/HtmlService.js';
import { domainService } from '../platform/DomainService.js';
import { normalizeDecisionRole, normalizedIdentity, productRoleRelevance, roleRelevance } from './roleNormalizer.js';

const NAME = "[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+){1,4}";
const roleSignal = /buyer|buying|purchas|procurement|category manager|merchandis|sourcing|import manager|commercial director|comprador|compras|abastecimiento|adquisiciones/i;
const departmentSignal = /buying department|procurement department|purchasing department|merchandising department|sourcing department|departamento de compras|departamento de adquisiciones|area de abastecimiento|área de abastecimiento/i;
const supplierRouteSignal = /supplier registration|vendor registration|become a supplier|supplier onboarding|vendor onboarding|supplier portal|vendor portal|supplier application|register as (?:a )?supplier|registro de proveedores|alta de proveedores|quiero ser proveedor|portal de proveedores|requisitos de proveedor/i;

const barrierPatterns = Object.freeze([
  ['FIXED_SUPPLIER_NETWORK',/fixed supplier|established supplier network|proveedores fijos/i],
  ['INVITATION_ONLY',/invitation only|by invitation|solo por invitaci[oó]n/i],
  ['EXCLUSIVE_SUPPLY',/exclusive supplier|exclusive supply|proveedor(?:es)? exclusivo/i],
  ['CENTRALIZED_GLOBAL_PROCUREMENT',/centralized global procurement|global procurement office|compras globales centralizadas/i],
  ['LOCAL_SOURCE_ONLY',/local sourcing only|only local suppliers|solo proveedores locales|abastecimiento local exclusivamente/i],
  ['PREQUALIFICATION_REQUIRED',/prequalification required|pre-qualified suppliers only|precalificaci[oó]n requerida/i],
  ['LONG_TENDER_CYCLE',/multi-stage tender|long tender cycle|licitaci[oó]n de varias etapas/i],
  ['HIGH_COMPLIANCE_GATE',/mandatory supplier certification|strict supplier compliance|audited supplier code|certificaci[oó]n obligatoria de proveedores/i]
]);

const opennessPositive = /external suppliers|third[- ]party suppliers|international suppliers|imported brands|multi[- ]brand|supplier application|become a supplier|proveedores externos|proveedores internacionales|marcas importadas|quiero ser proveedor/i;
const operationalPositive = /incoterms?|minimum order|\bMOQ\b|shipping|logistics|import|supplier requirements|packaging requirements|certification|requisitos de proveedor|importaci[oó]n|log[ií]stica/i;

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0,max);
}

function unique(items, keyFn) {
  const seen = new Set();
  return items.filter(item=>{
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function credibleNamedTitle(value) {
  const title = cleanText(value,180).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (!title || title.split(/\s+/).length > 12) return false;
  if (/\b(?:guide|tips?|mistakes?|faq|frequently asked|preguntas frecuentes|how|why|blog|article|wholesale vs|retail stock|buying in bulk)\b/.test(title)) return false;
  const directRole = [
    /\b(?:senior\s+)?(?:(?:women'?s?wear|apparel|fashion|home|household|general merchandise)\s+)?buyer\b/,
    /\b(?:head buyer|head of buying|buying director)\b/,
    /\b(?:purchasing|procurement|category|merchandising|sourcing|import|commercial)\s+(?:manager|director|lead|head)\b/,
    /\b(?:head|director|manager|lead)\s+of\s+(?:purchasing|procurement|buying|category|merchandising|sourcing|import)\b/,
    /\bcomprador(?:a)?(?:\s+senior|\s+de\s+(?:moda|ropa|textil))?\b/,
    /\b(?:gerente|director|jefe)\s+de\s+(?:compras|adquisiciones|abastecimiento|categoria|importaciones)\b/,
    /\b(?:director|gerente)\s+comercial\b/
  ].some(pattern=>pattern.test(title));
  if (!directRole) return false;
  const normalizedRole = normalizeDecisionRole(title);
  return !['UNKNOWN','OTHER_RELEVANT'].includes(normalizedRole);
}

function evidenceHash(...parts) {
  return createHash('sha256').update(parts.map(value=>String(value || '')).join('|')).digest('hex');
}

function explicitRoleFromBlock(block) {
  if (!roleSignal.test(block) || block.length > 260) return null;
  const before = block.match(new RegExp(`^(${NAME})\\s*(?:[,|–—-])\\s*(.+)$`));
  if (before && credibleNamedTitle(before[2])) {
    return { person_name:before[1], raw_title:cleanText(before[2],160) };
  }
  const after = block.match(new RegExp(`^(.+?)\\s*(?::|[|–—-])\\s*(${NAME})$`));
  if (after && credibleNamedTitle(after[1])) {
    return { person_name:after[2], raw_title:cleanText(after[1],160) };
  }
  const inline = block.match(new RegExp(`(${NAME})\\s*,\\s*([^,.;]{2,140})`));
  if (inline && credibleNamedTitle(inline[2])) {
    return { person_name:inline[1], raw_title:cleanText(inline[2],160) };
  }
  return null;
}

function departmentFromBlock(block) {
  const match = block.match(departmentSignal);
  if (match) return cleanText(match[0],120);
  if (supplierRouteSignal.test(block)) return /vendor|supplier|proveedor/i.test(block) ? 'Procurement Department' : null;
  return null;
}

function pageLinks($, sourceUrl) {
  return $('a[href]').map((_index,node)=>{
    const text = cleanText($(node).text(),300);
    const href = $(node).attr('href');
    try {
      const url = new URL(href,sourceUrl).href;
      return ['http:','https:'].includes(new URL(url).protocol) ? { text,url } : null;
    } catch { return null; }
  }).get().filter(Boolean);
}

export function extractProcurementPage(html, sourceUrl, {
  officialRootDomain = '', marketProfile = {}, productProfiles = ['WOMENSWEAR','GENERAL_MERCHANDISE'], capturedAt = new Date()
} = {}) {
  const $ = htmlService.load(html);
  $('script,style,noscript,template,svg').remove();
  const blocks = unique($('title,h1,h2,h3,h4,p,li,dt,dd,address').map((_index,node)=>cleanText($(node).text(),500)).get().filter(Boolean), value=>value.toLowerCase());
  const visibleText = cleanText($('body').text(),25000);
  const root = domainService.getRegistrableDomain(sourceUrl);
  const official = Boolean(root && officialRootDomain && root === officialRootDomain);
  const sourceAuthority = official ? 'OFFICIAL' : 'OTHER_PUBLIC';
  const sourceType = official ? 'OFFICIAL_COMPANY_PAGE' : 'PUBLIC_WEB_PAGE';
  const decisionMakers = [];
  for (const block of blocks) {
    const named = explicitRoleFromBlock(block);
    const department = departmentFromBlock(block);
    if (!named && !department) continue;
    const rawTitle = named?.raw_title || department;
    const normalizedRole = normalizeDecisionRole(rawTitle);
    if (normalizedRole === 'UNKNOWN' && !department) continue;
    decisionMakers.push({
      person_name:named?.person_name || null,
      person_name_normalized:named ? normalizedIdentity(named.person_name) : null,
      department_name:department || null,
      department_name_normalized:department ? normalizedIdentity(department) : null,
      raw_title:rawTitle,
      normalized_role:normalizedRole === 'UNKNOWN' && department ? 'PROCUREMENT_DEPARTMENT' : normalizedRole,
      role_relevance:roleRelevance(normalizedRole === 'UNKNOWN' && department ? 'PROCUREMENT_DEPARTMENT' : normalizedRole),
      verification_status:official ? 'VERIFIED' : 'REVIEW',
      evidence_strength:official ? 'STRONG' : 'SUPPORTED',
      source:{
        source_url:sourceUrl,source_type:sourceType,source_authority:sourceAuthority,captured_at:capturedAt,
        evidence_text:block,evidence_hash:evidenceHash(sourceUrl,block,rawTitle),
        evidence_status:official ? 'VERIFIED' : 'REVIEW',is_primary:official,content_fetched:true
      },
      product_relevance:Object.fromEntries(productProfiles.map(profile=>[
        profile,productRoleRelevance(rawTitle,normalizedRole,profile,visibleText.slice(0,3000))
      ]))
    });
  }

  const supplierRoutes = unique(pageLinks($,sourceUrl).filter(link=>supplierRouteSignal.test(`${link.text} ${link.url}`)).map(link=>({
    contact_type:/vendor registration|registro de proveedores|alta de proveedores/i.test(`${link.text} ${link.url}`) ? 'VENDOR_REGISTRATION' : 'SUPPLIER_PORTAL',
    contact_value_raw:link.url,
    contact_value_normalized:domainService.normalizeUrl(link.url) || link.url,
    verification_status:'PUBLICLY_OBSERVED',
    source_url:sourceUrl,
    is_generic:false,
    is_department:true,
    label:link.text || 'Supplier route'
  })), item=>`${item.contact_type}|${item.contact_value_normalized}`);

  const barrierSignals = barrierPatterns.filter(([,pattern])=>pattern.test(visibleText)).map(([code])=>code);
  const explicitClosed = barrierSignals.some(code=>['FIXED_SUPPLIER_NETWORK','INVITATION_ONLY','EXCLUSIVE_SUPPLY','LOCAL_SOURCE_ONLY'].includes(code));
  return {
    page_title:cleanText($('title').first().text(),1000) || null,
    decision_makers:unique(decisionMakers,item=>`${item.person_name_normalized || ''}|${item.department_name_normalized || ''}|${item.normalized_role}|${item.raw_title.toLowerCase()}`),
    supplier_routes:supplierRoutes,
    barrier_signals:barrierSignals,
    supplier_openness:explicitClosed ? 'CLOSED' : opennessPositive.test(visibleText) ? 'OPEN' : 'UNKNOWN',
    operational_feasibility:barrierSignals.includes('HIGH_COMPLIANCE_GATE') ? 'BARRIER' : operationalPositive.test(visibleText) ? 'SUPPORTED' : 'UNKNOWN',
    department_evidence:departmentSignal.test(visibleText),
    supplier_access_evidence:supplierRoutes.length > 0 || supplierRouteSignal.test(visibleText),
    source_authority:sourceAuthority,
    content_text:visibleText
  };
}

export function discoverProcurementLinks(html, baseUrl, marketProfile = {}) {
  const $ = htmlService.load(html);
  const terms = [...(marketProfile.procurementDepartmentTerms || []),...(marketProfile.supplierAccessTerms || []),...(marketProfile.supplierBarrierTerms || [])]
    .map(value=>String(value).toLowerCase());
  return unique($('a[href]').map((_index,node)=>{
    const text = cleanText($(node).text(),250);
    const href = $(node).attr('href');
    try {
      const url = new URL(href,baseUrl).href;
      const haystack = `${text} ${url}`.toLowerCase();
      if (!terms.some(term=>haystack.includes(term)) && !supplierRouteSignal.test(haystack) && !departmentSignal.test(haystack)) return null;
      return { url:domainService.normalizeUrl(url) || url,text };
    } catch { return null; }
  }).get().filter(Boolean), item=>item.url).slice(0,6);
}

export { barrierPatterns, supplierRouteSignal };
