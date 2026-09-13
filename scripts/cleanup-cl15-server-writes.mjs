import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const root=process.cwd().replaceAll('\\','/'),prefix='dpv-cl15-writes',network=prefix+'-net',pg=prefix+'-pg',app=prefix+'-app';
const image=process.env.CL15_IMAGE||'dpv-cleanup-acceptance:cl16',created=[];
const run=args=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024}).trim();
const wait=()=>new Promise(r=>setTimeout(r,1000));
const report={network_internal:true,production_database_used:false,external_calls:0,cases:[]};
const base=['--network',network,'-e',`POSTGRES_HOST=${pg}`,'-e','POSTGRES_USER=fixture','-e','POSTGRES_PASSWORD=fixture_only','-e','POSTGRES_DB=fixture','-e','POSTGRES_PORT=5432','-e','INTERNAL_API_TOKEN=fixture-internal','-e','SEARCH_PROVIDER=exa','-e','EXA_ENABLED=false','-e','OUTREACH_ENABLED=false','-e','AUTO_EVIDENCE_ENABLED=false','-e','RESEARCH_CREATION_MAINTENANCE=true','-e','OUTREACH_SEND_SCOPE=DISABLED','-e','INBOUND_EMAIL_SYNC_ENABLED=false','-e','PGBOSS_ENABLED=true','-e','PGBOSS_PROCESS_JOBS=false','-v',`${root}/services/demo-dashboard/src:/app/src:ro`,'-v',`${root}/database/migrations:/app/database/migrations:ro`];
try{
 run(['network','create','--internal',network]);
 run(['run','-d','--name',pg,'--network',network,'-e','POSTGRES_USER=fixture','-e','POSTGRES_PASSWORD=fixture_only','-e','POSTGRES_DB=fixture','--tmpfs','/var/lib/postgresql/data:rw','postgres:17-alpine']);created.push(pg);
 for(let i=0;i<40;i++){try{run(['exec',pg,'pg_isready','-U','fixture']);break;}catch{await wait();}}
 const migration="const {Pool}=await import('pg');const fs=await import('node:fs/promises');const {applyPhase7Migration}=await import('./src/phase7/migrationRunner.js');const {applyCategoryProcurementMigration}=await import('./src/categoryProcurement/migrationRunner.js');const pool=new Pool({host:process.env.POSTGRES_HOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});for(const f of (await fs.readdir('./database/migrations')).filter(f=>/^\\d{3}_.*sql$/.test(f)).sort()){const n=+f.slice(0,3),migrationPath='./database/migrations/'+f;if(n<24)await pool.query(await fs.readFile(migrationPath,'utf8'));else await(n===24?applyCategoryProcurementMigration:applyPhase7Migration)({pool,migrationPath,expectedDatabase:process.env.POSTGRES_DB,appliedBy:'cl15-write-http'});}await pool.end();";
 run(['run','--rm',...base,image,'node','--input-type=module','-e',migration]);
 run(['exec',pg,'psql','-U','fixture','-d','fixture','-v','ON_ERROR_STOP=1','-c',"INSERT INTO leadgen.companies(id,company_name,normalized_domain,country_code) VALUES('00000000-0000-4000-8000-000000000002','CL15 isolated fixture','cl15.fixture.invalid','AE'); INSERT INTO leadgen.lead_reviews(company_id) VALUES('00000000-0000-4000-8000-000000000002');"]);
 run(['exec',pg,'psql','-U','fixture','-d','fixture','-v','ON_ERROR_STOP=1','-c',"UPDATE leadgen.companies SET data_origin='fixed_public_candidate',verification_status='VERIFIED',lifecycle_status='ACTIVE' WHERE id='00000000-0000-4000-8000-000000000002'; INSERT INTO leadgen.icp_profiles(id,name,profile_type,version,calculation_version,market_scope,product_scope) VALUES('00000000-0000-4000-8000-000000000003','Fixture ICP','MANAGEMENT_BASELINE','cl15-fixture','cl15-fixture',ARRAY['AE'],ARRAY['WOMENSWEAR']);"]);
 const mock=prefix+'-webhook';run(['run','-d','--name',mock,'--network',network,image,'node','-e',"require('http').createServer((q,r)=>{q.resume();r.writeHead(202,{'content-type':'application/json'});r.end('{}')}).listen(3001,'0.0.0.0')"]);created.push(mock);
 run(['run','-d','--name',app,...base,'-e','EXA_ENABLED=true','-e','EXA_API_KEY=fixture-not-a-real-key','-e','AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED=true','-e',`N8N_ENRICHMENT_WEBHOOK_URL=http://${mock}:3001/enrichment`,'-e',`N8N_CATEGORY_PROCUREMENT_WEBHOOK_URL=http://${mock}:3001/category`,image]);created.push(app);
 let ready=false;for(let i=0;i<60;i++){try{run(['exec',app,'wget','-qO-','http://127.0.0.1:3000/api/health']);ready=true;break;}catch{await wait();}}
 if(!ready)throw new Error('Fixture HTTP startup failed');
 const source=readFileSync('services/demo-dashboard/src/server.js','utf8');
 const routes=[...source.matchAll(/app\.(post|put|patch|delete)\('([^']+)'/g)].map(m=>({method:m[1].toUpperCase(),path:m[2].replace(':id','00000000-0000-4000-8000-000000000001')}));
 const cases=routes.filter(r=>r.path.startsWith('/api/internal/')||r.path==='/api/research/jobs/00000000-0000-4000-8000-000000000001/status').map(r=>({...r,expected:[401],label:'missing internal credential'}));
 cases.push(
  {method:'PUT',path:'/api/automation/control',body:{},expected:[400],label:'invalid automation input'},
  {method:'PUT',path:'/api/automation/control',body:{enabled:false},expected:[200],label:'pause control persists'},
  {method:'POST',path:'/api/automation/reconcile',body:{},expected:[202],label:'empty reconciliation'},
  {method:'POST',path:'/api/research/jobs',body:{},expected:[503],label:'creation maintenance gate'},
  {method:'PATCH',path:'/api/leads/00000000-0000-4000-8000-000000000001/approval',body:{status:'bogus'},expected:[400],label:'approval invalid status'},
  {method:'PATCH',path:'/api/leads/00000000-0000-4000-8000-000000000001/approval',body:{status:'approved'},expected:[404],label:'approval missing company'},
  {method:'POST',path:'/api/internal/research/jobs/00000000-0000-4000-8000-000000000001/generate-queries',auth:true,expected:[410],label:'retired generation boundary'},
  {method:'POST',path:'/api/internal/research/jobs/00000000-0000-4000-8000-000000000001/discover',auth:true,expected:[410],label:'retired discovery boundary'},
  {method:'POST',path:'/api/internal/auto-evidence/reconcile',auth:true,body:{controlled_batch:true},expected:[403],label:'internal token cannot approve batch'},
  {method:'PATCH',path:'/api/research/jobs/00000000-0000-4000-8000-000000000001/status',auth:true,body:{status:'bogus'},expected:[400],label:'job status validation'},
  {method:'PATCH',path:'/api/research/jobs/00000000-0000-4000-8000-000000000001/status',auth:true,body:{status:'FAILED'},expected:[404],label:'missing job'},
  {method:'POST',path:'/api/internal/research/direct-dispatch/reconcile',auth:true,body:{limit:1},expected:[202],label:'empty dispatch outbox'}
 );
 for(const status of ['approved','approved','rejected','needs_changes','pending'])cases.push({method:'PATCH',path:'/api/leads/00000000-0000-4000-8000-000000000002/approval',body:{status},expected:[200],label:'approval persistence '+status});
 for(const path of ['/api/internal/scoring/recalculate','/api/internal/customer-match/recalculate','/api/internal/scoring/replay']){
  cases.push({method:'POST',path,auth:true,body:{},expected:[400],label:'explicit scope required'});
  cases.push({method:'POST',path,auth:true,body:{company_id:'00000000-0000-4000-8000-000000000002'},expected:[202],label:'isolated queue accepted'});
 }
 cases.push({method:'POST',path:'/api/internal/icp/rebuild',auth:true,body:{name:'Fixture ICP',reference_market:'AE',market_scope:['AE'],product_scope:['WOMENSWEAR']},expected:[202],label:'ICP rebuild queued'});
 const draft={revision:99001,source_type:'MANAGEMENT_APPROVED',source_reference:'CL15 fixture',source_digest:'a'.repeat(64),scopes:[{product_profile:'WOMENSWEAR',normalized_category:'DRESSES',source_fact_digest:'b'.repeat(64)}]};
 cases.push({method:'POST',path:'/api/category-scopes/revisions',body:{},expected:[400],label:'category empty draft invalid'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions',body:{...draft,revision:0},expected:[400],label:'category invalid revision'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions/00000000-0000-4000-8000-000000000009/approve',body:{revision:99003,source_reference:'CL15 missing fixture',source_digest:'d'.repeat(64)},expected:[404],label:'category missing draft'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions',body:draft,expected:[201],save:'draft',label:'category draft create'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions',body:draft,expected:[200],label:'category draft replay'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions/$draft/approve',body:{revision:99002,source_reference:'CL15 approved fixture',source_digest:'c'.repeat(64)},expected:[201],label:'category approval'});
 cases.push({method:'POST',path:'/api/category-scopes/revisions/$draft/approve',body:{revision:99002,source_reference:'CL15 approved fixture',source_digest:'c'.repeat(64)},expected:[200],label:'category approval replay'});
 cases.push({method:'POST',path:'/api/reference-data/imports/dry-run',auth:true,body:{import_type:'INVALID',source_filename:'fixture.csv',csv_text:'x'},expected:[400],label:'invalid import type'});
 cases.push({method:'POST',path:'/api/reference-data/imports/dry-run',auth:true,body:{import_type:'HISTORICAL_CUSTOMERS',source_filename:'fixture.csv',csv_text:'external_customer_id,company_name,country_code\ncl15-fixture,CL15 Fixture,AE'},save:'import',expected:[201],label:'historical customer dry run'});
 cases.push({method:'POST',path:'/api/reference-data/imports/$import/commit',auth:true,expected:[200],label:'historical customer commit'});
 cases.push({method:'POST',path:'/api/reference-data/imports/$import/commit',auth:true,expected:[200],label:'historical customer commit replay'});
 cases.push({method:'POST',path:'/api/enrichment/jobs',body:{market_codes:['BAD']},expected:[400],label:'enrichment market rejected'});
 cases.push({method:'POST',path:'/api/enrichment/jobs',body:{market_codes:['AE'],product_profiles:['WOMENSWEAR'],company_ids:['00000000-0000-4000-8000-000000000002'],idempotency_key:'cl15-enrichment'},save:'enrichment',expected:[202],label:'enrichment created and mock dispatch accepted'});
 cases.push({method:'POST',path:'/api/enrichment/jobs',body:{market_codes:['AE'],product_profiles:['WOMENSWEAR'],company_ids:['00000000-0000-4000-8000-000000000002'],idempotency_key:'cl15-enrichment'},expected:[200],label:'enrichment replay'});
 cases.push({method:'POST',path:'/api/category-procurement/jobs',body:{company_ids:['bad-id']},expected:[400],label:'category procurement malformed UUID'});
 cases.push({method:'POST',path:'/api/category-procurement/jobs',body:{company_ids:['00000000-0000-4000-8000-000000000002']},save:'category',expected:[202],label:'category procurement mock dispatch accepted'});
 cases.push({method:'POST',path:'/api/auto-evidence/controlled-batch',body:{},expected:[403],label:'controlled batch approval reference required'});
 cases.push({method:'POST',path:'/api/auto-evidence/controlled-batch',body:{approval_reference:'cl15-fixture',company_ids:['00000000-0000-4000-8000-000000000099']},expected:[202],label:'controlled batch empty eligible cohort'});
 cases.push({method:'POST',path:'/api/internal/data-cleanup/dry-run',auth:true,body:{},expected:[400],label:'cleanup invalid batch'});
 cases.push({method:'POST',path:'/api/internal/data-cleanup/dry-run',auth:true,body:{cleanup_batch_id:'cl15-fixture-cleanup',backup_reference:'isolated tmpfs fixture'},expected:[201],label:'cleanup dryrun persisted'});
 cases.push({method:'POST',path:'/api/internal/icp/profiles/00000000-0000-4000-8000-000000000003/activate',auth:true,body:{},expected:[200],label:'ICP activate fixture'});
 for(const [path,status] of [['/api/internal/enrichment/jobs/$enrichment/run',202],['/api/internal/category-procurement/jobs/$category/run',202],['/api/internal/research/jobs/$enrichment/check-contacts',200],['/api/internal/research/jobs/$enrichment/verify-companies',200]])cases.push({method:'POST',path,auth:true,body:{promote:false,allow_social_search:false},expected:[status],label:'queue or empty candidate boundary'});
 cases.push({method:'PATCH',path:'/api/research/jobs/$enrichment/status',auth:true,body:{status:'FAILED'},expected:[200],label:'research job forward failure transition'});
 cases.push({method:'PATCH',path:'/api/research/jobs/$enrichment/status',auth:true,body:{status:'QUEUED'},expected:[409],label:'research terminal reverse transition rejected'});
 cases.push({method:'POST',path:'/api/internal/auto-evidence/events',auth:true,body:{company_id:'00000000-0000-4000-8000-000000000002'},expected:[202],label:'auto evidence disabled boundary'});
 cases.push({method:'POST',path:'/api/internal/auto-evidence/reconcile',auth:true,body:{},expected:[202],label:'auto evidence reconciliation disabled boundary'});
 cases.push({method:'POST',path:'/api/internal/orchestrator/heartbeat',auth:true,body:{},expected:[400],label:'heartbeat invalid workflow rejected'});
 cases.push({method:'POST',path:'/api/internal/orchestrator/heartbeat',auth:true,body:{workflow_key:'cl15-fixture',instance_id:'fixture',status:'HEALTHY'},expected:[202],label:'heartbeat persisted'});
 cases.push({method:'POST',path:'/api/internal/orchestrator/watchdog',auth:true,body:{limit:1},expected:[202],label:'watchdog no overdue jobs'});
 cases.push({method:'POST',path:'/api/research/provider-status/refresh',body:{},expected:[200],label:'Exa local account-state refresh no provider request'});
 for(const path of ['/api/internal/enrichment/jobs/$enrichment/status','/api/internal/category-procurement/jobs/$category/status']){
  cases.push({method:'PATCH',path,auth:true,body:{status:'BOGUS'},expected:[400],label:'internal invalid status'});
  cases.push({method:'PATCH',path,auth:true,body:{status:'FAILED',error:'fixture stop'},expected:[200],label:'internal failed status persists'});
 }
 const script=`const rows=[],ids={};for(const c of ${JSON.stringify(cases)}){const path=c.path.replace(/\\$(draft|import|enrichment|category)/g,(_,k)=>ids[k]||'missing-fixture');const response=await fetch('http://127.0.0.1:3000'+path,{method:c.method,headers:{'content-type':'application/json',...(c.auth?{authorization:'Bearer fixture-internal'}:{})},body:JSON.stringify(c.body||{})});const body=await response.json();if(c.save)ids[c.save]=body.id||body.import_id||body.job_id;rows.push({...c,status:response.status,pass:c.expected.includes(response.status),code:body.code||null,...(!c.expected.includes(response.status)?{error:body.error}:{} )});}console.log(JSON.stringify(rows));`;
 report.cases=JSON.parse(run(['exec',app,'node','--input-type=module','-e',script]));
 report.category_error_log=run(['logs',app]).split('\n').filter(line=>line.includes('CATEGORY_SCOPE_')).map(line=>line.trim());
 report.approval_persisted=run(['exec',pg,'psql','-U','fixture','-d','fixture','-tAc',"SELECT approval_status||':'||send_status FROM leadgen.lead_reviews WHERE company_id='00000000-0000-4000-8000-000000000002'"])==='pending:disabled';
 if(!report.approval_persisted)throw new Error('Approval final state failed persistence check');
 report.category_revisions_persisted=run(['exec',pg,'psql','-U','fixture','-d','fixture','-tAc',"SELECT count(*) FROM leadgen.dpv_product_category_scope_revisions WHERE revision IN(99001,99002)"])==='2';
 report.import_row_deduplicated=run(['exec',pg,'psql','-U','fixture','-d','fixture','-tAc',"SELECT count(*) FROM leadgen.historical_customers WHERE external_customer_id='cl15-fixture'"])==='1';
 if(!report.category_revisions_persisted||!report.import_row_deduplicated)throw new Error('Category/import persistence failed');
 report.direct_write_routes=routes.length;report.pass=report.cases.every(c=>c.pass);
 report.live_provider_positive_cases='NOT_RUN';report.business_mutation_coverage='Company approval persistence; category draft/approval/replay; reference import dry-run/commit/replay; scoring/match/replay/ICP queued (workers disabled); remaining success paths not claimed';
 if(!report.pass)process.exitCode=1;
}catch(e){report.pass=false;report.error=e.message;process.exitCode=1;}
finally{for(const c of created.reverse())run(['rm','-f',c]);run(['network','rm',network]);report.disposable_resources_removed=true;mkdirSync('artifacts/cl15-server-writes',{recursive:true});writeFileSync('artifacts/cl15-server-writes/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
