#!/usr/bin/env node
// Dev-time importer: converts the Shopify Standard Product Taxonomy (MIT,
// https://github.com/Shopify/product-taxonomy) into the trimmed multilingual category
// candidate file used by GET /api/category-scopes/taxonomy and custom category drafts.
//
// 1. Download the release text files (one per locale) into an empty folder outside the repo:
//      for l in en de fr es pt-BR it tr zh-CN; do
//        curl -fsSLO https://github.com/Shopify/product-taxonomy/releases/download/v2026-08/categories.$l.txt.gz; done
// 2. node scripts/import-product-taxonomy.mjs --input <folder> [--verticals aa,hg,lb,bt,tg,os,hb,fr] [--max-depth 4]
//
// Output: rules/product-taxonomy/shopify/categories-subset.json (apparel, home and general
// merchandise verticals only) next to the upstream LICENSE notice.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const option=(name,fallback=null)=>{const index=args.indexOf(name);return index>=0?args[index+1]:fallback;};
const input=option('--input');
if(!input){console.error('Usage: --input <folder with categories.<locale>.txt[.gz]> [--verticals aa,hg,...] [--max-depth N]');process.exit(2);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Locale file name -> alias language code used by category scope aliases.
const LOCALES={en:'en',es:'es',de:'de',fr:'fr','pt-BR':'pt',it:'it',tr:'tr','zh-CN':'zh'};
// Apparel & Accessories, Home & Garden, Luggage & Bags, Baby & Toddler, Toys & Games,
// Office Supplies, Health & Beauty, Furniture: the supply range of the two product profiles.
const verticals=new Set(String(option('--verticals','aa,hg,lb,bt,tg,os,hb,fr')).split(',').map(value=>value.trim()).filter(Boolean));
const maxDepth=Math.max(1,Number(option('--max-depth',4))||4);

function read(locale){
  for(const name of [`categories.${locale}.txt`,`categories.${locale}.txt.gz`]){
    const file=path.join(input,name);
    if(existsSync(file)){const raw=readFileSync(file);return (name.endsWith('.gz')?gunzipSync(raw):raw).toString('utf8');}
  }
  return null;
}
function parse(text){
  const rows=new Map();let version=null;
  for(const line of text.split(/\r?\n/)){
    const header=/^#.*Categories:\s*(\S+)/.exec(line);if(header)version=header[1];
    const match=/^gid:\/\/shopify\/TaxonomyCategory\/(\S+)\s*:\s*(.+)$/.exec(line);
    if(match)rows.set(match[1],match[2].split(' > ').map(value=>value.trim()));
  }
  return {version,rows};
}

const english=read('en');if(!english)throw new Error('categories.en.txt(.gz) is required');
const base=parse(english);
const localized=Object.fromEntries(Object.keys(LOCALES).filter(locale=>locale!=='en').map(locale=>[locale,read(locale)]).filter(([,text])=>text)
  .map(([locale,text])=>[locale,parse(text).rows]));
const normalizedCategory=value=>String(value).toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100);
const categories=[];
for(const [id,pathNames] of base.rows){
  const vertical=id.split('-')[0];
  if(!verticals.has(vertical)||pathNames.length>maxDepth)continue;
  const names={en:pathNames.at(-1)};
  for(const [locale,rows] of Object.entries(localized)){const value=rows.get(id);if(value)names[LOCALES[locale]]=value.at(-1);}
  categories.push({id,parent_id:id.includes('-')?id.slice(0,id.lastIndexOf('-')):null,depth:pathNames.length,path:pathNames.join(' > '),
    names,suggested_category_code:normalizedCategory(pathNames.at(-1)),
    suggested_product_profile:id==='aa-1'||id.startsWith('aa-1-')?'WOMENSWEAR':'GENERAL_MERCHANDISE'});
}
const outputDir=path.join(root,'rules/product-taxonomy/shopify');
mkdirSync(outputDir,{recursive:true});
writeFileSync(path.join(outputDir,'categories-subset.json'),`${JSON.stringify({source:'Shopify Standard Product Taxonomy',
  source_url:'https://github.com/Shopify/product-taxonomy',license:'MIT',version:base.version,generated_by:'scripts/import-product-taxonomy.mjs',
  verticals:[...verticals],max_depth:maxDepth,languages:['en',...Object.keys(localized).map(locale=>LOCALES[locale])],categories})}\n`);
console.log(`Wrote ${categories.length} categories (${base.version}) to rules/product-taxonomy/shopify/categories-subset.json`);
