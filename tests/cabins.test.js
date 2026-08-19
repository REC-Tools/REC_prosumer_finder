'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCabinCode, loadCabinConfig, featuredCabins } = require('../lib/cabins');

test('validates GSE primary-substation codes', () => {
  assert.equal(isValidCabinCode('AC001E01308'), true);
  assert.equal(isValidCabinCode('ac001e01884'), true);
  assert.equal(isValidCabinCode('01308'), false);
});

test('configured cabins cover every GSE intersection for Ceresole Reale and Sparone', () => {
  const config = loadCabinConfig();
  const byMunicipality = new Map(config.municipalities.map(item => [item.name, item]));
  assert.deepEqual(byMunicipality.get('Ceresole Reale').cabinCodes,
    ['AC001E01295', 'AC001E01306', 'AC009E00003']);
  assert.equal(byMunicipality.get('Ceresole Reale').centroidCabinCode, 'AC001E01306');
  assert.deepEqual(byMunicipality.get('Sparone').cabinCodes,
    ['AC001E01305', 'AC001E01308', 'AC001E01884']);
  assert.equal(byMunicipality.get('Sparone').centroidCabinCode, 'AC001E01884');
});

test('featured cabins expose municipality and centroid provenance', () => {
  const cabins = featuredCabins();
  assert.equal(cabins.length, 6);
  assert.equal(cabins.find(item => item.code === 'AC001E01306').containsMunicipalCentroid, true);
  assert.equal(cabins.find(item => item.code === 'AC001E01308').containsMunicipalCentroid, false);
  assert.deepEqual(cabins.find(item => item.code === 'AC009E00003').municipalities, ['Ceresole Reale']);
});
