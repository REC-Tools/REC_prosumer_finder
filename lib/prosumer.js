'use strict';

const DEFAULT_ROOF_MATCH_DISTANCE_M = 45;

function normalizeGeometry(input) {
  if (!input) return null;
  if (input.type === 'Feature') return normalizeGeometry(input.geometry);
  if (input.type === 'Polygon' || input.type === 'MultiPolygon') return input;
  return null;
}

function outerRings(input) {
  const geometry = normalizeGeometry(input);
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  return geometry.coordinates.map(polygon => polygon[0]).filter(Boolean);
}

function ringToOverpassPoly(ring, maxPoints = 90) {
  if (!Array.isArray(ring) || ring.length < 4) return '';
  const step = Math.max(1, Math.ceil(ring.length / maxPoints));
  const sampled = ring.filter((_, index) => index % step === 0);
  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) sampled.push(first);
  return sampled.map(([lon, lat]) => `${Number(lat).toFixed(7)} ${Number(lon).toFixed(7)}`).join(' ');
}

function buildPhotovoltaicQuery(poly, roofMatchDistanceM = DEFAULT_ROOF_MATCH_DISTANCE_M) {
  const distance = Math.max(1, Math.min(250, Number(roofMatchDistanceM) || DEFAULT_ROOF_MATCH_DISTANCE_M));
  return `
[out:json][timeout:50];
(
  nwr["power"="generator"]["generator:source"="solar"](poly:"${poly}");
  nwr["power"="generator"]["generator:method"="photovoltaic"](poly:"${poly}");
  nwr["power"="plant"]["plant:source"="solar"](poly:"${poly}");
  nwr["power"="plant"]["plant:method"="photovoltaic"](poly:"${poly}");
  nwr["generator:source"="solar"](poly:"${poly}");
  nwr["generator:method"="photovoltaic"](poly:"${poly}");
  nwr["solar"="photovoltaic"](poly:"${poly}");
  nwr["roof:material"="solar_panels"](poly:"${poly}");
)->.pv;
(
  way["building"](around.pv:${distance});
  relation["building"](around.pv:${distance});
)->.buildings;
(
  .pv;
  .buildings;
);
out center tags geom;
`;
}

function isPhotovoltaicElement(element) {
  const tags = element && element.tags ? element.tags : {};
  const source = String(tags['generator:source'] || tags['plant:source'] || '').toLowerCase();
  const method = String(tags['generator:method'] || tags['plant:method'] || '').toLowerCase();
  return source === 'solar' || method === 'photovoltaic' ||
    String(tags.solar || '').toLowerCase() === 'photovoltaic' ||
    String(tags['roof:material'] || '').toLowerCase() === 'solar_panels';
}

function elementGeometry(element) {
  if (!element || !Array.isArray(element.geometry) || element.geometry.length < 3) return null;
  const ring = element.geometry
    .map(point => [Number(point.lon), Number(point.lat)])
    .filter(point => point.every(Number.isFinite));
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return { type: 'Polygon', coordinates: [ring] };
}

function ringAreaSquareMeters(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  const meanLat = ring.reduce((sum, point) => sum + Number(point[1]), 0) / ring.length;
  const xScale = 111320 * Math.cos(meanLat * Math.PI / 180);
  const yScale = 110540;
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    twiceArea += (x1 * xScale) * (y2 * yScale) - (x2 * xScale) * (y1 * yScale);
  }
  return Math.abs(twiceArea) / 2;
}

function geometryAreaSquareMeters(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return 0;
  if (normalized.type === 'Polygon') return ringAreaSquareMeters(normalized.coordinates[0]);
  return normalized.coordinates.reduce((sum, polygon) => sum + ringAreaSquareMeters(polygon[0]), 0);
}

function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  const usable = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  if (!usable.length) return null;
  return [
    usable.reduce((sum, point) => sum + Number(point[0]), 0) / usable.length,
    usable.reduce((sum, point) => sum + Number(point[1]), 0) / usable.length
  ];
}

