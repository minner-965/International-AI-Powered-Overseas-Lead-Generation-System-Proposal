import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,extname,posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rel=value=>value.replaceAll('\\','/').replace(`${root.replaceAll('\\','/')}/`,'');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const textFiles=files.filter(file=>!(/\.(?:png|jpe?g|gif|ico|xlsx?|pdf|zip|woff2?|ttf)$/i.test(file)));
const contents=new Map(textFiles.map(file=>[file,readFileSync(resolve(root,file),'utf8')]));
const jsFiles=files.filter(file=>/\.(?:m?js)$/i.test(file));
const runtimeJs=jsFiles.filter(file=>file.startsWith('services/demo-dashboard/src/'));

function resolveImport(from,specifier){
  if(!specifier.startsWith('.'))return null;
  const base=posix.normalize(posix.join(posix.dirname(from),specifier));
  for(const candidate of [base,`${base}.js`,`${base}.mjs`,`${base}/index.js`])if(files.includes(candidate))return candidate;
  return null;
}
const allImports=new Map(jsFiles.map(file=>{
  const found=[];const source=contents.get(file)||'';
  for(const match of source.matchAll(/(?:import\s+(?:[^'"()]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)){
    const target=resolveImport(file,match[1]);if(target)found.push(target);
  }
  return [file,[...new Set(found)]];
}));
const imports=new Map(runtimeJs.map(file=>[file,allImports.get(file)||[]]));
const entrypoints=new Set(['services/demo-dashboard/src/server.js']);
const pkg=JSON.parse(contents.get('services/demo-dashboard/package.json')||'{}');
for(const command of Object.values(pkg.scripts||{}))for(const match of String(command).matchAll(/(?:^|\s)(src\/[^\s]+\.(?:m?js))/g))entrypoints.add(`services/demo-dashboard/${match[1]}`);
const reached=new Set();const stack=[...entrypoints];
while(stack.length){const current=stack.pop();if(reached.has(current)||!files.includes(current))continue;reached.add(current);for(const dep of imports.get(current)||[])stack.push(dep);}
const unreachable=runtimeJs.filter(file=>!reached.has(file));

const routeFiles={
  'services/demo-dashboard/src/server.js':'',
  'services/demo-dashboard/src/phase7/router.js':'',
  'services/demo-dashboard/src/research/router.js':'/api/research',
  'services/demo-dashboard/src/research/researchBatchRouter.js':'/api/research/batches'
};
const routeRows=[];
const routeReferenced=(source,path)=>{
  const parts=path.split(/:[A-Za-z_][\w]*/g).filter(part=>part.length>1);
  const escaped=parts.map(part=>part.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&'));
  return escaped.length>1?new RegExp(escaped.join('[^\\n]{0,180}')).test(source):source.includes(parts[0]||path);
};
for(const [file,prefix] of Object.entries(routeFiles)){
  const lines=(contents.get(file)||'').split(/\r?\n/);
  const declarations=lines.map((line,index)=>({index,match:line.match(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/)})).filter(item=>item.match);
  declarations.forEach((item,position)=>{
    const {index,match}=item;
    const path=`${prefix}${match[2]}`.replace(/\/$/,'')||'/';
    const publicRefs=[...contents].filter(([candidate,source])=>candidate.startsWith('services/demo-dashboard/public/')&&routeReferenced(source,path)).map(([candidate])=>candidate);
    const otherRefs=[...contents].filter(([candidate,source])=>candidate!==file&&!candidate.startsWith('docs/')&&routeReferenced(source,path)).map(([candidate])=>candidate);
    const historical=/\/(?:gmail|controlled-tests|manual-official-routes)(?:\/|$)/.test(path);
    const testOnly=!historical&&!publicRefs.length&&otherRefs.length>0&&otherRefs.every(candidate=>/(?:^|\/)test(?:s)?\//.test(candidate));
    const current=!historical&&(publicRefs.length>0||otherRefs.some(candidate=>candidate.startsWith('workflows/')||candidate.startsWith('services/demo-dashboard/src/'))||/\/(?:health|metrics|automation|opportunity-pool|research|companies|leads|opportunities|markets|contact-queue|data-imports|data-exports)(?:\/|$)/.test(path));
    const classification=historical?'HISTORICAL_COMPAT':testOnly?'TEST_ONLY':current?'CURRENT':'UNUSED_CANDIDATE';
    const block=lines.slice(index,declarations[position+1]?.index??Math.min(lines.length,index+30)).join(' ');
    const handler=block.match(/service\.repository\.([A-Za-z_$][\w$]*)\s*\(/)?.[1]
      ||block.match(/service\.([A-Za-z_$][\w$]*)\s*\(/)?.[1]||'inline/review';
    let auth=/requireInternalToken/.test(block)?'INTERNAL_TOKEN':/\.\.\.automationWrite\b/.test(block)?'AUTOMATION_WRITE':/\.\.\.automationRead\b/.test(block)?'AUTOMATION_READ':/\.\.\.send\b/.test(block)?'OUTREACH_SEND':/\.\.\.outreachApprove\b/.test(block)?'OUTREACH_APPROVE':/\.\.\.managementApprove\b/.test(block)?'MANAGEMENT_APPROVE':/\.\.\.dataWrite\b/.test(block)?'DATA_WRITE':/\.\.\.draftWrite\b/.test(block)?'DRAFT_WRITE':/\.\.\.exportWrite\b/.test(block)?'EXPORT_WRITE':/\.\.\.read\b/.test(block)?'AUTHENTICATED_READ':/managementAuth\.authenticate/.test(block)?'AUTHENTICATED':'PUBLIC_OR_INLINE';
    if(file.endsWith('/research/router.js'))auth='AUTHENTICATED_READ';
    if(file.endsWith('/research/researchBatchRouter.js'))auth=match[1]==='post'&&match[2]==='/'?'MANAGEMENT_OR_DATA_ADMIN':'AUTHENTICATED_READ';
    routeRows.push({method:match[1].toUpperCase(),path,file,line:index+1,classification,publicRefs:publicRefs.length,otherRefs:otherRefs.length,handler,auth,callerEvidence:publicRefs.length?'UI_STATIC_OR_DYNAMIC':otherRefs.length?'INTERNAL_TEST_OR_WORKFLOW':'NONE_PROVEN'});
  });
}

const queueSource=contents.get('services/demo-dashboard/src/jobs/phase5Queue.js')||'';
const queueEntries=[...queueSource.matchAll(/^\s*([A-Z][A-Z0-9_]+):\s*'([^']+)'/gm)].map(match=>({constant:match[1],name:match[2]}));
const queues=queueEntries.map(entry=>entry.name);
const compose=contents.get('compose.yaml')||'';
const queueRows=queueEntries.map(({constant,name})=>{
  let producers=0,handlers=0;
  for(const [file,source] of contents){if(!file.startsWith('services/demo-dashboard/src/'))continue;
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const symbol=`PHASE5_QUEUES.${constant}`;
    producers+=(source.match(new RegExp(`(?:enqueue|send|schedule)\\s*\\([^\\n]{0,180}(?:['"]${escaped}['"]|${symbol.replace('.','\\.')})`,'g'))||[]).length;
    if(/queueHandlers\.js$/.test(file)||file.endsWith('/server.js')){
      handlers+=(source.match(new RegExp(`\\[${symbol.replace('.','\\.')}\\]`,'g'))||[]).length;
      handlers+=(source.match(new RegExp(`['"]${escaped}['"]\\s*:`,'g'))||[]).length;
    }
  }
  const workers=[...compose.matchAll(/PGBOSS_QUEUE_ALLOWLIST:\s*"([^"]+)"/g)].flatMap(match=>match[1].split(',')).includes(name);
  const historical=/gmail|controlled-application/.test(name);
  return{constant,name,producers,handlers,workerAllowlisted:workers,classification:historical?'HISTORICAL_COMPAT':handlers||workers?'CURRENT':'UNUSED_CANDIDATE'};
});

const workflowRows=files.filter(file=>file.startsWith('workflows/')&&file.endsWith('.json')).map(file=>{
  try{const json=JSON.parse(contents.get(file));return{file,name:json.name||'(unnamed)',active:json.active===true,nodes:Array.isArray(json.nodes)?json.nodes.length:0,classification:json.active===true?'CURRENT':'REVIEW'};}
  catch{return{file,name:'PARSE_ERROR',active:null,nodes:0,classification:'REVIEW'};}
});

const dependencyRows=Object.keys(pkg.dependencies||{}).map(name=>{
  const refs=runtimeJs.filter(file=>(contents.get(file)||'').includes(name));
  const assetRefs=files.filter(file=>file.startsWith('services/demo-dashboard/public/')&&(contents.get(file)||'').includes(name));
  return{name,version:pkg.dependencies[name],runtimeRefs:refs.length,assetRefs:assetRefs.length,classification:refs.length||assetRefs.length?'CURRENT':'REVIEW'};
});
const envKeys=[...new Set(files.filter(file=>/(^|\/)\.env[^/]*$/.test(file)&&!file.endsWith('.env')).flatMap(file=>
  (contents.get(file)||'').split(/\r?\n/).map(line=>line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean)))].sort();
const publicFiles=files.filter(file=>file.startsWith('services/demo-dashboard/public/'));
const publicRows=publicFiles.map(file=>{const name=posix.basename(file);const refs=[...contents].filter(([candidate,source])=>candidate!==file&&source.includes(name)).length;return{file,bytes:Buffer.byteLength(contents.get(file)||''),refs,classification:file.endsWith('.html')||refs?'CURRENT':'REVIEW'};});
const topCounts=Object.entries(files.reduce((out,file)=>{const key=file.split('/')[0];out[key]=(out[key]||0)+1;return out;},{})).sort((a,b)=>b[1]-a[1]);
const extCounts=Object.entries(files.reduce((out,file)=>{const key=extname(file).toLowerCase()||'(none)';out[key]=(out[key]||0)+1;return out;},{})).sort((a,b)=>b[1]-a[1]);
const method=(source,line)=>routeRows.find(row=>row.file===source&&row.line===line)?.handler||'inline/review';
const domainFor=path=>/automation/.test(path)?'automation_controls, research_query_executions, first_touch_reservations':/research/.test(path)?'research_jobs, research_batches, research_query_plans, research_candidates':/outreach|contact-queue|contacts/.test(path)?'outreach_*, inbound_messages, suppressions, opportunity_activities':/data-import|reference-data|import-batches/.test(path)?'reference_data_*, data_import_*':/data-export|export/.test(path)?'data_export_jobs + business projections':/opportunit|category/.test(path)?'opportunity_pool_*, business_opportunity_*, category_*':/companies|leads|crm-history|icp/.test(path)?'companies, sources, contacts, ICP/history tables':'runtime/operational projection; REVIEW exact SQL';

const mdTable=(headers,rows)=>`| ${headers.join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n${rows.map(row=>`| ${row.map(value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ')).join(' | ')} |`).join('\n')}`;
mkdirSync(resolve(root,'docs/cleanup'),{recursive:true});
const generated=new Date().toISOString();
const inventory=`# CL01 Repository Inventory\n\nGenerated: ${generated}\n\nRead-only static inventory. It records references; it does not authorize deletion. Generated files, dynamic class names, runtime reflection and external consumers remain a caveat and are marked REVIEW where proof is incomplete. No environment values or secrets are included.\n\n## Scope summary\n\n- Tracked files: ${files.length}\n- Repository JS/MJS modules: ${jsFiles.length}\n- Repository static import edges: ${[...allImports.values()].reduce((sum,list)=>sum+list.length,0)}\n- Runtime source JS modules: ${runtimeJs.length}\n- Static runtime entrypoints: ${entrypoints.size}\n- Statically reachable runtime modules: ${reached.size}\n- Runtime modules outside the static entrypoint graph: ${unreachable.length} (review candidates, not deletion proof)\n- Express routes: ${routeRows.length}\n- Declared queues: ${queueRows.length}\n- Tracked workflow JSON files: ${workflowRows.length}\n- Public UI files: ${publicFiles.length}\n- Package runtime dependencies: ${dependencyRows.length}\n- Named env/config keys inventoried: ${envKeys.length}\n\n## Tracked files by top-level area\n\n${mdTable(['Area','Files'],topCounts)}\n\n## Tracked files by extension\n\n${mdTable(['Extension','Files'],extCounts)}\n\n## Runtime entrypoints\n\n${[...entrypoints].sort().map(file=>`- \`${file}\``).join('\n')}\n\nCompose adds the same dashboard image in four roles: HTTP dashboard (no job processing), category worker, outreach worker and data worker. PostgreSQL, n8n and the one-shot runtime-volume initializer are separate services.\n\n## Import graph\n\nRepository graph: ${[...allImports.values()].reduce((sum,list)=>sum+list.length,0)} internal edges across ${jsFiles.length} JS/MJS modules. Runtime source subgraph: ${[...imports.values()].reduce((sum,list)=>sum+list.length,0)} edges. Dynamic construction and non-JS process calls are not inferred.\n\n### Modules outside the static server/CLI graph — REVIEW\n\n${unreachable.sort().map(file=>`- \`${file}\``).join('\n')||'- None'}\n\n## Package dependency reachability\n\n${mdTable(['Dependency','Version','Runtime imports','Public asset refs','Classification'],dependencyRows.map(row=>[row.name,row.version,row.runtimeRefs,row.assetRefs,row.classification]))}\n\n`+
`## Config key inventory (names only)\n\n${envKeys.map(key=>`- \`${key}\``).join('\n')}\n\n## n8n workflow inventory\n\n${mdTable(['File','Name','Active in JSON','Nodes','Classification'],workflowRows.map(row=>[row.file,row.name,row.active,row.nodes,row.classification]))}\n\n## Public CSS/JS/assets reference inventory\n\n${mdTable(['File','Bytes','Filename refs','Classification'],publicRows.map(row=>[row.file,row.bytes,row.refs,row.classification]))}\n`;
writeFileSync(resolve(root,'docs/cleanup/CL01_REPO_INVENTORY.md'),inventory+'\n## Detailed local evidence\n\n`test-artifacts/cleanup-cl01/runtime-inventory.json` retains the complete baseline file list, import edges, script references and structured route/queue inventory. This generated evidence is ignored by Git. Database metadata is documented separately in `CL01_DATABASE_ORCHESTRATION_INVENTORY.md`. CL01 is inventory only: no removal is authorized by a static candidate classification.\n');

const reachability=`# CL01 Runtime Reachability\n\nGenerated: ${generated}\n\nThis is a read-only reachability map. Classification is evidence for later review, not deletion authority. \`UNUSED_CANDIDATE\` means no caller was proven by this static scan; dynamic URLs, external clients, n8n instance state and operator tooling may still exist. Such rows require runtime logs and isolated regression before removal.\n\n## Runtime topology\n\n\`Browser V3 UI → Express server.js/routers → services/repositories → PostgreSQL\`\n\n\`Express/internal/n8n producers → pg-boss → category|outreach|data worker → handlers → services/repositories → PostgreSQL/provider\`\n\nCurrent automation path: \`ResearchBatch → ResearchJob → execute-research-job → frozen SearchPlan executor → provider usage + candidate provenance → OpportunityPool → contact facts → first-touch reservation → send-auto-first-touch → SMTP → IMAP correlation → reply classifier → Activity/Sales Task/CRM outbox\`.\n\n## Route classification\n\n${mdTable(['Method','Route','Source','Handler/service','DB/domain projection','UI refs','Other refs','Class'],routeRows.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method)).map(row=>[row.method,`\`${row.path}\``,`${row.file}:${row.line}`,method(row.file,row.line),domainFor(row.path),row.publicRefs,row.otherRefs,row.classification]))}\n\n## Route review summary\n\n${mdTable(['Class','Count'],Object.entries(routeRows.reduce((out,row)=>(out[row.classification]=(out[row.classification]||0)+1,out),{})))}\n\nKnown compatibility groups are Gmail, controlled-test and retired manual-official-route endpoints. They remain wired today and are classified HISTORICAL_COMPAT, not removable. Routes with no proven static caller are UNUSED_CANDIDATE and must be treated as REVIEW until access logs, n8n live workflow state and operator consumers are checked.\n\n## Queue producer/consumer map\n\n${mdTable(['Queue','Static producer hits','Handler refs','Compose allowlisted','Class'],queueRows.map(row=>[row.name,row.producers,row.handlers,row.workerAllowlisted,row.classification]))}\n\nQueue producer counting is conservative because many producers use \`PHASE5_QUEUES.*\` constants rather than string literals. A zero is REVIEW, not proof of an orphan. Compose allowlisting plus a registered handler is stronger current-runtime evidence.\n\n## Route → service → DB ownership\n\n- Automation: server automation routes → \`Phase13AutomationFacade\` / \`AutomationControlService\` → automation controls/events, research execution and first-touch reservation projections.\n- Research: research and batch routers plus direct endpoints → \`ResearchWorkbenchService\`, \`ResearchBatchService\`, \`ResearchDirectDispatchService\`, \`SearchPlanService\` → jobs, batches, frozen plans, candidates, provenance and provider usage.\n- Opportunity: server opportunity routes → \`OpportunityPoolService\`, category services and scoring/matching services → immutable opportunity decisions and current views.\n- Contact/outreach: Phase7 router → \`Phase7Service\` / \`Phase7Repository\` and first-touch service → recipients, drafts/approvals compatibility history, outbound/inbound, suppressions, activities, tasks and CRM outbox.\n- Data exchange: Phase7 routes/workers → import/export services and repository → import manifests/rows/effects and export jobs/files.\n- Operational: health, metrics and orchestrator routes → queue health, runtime state and read-only aggregate projections.\n\n## Worker roles\n\n- \`demo-dashboard\`: HTTP/API/UI producer; \`PGBOSS_PROCESS_JOBS=false\`.\n- \`category-worker\`: research execution, evidence/category/opportunity and contact discovery stages.\n- \`outreach-worker\`: verification, first-touch, SMTP/IMAP, reply, suppression and CRM handlers; Gmail/controlled handlers remain compatibility-wired.\n- \`data-worker\`: shared import discovery/parse/commit, exports and post-import recalculation.\n- \`n8n\`: persisted orchestration workflows; repository JSON inventory above does not prove live-instance activation.\n\n## Safety conclusion\n\nCL01 made no business-code change and removed nothing. The graph proves a large compatibility surface remains reachable from registered routes and queue allowlists. Static non-reachability alone is insufficient for deletion; runtime logs, live n8n state, database FK/history checks and isolated regression are mandatory in later CL packages.\n`;
const routeAuth=`The DB/domain column is a derived preliminary ownership map. Exact per-handler SQL/FK read-write proof remains REVIEW until the DB inventory is joined. Dynamic browser URL construction is counted by ordered static route fragments.\n\n## Route authentication and caller evidence\n\n${mdTable(['Method','Route','Auth','Handler','Caller evidence'],routeRows.map(row=>[row.method,`\`${row.path}\``,row.auth,row.handler,row.callerEvidence]))}\n\n`;
writeFileSync(resolve(root,'docs/cleanup/CL01_RUNTIME_REACHABILITY.md'),reachability.replace('## Route review summary',`${routeAuth}## Route review summary`));
console.log(JSON.stringify({generated,tracked_files:files.length,runtime_js:runtimeJs.length,routes:routeRows.length,queues:queueRows.length,workflows:workflowRows.length,unreachable_review:unreachable.length},null,2));
const scriptRows=files.filter(file=>/(^|\/)scripts\//.test(file)).map(file=>({file,
 reference_files:[...contents].filter(([other,source])=>other!==file&&source.includes(posix.basename(file))).map(([other])=>other),
 classification:/migration/i.test(file)?'MIGRATION':/test|check|audit|verify|acceptance|browser/i.test(file)?'CURRENT_TEST_OR_REVIEW':'OPERATIONAL_OR_HISTORICAL_REVIEW'}));
const evidenceDir=resolve(root,'test-artifacts/cleanup-cl01');mkdirSync(evidenceDir,{recursive:true});
writeFileSync(resolve(evidenceDir,'runtime-inventory.json'),JSON.stringify({generated,tracked_files:files,
 imports:[...allImports].map(([from,to])=>({from,to})),entrypoints:[...entrypoints],runtime_reached:[...reached],unreachable,
 routes:routeRows,queues:queueRows,workflows:workflowRows,dependencies:dependencyRows,config_key_names:envKeys,scripts:scriptRows,assets:publicRows},null,2)+'\n');
