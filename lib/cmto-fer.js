'use strict';

const AdmZip = require('adm-zip');
const { pointInGeometry } = require('./prosumer');

const CMTO_FER_URL = 'https://eds.cittametropolitana.torino.it/geoportale/SHP_INT_ENER.php';
const CMTO_FER_SOURCE_URL = 'https://www.geoportale.piemonte.it/geonetwork/srv/search?topicCat=environment';
const CMTO_FER_LICENSE = 'CC BY 4.0';
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;

function readText(buffer) {
  return buffer.toString('latin1').replace(/\0/g, '').trim();
}

function parseDbf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) throw new Error('DBF CMTo non valido');
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  if (headerLength < 33 || recordLength < 2 || headerLength + recordCount * recordLength > buffer.length) {
    throw new Error('Struttura DBF CMTo non valida');
  }
  const fields = [];
  let descriptorOffset = 32;
  let valueOffset = 1;
  while (descriptorOffset + 32 <= headerLength && buffer[descriptorOffset] !== 0x0d) {
    const name = readText(buffer.subarray(descriptorOffset, descriptorOffset + 11));
    const length = buffer[descriptorOffset + 16];
    if (!name || !length) throw new Error('Campo DBF CMTo non valido');
    fields.push({ name, length, offset: valueOffset });
    valueOffset += length;
    descriptorOffset += 32;
  }
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = headerLength + index * recordLength;
    if (buffer[offset] === 0x2a) {
      records.push(null);
      continue;
    }
    const record = {};
    for (const field of fields) {
      record[field.name] = readText(buffer.subarray(offset + field.offset, offset + field.offset + field.length));
    }
    records.push(record);
  }
  return records;
}

function parsePointShapefile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.readInt32BE(0) !== 9994) {
    throw new Error('Shapefile CMTo non valido');
  }
  if (buffer.readInt32LE(32) !== 1) throw new Error('Lo Shapefile CMTo deve contenere punti');
  const points = [];
  let offset = 100;
  while (offset + 12 <= buffer.length) {
    const contentBytes = buffer.readInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    if (contentBytes < 4 || contentOffset + contentBytes > buffer.length) throw new Error('Record Shapefile CMTo non valido');
    const shapeType = buffer.readInt32LE(contentOffset);
    if (shapeType !== 0 && (shapeType !== 1 || contentBytes < 20)) throw new Error('Geometria Shapefile CMTo non supportata');
    points.push(shapeType === 0 ? null : [buffer.readDoubleLE(contentOffset + 4), buffer.readDoubleLE(contentOffset + 12)]);
    offset = contentOffset + contentBytes;
  }
  return points;
}

function formatAuthorizationDate(value) {
  const text = String(value || '');
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
}

function officialFeature(record, coordinates) {
  const type = record.TIPO_IMP || 'Fonte rinnovabile';
  const municipality = record.CITTA_SO || 'Comune non indicato';
  const siteCode = record.TO_CODAZIEN || record.CODSIRA || `${coordinates[1]}-${coordinates[0]}`;
  const authorizationDate = formatAuthorizationDate(record.AUTDATAAUT);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      search_id: `cmto:${siteCode}`,
      name: `${type} autorizzato - ${municipality}`,
      detection_type: 'impianto FER autorizzato (registro istituzionale)',
      confidence: 'alta',
      score: 100,
      capacity_kw: null,
      capacity_source: 'non disponibile nel dataset CMTo',
      pv_area_m2: null,
      roof_area_m2: null,
      modules: null,
      address: [record.INDIR_SO, municipality].filter(Boolean).join(', '),
      evidence: `Registro FER autorizzati CMTo · ${type}`,
      verification_note: `Fonte istituzionale CC BY 4.0${authorizationDate ? `; autorizzazione ${authorizationDate}` : ''}. Verificare esercizio e POD.`,
      lat: coordinates[1],
      lon: coordinates[0],
      plant_type: type,
      municipality,
      istat_code: record.ISTAT_COMUN || null,
      company: record.RAG_SOCIALE || null,
      authorization_date: authorizationDate,
      cmto_site_code: record.TO_CODAZIEN || null,
      sira_code: record.CODSIRA || null,
      source_authority: 'Città Metropolitana di Torino',
      source_dataset: 'Impianti di produzione di energia da fonti rinnovabili - puntuale',
      source_url: CMTO_FER_SOURCE_URL,
      license: CMTO_FER_LICENSE,
      official_registry: true
    }
  };
}

function parseCmtoArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Archivio CMTo non valido o troppo grande');
  const archive = new AdmZip(buffer);
  const dbfEntry = archive.getEntry('SHP_INT_ENER.dbf');
  const shpEntry = archive.getEntry('SHP_INT_ENER.shp');
  if (!dbfEntry || !shpEntry) throw new Error('Archivio CMTo privo di SHP/DBF');
  if (dbfEntry.header.size > MAX_ENTRY_BYTES || shpEntry.header.size > MAX_ENTRY_BYTES) {
    throw new Error('Contenuto archivio CMTo troppo grande');
  }
  const records = parseDbf(dbfEntry.getData());
  const points = parsePointShapefile(shpEntry.getData());
  if (records.length !== points.length) throw new Error('SHP e DBF CMTo non allineati');
  return records.flatMap((record, index) => record && points[index] ? [officialFeature(record, points[index])] : []);
}

async function fetchCmtoFer(options = {}) {
  const response = await (options.fetch || fetch)(options.url || CMTO_FER_URL, {
    headers: { Accept: 'application/zip', 'User-Agent': 'REC_prosumer_finder/0.1' },
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  });
  if (!response.ok) throw new Error(`Dataset CMTo FER: HTTP ${response.status}`);
  const declaredLength = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) throw new Error('Archivio CMTo troppo grande');
  return parseCmtoArchive(Buffer.from(await response.arrayBuffer()));
}

function filterCmtoFeatures(features, geometry, cabinCode) {
  return (features || []).filter(feature => pointInGeometry(feature.geometry.coordinates, geometry)).map(feature => ({
    ...feature,
    properties: { ...feature.properties, cabina_cod_ac: cabinCode }
  }));
}

function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function featurePoint(feature) {
  if (feature && feature.geometry && feature.geometry.type === 'Point') return feature.geometry.coordinates;
  const properties = feature && feature.properties || {};
  const lon = Number(properties.lon);
  const lat = Number(properties.lat);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function mergeOfficialFeatures(osmFeatures, officialFeatures, maxDistanceM = 75) {
  const merged = (osmFeatures || []).map(feature => ({ ...feature, properties: { ...feature.properties } }));
  for (const official of officialFeatures || []) {
    const officialPoint = featurePoint(official);
    const isPhotovoltaic = String(official.properties.plant_type || '').toLowerCase() === 'fotovoltaico';
    let best = null;
    let bestDistance = Infinity;
    if (isPhotovoltaic && officialPoint) {
      for (const candidate of merged) {
        if (candidate.properties.official_registry) continue;
        const candidatePoint = featurePoint(candidate);
        const distance = candidatePoint ? distanceMeters(officialPoint, candidatePoint) : Infinity;
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    if (!best || bestDistance > maxDistanceM) {
      merged.push(official);
      continue;
    }
    best.properties.official_registry = true;
    best.properties.official_match_distance_m = Number(bestDistance.toFixed(1));
    best.properties.source_authority = 'OpenStreetMap; Città Metropolitana di Torino';
    best.properties.source_dataset = official.properties.source_dataset;
    best.properties.cmto_site_code = official.properties.cmto_site_code;
    best.properties.authorization_date = official.properties.authorization_date;
    best.properties.company = official.properties.company;
    best.properties.license = official.properties.license;
    best.properties.confidence = 'alta';
    best.properties.score = 100;
    best.properties.evidence = `${best.properties.evidence || 'OpenStreetMap'}, riscontro registro FER CMTo`;
    best.properties.verification_note = `Riscontro nel registro istituzionale CMTo a ${best.properties.official_match_distance_m} m. Verificare esercizio e POD.`;
  }
  return merged.sort((a, b) => Number(b.properties.score || 0) - Number(a.properties.score || 0));
}

module.exports = {
  CMTO_FER_URL,
  CMTO_FER_SOURCE_URL,
  CMTO_FER_LICENSE,
  parseDbf,
  parsePointShapefile,
  parseCmtoArchive,
  fetchCmtoFer,
  filterCmtoFeatures,
  mergeOfficialFeatures,
  officialFeature
};
