const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const base='http://127.0.0.1:3000/?v=phase13-mc07-browser';
const out=path.resolve('artifacts/phase13-mc07/browser');fs.mkdirSync(out,{recursive:true});
const viewports=[{width:1440,height:900},{width:1280,height:720},{width:390,height:844},{width:375,height:667}];
const routes=['overview','research','jobs','contact-ready','contact-queue','companies','settings'];
const report={generated_at:new Date().toISOString(),views:[],checks:[]};
const add=(check,status='PASS',detail=null)=>report.checks.push({check,status,...(detail?{detail}:{})});

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const viewport of viewports){
   const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
   const consoleErrors=[],pageErrors=[],serverErrors=[],httpErrors=[];
   page.on('console',message=>{if(message.type()==='error'){const location=message.location();consoleErrors.push(`${message.text()} @ ${location.url||'unknown'}:${location.lineNumber??''}`);}});
   page.on('pageerror',error=>pageErrors.push(error.message));
   page.on('response',response=>{if(response.status()>=400)httpErrors.push(`${response.status()} ${response.url()}`);if(response.status()>=500)serverErrors.push(`${response.status()} ${response.url()}`);});
   for(const route of routes){
    await page.goto(`${base}#${route}`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(900);
    const state=await page.evaluate(()=>({route:location.hash.slice(1),overflow:document.documentElement.scrollWidth-innerWidth,
      automationPanels:document.querySelectorAll('[data-automation-location]').length,
      automationText:[...document.querySelectorAll('[data-automation-location]')].map(node=>node.textContent).join(' '),
      bodyText:document.body.innerText}));
    assert.equal(state.route,route);assert.ok(state.overflow<=1,`${route} overflows by ${state.overflow}px at ${viewport.width}`);
    if(['overview','research','jobs','contact-ready','settings'].includes(route)){
      assert.ok(state.automationPanels>0,`${route} has no automation status panel`);
      assert.match(state.automationText,/自动获客/);assert.match(state.automationText,/Automated Acquisition/);
    }
    assert.doesNotMatch(state.bodyText,/TAVILY_API_KEY|SMTP_PASSWORD|IMAP_PASSWORD|DPV_MANAGEMENT_API_TOKEN/);
    await page.screenshot({path:path.join(out,`${route}-${viewport.width}x${viewport.height}.png`),fullPage:false});
    report.views.push({route,viewport,overflow:state.overflow,automation_panels:state.automationPanels});
   }
   if(viewport.width===1440){
    await page.goto(`${base}#contact-queue`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1000);
    const rows=page.locator('.p11-outreach-row');assert.ok(await rows.count()>0,'auto first-touch queue is empty');
    const sentRow=rows.filter({hasText:'tradeling'});assert.equal(await sentRow.count(),1,'tradeling sent row missing or duplicated');
    assert.match(await sentRow.innerText(),/已发送，未回复|Sent, no reply yet/);
    await sentRow.locator('[data-outreach-index]').first().click();
    const dialog=page.locator('#outreach-review-dialog');await dialog.waitFor({state:'visible'});
    assert.match(await dialog.innerText(),/已发送，未回复|Sent, no reply yet/);
    await page.locator('#outreach-review-close').click();assert.equal(await dialog.isVisible(),false);
    add('Auto queue shows the accepted real-company first touch and opens its immutable mail record');
   }
   assert.deepEqual(consoleErrors,[],`console errors at ${viewport.width}; HTTP errors: ${httpErrors.join(', ')}`);assert.deepEqual(pageErrors,[],`page errors at ${viewport.width}`);
   assert.deepEqual(serverErrors,[],`HTTP 5xx at ${viewport.width}`);add(`Responsive routes ${viewport.width}×${viewport.height}`);
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();
  await page.goto(`${base}#overview`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(700);
  const api=await page.evaluate(async()=>{const [control,status,workbench,ops]=await Promise.all(['/api/automation/control','/api/automation/status','/api/outreach/workbench','/api/outreach/operations-summary'].map(url=>fetch(url).then(r=>{if(!r.ok)throw new Error(`${url}:${r.status}`);return r.json();})));return{control,status,workbench,ops};});
  assert.equal(api.control.automated_acquisition,true);assert.equal(api.control.auto_email_followup_sequence,false);assert.equal(api.control.phone_whatsapp_automation,false);
  assert.equal(api.status.state.sender_display_name,'Simon');assert.equal(api.status.state.provider_spend_mode,'NO_NEW_PAID_SPEND');
  assert.ok(api.workbench.items.filter(row=>row.automated_first_touch&&row.send_status==='PROVIDER_ACCEPTED').length>=2);
  assert.ok(api.ops.prospect.sent_no_reply>=2);add('Live API control, sent-mail workbench and operations totals are synchronized');
  await context.close();
 } finally {await browser.close();}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:'PASS',checks:report.checks.length,views:report.views.length,report:path.join(out,'report.json')},null,2));
})().catch(error=>{report.error=error.stack||error.message;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;});
