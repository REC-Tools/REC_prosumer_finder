'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const {
  normalizeGeometry,
  outerRings,
  ringToOverpassPoly,
  buildPhotovoltaicQuery,
  convertOverpassElements
} = require('./lib/prosumer');
const { loadCatalog, listSources, fetchTernaCapacity } = require('./lib/national-data');
const { isValidCabinCode, featuredCabins } = require('./lib/cabins');

const app = express();
const port = Number(process.env.PORT || 3000);
const useMockOsm = String(process.env.USE_MOCK_OSM || '').toLowerCase() === 'true';
const useMockGse = String(process.env.USE_MOCK_GSE || '').toLowerCase() === 'true';
const defaultCabinCode = String(process.env.DEFAULT_CABIN_CODE || 'AC001E01308').toUpperCase();
const configuredCabins = featuredCabins();
const roofMatchDistanceM = Number(process.env.ROOF_MATCH_DISTANCE_M || 45);

const currentGseLayerUrl = 'https://services-eu1.arcgis.com/sawHMGY9o8rHlY2j/arcgis/rest/services/AC_Comuni_2025/FeatureServer/0';
const modifiedGseLayerUrl = 'https://services-eu1.arcgis.com/sawHMGY9o8rHlY2j/arcgis/rest/services/AC_Comuni_2025/FeatureServer/5';
const legacyGseLayerUrl = 'https://services2.arcgis.com/pROHh69WvVijk4nR/arcgis/rest/services/AC_Comuni/FeatureServer/21';
const gseLayerUrls = String(process.env.GSE_FEATURE_LAYER_URLS || [currentGseLayerUrl, modifiedGseLayerUrl, legacyGseLayerUrl].join(','))
  .split(',').map(value => value.trim()).filter(Boolean);
const overpassUrls = String(process.env.OVERPASS_URLS || process.env.OVERPASS_URL ||
  'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter')
  .split(',').map(value => value.trim()).filter(Boolean);

