'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadCatalog,
  listSources,
  buildTernaCapacityUrl,
  parseItalianNumber,
  normalizeTernaCapacity,
  fetchTernaCapacity
} = require('../lib/national-data');

test('the national source catalog is valid and has unique IDs', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.sources.length >= 5);
  assert.equal(new Set(catalog.sources.map(source => source.id)).size, catalog.sources.length);
  assert.ok(listSources({ authority: 'Terna' }, catalog).length >= 3);
});

test('Terna capacity requests are constrained to documented values', () => {
  const url = buildTernaCapacityUrl({
    year: 2025,
    region: 'Lombardia',
    province: 'Milano',
    source: 'Fotovoltaico',
    capacityType: 'Lorda'
  });
  assert.equal(url.searchParams.get('year'), '2025');
  assert.equal(url.searchParams.get('source'), 'Fotovoltaico');
  assert.throws(() => buildTernaCapacityUrl({ year: 2025, source: 'Carbone' }), /Fonte Terna non valida/);
});

test('Terna decimal values are normalized without losing Italian formatting', () => {
  assert.equal(parseItalianNumber('1.234,56'), 1234.56);
  assert.equal(parseItalianNumber('14,243'), 14.243);
  assert.equal(parseItalianNumber('n.d.'), null);
  assert.deepEqual(normalizeTernaCapacity({ renewable_sources: [{
    year: '2025', capacity_type: 'Lorda', region: 'Lombardia', province: 'Milano',
    source: 'Fotovoltaico', efficient_power_MW: '1.234,56'
  }] })[0], {
    year: 2025, capacityType: 'Lorda', region: 'Lombardia', province: 'Milano',
    source: 'Fotovoltaico', efficientPowerMw: 1234.56,
    authority: 'Terna', dataset: 'renewable-source-capacity'
  });
});

test('the Terna adapter sends OAuth credentials and normalizes the response', async () => {
  let request;
  const records = await fetchTernaCapacity({ year: 2025, source: 'Eolico' }, {
    token: 'test-token',
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ renewable_sources: [{
        year: '2025', capacity_type: 'Netta', region: 'Puglia', province: 'Foggia',
        source: 'Eolico', efficient_power_MW: '2.500,5'
      }] }) };
    }
  });
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(records[0].efficientPowerMw, 2500.5);
});
