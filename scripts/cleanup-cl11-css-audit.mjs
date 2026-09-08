// Read-only selector inventory. A zero lexical hit is a review candidate, not permission to purge.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'services/demo-dashboard/package.json'));
const csstree=require('css-tree');
const publicRoot=path.join(root,'services/demo-dashboard/public');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const runtime=walk(publicRoot).filter(f=>/\.(js|html)$/.test(f));
const tests=walk(path.join(root,'services/demo-dashboard/test')).filter(f=>f.endsWith('.js'));
const sources=[...runtime,...tests].map(file=>({file:path.relative(root,file).replaceAll('\\','/'),text:fs.readFileSync(file,'utf8')}));
const rows=[];
for(const file of walk(publicRoot).filter(f=>f.endsWith('.css'))){
 const ast=csstree.parse(fs.readFileSync(file,'utf8'),{positions:true});
 csstree.walk(ast,{visit:'Rule',enter(node){
  if(node.prelude?.type!=='SelectorList')return;
  node.prelude.children.forEach(selector=>{
   const names=[];
   csstree.walk(selector,n=>{if(['ClassSelector','IdSelector'].includes(n.type))names.push(n.name);});
   const refs=sources.filter(s=>names.some(name=>s.text.includes(name))).map(s=>s.file);
   const dynamic=names.some(n=>/^(tier-|verification-|business-|level-|p11-runtime-|v3-automation-)/.test(n));
   rows.push({file:path.relative(root,file).replaceAll('\\','/'),line:node.loc.start.line,selector:csstree.generate(selector),names,refs,classification:!names.length?'KEEP_CURRENT_STRUCTURAL':refs.length?'KEEP_CURRENT_REFERENCED':dynamic?'KEEP_CURRENT_DYNAMIC':names.includes('btn-danger')?'KEEP_CURRENT_VENDOR_COMPAT':'REVIEW_REQUIRED_DYNAMIC'});
  });
 }});
}
console.log(JSON.stringify({method:'CSS AST, HTML/JS/test lexical candidates; dynamic selectors require manual review',files:new Set(rows.map(r=>r.file)).size,total:rows.length,counts:rows.reduce((a,r)=>(a[r.classification]=(a[r.classification]||0)+1,a),{}),selectors:rows},null,2));
