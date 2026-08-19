'use strict';

const { loadCabinConfig, featuredCabins } = require('../lib/cabins');
const { fetchGseArea } = require('../server');

async function main() {
  const config = loadCabinConfig();
  console.log(`Configurazione del ${config.reviewedAt}: ${config.municipalities.length} comuni, ${featuredCabins(config).length} cabine`);
  for (const cabin of featuredCabins(config)) {
    const result = await fetchGseArea(cabin.code);
    if (!result.collection.features.length) throw new Error(`Nessun perimetro GSE per ${cabin.code}`);
    console.log(`- ${cabin.code}: ${result.collection.features.length} geometria/e · ${cabin.label}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
