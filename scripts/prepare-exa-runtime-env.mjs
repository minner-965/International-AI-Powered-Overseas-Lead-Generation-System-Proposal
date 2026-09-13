import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
const output='.env.exa-runtime';
execFileSync('git',['check-ignore',output],{stdio:['ignore','pipe','pipe'],windowsHide:true});
if(existsSync(output)){console.log('Existing private Exa runtime configuration retained.');process.exit(0);}
const run=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
const id=run(['compose','ps','--all','-q','demo-dashboard']);
const env=Object.fromEntries(JSON.parse(run(['inspect',id]))[0].Config.Env.map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
if(!env.EXA_API_KEY)throw new Error('Existing Exa credential is missing');
const names=['EXA_API_KEY','EXA_ENABLED','EXA_SEARCH_ENDPOINT','EXA_BASE_URL','EXA_CAPACITY_RETRY_HOURS','SEARCH_PROVIDER','SEARCH_DUAL_ROUTING_ENABLED'];
const lines=names.filter(name=>env[name]!=null).map(name=>{
  if(/[\r\n']/.test(env[name]))throw new Error('Unsupported environment value format');
  return `${name}='${env[name]}'`;
});
writeFileSync(output,lines.join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('Private Exa runtime configuration preserved; values omitted.');
