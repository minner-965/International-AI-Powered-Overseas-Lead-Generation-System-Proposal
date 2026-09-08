import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const outputPath=join(root,'docs/cleanup/CL01_DATABASE_ORCHESTRATION_INVENTORY.json');
const docker=['compose','exec','-T','postgres','psql','-U','leadgen_app','-d','lead_generation','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c'];
const run=(file,args,options={})=>execFileSync(file,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,...options}).trim();
const sqlJson=sql=>{const text=run('docker',[...docker,sql]);return text?JSON.parse(text):null;};
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';

const relations=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'name',c.relname,'kind',CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED_TABLE'
    WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED_VIEW' END,
  'persistence',c.relpersistence,'estimated_rows',c.reltuples::bigint,
  'total_bytes',CASE WHEN c.relkind IN('r','p','m') THEN pg_total_relation_size(c.oid) ELSE NULL END,
  'comment',obj_description(c.oid,'pg_class')) ORDER BY c.relkind,c.relname),'[]'::jsonb)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='leadgen' AND c.relkind IN('r','p','v','m')`);

for(const relation of relations){
  relation.row_count=Number(run('docker',[...docker,`SELECT count(*) FROM ${quote('leadgen')}.${quote(relation.name)}`])||0);
}

const columns=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,
  'type',data_type,'nullable',is_nullable='YES','defaulted',column_default IS NOT NULL)
  ORDER BY table_name,ordinal_position),'[]'::jsonb)
FROM information_schema.columns WHERE table_schema='leadgen'`);
const foreignKeys=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',con.conname,'source_table',src.relname,
  'target_table',dst.relname,'definition',pg_get_constraintdef(con.oid,false)) ORDER BY src.relname,con.conname),'[]'::jsonb)
FROM pg_constraint con JOIN pg_class src ON src.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace
JOIN pg_class dst ON dst.oid=con.confrelid WHERE ns.nspname='leadgen' AND con.contype='f'`);
const viewDependencies=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('view',view_name,'depends_on_schema',table_schema,
  'depends_on',table_name) ORDER BY view_name,table_schema,table_name),'[]'::jsonb)
FROM information_schema.view_table_usage WHERE view_schema='leadgen'`);
const functions=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'identity_arguments',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),
  'language',l.lanname,'volatility',p.provolatile,'kind',p.prokind,
  'security_definer',p.prosecdef) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='leadgen'`);
const functionDependencies=sqlJson(`SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('function',p.proname,
  'identity_arguments',pg_get_function_identity_arguments(p.oid),'depends_on',c.relname)),'[]'::jsonb)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_depend d ON d.objid=p.oid
JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace cn ON cn.oid=c.relnamespace
WHERE n.nspname='leadgen' AND cn.nspname='leadgen'`);
const triggers=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,
  'function',p.proname,'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
  ORDER BY c.relname,t.tgname),'[]'::jsonb)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='leadgen' AND NOT t.tgisinternal`);

const posix=file=>file.replaceAll('\\','/');
const sourceFiles=run('rg',['--files','services/demo-dashboard/src','services/demo-dashboard/public','workflows','scripts'])
  .split(/\r?\n/).filter(Boolean).map(posix).filter(file=>/\.(?:js|mjs|sql|json)$/i.test(file));
