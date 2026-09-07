import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Output paths/counts only: never emit a credential or the controlled address.
const root=process.cwd();
const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:64*1024*1024});
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
const tracked=new Set(git(['ls-files','-z']).split('\0').filter(Boolean));
const values=new Map();
for(const n of (await fs.readdir(root)).filter(n=>n.startsWith('.env')&&!n.endsWith('.example'))){
  const content=await fs.readFile(path.join(root,n),'utf8');
  for(const line of content.split(/\r?\n/)){
    const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(!m)continue;
    const v=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');
    if(/CONTROLLED.*ALLOWLIST|CONTROLLED.*RECIPIENT/.test(m[1]))for(const address of v.split(/[;,\s]+/).filter(x=>x.includes('@')))values.set(address,'CONTROLLED_ADDRESS');
    else if(/PASSWORD|SECRET|API_KEY|ACCESS_TOKEN|ENCRYPTION_KEY/.test(m[1])&&v.length>=8&&!/^(change|replace|your_|example)/i.test(v))values.set(v,'CREDENTIAL');
  }
}
const hits=[];let scanned=0;
for(const file of new Set(files)){
  const stat=await fs.stat(path.join(root,file)).catch(()=>null);if(!stat?.isFile()||stat.size>20*1024*1024)continue;
  const bytes=await fs.readFile(path.join(root,file));scanned++;
  for(const [value,kind]of values)if(bytes.includes(Buffer.from(value)))hits.push({file,kind,tracked:tracked.has(file)});
}
const envTracked=[...tracked].filter(f=>/(^|\/)\.env(?:\.|$)/.test(f)&&!f.endsWith('.example'));
console.log(JSON.stringify({scanned_files:scanned,configured_sensitive_values:values.size,hit_count:hits.length,hits,nonexample_env_tracked:envTracked,result:!hits.length&&!envTracked.length?'PASS':'FAIL'},null,2));
if(hits.length||envTracked.length)process.exitCode=1;
