import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTableFingerprints} from '../../../scripts/cleanup-baseline-comparison.mjs';
const row={table:'fixture_history',rows:2,fingerprint:'fixture-hash'};
test('cleanup baseline detects removal of an entire historical table',()=>{
 assert.deepEqual(compareTableFingerprints([row],[]),{changed:[],removed_tables:['fixture_history']});
});
test('cleanup baseline accepts identical data regardless of table ordering',()=>{
 const empty={table:'fixture_empty',rows:0,fingerprint:'empty'};
 assert.deepEqual(compareTableFingerprints([row,empty],[empty,row]),{changed:[],removed_tables:[]});
});
test('cleanup baseline reports added tables and changed data',()=>{
 const changed={...row,rows:1},added={table:'new_fixture',rows:0,fingerprint:'empty'};
 assert.deepEqual(compareTableFingerprints([row],[changed,added]),{changed:[changed,added],removed_tables:[]});
});
