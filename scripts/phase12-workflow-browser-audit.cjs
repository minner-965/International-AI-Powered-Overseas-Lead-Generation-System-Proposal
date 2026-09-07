// Browser UI contract fixture. All writes are intercepted; no business records are created.
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin='http://127.0.0.1:3000';
const out=path.resolve(__dirname,'../artifacts/phase12-ui-baseline/workflow-audit',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});
const report={checks:[],unexpectedWrites:[],pageErrors:[],fixturePosts:[],scope:'Browser fixture state only; actual persistence tested separately in isolated PostgreSQL.'};
const company='00000000-0000-4000-8000-000000000123',draft='00000000-0000-4000-8000-000000000124';
let row={company_id:company,company_name:'Workflow fixture',product_profile:'WOMENSWEAR',recipient_email:'recipient@example.invalid',opportunity_status:'MANAGEMENT_APPROVED',eligibility_status:'ELIGIBLE',verification_status:'VALID',draft_status:'DRAFT',draft_id:draft,subject:'Initial fixture subject',body_text:'Initial fixture message',send_allowed:false,activity:[]};
let failSave=false,failRead=false,missing=false,slow=false;
const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);};
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u.origin!==origin){report.unexpectedWrites.push('external origin blocked');return route.abort();}
  if(u.pathname==='/api/outreach/workbench')return failRead?json({error:'FIXTURE_READ_FAILED'},503):json({items:missing?[]:[row],sending_enabled:true,sending_blocked_reasons:[],template:{subject:'Fixture',body_text:'Fixture'}});
  if(!['GET','HEAD'].includes(r.method())){
   if(!u.pathname.includes(company)&&!u.pathname.includes(draft)){report.unexpectedWrites.push(r.method()+' '+u.pathname);return route.abort();}
   report.fixturePosts.push(u.pathname);
   if(slow)await new Promise(resolve=>setTimeout(resolve,350));
   if(u.pathname.endsWith('/prepare')){
    if(failSave)return json({error:'FIXTURE_SAVE_FAILED'},503);
    const body=r.postDataJSON();row={...row,subject:body.subject,body_text:body.body_text,draft_status:'DRAFT',submitted_at:null,approval_id:null,send_allowed:false};
   }else if(u.pathname.endsWith('/submit'))row={...row,draft_status:'PENDING_REVIEW',submitted_at:new Date().toISOString()};
   else if(u.pathname.endsWith('/approve'))row={...row,draft_status:'APPROVED',approval_id:draft,send_allowed:true};
   else if(u.pathname.endsWith('/reject'))row={...row,draft_status:'NEEDS_CHANGES',send_allowed:false};
   else {report.unexpectedWrites.push('unhandled '+u.pathname);return route.abort();}
   return json({draft:row});
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 const open=async()=>{await page.goto(origin+'/#contact-queue');await page.locator('[data-outreach-index]').first().click();await page.locator('#outreach-review-dialog').waitFor({state:'visible'});};
 const ready=()=>page.waitForFunction(()=>document.querySelector('#outreach-review-dialog')?.getAttribute('aria-busy')==='false');
 await open();check('unapproved draft send disabled',await page.locator('#outreach-send').isDisabled());
 await page.locator('#outreach-subject').fill('Saved fixture subject');
 await page.locator('#outreach-body').fill('Saved fixture message');
 check('dirty draft approval disabled',await page.locator('#outreach-approve').isDisabled());
 slow=true;const before=report.fixturePosts.length;
 await page.locator('#outreach-save').click();
 check('save disabled while request pending',await page.locator('#outreach-save').isDisabled());
 await ready();slow=false;
 check('single save request',report.fixturePosts.length===before+1);
 await page.reload();await page.locator('[data-outreach-index]').first().click();
 check('reload renders saved fixture subject',await page.locator('#outreach-subject').inputValue()==='Saved fixture subject');
 check('reload renders saved fixture body',await page.locator('#outreach-body').inputValue()==='Saved fixture message');
 await page.locator('#outreach-submit').click();await ready();
 check('submission enables review',await page.locator('#outreach-approve').isEnabled());
 await page.locator('#outreach-approve').click();await ready();
 check('approved fixture enables send',await page.locator('#outreach-send').isEnabled());
 await page.locator('#outreach-body').fill('Unsaved revision');
 check('editing invalidates UI send readiness',await page.locator('#outreach-send').isDisabled());
 await page.evaluate(async()=>{const sync=await import('/ui/communication-sync.js');sync.publishCommunicationChange({reason:'UPDATED'});});
 await page.waitForTimeout(350);
 check('background state refresh preserves unsaved body',await page.locator('#outreach-body').inputValue()==='Unsaved revision');
 check('background state refresh retains dirty send block',await page.locator('#outreach-send').isDisabled());
 failSave=true;await page.locator('#outreach-save').click();await ready();
 check('failed save preserves input',await page.locator('#outreach-body').inputValue()==='Unsaved revision');
 check('failed save retains send block',await page.locator('#outreach-send').isDisabled());
 check('failed save has visible feedback',(await page.locator('#outreach-review-feedback').innerText()).trim().length>0);
 failSave=false;await page.locator('#outreach-save').click();await ready();
 check('saved revision needs fresh approval',await page.locator('#outreach-send').isDisabled());
 await page.locator('#outreach-subject').fill('Discard fixture');
 page.once('dialog',d=>d.dismiss());await page.locator('#outreach-review-close').click();
 check('cancel discard keeps dialog open',await page.locator('#outreach-review-dialog').isVisible());
 page.once('dialog',d=>d.accept());await page.locator('#outreach-review-close').click();
 check('confirmed discard closes dialog',!(await page.locator('#outreach-review-dialog').isVisible()));
 await page.locator('[data-outreach-index]').first().click();
 check('discard preserves previous saved subject',await page.locator('#outreach-subject').inputValue()==='Saved fixture subject');
 row={...row,draft_status:'APPROVED',send_allowed:true};await page.locator('#outreach-review-refresh').click();await ready();
 failRead=true;await page.locator('#outreach-review-refresh').click();await ready();
 check('read failure fails send closed',await page.locator('#outreach-send').isDisabled());
 failRead=false;missing=true;await page.locator('#outreach-review-refresh').click();await ready();
 check('removed record has no enabled stale actions',!(await page.locator('#outreach-review-dialog').isVisible())||await page.locator('#outreach-send').isDisabled());
 await page.screenshot({path:path.join(out,'final-fixture.jpg')});
 check('no unexpected writes',report.unexpectedWrites.length===0);check('no unhandled browser errors',report.pageErrors.length===0);
 report.pass=true;
}catch(error){report.pass=false;report.failure=error.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}})();
