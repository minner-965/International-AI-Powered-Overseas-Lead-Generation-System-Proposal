import {execFileSync} from 'node:child_process';
const cwd=process.cwd();
const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
const remote=git(['remote','get-url','origin']);
const expected='https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal.git';
if(remote!==expected)throw new Error('Unexpected release remote');
let credential;
try{credential=execFileSync('git',['credential','fill'],{cwd,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});}
catch{console.log(JSON.stringify({remote_verified:true,privacy:'NOT_VERIFIED',reason:'CREDENTIAL_UNAVAILABLE'}));process.exit(1);}
const token=credential.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);
if(!token){console.log(JSON.stringify({privacy:'NOT_VERIFIED',reason:'CREDENTIAL_UNAVAILABLE'}));process.exit(1);}
try{
  const response=await fetch('https://api.github.com/repos/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal',{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
  if(!response.ok){console.log(JSON.stringify({privacy:'NOT_VERIFIED',http_status:response.status}));process.exit(1);}
  const body=await response.json();
  console.log(JSON.stringify({repository:body.full_name,private:body.private,visibility:body.visibility,branch:git(['branch','--show-current'])}));
  if(body.private!==true)process.exitCode=1;
}catch{console.log(JSON.stringify({privacy:'NOT_VERIFIED',reason:'NETWORK_ERROR'}));process.exitCode=1;}
