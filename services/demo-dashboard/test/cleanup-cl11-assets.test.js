import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('CL11 all authored selectors are inventoried with runtime or reviewed dynamic ownership',()=>{
 const audit=JSON.parse(execFileSync(process.execPath,['scripts/cleanup-cl11-css-audit.mjs'],{cwd:root,maxBuffer:8*1024*1024}));
 assert.ok(audit.total>2000);assert.ok(audit.selectors.some(r=>r.file.endsWith('public/ui/v4/app.css')));
 assert.equal(audit.counts.REVIEW_REQUIRED_DYNAMIC||0,0);
 assert.ok(audit.counts.KEEP_CURRENT_DYNAMIC>0);
 assert.ok(audit.selectors.every(r=>r.selector&&r.file&&r.line));
});
test('CL11 retired table scaffold absent and detail status remains content-sized',()=>{
 const css=fs.readFileSync(new URL('../public/ui/v4/app.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/\.contact-result-table/);
 const components=fs.readFileSync(new URL('../public/ui/v4/app.css',import.meta.url),'utf8');
 assert.doesNotMatch(components,/\.dpv-(?:table|timeline|skeleton|pagination|field|panel|button)(?![\w-])/);
 const company=fs.readFileSync(new URL('../public/ui/v4/app.css',import.meta.url),'utf8');
 assert.match(company,/\.crm-detail-meta > \.data-state-badge\s*\{\s*align-self:flex-start/);
});
