// Email results and exchange rates (plan items 6 and 7), mounted under /api/crm next to the CRM router.
//   GET /email-stats?range=30d|12m
//   GET /exchange-rates[?include=totals]   the owner's rates; with include=totals also the report's converted totals
//   PUT /exchange-rates                    replace the owner's rates (sales or management)
import express from 'express';
import {createManagementAuth} from '../phase7/managementAuth.js';
import {requestScope} from '../merchant/scope.js';
import {EmailStatsService} from './emailStats.js';
import {ExchangeRateService,convertTotals} from './exchangeRates.js';

const SALES_ROLES=Object.freeze(['SALES','MANAGEMENT']);
const asyncRoute=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);

export function createCrmStatsRouter({pool,deals=null,env=process.env,managementAuth=null,emailStats=null,exchangeRates=null}){
  const router=express.Router();
  const auth=managementAuth||createManagementAuth(env);
  const read=[auth.authenticate];
  const salesWrite=[auth.authenticate,auth.requireRoles(...SALES_ROLES)];
  const stats=emailStats||new EmailStatsService({pool});
  const rates=exchangeRates||new ExchangeRateService({pool});
  const actor=req=>req.managementUser?.identity||'workspace';

  router.get('/email-stats',...read,asyncRoute(async(req,res)=>res.json(await stats.stats(requestScope(req),String(req.query.range||'30d')))));
  router.get('/exchange-rates',...read,asyncRoute(async(req,res)=>{
    const scope=requestScope(req);
    const saved=await rates.get(scope);
    if(req.query.include==='totals'&&deals){
      const report=await deals.reports(scope);
      return res.json({...saved,converted:convertTotals(report.currencies||[],saved)});
    }
    res.json(saved);
  }));
  router.put('/exchange-rates',...salesWrite,asyncRoute(async(req,res)=>res.json(await rates.save(req.body||{},actor(req),requestScope(req)))));
  return router;
}
