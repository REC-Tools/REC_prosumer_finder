'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCabinCode, loadCabinConfig, featuredCabins } = require('../lib/cabins');

test('validates GSE primary-substation codes', () => {
  assert.equal(isValidCabinCode('AC001E01308'), true);
  assert.equal(isValidCabinCode('ac001e01884'), true);
  assert.equal(isValidCabinCode('01308'), false);
});

test('the definitive configuration contains only the six requested cabins', () => {
  const config = loadCabinConfig();
  assert.deepEqual(featuredCabins(config).map(item => item.code), [
    'AC001E01298', 'AC001E01305', 'AC001E01307',
    'AC001E01308', 'AC001E01306', 'AC001E01884'
  ]);
});
