const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve('artifacts/phase13-mc05/browser');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const page=await context.newPage();
 const results=[],errors=[],blocked=[],batches=new Map();let creates=0;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!=='http://127.0.0.1:3000')return route.abort();
  if(url.pathname==='/api/research/batches'&&req.method()==='POST'){
   creates++;const body=req.postDataJSON();const response=await context.request.post('http://127.0.0.1:3000/api/research/batches/preview',{data:body});assert.equal(response.status(),200);const preview=await response.json();
   const id='00000000-0000-4000-8000-000000000005';const batch={...preview,batch_id:id,id,status:'QUEUED',created_at:new Date().toISOString(),children:preview.research_scope_snapshot.scopes.map((scope,index)=>({...scope,job_id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,status:'QUEUED',reused:false}))};batches.set(id,batch);
   return route.fulfill({json:batch});
  }
  const id=url.pathname.split('/').at(-1);if(batches.has(id))return route.fulfill({json:batches.get(id)});
  if(req.method()!=='GET'&&req.method()!=='HEAD'&&url.pathname!=='/api/research/batches/preview'){blocked.push(`${req.method()} ${url.pathname}`);return route.fulfill({status:409,json:{error:'Browser verification is read-only'}});}
  return route.continue();
 });
 await page.goto('http://127.0.0.1:3000/?v=mc05-browser#research');
 await page.locator('#research-new-job-open').click();await page.locator('input[name="market_code"]').first().waitFor();await page.locator('input[name="product_category"]').first().waitFor();
 const markets=await page.locator('input[name="market_code"]').count(),categories=await page.locator('input[name="product_category"]').count();assert.ok(markets>=2);assert.ok(categories>=2);
 async function choose(name,count){const inputs=page.locator(`input[name="${name}"]`);for(let i=0;i<await inputs.count();i++)await inputs.nth(i).setChecked(i<count);}
 async function check(label,m,c){await choose('market_code',m);await choose('product_category',c);await page.waitForTimeout(450);assert.match(await page.locator('#research-selection-counts').innerText(),new RegExp(`${m} × ${c} = ${m*c}`));results.push({check:label,status:'PASS',markets:m,categories:c,scopes:m*c});}
 await check('single market + single category',1,1);await check('multi market',2,1);await check('multi category',1,2);
 await page.locator('#research-market-all').check();assert.equal(await page.locator('input[name="market_code"]:checked').count(),markets);results.push({check:'all markets',status:'PASS'});
 await page.locator('#research-category-all').check();assert.equal(await page.locator('input[name="product_category"]:checked').count(),categories);results.push({check:'all categories and all + all',status:'PASS'});
 await page.waitForTimeout(700);await page.screenshot({path:path.join(out,'desktop-selection.png')});
 await page.locator('#research-step-next').click();await page.locator('#research-step-next').click();assert.equal(await page.locator('#research-city').isDisabled(),true);await page.locator('#research-step-next').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'desktop-preview.png')});
 await page.locator('#start-research').evaluate(button=>{button.click();button.click();});await page.locator('#research-batch-detail [data-batch-child]').first().waitFor();assert.equal(creates,1);results.push({check:'Double-click creates one parent request (intercepted response; no database write)',status:'PASS'});
 await page.reload();await page.locator('#research-batch-detail [data-batch-child]').first().waitFor();results.push({check:'batch reload frozen display (intercepted response)',status:'PASS'});
 await page.locator('[data-batch-back]').click();assert.equal(await page.locator('#research-new-job-open').evaluate(el=>el===document.activeElement),true);results.push({check:'Back restores research focus',status:'PASS'});
 await page.goBack();await page.locator('#research-batch-detail [data-batch-child]').first().waitFor();await page.goForward();await page.waitForTimeout(100);assert.equal(new URL(page.url()).hash,'#research');assert.equal(await page.locator('#research-batch-detail').isHidden(),true);results.push({check:'Browser Back/Forward preserves parent route',status:'PASS'});
 await page.locator('#research-new-job-open').click();await page.waitForTimeout(500);assert.equal(await page.locator('input[name="market_code"]:checked').count(),markets);assert.equal(await page.locator('input[name="product_category"]:checked').count(),categories);results.push({check:'selection reload persists',status:'PASS'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#research-new-job-open').evaluate(el=>el===document.activeElement),true);results.push({check:'Escape restores opener focus',status:'PASS'});
 for(const [width,height] of [[1280,720],[1024,768],[768,900],[390,844],[375,667],[844,390]]){
  await page.setViewportSize({width,height});await page.locator('#research-new-job-open').click();await page.waitForTimeout(450);await page.screenshot({path:path.join(out,`selection-${width}x${height}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.push({check:`viewport ${width}x${height}`,status:'PASS'});await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#research-new-job-open').click();for(let i=0;i<3;i++)await page.locator('#research-step-next').click();await page.screenshot({path:path.join(out,'mobile-preview.png')});await page.keyboard.press('Escape');
 await page.route('**/api/research/batches/options',route=>route.fulfill({status:503,json:{error:'Fixture temporary outage'}}));await page.reload();await page.locator('#research-new-job-open').click();await page.locator('#research-options-retry').waitFor();assert.equal(await page.locator('#start-research').isDisabled(),true);results.push({check:'registry error and retry (browser-only fixture)',status:'PASS'});await page.keyboard.press('Escape');
 await page.unroute('**/api/research/batches/options');await page.route('**/api/research/batches/options',route=>route.fulfill({json:{markets:[],categories:[],buyer_types:[]}}));await page.reload();await page.locator('#research-new-job-open').click();await page.waitForTimeout(500);assert.equal(await page.locator('input[name="market_code"]').count(),0);assert.equal(await page.locator('#start-research').isDisabled(),true);results.push({check:'empty registry has no fallback options (browser-only fixture)',status:'PASS'});
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),mode:'Actual registry/preview reads; parent Create and detail responses are browser-only fixtures',results,errors,blocked,creates},null,2));assert.equal(errors.length,0);assert.equal(blocked.length,0);await browser.close();console.log(JSON.stringify({checks:results.length,errors,blocked,creates,out}));
})().catch(error=>{console.error(error);process.exit(1)});
