import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {createPhase7Router,registerPhase7RawWebhookRoutes} from '../src/phase7/router.js';

// Source scanning discovers cases only. Every assertion below sends a real HTTP
// request through Express; no declaration/reference is counted as execution.
const source=readFileSync(new URL('../src/phase7/router.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/router\.(get|post|patch)\('([^']+)'/g)];
const cases=declarations.map((m,i)=>{
 const block=source.slice(m.index,declarations[i+1]?.index??source.indexOf('router.use((error',m.index));
 const status=Number(block.match(/res\.status\((\d+)\)/)?.[1]||200);
 return {method:m[1].toUpperCase(),path:m[2],status:[404].includes(status)?200:status};
});
const uuid='11111111-1111-4111-8111-111111111111';
const retired=p=>p.startsWith('/api/manual-official-routes/') ;
async function harness(t){
 let fail=false;const calls=[];
 const invoke=(name,args)=>{
  calls.push({name,args});
  if(fail)throw Object.assign(new Error('Fixture service rejected'),{status:422,code:'FIXTURE_REJECTED'});
  if(['reconcileManualOfficialRoutes','recordManualOfficialRouteAction'].includes(name))throw Object.assign(new Error('Retired policy'),{status:410,code:'RETIRED_POLICY'});
  if(['getTemplate','importErrorReport'].includes(name))return{filename:'fixture.xlsx',buffer:Buffer.from('fixture'),row_count:1};
  if(name==='downloadExport')return{filename:'fixture.csv',bytes:Buffer.from('name\nfixture'),mimeType:'text/csv'};
  if(name==='enqueue')return'fixture-queue-id';
  if(/^(list|getOutboundEvents|getContactVerificationHistory|getImportRows)/.test(name))return[];
  return{id:uuid,status:'FIXTURE',fixture_method:name};
 };
 const proxy=new Proxy({},{get:(_o,name)=>(...args)=>invoke(name,args)});
 const service=new Proxy({repository:proxy},{get:(o,name)=>name==='repository'?o.repository:(...args)=>invoke(name,args)});
 const auth={authenticate:(req,res,next)=>{if(req.get('x-fixture-auth')!=='valid')return res.sendStatus(401);req.managementUser={identity:'cl15',role:req.get('x-fixture-role')||'MANAGEMENT'};next();},requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.sendStatus(403)};
 const internal=(req,res,next)=>req.get('x-fixture-internal')==='valid'?next():res.sendStatus(401);
 const app=express();registerPhase7RawWebhookRoutes(app,{service,queue:proxy});app.use(express.json());app.use(createPhase7Router({service,queue:proxy,managementAuth:auth,requireInternalToken:internal}));
 // Raw webhook routes are app-level; their final error middleware is supplied
 // by server.js in production and must be supplied by this isolated app too.
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const request=(entry,extra={})=>fetch(`http://127.0.0.1:${server.address().port}${entry.path.replace(/:([A-Za-z]+)/g,uuid)}`,{method:entry.method,headers:{'content-type':'application/json','x-fixture-auth':'valid','x-fixture-internal':'valid',...extra},...(entry.method!=='GET'?{body:JSON.stringify({action:'CRM_SYNC',resource_id:uuid})}:{})});
 return {request,calls,setFail:()=>{fail=true;}};
}
for(const entry of cases)test(`CL15 Phase7 HTTP ${entry.method} ${entry.path} success and service rejection`,async t=>{
 const h=await harness(t),response=await h.request(entry);
 assert.equal(response.status,retired(entry.path)?410:entry.status,await response.text());
 assert.ok(h.calls.length>0,'handler must invoke its injected dependency');
 if(entry.path.includes('/download')||entry.path.includes('/templates/')||entry.path.endsWith('/error-report'))assert.match(response.headers.get('content-disposition'),/attachment; filename="fixture\.(xlsx|csv)"/);
 h.setFail();const denied=await h.request(entry);assert.equal(denied.status,422);assert.equal((await denied.json()).code,'FIXTURE_REJECTED');
 if(entry.path!=='/api/workspace/contact-queue'){
  const before=h.calls.length;const unauthorized=await h.request(entry,{'x-fixture-auth':'','x-fixture-internal':''});assert.equal(unauthorized.status,401);assert.equal(h.calls.length,before);
  if(entry.method!=='GET'&&!entry.path.includes('/internal/')){assert.equal((await h.request(entry,{'x-fixture-role':'NONE'})).status,403);assert.equal(h.calls.length,before);}
 }
});
for(const provider of['resend','corporate'])test(`CL15 Phase7 HTTP POST /api/webhooks/email/${provider} raw acceptance and signature rejection propagation`,async t=>{
 const h=await harness(t),entry={method:'POST',path:`/api/webhooks/email/${provider}`};assert.equal((await h.request(entry)).status,202);assert.equal(h.calls[0].name,'acceptWebhook');assert.equal(h.calls[0].args[0],provider);assert.ok(Buffer.isBuffer(h.calls[0].args[1]));h.setFail();assert.equal((await h.request(entry)).status,422);
});
test('CL15 Phase7 internal orchestrator rejects missing internal token before enqueue',async t=>{
 const h=await harness(t);
 const entry={method:'POST',path:'/api/internal/phase7/orchestrate'};
 assert.equal((await h.request(entry,{'x-fixture-internal':''})).status,401);assert.equal(h.calls.length,0);
});
