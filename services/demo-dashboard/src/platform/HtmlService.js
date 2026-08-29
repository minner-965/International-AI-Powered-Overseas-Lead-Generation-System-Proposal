import { load } from 'cheerio';

export class HtmlService {
  load(html) {
    return load(String(html || ''));
  }

  jsonLdItems(document) {
    const items = [];
    document('script[type="application/ld+json"]').each((_index, node) => {
      try {
        const parsed = JSON.parse(document(node).text());
        const visit = value => {
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
          items.push(value);
        };
        visit(parsed);
      } catch {}
    });
    return items;
  }
}

export const htmlService = new HtmlService();
