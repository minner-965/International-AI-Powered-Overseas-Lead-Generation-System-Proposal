// Execute existing isolated acceptance harnesses without starting operational workers.
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
execFileSync(process.execPath,['scripts/cleanup-maintenance-guard.mjs'],{cwd:root});
const container=JSON.parse(execFileSync('docker',['inspect','dpv-leadgen-postgres-1'],{encoding:'utf8'}))[0];
const values=Object.fromEntries(container.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const network=Object.keys(container.NetworkSettings.Networks)[0];
const env={...process.env,POSTGRES_HOST:'postgres',POSTGRES_USER:values.POSTGRES_USER,POSTGRES_PASSWORD:values.POSTGRES_PASSWORD,POSTGRES_DB:values.POSTGRES_DB,DPV_PROJECT_ROOT:'/workspace',PHASE11_APP_ROOT:'/app',PHASE13_APP_ROOT:'/app'};
const dir=join(root,'artifacts/cleanup-cl15-backend');mkdirSync(dir,{recursive:true});
const results=[];
for(const script of ['phase11-oq14-isolated-regression.mjs','phase13-search-isolated.mjs','cleanup-cl15-postgres-tests.mjs']){
 const args=['run','--rm','--network',network,'--mount',`type=bind,source=${root},target=/workspace,readonly`,'--mount',`type=bind,source=${join(root,'services/demo-dashboard/src')},target=/app/src,readonly`];
 args.push('--mount',`type=bind,source=${join(root,'services/demo-dashboard/test')},target=/app/test,readonly`);
 for(const key of ['POSTGRES_HOST','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','DPV_PROJECT_ROOT','PHASE11_APP_ROOT','PHASE13_APP_ROOT'])args.push('-e',key);
 args.push('--entrypoint','node','dpv-leadgen-demo-dashboard',`/workspace/scripts/${script}`);
 const result=spawnSync('docker',args,{cwd:root,env,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
 const output=(result.stdout||'')+(result.stderr||'');
 const redacted=values.POSTGRES_PASSWORD?output.replaceAll(values.POSTGRES_PASSWORD,'[REDACTED]'):output;
 writeFileSync(join(dir,`${script}.log`),redacted);
 results.push({script,exit_code:result.status,error:result.error?.code||null});
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(join(dir,'result.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));
if(results.some(x=>x.exit_code!==0))process.exitCode=1;
