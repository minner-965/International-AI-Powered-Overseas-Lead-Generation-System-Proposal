import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline='07af1424ad92ab9ba490b9bcafa5d025d0e16e19';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
const oldEntries=git('ls-tree','-r','-l',baseline).trim().split('\n').map(line=>{const [meta,file]=line.split('\t');return {file,bytes:Number(meta.trim().split(/\s+/).at(-1))};});
const tracked=git('ls-files','-z').split('\0').filter(Boolean);
const extra=git('ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean);
const currentFiles=[...new Set([...tracked,...extra])].filter(f=>fs.existsSync(path.join(root,f))&&fs.statSync(path.join(root,f)).isFile());
const currentEntries=currentFiles.map(file=>({file,bytes:fs.statSync(path.join(root,file)).size}));
const read=(file,old)=>old?git('show',`${baseline}:${file}`):fs.readFileSync(path.join(root,file),'utf8');
function measure(entries,old){
 const files=entries.map(x=>x.file),prefix='services/demo-dashboard/';
 const runtime=files.filter(f=>f.startsWith(`${prefix}src/`)&&f.endsWith('.js'));
 const envFiles=files.filter(f=>/^\.env.*\.example$/.test(f));
 const envKeys=new Set(envFiles.flatMap(f=>[...read(f,old).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m=>m[1])));
 const routes=runtime.reduce((n,f)=>n+[...read(f,old).matchAll(/\b(?:app|router)\.(?:get|post|put|patch|delete|options|head)\s*\(/g)].length,0);
 const compose=read('compose.yaml',old);const serviceBlock=compose.split(/^services:\s*$/m)[1]?.split(/^[^\s#][^\n]*:/m)[0]||'';
 const pkg=JSON.parse(read(`${prefix}package.json`,old));
 return {files:files.length,runtime_js_files:runtime.length,authored_public_css_bytes:entries.filter(e=>e.file.startsWith(`${prefix}public/`)&&e.file.endsWith('.css')).reduce((n,e)=>n+e.bytes,0),authored_runtime_and_public_js_bytes:entries.filter(e=>e.file.startsWith(prefix)&&/\/(src|public)\//.test(e.file)&&e.file.endsWith('.js')).reduce((n,e)=>n+e.bytes,0),static_express_route_declarations:routes,compose_services:[...serviceBlock.matchAll(/^  [a-zA-Z][\w-]*:\s*$/gm)].length,queue_handlers:null,tracked_n8n_workflow_json:files.filter(f=>/^workflows\/.*\.json$/.test(f)).length,direct_dependencies:Object.keys(pkg.dependencies||{}).length,example_env_keys:envKeys.size,current_docs:files.filter(f=>f.startsWith('docs/')&&!f.startsWith('docs/history/')&&f.endsWith('.md')).length,historical_docs:files.filter(f=>f.startsWith('docs/history/')&&f.endsWith('.md')).length,ai_visible_strings:null,legacy_business_strings:null,obsolete_current_state_keys:null,full_tests:null,browser_errors:null};
}
console.log(JSON.stringify({generated_at:new Date().toISOString(),baseline,method:'Git source baseline versus current existing tracked plus nonignored additions; bytes are raw worktree bytes (CRLF may differ). Static route declarations are not runtime reachability proof. null means not measured by this script; consult acceptance evidence.',current_index_entries:tracked.length,current_nonignored_additions:extra.length,before:measure(oldEntries,true),after:measure(currentEntries,false)},null,2));
