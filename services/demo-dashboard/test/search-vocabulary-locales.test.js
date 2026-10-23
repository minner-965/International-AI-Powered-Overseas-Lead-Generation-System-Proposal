import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSearchPlanningConfig} from '../src/searchPlanning/config.js';

const root=new URL('../../../',import.meta.url);
const config=loadSearchPlanningConfig();
const strategies=config.strategies;
const taxonomy=JSON.parse(readFileSync(new URL('rules/product-taxonomy/shopify/categories-subset.json',root),'utf8'));
const byId=new Map(taxonomy.categories.map(c=>[c.id,c]));
const LOCALES=['de','fr','pt','it','tr'];
const CONJUNCTION={de:'und',fr:'et',pt:'e',it:'e',tr:'ve'};
// Loanwords that are genuinely used in these markets' trade wording.
const LOANWORDS={de:['non-food','lifestyle','distributor'],fr:['lifestyle'],pt:[],it:['lifestyle','top'],tr:[]};
const ENGLISH=new Set(['and','goods','store','stores','retail','retailer','wholesaler','importer','company','group','general','merchandise',
  'products','clothing','women','womenswear','home','living','household','daily','use','trading','department','fashion','consumer',
  'multi','category','dresses','skirts','trousers','outerwear','tops','knitwear','homeware','food','distributor','lifestyle','top']);
const buyerKeys=Object.keys(strategies.locales.en).filter(key=>key!=='category_terms');
const categoryCodes=Object.keys(strategies.locales.en.category_terms);

test('every locale has every category and buyer term, non-empty',()=>{
  for(const locale of LOCALES){
    const dictionary=strategies.locales[locale];
    assert.deepEqual(Object.keys(dictionary.category_terms).sort(),[...categoryCodes].sort(),locale);
    for(const code of categoryCodes)assert.ok(String(dictionary.category_terms[code]||'').trim().length>1,`${locale}.${code}`);
    for(const key of buyerKeys)assert.ok(String(dictionary[key]||'').trim().length>1,`${locale}.${key}`);
  }
});

test('no English leftovers except documented loanwords',()=>{
  for(const locale of LOCALES){
    const dictionary=strategies.locales[locale];
    const terms=[...categoryCodes.map(code=>[code,dictionary.category_terms[code]]),...buyerKeys.map(key=>[key,dictionary[key]])];
    for(const [key,value] of terms){
      let text=` ${String(value).toLowerCase()} `;
      for(const loan of LOANWORDS[locale])text=text.replaceAll(new RegExp(`(^|[\\s-])${loan}(?=[\\s-])`,'g'),' ');
      const leftovers=text.split(/[\s-]+/).filter(word=>ENGLISH.has(word));
      assert.deepEqual(leftovers,[],`${locale}.${key}="${value}"`);
      const english=key in strategies.locales.en.category_terms?strategies.locales.en.category_terms[key]:strategies.locales.en[key];
      if(!LOANWORDS[locale].includes(String(value).toLowerCase()))assert.notEqual(String(value).toLowerCase(),String(english).toLowerCase(),`${locale}.${key}`);
    }
  }
});

test('category terms record their source; Shopify-sourced terms equal the official localized name',()=>{
  const sources=strategies.category_term_sources;
  for(const locale of LOCALES){
    let fromTaxonomy=0;
    for(const code of categoryCodes){
      const source=sources[locale]?.[code];
      assert.match(String(source),/^(shopify:[a-z]{2}(-\d+)*|reviewed: .{10,})$/,`${locale}.${code}`);
      if(!source.startsWith('shopify:'))continue;
      const node=byId.get(source.slice(8));
      assert.ok(node,`${source} vendored`);
      let expected=node.names[locale].replace(/\s*&\s*/g,` ${CONJUNCTION[locale]} `);
      if(locale!=='de')expected=expected.toLowerCase();
      assert.equal(strategies.locales[locale].category_terms[code],expected,`${locale}.${code}`);
      fromTaxonomy++;
    }
    assert.ok(fromTaxonomy>=4,`${locale} uses the taxonomy where it has an equivalent`);
  }
});