const cache = new Map();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'webapp')));

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function cached(key) {
  const item = cache.get(key);
  if (!item || item.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function remember(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function featureCollectionFromArcgis(json, code, sourceUrl) {
  const features = Array.isArray(json.features) ? json.features.map((feature, index) => ({
    type: 'Feature',
    id: feature.id || (feature.properties && (feature.properties.OBJECTID || feature.properties.FID)) || index,
    geometry: feature.geometry,
    properties: { ...(feature.properties || {}), COD_AC: code, source_layer: sourceUrl }
  })).filter(feature => normalizeGeometry(feature.geometry)) : [];
  return { type: 'FeatureCollection', features };
}

async function fetchGseArea(code) {
  if (useMockGse) {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, 'webapp', 'data', 'gse-area-mock.geojson'), 'utf8'));
    return { collection: featureCollectionFromArcgis(mock, code, 'mock'), sourceUrl: 'mock' };
  }
  const cacheKey = `gse:${code}`;
  const hit = cached(cacheKey);
  if (hit) return hit;
  const failures = [];
  for (const layerUrl of gseLayerUrls) {
    const params = new URLSearchParams({
      where: `COD_AC='${escapeSqlString(code)}'`,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'geojson'
    });
    try {
      const response = await fetch(`${layerUrl}/query?${params.toString()}`, {
        headers: { Accept: 'application/geo+json,application/json', 'User-Agent': 'REC_prosumer_finder/0.1' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        failures.push(`${layerUrl}: HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      if (json.error) {
        failures.push(`${layerUrl}: ${json.error.message || 'errore ArcGIS'}`);
        continue;
      }
      const collection = featureCollectionFromArcgis(json, code, layerUrl);
      if (collection.features.length) {
        const result = { collection, sourceUrl: layerUrl };
        remember(cacheKey, result, 24 * 60 * 60 * 1000);
        return result;
      }
      failures.push(`${layerUrl}: nessuna geometria`);
    } catch (error) {
      failures.push(`${layerUrl}: ${error.message}`);
    }
  }
  throw new Error(`Cabina ${code} non trovata nei layer GSE configurati. ${failures.join(' | ')}`);
}

function mockElements() {
  const mockPath = path.join(__dirname, 'webapp', 'data', 'pv-mock.json');
  return JSON.parse(fs.readFileSync(mockPath, 'utf8')).elements;
}

async function fetchOverpass(query) {
  const failures = [];
  for (const url of overpassUrls) {
    try {
      const body = new URLSearchParams({ data: query });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'REC_prosumer_finder/0.1' },
        body: body.toString(),
        signal: AbortSignal.timeout(65000)
      });
      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      return Array.isArray(json.elements) ? json.elements : [];
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Servizi Overpass non disponibili. ${failures.join(' | ')}`);
}

async function searchPhotovoltaic(geometry, cabinCode) {
  if (useMockOsm) return { elements: mockElements(), queryCount: 0, source: 'mock' };
  const rings = outerRings(geometry);
  if (!rings.length) throw new Error('Geometria cabina non valida');
  const groups = [];
  for (const ring of rings) {
    const poly = ringToOverpassPoly(ring);
    if (!poly) continue;
    groups.push(await fetchOverpass(buildPhotovoltaicQuery(poly, roofMatchDistanceM)));
  }
  const elements = Array.from(new Map(groups.flat().map(element => [`${element.type}/${element.id}`, element])).values());
  return { elements, queryCount: groups.length, source: 'OpenStreetMap/Overpass', cabinCode };
}

app.get('/api/config', (req, res) => {
  const initialCabins = configuredCabins.some(item => item.code === defaultCabinCode)
    ? configuredCabins
    : [{ code: defaultCabinCode, label: `Cabina predefinita ${defaultCabinCode}` }, ...configuredCabins];
  res.json({
    defaultCabinCode,
    initialCabins,
    roofMatchDistanceM,
    useMockOsm,
    useMockGse
  });
});

app.get('/api/national-data-sources', (req, res) => {
  try {
    const catalog = loadCatalog();
    const sources = listSources({
      authority: req.query.authority,
      integrationStatus: req.query.integrationStatus,
      access: req.query.access
    }, catalog);
    res.json({ schemaVersion: catalog.schemaVersion, reviewedAt: catalog.reviewedAt, sources });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/terna-capacity', async (req, res) => {
  if (!process.env.TERNA_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Integrazione Terna non configurata: impostare TERNA_ACCESS_TOKEN.' });
  }
  try {
    const records = await fetchTernaCapacity({
      year: req.query.year,
      region: req.query.region,
      province: req.query.province,
      source: req.query.source,
      capacityType: req.query.capacityType
    }, { token: process.env.TERNA_ACCESS_TOKEN });
    res.json({ records, meta: { source: 'Terna Renewable Source Capacity API', aggregateOnly: true } });
  } catch (error) {
    const status = /non valido|Anno Terna/.test(error.message) ? 400 : 502;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/gse-area', async (req, res) => {
  const code = String(req.query.code || defaultCabinCode).trim().toUpperCase();
  if (!isValidCabinCode(code)) return res.status(400).json({ error: 'Codice cabina non valido. Formato atteso: AC001E01308.' });
  try {
    const result = await fetchGseArea(code);
    res.json({ ...result.collection, meta: { code, source: 'GSE/ArcGIS', sourceUrl: result.sourceUrl } });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/pv-search', async (req, res) => {
  const cabinCode = String(req.body && req.body.cabinCode || '').trim().toUpperCase();
  const geometry = normalizeGeometry(req.body && req.body.geometry);
  if (!isValidCabinCode(cabinCode)) return res.status(400).json({ error: 'Codice cabina non valido.' });
  if (!geometry) return res.status(400).json({ error: 'Geometria Polygon o MultiPolygon richiesta.' });
  try {
    const raw = await searchPhotovoltaic(geometry, cabinCode);
    const features = convertOverpassElements(raw.elements, { cabinCode, maxRoofDistanceM: roofMatchDistanceM });
    res.json({
      type: 'FeatureCollection',
      features,
      meta: {
        cabinCode,
        source: raw.source,
        queryCount: raw.queryCount,
        rawElements: raw.elements.length,
        detectedPhotovoltaic: features.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'webapp', 'index.html'));
});

function startServer(preferredPort, attempts = 0) {
  const server = app.listen(preferredPort);
  server.once('listening', () => {
    const address = server.address();
    console.log(`Server listening on http://localhost:${address.port}`);
  });
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && attempts < 10) return startServer(Number(preferredPort) + 1, attempts + 1);
    throw error;
  });
  return server;
}

if (require.main === module) startServer(port);

module.exports = { app, startServer, isValidCabinCode, fetchGseArea, searchPhotovoltaic };
