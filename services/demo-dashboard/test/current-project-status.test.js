import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/verify-current-project-status.mjs', import.meta.url));

test('current project status is the validated Phase 10 source of truth', async () => {
  const result = await run(process.execPath, [script], { windowsHide: true });
  assert.match(result.stdout, /Current project status verification: PASS/);
  assert.equal(result.stderr, '');
});
