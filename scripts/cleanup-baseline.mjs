import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {compareTableFingerprints} from './cleanup-baseline-comparison.mjs';
const root=process.cwd();
const dir=path.join(root,'artifacts/backups/cleanup-cl00-20260908');
mkdirSync(dir,{recursive:true});
if(!process.argv.includes('--after')&&!process.argv.includes('--restore-check')&&existsSync(path.join(dir,'before.json'))){
 throw new Error('Frozen baseline already exists; use --after or --restore-check to compare without replacing it.');
}
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const restore=process.argv.includes('--restore-check');
const sql=q=>run('docker',['compose','exec','-T','postgres','psql','-X','-U','leadgen_app','-d',restore?'cleanup_cl00_restore_20260908':'lead_generation','-At','-v','ON_ERROR_STOP=1','-c',q]);
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const tables=JSON.parse(sql("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='leadgen'"));
const fingerprints=[];
for(const name of tables){
 const quoted='leadgen."'+name.replaceAll('"','""')+'"';
 const row=JSON.parse(sql(`SELECT json_build_object('table','${name}','rows',count(*),'fingerprint',md5(coalesce(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(row_to_json(t)::text) h FROM ${quoted} t) hashes`));
 fingerprints.push(row);
}
const migrations=readdirSync('database/migrations').filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sha256:hash(readFileSync(path.join('database/migrations',name)))}));
const controls=JSON.parse(sql("SELECT coalesce(json_agg(json_build_object('control_key',control_key,'enabled',enabled,'revision',revision) ORDER BY control_key),'[]') FROM leadgen.automation_controls"));
const policy=JSON.parse(sql("SELECT coalesce(json_agg(json_build_object('policy_revision',policy_revision,'enabled',enabled)),'[]') FROM leadgen.phase13_first_touch_controls"));
const backup=['database.dump','schema.sql'].map(name=>({name,sha256:hash(readFileSync(path.join(dir,name)))}));
const snapshot={observed_at:new Date().toISOString(),branch:run('git',['branch','--show-current']),head:run('git',['rev-parse','HEAD']),guard:'EXECUTION_CONTAINERS_STOPPED',fingerprints,controls,policy,migrations,backup};
const mode=restore?'restore':process.argv.includes('--after')?'after':'before';
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)||mode;
if(!/^[a-z0-9-]+$/.test(label)||mode!=='before'&&label==='before')throw Error('Invalid comparison label');
writeFileSync(path.join(dir,`${label}.json`),JSON.stringify(snapshot,null,2)+'\n');
if(mode==='before')writeFileSync(path.join(dir,'migration-checksums.json'),JSON.stringify(migrations,null,2)+'\n');
if(mode!=='before'){
 const before=JSON.parse(readFileSync(path.join(dir,'before.json'),'utf8'));
 const {changed,removed_tables}=compareTableFingerprints(before.fingerprints,fingerprints);
 const controls_equal=JSON.stringify(controls)===JSON.stringify(before.controls)&&JSON.stringify(policy)===JSON.stringify(before.policy);
 const migrations_equal=JSON.stringify(migrations)===JSON.stringify(before.migrations);
 const applied_files_unchanged=before.migrations.every(old=>migrations.some(now=>now.name===old.name&&now.sha256===old.sha256));
 const added_migrations=migrations.filter(now=>!before.migrations.some(old=>old.name===now.name)).map(m=>m.name);
 const allowAppend=process.argv.includes('--allow-new-migrations')&&applied_files_unchanged;
 console.log(JSON.stringify({tables:tables.length,changed,removed_tables,controls_equal,migrations_equal,applied_files_unchanged,added_migrations,backup}));
 if(changed.length||removed_tables.length||!controls_equal||!(migrations_equal||allowAppend))process.exitCode=1;
}else console.log(JSON.stringify({tables:tables.length,controls,policy,backup,migrations:migrations.length}));
