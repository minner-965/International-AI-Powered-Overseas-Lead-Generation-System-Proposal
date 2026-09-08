// Static local application with fully intercepted API fixtures; no production services.
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const express=require('../services/demo-dashboard/node_modules/express');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-artifacts/cleanup-cl10/browser');
const routes=['overview','opportunities','research','jobs','companies','contact-ready','contact-queue','replies','evidence','customer-match','data-import','data-export','settings'];
const company='00000000-0000-4000-8000-000000000123';
const lead={id:company,company_id:company,company_name:'Workspace fixture',name:'Workspace fixture',country:'United Arab Emirates',country_code:'AE',verification_status:'VERIFIED',lifecycle_status:'ACTIVE',product_profile:'WOMENSWEAR',product_profiles:['WOMENSWEAR'],opportunity_pool_band:'PRECISION',display_opportunity_status:'PRECISION',is_active_business_opportunity:true,active_opportunity_pool:true,contact_readiness_labels:['EMAIL_READY'],email_send_eligibility:{status:'BLOCKED',send_authorized:false},matched_scopes:['TOPS'],review_flags:[],contacts:[],sources:[],score:77,tier:'A',category_procurement_match_score:70};
const mail={...lead,recipient_email:'fixture@example.invalid',draft_id:company,subject:'Category cooperation',body_text:'Fixture message for visual verification.',draft_status:'APPROVED',send_allowed:false,message_id:company,business_contact_status:'REPLIED',contact_progress_status:'REPLIED',last_reply_at:'2026-09-08T09:00:00Z',last_contact_at:'2026-09-07T09:00:00Z',owner:'Sales',next_action:'FOLLOW_UP_REQUIRED',activity:[],crm_sync:'SYNCED'};
const report={mode:'INTERCEPTED_FIXTURES_ONLY',views:[],dialogs:[],page_errors:[],asset_errors:[],unexpected_requests:[],lexical:[],console_errors:[]};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const app=express();
 app.use('/vendor/tabler',express.static(path.join(root,'services/demo-dashboard/node_modules/@tabler/core/dist')));
 app.use('/vendor/tabler-icons',express.static(path.join(root,'services/demo-dashboard/node_modules/@tabler/icons-webfont/dist')));
 app.use(express.static(path.join(root,'services/demo-dashboard/public')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:375,height:667},{width:1280,height:720},{width:1024,height:768},{width:768,height:900},{width:844,height:390}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});let scenario='success';
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==origin||!['GET','HEAD'].includes(req.method())){report.unexpected_requests.push(req.method()+' '+u.pathname);return route.abort();}
   if(!u.pathname.startsWith('/api/'))return route.continue();
   if(scenario==='error')return route.fulfill({status:503,json:{error:'Fixture unavailable'}});
   if(scenario==='loading')await new Promise(r=>setTimeout(r,350));
   const items=scenario==='empty'?[]:[lead];let body=[];
   if(u.pathname==='/api/leads'||u.pathname==='/api/opportunities')body=items;
   else if(u.pathname===`/api/leads/${company}`)body={...lead,company:lead,contacts:[],sources:[]};
   else if(u.pathname==='/api/outreach/workbench')body={items:scenario==='empty'?[]:[mail],sending_enabled:false,sending_blocked_reasons:['ADMIN_CONFIGURATION_REQUIRED']};
   else if(u.pathname==='/api/workspace/contact-queue')body={items,total:items.length};
   else if(u.pathname==='/api/outreach/inbox')body={items:[{company_id:company,thread_id:company,correlation_status:'MATCHED',subject_sanitized:'Product catalogue',body_text_sanitized:'Please send the catalogue.',intent:'CATALOGUE',review_status:'AUTO_CLASSIFIED',received_at:'2026-09-08T09:00:00Z'}]};
   else if(u.pathname==='/api/metrics')body={total:items.length,verified:items.length};
   else if(u.pathname.includes('summary'))body={items:[],total:0,prospect:{sent_no_reply:0,replied:scenario==='empty'?0:1},opportunity_pool:{active:items.length}};
   else if(u.pathname==='/api/research/jobs'||u.pathname==='/api/research/tasks'||u.pathname==='/api/research/batches')body={items:[],total:0};
   else if(u.pathname==='/api/research/batches/options')body={markets:[],categories:[]};
   else if(u.pathname.includes('/automation/'))body={state:{},items:[],automated_acquisition:false};
   return route.fulfill({status:200,json:body});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.page_errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&scenario==='success')report.console_errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.startsWith('/api/'))report.asset_errors.push(r.status()+' '+new URL(r.url()).pathname);});
  for(const mode of ([1440,390,375].includes(viewport.width)?['success','empty','error']:['success'])){
   scenario=mode;
   for(const view of routes){
    await page.goto(origin+'/#'+view);await page.waitForTimeout(400);
    assert.equal(await page.locator(`[data-app-view="${view}"]`).isVisible(),true,view);
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,text:document.body.innerText}));
    const matches=state.text.match(/\b(?:AI|smart|intelligent|robot|wand|sparkle)\b|智能|AI建议|AI推荐|模型认为|系统认为|建议您/gi)||[];
    if(matches.length)report.lexical.push({view,mode,matches});
    assert.ok(state.overflow<=1,`${view}/${mode}/${viewport.width} overflow ${state.overflow}`);
    await page.screenshot({path:path.join(out,`${view}-${mode}-${viewport.width}-viewport.png`)});
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(100);
    if(view==='overview'&&mode==='success')await page.screenshot({path:path.join(out,`overview-lower-${viewport.width}.png`)});
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);
    await page.screenshot({path:path.join(out,`${view}-${mode}-${viewport.width}.png`),fullPage:true});
    report.views.push({view,mode,width:viewport.width,overflow:state.overflow});
   }
  }
  scenario='loading';await page.goto(origin+'/#replies',{waitUntil:'domcontentloaded'});await page.waitForTimeout(60);await page.screenshot({path:path.join(out,`loading-${viewport.width}.png`)});await page.waitForTimeout(500);
  scenario='success';await page.goto(origin+'/#replies');await page.locator('.v3-reply-row').first().waitFor();
  await page.locator('.v3-reply-row details').first().locator('summary').click();await page.locator('.v3-inbox-disclosure summary').first().click();await page.locator('.v3-inbox-message').waitFor();
  await page.screenshot({path:path.join(out,`sales-actions-inbox-${viewport.width}.png`),fullPage:true});report.dialogs.push({name:'sales-actions-inbox',width:viewport.width,expanded:true});
  await page.goto(origin+'/#contact-queue');await page.locator('[data-outreach-index]').first().click();
  await page.locator('#outreach-review-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#outreach-send').isDisabled(),true);
  await page.screenshot({path:path.join(out,`email-detail-${viewport.width}.png`)});
  await page.locator('#outreach-review-close').click();report.dialogs.push({name:'email',width:viewport.width,closed:!await page.locator('#outreach-review-dialog').isVisible()});
  await page.goto(origin+'/#companies');await page.waitForTimeout(250);
  const opener=page.locator('[data-company-id],[data-id]').filter({visible:true}).first();
  if(await opener.count()){await opener.click();await page.waitForTimeout(400);if(await page.locator('#detail').isVisible()){await page.screenshot({path:path.join(out,`company-detail-${viewport.width}.png`)});await page.keyboard.press('Escape');report.dialogs.push({name:'company',width:viewport.width,closed:!await page.locator('#detail').isVisible()});}}
  await page.goto(origin+'/#opportunities');await page.locator('#opportunity-advanced-filter-open').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#opportunity-advanced-filter-open').evaluate(el=>document.activeElement===el),true);
  await page.evaluate(()=>{location.hash='overview';});await page.waitForTimeout(100);await page.goBack();assert.equal(await page.evaluate(()=>location.hash),'#opportunities');await page.reload();
  report.dialogs.push({name:'filters',width:viewport.width,focus_back_reload:true});
  await context.close();
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.asset_errors,[]);assert.deepEqual(report.unexpected_requests,[]);assert.deepEqual(report.lexical,[]);assert.deepEqual(report.console_errors,[]);report.status='PASS';
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({status:report.status,views:report.views.length,dialogs:report.dialogs,out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
