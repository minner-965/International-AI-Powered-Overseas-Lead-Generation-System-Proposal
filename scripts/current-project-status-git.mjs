import { execFileSync } from 'node:child_process';

// The recorded commit and dirty flag describe the authoring snapshot. A commit
// cannot contain its own SHA, and a clean checkout does not undo historical dirt.
export function verifyStatusGitSnapshot(root, status) {
  const git = (...args) => execFileSync('git', [
    '-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const ancestor = (older, newer) => {
    try { git('merge-base', '--is-ancestor', older, newer); return true; }
    catch (error) { if (error.status === 1) return false; throw error; }
  };
  require(/^[0-9a-f]{40}$/.test(status.commit), 'Current status commit is invalid');
  require(typeof status.dirty_at_snapshot === 'boolean', 'Current status dirty_at_snapshot must be a historical boolean');
  require(git('rev-parse', '--is-shallow-repository') === 'false',
    'Current status verification requires full Git history (checkout fetch-depth: 0)');
  try { git('cat-file', '-e', `${status.commit}^{commit}`); }
  catch { throw new Error('Current status recorded commit does not exist in Git history'); }
  const snapshotHead = git('log', '-1', '--format=%H', '--', 'docs/CURRENT_PROJECT_STATUS.md');
  require(snapshotHead.length > 0, 'Current status has no committed snapshot');
  require(ancestor(status.commit, snapshotHead), 'Current status recorded commit is not an ancestor of its snapshot');
  const implementationHead = git('log', '-1', '--format=%H', '--', '.', ':(exclude)docs/**');
  require(implementationHead.length > 0 && ancestor(implementationHead, snapshotHead),
    'Current status snapshot predates the latest implementation commit; update the status with the implementation');
  return { snapshotHead, implementationHead };
}
