// Read-only automated accessibility evidence. No mailbox or business mutations.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const axePath = path.join(root, 'artifacts/phase12-ui-baseline/qa-tools/node_modules/axe-core/axe.min.js');
const origin = 'http://127.0.0.1:3000';
const out = path.join(root, 'artifacts/phase12-ui-baseline/contrast-completion', new Date().toISOString().replace(/[:.]/g, '-'));
const routes = process.env.DPV_QA_ROUTES?.split(',') || ['overview','opportunities','contact-queue','replies','research','jobs','contact-ready','companies','customer-match','evidence','data-import','data-export','settings'];
const report = { startedAt: new Date().toISOString(), engine: 'axe-core 4.10.3 + Chromium Accessibility.getFullAXTree', scope: 'Rendered routes and research dialog, light/dark, desktop/mobile; automated checks are not a human screen-reader test or complete WCAG certification.', runs: [], blocked: [], errors: [] };
fs.mkdirSync(out, { recursive: true });
async function audit(page, label, theme, width) {
  await page.screenshot({path:path.join(out,label+'-'+theme+'-'+width+'.png'),fullPage:true});
  await page.addScriptTag({ path: axePath });
  const results = await page.evaluate(async () => {
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','best-practice'] } });
    const compact = x => ({ id:x.id, impact:x.impact, description:x.description, helpUrl:x.helpUrl, nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary,checks:[...n.any,...n.all,...n.none].map(c=>({id:c.id,data:c.data,message:c.message}))})) });
    const contrastFollowup=[];
    for(const n of result.incomplete.find(v=>v.id==='color-contrast')?.nodes||[]){
      const el=document.querySelector(n.target[0]);if(!el)continue;
      el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const retry=await axe.run(el,{runOnly:{type:'rule',values:['color-contrast']}});
      const style=getComputedStyle(el), chain=[];
      for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);chain.push({tag:p.tagName,id:p.id,color:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity});}
      const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
      const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
      let bg=[255,255,255];for(const b of [...chain].reverse())bg=blend(rgb(b.color),bg);
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const f=lum(rgb(style.color)),b=lum(bg),ratio=(Math.max(f,b)+.05)/(Math.min(f,b)+.05);
      contrastFollowup.push({target:n.target,retryViolations:retry.violations.map(compact),retryIncomplete:retry.incomplete.map(compact),passed:retry.passes.some(p=>p.id==='color-contrast'),foreground:style.color,fontSize:style.fontSize,backgroundChain:chain,computedOpaqueTextRatio:ratio,computedRatioCaveat:chain.some(x=>x.image!=='none'||x.opacity!=='1')?'Image or ancestor opacity requires visual review':'Solid ancestor backgrounds; sibling overlap and canvas require screenshot review'});
    }
    return { violations:result.violations.map(compact), incomplete:result.incomplete.map(compact), contrastFollowup, passedRules:result.passes.length, theme:document.documentElement.dataset.bsTheme };
  });
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree'); await cdp.detach();
  const interactive = nodes.filter(n=>!n.ignored && ['button','link','textbox','combobox','checkbox','radio','tab','dialog'].includes(n.role?.value));
  const unnamed = interactive.filter(n=>!String(n.name?.value||'').trim()).map(n=>({ role:n.role.value, backendDOMNodeId:n.backendDOMNodeId }));
  const controlBoundaries=await page.evaluate(()=>{
    const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
    const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
    const bg=e=>{const stack=[];for(let p=e;p;p=p.parentElement)stack.push(getComputedStyle(p).backgroundColor);return stack.reverse().reduce((v,c)=>blend(rgb(c),v),[255,255,255]);};
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{a=lum(a);b=lum(b);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    return [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea')].filter(e=>e.getClientRects().length&&!e.disabled&&getComputedStyle(e).visibility!=='hidden').map(e=>{const s=getComputedStyle(e),outer=bg(e.parentElement),inside=bg(e),border=blend(rgb(s.borderTopColor),outer),borderRatio=parseFloat(s.borderTopWidth)>0?ratio(border,outer):0,fillRatio=ratio(inside,outer);return{id:e.id,type:e.tagName,border:s.borderTopColor,borderRatio,fillRatio,pass:Math.max(borderRatio,fillRatio)>=3};});
  });
  const entry = {label,theme,width,...results,controlBoundaries,ax:{exposedNodes:nodes.filter(n=>!n.ignored).length,interactive:interactive.length,unnamed},screenshot:label+'-'+theme+'-'+width+'.png'};
  report.runs.push(entry);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({label,theme,width,violations:results.violations.map(v=>({id:v.id,nodes:v.nodes.length})),incomplete:results.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),unnamed:unnamed.length}));
}
(async()=>{
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  for (const theme of process.env.DPV_QA_THEMES?.split(',') || ['light','dark']) for (const width of process.env.DPV_QA_WIDTHS?.split(',').map(Number) || [1440,375]) {
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
   await context.addInitScript(theme=>localStorage.setItem('dpv-theme',theme),theme);
   await context.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin===origin&&['GET','HEAD'].includes(q.method()))return r.continue();report.blocked.push({method:q.method(),origin:new URL(q.url()).origin});return r.abort();});
   await context.routeWebSocket('**/*',ws=>ws.close());
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
   for(const route of routes){await page.goto(origin+'/?qa=contrast-completion#'+route);await page.locator(`[data-app-view="${route}"]`).waitFor({state:'visible'});await page.waitForTimeout(1200);await audit(page,route,theme,width);}
   await page.locator('#workspace-new-research').click();await page.locator('dialog[open]').waitFor();await audit(page,'research-dialog',theme,width);
   for(const entry of [
    {route:'companies',opener:'.lead-select',dialog:'#detail',name:'company-dialog'},
    {route:'contact-queue',opener:'[data-outreach-index]',dialog:'#outreach-review-dialog',name:'email-dialog'},
    {route:'opportunities',opener:'#opportunity-advanced-filter-open',dialog:'#opportunity-advanced-filter-drawer',name:'filter-dialog'},
    {route:'overview',opener:'#workspace-search-open',dialog:'#workspace-search-dialog',name:'search-dialog'},
   ]){
    await page.keyboard.press('Escape');
    await page.goto(origin+'/?qa=contrast-completion#'+entry.route);await page.waitForTimeout(1000);
    await page.locator(entry.opener).first().click();await page.locator(entry.dialog).waitFor({state:'visible'});await page.waitForTimeout(350);await audit(page,entry.name,theme,width);
   }
   await context.close();
  }
 } finally {await browser.close();}
 report.finishedAt=new Date().toISOString();report.pass=report.runs.every(r=>!r.violations.length&&!r.ax.unnamed.length&&r.controlBoundaries.every(c=>c.pass)&&r.contrastFollowup.every(c=>!c.retryViolations.length))&&!report.errors.length&&!report.blocked.length;
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,runs:report.runs.length}));if(!report.pass)process.exitCode=1;
})().catch(e=>{report.fatal=String(e);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