const sourceText=new Map(sourceFiles.map(file=>[file,readFileSync(join(root,file),'utf8')]));
const migrationFiles=run('rg',['--files','database/migrations']).split(/\r?\n/).filter(Boolean).map(posix).sort();
const migrationText=new Map(migrationFiles.map(file=>[file,readFileSync(join(root,file),'utf8')]));
const activeSourceFiles=new Set();
const importPattern=/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
const visit=file=>{
  file=posix(file);if(activeSourceFiles.has(file)||!sourceText.has(file))return;activeSourceFiles.add(file);
  const text=sourceText.get(file);for(const match of text.matchAll(importPattern)){
    if(!match[1].startsWith('.'))continue;
    const target=posix(join(file.slice(0,file.lastIndexOf('/')),match[1]));
    visit(target.endsWith('.js')?target:`${target}.js`);
  }
};
visit('services/demo-dashboard/src/server.js');
for(const file of sourceFiles.filter(file=>file.startsWith('workflows/')))activeSourceFiles.add(file);
const esc=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function references(name){
  const word=new RegExp(`\\b${esc(name)}\\b`,'i');
  const write=new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE\\s+INTO)\\s+(?:leadgen\\.)?${esc(name)}\\b`,'i');
  const reads=[],writes=[],operational=[];
  for(const [file,text] of sourceText){if(word.test(text)){
    if(activeSourceFiles.has(file)){reads.push(file);if(write.test(text))writes.push(file);}
    else operational.push(file);
  }}
  return{current_read_files:reads,current_write_files:writes,operational_reference_files:operational};
}
function migrationOrigins(name){
  const word=new RegExp(`\\b${esc(name)}\\b`,'i');
  return [...migrationText].filter(([,text])=>word.test(text)).map(([file])=>file);
}
const historical=/(_events?|_attempts?|_snapshots?|_history|_audit|_ledger|schema_migrations|purge_|checkpoints?)/i;
for(const relation of relations){
  const refs=references(relation.name);Object.assign(relation,refs);
  relation.columns=columns.filter(column=>column.table===relation.name).map(({table,...column})=>column);
  relation.foreign_keys_out=foreignKeys.filter(key=>key.source_table===relation.name);
  relation.foreign_keys_in=foreignKeys.filter(key=>key.target_table===relation.name);
  relation.depends_on=viewDependencies.filter(dep=>dep.view===relation.name).map(dep=>`${dep.depends_on_schema}.${dep.depends_on}`);
  relation.depended_on_by_views=viewDependencies.filter(dep=>dep.depends_on_schema==='leadgen'&&dep.depends_on===relation.name)
    .map(dep=>`leadgen.${dep.view}`);
  relation.migration_sources=migrationOrigins(relation.name);
  relation.sensitive_column_names=relation.columns.filter(column=>/(email|recipient|password|secret|token|credential|body|subject|payload|content)/i.test(column.name)).map(column=>column.name);
  relation.classification=refs.current_write_files.length?'CURRENT_WRITE':refs.current_read_files.length?'CURRENT_READ':
    historical.test(relation.name)&&relation.row_count>0?'HISTORICAL_AUDIT':relation.row_count===0?'UNUSED_EMPTY':'UNUSED_WITH_HISTORY';
  relation.classification_basis=refs.current_write_files.length?'direct current source DML reference':refs.current_read_files.length?'direct current source reference':
    historical.test(relation.name)&&relation.row_count>0?'history/audit naming plus retained rows':relation.row_count===0?'zero rows and no direct current source reference':'retained rows and no direct current source reference';
  relation.deletion_proof=false;
}
for(const fn of functions){
  const refs=references(fn.name);Object.assign(fn,refs);
  fn.depends_on=functionDependencies.filter(dep=>dep.function===fn.name&&dep.identity_arguments===fn.identity_arguments).map(dep=>`leadgen.${dep.depends_on}`);
  fn.triggered_by=triggers.filter(trigger=>trigger.function===fn.name).map(trigger=>`${trigger.table}.${trigger.name}`);
  fn.migration_sources=migrationOrigins(fn.name);
  fn.classification=refs.current_write_files.length?'CURRENT_WRITE':refs.current_read_files.length?'CURRENT_READ':fn.triggered_by.length?'CURRENT_WRITE':'UNUSED_EMPTY';
  fn.classification_basis=refs.current_write_files.length?'direct current source invocation/write reference':refs.current_read_files.length?'direct current source reference':fn.triggered_by.length?'installed trigger dependency':'no direct current source or trigger dependency';
  fn.deletion_proof=false;
}
for(const trigger of triggers){
  const table=relations.find(item=>item.name===trigger.table);
  trigger.migration_sources=migrationOrigins(trigger.name);
  trigger.classification=table?.classification==='CURRENT_WRITE'?'CURRENT_WRITE':table?.row_count>0?'HISTORICAL_AUDIT':'UNUSED_EMPTY';
  trigger.classification_basis=`installed trigger on ${trigger.table}; inherited conservative table activity`;
  trigger.deletion_proof=false;
}

const bossJobs=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('queue',name,'state',state,'count',count)
  ORDER BY name,state),'[]'::jsonb) FROM (SELECT name,state,count(*)::int count FROM pgboss.job GROUP BY name,state) x`);
