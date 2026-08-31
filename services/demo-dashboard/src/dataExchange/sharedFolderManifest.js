import path from 'node:path';
import { DataExchangeContractError } from './fileContract.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function normalizeWindows(value) {
  return path.win32.normalize(String(value ?? '')).replace(/[\\/]+$/, '').toLowerCase();
}

export function isWithinAllowlistedRoot(candidate, allowlistedRoot) {
  const root = normalizeWindows(allowlistedRoot);
  const target = normalizeWindows(candidate);
  return Boolean(root && target && (target === root || target.startsWith(`${root}\\`)));
}

export function validateReadOnlyManifest(manifest, { allowlistedRoot, allowlistedStagingRoots = [] } = {}) {
  const stagingRoots = Array.isArray(allowlistedStagingRoots) ? allowlistedStagingRoots : [];
  if (!isWithinAllowlistedRoot(manifest?.sourcePath, allowlistedRoot)) {
    throw new DataExchangeContractError('SHARED_ROOT_NOT_ALLOWED', 'Shared source is outside the configured root.');
  }
  if (!manifest?.stagedPath || String(manifest.stagedPath).startsWith('\\\\')) {
    throw new DataExchangeContractError('STAGING_PATH_REQUIRED', 'Parsing is permitted only from a local staged copy.');
  }
  if (stagingRoots.length && !stagingRoots.some((root) => isWithinAllowlistedRoot(manifest?.stagedPath, root))) {
    throw new DataExchangeContractError('STAGING_ROOT_NOT_ALLOWED', 'Shared staged copy is outside the configured local allowlist.');
  }
  const counters = manifest?.sourceMutations ?? {};
  for (const key of ['modified', 'deleted', 'renamed', 'moved', 'created']) {
    if (Number(counters[key] ?? 0) !== 0) {
      throw new DataExchangeContractError('SHARED_SOURCE_MUTATED', 'Read-only shared-folder invariant was violated.', { key });
    }
  }
  const hashes = [manifest?.sourceSha256Before, manifest?.localSha256, manifest?.sourceSha256After];
  if (!hashes.every((value) => SHA256.test(String(value)))) {
    throw new DataExchangeContractError('SHARED_HASH_INVALID', 'Three valid SHA-256 values are required.');
  }
  if (new Set(hashes.map((value) => String(value).toLowerCase())).size !== 1) {
    throw new DataExchangeContractError('SHARED_SOURCE_CHANGED', 'Shared file changed while it was copied.');
  }
  if (manifest?.autoCommit === true) {
    throw new DataExchangeContractError('SHARED_AUTO_COMMIT_FORBIDDEN', 'Shared-folder discovery may not auto-commit.');
  }
  return Object.freeze({
    stagedPath: String(manifest.stagedPath),
    sourceFilename: path.win32.basename(String(manifest.sourcePath)),
    sourceSha256: String(manifest.sourceSha256Before).toLowerCase(),
    parseLocalCopyOnly: true,
    autoCommit: false,
  });
}

export function redactInternalPaths(value) {
  if (Array.isArray(value)) return value.map(redactInternalPaths);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(unc|staging|local_?path|internal_?file_?path)/i.test(key))
      .map(([key, child]) => [key, redactInternalPaths(child)]));
  }
  return value;
}
