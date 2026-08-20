'use strict';

const { fetchGseArea, searchPhotovoltaic, searchOfficialFer, isValidCabinCode } = require('../server');
const { convertOverpassElements } = require('../lib/prosumer');
const { mergeOfficialFeatures } = require('../lib/cmto-fer');

async function main() {
  const code = String(process.argv[2] || process.env.DEFAULT_CABIN_CODE || 'AC001E01308').trim().toUpperCase();
  if (!isValidCabinCode(code)) throw new Error(`Codice cabina non valido: ${code}`);

  console.log(`Test live cabina ${code}`);
  const area = await fetchGseArea(code);
  const geometries = area.collection.features.map(feature => feature.geometry);
  const geometry = geometries.length === 1 ? geometries[0] : {
    type: 'MultiPolygon',
    coordinates: geometries.flatMap(item => item.type === 'MultiPolygon' ? item.coordinates : [item.coordinates])
  };
  console.log(`GSE: ${area.collection.features.length} geometria/e da ${area.sourceUrl}`);

  const [raw, official] = await Promise.all([searchPhotovoltaic(geometry, code), searchOfficialFer(geometry, code)]);
  const osmFeatures = convertOverpassElements(raw.elements, { cabinCode: code });
  const features = mergeOfficialFeatures(osmFeatures, official.features);
  console.log(`Overpass: ${raw.tileCount} tasselli (${raw.failedTiles.length} falliti), ${raw.photovoltaicElements} segnali FV, ${raw.buildingElements} edifici`);
  console.log(`CMTo: ${official.features.length} impianti FER ufficiali; totale unificato: ${features.length}`);
  if (raw.buildingFailures.length) console.log(`Lookup edifici parziali: ${raw.buildingFailures.length} batch falliti`);
  for (const feature of features) {
    const p = feature.properties;
    console.log(`- ${p.search_id}: ${p.confidence}, ${p.capacity_kw || 'n.d.'} kW, ${p.evidence}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
