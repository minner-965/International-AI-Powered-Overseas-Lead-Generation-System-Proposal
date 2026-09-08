const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve('artifacts/phase13-mc06/browser');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage();
 const checks=[],errors=[],blocked=[],remote=[],failedResponses=[];let preview,previewMode='normal';const id='00000000-0000-4000-8000-000000000006';
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400&&!(response.url().endsWith('/api/research/batches/preview')&&response.status()===503))failedResponses.push({url:new URL(response.url()).pathname,status:response.status()});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!=='http://127.0.0.1:3000'){remote.push(url.hostname);return route.abort();}
  if(url.pathname===`/api/research/batches/${id}`)return route.fulfill({json:{...preview,id,batch_id:id,status:'QUEUED',created_at:'2026-09-08T00:00:00Z',children:[]}});
  if(url.pathname==='/api/research/batches/preview'){
   if(previewMode==='error'){previewMode='normal';return route.fulfill({status:503,json:{error:'Browser-only temporary planning outage'}});}
   if(previewMode==='loading'){previewMode='normal';await new Promise(resolve=>setTimeout(resolve,1000));}
   const response=await route.fetch();preview=await response.json();return route.fulfill({response,json:preview});
  }
  if(!['GET','HEAD'].includes(request.method())){blocked.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:409,json:{error:'Read-only browser verification'}});}
  return route.continue();
 });
 await page.goto('http://127.0.0.1:3000/?v=mc06-browser#research');await page.locator('#research-new-job-open').click();await page.locator('input[name="market_code"]').first().waitFor();await page.locator('#research-market-all').check();await page.locator('#research-category-all').check();await page.waitForTimeout(700);
 for(let index=0;index<3;index++)await page.locator('#research-step-next').click();await page.locator('#research-search-plan .v3-search-plan-header').waitFor();
 assert.equal(preview.search_plan.status,'PLANNED');assert.equal(preview.search_plan.summary.scopes,26);assert.ok(preview.search_plan.summary.precision_planned>0);assert.ok(preview.search_plan.summary.coverage_planned>0);checks.push({check:'Actual frozen-scope preview, both lanes and version',status:'PASS',summary:preview.search_plan.summary,version:preview.search_plan.strategy_version});
 for(const [width,height] of [[1440,900],[1280,720],[1024,768],[768,900],[390,844],[375,667],[844,390]]){
  await page.setViewportSize({width,height});const plan=page.locator('#research-search-plan');await plan.scrollIntoViewIfNeeded();await page.waitForTimeout(120);await page.screenshot({path:path.join(out,`plan-${width}x${height}.png`)});
  const details=plan.locator('.v3-search-samples');if(!(await details.evaluate(node=>node.open)))await details.locator('summary').click();
  for(const lane of ['PRECISION_LANE','COVERAGE_LANE'])assert.ok(await plan.locator(`[data-search-lane="${lane}"] li`).count()<=5);
  await details.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`samples-${width}x${height}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await details.locator('summary').click();checks.push({check:`Search Plan and <=5 samples per lane ${width}x${height}`,status:'PASS'});
 }
 await page.setViewportSize({width:1440,height:900});await page.keyboard.press('Escape');assert.equal(await page.locator('#research-new-job-open').evaluate(node=>node===document.activeElement),true);checks.push({check:'Escape restores opener focus',status:'PASS'});
 // Parent detail is a browser-only fixture carrying the actual read-only plan; no production batch is created.
 await page.goto(`http://127.0.0.1:3000/?batch=${id}#jobs`);await page.locator('#batch-search-plan .v3-search-plan-header').waitFor();assert.match(await page.locator('#batch-search-plan').innerText(),/Planned/);assert.doesNotMatch(await page.locator('#batch-search-plan').innerText(),/Executed/);await page.locator('#batch-search-plan').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'batch-planned.png')});checks.push({check:'Batch detail planned values (browser-only parent, actual plan)',status:'PASS'});
 await page.locator('[data-batch-back]').click();await page.goBack();await page.locator('#batch-search-plan').waitFor();await page.goForward();await page.waitForTimeout(150);assert.equal(await page.locator('#research-new-job-open').isVisible(),true);checks.push({check:'Back/Forward restores current view',status:'PASS'});
 await page.locator('#research-new-job-open').click();await page.waitForTimeout(500);for(let index=0;index<3;index++)await page.locator('#research-step-next').click();
 previewMode='loading';await page.locator('#research-step-back').click();await page.locator('#research-limit').fill('6');await page.locator('#research-limit').press('Tab');await page.locator('#research-step-next').click();await page.waitForTimeout(200);assert.equal(await page.locator('#research-search-plan').getAttribute('aria-busy'),'true');await page.waitForTimeout(1300);checks.push({check:'Loading state preserves planned semantics',status:'PASS'});
 previewMode='error';await page.locator('#research-step-back').click();await page.locator('#research-limit').fill('7');await page.locator('#research-limit').press('Tab');await page.locator('#research-step-next').click();await page.locator('[data-search-plan-retry]').waitFor();assert.equal(await page.locator('#start-research').isDisabled(),true);await page.locator('[data-search-plan-retry]').click();await page.locator('#research-search-plan .v3-search-plan-header').waitFor();checks.push({check:'Planning error and explicit retry (browser-only outage)',status:'PASS'});
 await page.setViewportSize({width:720,height:450});await page.locator('#research-search-plan .v3-search-samples>summary').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'reflow-200-equivalent.png')});checks.push({check:'200% equivalent layout reflow (1440×900 → 720×450 CSS viewport)',status:'PASS'});
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});assert.equal(await page.evaluate(()=>visualViewport.scale),2);await page.screenshot({path:path.join(out,'native-page-zoom-200.png')});await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});checks.push({check:'Native 200% visual page zoom (CDP; not desktop browser-menu zoom)',status:'PASS'});
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),mode:'Actual registry and read-only plan preview; parent detail and error/loading timing use browser-only fixtures',checks,errors,blocked,remote,failedResponses},null,2));assert.equal(errors.length,0);assert.equal(blocked.length,0);assert.equal(remote.length,0);assert.equal(failedResponses.length,0);await browser.close();console.log(JSON.stringify({checks:checks.length,errors,blocked,failedResponses,out}));
})().catch(error=>{console.error(error);process.exit(1)});
