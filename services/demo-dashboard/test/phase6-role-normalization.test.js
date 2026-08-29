import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDecisionRole,
  normalizedIdentity,
  productRoleRelevance,
  roleRelevance
} from '../src/enrichment/roleNormalizer.js';

const englishCases = new Map([
  ['Senior Womenswear Buyer','SENIOR_BUYER'],
  ['Head Buyer','HEAD_OF_BUYING'],
  ['Head of Buying','HEAD_OF_BUYING'],
  ['Purchasing Manager','PURCHASING'],
  ['Head of Procurement','PROCUREMENT'],
  ['Category Director','CATEGORY_MANAGEMENT'],
  ['Head of Merchandising','MERCHANDISING'],
  ['Sourcing Director','SOURCING'],
  ['Import Manager','IMPORT'],
  ['Commercial Director','COMMERCIAL']
]);
for (const [raw, expected] of englishCases) {
  test(`AE English role: ${raw}`, () => assert.equal(normalizeDecisionRole(raw), expected));
}

test('MX Spanish titles normalize with accents and management seniority', () => {
  const cases = new Map([
    ['Compradora Senior','SENIOR_BUYER'],
    ['Comprador de Moda','BUYER'],
    ['Gerente de Compras','PURCHASING'],
    ['Director de Compras','HEAD_OF_BUYING'],
    ['Gerente de Categoría','CATEGORY_MANAGEMENT'],
    ['Jefe de Abastecimiento','SOURCING'],
    ['Gerente de Importaciones','IMPORT'],
    ['Director Comercial','COMMERCIAL']
  ]);
  for (const [raw, expected] of cases) assert.equal(normalizeDecisionRole(raw), expected, raw);
});

const departmentCases = new Map([
  ['Buying Department','BUYING_DEPARTMENT'],
  ['Procurement Department','PROCUREMENT_DEPARTMENT'],
  ['Departamento de Compras','BUYING_DEPARTMENT'],
  ['Departamento de Adquisiciones','PROCUREMENT_DEPARTMENT'],
  ['Área de Abastecimiento','PROCUREMENT_DEPARTMENT']
]);
for (const [raw, expected] of departmentCases) {
  test(`department route: ${raw}`, () => assert.equal(normalizeDecisionRole(raw), expected));
}

test('executive, marketing, finance and sales titles do not become procurement roles', () => {
  for (const title of ['CEO','Chief Executive Officer','Marketing Manager','Finance Director','Sales Manager','HR Manager']) {
    assert.equal(normalizeDecisionRole(title), 'UNKNOWN', title);
    assert.equal(roleRelevance(normalizeDecisionRole(title)), 'UNKNOWN', title);
  }
});

test('role relevance keeps direct buying roles above commercial fallbacks', () => {
  assert.equal(roleRelevance('BUYER'), 'HIGH');
  assert.equal(roleRelevance('PROCUREMENT_DEPARTMENT'), 'HIGH');
  assert.equal(roleRelevance('IMPORT'), 'MEDIUM');
  assert.equal(roleRelevance('COMMERCIAL'), 'MEDIUM');
  assert.equal(roleRelevance('UNKNOWN'), 'UNKNOWN');
});

test('product relevance is independent for womenswear and general merchandise', () => {
  const fashion = 'Senior Womenswear Buyer';
  const home = 'Home & Living Buyer';
  assert.equal(productRoleRelevance(fashion,'SENIOR_BUYER','WOMENSWEAR').relevance, 'HIGH');
  assert.equal(productRoleRelevance(fashion,'SENIOR_BUYER','GENERAL_MERCHANDISE').relevance, 'LOW');
  assert.equal(productRoleRelevance(home,'BUYER','GENERAL_MERCHANDISE').relevance, 'HIGH');
  assert.equal(productRoleRelevance(home,'BUYER','WOMENSWEAR').relevance, 'LOW');
  assert.equal(productRoleRelevance('Head of Procurement','PROCUREMENT','WOMENSWEAR').relevance, 'MEDIUM');
  assert.equal(productRoleRelevance('Head of Procurement','PROCUREMENT','GENERAL_MERCHANDISE').relevance, 'MEDIUM');
});

test('normalized identity is stable across accents, punctuation and case', () => {
  assert.equal(normalizedIdentity('  María-López  '), 'maria lopez');
  assert.equal(normalizedIdentity('PROCUREMENT   TEAM'), 'procurement team');
});
