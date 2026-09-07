import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = name=>readFile(new URL(`../public/ui/v3/${name}.css`,import.meta.url),'utf8');
const declarations = (source, selector)=>{
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`,'g'))].map(match=>match[1]);
};

test('V3 page body fills shell width rather than inheriting legacy content cap',async()=>{
  const rules=declarations(await css('shell'),'.v3-main > .page-body');
  assert.equal(rules.length,1);
  assert.match(rules[0],/width:\s*100%/);
  assert.match(rules[0],/max-width:\s*none/);
});
test('topbar uses the 64px reference token with space accounted for its border',async()=>{
  const source=await css('shell');
  assert.match(source,/--dpv-topbar-height:\s*64px/);
  assert.match(declarations(source,'.v3-topbar-inner')[0],/min-height:\s*calc\(var\(--dpv-topbar-height\) - 1px\)/);
  assert.match(declarations(source,'.v3-topbar-inner')[0],/padding:\s*5px 32px/);
});
test('phone directory releases desktop table height cap and retains readable record layout',async()=>{
  const source=await css('companies');
  const phone=source.slice(source.indexOf('@media(max-width:767px)'));
  assert.match(declarations(phone,'.v3-company-directory .table-wrap')[0],/max-height:\s*none/);
  assert.match(phone,/grid-template-areas:\s*none/);
  assert.match(phone,/min-height:\s*44px/);
});
test('phone Settings labels place each select on full row with a stable 44px target',async()=>{
  const source=await css('records');
  const phone=source.slice(source.indexOf('@media (max-width:600px)'));
  assert.match(declarations(phone,'.v3-record-page .crm-settings-grid > label')[0],/grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(declarations(source,'.v3-record-page .crm-settings-grid select')[0],/height:\s*44px/);
});
test('bilingual compact mode changes only spacing while both languages inherit equal type',async()=>{
  const source=await css('foundation');
  assert.match(source,/\.bi > \[lang="zh-CN"\], \.bi > \[lang="en"\]\s*\{[^}]*font-size:\s*1em;[^}]*font-weight:\s*inherit/);
  assert.match(declarations(source,'[data-bilingual-detail="standard"] .bi')[0],/row-gap:\s*2px/);
  const compact=declarations(source,'[data-bilingual-detail="compact"] .bi')[0];
  assert.match(compact,/row-gap:\s*0/);
  assert.doesNotMatch(compact,/font-size|display:\s*none/);
});
