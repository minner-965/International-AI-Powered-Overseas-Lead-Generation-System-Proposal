// Plan C1: retail chains and department stores as verified buyers.
//
// Own store network = a counted store network ("operates 200 stores", "50+ Supermarkets",
// "más de 300 tiendas") or own-operation wording about a network ("our stores", "nuestras
// sucursales", "store locator"). Market statistics ("there are 26 supermarket chains with 3,323
// stores", "según ANTAD ...") and a single shop ("visit our store") do not count.
// Pure: no I/O. Mirrors the retail-chain wording of opportunityPool/classifierV2.js.

const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();

const STORE_NOUNS = '(?:stores|shops|branches|outlets|showrooms|boutiques|supermarkets|hypermarkets|department stores|retail stores|convenience stores|tiendas|sucursales|almacenes|lojas|filiais|متاجر|فروع|محلات)';
const NUMBER = '\\d{1,3}(?:[.,]\\d{3})*|\\d{1,6}';
const STORE_COUNT = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUMBER})\\s*\\+?\\s*(?:new\\s+|retail\\s+|own\\s+|specialty\\s+)?${STORE_NOUNS}(?![\\p{L}\\p{N}])`, 'iu');
const OWN_NETWORK = new RegExp([
  `\\b(?:we|our group|the group|the company)\\s+(?:currently\\s+)?(?:operates?|runs?|manages?|has|have|opened)\\b[^.]{0,60}${STORE_NOUNS}`,
  `\\b(?:currently\\s+)?operat(?:es|ing)\\s+(?:over|more than|nearly|around|some|about)?\\s*\\d`,
  `\\b(?:our|all our|visit our|find our)\\s+(?:\\p{L}+\\s+)?${STORE_NOUNS}`,
  `\\b(?:network|chain) of\\s+(?:over |more than |nearly )?\\d[\\d.,]*\\+?\\s*${STORE_NOUNS}`,
  `\\bwith (?:a growing network of |over |more than |nearly |around )?\\d[\\d.,]*\\+?\\s*${STORE_NOUNS}`,
  `\\bopen(?:ed|ing)\\s+(?:over |more than |its |our )?\\d[\\d.,]*\\+?\\s*(?:new\\s+)?${STORE_NOUNS}`,
  `\\bstore locator\\b`,
  `(?:nuestras|nuestros|contamos con|operamos|tenemos)\\s+(?:más de\\s+)?(?:\\d[\\d.,]*\\s*)?${STORE_NOUNS}`,
  `(?:nossas|nossos|contamos com|operamos|temos)\\s+(?:mais de\\s+)?(?:\\d[\\d.,]*\\s*)?${STORE_NOUNS}`,
  '(?:متاجرنا|فروعنا|محلاتنا)'
].join('|'), 'iu');
// A leading stat-strip ("UAE Kuwait ... 50+ Supermarkets 100+ Brands") on the company's own page.
const STAT_STRIP = new RegExp(`(?:^|\\s)(?:${NUMBER})\\s*\\+\\s*${STORE_NOUNS}(?![\\p{L}\\p{N}])`, 'iu');
const MARKET_STATISTIC = /\b(?:there (?:are|were)|according to|statistics?|census|market share|market size|ANTAD|INEGI|IBGE|hay|existen|según|segun|de acuerdo con|existem|segundo dados)\b|\b\d[\d.,]*\s+(?:supermarket |department store |specialty store |retail )?(?:chains|cadenas|redes)\b/iu;
const OWN_FORMAT = /\b(?:is|are|we are)\s+(?:a|an|the|one of the)\s+(?:leading\s+|largest\s+|biggest\s+)?(?:department stores?|retail chains?|supermarket chains?|hypermarket chains?|chain of (?:stores|supermarkets|hypermarkets))\b|\b(?:somos|es)\s+(?:una|la)\s+(?:\p{L}+\s+)?(?:cadena de tiendas|cadena minorista|tienda departamental|cadena de supermercados)\b|\b(?:somos|é)\s+(?:uma|a)\s+(?:\p{L}+\s+)?(?:rede de lojas|loja de departamentos|rede de supermercados)\b/iu;
const DEPARTMENT_STORE = /\b(?:department stores?|tiendas? departamental(?:es)?|almacenes departamentales|lojas? de departamento)\b/iu;

/** Own store-network / department-store wording in one sentence, or null. */
export function retailChainSignal(sentence) {
  const text = tidy(sentence);
  if (!text || MARKET_STATISTIC.test(text)) return null;
  const counted = STORE_COUNT.test(text) && (OWN_NETWORK.test(text) || STAT_STRIP.test(text));
  const own = OWN_NETWORK.test(text) || OWN_FORMAT.test(text);
  if (!counted && !own) return null;
  const count = Number(String(text.match(STORE_COUNT)?.[0] || '').replace(/[^\d]/g, '')) || null;
  return {
    evidence_type: DEPARTMENT_STORE.test(text) ? 'DEPARTMENT_STORE' : 'RETAIL_CHAIN',
    method: counted ? 'STORE_NETWORK_COUNT' : 'OWN_STORE_NETWORK_WORDING',
    count
  };
}

/**
 * A retail chain / department store is a target buyer when its own store network is evidenced AND
 * the approved product category is evidenced on its pages. A store network alone stays UNKNOWN
 * (RETAIL_CHAIN_CATEGORY_EVIDENCE_MISSING), so it never makes a company material on its own.
 */
export function assessRetailChain(evidence = []) {
  const chain = evidence.filter(item => ['RETAIL_CHAIN', 'DEPARTMENT_STORE'].includes(item.evidence_type));
  const category = evidence.filter(item => item.evidence_type === 'PRODUCT_CATEGORY');
  if (!chain.length) return { status: 'UNKNOWN', evidenceIds: [], reasonCodes: [] };
  if (!category.length) return { status: 'UNKNOWN', evidenceIds: [], reasonCodes: ['RETAIL_CHAIN_CATEGORY_EVIDENCE_MISSING'] };
  return {
    status: 'VERIFIED',
    department_store: chain.some(item => item.evidence_type === 'DEPARTMENT_STORE'),
    evidenceIds: [...chain, ...category].map(item => item.id).filter(Boolean),
    reasonCodes: ['RETAIL_CHAIN_STORE_NETWORK_AND_CATEGORY']
  };
}

/** Retail-chain evidence rows for one page text (max three per page). */
export function retailChainEvidence(text, structuredTexts = []) {
  const rows = [];
  for (const sentence of tidy(text).split(/(?<=[.!?])\s+|\s*[|•]\s*/).map(tidy).filter(Boolean)) {
    const signal = retailChainSignal(sentence);
    if (signal) rows.push({ ...signal, text: sentence.slice(0, 700), confidence: signal.method === 'STORE_NETWORK_COUNT' ? 0.9 : 0.86, structured: false });
    if (rows.length >= 3) break;
  }
  for (const value of structuredTexts) {
    const signal = retailChainSignal(value);
    if (signal) rows.push({ ...signal, text: tidy(value).slice(0, 700), confidence: 0.86, structured: true });
  }
  return rows;
}
