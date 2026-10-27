// Routes for manual companies (B1) and first-touch test sends (B2). Mounted after the workspace
// gate, so req.workspaceScope / req.workspaceUser are set; merchants reach only the paths the
// coordinator adds to MERCHANT_ROUTES (see report). Every rule is enforced in the services.
import express from 'express';
import {requestScope} from '../merchant/scope.js';
import {actorOf} from './common.js';

const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);

export function createManualCompanyRouter({companies,firstTouch,testSends}){
  const router=express.Router();
  const scope=req=>requestScope(req);

  router.get('/api/manual-companies/options',asyncRoute(async(req,res)=>res.json(await companies.options(scope(req)))));
  router.get('/api/manual-companies',asyncRoute(async(req,res)=>res.json(await companies.list(req.query,scope(req)))));
  router.post('/api/manual-companies',asyncRoute(async(req,res)=>res.status(201).json(await companies.create(req.body||{},actorOf(req),scope(req)))));
  router.get('/api/manual-companies/first-touch-drafts',asyncRoute(async(req,res)=>res.json(await firstTouch.listDrafts(req.query,scope(req)))));
  router.post('/api/manual-companies/first-touch-drafts/:id/decision',asyncRoute(async(req,res)=>res.json(await firstTouch.decide(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.get('/api/manual-companies/:id',asyncRoute(async(req,res)=>res.json(await companies.get(req.params.id,scope(req)))));
  router.post('/api/manual-companies/:id/contacts',asyncRoute(async(req,res)=>res.status(201).json(await companies.addContact(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.put('/api/manual-companies/:id/test-flag',asyncRoute(async(req,res)=>res.json(await companies.setTestFlag(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.post('/api/manual-companies/:id/assign',asyncRoute(async(req,res)=>res.json(await companies.assign(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.post('/api/manual-companies/:id/activities',asyncRoute(async(req,res)=>res.status(201).json(await companies.addActivity(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.post('/api/manual-companies/:id/stage',asyncRoute(async(req,res)=>res.json(await companies.setStage(req.params.id,req.body||{},actorOf(req),scope(req)))));
  router.post('/api/manual-companies/:id/first-touch-drafts',asyncRoute(async(req,res)=>res.status(201).json(await firstTouch.createDraft(req.params.id,req.body||{},actorOf(req),scope(req)))));

  router.get('/api/first-touch/test-sends',asyncRoute(async(req,res)=>res.json(await testSends.status(scope(req)))));
  router.post('/api/first-touch/test-sends/preview',asyncRoute(async(req,res)=>res.json(await testSends.preview(req.body||{},scope(req)))));
  router.post('/api/first-touch/test-sends',asyncRoute(async(req,res)=>res.status(201).json(await testSends.send(req.body||{},actorOf(req),scope(req)))));

  // Business errors (4xx) as JSON; template validation codes are input problems (422).
  router.use((error,req,res,next)=>{
    if(!req.path.startsWith('/api/manual-companies')&&!req.path.startsWith('/api/first-touch/'))return next(error);
    let status=Number(error?.status);
    if(!(status>=400&&status<500)&&/^FIRST_TOUCH_|^MERCHANT_/.test(String(error?.code||'')))status=error.code.startsWith('MERCHANT_')?409:422;
    if(!(status>=400&&status<500))return next(error);
    res.status(status).json({error:error.message,code:error.code,details:error.details,field:error.field});
  });
  return router;
}
