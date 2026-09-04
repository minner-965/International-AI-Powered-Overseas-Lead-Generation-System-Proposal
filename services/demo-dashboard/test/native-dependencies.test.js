import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('native smoke check imports, evaluates and disposes GoRules without file-size assumptions', async () => {
  const [script,packageJson,workflow,dockerfile] = await Promise.all([
    readFile(new URL('../scripts/check-native-dependencies.mjs',import.meta.url),'utf8'),
    readFile(new URL('../package.json',import.meta.url),'utf8').then(JSON.parse),
    readFile(new URL('../../../.github/workflows/native-and-test.yml',import.meta.url),'utf8'),
    readFile(new URL('../Dockerfile',import.meta.url),'utf8')
  ]);
  assert.equal(packageJson.scripts['test:native-smoke'],'node scripts/check-native-dependencies.mjs');
  assert.match(script,/import\('@gorules\/zen-engine'\)/);
  assert.match(script,/new nativeModule\.ZenEngine\(\)/);
  assert.match(script,/createDecision/);
  assert.match(script,/decision\.evaluate\(\{ left: 19, right: 23 \}/);
  assert.match(script,/response\?\.result\?\.total !== 42/);
  assert.match(script,/engine\?\.dispose\(\)/);
  assert.doesNotMatch(script,/26\.3|statSync|fileSize|sizeBytes/);
  assert.match(workflow,/working-directory: services\/demo-dashboard/);
  assert.match(workflow,/cache: npm/);
  assert.match(workflow,/cache-dependency-path: services\/demo-dashboard\/package-lock\.json/);
  assert.match(workflow,/run: npm ci/);
  assert.match(workflow,/run: npm run test:native-smoke/);
  assert.match(workflow,/run: npm test/);
  assert.doesNotMatch(workflow,/node_modules/);
  assert.match(dockerfile,/COPY services\/demo-dashboard\/scripts \.\/scripts/);
});
