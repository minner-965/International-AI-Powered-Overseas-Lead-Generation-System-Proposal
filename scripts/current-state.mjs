import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
export const currentKeys=['generated_at','repo','commit','branch','current_phase','runtime_controls','provider_state','search_state','opportunity_pool_counts','contact_counts','email_state','reply_state','blockers','migrations','next_allowed_work'];
export function validateCurrentState(s){
 const assert=(v,m)=>{if(!v)throw new Error(m);};
 assert(JSON.stringify(Object.keys(s).sort())===JSON.stringify([...currentKeys].sort()),'Current-state keys must exclude historical snapshots');
 const rejectHistory=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){assert(!/^phase(?:10|11|12|13)_|^latest_released_phase$|^explicit_stop_boundary$/.test(key),'Historical keys are not current truth');rejectHistory(child);}};
 rejectHistory(s);
 for(const key of ['runtime_controls','provider_state','search_state','opportunity_pool_counts','contact_counts','email_state','reply_state','migrations'])assert(s[key]&&typeof s[key]==='object'&&!Array.isArray(s[key]),`${key} must be an object`);
 assert(/^[a-f0-9]{40}$/.test(s.commit)&&!Number.isNaN(Date.parse(s.generated_at)),'Snapshot identity invalid');
 assert(s.search_state.completed+s.search_state.remaining===s.search_state.total,'Search counts do not reconcile');
 assert(s.search_state.completed>=0&&s.search_state.remaining>=0,'Search counts must be nonnegative');
 assert(s.provider_state.search_runtime_state===s.search_state.runtime_state,'Duplicate provider/search truth differs');
 assert(Array.isArray(s.runtime_controls.persisted)&&s.runtime_controls.persisted.every(c=>typeof c.enabled==='boolean'&&c.revision>0),'Controls invalid');
 assert(s.next_allowed_work==='CL14_CL16_THEN_BOUNDED_EXA_VERIFICATION','Cleanup boundary invalid');
 return true;
}
export function assertCurrentProjectionMatches(state,actual){
 for(const key of currentKeys.filter(k=>!['generated_at','repo','commit','branch'].includes(k)))if(JSON.stringify(actual[key])!==JSON.stringify(state[key]))throw new Error(`Current DB/runtime projection differs: ${key}`);
 return true;
}
export function collectCurrentState(){
 const sql=`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
 SELECT json_build_object(
 'observed_at',now(),
 'controls',(SELECT json_agg(json_build_object('control_key',control_key,'enabled',enabled,'revision',revision,'settings',settings) ORDER BY control_key) FROM leadgen.automation_controls),
 'accounts',(SELECT json_agg(json_build_object('provider',provider_code,'status',status,'checked_at',checked_at) ORDER BY provider_code) FROM leadgen.provider_account_states),
 'search',(SELECT json_build_object('total',coalesce(sum(jsonb_array_length(plan->'queries')),0),'parent_plans',count(*)) FROM leadgen.research_query_plans WHERE batch_id IS NOT NULL),
 'executions',(SELECT coalesce(json_object_agg(status,n),'{}') FROM (SELECT status,count(*) n FROM leadgen.research_query_executions GROUP BY status) x),
 'completed',(SELECT count(DISTINCT (e.research_query_plan_id,e.query_fingerprint)) FROM leadgen.research_query_executions e JOIN leadgen.research_query_plans p ON p.id=e.research_query_plan_id WHERE e.status IN('PERSISTED','NOT_FOUND') AND (p.batch_id IS NOT NULL OR EXISTS(SELECT 1 FROM leadgen.research_batch_children j JOIN leadgen.research_query_plans parent ON parent.batch_id=j.batch_id WHERE j.research_job_id=p.research_job_id))),
 'opportunities',(SELECT json_build_object('current',count(*),'active',count(*) FILTER(WHERE is_active_business_opportunity)) FROM leadgen.opportunity_pool_current),
 'bands',(SELECT json_object_agg(opportunity_pool_band,n) FROM (SELECT opportunity_pool_band,count(*) n FROM leadgen.opportunity_pool_current GROUP BY opportunity_pool_band) x),
 'contacts',json_build_object('companies',(SELECT count(*) FROM leadgen.companies),'contacts',(SELECT count(*) FROM leadgen.contacts),'decision_maker_contacts',(SELECT count(*) FROM leadgen.decision_maker_contacts)),
 'policy',(SELECT json_agg(json_build_object('policy_revision',policy_revision,'enabled',enabled,'template_set_key',template_set_key,'per_day_limit',per_day_limit,'per_minute_limit',per_minute_limit,'company_cooldown_days',company_cooldown_days) ORDER BY policy_revision) FROM leadgen.phase13_first_touch_controls),
 'outbound',(SELECT coalesce(json_object_agg(send_status,n),'{}') FROM (SELECT send_status,count(*) n FROM leadgen.outbound_messages GROUP BY send_status) x),
 'reservations',(SELECT coalesce(json_object_agg(status,n),'{}') FROM (SELECT status,count(*) n FROM leadgen.phase13_first_touch_reservations GROUP BY status) x),
 'reply',json_build_object('inbound_messages',(SELECT count(*) FROM leadgen.inbound_messages),'activities',(SELECT count(*) FROM leadgen.opportunity_activities),'sales_tasks',(SELECT count(*) FROM leadgen.sales_tasks),'suppressions',(SELECT count(*) FROM leadgen.contact_suppressions),'last_imap_success',(SELECT max(last_success_at) FROM leadgen.imap_mailbox_checkpoints)),
 'migration_ledger',(SELECT json_agg(json_build_object('name',migration_key,'sha256',checksum_sha256) ORDER BY migration_key) FROM leadgen.schema_migrations)); COMMIT;`;
 const raw=run('docker',['compose','exec','-T','postgres','psql','-X','-q','-U','leadgen_app','-d','lead_generation','-At','-v','ON_ERROR_STOP=1','-c',sql]);
 const db=JSON.parse(raw);
 const services=run('docker',['compose','ps','--all','--format','json']).split('\n').filter(Boolean).map(v=>JSON.parse(v)).map(v=>({service:v.Service,state:v.State})).sort((a,b)=>a.service.localeCompare(b.service));
 const envFor=service=>{
  const id=run('docker',['compose','ps','--all','-q',service]);
  if(!id)return {};
  return Object.fromEntries(JSON.parse(run('docker',['inspect',id]))[0].Config.Env.map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
 };
 const dashboard=envFor('demo-dashboard'),mail=envFor('outreach-worker');
 const control=db.controls.find(c=>c.control_key==='RESEARCH_PROVIDER_EXECUTION');
 const selected=control?.settings?.provider_order?.[0]?.toUpperCase()||null;
 const account=db.accounts?.find(a=>a.provider===selected);
 const readOnly=dashboard.DPV_MAINTENANCE_READ_ONLY==='true'||dashboard.DPV_MAINTENANCE_READ_ONLY==='1';
 const paused=readOnly||services.filter(v=>v.service!=='postgres').every(v=>v.state!=='running');
 const runtime=!control?.enabled?'PAUSED_AUTOMATION_OFF':account?.status==='CREDIT_EXHAUSTED'?'PAUSED_PROVIDER_CAPACITY':paused?'PAUSED_MAINTENANCE':'NOT_ASSESSED';
 const state={generated_at:db.observed_at,repo:path.basename(root),commit:run('git',['rev-parse','HEAD']),branch:run('git',['branch','--show-current']),current_phase:'Phase 13 cleanup CL14-CL16 and Exa verification',
 runtime_controls:{persisted:db.controls,execution_services:services,maintenance_active:paused,http_read_only:readOnly},
 provider_state:{selected_provider:selected,configured:Boolean(selected&&dashboard[`${selected}_API_KEY`]),account_state:account?.status||'NOT_CHECKED',search_runtime_state:runtime,last_checked:account?.checked_at||null},
 search_state:{runtime_state:runtime,total:db.search.total,completed:db.completed,remaining:db.search.total-db.completed,parent_plans:db.search.parent_plans,execution_status_counts:db.executions},
 opportunity_pool_counts:{...db.opportunities,bands:db.bands},contact_counts:db.contacts,
 email_state:{provider:mail.OUTBOUND_EMAIL_PROVIDER||null,smtp_configured:Boolean(mail.SMTP_HOST&&mail.SMTP_USER&&mail.SMTP_PASSWORD),smtp_enabled:mail.SMTP_ENABLED==='true',execution_paused:paused,policy:db.policy,outbound_status_counts:db.outbound,reservation_status_counts:db.reservations},
 reply_state:{...db.reply,imap_configured:Boolean(mail.IMAP_HOST&&mail.IMAP_USER&&mail.IMAP_PASSWORD),monitor_enabled:mail.SMTP_IMAP_INBOUND_SYNC_ENABLED==='true',execution_paused:paused},
 blockers:[...(paused?['MAINTENANCE_EXECUTION_PAUSED']:[]),...(runtime==='PAUSED_PROVIDER_CAPACITY'?['PROVIDER_CAPACITY_EXHAUSTED']:[])],
 migrations:{files:readdirSync(path.join(root,'database/migrations')).filter(v=>v.endsWith('.sql')).sort().map(name=>({name,sha256:createHash('sha256').update(readFileSync(path.join(root,'database/migrations',name))).digest('hex')})),operational_ledger:db.migration_ledger},next_allowed_work:'CL14_CL16_THEN_BOUNDED_EXA_VERIFICATION'};
 validateCurrentState(state);return state;
}
export function parseCurrentState(text){const m=text.match(/<!-- CURRENT_PROJECT_STATUS_JSON:BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- CURRENT_PROJECT_STATUS_JSON:END -->/);if(!m)throw new Error('Current state block missing');return JSON.parse(m[1]);}
