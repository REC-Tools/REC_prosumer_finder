'use strict';

const { fetchGseArea, searchPhotovoltaic, isValidCabinCode } = require('../server');
const { convertOverpassElements } = require('../lib/prosumer');

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

  const raw = await searchPhotovoltaic(geometry, code);
  const features = convertOverpassElements(raw.elements, { cabinCode: code });
  console.log(`Overpass: ${raw.tileCount} tasselli (${raw.failedTiles.length} falliti), ${raw.photovoltaicElements} segnali FV, ${raw.buildingElements} edifici, ${features.length} risultati aggregati`);
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
