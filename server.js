'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const {
  normalizeGeometry,
  geometryBounds,
  splitBounds,
  buildPhotovoltaicTileQuery,
  buildBuildingLookupQuery,
  isPhotovoltaicElement,
  elementPoint,
  pointInGeometry,
  convertOverpassElements
} = require('./lib/prosumer');
const { loadCatalog, listSources, fetchTernaCapacity } = require('./lib/national-data');
const { isValidCabinCode, featuredCabins } = require('./lib/cabins');

const app = express();
const port = Number(process.env.PORT || 3000);
const useMockOsm = String(process.env.USE_MOCK_OSM || '').toLowerCase() === 'true';
const useMockGse = String(process.env.USE_MOCK_GSE || '').toLowerCase() === 'true';
const configuredCabins = featuredCabins();
const configuredCabinCodes = new Set(configuredCabins.map(cabin => cabin.code));
const requestedDefaultCabinCode = String(process.env.DEFAULT_CABIN_CODE || 'AC001E01308').trim().toUpperCase();
const defaultCabinCode = configuredCabinCodes.has(requestedDefaultCabinCode) ? requestedDefaultCabinCode : 'AC001E01308';
const roofMatchDistanceM = Number(process.env.ROOF_MATCH_DISTANCE_M || 45);
const overpassTileSizeKm = Number(process.env.OVERPASS_TILE_SIZE_KM || 10);
const overpassRetryTileSizeKm = Math.max(2, Number(process.env.OVERPASS_RETRY_TILE_SIZE_KM || 5));
const overpassBuildingBatchSize = Math.max(1, Math.min(25, Number(process.env.OVERPASS_BUILDING_BATCH_SIZE || 12)));
const overpassRequestDelayMs = Math.max(0, Number(process.env.OVERPASS_REQUEST_DELAY_MS || 150));

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
        signal: AbortSignal.timeout(40000)
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

function wait(milliseconds) {
  return milliseconds > 0 ? new Promise(resolve => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function batches(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function searchPhotovoltaic(geometry, cabinCode) {
  if (useMockOsm) {
    const elements = mockElements();
    return {
      elements, queryCount: 0, source: 'mock', cabinCode,
      tileCount: 0, failedTiles: [], buildingQueryCount: 0, buildingFailures: [],
      photovoltaicElements: elements.filter(isPhotovoltaicElement).length,
      buildingElements: elements.filter(element => element.tags && element.tags.building).length
    };
  }
  const normalized = normalizeGeometry(geometry);
  const bounds = geometryBounds(normalized);
  if (!bounds) throw new Error('Geometria cabina non valida');
  const cacheKey = `osm:v3:${cabinCode}:${overpassTileSizeKm}:${overpassRetryTileSizeKm}:${roofMatchDistanceM}`;
  const hit = cached(cacheKey);
  if (hit) return hit;

  const tiles = splitBounds(bounds, overpassTileSizeKm);
  const photovoltaic = new Map();
  const failedTiles = [];
  let effectiveTileCount = 0;
  let queryCount = 0;

  const discoverTile = async (tile, label) => {
    queryCount += 1;
    try {
      const elements = await fetchOverpass(buildPhotovoltaicTileQuery(tile));
      for (const element of elements) {
        const point = elementPoint(element);
        if (isPhotovoltaicElement(element) && pointInGeometry(point, normalized)) {
          photovoltaic.set(`${element.type}/${element.id}`, element);
        }
      }
      effectiveTileCount += 1;
      return;
    } catch (error) {
      const canRetrySmaller = overpassRetryTileSizeKm < overpassTileSizeKm;
      if (!canRetrySmaller) {
        effectiveTileCount += 1;
        failedTiles.push({ index: label, error: error.message });
        return;
      }
      const retryTiles = splitBounds(tile, overpassRetryTileSizeKm, 25);
      for (let retryIndex = 0; retryIndex < retryTiles.length; retryIndex += 1) {
        queryCount += 1;
        effectiveTileCount += 1;
        try {
          const retryElements = await fetchOverpass(buildPhotovoltaicTileQuery(retryTiles[retryIndex]));
          for (const element of retryElements) {
            const point = elementPoint(element);
            if (isPhotovoltaicElement(element) && pointInGeometry(point, normalized)) {
              photovoltaic.set(`${element.type}/${element.id}`, element);
            }
          }
        } catch (retryError) {
          failedTiles.push({ index: `${label}.${retryIndex}`, error: retryError.message });
        }
        if (retryIndex < retryTiles.length - 1) await wait(overpassRequestDelayMs);
      }
    }
  };

  for (let index = 0; index < tiles.length; index += 1) {
    await discoverTile(tiles[index], index);
    if (index < tiles.length - 1) await wait(overpassRequestDelayMs);
  }
  if (failedTiles.length === effectiveTileCount) {
    throw new Error(`Nessun tassello Overpass completato. ${failedTiles.map(item => item.error).join(' | ')}`);
  }

  const points = Array.from(photovoltaic.values()).map(elementPoint).filter(Boolean);
  const buildings = new Map();
  const buildingFailures = [];
  const pointBatches = batches(points, overpassBuildingBatchSize);
  for (let index = 0; index < pointBatches.length; index += 1) {
    try {
      const elements = await fetchOverpass(buildBuildingLookupQuery(pointBatches[index], roofMatchDistanceM));
      queryCount += 1;
      for (const element of elements) buildings.set(`${element.type}/${element.id}`, element);
    } catch (error) {
      buildingFailures.push({ index, error: error.message });
    }
    if (index < pointBatches.length - 1) await wait(overpassRequestDelayMs);
  }

  const elements = [...photovoltaic.values(), ...buildings.values()];
  const result = {
    elements,
    queryCount,
    source: 'OpenStreetMap/Overpass',
    cabinCode,
    tileCount: effectiveTileCount,
    failedTiles,
    buildingQueryCount: pointBatches.length,
    buildingFailures,
    photovoltaicElements: photovoltaic.size,
    buildingElements: buildings.size
  };
  if (!failedTiles.length && !buildingFailures.length) remember(cacheKey, result, 6 * 60 * 60 * 1000);
  return result;
}

app.get('/api/config', (req, res) => {
  const initialCabins = configuredCabins.some(item => item.code === defaultCabinCode)
    ? configuredCabins
    : [{ code: defaultCabinCode, label: `Cabina predefinita ${defaultCabinCode}` }, ...configuredCabins];
  res.json({
    defaultCabinCode,
    initialCabins,
    roofMatchDistanceM,
    overpassTileSizeKm,
    overpassRetryTileSizeKm,
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
  if (!configuredCabinCodes.has(code)) return res.status(400).json({ error: 'Cabina non configurata in questa versione.' });
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
  if (!configuredCabinCodes.has(cabinCode)) return res.status(400).json({ error: 'Cabina non configurata in questa versione.' });
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
        tileCount: raw.tileCount,
        failedTiles: raw.failedTiles,
        buildingQueryCount: raw.buildingQueryCount,
        buildingFailures: raw.buildingFailures,
        photovoltaicElements: raw.photovoltaicElements,
        buildingElements: raw.buildingElements,
        partial: Boolean((raw.failedTiles && raw.failedTiles.length) || (raw.buildingFailures && raw.buildingFailures.length)),
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
