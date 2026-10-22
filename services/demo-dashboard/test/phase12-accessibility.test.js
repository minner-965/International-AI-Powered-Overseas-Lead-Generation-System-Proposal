import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {bindDialogTabBoundary} from '../public/ui/v3/components.js';
const read=name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8');
const [shell,app,outreach,css]=await Promise.all(['crm-shell.js','app.js','ui/outreach-workbench.js','ui/v4/app.css'].map(read));

test('desktop breakpoint releases the mobile sidebar boundary',()=>{
  let listener,closed=0;
  const line=shell.split('\n').find(line=>line.startsWith("matchMedia('(min-width: 901px)')"));
  vm.runInNewContext(line,{matchMedia:()=>({addEventListener:(_type,fn)=>listener=fn}),closeSidebar:()=>closed++});
  listener({matches:false});assert.equal(closed,0);listener({matches:true});assert.equal(closed,1);
  assert.match(shell,/removeAttribute\('inert'\)/);
});
test('Escape only dismisses its own company or verification dialog',()=>{
  const normalized=app.replace(/\r\n/g,'\n');
  const begin=normalized.indexOf("document.addEventListener('keydown',event=>{\n  if (event.key !== 'Escape')");
  const block=normalized.slice(begin,normalized.indexOf('\n});',begin)+4);
  let listener,detailCloses=0,verificationCloses=0,prevented=0;
  const detail={open:true},verification={open:true,close:()=>verificationCloses++},mail={open:true};
  vm.runInNewContext(block,{document:{addEventListener:(_event,fn)=>listener=fn},detailDialog:detail,detailCanDismiss:()=>true,closeDetail:()=>detailCloses++,$:()=>verification});
  const press=target=>listener({key:'Escape',target:{closest:()=>target},preventDefault:()=>prevented++});
  press(mail);assert.equal(detailCloses,0);assert.equal(verificationCloses,0);assert.equal(prevented,0);
  press(verification);assert.equal(verificationCloses,1);assert.equal(detailCloses,0);
  press(detail);assert.equal(detailCloses,1);
});
test('email return bypasses hidden sidebar opener and restores visible record',()=>{
  const start=outreach.indexOf('function close(){'),end=outreach.indexOf("q('outreach-review-close')",start);
  let focused=0,closed=0;
  const hidden={isConnected:true,getClientRects:()=>[],closest:()=>null,focus:()=>{throw new Error('hidden focus');}};
  const record={isConnected:true,dataset:{outreachIndex:'0'},getClientRects:()=>[{}],closest:()=>null,focus:()=>focused++};
  const context={state:{busy:false,dirty:false,opener:hidden,row:{company_id:'a'},data:{items:[{company_id:'a'}]}},dialog:{close:()=>closed++},document:{querySelectorAll:()=>[record]},window:{confirm:()=>true}};
  vm.runInNewContext(`${outreach.slice(start,end)};close();`,context);
  assert.equal(closed,1);assert.equal(focused,1);
});
test('brand mark pairs adaptive primary background and foreground',()=>{
  assert.match(css,/\.v3-brand-mark\s*\{[^}]*background: var\(--dpv-primary\); color: var\(--dpv-on-primary\)/);
});
test('shared dialog boundary wraps Tab in both directions and leaves inner navigation intact',()=>{
  let listener,focused,prevented=0;
  const control=(id,{hidden=false,disabled=false}={})=>({id,tabIndex:0,matches:()=>disabled,getClientRects:()=>hidden?[]:[{}],closest:()=>null,focus:()=>focused=id});
  const first=control('first'),middle=control('middle'),last=control('last');
  const dialog={querySelectorAll:()=>[first,control('hidden',{hidden:true}),middle,control('disabled',{disabled:true}),last]};
  const doc={activeElement:first,addEventListener:(_key,fn)=>listener=fn,removeEventListener:()=>{}};
  bindDialogTabBoundary(doc);
  const press=(shiftKey=false,extra={})=>listener({key:'Tab',shiftKey,target:{closest:()=>dialog},preventDefault:()=>prevented++,...extra});
  press(true);assert.equal(focused,'last');
  doc.activeElement=last;press();assert.equal(focused,'first');
  focused=null;doc.activeElement=middle;press();assert.equal(focused,null);
  assert.equal(prevented,2);
  doc.activeElement=last;press(false,{defaultPrevented:true});assert.equal(focused,null);
  press(false,{key:'Escape'});assert.equal(focused,null);
});
test('shared dialog boundary handles heading focus and an empty dialog without business effects',()=>{
  let listener,focused,prevented=0;
  const target={tabIndex:0,matches:()=>false,getClientRects:()=>[{}],closest:()=>null,focus:()=>focused='button'};
  let controls=[target];
  const dialog={querySelectorAll:()=>controls,hasAttribute:()=>false,setAttribute:()=>{},focus:()=>focused='dialog'};
  const doc={activeElement:{},addEventListener:(_key,fn)=>listener=fn,removeEventListener:()=>{}};
  bindDialogTabBoundary(doc);
  const event={key:'Tab',target:{closest:()=>dialog},preventDefault:()=>prevented++};
  listener(event);assert.equal(focused,'button');controls=[];listener(event);assert.equal(focused,'dialog');assert.equal(prevented,2);
});
