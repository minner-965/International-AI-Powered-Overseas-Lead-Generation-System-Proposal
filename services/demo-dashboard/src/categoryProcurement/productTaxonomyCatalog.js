import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only search over the imported Shopify Standard Product Taxonomy subset (MIT), used to
// propose a custom category with names in every search language. Proposals still go through
// the category-scope draft and management approval.
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../');
const subsetPath=()=>[process.env.DPV_RULES_DIR,path.join(projectRoot,'rules'),path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rules')]
  .filter(Boolean).map(root=>path.join(root,'product-taxonomy','shopify','categories-subset.json')).find(file=>fs.existsSync(file));
const fold=value=>String(value||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('en-US').replace(/\s+/g,' ').trim();

let cache=null;
export function loadProductTaxonomyCatalog(){
  if(cache)return cache;
  const file=subsetPath();
  const data=file?JSON.parse(fs.readFileSync(file,'utf8')):{categories:[],version:null};
  cache={...data,index:data.categories.map(row=>({row,text:fold([row.path,...Object.values(row.names||{})].join(' | '))}))};
  return cache;
}

export function searchProductTaxonomy(query,{limit=20,profile=null}={}){
  const catalog=loadProductTaxonomyCatalog();
  const q=fold(query);
  const max=Math.max(1,Math.min(100,Number(limit)||20));
  const wantedProfile=profile?String(profile).toUpperCase():null;
  const matches=[];
  if(q.length<2)return {version:catalog.version,source:catalog.source||null,license:catalog.license||null,items:[]};
  for(const {row,text} of catalog.index){
    if(!text.includes(q))continue;
    if(wantedProfile&&row.suggested_product_profile!==wantedProfile)continue;
    const leaf=Object.values(row.names||{}).map(fold);
    const score=(leaf.includes(q)?0:leaf.some(name=>name.startsWith(q))?1:2)*10+row.depth;
    matches.push({score,row});
  }
  matches.sort((a,b)=>a.score-b.score||a.row.path.localeCompare(b.row.path));
  return {version:catalog.version,source:catalog.source||null,license:catalog.license||null,
    items:matches.slice(0,max).map(({row})=>({taxonomy_id:row.id,path:row.path,names:row.names,
      suggested_category_code:row.suggested_category_code,suggested_product_profile:row.suggested_product_profile}))};
}

export function productTaxonomyEntry(id){
  return loadProductTaxonomyCatalog().categories.find(row=>row.id===String(id||'').trim())||null;
}
