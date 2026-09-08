// Isolated static UI + intercepted fixtures. No production API or external request.
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const express=require('../services/demo-dashboard/node_modules/express');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-artifacts/cleanup-cl03/browser');
const bands=['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'];
const fixtures=bands.map((band,i)=>({id:`fixture-${i}`,company_id:`fixture-${i}`,company_name:`Fixture Company ${i+1}`,country_code:'AE',
  verification_status:'VERIFIED',lifecycle_status:'ACTIVE',product_profile:'WOMENSWEAR',product_profiles:['WOMENSWEAR'],
  opportunity_pool_band:band,display_opportunity_status:band,is_active_business_opportunity:i<3,active_opportunity_pool:i<3,
  contact_readiness_labels:['NO_CONTACT_FOUND'],email_send_eligibility:{status:'BLOCKED',send_authorized:false},
  matched_scopes:['TOPS'],review_flags:[],opportunity_pool_profile_results:[],category_procurement_match_score:70,
  category_procurement_match_status:'CATEGORY_MATCH_CONFIRMED',first_contact_pending:true}));
const report={mode:'INTERCEPTED_FIXTURES_NO_PRODUCTION',views:[],errors:[],requests:[],blocked:[],asset_errors:[],console_errors:[]};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const app=express();
 app.use('/vendor/tabler',express.static(path.join(root,'services/demo-dashboard/node_modules/@tabler/core/dist')));
 app.use('/vendor/tabler-icons',express.static(path.join(root,'services/demo-dashboard/node_modules/@tabler/icons-webfont/dist')));
 app.use(express.static(path.join(root,'services/demo-dashboard/public')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const width of [1440,390,375]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
   let scenario='success';
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==origin||!['GET','HEAD'].includes(req.method())){report.blocked.push(req.method()+' '+url.pathname);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    report.requests.push(url.pathname+url.search);
    let body=[];
    if(url.pathname==='/api/opportunities'){
     if(scenario==='error')return route.fulfill({status:503,json:{error:'Fixture unavailable'}});
     const status=url.searchParams.get('status')||'ACTIVE';
     body=scenario==='empty'?[]:fixtures.filter(r=>status==='ALL'||status==='ACTIVE'&&r.is_active_business_opportunity||r.opportunity_pool_band===status);
    }else if(url.pathname==='/api/outreach/workbench')body={items:[],sending_enabled:false,sending_blocked_reasons:[]};
    else if(url.pathname==='/api/leads')body=fixtures;
    else if(url.pathname==='/api/metrics')body={total:5,verified:5};
    else if(url.pathname.includes('summary'))body={items:[],total:0,prospect:{},opportunity_pool:{active:3}};
    else if(url.pathname==='/api/research/jobs')body={items:[],total:0};
    else if(url.pathname.includes('/automation/'))body={state:{},items:[]};
    return route.fulfill({status:200,json:body});
   });
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
   page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.startsWith('/api/'))report.asset_errors.push(r.status()+' '+new URL(r.url()).pathname);});
   page.on('console',m=>{if(m.type()==='error'&&scenario!=='error')report.console_errors.push(m.text());});
   await page.goto(origin+'/#opportunities');
   await page.locator('#opportunity-table tr').first().waitFor();
   await page.waitForTimeout(300);
   for(const value of ['ALL',...bands,'ACTIVE']){
    await page.selectOption('#opportunity-status',value);
    await page.waitForTimeout(180);
    const host=value==='EXPLORATORY'?'#evidence-required-list':'#opportunity-table';
    assert.equal(await page.locator(host).isVisible(),true);
    const text=await page.locator(host).innerText();
    const expected=value==='ALL'?5:value==='ACTIVE'?3:1;
    assert.equal((text.match(/Fixture Company/g)||[]).length,expected,`${width}:${value}`);
   }
   assert.equal(await page.locator('[name="product_access_matrix"],[name="cooperation_matrix"],[name="readiness"]').count(),0);
   await page.locator('#opportunity-advanced-filter-open').click();
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#opportunity-advanced-filter-open').evaluate(el=>document.activeElement===el),true);
   await page.evaluate(()=>{location.hash='overview';});await page.waitForTimeout(120);await page.goBack();await page.waitForTimeout(120);
   assert.equal(await page.evaluate(()=>location.hash),'#opportunities');
   await page.reload();await page.locator('#opportunity-table tr').first().waitFor();await page.waitForTimeout(200);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);
   await page.screenshot({path:path.join(out,`opportunities-${width}.png`)});
   report.views.push({width,scenario:'success',overflow,band_filters:7,back_focus_reload:'PASS'});
   for(const mode of ['empty','error']){
    scenario=mode;await page.reload();await page.waitForTimeout(450);
    const text=await page.locator('#opportunity-table').innerText();
    assert.doesNotMatch(text,/Fixture Company/);assert.ok(text.trim().length>0);
    await page.screenshot({path:path.join(out,`opportunities-${mode}-${width}.png`)});
    report.views.push({width,scenario:mode,text_present:true});
   }
   await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);assert.deepEqual(report.asset_errors,[]);assert.deepEqual(report.console_errors,[]);report.status='PASS';
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({status:report.status,views:report.views.length,errors:report.errors,blocked:report.blocked,out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
