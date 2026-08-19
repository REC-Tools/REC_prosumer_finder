'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'config', 'national-data-sources.json');
const TERNA_CAPACITY_URL = 'https://api.terna.it/generation/v2.0/renewable-source-capacity';
const TERNA_SOURCES = new Set(['Bioenergie', 'Eolico', 'Fotovoltaico', 'Geotermoelettrico', 'Idrico']);
const TERNA_CAPACITY_TYPES = new Set(['Lorda', 'Netta']);

function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.sources)) {
    throw new Error('Catalogo fonti nazionali non valido');
  }
  const ids = new Set();
  for (const source of catalog.sources) {
    for (const field of ['id', 'authority', 'name', 'coverage', 'granularity', 'access', 'integrationStatus', 'officialUrl']) {
      if (!source[field]) throw new Error(`Fonte priva del campo ${field}`);
    }
    if (ids.has(source.id)) throw new Error(`ID fonte duplicato: ${source.id}`);
    ids.add(source.id);
    const url = new URL(source.officialUrl);
    if (url.protocol !== 'https:') throw new Error(`URL fonte non HTTPS: ${source.id}`);
  }
  return catalog;
}

function loadCatalog(filePath = DEFAULT_CATALOG_PATH) {
  return validateCatalog(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function listSources(filters = {}, catalog = loadCatalog()) {
  return catalog.sources.filter(source =>
    (!filters.authority || source.authority.toLowerCase() === String(filters.authority).toLowerCase()) &&
    (!filters.integrationStatus || source.integrationStatus === filters.integrationStatus) &&
    (!filters.access || source.access === filters.access)
  );
}

function requiredYear(value) {
  const year = Number(value);
  const maximum = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > maximum) {
    throw new Error(`Anno Terna non valido: usare un valore tra 2000 e ${maximum}`);
  }
  return year;
}

function buildTernaCapacityUrl(params = {}) {
  const url = new URL(TERNA_CAPACITY_URL);
  url.searchParams.set('year', String(requiredYear(params.year)));
  if (params.region) url.searchParams.set('region', String(params.region));
  if (params.province) url.searchParams.set('province', String(params.province));
  if (params.source) {
    if (!TERNA_SOURCES.has(params.source)) throw new Error(`Fonte Terna non valida: ${params.source}`);
    url.searchParams.set('source', params.source);
  }
  if (params.capacityType) {
    if (!TERNA_CAPACITY_TYPES.has(params.capacityType)) throw new Error(`Tipo capacità Terna non valido: ${params.capacityType}`);
    url.searchParams.set('capacityType', params.capacityType);
  }
  return url;
}

function parseItalianNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeTernaCapacity(payload) {
  const records = payload && Array.isArray(payload.renewable_sources) ? payload.renewable_sources : [];
  return records.map(record => ({
    year: Number(record.year),
    capacityType: record.capacity_type,
    region: record.region,
    province: record.province,
    source: record.source,
    efficientPowerMw: parseItalianNumber(record.efficient_power_MW),
    authority: 'Terna',
    dataset: 'renewable-source-capacity'
  }));
}

async function fetchTernaCapacity(params, options = {}) {
  const token = options.token;
  if (!token) throw new Error('TERNA_ACCESS_TOKEN non configurato');
  const response = await (options.fetch || fetch)(buildTernaCapacityUrl(params), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(options.timeoutMs || 20000)
  });
  if (!response.ok) throw new Error(`Terna API: HTTP ${response.status}`);
  return normalizeTernaCapacity(await response.json());
}

module.exports = {
  TERNA_SOURCES,
  validateCatalog,
  loadCatalog,
  listSources,
  buildTernaCapacityUrl,
  parseItalianNumber,
  normalizeTernaCapacity,
  fetchTernaCapacity
};
