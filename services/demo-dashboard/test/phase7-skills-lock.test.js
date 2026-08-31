import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function filesUnder(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

async function directoryDigest(root) {
  const files = await filesUnder(root);
  const lines = [];
  for (const file of files.sort()) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const bytes = await fs.readFile(file);
    const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
    lines.push(`${relative}:${fileHash}`);
  }
  return crypto.createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

test('Phase 7 selected Skills stay pinned to reviewed commits and directory hashes', async () => {
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'skills.lock.json'), 'utf8'));
  assert.equal(lock.schema_version, 1);
  assert.deepEqual(
    lock.repositories.map(item => item.commit),
    [
      'e55de886fe7580ec75cdb7ded5092b33f7d4ed58',
      '828340bd8a361c4e6e0c02bddf1575f131d5d77f'
    ]
  );
  for (const repository of lock.repositories) {
    assert.equal(repository.license, 'MIT');
    assert.match(await fs.readFile(path.join(projectRoot, repository.license_path), 'utf8'), /MIT License/);
    for (const skill of repository.skills) {
      assert.match(skill.version, /^\d+\.\d+\.\d+$/);
      assert.equal(
        await directoryDigest(path.join(projectRoot, skill.path)),
        skill.directory_sha256,
        `${skill.name} vendor directory changed without a lock update`
      );
    }
  }
});
