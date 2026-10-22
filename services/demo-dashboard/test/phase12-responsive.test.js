import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cssSection, tokenCss } from './v4-css.js';
const css = async name=>cssSection(name);
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
test('topbar uses the 60px V4 height and the 50px phone title bar',async()=>{
  const source=await css('shell');
  assert.match(tokenCss(),/--dpv-topbar-height:\s*60px/);
  assert.match(declarations(source,'.top, .v3-topbar')[0],/height:\s*60px/);
  assert.match(declarations(source,'.top, .v3-topbar')[0],/padding:\s*0 28px/);
  const phone=source.slice(source.indexOf('@media (max-width: 900px)'));
  assert.match(declarations(phone,'.top, .v3-topbar')[0],/height:\s*50px/);
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
test('bilingual labels keep Chinese primary and English one size smaller, regular weight and muted',async()=>{
  const source=await css('v4-base');
  assert.match(declarations(source,'.bi > [lang="zh-CN"]')[0],/font-size:\s*1em/);
  const english=declarations(source,'.bi > [lang="en"]')[0];
  assert.match(english,/font-size:\s*\.86em/);
  assert.match(english,/font-weight:\s*400/);
  assert.match(english,/color:\s*var\(--text-3\)/);
  assert.match(english,/opacity:\s*1/);
  assert.doesNotMatch(english,/display:\s*none/);
});
