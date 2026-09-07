import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('deployment isolates manual sender configuration from background worker',()=>{
 const compose=readFileSync(new URL('../../../compose.yaml',import.meta.url),'utf8');
 // Service boundaries, not nested YAML indentation.
 const section=name=>compose.slice(compose.indexOf(`  ${name}:`)).split(/\n  [a-z][a-z-]+:/)[0];
 assert.match(section('demo-dashboard'),/path: \.env\.phase12-manual-outreach/);
 assert.match(section('demo-dashboard'),/OUTREACH_MANUAL_SEND_ONLY: "true"/);
 const worker=section('outreach-worker');
 assert.doesNotMatch(worker,/\.env\.phase12-manual-outreach/);
 for(const [key,value] of [['OUTREACH_MANUAL_SEND_ONLY','true'],['OUTREACH_ENABLED','false'],['OUTREACH_SEND_SCOPE','DISABLED'],['LIVE_PROSPECT_SEND_APPROVED','false']])assert.match(worker,new RegExp(`${key}: "${value}"`));
});
