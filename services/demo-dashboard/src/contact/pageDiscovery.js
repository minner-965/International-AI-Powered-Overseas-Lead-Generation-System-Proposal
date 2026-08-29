import { htmlService } from '../platform/HtmlService.js';
import { extractRootDomain, normalizeUrl } from '../search/resultNormalizer.js';

function linksFromPage(html, baseUrl) {
  const $ = htmlService.load(html);
  const links = $('a[href]').map((_i, node) => {
    const href = $(node).attr('href');
    try {
      const url = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return { url: url.href, text: $(node).text().replace(/\s+/g, ' ').trim() };
    } catch { return null; }
  }).get().filter(Boolean);
  for (const item of htmlService.jsonLdItems($)) {
    const contactPoints = Array.isArray(item?.contactPoint) ? item.contactPoint : item?.contactPoint ? [item.contactPoint] : [];
    for (const point of contactPoints) {
      if (point?.url) links.push({ url: String(point.url), text: 'contact' });
    }
    const aboutPages = Array.isArray(item?.aboutPage) ? item.aboutPage : item?.aboutPage ? [item.aboutPage] : [];
    for (const page of aboutPages) {
      const url = typeof page === 'string' ? page : page?.url || page?.['@id'];
      if (url) links.push({ url: String(url), text: 'about' });
    }
  }
  return links.map(link => {
    try { return { ...link, url: new URL(link.url, baseUrl).href }; } catch { return null; }
  }).filter(Boolean);
}

export function discoverCompanyPages(html, baseUrl) {
  const baseDomain = extractRootDomain(baseUrl);
  const sameSite = linksFromPage(html, baseUrl).filter(link => extractRootDomain(link.url) === baseDomain);
  const contact = sameSite.find(link => /contact|contact us|get in touch|enquir|inquir|联系我们|联系/i.test(`${link.text} ${link.url}`));
  const about = sameSite.find(link => /about|our company|who we are|company profile|关于|公司简介/i.test(`${link.text} ${link.url}`));
  return {
    contactUrl: contact ? normalizeUrl(contact.url) : null,
    aboutUrl: about ? normalizeUrl(about.url) : null
  };
}

export function discoverExternalWebsite(html, baseUrl) {
  const baseDomain = extractRootDomain(baseUrl);
  const ignored = /(?:facebook|instagram|linkedin|twitter|x|youtube|tiktok|whatsapp)\.com$|wa\.me$/i;
  const $ = htmlService.load(html);
  const structuredUrls = [];
  for (const item of htmlService.jsonLdItems($)) {
    const nodes = [item, item?.mainEntity, item?.item].filter(node => node && typeof node === 'object');
    for (const node of nodes) {
      const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
      if (!types.some(type => /organization|corporation|localbusiness|store|professionalservice/i.test(String(type || '')))) continue;
      for (const value of [node.url, node['@id']].flat().filter(Boolean)) {
        try {
          const url = new URL(String(value), baseUrl).href;
          const domain = extractRootDomain(url);
          if (domain && domain !== baseDomain && !ignored.test(domain)) structuredUrls.push(url);
        } catch {}
      }
    }
  }
  if (structuredUrls.length) return normalizeUrl(structuredUrls[0]);

  const allLinks = linksFromPage(html, baseUrl);
  const links = allLinks.filter(link => {
    const domain = extractRootDomain(link.url);
    return domain && domain !== baseDomain && !ignored.test(domain);
  });
  const preferred = links.find(link => /website|visit site|official site|company site|网址|官网/i.test(link.text));
  if (preferred) return normalizeUrl(preferred.url);

  const redirect = allLinks.find(link => /website|visit site|official site|company site|网址|官网/i.test(link.text)
    && extractRootDomain(link.url) === baseDomain
    && /redirect|outbound|external|visit[-_/]?website|website[-_/]?link/i.test(new URL(link.url).pathname));
  if (!redirect) return null;
  const redirectUrl = new URL(redirect.url);
  for (const key of ['url', 'target', 'redirect', 'redirect_url', 'website']) {
    const value = redirectUrl.searchParams.get(key);
    if (!value) continue;
    try {
      const target = new URL(value);
      const domain = extractRootDomain(target.href);
      if (domain && domain !== baseDomain && !ignored.test(domain)) return normalizeUrl(target.href);
    } catch {}
  }
  return normalizeUrl(redirect.url);
}