function elementPoint(element) {
  if (elementGeometry(element)) return ringCentroid(elementGeometry(element).coordinates[0]);
  const lon = Number(element && (element.lon ?? (element.center && element.center.lon)));
  const lat = Number(element && (element.lat ?? (element.center && element.center.lat)));
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function pointInRing(point, ring) {
  if (!point || !Array.isArray(ring)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parsePowerKilowatts(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase().replace(',', '.');
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(gw|mw|kw|w)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] || 'w';
  if (unit === 'gw') return amount * 1e6;
  if (unit === 'mw') return amount * 1000;
  if (unit === 'kw') return amount;
  return amount / 1000;
}

function explicitCapacityKw(tags) {
  return parsePowerKilowatts(
    tags['generator:output:electricity'] ?? tags['plant:output:electricity'] ??
    tags['generator:output'] ?? tags['plant:output']
  );
}

function addressFromTags(tags) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  return [street, tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(', ');
}

function detectionEvidence(tags) {
  const evidence = [];
  if (String(tags['generator:source'] || '').toLowerCase() === 'solar') evidence.push('generator:source=solar');
  if (String(tags['generator:method'] || '').toLowerCase() === 'photovoltaic') evidence.push('generator:method=photovoltaic');
  if (String(tags['plant:source'] || '').toLowerCase() === 'solar') evidence.push('plant:source=solar');
  if (String(tags['plant:method'] || '').toLowerCase() === 'photovoltaic') evidence.push('plant:method=photovoltaic');
  if (String(tags.solar || '').toLowerCase() === 'photovoltaic') evidence.push('solar=photovoltaic');
  if (String(tags['roof:material'] || '').toLowerCase() === 'solar_panels') evidence.push('roof:material=solar_panels');
  return evidence;
}

function scoreCandidate({ evidence, roof, capacityKw, pvAreaM2, modules }) {
  let score = Math.min(45, 20 + evidence.length * 10);
  if (roof) score += 25;
  if (capacityKw) score += 12;
  if (pvAreaM2) score += 10;
  if (modules) score += 5;
  return Math.min(100, score);
}

function confidenceFor({ evidence, roof, capacityKw, pvAreaM2 }) {
  if (evidence.length >= 2 && roof && (capacityKw || pvAreaM2)) return 'alta';
  if (evidence.length >= 1 && roof) return 'media';
  return 'bassa';
}

function buildRoofCandidates(elements) {
  return elements.filter(element => element.tags && element.tags.building && elementGeometry(element)).map(element => ({
    element,
    geometry: elementGeometry(element),
    point: elementPoint(element),
    areaM2: geometryAreaSquareMeters(elementGeometry(element))
  }));
}

function matchRoof(element, roofs, maxDistanceM = DEFAULT_ROOF_MATCH_DISTANCE_M) {
  const point = elementPoint(element);
  if (!point) return null;
  const ownGeometry = elementGeometry(element);
  if (element.tags && element.tags.building && ownGeometry) {
    return roofs.find(roof => roof.element.type === element.type && roof.element.id === element.id) || null;
  }
  const containing = roofs.filter(roof => pointInRing(point, roof.geometry.coordinates[0]));
  if (containing.length) return containing.sort((a, b) => a.areaM2 - b.areaM2)[0];
  const nearest = roofs.map(roof => ({ roof, distance: distanceMeters(point, roof.point) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance <= maxDistanceM ? nearest.roof : null;
}

function convertOverpassElements(elements, options = {}) {
  const uniqueElements = Array.from(new Map((elements || []).map(element => [`${element.type}/${element.id}`, element])).values());
  const roofs = buildRoofCandidates(uniqueElements);
  const photovoltaic = uniqueElements.filter(isPhotovoltaicElement);
  const cabinCode = options.cabinCode || '';

  const candidates = photovoltaic.map(element => {
    const tags = element.tags || {};
    const pvGeometry = elementGeometry(element);
    const roof = matchRoof(element, roofs, options.maxRoofDistanceM);
    const point = elementPoint(element) || (roof && roof.point);
    if (!point) return null;
    const evidence = detectionEvidence(tags);
    const pvAreaM2 = geometryAreaSquareMeters(pvGeometry) || null;
    const roofAreaM2 = roof ? roof.areaM2 : (tags.building && pvAreaM2 ? pvAreaM2 : null);
    const modules = Number(tags['generator:solar:modules'] || tags['solar:modules'] || 0) || null;
    const taggedCapacityKw = explicitCapacityKw(tags);
    const estimatedCapacityKw = taggedCapacityKw || (modules ? modules * 0.4 : (pvAreaM2 ? pvAreaM2 * 0.18 : null));
    const score = scoreCandidate({ evidence, roof, capacityKw: taggedCapacityKw, pvAreaM2, modules });
    const roofTags = roof ? roof.element.tags || {} : {};
    const address = addressFromTags({ ...roofTags, ...tags });
    const geometry = roof ? roof.geometry : (pvGeometry || { type: 'Point', coordinates: point });

    return {
      type: 'Feature',
      geometry,
      properties: {
        search_id: `${element.type}/${element.id}`,
        cabina_cod_ac: cabinCode,
        name: tags.name || tags.operator || roofTags.name || `Impianto FV ${element.type}/${element.id}`,
        detection_type: roof ? 'fotovoltaico associato a tetto' : 'fotovoltaico da verificare',
        evidence: evidence.join(', '),
        confidence: confidenceFor({ evidence, roof, capacityKw: taggedCapacityKw, pvAreaM2 }),
        score,
        capacity_kw: estimatedCapacityKw ? Number(estimatedCapacityKw.toFixed(2)) : null,
        capacity_source: taggedCapacityKw ? 'tag OSM' : (modules ? 'stima da moduli OSM' : (pvAreaM2 ? 'stima da area mappata' : 'non disponibile')),
        modules,
        pv_area_m2: pvAreaM2 ? Number(pvAreaM2.toFixed(1)) : null,
        roof_area_m2: roofAreaM2 ? Number(roofAreaM2.toFixed(1)) : null,
        address,
        operator: tags.operator || '',
        osm_type: element.type,
        osm_id: element.id,
        building_osm_type: roof ? roof.element.type : '',
        building_osm_id: roof ? roof.element.id : '',
        lat: Number(point[1].toFixed(7)),
        lon: Number(point[0].toFixed(7)),
        source: 'OpenStreetMap/Overpass',
        verification_note: 'Verificare presenza, potenza, titolarita e connessione prima di qualificare il prosumer.'
      }
    };
  }).filter(Boolean);

  const groups = new Map();
  for (const feature of candidates) {
    const p = feature.properties;
    const key = p.building_osm_id ? `roof:${p.building_osm_type}/${p.building_osm_id}` : `pv:${p.osm_type}/${p.osm_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    if (group.length === 1) return group[0];
    const ranked = [...group].sort((a, b) => b.properties.score - a.properties.score);
    const merged = { ...ranked[0], properties: { ...ranked[0].properties } };
    const props = merged.properties;
    const evidence = new Set(group.flatMap(feature => String(feature.properties.evidence || '').split(', ')).filter(Boolean));
    const references = group.map(feature => `${feature.properties.osm_type}/${feature.properties.osm_id}`);
    const preferredName = group.map(feature => feature.properties.name)
      .find(name => name && !String(name).startsWith('Impianto FV '));
    props.search_id = key;
    props.name = preferredName || `Tetto fotovoltaico ${props.building_osm_type}/${props.building_osm_id}`;
    props.evidence = Array.from(evidence).join(', ');
    props.osm_references = references.join(', ');
    props.capacity_kw = Math.max(...group.map(feature => Number(feature.properties.capacity_kw) || 0)) || null;
    props.pv_area_m2 = Number(group.reduce((sum, feature) => sum + (Number(feature.properties.pv_area_m2) || 0), 0).toFixed(1)) || null;
    props.modules = Math.max(...group.map(feature => Number(feature.properties.modules) || 0)) || null;
    props.score = Math.min(100, Math.max(...group.map(feature => feature.properties.score)) + 5);
    props.confidence = 'alta';
    props.detection_type = `fotovoltaico associato a tetto (${group.length} elementi OSM)`;
    return merged;
  }).sort((a, b) => b.properties.score - a.properties.score);
}

module.exports = {
  DEFAULT_ROOF_MATCH_DISTANCE_M,
  normalizeGeometry,
  outerRings,
  ringToOverpassPoly,
  buildPhotovoltaicQuery,
  isPhotovoltaicElement,
  elementGeometry,
  geometryAreaSquareMeters,
  parsePowerKilowatts,
  convertOverpassElements
};
