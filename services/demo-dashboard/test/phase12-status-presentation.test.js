import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('status labels use one V3 rectangular component rather than legacy pills',()=>{
 const css=read('../public/ui/v3/components.css');
 assert.match(css,/\.dpv-badge, \.data-state-badge, \.p8-status/);
 assert.match(css,/border-radius: 6px/);
 assert.match(css,/word-break: normal/);
 assert.match(css,/justify-self: start/);
 assert.doesNotMatch(read('../public/phase5.css'),/\.data-state-badge\s*\{/);
 assert.doesNotMatch(read('../public/ui/phase8-components.css'),/\.data-state-badge,/);
});
test('desktop data tables keep readable status columns with local scrolling and mobile lists',()=>{
 const css=read('../public/ui/opportunity-workspace.css');
 assert.match(css,/crm-opportunity-table \{ width:100%; min-width:1180px/);
 assert.match(css,/crm-opportunity-table tbody \{ display:grid; width:100%; min-width:0/);
 assert.match(read('../public/ui/v3/companies.css'),/repeat\(auto-fit,minmax\(200px,1fr\)\)/);
});
