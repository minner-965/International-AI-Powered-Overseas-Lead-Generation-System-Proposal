// Independent browser QA only. No operational writes; no user browser profile.
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'artifacts/phase12-ui-baseline/browser-accessibility',new Date().toISOString().replace(/[:.]/g,'-'));
const origin='http://127.0.0.1:3000';
const routes=['overview','opportunities','contact-queue','replies','research','jobs','contact-ready','companies','customer-match','evidence','data-import','data-export','settings'];
const report={startedAt:new Date().toISOString(),method:'Fresh Chrome profile; native chrome://settings/appearance #zoomLevel selection. No CSS zoom, deviceScaleFactor or pinch emulation.',runs:[],blocked:[],errors:[],httpErrors:[],profiles:[]};
fs.mkdirSync(out,{recursive:true});
async function screenshot(page,filename){
 const session=await page.context().newCDPSession(page);
 try{const captured=await session.send('Page.captureScreenshot',{format:'jpeg',quality:75,fromSurface:true});fs.writeFileSync(path.join(out,filename),Buffer.from(captured.data,'base64'));}finally{await session.detach();}
}
async function metrics(page){return page.evaluate(()=>{
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const duration=s=>Math.max(0,...s.split(',').map(v=>parseFloat(v)*(v.trim().endsWith('ms')?1:1000)));
 const nodes=[...document.querySelectorAll('body *')].filter(visible);
 return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,scale:visualViewport.scale,cssZoom:getComputedStyle(document.documentElement).zoom,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,maxTransitionMs:Math.max(0,...nodes.map(e=>duration(getComputedStyle(e).transitionDuration))),maxAnimationMs:Math.max(0,...nodes.map(e=>duration(getComputedStyle(e).animationDuration))),activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length,activeView:document.querySelector('[data-app-view]:not([hidden])')?.dataset.appView};
 });}
(async()=>{
 for(const config of [{name:'native-200-1440',width:1440,height:900,zoom:2},{name:'native-200-1280',width:1280,height:720,zoom:2},{name:'reduce-desktop',width:1440,height:900,zoom:1,reduce:true},{name:'reduce-phone',width:390,height:844,zoom:1,reduce:true}]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dpv-ui14-a11y-'));report.profiles.push(profile);
  const context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:config.reduce?{width:config.width,height:config.height}:null,args:[`--window-size=${config.width},${config.height}`,'--force-device-scale-factor=1'],serviceWorkers:'block'});
  const run={config,pages:[]};report.runs.push(run);
  try{
   await context.route('**/*',route=>{const r=route.request();if(new URL(r.url()).origin===origin&&['GET','HEAD'].includes(r.method()))return route.continue();report.blocked.push({method:r.method(),origin:new URL(r.url()).origin});return route.abort();});
   await context.routeWebSocket('**/*',ws=>ws.close());
   const page=context.pages()[0];
   page.on('pageerror',e=>report.errors.push({config:config.name,message:e.message}));
   page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()});});
   await page.goto(origin+'/#overview');await page.waitForTimeout(800);run.baseline=await metrics(page);
   if(config.zoom===2){
    await page.goto('chrome://settings/appearance');
    await page.locator('#zoomLevel').selectOption({label:'200%'});
    run.chromeSetting=await page.locator('#zoomLevel').evaluate(e=>({value:e.value,label:e.selectedOptions[0].textContent.trim()}));
   }
   if(config.reduce)await page.emulateMedia({reducedMotion:'reduce'});
   for(const route of routes){
    await page.goto(origin+'/?qa=ui14-browser#'+route);
    await page.locator(`[data-app-view="${route}"]`).waitFor({state:'visible'});
    await page.waitForTimeout(850);
    const m=await metrics(page);
    const filename=config.name+'-'+route+'.jpg';await screenshot(page,filename);
    run.pages.push({route,...m,screenshot:filename,overflow:m.scrollWidth>m.clientWidth+1,zoomVerified:config.zoom!==2||(Math.abs(m.dpr/run.baseline.dpr-2)<.01&&Math.abs(m.width/run.baseline.width-.5)<.01&&m.scale===1&&m.cssZoom==='1'),motionVerified:!config.reduce||(m.reduce&&m.maxTransitionMs<=.011&&m.maxAnimationMs<=.011)});
   }
   await page.goto(origin+'/#overview');await page.waitForTimeout(500);
   await page.locator('#workspace-new-research').click();
   const dialog=page.locator('dialog[open]');await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-research-dialog-close]').first().focus();await page.keyboard.press('Shift+Tab');
   run.dialog={focusInside:await page.evaluate(()=>!!document.activeElement?.closest('dialog[open]')),geometry:await dialog.evaluate(e=>({width:e.getBoundingClientRect().width,viewport:innerWidth,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),metrics:await metrics(page)};
   await screenshot(page,config.name+'-research-dialog.jpg');
   await page.keyboard.press('Escape');run.dialog.restored=await page.evaluate(()=>document.activeElement?.id==='workspace-new-research'&&!document.querySelector('dialog[open]'));
  }finally{await context.close();}
  console.log(JSON.stringify({config:config.name,checks:run.pages.length,failures:run.pages.filter(p=>p.overflow||!p.zoomVerified||!p.motionVerified).map(p=>p.route),dialog:run.dialog}));
 }
 report.finishedAt=new Date().toISOString();report.pass=report.runs.every(r=>r.pages.every(p=>!p.overflow&&p.zoomVerified&&p.motionVerified)&&r.dialog.focusInside&&r.dialog.restored)&&!report.errors.length&&!report.httpErrors.length&&!report.blocked.length;
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,errors:report.errors,httpErrors:report.httpErrors,blocked:report.blocked}));if(!report.pass)process.exitCode=1;
})().catch(e=>{report.fatal=String(e);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
