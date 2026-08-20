'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const {
  parseCmtoArchive,
  filterCmtoFeatures,
  mergeOfficialFeatures,
  officialFeature
} = require('../lib/cmto-fer');

function dbfBuffer(record) {
  const fields = [
    ['TO_CODAZIEN', 9], ['RAG_SOCIALE', 40], ['ISTAT_COMUN', 10], ['CITTA_SO', 30],
    ['INDIR_SO', 40], ['AUTDATAAUT', 8], ['TIPO_IMP', 20]
  ];
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field[1], 0);
  const buffer = Buffer.alloc(headerLength + recordLength, 0x20);
  buffer[0] = 0x03;
  buffer.writeUInt32LE(1, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  let descriptorOffset = 32;
  let recordOffset = headerLength + 1;
  for (const [name, length] of fields) {
    buffer.write(name, descriptorOffset, Math.min(11, name.length), 'ascii');
    buffer[descriptorOffset + 11] = 'C'.charCodeAt(0);
    buffer[descriptorOffset + 16] = length;
    buffer.write(String(record[name] || '').slice(0, length), recordOffset, length, 'latin1');
    descriptorOffset += 32;
    recordOffset += length;
  }
  buffer[descriptorOffset] = 0x0d;
  return buffer;
}

function pointShapefile(lon, lat) {
  const buffer = Buffer.alloc(128);
  buffer.writeInt32BE(9994, 0);
  buffer.writeInt32BE(buffer.length / 2, 24);
  buffer.writeInt32LE(1000, 28);
  buffer.writeInt32LE(1, 32);
  buffer.writeDoubleLE(lon, 36);
  buffer.writeDoubleLE(lat, 44);
  buffer.writeDoubleLE(lon, 52);
  buffer.writeDoubleLE(lat, 60);
  buffer.writeInt32BE(1, 100);
  buffer.writeInt32BE(10, 104);
  buffer.writeInt32LE(1, 108);
  buffer.writeDoubleLE(lon, 112);
  buffer.writeDoubleLE(lat, 120);
  return buffer;
}

test('CMTo archive is converted to a normalized official GeoJSON feature', () => {
  const archive = new AdmZip();
  archive.addFile('SHP_INT_ENER.dbf', dbfBuffer({
    TO_CODAZIEN: '012556', RAG_SOCIALE: 'Rinnovabili Test', ISTAT_COMUN: '001267',
    CITTA_SO: 'SPARONE', INDIR_SO: "Localita' Gulaiun", AUTDATAAUT: '20121221', TIPO_IMP: 'Fotovoltaico'
  }));
  archive.addFile('SHP_INT_ENER.shp', pointShapefile(7.549255, 45.417029));
  const features = parseCmtoArchive(archive.toBuffer());
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates, [7.549255, 45.417029]);
  assert.equal(features[0].properties.authorization_date, '2012-12-21');
  assert.equal(features[0].properties.source_authority, 'Città Metropolitana di Torino');
  assert.equal(features[0].properties.license, 'CC BY 4.0');
});

test('official CMTo features are filtered by the exact GSE geometry', () => {
  const inside = officialFeature({ TO_CODAZIEN: '1', TIPO_IMP: 'Fotovoltaico' }, [7.5, 45.4]);
  const outside = officialFeature({ TO_CODAZIEN: '2', TIPO_IMP: 'Idroelettrico' }, [8.5, 45.4]);
  const geometry = { type: 'Polygon', coordinates: [[[7, 45], [8, 45], [8, 46], [7, 46], [7, 45]]] };
  const filtered = filterCmtoFeatures([inside, outside], geometry, 'AC001E01308');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].properties.cabina_cod_ac, 'AC001E01308');
});

test('an official photovoltaic point enriches and deduplicates a nearby OSM result', () => {
  const osm = {
    type: 'Feature', geometry: { type: 'Point', coordinates: [7.5, 45.4] },
    properties: { search_id: 'pv:way/1', score: 50, confidence: 'bassa', evidence: 'generator:source=solar', lon: 7.5, lat: 45.4 }
  };
  const official = officialFeature({ TO_CODAZIEN: '12', TIPO_IMP: 'Fotovoltaico', AUTDATAAUT: '20240101' }, [7.5001, 45.4001]);
  const merged = mergeOfficialFeatures([osm], [official]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].properties.official_registry, true);
  assert.equal(merged[0].properties.confidence, 'alta');
  assert.equal(merged[0].properties.score, 100);
});
