import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const root=new URL('../public/',import.meta.url);
const policy=JSON.parse(await readFile(new URL('../../../config/ui/forbidden-active-copy.v1.json',import.meta.url),'utf8'));
async function sources(dir){
  const files=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
    if(entry.isDirectory())files.push(...await sources(url));
    else if(/\.(?:html|js)$/.test(entry.name))files.push(url);
  }
  return files;
}
test('CL10 all app-owned HTML/JS is free of forbidden active copy',async()=>{
  const hits=[];
  const files=await sources(root);
  assert.ok(files.length>20,'scan every frontend module');
  for(const file of files){
    const original=await readFile(file,'utf8');
    // Historical labels used solely as object lookup keys are not rendered copy.
    const source=original.replace(/<!--[^]*?-->/g,'').replace(/^\s*\/\/.*$/gm,'').replace(/(['"])(?:\\.|(?!\1)[^\r\n])*?\1\s*:/g,':');
    for(const pattern of policy.patterns)if(new RegExp(pattern,'i').test(source))hits.push(`${file.pathname}: ${pattern}`);
  }
  assert.deepEqual(hits,[]);
});
test('CL10 manual-send label is specific and safety checks remain separate',async()=>{
  const text=await readFile(new URL('ui/outreach-workbench.js',root),'utf8');
  assert.match(text,/Manual send approval required/);
  assert.match(text,/row\.opportunity_status!=='MANAGEMENT_APPROVED'/);
  assert.match(text,/row\.eligibility_status!=='ELIGIBLE'/);
  assert.match(text,/row\.draft_status!=='APPROVED'/);
  assert.match(text,/row\.send_allowed/);
  assert.match(text,/Business Opportunity/);
  assert.match(text,/Contact Readiness/);
  assert.match(text,/Email Eligibility/);
});
test('CL10 operations panel does not render internal reason narratives',async()=>{
  const text=await readFile(new URL('ui/v3/automation-control.js',root),'utf8');
  assert.doesNotMatch(text,/esc\(model\.(?:providerReason|pauseReason)\)/);
  assert.match(text,/Review search service status/);
  assert.match(text,/model\.paused/);
  assert.match(text,/Available capacity/);
});
