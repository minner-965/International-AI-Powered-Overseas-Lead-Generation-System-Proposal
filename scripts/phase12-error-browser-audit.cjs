// Fail initial API reads in an isolated browser; no real business writes.
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../artifacts/phase12-ui-baseline/error-audit',new Date().toISOString().replace(/[:.]/g,'-'));
const routes=['overview','opportunities','contact-queue','replies','research','jobs','contact-ready','companies','customer-match','evidence','data-import','data-export','settings'];
const result={pages:[],unexpected:[],errors:[]};
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 for(const width of [1440,375]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!=='http://127.0.0.1:3000'||!['GET','HEAD'].includes(q.method())){result.unexpected.push(q.method()+' '+u.pathname);return r.abort();}if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"AUDIT_SERVICE_UNAVAILABLE"}'});return r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  for(const route of routes){await page.goto('http://127.0.0.1:3000/#'+route);await page.locator(`[data-app-view="${route}"]`).waitFor({state:'visible'});await page.waitForTimeout(250);const info=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,text:document.querySelector('[data-app-view]:not([hidden])')?.innerText||''}));result.pages.push({route,width,...info});await page.screenshot({path:path.join(out,`${route}-${width}.jpg`)});}
  await context.close();
 }
 result.pass=!result.unexpected.length&&!result.errors.length&&result.pages.every(p=>!p.overflow&&p.text.trim().length>0);
}finally{await browser.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,pass:result.pass,checks:result.pages.length,overflow:result.pages.filter(p=>p.overflow).map(p=>({route:p.route,width:p.width})),unexpected:result.unexpected,errors:result.errors}));if(!result.pass)process.exitCode=1;}})().catch(e=>{console.error(e);process.exitCode=1;});