const bossQueues=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'policy',policy,'dead_letter',dead_letter,
  'retry_limit',retry_limit,'retry_delay',retry_delay,'retry_backoff',retry_backoff,'expire_seconds',expire_seconds,
  'retention_seconds',retention_seconds,'deletion_seconds',deletion_seconds,'heartbeat_seconds',heartbeat_seconds,
  'total_count',total_count,'queued_count',queued_count,'active_count',active_count,'failed_count',failed_count,
  'deferred_count',deferred_count,'warning_queued',warning_queued) ORDER BY name),'[]'::jsonb) FROM pgboss.queue`);
const bossSchedules=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'cron',cron,'timezone',timezone)
  ORDER BY name),'[]'::jsonb) FROM pgboss.schedule`);
const n8nInstanceWorkflows=sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',w.id,'name',w.name,'active',w.active,'is_archived',w."isArchived",'trigger_count',w."triggerCount",
  'created_at',w."createdAt",'updated_at',w."updatedAt",'version_id',w."versionId",'active_version_id',w."activeVersionId",
  'node_count',json_array_length(coalesce(w.nodes,'[]'::json)),
  'node_types',coalesce((SELECT jsonb_agg(DISTINCT node->>'type') FROM json_array_elements(coalesce(w.nodes,'[]'::json)) node),'[]'::jsonb),
  'trigger_nodes',coalesce((SELECT jsonb_agg(jsonb_build_object('name',node->>'name','type',node->>'type'))
    FROM json_array_elements(coalesce(w.nodes,'[]'::json)) node
    WHERE node->>'type' ~* '(trigger|webhook|schedule|cron)'),'[]'::jsonb)
  ) ORDER BY w.name,w.id),'[]'::jsonb) FROM public.workflow_entity w`);

const workflows=[];
for(const file of sourceFiles.filter(file=>file.startsWith('workflows/')&&file.endsWith('.json'))){
  const parsed=JSON.parse(readFileSync(join(root,file),'utf8'));
  const nodes=Array.isArray(parsed.nodes)?parsed.nodes:[];
  workflows.push({file,name:parsed.name||null,active:parsed.active===true,node_count:nodes.length,
    node_types:[...new Set(nodes.map(node=>node.type).filter(Boolean))].sort(),
    trigger_nodes:nodes.filter(node=>/(trigger|webhook|schedule|cron)/i.test(node.type||'')).map(node=>({name:node.name,type:node.type})),
    queue_references:[...new Set((JSON.stringify(parsed).match(/[a-z][a-z0-9-]{2,80}/g)||[])
      .filter(value=>bossJobs.some(job=>job.queue===value)))].sort()});
}

const runtimeServices=run('docker',['compose','ps','--all','--format','json']).split(/\r?\n/).filter(Boolean).map(line=>{
  const row=JSON.parse(line);return{service:row.Service,state:row.State,health:row.Health||null};
});

const classificationCounts={};
for(const item of [...relations,...functions,...triggers])classificationCounts[item.classification]=(classificationCounts[item.classification]||0)+1;
const inventory={
  generated_at:new Date().toISOString(),database:'lead_generation',schema:'leadgen',content_policy:'metadata/counts only; no business rows or secret values',
  classification_notice:'Static source and database-dependency evidence is incomplete. UNUSED_* is a review candidate, never deletion proof.',
  summary:{relations:relations.length,tables:relations.filter(r=>r.kind.includes('TABLE')).length,views:relations.filter(r=>r.kind.includes('VIEW')).length,
    functions:functions.length,triggers:triggers.length,foreign_keys:foreignKeys.length,classifications:classificationCounts,
    workflow_files:workflows.length,n8n_instance_workflows:n8nInstanceWorkflows.length,
    pgboss_queue_names:new Set(bossJobs.map(row=>row.queue)).size},
  relations,functions,triggers,foreign_keys:foreignKeys,view_dependencies:viewDependencies,function_dependencies:functionDependencies,
  dependency_notice:'PL/pgSQL bodies and dynamic SQL are not exhaustively represented by pg_depend; trigger bindings, static source references, foreign keys and view dependencies are separate evidence layers.',
  orchestration:{runtime_services:runtimeServices,n8n_instance_workflows:n8nInstanceWorkflows,
    repository_n8n_workflows:workflows,pgboss:{queues:bossQueues,schedules:bossSchedules,state_counts:bossJobs}}
};
mkdirSync(join(root,'docs/cleanup'),{recursive:true});
writeFileSync(outputPath,JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({output:relative(root,outputPath),summary:inventory.summary}));
