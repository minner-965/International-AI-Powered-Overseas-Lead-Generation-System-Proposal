import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,parseCurrentState,validateCurrentState,collectCurrentState,currentKeys,assertCurrentProjectionMatches} from './current-state.mjs';
import {verifyStatusGitSnapshot} from './current-project-status-git.mjs';
const state=parseCurrentState(readFileSync(path.join(root,'docs/CURRENT_PROJECT_STATUS.md'),'utf8'));
validateCurrentState(state);
const schema=JSON.parse(readFileSync(path.join(root,'config/runtime/current-state.schema.json'),'utf8'));
if(JSON.stringify(schema.required)!==JSON.stringify(currentKeys)||schema.additionalProperties!==false)throw new Error('Current schema mismatch');
verifyStatusGitSnapshot(root,{...state,dirty_at_snapshot:true});
if(process.argv.includes('--database')){
 const actual=collectCurrentState();
 assertCurrentProjectionMatches(state,actual);
 console.log('Current DB/runtime comparison: PASS');
}
console.log('Current project status verification: PASS');
