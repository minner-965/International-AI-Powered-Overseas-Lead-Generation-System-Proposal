import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { SharedHistoryImportService } from './sharedHistoryImportService.js';

const bundlePath = process.argv[2];
const action = process.argv[3] || 'dry-run';
if (!bundlePath || !['dry-run','commit','both'].includes(action)) {
  throw new Error('Usage: node sharedHistoryImportCli.js BUNDLE_PATH [dry-run|commit|both]');
}

const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'leadgen',
  user: process.env.POSTGRES_USER || 'leadgen',
  password: process.env.POSTGRES_PASSWORD
});
const service = new SharedHistoryImportService({ pool });

try {
  const result = {};
  if (action === 'dry-run' || action === 'both') result.dry_run = await service.dryRun(bundle);
  if (action === 'commit' || action === 'both') result.commit = await service.commit(bundle.batch_key);
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
