import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSharedHistoryBundle } from '../services/demo-dashboard/src/referenceData/sharedHistoryBundle.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const stagingDir = path.resolve(process.argv[2] || path.join(repoRoot, 'data', 'staging', 'phase5-v2.3-mx-history-001'));
const readJson = async name => JSON.parse(await readFile(path.join(stagingDir, name), 'utf8'));

const [manifest, parsedWorkbooks, safety, extractionSummary] = await Promise.all([
  readJson('staging-manifest.json'),
  readJson('parsed-workbooks.json'),
  readJson('source-safety-result.json'),
  readJson('summary.json')
]);

const bundle = buildSharedHistoryBundle({
  batchKey: extractionSummary.batch_key || 'phase5-v2.3-mx-history-001',
  manifest,
  parsedWorkbooks,
  safety: safety.safety || safety
});
const outputPath = path.join(stagingDir, 'normalized-import-bundle.json');
const summaryPath = path.join(stagingDir, 'dry-run-summary.json');
const warningsByCode = {};
for (const warning of bundle.warnings) warningsByCode[warning.code] = (warningsByCode[warning.code] || 0) + 1;
await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
await writeFile(summaryPath, `${JSON.stringify({
  batch_key: bundle.batch_key,
  dry_run_passed: bundle.dry_run_passed,
  summary: bundle.summary,
  safety: bundle.safety,
  errors: bundle.errors,
  warnings_by_code: warningsByCode
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ output: outputPath, dry_run_passed: bundle.dry_run_passed, ...bundle.summary }));
if (!bundle.dry_run_passed) process.exitCode = 2;
