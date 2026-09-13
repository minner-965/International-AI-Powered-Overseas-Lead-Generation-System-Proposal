import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ExaSearchProvider} from '../services/demo-dashboard/src/search/ExaSearchProvider.js';
import {SearchUsageAudit} from '../services/demo-dashboard/src/search/SearchUsageAudit.js';
const dir='artifacts/exa-configuration-verification';
const output=`${dir}/result.json`;
if(existsSync(output))throw new Error('Existing smoke record retained. Do not repeat the billed request.');
mkdirSync(dir,{recursive:true});
const run=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
const id=run(['compose','ps','--all','-q','demo-dashboard']);
const env=Object.fromEntries(JSON.parse(run(['inspect',id]))[0].Config.Env.map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
const endpoint=env.EXA_SEARCH_ENDPOINT||`${(env.EXA_BASE_URL||'https://api.exa.ai').replace(/\/+$/,'')}/search`;
const url=new URL(endpoint);
if(url.origin!=='https://api.exa.ai'||url.pathname!=='/search'||url.search||url.username||url.password)throw new Error('Exa smoke requires the official HTTPS search endpoint');
if(!env.EXA_API_KEY)throw new Error('EXA_API_KEY is not configured');
execFileSync('git',['check-ignore',output],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const record={started_at:new Date().toISOString(),scope:'ONE_EXA_REQUEST_NO_BACKLOG_NO_EMAIL',configured:true,attempt_limit:1,database_writes:0,smtp_calls:0};
// Persist a pre-request marker: interruption must not silently cause another charge.
writeFileSync(output,JSON.stringify({...record,status:'STARTED_REQUIRES_REVIEW_IF_INTERRUPTED'},null,2));
const provider=new ExaSearchProvider({apiKey:env.EXA_API_KEY,endpoint,maxAttempts:1,timeoutMs:30000});
const audit=new SearchUsageAudit({provider});
const request={query:'women clothing wholesaler importer Dubai UAE dresses womenswear',country:'AE',count:3};
try{
  const result=await audit.search({researchJobId:randomUUID(),purpose:'CONFIGURATION_VERIFICATION',request});
  const done={...record,finished_at:new Date().toISOString(),status:'PASS',provider:'EXA',request_id:result.requestId,
    provider_cost_usd:result.costDollars?.total??null,attempts:result.usage_event.result_payload.audit.attempt_count,
    result_count:result.results.length,results:result.results.map(row=>({title:row.title,url:row.url,excerpt_characters:row.snippet.length}))};
  writeFileSync(output,JSON.stringify(done,null,2));console.log(JSON.stringify(done));
}catch(error){
  const failed={...record,finished_at:new Date().toISOString(),status:'FAIL',code:error.code||'EXA_VERIFICATION_ERROR',http_status:error.status||null};
  writeFileSync(output,JSON.stringify(failed,null,2));console.log(JSON.stringify(failed));process.exitCode=1;
}
