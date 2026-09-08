import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {root} from './current-state.mjs';
import path from 'node:path';
const after=process.argv.includes('--after');
execFileSync(process.execPath,['scripts/cleanup-maintenance-guard.mjs'],{cwd:root,stdio:'pipe'});
// Aggregate metadata only: never export job payloads, credentials or email bodies.
const sql=`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'jobs',(SELECT coalesce(json_agg(x ORDER BY name,state),'[]') FROM (SELECT name,state,count(*) n FROM pgboss.job GROUP BY name,state) x),
 'schedules',(SELECT coalesce(json_agg(x ORDER BY name),'[]') FROM (SELECT name,cron,timezone FROM pgboss.schedule) x),
 'queues',(SELECT coalesce(json_agg(x ORDER BY name),'[]') FROM (SELECT name,policy,dead_letter FROM pgboss.queue) x),
 'workflows',(SELECT coalesce(json_agg(x ORDER BY id),'[]') FROM (SELECT id,name,active,"isArchived","versionId","activeVersionId",md5(nodes::text) nodes_hash,md5(connections::text) connections_hash FROM public.workflow_entity) x),
 'execution_history_count',(SELECT count(*) FROM public.execution_entity)
); COMMIT;`;
const raw=execFileSync('docker',['compose','exec','-T','postgres','psql','-X','-q','-U','leadgen_app','-d','lead_generation','-At','-v','ON_ERROR_STOP=1','-c',sql],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const state=JSON.parse(raw);
const file=path.join(root,'artifacts/backups/cleanup-cl00-20260908',`cl08-orchestration-${after?'after':'before'}.json`);
if(after){const before=JSON.parse(readFileSync(file.replace('-after.json','-before.json'),'utf8'));if(JSON.stringify(before)!==JSON.stringify(state))throw Error('Orchestration state changed during maintenance');}
writeFileSync(file,JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify({phase:after?'after':'before',unchanged:after?true:null,queues:state.queues.length,job_groups:state.jobs.length,workflows:state.workflows.length,execution_history_count:state.execution_history_count,sha256:createHash('sha256').update(JSON.stringify(state)).digest('hex')}));
