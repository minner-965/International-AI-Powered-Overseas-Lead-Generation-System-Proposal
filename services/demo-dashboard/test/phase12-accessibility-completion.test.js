import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
test('bilingual text preserves equal opacity and accessible muted canvas pairing',()=>{
 assert.match(read('ui/v4/app.css'),/\.bi > \[lang="en"\][^{]*\{[^}]*opacity:\s*1\s*;/);
 const css=read('ui/v4/app.css');
 const color=name=>css.match(new RegExp(`--dpv-${name}:\\s*(#[a-f0-9]{6})`))[1];
 const lum=h=>h.slice(1).match(/../g).map(v=>{const c=parseInt(v,16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const a=lum(color('muted')),b=lum(color('canvas'));assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);
});
test('named pagination and grouped actions expose compatible roles',()=>{
 const html=read('index.html');
 for(const id of ['company-pagination','opportunity-pagination'])assert.match(html,new RegExp(`<nav[^>]*id="${id}"`));
 assert.match(html,/<div[^>]*id="opportunity-active-filters"[^>]*role="group"/);
 assert.match(html,/<div[^>]*class="crm-data-actions"[^>]*role="group"/);
});
test('customer profile status uses theme-aware accessible semantic colors',()=>{
 assert.match(read('ui/v4/app.css'),/\.crm-icp-profile-card \.badge\.bg-green-lt\s*\{[^}]*color: var\(--dpv-success\) !important;[^}]*background-color: var\(--dpv-success-soft\) !important;/);
});
test('semantic text and focus pairs pass light and dark minimum contrast',()=>{
 const css=read('ui/v4/app.css');
 const lum=h=>h.slice(1).match(/../g).map(v=>{const c=parseInt(v,16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 for(const block of [css.split('[data-bs-theme="dark"]')[0],css.split('[data-bs-theme="dark"]')[1]]){
  const value=name=>block.match(new RegExp(`--dpv-${name}:\\s*(#[a-f0-9]{6})`))[1];
  for(const [fg,bg,min] of [['ink','surface',4.5],['muted','canvas',4.5],['on-primary','primary',4.5],...['success','warning','danger','info'].map(s=>[s,s+'-soft',4.5]),['focus','canvas',3],['border-strong','surface',3]]){
   const a=lum(value(fg)),b=lum(value(bg));assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=min,`${fg}/${bg}`);
  }
 }
});
test('scrolling noninteractive records remain reachable by keyboard',()=>{
 const html=read('index.html');
 assert.match(html,/<div[^>]*id="enrichment-job-status"[^>]*tabindex="0"/);
 for(const name of ['Data import progress','Data export progress'])assert.match(html,new RegExp(`<ol[^>]*tabindex="0"[^>]*aria-label="[^"]*${name}"`));
 assert.match(read('ui/v3/overview.js'),/jobList\.tabIndex=0;jobList\.setAttribute\('aria-label','最近客户搜索 Recent lead searches'\)/);
});
