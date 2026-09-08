import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyStatusGitSnapshot } from '../../../scripts/current-project-status-git.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'status-git-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Status fixture');
  mkdirSync(join(root, 'docs'));
  const write = (path, content) => writeFileSync(join(root, path), content);
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  write('implementation.js', 'export const value = 1;\n');
  const baseline = commit();
  const status = { commit: baseline, dirty_at_snapshot: true };
  const receipt = () => write('docs/CURRENT_PROJECT_STATUS.md', JSON.stringify(status));
  return { root, git, write, commit, baseline, status, receipt };
}

test('implementation and historical dirty snapshot commit together and pass clean checkout', t => {
  const f = fixture(t);
  f.write('implementation.js', 'export const value = 2;\n'); f.receipt();
  const head = f.commit();
  assert.equal(f.git('status', '--porcelain'), '');
  assert.deepEqual(verifyStatusGitSnapshot(f.root, f.status), { snapshotHead: head, implementationHead: head });
});

test('later implementation requires a new receipt; unrelated docs do not count', t => {
  const f = fixture(t); f.receipt(); f.commit();
  f.write('implementation.js', 'export const value = 3;\n'); f.commit();
  f.write('docs/other.md', 'unrelated'); f.commit();
  assert.throws(() => verifyStatusGitSnapshot(f.root, f.status), /predates/);
  f.status.commit = f.git('rev-parse', 'HEAD'); f.receipt(); f.commit();
  assert.doesNotThrow(() => verifyStatusGitSnapshot(f.root, f.status));
});

test('recorded commit must exist and belong to snapshot history', t => {
  const f = fixture(t); f.receipt(); f.commit();
  assert.throws(() => verifyStatusGitSnapshot(f.root, { ...f.status, commit: '0'.repeat(40) }), /does not exist/);
  f.git('checkout', '-b', 'other', f.baseline);
  f.write('other.js', 'other'); const other = f.commit();
  f.git('checkout', 'main');
  assert.throws(() => verifyStatusGitSnapshot(f.root, { ...f.status, commit: other }), /not an ancestor/);
});

test('historical dirty flag is typed, independent of current worktree', t => {
  const f = fixture(t); f.status.dirty_at_snapshot = false; f.receipt(); f.commit();
  f.write('scratch.txt', 'local scratch');
  assert.doesNotThrow(() => verifyStatusGitSnapshot(f.root, f.status));
  assert.throws(() => verifyStatusGitSnapshot(f.root, { ...f.status, dirty_at_snapshot: 'false' }), /boolean/);
});

test('shallow clone fails with actionable history instruction', t => {
  const f = fixture(t); f.receipt(); f.commit();
  const cloneParent = mkdtempSync(join(tmpdir(), 'status-shallow-test-'));
  t.after(() => rmSync(cloneParent, { recursive: true, force: true }));
  const clone = join(cloneParent, 'repo');
  execFileSync('git', ['clone', '--depth=1', pathToFileURL(f.root).href, clone], { stdio: 'pipe' });
  assert.throws(() => verifyStatusGitSnapshot(clone, f.status), /fetch-depth: 0/);
});
