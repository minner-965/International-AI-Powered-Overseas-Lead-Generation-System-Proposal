import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
const prefix='dpv-cl15-runtime';
const network=`${prefix}-net`, pg=`${prefix}-pg`;
const image=process.env.CL15_IMAGE || 'dpv-leadgen-demo-dashboard';
const root=process.cwd().replaceAll('\\','/');
const compose=readFileSync('compose.yaml','utf8');
const queueList=name=>compose.split(`  ${name}-worker:`)[1].split(/\n  [a-z]/)[0].match(/PGBOSS_QUEUE_ALLOWLIST: "([^"]+)"/)[1];
const created=[];
const run=(args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const pause=()=>new Promise(r=>setTimeout(r,1000));
const report={image,network_internal:true,fixture_credentials:true,production_writes:0,services:[],external_calls:0};
const base=['--network',network,'-e',`POSTGRES_HOST=${pg}`,'-e','POSTGRES_USER=cl15_fixture','-e','POSTGRES_PASSWORD=cl15_fixture_only','-e','POSTGRES_DB=cl15_runtime','-e','POSTGRES_PORT=5432','-e','SEARCH_PROVIDER=exa','-e','AUTO_EVIDENCE_ENABLED=false','-e','RESEARCH_CREATION_MAINTENANCE=true','-e','OUTREACH_ENABLED=false','-e','OUTREACH_SEND_SCOPE=DISABLED','-e','AUTO_FIRST_TOUCH_ENABLED=false','-e','GMAIL_API_ENABLED=false','-e','GMAIL_INBOUND_SYNC_ENABLED=false','-e','INBOUND_EMAIL_SYNC_ENABLED=false','-e','PGBOSS_ENABLED=true','-v',`${root}/services/demo-dashboard/src:/app/src:ro`,'-v',`${root}/database/migrations:/app/database/migrations:ro`];
async function waitReady(name,worker=false){
 let error;
 for(let i=0;i<75;i++){
  try{
   const probe=worker?run(['exec',name,'node','-e',"const fs=require('fs');let s=JSON.parse(fs.readFileSync('/tmp/dpv-phase5-worker-ready.json'));if(!s.ready||!s.queues.length)process.exit(1);process.kill(s.pid,0);console.log(JSON.stringify({ready:s.ready,queues:s.queues.length}))"]):run(['exec',name,'wget','-qO-','http://127.0.0.1:3000/api/health']);
   return JSON.parse(probe);
  }catch(e){error=e.message;if(run(['inspect','--format','{{.State.Running}}',name])!=='true')break;await pause();}
 }
 throw new Error(`${name} startup failed: ${error}\n${run(['logs','--tail','30',name])}`);
}
try{
 run(['network','create','--internal',network]);
 run(['run','-d','--name',pg,'--network',network,'-e','POSTGRES_USER=cl15_fixture','-e','POSTGRES_PASSWORD=cl15_fixture_only','-e','POSTGRES_DB=cl15_runtime','--tmpfs','/var/lib/postgresql/data:rw','postgres:17-alpine']);created.push(pg);
 for(let i=0;i<45;i++){try{run(['exec',pg,'pg_isready','-U','cl15_fixture','-d','cl15_runtime']);break;}catch{await pause();}}
 const migration="const {Pool}=await import('pg');const fs=await import('node:fs/promises');const {applyPhase7Migration}=await import('./src/phase7/migrationRunner.js');const {applyCategoryProcurementMigration}=await import('./src/categoryProcurement/migrationRunner.js');const pool=new Pool({host:process.env.POSTGRES_HOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});for(const f of (await fs.readdir('./database/migrations')).filter(f=>/^\\d{3}_.*sql$/.test(f)).sort()){const n=+f.slice(0,3),migrationPath='./database/migrations/'+f;if(n<24)await pool.query(await fs.readFile(migrationPath,'utf8'));else await(n===24?applyCategoryProcurementMigration:applyPhase7Migration)({pool,migrationPath,expectedDatabase:process.env.POSTGRES_DB,appliedBy:'cl15-runtime'});}await pool.end();console.log('MIGRATIONS_PASS');";
 report.migration=run(['run','--rm',...base,image,'node','--input-type=module','-e',migration]);
 for(const [suffix,queues] of [['dashboard',null],['category',queueList('category')],['data',queueList('data')],['outreach',queueList('outreach')]]){
  const name=`${prefix}-${suffix}`;
  const args=['run','-d','--name',name,...base,'-e',`HTTP_LISTEN_ENABLED=${!queues}`,'-e',`PGBOSS_PROCESS_JOBS=${!!queues}`];
  if(queues)args.push('-e',`PGBOSS_QUEUE_ALLOWLIST=${queues}`);
  args.push('-e','INTERNAL_API_TOKEN=cl15-internal-fixture');
  run([...args,image]);created.push(name);
  const before=await waitReady(name,!!queues);
  if(!queues){report.http=JSON.parse(run(['exec',name,'node','--input-type=module','-e',"const results=[];for(const p of ['/','/api/health','/api/research/jobs','/api/research/provider-status']){const r=await fetch('http://127.0.0.1:3000'+p);results.push({path:p,status:r.status});if(r.status>=500)throw new Error(p+' '+r.status);}console.log(JSON.stringify(results))"]));}
  if(!queues&&process.env.CL15_SERVER_GET==='true'){
   run(['cp','scripts/cleanup-cl15-server-get-cases.mjs',`${name}:/app/server-get-cases.mjs`]);
   try{report.server_get=JSON.parse(run(['exec',name,'node','/app/server-get-cases.mjs']));}
   catch(error){if(!String(error.stdout||'').trim())throw new Error(String(error.stderr));report.server_get=JSON.parse(error.stdout);}
   writeFileSync('artifacts/cl15-server-get-result.json',JSON.stringify(report.server_get,null,2));
  }
  run(['restart',name]);const after=await waitReady(name,!!queues);
  report.services.push({service:suffix,start:before,restart:after});console.log(`${suffix}: START_RESTART_PASS`);
 }
 const readonlyName=`${prefix}-readonly`;
 const count=()=>run(['exec',pg,'psql','-U','cl15_fixture','-d','cl15_runtime','-tAc','select count(*) from leadgen.companies']);
 const beforeCount=count();
 run(['run','-d','--name',readonlyName,...base,'-e','DPV_MAINTENANCE_READ_ONLY=true','-e','HTTP_LISTEN_ENABLED=true','-e','PGBOSS_PROCESS_JOBS=false',image]);created.push(readonlyName);
 await waitReady(readonlyName);
 report.readonly=JSON.parse(run(['exec',readonlyName,'node','--input-type=module','-e',"const get=await fetch('http://127.0.0.1:3000/api/health');const post=await fetch('http://127.0.0.1:3000/api/research/jobs',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(get.status!==200||post.status!==503)throw new Error('readonly status mismatch '+get.status+'/'+post.status);console.log(JSON.stringify({get_status:get.status,post_status:post.status}))"]));
 report.readonly.company_counts_stable=beforeCount===count();
 if(!report.readonly.company_counts_stable)throw new Error('Readonly company counts changed');
 const workflows=execFileSync('git',['ls-files','workflows/*.json'],{encoding:'utf8'}).trim().split(/\r?\n/);
 const mounts=[];
 mkdirSync('artifacts/cl15-n8n-fixtures',{recursive:true});
 for(const f of workflows){const w=JSON.parse(readFileSync(f,'utf8'));w.active=false;const name=f.split('/').pop();writeFileSync(`artifacts/cl15-n8n-fixtures/${name}`,JSON.stringify(w));mounts.push('-v',`${root}/artifacts/cl15-n8n-fixtures/${name}:/fixtures/${name}:ro`);}
 report.n8n_import=run(['run','--rm','--network',network,'--user','0','-e','N8N_USER_FOLDER=/tmp/cl15n8n','-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false',...mounts,'n8nio/n8n:2.36.7','import:workflow','--separate','--input=/fixtures']).split('\n').filter(line=>/imported|Importing/.test(line)).join('\n');
 report.n8n_workflows=workflows.length;
 report.pass=!(report.server_get?.server_errors?.length);
 if(!report.pass)process.exitCode=1;
}catch(e){report.pass=false;report.error=e.message;process.exitCode=1;}
finally{
 for(const name of created.reverse())run(['rm','-f',name]);
 run(['network','rm',network]);
 report.disposable_resources_removed=true;
 writeFileSync('artifacts/cl15-runtime-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
