import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
run('node',['scripts/cleanup-maintenance-guard.mjs']);
const query=sql=>JSON.parse(run('docker',['compose','exec','-T','postgres','psql','-X','-q','-U','leadgen_app','-d','lead_generation','-At','-v','ON_ERROR_STOP=1','-c',`BEGIN READ ONLY; SELECT coalesce(json_agg(q),'[]') FROM (${sql}) q; COMMIT;`]));
const relations=query(`SELECT c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='leadgen' AND c.relkind IN('r','p','v','m') ORDER BY c.relname`);
const counts=query(relations.map(r=>`SELECT '${r.name}' name,count(*)::int row_count FROM leadgen."${r.name}"`).join(' UNION ALL '));
const columns=query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='leadgen' ORDER BY table_name,ordinal_position`);
const fks=query(`SELECT k.conname name,s.relname source_table,t.relname target_table,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class s ON s.oid=k.conrelid JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_class t ON t.oid=k.confrelid WHERE n.nspname='leadgen' AND k.contype='f'`);
const views=query(`SELECT view_name,table_name,table_schema FROM information_schema.view_table_usage WHERE view_schema='leadgen'`);
const functions=query(`SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='leadgen' ORDER BY p.proname`);
const triggers=query(`SELECT t.tgname name,c.relname table_name,p.proname function_name,t.tgenabled enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='leadgen' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
const files=[...new Set(run('git',['ls-files','--cached','--others','--exclude-standard','-z']).split('\0'))].filter(f=>existsSync(resolve(root,f))&&/\.(?:js|mjs|cjs|sql|json|md)$/.test(f));
const texts=new Map(files.map(f=>[f,readFileSync(resolve(root,f),'utf8')]));
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function refs(name){
 const pattern=new RegExp(`\\b${esc(name)}\\b`,'i');
 const found=[...texts].filter(([f,s])=>!f.startsWith('docs/cleanup/')&&!f.includes('cleanup-cl13')&&pattern.test(s)).map(([f])=>f);
 return {source:found.filter(f=>f.startsWith('services/demo-dashboard/src/')),scripts:found.filter(f=>f.startsWith('scripts/')),tests:found.filter(f=>f.includes('/test/')),reports:found.filter(f=>f.startsWith('docs/')),migrations:found.filter(f=>f.startsWith('database/migrations/'))};
}
const auditNames=/events?|history|audit|usage|ledger|snapshot|outbound|inbound|suppression|bounce|activity|activities|sales_task|source|evidence|decision|attempt|checkpoint|reservation|outbox|purge|migration/i;
for(const relation of relations){
 relation.row_count=counts.find(r=>r.name===relation.name).row_count;
 relation.references=refs(relation.name);
 const write=new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE\\s+INTO)\\s+(?:leadgen\\.)?${esc(relation.name)}\\b`,'i');
 relation.write_sources=relation.references.source.filter(f=>write.test(texts.get(f)));
 relation.foreign_keys=fks.filter(f=>f.source_table===relation.name||f.target_table===relation.name);
 relation.view_dependencies=views.filter(v=>v.table_schema==='leadgen'&&v.table_name===relation.name);
 relation.function_body_references=functions.filter(f=>new RegExp(`\\b${esc(relation.name)}\\b`,'i').test(f.body)).map(f=>f.name);
 relation.triggers=triggers.filter(t=>t.table_name===relation.name).map(t=>t.name);
 relation.audit_requirement=auditNames.test(relation.name)||relation.row_count>0;
 relation.classification=relation.write_sources.length?'CURRENT_WRITE':relation.references.source.length||relation.view_dependencies.length||relation.function_body_references.length?'CURRENT_READ':relation.audit_requirement?'HISTORICAL_AUDIT':relation.row_count===0?'UNUSED_EMPTY':'UNUSED_WITH_HISTORY';
 relation.retention=relation.classification==='UNUSED_EMPTY'?'REVIEW_REQUIRED':'KEEP_CURRENT_OR_IMMUTABLE_HISTORY';
 relation.drop_eligible=false;
 relation.columns=columns.filter(c=>c.table_name===relation.name).map(c=>({name:c.column_name,type:c.data_type,source_reference_files:refs(c.column_name).source.length,audit_requirement:relation.audit_requirement,drop_eligible:false}));
}
for(const fn of functions){
 fn.references=refs(fn.name);
 fn.trigger_bindings=triggers.filter(t=>t.function_name===fn.name).map(t=>`${t.table_name}.${t.name}`);
 fn.function_callers=functions.filter(f=>f!==fn&&new RegExp(`\\b${esc(fn.name)}\\s*\\(`,'i').test(f.body)).map(f=>f.name);
 fn.classification=fn.trigger_bindings.length?'CURRENT_WRITE':fn.references.source.length||fn.function_callers.length?'CURRENT_READ':'REVIEW_REQUIRED';
 fn.drop_eligible=false;
 delete fn.body;
}
const tables=relations.filter(r=>['r','p'].includes(r.kind));
assert.equal(tables.length,147);
const summary={tables:tables.length,views:relations.length-tables.length,columns:columns.length,functions:functions.length,triggers:triggers.length,foreign_keys:fks.length,table_classifications:Object.fromEntries(['CURRENT_WRITE','CURRENT_READ','HISTORICAL_AUDIT','UNUSED_EMPTY','UNUSED_WITH_HISTORY'].map(c=>[c,tables.filter(t=>t.classification===c).length])),drop_eligible:0,database_writes:0};
const inventory={generated_at:new Date().toISOString(),database:'lead_generation',schema:'leadgen',method:'READ ONLY transactions; metadata and exact aggregate row counts; source references conservative including compatibility modules; no payloads or secrets',limitations:'Static name matching is not proof of runtime reachability or absence. Dynamic SQL, relation-local column references, installed triggers, report/audit consumers block deletion without independent proof. No DROP proposed.',summary,relations,functions,triggers};
writeFileSync(resolve(root,'docs/cleanup/CL13_DATABASE_INVENTORY.json'),JSON.stringify(inventory,null,2)+'\n');
const table=rows=>`| Table | Rows | Classification | Source files | FK edges | Audit/history |\n| --- | ---: | --- | ---: | ---: | --- |\n${rows.map(r=>`| ${r.name} | ${r.row_count} | ${r.classification} | ${r.references.source.length} | ${r.foreign_keys.length} | ${r.audit_requirement} |`).join('\n')}`;
writeFileSync(resolve(root,'docs/cleanup/CL13_DATABASE_TABLES.md'),`# CL13 Database Table Classification\n\nGenerated ${inventory.generated_at}. Every production leadgen table is listed. Counts are actual read-only results; no business records are exported. CURRENT denotes existing code references, including retained administrative compatibility; not proof a maintenance-paused worker is running. Audit/history requirements take precedence over deletion.\n\n${table(tables)}\n\n## Review-only empty candidates\n\n${tables.filter(r=>r.classification==='UNUSED_EMPTY').map(r=>`- ${r.name}: ${r.foreign_keys.length} FK edges; ${r.references.scripts.length} script and ${r.references.reports.length} report references; no drop proof.`).join('\n')||'None.'}\n`);
console.log(JSON.stringify(summary));
