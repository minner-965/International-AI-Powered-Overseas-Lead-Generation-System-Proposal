const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin='http://127.0.0.1:3000',root=path.resolve(__dirname,'..');
const out=path.join(root,'artifacts/phase13-mc04/ui',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});
const report={views:[],errors:[],blocked:[],failed:[],keyboard:[],fixtures:[]};
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{for(const width of (process.env.DPV_QA_WIDTHS||'375,390,768,1024,1440').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',r=>{const req=r.request();if(new URL(req.url()).origin===origin&&['GET','HEAD'].includes(req.method()))return r.continue();report.blocked.push({method:req.method(),origin:new URL(req.url()).origin});return r.abort();});
 await context.routeWebSocket('**/*',ws=>ws.close());const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failed.push({url:r.url(),status:r.status()});});
 for(const route of (process.env.DPV_QA_ROUTES||'overview,opportunities,companies,contact-ready,research,jobs,contact-queue,data-export').split(',')){
  await page.goto(origin+'/?qa=mc04#'+route);await page.locator(`[data-app-view="${route}"]`).waitFor({state:'visible'});await page.waitForTimeout(1800);
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,dimensions:[...document.querySelectorAll('.v3-opportunity-dimensions')].filter(e=>e.getClientRects().length).length,unnamed:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&!e.textContent.trim()&&!e.getAttribute('aria-label')).length}));
  await page.screenshot({path:path.join(out,`${route}-${width}.png`),fullPage:true});await page.screenshot({path:path.join(out,`${route}-${width}-viewport.png`)});report.views.push({route,width,...state});
  if(route==='companies'){
   await page.locator('.lead-select').first().click();await page.locator('#detail').waitFor({state:'visible'});await page.waitForTimeout(500);await page.screenshot({path:path.join(out,`company-detail-${width}.png`),fullPage:true});
   report.views.push({route:'company-detail',width,dimensions:await page.locator('#detail .v3-opportunity-dimensions').count()});await page.keyboard.press('Escape');report.keyboard.push({route:'company-detail',width,closed:await page.locator('#detail').isHidden(),focusRestored:await page.evaluate(()=>document.activeElement.matches('.lead-select'))});
  }
  if(route==='contact-queue'&&await page.locator('[data-outreach-index]').count()){
   await page.locator('[data-outreach-index]').first().click();await page.locator('#outreach-review-dialog').waitFor({state:'visible'});await page.waitForTimeout(500);await page.screenshot({path:path.join(out,`email-review-${width}.png`),fullPage:true});
   report.views.push({route:'email-review',width,dimensions:await page.locator('#outreach-review-dialog .v3-opportunity-dimensions').count()});await page.keyboard.press('Escape');report.keyboard.push({route:'email-review',width,closed:await page.locator('#outreach-review-dialog').isHidden(),focusRestored:await page.evaluate(()=>document.activeElement.matches('[data-outreach-index]'))});
  }
  if(route==='jobs'){
   await page.goto(origin+'/?job=632e2372-41d2-4a65-bd78-b36c9878451c#jobs');await page.waitForTimeout(1600);
   const section=page.locator('#research-job section').filter({hasText:'Company research results'});
   if(await section.count()){await section.locator('summary').filter({hasText:'View company results'}).click();await section.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`job-results-${width}.png`)});report.views.push({route:'job-results',width,dimensions:await section.locator('[data-business-opportunity]').count(),summary:await section.locator('[data-opportunity-pool-summary]').count()});}
   else report.views.push({route:'job-results',width,missing:true});
  }
 }
 await context.close();console.log(JSON.stringify({width,views:report.views.length}));
}
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',r=>{const q=r.request();return new URL(q.url()).origin===origin&&['GET','HEAD'].includes(q.method())?r.continue():r.abort();});
 let release;const hold=new Promise(resolve=>release=resolve);
 await context.route('**/api/opportunities?*',async r=>{await hold;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"QA_READ_FAILURE"}'});});
 const page=await context.newPage();await page.goto(origin+'/#opportunities');await page.waitForTimeout(500);
 await page.screenshot({path:path.join(out,'isolated-loading-390.png'),fullPage:true});report.fixtures.push({state:'loading',busy:await page.locator('[aria-busy="true"]').count()});release();await page.waitForTimeout(800);
 await page.screenshot({path:path.join(out,'isolated-error-390.png'),fullPage:true});report.fixtures.push({state:'error',retryVisible:await page.locator('[data-opportunity-retry]').isVisible()});await context.close();
}finally{await browser.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}})().catch(e=>{console.error(e);process.exitCode=1;});
