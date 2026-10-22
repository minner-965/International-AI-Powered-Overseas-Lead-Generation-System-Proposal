import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
import {cssSection} from './v4-css.js';
test('status labels use one V4 rectangular component rather than legacy pills',()=>{
 const base=cssSection('v4-base');
 const rule=base.match(/\.dpv-badge, \.data-state-badge, \.p8-status, \.badge, \.pill \{([^}]*)\}/)[1];
 assert.match(rule,/border-radius: 4px/);
 assert.match(rule,/word-break: normal/);
 assert.match(rule,/justify-self: start/);
 const css=read('../public/ui/v4/app.css');
 assert.equal((css.match(/^\.dpv-badge, \.data-state-badge, \.p8-status/gm)||[]).length,1,'one base definition');
 assert.doesNotMatch(css,/(?:^|\})\s*\.data-state-badge\s*\{/m,'no second standalone badge definition');
});
test('desktop data tables keep readable status columns with local scrolling and mobile lists',()=>{
 const css=cssSection('opportunities');
 assert.match(css,/crm-opportunity-table \{ width:100%; min-width:1180px/);
 assert.match(css,/crm-opportunity-table tbody \{ display:grid; width:100%; min-width:0/);
 assert.match(cssSection('companies'),/repeat\(auto-fit,minmax\(200px,1fr\)\)/);
});
