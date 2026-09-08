import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,process.argv[2]||'test-artifacts/cleanup-cl01/ui-inventory.json');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const textFiles=new Map();
for(const path of tracked){
  try{
    const buffer=readFileSync(join(root,path));
    if(buffer.includes(0))continue;
    textFiles.set(path.replaceAll('\\','/'),buffer.toString('utf8'));
  }catch{}
}

const publicPrefix='services/demo-dashboard/public/';
const publicFiles=[...textFiles.keys()].filter(path=>path.startsWith(publicPrefix));
const index=textFiles.get(`${publicPrefix}index.html`)||'';
const directAssets=[...index.matchAll(/<(?:script|link)[^>]+?(?:src|href)="([^"?#]+)[^>]*>/g)].map(match=>match[1]);
const moduleImports=[];
for(const [path,source] of textFiles){
  if(!path.endsWith('.js')&&!path.endsWith('.mjs'))continue;
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))moduleImports.push({from:path,specifier:match[1]});
}

const referenceCount=path=>{
  const publicPath=`/${path.slice(publicPrefix.length)}`;
  const relativePath=path.slice(publicPrefix.length);
  const base=relativePath.split('/').at(-1);
  let count=0;
  for(const source of textFiles.values()){
    if(source.includes(publicPath)||source.includes(relativePath)||source.includes(`./${base}`)||source.includes(`../${base}`))count++;
  }
  return count;
};
const assets=publicFiles.filter(path=>/\.(?:css|js|html|svg|png|jpe?g|webp|gif|woff2?|ttf)$/i.test(path)).map(path=>{
  const publicPath=`/${path.slice(publicPrefix.length)}`;
  const direct=directAssets.includes(publicPath);
  const refs=referenceCount(path);
  return {path,kind:path.split('.').at(-1).toLowerCase(),direct_entrypoint:direct,reference_files:refs,classification:direct?'CURRENT':refs?'CURRENT':'REVIEW'};
});

