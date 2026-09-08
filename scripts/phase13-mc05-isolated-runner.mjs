// Restore the accepted local checkpoint into a disposable database. No worker connects to it.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const baseline=resolve(process.argv[2]||join(root,'artifacts/phase13-mc04/mc05-baseline-2026-09-08T04-15-17-418Z'));
assert.ok(baseline.startsWith(join(root,'artifacts')+sep));
const database=`mc05_fixture_${Date.now()}_${randomBytes(6).toString('hex')}`;
assert.match(database,/^mc05_fixture_\d+_[a-f0-9]{12}$/);
const archive=join(baseline,'database.dump');assert.ok(existsSync(archive));
const docker=(args,options={})=>execFileSync('docker',args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,...options});
const sql=text=>docker(['exec','-i','dpv-leadgen-postgres-1','sh','-c','psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1'],{input:text});
let created=false;
try{
 sql(`CREATE DATABASE "${database}" TEMPLATE template0;`);created=true;
 docker(['cp',archive,`dpv-leadgen-postgres-1:/tmp/${database}.dump`]);
 docker(['exec','dpv-leadgen-postgres-1','sh','-c',`pg_restore -U "$POSTGRES_USER" -d ${database} --exit-on-error /tmp/${database}.dump`]);
 docker(['exec','--user','root','dpv-leadgen-demo-dashboard-1','mkdir','-p','/app/mc05-verification']);
 docker(['cp',join(root,'services/demo-dashboard/src'),'dpv-leadgen-demo-dashboard-1:/app/mc05-verification/']);
 docker(['cp',join(root,'services/demo-dashboard/public'),'dpv-leadgen-demo-dashboard-1:/app/mc05-verification/']);
 docker(['cp',join(root,'scripts/phase13-mc05-isolated.mjs'),'dpv-leadgen-demo-dashboard-1:/app/mc05-verification/test.mjs']);
 docker(['cp',join(root,'database/migrations/059_phase13_research_batches.sql'),'dpv-leadgen-demo-dashboard-1:/app/mc05-verification/059.sql']);
 const output=docker(['exec','-e',`MC05_FIXTURE_DATABASE=${database}`,'dpv-leadgen-demo-dashboard-1','node','/app/mc05-verification/test.mjs']);
 writeFileSync(join(baseline,'isolated-result.json'),output);console.log(output.trim());
}finally{
 if(created){sql(`DROP DATABASE "${database}" WITH (FORCE);`);const absent=sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`);assert.match(absent,/\s0\s/);console.log(JSON.stringify({cleanup:'DROPPED_AND_ABSENCE_VERIFIED',production_writes:0}));}
}
