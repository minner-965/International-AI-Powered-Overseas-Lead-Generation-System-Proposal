const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../artifacts/phase12-ui-baseline/mail-copy-status',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
const result={startedAt:new Date().toISOString(),pages:[],mail:[],errors:[],blocked:[]};
const routes=['overview','opportunities','contact-queue','replies','research','jobs','contact-ready','companies','customer-match','evidence','data-import','data-export','settings'];
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
for(const width of [1440,1124,390,375]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin==='http://127.0.0.1:3000'&&['GET','HEAD'].includes(q.method()))return r.continue();result.blocked.push(q.method());return r.abort();});
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)result.errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);});
 for(const route of routes){
  await page.goto(`http://127.0.0.1:3000/?v=manual-mail-ui#${route}`);await page.locator(`[data-app-view="${route}"]`).waitFor({state:'visible'});await page.waitForTimeout(500);
  const m=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,badges:[...document.querySelectorAll('.data-state-badge,.p8-status')].filter(e=>e.getClientRects().length).map(e=>({radius:getComputedStyle(e).borderRadius,break:getComputedStyle(e).wordBreak,en:[...e.querySelectorAll('[lang="en"]')].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height,line:parseFloat(getComputedStyle(n).lineHeight)}))})),kickers:[...document.querySelectorAll('[data-app-view]:not([hidden]) > .crm-section-head .crm-context')].filter(e=>e.getClientRects().length).length}));
  result.pages.push({width,route,...m});await page.screenshot({path:path.join(out,`${route}-${width}.jpg`),quality:75});
  if(route==='opportunities'){
   const badge=page.locator('#opportunity-table .data-state-badge').first();
   if(await badge.count()){await badge.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`opportunity-status-${width}.jpg`),quality:75});}
  }
 }
 await page.goto('http://127.0.0.1:3000/#contact-queue');await page.waitForTimeout(800);
 const company=page.locator('.p11-outreach-row').filter({has:page.locator('[data-outreach-index]')}).first();
 if(await company.count()){
  await company.locator('[data-outreach-index]').first().click();await page.locator('#outreach-review-dialog').waitFor({state:'visible'});
  const mail={width,sendEnabled:await page.locator('#outreach-send').isEnabled(),reason:await page.locator('#outreach-send-readiness').innerText(),gateText:await page.locator('#outreach-gate-status').innerText()};result.mail.push(mail);
  await page.screenshot({path:path.join(out,`mail-review-${width}.jpg`),quality:75});
  await page.locator('#outreach-send').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`mail-actions-${width}.jpg`),quality:75});
  mail.subjectEditable=await page.locator('#outreach-subject').isEditable();
  if(mail.subjectEditable){
   await page.locator('#outreach-subject').fill((await page.locator('#outreach-subject').inputValue())+' QA unsaved');
   mail.dirtySendDisabled=await page.locator('#outreach-send').isDisabled();
   page.once('dialog',d=>d.accept());
  }
  mail.gateConsistent=mail.sendEnabled?mail.dirtySendDisabled===true:mail.reason.trim().length>0;
  await page.keyboard.press('Escape');
 }
 await context.close();
}
}finally{await browser.close();}result.finishedAt=new Date().toISOString();result.pass=!result.errors.length&&!result.blocked.length&&result.pages.every(p=>p.scroll<=p.client+1)&&result.mail.length===4&&result.mail.every(m=>m.gateConsistent);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,pass:result.pass,checks:result.pages.length,mail:result.mail,overflow:result.pages.filter(p=>p.scroll>p.client+1),errors:result.errors,blocked:result.blocked}));if(!result.pass)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
