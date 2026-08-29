import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const script = fs.readFileSync(path.join(root,'scripts/phase5-v23-stage-extract.py'),'utf8');

test('shared staging script keeps the UNC source read-only and parses local copies only', () => {
  assert.match(script,/DPV_SHARED_FOLDER_PATH/);
  assert.match(script,/not str\(share\)\.startswith\("\\\\\\\\"\)/);
  assert.doesNotMatch(script,/ALLOWED_SHARE\s*=|Path\(r"\\\\/);
  assert.match(script,/shutil\.copy2\(source, local\)/);
  assert.match(script,/openpyxl\.load_workbook\(local, read_only=True/);
  assert.doesNotMatch(script,/openpyxl\.load_workbook\(source/);
  assert.doesNotMatch(script,/shutil\.move\(|shutil\.rmtree\(|os\.remove\(|\.unlink\(|\.rename\(/);
  assert.match(script,/source_sha256_before/);
  assert.match(script,/source_sha256_after/);
});
