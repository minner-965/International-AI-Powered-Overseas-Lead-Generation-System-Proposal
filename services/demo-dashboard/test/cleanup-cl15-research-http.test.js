import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createResearchRouter} from '../src/research/router.js';
import {createResearchBatchRouter} from '../src/research/researchBatchRouter.js';

const id='11111111-1111-4111-8111-111111111111';
const missing='22222222-2222-4222-8222-222222222222';
async function setup(t){
 const auth={authenticate:(req,res,next)=>{const role=req.get('x-fixture-role');if(!role)return res.sendStatus(401);req.managementUser={role,identity:'cl15'};next();},requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.managementUser.role)?next():res.sendStatus(403)};
 const read={assertReadRole:()=>{},getSummary:async()=>({total:0}),listTasks:async()=>[],listJobs:async()=>[],getJob:async value=>value===id?{id}:null,getJobResults:async value=>value===id?{items:[]}:null};
 let creates=0;
 const batch={options:async()=>({markets:[],categories:[]}),preview:async()=>({total_scopes:0}),list:async()=>({items:[]}),get:async()=>({batch_id:id}),create:async()=>{creates++;return{batch_id:id};}};
 const app=express();app.use(express.json());app.use('/api/research/batches',createResearchBatchRouter({service:batch,managementAuth:auth}));app.use('/api/research',createResearchRouter({service:read,managementAuth:auth}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const request=(path,method='GET',role='MANAGEMENT')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{...(role?{'x-fixture-role':role}:{}),'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
 return{request,creates:()=>creates};
}
for(const [method,path]of[
 ['GET','/api/research/workbench-summary'],['GET','/api/research/tasks'],['GET','/api/research/jobs?view=inbox'],['GET',`/api/research/jobs/${id}`],['GET',`/api/research/jobs/${id}/results`],
 ['GET','/api/research/batches/options'],['GET','/api/research/batches'],['GET',`/api/research/batches/${id}`],['POST','/api/research/batches/preview'],['POST','/api/research/batches']
])test(`CL15 HTTP ${method} ${path}: success, unauthenticated and forbidden`,async t=>{
 const h=await setup(t);assert.equal((await h.request(path,method,null)).status,401);assert.equal((await h.request(path,method,'NONE')).status,403);assert.equal(h.creates(),0);
 assert.equal((await h.request(path,method)).status,method==='POST'&&path==='/api/research/batches'?202:200);
});
test('CL15 job detail and results reject malformed IDs and return 404 for missing records',async t=>{
 const h=await setup(t);for(const suffix of['','/results']){assert.equal((await h.request(`/api/research/jobs/bad${suffix}`)).status,400);assert.equal((await h.request(`/api/research/jobs/${missing}${suffix}`)).status,404);}
});
