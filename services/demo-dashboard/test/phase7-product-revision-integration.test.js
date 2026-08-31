import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Phase 7 product consumers overlay the latest approved revision without changing product_master.id', () => {
  const taxonomy = read('src/productMatch/ProductTaxonomyService.js');
  const catalog = read('src/categoryProcurement/catalogSnapshot.js');
  const procurement = read('src/categoryProcurement/CategoryProcurementService.js');
  for (const source of [taxonomy, catalog, procurement]) {
    assert.match(source, /product_master_current_revisions/);
    assert.match(source, /rev\.product_master_id=pm\.id/);
  }
  assert.match(taxonomy, /pm\.id/);
  assert.match(catalog, /pm\.id product_master_id/);
  assert.match(procurement, /pm\.id product_master_id/);
  assert.match(catalog, /rev\.catalog_status='INACTIVE'.*'EXCLUDED'/s);
  assert.match(procurement, /rev\.catalog_status='INACTIVE'.*'EXCLUDED'/s);
});
