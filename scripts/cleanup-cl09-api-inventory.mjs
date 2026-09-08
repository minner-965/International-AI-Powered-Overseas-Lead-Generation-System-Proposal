import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// CL09 keeps CL01 evidence immutable. Route declarations are inventoried without
// importing server.js, connecting a database or invoking a route/provider.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(f=>f&&existsSync(resolve(root,f)));
const contents=new Map(files.filter(f=>/\.(?:js|mjs|cjs|html|json|yaml|yml|md)$/.test(f)).map(f=>[f,readFileSync(resolve(root,f),'utf8')]));
const sources={
  'services/demo-dashboard/src/server.js':'',
  'services/demo-dashboard/src/phase7/router.js':'',
  'services/demo-dashboard/src/research/router.js':'/api/research',
  'services/demo-dashboard/src/research/researchBatchRouter.js':'/api/research/batches'
};
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function references(path,except){
  const fragments=path.split(/:[A-Za-z_][\w]*/).filter(s=>s.length>1);
  const pattern=new RegExp(fragments.map(esc).join('[^\\n]{0,180}'));
  return [...contents].filter(([f,s])=>f!==except&&!f.startsWith('docs/')&&!f.endsWith('.md')&&pattern.test(s)).map(([f])=>f);
}
function owner(path){
  if(/outreach|contact-queue|contacts|manual-official|webhooks\/email/.test(path))return 'Contact / outreach';
  if(/research/.test(path))return 'Research / frozen plan';
  if(/automation/.test(path))return 'Automation controls';
  if(/export|import|reference-data/.test(path))return 'Data exchange';
  if(/crm|repl|sales/.test(path))return 'Reply / CRM';
  if(/opportunit|category|product/.test(path))return 'Category / opportunity';
  if(/companies|leads|icp|scor/.test(path))return 'Company / scoring';
  return 'Operations';
}
const rows=[];
for(const [file,prefix] of Object.entries(sources)){
  const source=contents.get(file);
  const declarations=[...source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g)];
  for(let i=0;i<declarations.length;i++){
    const match=declarations[i],block=source.slice(match.index,declarations[i+1]?.index??source.length);
    const paths=match[3].includes('${provider}')?['resend','corporate'].map(p=>match[3].replace('${provider}',p)):[match[3]];
    for(const raw of paths){
      const path=(prefix+raw).replace(/\/$/,'')||'/', refs=references(path,file);
      const callerGroups={ui:refs.filter(f=>f.includes('/public/')),worker:refs.filter(f=>f.includes('/src/')),test:refs.filter(f=>/\/(?:test|tests)\//.test(f)),scripts:refs.filter(f=>f.startsWith('scripts/')),workflow:refs.filter(f=>f.startsWith('workflows/'))};
      const auth=block.match(/requireInternalToken|\.\.\.(?:read|draftWrite|managementApprove|outreachApprove|send|dataWrite|exportWrite|automationRead|automationWrite)|managementAuth\.authenticate/)?.[0]
        ||(file.includes('/research/')?'router-level authentication':path.includes('/webhooks/email/')?'provider signature validation':'PUBLIC_OR_HANDLER_CHECK');
      const calls=[...new Set([...block.matchAll(/\b(service(?:\.repository)?|\w+Service|\w+Facade|\w+Orchestrator)\.([\w]+)\s*\(/g)].map(m=>m[1]+'.'+m[2]))];
      const retired=/res\.status\(410\)|RETIRED_POLICY/.test(block)||(/manual-official-routes\//.test(path));
      rows.push({method:match[1].toUpperCase(),path,file,line:source.slice(0,match.index).split('\n').length,owner:owner(path),auth,calls,callers:callerGroups,
        classification:retired?'KEEP_RETIRED_BOUNDARY':refs.length?'KEEP_REFERENCED':'REVIEW_REQUIRED',
        db_writes:retired?'NONE: retired boundary':match[1]==='get'?'READ route; transitive effects require service review':'POSSIBLE: mutation/service contract',
        side_effects:retired?'NONE':match[1]==='get'?'Projection/download; no provider invocation inferred':'May enqueue/write/call provider; retained, not executed'});
    }
  }
}
rows.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const cell=x=>String(x).replaceAll('|','\\|').replaceAll('\n',' ');
const table=rows.map(r=>`| ${[r.method+' '+r.path,r.file+':'+r.line,r.auth,r.owner,r.calls.join(', ')||'inline',...['ui','worker','test','scripts','workflow'].map(k=>r.callers[k].join(', ')||'—'),r.db_writes,r.side_effects,r.classification].map(cell).join(' | ')} |`).join('\n');
writeFileSync(resolve(root,'docs/cleanup/CL09_ROUTE_INVENTORY.md'),`# CL09 Route Inventory\n\nGenerated from tracked current source; static references are conservative and include ordered dynamic URL fragments. No server import, DB connection or provider call. CL01 is unchanged. Dynamic webhook registrations are expanded explicitly. Zero static callers are REVIEW_REQUIRED, never deletion proof. Worker column includes all internal source callers, not solely queue handlers. DB writes/side effects state conservative route-level bounds; transitive mutation is not falsely reported as verified read-only. Exact service symbols are supplied for review.\n\nRoutes: ${rows.length}.\n\n| Route | Source | Auth | Business owner | Service calls | UI callers | Worker/internal callers | Test callers | Script callers | n8n callers | DB writes | Side effects | Classification |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${table}\n`);
console.log(JSON.stringify({routes:rows.length,classifications:rows.reduce((a,r)=>(a[r.classification]=(a[r.classification]||0)+1,a),{})}));
