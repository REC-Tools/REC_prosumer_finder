'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'featured-cabins.json');

function isValidCabinCode(value) {
  return /^AC\d{3}[A-Z]\d{5}$/.test(String(value || '').trim().toUpperCase());
}

function validateCabinConfig(config) {
  if (!config || config.schemaVersion !== 2 || !Array.isArray(config.cabins) || !config.cabins.length) {
    throw new Error('Configurazione cabine non valida');
  }
  if (!config.reviewedAt || !config.source || new URL(config.source).protocol !== 'https:') {
    throw new Error('Metadati della configurazione cabine non validi');
  }
  const codes = config.cabins.map(cabin => cabin.code);
  if (!config.cabins.every(cabin => isValidCabinCode(cabin.code) && cabin.label)) {
    throw new Error('Cabina priva di COD_AC o etichetta valida');
  }
  if (new Set(codes).size !== codes.length) {
    throw new Error('COD_AC duplicato nella configurazione');
  }
  return config;
}

function loadCabinConfig(filePath = DEFAULT_CONFIG_PATH) {
  return validateCabinConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function featuredCabins(config = loadCabinConfig()) {
  return config.cabins.map(cabin => ({ ...cabin }));
}

module.exports = { isValidCabinCode, validateCabinConfig, loadCabinConfig, featuredCabins };
