import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read-only production inspection; all SQL applications run in a newly created,
// uniquely named empty database, which is removed only if this process created it.
const root = process.env.DPV_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'database/migrations');
const hash = value => createHash('sha256').update(value).digest('hex');
const files = (await fs.readdir(migrationDir)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort();
assert.equal(files.length, 55);
assert.ok(files.every((name, i) => Number(name.slice(0, 3)) === i + 1));
const inputs = await Promise.all(files.map(async name => ({name, bytes: await fs.readFile(path.join(migrationDir, name))})));

if (process.argv.includes('--git-manifest')) {
  const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args]);
  const manifest = inputs.map(({name, bytes}) => {
    const head = git(['show', `HEAD:database/migrations/${name}`]);
    const exact = hash(head) === hash(bytes);
    const normalized = hash(head.toString('utf8').replaceAll('\r\n', '\n')) === hash(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    return {name, current_sha256: hash(bytes), git_head_sha256: hash(head), exact_match: exact, normalized_lf_match: normalized};
  });
  console.log(JSON.stringify({git_head: git(['rev-parse', 'HEAD']).toString().trim(), migration_count: files.length, all_exact_match: manifest.every(row => row.exact_match), all_normalized_match: manifest.every(row => row.normalized_lf_match), files: manifest}, null, 2));
  assert.ok(manifest.every(row => row.normalized_lf_match), 'Migration content differs from HEAD');
} else {
  const appRoot = process.env.PHASE11_APP_ROOT || path.join(root, 'services/demo-dashboard');
  const pg = createRequire(path.join(appRoot, 'package.json'))('pg');
  const {applyCategoryProcurementMigration} = await import(pathToFileURL(path.join(appRoot, 'src/categoryProcurement/migrationRunner.js')));
  const {applyPhase7Migration} = await import(pathToFileURL(path.join(appRoot, 'src/phase7/migrationRunner.js')));
  const config = {host: process.env.POSTGRES_HOST || 'postgres', port: Number(process.env.POSTGRES_PORT || 5432), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD};
  assert.ok(process.env.POSTGRES_DB && config.user && config.password, 'Database configuration is required');
  const production = new pg.Client({...config, database: process.env.POSTGRES_DB, options: '-c default_transaction_read_only=on'});
  const admin = new pg.Client({...config, database: 'postgres'});
  const dbName = `phase11_c00_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(dbName, /^phase11_c00_\d+_[a-f0-9]{12}$/);
  assert.notEqual(dbName, process.env.POSTGRES_DB);
  const report = {test_database: dbName, main_database_mode: 'READ_ONLY', started_at: new Date().toISOString(), migrations: [], replays: [], cleanup: 'NOT_CREATED'};
  let created = false;
  let pool;
  let failure;
  try {
    await production.connect();
    assert.equal((await production.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
    const ledger = (await production.query('SELECT migration_key,checksum_sha256 FROM leadgen.schema_migrations ORDER BY migration_key')).rows;
    report.production_ledger_count = ledger.length;
    report.production_ledger_files = ledger.map(row => row.migration_key);
    report.production_ledger_matches = ledger.map(row => ({name: row.migration_key, matches: inputs.some(item => item.name === row.migration_key && hash(item.bytes) === row.checksum_sha256)}));
    assert.equal(ledger.length, 32);
    assert.ok(ledger.every((row, i) => Number(row.migration_key.slice(0, 3)) === i + 24));
    assert.ok(report.production_ledger_matches.every(row => row.matches), 'Migration checksum differs from production ledger');
    await production.end();
    await admin.connect();
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount, 0);
    await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
    created = true;
    report.cleanup = 'CREATED';
    pool = new pg.Pool({...config, database: dbName, max: 2});
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, dbName);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='leadgen'")).rows[0].n, 0);
    for (const {name, bytes} of inputs) {
      const index = Number(name.slice(0, 3));
      let result;
      if (index < 24) {
        await pool.query(bytes.toString('utf8'));
        result = {migration_key: name, status: 'APPLIED_LEGACY_SQL_NO_LEDGER', checksum_sha256: hash(bytes)};
      } else {
        const apply = index === 24 ? applyCategoryProcurementMigration : applyPhase7Migration;
        result = await apply({pool, migrationPath: path.join(migrationDir, name), expectedDatabase: dbName, appliedBy: 'phase11-c00-isolated-rebuild'});
        assert.equal(result.status, 'APPLIED');
      }
      report.migrations.push(result);
    }
    const before = (await pool.query('SELECT * FROM leadgen.schema_migrations ORDER BY migration_key')).rows;
    assert.equal(before.length, 32);
    for (const index of [49, 50]) {
      const input = inputs[index - 1];
      const result = await applyPhase7Migration({pool, migrationPath: path.join(migrationDir, input.name), expectedDatabase: dbName, appliedBy: 'phase11-c00-isolated-replay'});
      assert.equal(result.status, 'SKIPPED_ALREADY_APPLIED');
      assert.equal(result.checksum_sha256, hash(input.bytes));
      report.replays.push(result);
    }
    assert.deepEqual((await pool.query('SELECT * FROM leadgen.schema_migrations ORDER BY migration_key')).rows, before);
    report.test_ledger_count = before.length;
    report.legacy_001_023_ledger_rows = before.filter(row => Number(row.migration_key.slice(0, 3)) < 24).length;
    report.replay_ledger_unchanged = true;
    report.result = 'PASS';
  } catch (error) {
    failure = error;
    report.result = 'FAIL';
    report.error = {name: error.name, message: error.message, code: error.code};
  } finally {
    if (pool) await pool.end();
    if (created) {
      assert.match(dbName, /^phase11_c00_\d+_[a-f0-9]{12}$/);
      assert.notEqual(dbName, process.env.POSTGRES_DB);
      await admin.query(`DROP DATABASE "${dbName}"`);
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount, 0);
      report.cleanup = 'DROPPED_AND_ABSENCE_VERIFIED';
    }
    await production.end().catch(() => {});
    await admin.end().catch(() => {});
    report.finished_at = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  }
  if (failure) process.exitCode = 1;
}
