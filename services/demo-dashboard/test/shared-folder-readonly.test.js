import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '..', '..', '..');
const scriptPath = path.join(projectRoot, 'scripts', 'shared-folder-readonly-inventory.ps1');
const script = readFileSync(scriptPath, 'utf8');
const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');

test('shared-folder inventory script exposes only read operations against the UNC source', () => {
  assert.match(script, /Test-Path\s+-LiteralPath\s+\$SharePath/);
  assert.match(script, /Get-Item\s+-LiteralPath\s+\$SharePath/);
  assert.match(script, /Get-ChildItem\s+-LiteralPath\s+\$share\.FullName/);
  assert.match(script, /\[Parameter\(Mandatory\)\]/);
  assert.match(script, /\[ValidatePattern\('\^\\\\\\\\'\)\]/);
  assert.doesNotMatch(script, /ValidateSet\(|\$SharePath\s*=/);

  const forbiddenOperations = [
    'Set-Content', 'Add-Content', 'Out-File', 'Export-Csv', 'New-Item',
    'Remove-Item', 'Rename-Item', 'Move-Item', 'Copy-Item', 'Set-Acl',
    'icacls', 'takeown', 'New-PSDrive', 'net use'
  ];
  for (const operation of forbiddenOperations) {
    assert.equal(
      new RegExp(`\\b${operation.replace(' ', '\\s+')}\\b`, 'i').test(script),
      false,
      `${operation} must not be present in the shared-folder scanner`
    );
  }
});

test('shared-folder staging and reports remain outside the Git handoff', () => {
  assert.match(gitignore, /^artifacts\/shared-folder-staging\/$/m);
  assert.match(gitignore, /^artifacts\/okki-staging\/$/m);
  assert.match(gitignore, /^data\/staging\/$/m);
  assert.match(gitignore, /^\*\.dump$/m);
});
