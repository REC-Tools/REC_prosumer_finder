'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitBounds,
  buildPhotovoltaicTileQuery,
  buildBuildingLookupQuery,
  isPhotovoltaicElement,
  parsePowerKilowatts,
  convertOverpassElements
} = require('../lib/prosumer');

const building = {
  type: 'way', id: 10, tags: { building: 'industrial', name: 'Capannone test', 'addr:street': 'Via Test' },
  center: { lat: 45.0001, lon: 9.0001 },
  geometry: [
    { lat: 45.0000, lon: 9.0000 }, { lat: 45.0000, lon: 9.0003 },
    { lat: 45.0002, lon: 9.0003 }, { lat: 45.0002, lon: 9.0000 },
    { lat: 45.0000, lon: 9.0000 }
  ]
};

test('photovoltaic discovery uses a compact bounding-box query without buildings', () => {
  const query = buildPhotovoltaicTileQuery({ south: 45, west: 7, north: 45.1, east: 7.1 });
  assert.match(query, /generator:source/);
  assert.match(query, /photovoltaic/);
  assert.match(query, /roof:material/);
  assert.match(query, /bbox:45\.0000000,7\.0000000,45\.1000000,7\.1000000/);
  assert.match(query, /out body center qt/);
  assert.doesNotMatch(query, /building|poly:/);
});

test('large bounds are split into bounded sequential Overpass tiles', () => {
  const tiles = splitBounds({ south: 45, west: 7, north: 45.25, east: 7.35 }, 10);
  assert.ok(tiles.length > 1);
  assert.ok(tiles.length < 25);
  assert.ok(tiles.every(tile => tile.north > tile.south && tile.east > tile.west));
});

test('building enrichment is limited to photovoltaic coordinates', () => {
  const query = buildBuildingLookupQuery([[7.1, 45.1]], 45);
  assert.match(query, /way\["building"\]\(around:45,45\.1000000,7\.1000000\)/);
  assert.doesNotMatch(query, /relation/);
  assert.doesNotMatch(query, /generator:source|poly:/);
});

test('photovoltaic classification does not accept unrelated generators', () => {
  assert.equal(isPhotovoltaicElement({ tags: { power: 'generator', 'generator:source': 'solar' } }), true);
  assert.equal(isPhotovoltaicElement({ tags: { power: 'generator', 'generator:source': 'wind' } }), false);
});

test('power values are normalized to kW', () => {
  assert.equal(parsePowerKilowatts('48 kW'), 48);
  assert.equal(parsePowerKilowatts('1.5 MW'), 1500);
  assert.equal(parsePowerKilowatts('900 W'), 0.9);
  assert.equal(parsePowerKilowatts('n/a'), null);
});

test('a photovoltaic generator is associated with its containing roof', () => {
  const generator = {
    type: 'node', id: 20, lat: 45.0001, lon: 9.0001,
    tags: {
      power: 'generator', 'generator:source': 'solar', 'generator:method': 'photovoltaic',
      'generator:output:electricity': '50 kW'
    }
  };
  const collection = convertOverpassElements([building, generator], { cabinCode: 'AC001E01308' });
  assert.equal(collection.length, 1);
  assert.equal(collection[0].properties.building_osm_id, 10);
  assert.equal(collection[0].properties.capacity_kw, 50);
  assert.equal(collection[0].properties.cabina_cod_ac, 'AC001E01308');
  assert.ok(collection[0].properties.roof_area_m2 > 400);
});

test('multiple photovoltaic objects on one building produce one roof result', () => {
  const node = {
    type: 'node', id: 21, lat: 45.0001, lon: 9.0001,
    tags: { power: 'generator', 'generator:source': 'solar', 'generator:output:electricity': '30 kW' }
  };
  const panelArea = {
    type: 'way', id: 22,
    tags: { power: 'generator', 'generator:source': 'solar', 'generator:method': 'photovoltaic' },
    geometry: [
      { lat: 45.00004, lon: 9.00004 }, { lat: 45.00004, lon: 9.00020 },
      { lat: 45.00012, lon: 9.00020 }, { lat: 45.00012, lon: 9.00004 },
      { lat: 45.00004, lon: 9.00004 }
    ]
  };
  const collection = convertOverpassElements([building, node, panelArea], { cabinCode: 'AC001E01308' });
  assert.equal(collection.length, 1);
  assert.equal(collection[0].properties.search_id, 'roof:way/10');
  assert.match(collection[0].properties.osm_references, /node\/21/);
  assert.match(collection[0].properties.osm_references, /way\/22/);
  assert.equal(collection[0].properties.confidence, 'alta');
});
