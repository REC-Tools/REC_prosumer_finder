'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'featured-cabins.json');

function isValidCabinCode(value) {
  return /^AC\d{3}[A-Z]\d{5}$/.test(String(value || '').trim().toUpperCase());
}

function validateCabinConfig(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.municipalities)) {
    throw new Error('Configurazione cabine non valida');
  }
  if (!config.reviewedAt || !config.source || new URL(config.source).protocol !== 'https:') {
    throw new Error('Metadati della configurazione cabine non validi');
  }
  for (const municipality of config.municipalities) {
    if (!municipality.name || !/^\d{6}$/.test(municipality.istatCode || '')) {
      throw new Error('Comune privo di nome o codice ISTAT valido');
    }
    if (!Array.isArray(municipality.cabinCodes) || !municipality.cabinCodes.length) {
      throw new Error(`Nessuna cabina configurata per ${municipality.name}`);
    }
    if (!municipality.cabinCodes.every(isValidCabinCode)) {
      throw new Error(`COD_AC non valido per ${municipality.name}`);
    }
    if (new Set(municipality.cabinCodes).size !== municipality.cabinCodes.length) {
      throw new Error(`COD_AC duplicato per ${municipality.name}`);
    }
    if (!municipality.cabinCodes.includes(municipality.centroidCabinCode)) {
      throw new Error(`La cabina del centroide non interseca ${municipality.name}`);
    }
  }
  return config;
}

function loadCabinConfig(filePath = DEFAULT_CONFIG_PATH) {
  return validateCabinConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function featuredCabins(config = loadCabinConfig()) {
  const cabins = new Map();
  for (const municipality of config.municipalities) {
    for (const code of municipality.cabinCodes) {
      const existing = cabins.get(code);
      const names = existing ? existing.municipalities : [];
      const municipalities = [...new Set([...names, municipality.name])];
      const containsMunicipalCentroid = Boolean(existing && existing.containsMunicipalCentroid) ||
        code === municipality.centroidCabinCode;
      cabins.set(code, {
        code,
        label: `${municipalities.join(', ')}${containsMunicipalCentroid ? ' · centroide comunale' : ' · intersezione territoriale'}`,
        municipalities,
        containsMunicipalCentroid
      });
    }
  }
  return Array.from(cabins.values());
}

module.exports = { isValidCabinCode, validateCabinConfig, loadCabinConfig, featuredCabins };
