// Read-only visual comparison. Reference dependencies run only in a separate context.
const { chromium } = require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts/phase12-ui-baseline/reference-completion', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, {recursive:true});
const report = { runs: [], errors: [] };
const server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(root,'docs/ui/reference/dpv-workspace-reference-dashboard.html'))); });
(async()=>{
 await new Promise(resolve=>server.listen(3148,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  for(const viewport of [{width:1440,height:900},{width:1280,height:720}]) {
   for(const reference of [true,false]) {
    const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
    if(!reference) await context.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:3000'&&['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(reference?'http://127.0.0.1:3148/':'http://127.0.0.1:3000/#overview',{waitUntil:'networkidle',timeout:60000});
    await page.waitForTimeout(1000);
    const geometry=await page.evaluate((reference)=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,background:c.backgroundColor,padding:c.padding,gap:c.gap,radius:c.borderRadius};};return {viewport:{width:innerWidth,height:innerHeight},sidebar:rect('aside'),header:rect('header'),content:rect(reference?'.max-w-7xl':'.crm-content'),heading:rect(reference?'h1':'.v3-overview-heading h2'),chart:rect(reference?'#geoChart':'.v3-overview-market-chart'),metrics:rect(reference?'.grid.grid-cols-1':'.v3-overview-metrics'),analysis:rect(reference?'.grid.lg\\:grid-cols-3':'.v3-overview-analysis'),panel:rect(reference?'.lg\\:col-span-2':'.v3-overview-panel'),cssLoaded:reference?getComputedStyle(document.querySelector('aside')).width==='256px':true};},reference);
    const name=`${reference?'reference':'current'}-${viewport.width}.png`;
    await page.screenshot({path:path.join(out,name),fullPage:false});
    await page.evaluate(reference=>{if(reference){const scroller=document.querySelector('main>div');scroller.scrollTop=scroller.scrollHeight;}else window.scrollTo(0,document.documentElement.scrollHeight);},reference);
    await page.screenshot({path:path.join(out,name.replace('.png','-lower.png')),fullPage:false});
    report.runs.push({reference,viewport,geometry,errors,screenshot:name});
    await context.close();
   }
  }
 } finally {await browser.close();server.close();}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));
})().catch(e=>{server.close();console.error(e);process.exitCode=1;});