const apiCallsByFile={};
for(const [path,source] of textFiles){
  if(!path.startsWith(publicPrefix)||!path.endsWith('.js'))continue;
  const calls=new Set();
  for(const match of source.matchAll(/['"`](\/api\/[A-Za-z0-9_?&=./:${}-]+)/g))calls.add(match[1]);
  if(calls.size)apiCallsByFile[path]=[...calls].sort();
}
const viewSources={
  overview:['public/app.js','public/ui/v3/overview.js','public/ui/outreach-workbench.js','public/ui/v3/automation-control.js'],
  opportunities:['public/app.js','public/ui/opportunity-workspace.js','public/ui/v3/opportunity-dimensions.js'],
  research:['public/ui/phase9-research-workbench.js','public/ui/v3/research-batch.js','public/ui/v3/automation-control.js'],
  jobs:['public/ui/phase9-research-workbench.js','public/ui/v3/research-jobs.js','public/ui/v3/research-batch.js','public/ui/v3/automation-control.js'],
  companies:['public/app.js','public/ui/v3/companies.js'],
  'company-detail':['public/app.js','public/phase7-ui.js','public/ui/v3/companies.js'],
  'contact-ready':['public/ui/v3/companies.js','public/ui/contact-queue.js'],
  'contact-queue':['public/ui/outreach-workbench.js','public/ui/contact-queue.js','public/ui/v3/automation-control.js'],
  replies:['public/ui/v3/replies.js'],
  evidence:['public/ui/v3/records.js'],
  'customer-match':['public/app.js','public/ui/v3/records.js'],
  'data-import':['public/app.js','public/phase7-ui.js','public/ui/v3/records.js'],
  'data-export':['public/app.js','public/phase7-ui.js','public/ui/v3/records.js'],
  settings:['public/ui/phase9-research-workbench.js','public/ui/controlled-email-verification.js','public/ui/v3/records.js','public/ui/v3/automation-control.js']
};
const qualify=path=>`${publicPrefix}${path.replace(/^public\//,'')}`;
const views=Object.entries(viewSources).map(([view,sources])=>({view,sources:sources.map(qualify),apis:[...new Set(sources.flatMap(source=>apiCallsByFile[qualify(source)]||[]))].sort()}));

const terms=[
  ['AI',/\bAI\b/giu],['intelligent',/\bintelligent\b/giu],['smart',/\bsmart\b/giu],['robot',/\brobot\b/giu],['wand',/\bwand\b/giu],['sparkle',/\bsparkle\b/giu],
  ['智能',/智能/gu],['AI建议',/AI建议/giu],['AI理解',/AI理解/giu],['AI判断',/AI判断/giu],['procurement',/\bprocurement\b/giu],['buying evidence',/buying[ _-]+evidence/giu],
  ['supplier portal',/supplier[ _-]+portal/giu],['vendor registration',/vendor[ _-]+registration/giu],['Start review',/start[ _-]+review/giu],
  ['PRODUCT_SCOPE_REQUIRED',/PRODUCT_SCOPE_REQUIRED/gu],['Gmail',/\bGmail\b/giu],['Resend',/\bResend\b/giu],['manual-only',/manual[ _-]+only/giu],
  ['PROSPECT_PILOT',/PROSPECT_PILOT/gu],['phase13_search',/phase13_search/giu]
];
const activeCopyTerms=new Set(['AI','intelligent','smart','robot','wand','sparkle','智能','AI建议','AI理解','AI判断','procurement','buying evidence','supplier portal','vendor registration','Start review','PRODUCT_SCOPE_REQUIRED']);
function classifyHit(path,term){
  if(path==='AGENTS.md'||path.startsWith('.agents/vendor/')||path.includes('/SKILL.md')||path.startsWith('config/ui/forbidden-'))return 'CURRENT_VALID';
  if(path.startsWith('database/migrations/')||path.startsWith('docs/history/')||path.startsWith('docs/ui/reference/')||/(?:PHASE\d|PLAN|RESULT|ACCEPTANCE|PROPOSAL)/i.test(path))return 'HISTORICAL_ONLY';
  if(path.startsWith(publicPrefix)&&activeCopyTerms.has(term))return 'REMOVE_ACTIVE';
  if(/^(?:docs\/CURRENT_PROJECT_STATUS|docs\/CURRENT_RUNTIME_CONTRACT|docs\/OPERATIONS|docs\/RUNBOOK)/i.test(path))return 'REMOVE_ACTIVE';
  return 'REVIEW';
}
const hits=[];
for(const [path,source] of textFiles){
  const lines=source.split(/\r?\n/);
  for(let index=0;index<lines.length;index++)for(const [term,pattern] of terms){
    pattern.lastIndex=0;
    const matches=[...lines[index].matchAll(pattern)];
    if(matches.length)hits.push({path,line:index+1,term,count:matches.length,classification:classifyHit(path,term)});
  }
}
const summary={};
for(const hit of hits){
  summary[hit.classification]=(summary[hit.classification]||0)+hit.count;
}
const result={
  schema:'dpv.cleanup.cl01.ui-inventory.v1',generated_at:new Date().toISOString(),scope:'git tracked text files only',
  privacy:'relative paths, line numbers, keywords and code references only; no business-row values or credentials',
  totals:{tracked_files:tracked.length,text_files:textFiles.size,public_files:publicFiles.length,assets:assets.length,text_hit_lines:hits.length,text_hit_occurrences:Object.values(summary).reduce((a,b)=>a+b,0)},
  entrypoints:{html:`${publicPrefix}index.html`,direct_assets:directAssets,module_imports:moduleImports},views,assets,text_scan:{classification_counts:summary,hits}
};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({output:relative(root,output).replaceAll('\\','/'),...result.totals,classifications:summary},null,2));
